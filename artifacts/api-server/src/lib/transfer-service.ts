import crypto from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import {
  db,
  gigsTable,
  gigLineItemsTable,
  invoicesTable,
  suppliersTable,
  transfersTable,
  platformSettingsTable,
} from "@workspace/db";
import { getStripe } from "./stripe";

interface MinimalLogger {
  error: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
}

export interface TransferServiceContext {
  log?: MinimalLogger;
}

export interface TransferOutcome {
  transfer: typeof transfersTable.$inferSelect;
  skipped?: boolean;
}

export type TransferReason =
  | "no_paid_invoices"
  | "gig_not_found"
  | "settings_missing";

export interface TransferServiceResult {
  ok: boolean;
  reason?: TransferReason;
  transfers?: TransferOutcome[];
}

/**
 * Walk every supplier line item across all PAID invoices for a gig
 * and create Stripe Transfers for each. Idempotent per
 * gig_line_item_id at the DB level (skips lines that already have a
 * transfer row) and per-call at the Stripe level via a
 * `transfer-<lineItemId>-<uuid>` idempotency key.
 *
 * Used by:
 *   - POST /api/admin/gigs/:id/transfers (manual admin trigger)
 *   - The Stripe webhook handler when an invoice transitions to paid
 *
 * Returns a typed result rather than throwing for control-flow errors
 * (gig not found, no paid invoices, missing settings) so the caller
 * can decide what HTTP status to respond with. Per-line Stripe errors
 * become `failed` transfer rows (auditable) rather than top-level
 * failures.
 */
export async function createTransfersForGig(
  gigId: string,
  ctx: TransferServiceContext = {},
): Promise<TransferServiceResult> {
  const stripe = getStripe();

  const gigRows = await db
    .select()
    .from(gigsTable)
    .where(and(eq(gigsTable.id, gigId), isNull(gigsTable.deletedAt)))
    .limit(1);
  if (gigRows.length === 0) {
    return { ok: false, reason: "gig_not_found" };
  }
  const gig = gigRows[0];

  const invoicesForGig = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.gigId, gig.id));
  const paidWithCharge = invoicesForGig.filter(
    (inv) => inv.stripeChargeId && inv.status !== "void",
  );
  if (paidWithCharge.length === 0) {
    return { ok: false, reason: "no_paid_invoices" };
  }

  const chargeByPhase: Record<string, string> = {};
  for (const inv of paidWithCharge) {
    if (inv.stripeChargeId) {
      chargeByPhase[
        inv.invoiceType === "reservation" ? "reservation" : "balance"
      ] = inv.stripeChargeId;
    }
  }

  const settingsRows = await db
    .select()
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.id, "singleton"))
    .limit(1);
  if (settingsRows.length === 0) {
    return { ok: false, reason: "settings_missing" };
  }
  const settings = settingsRows[0];

  const lineRows = await db
    .select({
      lineItem: gigLineItemsTable,
      supplier: suppliersTable,
    })
    .from(gigLineItemsTable)
    .innerJoin(
      suppliersTable,
      eq(suppliersTable.id, gigLineItemsTable.supplierId),
    )
    .where(
      and(
        eq(gigLineItemsTable.gigId, gig.id),
        eq(gigLineItemsTable.isPlatformLine, false),
      ),
    );

  const existingTransfers = await db
    .select()
    .from(transfersTable)
    .where(eq(transfersTable.gigId, gig.id));
  const existingByLineId = new Map<string, typeof transfersTable.$inferSelect>(
    existingTransfers.map((t) => [t.gigLineItemId, t]),
  );

  const results: TransferOutcome[] = [];
  for (const { lineItem: li, supplier } of lineRows) {
    if (existingByLineId.has(li.id)) {
      const existing = existingByLineId.get(li.id);
      if (existing) results.push({ transfer: existing, skipped: true });
      continue;
    }

    const sourceCharge = chargeByPhase[li.invoicePhase];
    if (!sourceCharge) continue; // invoice for this phase not paid yet

    const grossPence = Math.round(
      (li.amountPence * (10000 + li.vatRateBps)) / 10000,
    );
    const idempKey = `transfer-${li.id}-${crypto.randomUUID()}`;

    if (!supplier.stripeAccountId) {
      const [inserted] = await db
        .insert(transfersTable)
        .values({
          gigId: gig.id,
          gigLineItemId: li.id,
          supplierId: supplier.id,
          stripeChargeId: sourceCharge,
          amountPence: grossPence,
          currency: settings.currency,
          status: "failed",
          failureReason: "supplier_not_onboarded",
          stripeIdempotencyKey: idempKey,
        })
        .returning();
      results.push({ transfer: inserted });
      continue;
    }

    try {
      const transfer = await stripe.transfers.create(
        {
          amount: grossPence,
          currency: settings.currency,
          destination: supplier.stripeAccountId,
          source_transaction: sourceCharge,
          transfer_group: gig.id,
          metadata: {
            gigId: gig.id,
            gigLineItemId: li.id,
            supplierId: supplier.id,
            invoicePhase: li.invoicePhase,
          },
        },
        { idempotencyKey: idempKey },
      );

      const [inserted] = await db
        .insert(transfersTable)
        .values({
          gigId: gig.id,
          gigLineItemId: li.id,
          supplierId: supplier.id,
          stripeTransferId: transfer.id,
          stripeChargeId: sourceCharge,
          amountPence: grossPence,
          currency: settings.currency,
          status: "created",
          stripeIdempotencyKey: idempKey,
        })
        .returning();
      results.push({ transfer: inserted });
    } catch (err) {
      ctx.log?.error(
        { err, lineItemId: li.id, supplierId: supplier.id },
        "stripe transfers.create failed",
      );
      const [inserted] = await db
        .insert(transfersTable)
        .values({
          gigId: gig.id,
          gigLineItemId: li.id,
          supplierId: supplier.id,
          stripeChargeId: sourceCharge,
          amountPence: grossPence,
          currency: settings.currency,
          status: "failed",
          failureReason: ((err as Error).message ?? "unknown").slice(0, 500),
          stripeIdempotencyKey: idempKey,
        })
        .returning();
      results.push({ transfer: inserted });
    }
  }

  return { ok: true, transfers: results };
}
