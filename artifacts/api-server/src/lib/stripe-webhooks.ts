import type Stripe from "stripe";
import crypto from "node:crypto";
import { eq, and } from "drizzle-orm";
import {
  db,
  invoicesTable,
  suppliersTable,
  auditLogTable,
  gigsTable,
} from "@workspace/db";
import { getStripe } from "./stripe";
import { createTransfersForGig } from "./transfer-service";

interface MinimalLogger {
  error: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
}

interface DispatchContext {
  log: MinimalLogger;
}

/**
 * Process a Stripe V1 webhook event. Idempotent via the
 * `stripe_event_id` indexed audit_log column: re-deliveries of the
 * same event are recognised and acknowledged without re-running side
 * effects. Returns true if newly processed, false if already seen.
 */
export async function dispatchV1Event(
  event: Stripe.Event,
  ctx: DispatchContext,
): Promise<boolean> {
  const seen = await alreadyProcessed(event.id);
  if (seen) {
    ctx.log.info({ eventId: event.id, type: event.type }, "webhook: replay");
    return false;
  }

  ctx.log.info({ eventId: event.id, type: event.type }, "webhook: dispatching V1");

  switch (event.type) {
    case "invoice.paid":
      await handleInvoicePaid(event.data.object as Stripe.Invoice, ctx);
      break;
    case "invoice.finalized":
      await handleInvoiceFinalized(event.data.object as Stripe.Invoice, ctx);
      break;
    case "invoice.voided":
      await handleInvoiceVoided(event.data.object as Stripe.Invoice, ctx);
      break;
    case "transfer.reversed":
      // Transfer was reversed (e.g. as part of a refund flow). Log for
      // now; retry/refund handling lives in the refunds work item.
      ctx.log.warn(
        { eventId: event.id, transfer: (event.data.object as Stripe.Transfer).id },
        "webhook: transfer.reversed received",
      );
      break;
    default:
      ctx.log.info(
        { eventId: event.id, type: event.type },
        "webhook: V1 event type not handled (logged only)",
      );
      break;
  }

  await markProcessed(event.id, event.type, event.data.object);
  return true;
}

/**
 * Process a Stripe V2 thin event. The thin event only carries the id
 * and type; the full payload is fetched via stripe.v2.core.events.retrieve.
 */
export async function dispatchV2ThinEvent(
  thinEventId: string,
  thinEventType: string,
  ctx: DispatchContext,
): Promise<boolean> {
  const seen = await alreadyProcessed(thinEventId);
  if (seen) {
    ctx.log.info({ eventId: thinEventId, type: thinEventType }, "webhook: V2 replay");
    return false;
  }

  ctx.log.info(
    { eventId: thinEventId, type: thinEventType },
    "webhook: dispatching V2",
  );

  const stripe = getStripe();
  // V2 events.retrieve returns the thin event again (with metadata). The
  // related "data.object" lookup needs a separate fetch from the
  // resource type — for capability-status events, fetch the account.
  // For now, route by event type and fetch as needed.

  if (
    thinEventType ===
      "v2.core.account[configuration.recipient].capability_status_updated" ||
    thinEventType === "v2.core.account[requirements].updated"
  ) {
    // The thin event references an account id; fetch the full event
    // to read it.
    interface ThinEventBody {
      related_object?: { id?: string; type?: string };
    }
    let related: ThinEventBody | undefined;
    try {
      const fetched = (await stripe.v2.core.events.retrieve(
        thinEventId,
      )) as unknown as ThinEventBody;
      related = fetched;
    } catch (err) {
      ctx.log.error(
        { err, eventId: thinEventId },
        "webhook: V2 events.retrieve failed",
      );
      return false;
    }
    const accountId = related?.related_object?.id;
    if (!accountId) {
      ctx.log.warn(
        { eventId: thinEventId, type: thinEventType },
        "webhook: V2 event missing related_object.id",
      );
    } else {
      await handleAccountStatusUpdate(accountId, ctx);
    }
  } else {
    ctx.log.info(
      { eventId: thinEventId, type: thinEventType },
      "webhook: V2 event type not handled (logged only)",
    );
  }

  await markProcessed(thinEventId, thinEventType, { thinEventType });
  return true;
}

// ─── Idempotency helpers ────────────────────────────────────────────────────

async function alreadyProcessed(stripeEventId: string): Promise<boolean> {
  const rows = await db
    .select({ id: auditLogTable.id })
    .from(auditLogTable)
    .where(eq(auditLogTable.stripeEventId, stripeEventId))
    .limit(1);
  return rows.length > 0;
}

async function markProcessed(
  stripeEventId: string,
  eventType: string,
  payload: unknown,
): Promise<void> {
  // audit_log is append-only at the DB level; this is the canonical
  // record that we processed this Stripe event and shouldn't again.
  await db.insert(auditLogTable).values({
    action: "stripe_webhook_processed",
    entityType: "stripe_event",
    // Use a deterministic UUID for the entity id so re-delivery
    // doesn't double-insert. Fall back to a random uuid if hashing
    // produces something unusable.
    entityId: deterministicUuid(stripeEventId),
    stripeEventId,
    metadata: { eventType, payload: redactLargePayload(payload) },
  });
}

function deterministicUuid(input: string): string {
  // Convert any string to a UUID v4-shaped value via SHA-256.
  // We don't actually need true v4 entropy here — the entity_id is
  // an audit-log uniqueness handle. Slice + format into UUID layout.
  const hash = crypto.createHash("sha256").update(input).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function redactLargePayload(payload: unknown): unknown {
  // Stripe payloads can be large. Trim to a reasonable size for
  // audit_log.metadata while keeping the top-level identifying info.
  try {
    const json = JSON.stringify(payload);
    if (json.length < 8000) return payload;
    const obj = payload as Record<string, unknown>;
    return {
      id: obj?.id,
      object: obj?.object,
      _redacted: true,
      _originalLength: json.length,
    };
  } catch {
    return { _redacted: true, _reason: "non-serialisable" };
  }
}

// ─── V1 handlers ────────────────────────────────────────────────────────────

async function handleInvoicePaid(
  invoice: Stripe.Invoice,
  ctx: DispatchContext,
): Promise<void> {
  if (!invoice.id) return;
  const stripeChargeId =
    typeof (invoice as unknown as { charge?: string | null }).charge === "string"
      ? ((invoice as unknown as { charge?: string | null }).charge as string)
      : null;

  // Look up our local invoice row.
  const ourInvoiceRows = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.stripeInvoiceId, invoice.id))
    .limit(1);
  if (ourInvoiceRows.length === 0) {
    ctx.log.warn(
      { stripeInvoiceId: invoice.id },
      "webhook: invoice.paid for unknown local invoice",
    );
    return;
  }
  const ourInvoice = ourInvoiceRows[0];

  await db
    .update(invoicesTable)
    .set({
      status: "paid",
      paidAt: new Date(),
      stripeChargeId,
    })
    .where(eq(invoicesTable.id, ourInvoice.id));

  // Transition the gig status. balance invoice paid → balance_paid.
  // reservation invoice paid → only transition if currently in 'enquiry'
  // (don't downgrade later statuses).
  if (ourInvoice.invoiceType === "balance") {
    await db
      .update(gigsTable)
      .set({ status: "balance_paid" })
      .where(eq(gigsTable.id, ourInvoice.gigId));
  } else if (ourInvoice.invoiceType === "reservation") {
    const gigRows = await db
      .select({ status: gigsTable.status })
      .from(gigsTable)
      .where(eq(gigsTable.id, ourInvoice.gigId))
      .limit(1);
    if (gigRows[0]?.status === "enquiry") {
      await db
        .update(gigsTable)
        .set({ status: "reserved" })
        .where(eq(gigsTable.id, ourInvoice.gigId));
    }
  }

  // Auto-trigger transfers now that this invoice has a charge id.
  const transferResult = await createTransfersForGig(ourInvoice.gigId, ctx);
  if (!transferResult.ok) {
    ctx.log.warn(
      { reason: transferResult.reason, gigId: ourInvoice.gigId },
      "webhook: createTransfersForGig returned not-ok",
    );
  } else {
    ctx.log.info(
      {
        gigId: ourInvoice.gigId,
        transferCount: transferResult.transfers?.length ?? 0,
      },
      "webhook: transfers created",
    );
  }
}

async function handleInvoiceFinalized(
  invoice: Stripe.Invoice,
  _ctx: DispatchContext,
): Promise<void> {
  if (!invoice.id) return;
  await db
    .update(invoicesTable)
    .set({ status: "open", issuedAt: new Date() })
    .where(eq(invoicesTable.stripeInvoiceId, invoice.id));
}

async function handleInvoiceVoided(
  invoice: Stripe.Invoice,
  _ctx: DispatchContext,
): Promise<void> {
  if (!invoice.id) return;
  await db
    .update(invoicesTable)
    .set({ status: "void" })
    .where(eq(invoicesTable.stripeInvoiceId, invoice.id));
}

// ─── V2 handlers ────────────────────────────────────────────────────────────

async function handleAccountStatusUpdate(
  accountId: string,
  ctx: DispatchContext,
): Promise<void> {
  const stripe = getStripe();

  // Fetch the current full account state to determine status.
  // V2 accounts.retrieve returns a minimal payload by default;
  // configuration / requirements / identity must be opted into via
  // `include`. Without it `account.configuration` is null and the
  // capability path can't be read.
  let account: unknown;
  try {
    account = await stripe.v2.core.accounts.retrieve(accountId, {
      include: ["configuration.recipient", "requirements"],
    } as never);
  } catch (err) {
    ctx.log.error({ err, accountId }, "webhook: stripe v2 accounts.retrieve failed");
    return;
  }

  // Read recipient capability status. Account shape from Stripe SDK
  // has `configuration.recipient.capabilities.stripe_balance.stripe_transfers.status`.
  interface AccountWithCapabilities {
    configuration?: {
      recipient?: {
        capabilities?: {
          stripe_balance?: {
            stripe_transfers?: { status?: string };
          };
        };
      };
    };
    requirements?: {
      summary?: { type?: string };
    };
  }
  const acc = account as AccountWithCapabilities;
  const transferStatus =
    acc.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers
      ?.status;

  // Map Stripe capability status to our enum:
  //   active → active
  //   pending / restricted / disabled → suspended
  //   anything else → onboarding (still in flight)
  let mapped: "active" | "onboarding" | "suspended" = "onboarding";
  if (transferStatus === "active") mapped = "active";
  else if (
    transferStatus === "restricted" ||
    transferStatus === "disabled" ||
    transferStatus === "pending"
  )
    mapped = "suspended";

  // Look up local supplier and update.
  const updated = await db
    .update(suppliersTable)
    .set({
      stripeOnboardingStatus: mapped,
      stripeCapabilitiesJson: acc.configuration?.recipient?.capabilities ?? null,
    })
    .where(
      and(
        eq(suppliersTable.stripeAccountId, accountId),
      ),
    )
    .returning({ id: suppliersTable.id });

  if (updated.length === 0) {
    ctx.log.warn(
      { accountId },
      "webhook: V2 account update for unknown supplier",
    );
  } else {
    ctx.log.info(
      { accountId, supplierId: updated[0].id, mapped },
      "webhook: supplier onboarding status synced",
    );
  }
}
