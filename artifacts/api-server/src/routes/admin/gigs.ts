import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { z } from "zod";
import { eq, and, isNull, desc, sql, asc } from "drizzle-orm";
import {
  db,
  clientsTable,
  gigsTable,
  gigLineItemsTable,
  invoicesTable,
  platformSettingsTable,
  transfersTable,
} from "@workspace/db";
import { getStripe } from "../../lib/stripe";
import { createTransfersForGig } from "../../lib/transfer-service";
import { HttpError } from "../../middlewares/errorHandler";
import { requireAuth, requireRole } from "../../middlewares/auth";

// ─── Schemas ────────────────────────────────────────────────────────────────

const lineTypeEnum = z.enum([
  "dj_performance",
  "sax_performance",
  "equipment_hire",
  "booking_commission",
  "reservation_fee",
]);
const invoicePhaseEnum = z.enum(["reservation", "balance"]);

const lineItemSchema = z.object({
  description: z.string().min(1).max(500),
  lineType: lineTypeEnum,
  amountPence: z.number().int().positive(),
  vatRateBps: z.number().int().min(0).max(10000).default(0),
  isPlatformLine: z.boolean(),
  supplierId: z.string().uuid().nullable().optional(),
  invoicePhase: invoicePhaseEnum.default("balance"),
});

const createGigSchema = z
  .object({
    clientId: z.string().uuid(),
    eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    eventName: z.string().min(1).max(300),
    venue: z.string().max(300).optional(),
    notes: z.string().max(2000).optional(),
    balanceDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    cancellationPolicyApplied: z.string().optional(),
    lineItems: z.array(lineItemSchema).optional(),
  })
  .refine(
    (g) => {
      if (!g.lineItems) return true;
      return g.lineItems.every((li) => {
        if (li.isPlatformLine) return !li.supplierId;
        return !!li.supplierId;
      });
    },
    {
      message:
        "Each line item must have isPlatformLine XOR supplierId (platform lines have no supplier; supplier lines must have one)",
    },
  );

const updateGigSchema = z.object({
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  eventName: z.string().min(1).max(300).optional(),
  venue: z.string().max(300).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  balanceDueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  cancellationPolicyApplied: z.string().nullable().optional(),
});

const idParamSchema = z.object({ id: z.string().uuid() });
const lineItemIdParamSchema = z.object({
  id: z.string().uuid(),
  lineItemId: z.string().uuid(),
});

const listQuerySchema = z.object({
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(100))
    .optional()
    .default("25"),
  cursor: z.string().optional(),
});

// ─── Cursor helpers ─────────────────────────────────────────────────────────

interface CursorPayload {
  v: 1;
  k: string;
  id: string;
}
function encodeCursor(p: CursorPayload): string {
  return Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
}
function decodeCursor(raw: string): CursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new HttpError(400, "cursor_invalid", "Cursor could not be decoded");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { v?: unknown }).v !== 1 ||
    typeof (parsed as { k?: unknown }).k !== "string" ||
    typeof (parsed as { id?: unknown }).id !== "string"
  ) {
    throw new HttpError(400, "cursor_invalid", "Cursor schema unrecognised");
  }
  return parsed as CursorPayload;
}

// ─── Gig CRUD ───────────────────────────────────────────────────────────────

async function handleCreateGig(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let body: z.infer<typeof createGigSchema>;
  try {
    body = createGigSchema.parse(req.body);
  } catch (err) {
    return next(err);
  }

  // Verify client exists.
  const clientRow = await db
    .select({ id: clientsTable.id })
    .from(clientsTable)
    .where(
      and(
        eq(clientsTable.id, body.clientId),
        isNull(clientsTable.deletedAt),
      ),
    )
    .limit(1);
  if (clientRow.length === 0) {
    return next(
      new HttpError(404, "client_not_found", "Referenced client not found"),
    );
  }

  // Insert gig + any provided line items in a transaction so we don't
  // leave a half-built gig behind on a partial failure.
  const result = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(gigsTable)
      .values({
        clientId: body.clientId,
        eventDate: body.eventDate,
        eventName: body.eventName,
        venue: body.venue ?? null,
        notes: body.notes ?? null,
        balanceDueDate: body.balanceDueDate ?? null,
        cancellationPolicyApplied: body.cancellationPolicyApplied ?? null,
      })
      .returning();
    const gig = inserted[0];

    let lineItems: typeof gigLineItemsTable.$inferSelect[] = [];
    if (body.lineItems && body.lineItems.length > 0) {
      lineItems = await tx
        .insert(gigLineItemsTable)
        .values(
          body.lineItems.map((li) => ({
            gigId: gig.id,
            supplierId: li.isPlatformLine ? null : li.supplierId ?? null,
            description: li.description,
            lineType: li.lineType,
            amountPence: li.amountPence,
            vatRateBps: li.vatRateBps,
            isPlatformLine: li.isPlatformLine,
            invoicePhase: li.invoicePhase,
          })),
        )
        .returning();
    }

    return { gig, lineItems };
  });

  res.status(201).json(result);
}

async function handleListGigs(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let query: z.infer<typeof listQuerySchema>;
  try {
    query = listQuerySchema.parse(req.query);
  } catch (err) {
    return next(err);
  }
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const conditions = [isNull(gigsTable.deletedAt)];
  if (cursor) {
    conditions.push(
      sql`(${gigsTable.createdAt}, ${gigsTable.id}) < (${cursor.k}::timestamptz, ${cursor.id}::uuid)`,
    );
  }
  const rows = await db
    .select()
    .from(gigsTable)
    .where(and(...conditions))
    .orderBy(desc(gigsTable.createdAt), desc(gigsTable.id))
    .limit(query.limit + 1);
  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  const nextCursor =
    hasMore && items.length > 0
      ? encodeCursor({
          v: 1,
          k: items[items.length - 1].createdAt.toISOString(),
          id: items[items.length - 1].id,
        })
      : null;
  res.status(200).json({ items, nextCursor });
}

async function handleGetGig(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let params: z.infer<typeof idParamSchema>;
  try {
    params = idParamSchema.parse(req.params);
  } catch (err) {
    return next(err);
  }
  const gigRows = await db
    .select()
    .from(gigsTable)
    .where(
      and(eq(gigsTable.id, params.id), isNull(gigsTable.deletedAt)),
    )
    .limit(1);
  if (gigRows.length === 0) {
    return next(new HttpError(404, "gig_not_found", "Gig not found"));
  }
  const lineItems = await db
    .select()
    .from(gigLineItemsTable)
    .where(eq(gigLineItemsTable.gigId, params.id))
    .orderBy(asc(gigLineItemsTable.createdAt));
  res.status(200).json({ gig: gigRows[0], lineItems });
}

async function handleUpdateGig(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let params: z.infer<typeof idParamSchema>;
  let body: z.infer<typeof updateGigSchema>;
  try {
    params = idParamSchema.parse(req.params);
    body = updateGigSchema.parse(req.body);
  } catch (err) {
    return next(err);
  }
  if (Object.keys(body).length === 0) {
    return next(
      new HttpError(
        400,
        "no_fields_to_update",
        "PATCH body must contain at least one updatable field",
      ),
    );
  }
  const updated = await db
    .update(gigsTable)
    .set(body)
    .where(and(eq(gigsTable.id, params.id), isNull(gigsTable.deletedAt)))
    .returning();
  if (updated.length === 0) {
    return next(new HttpError(404, "gig_not_found", "Gig not found"));
  }
  res.status(200).json(updated[0]);
}

async function handleDeleteGig(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let params: z.infer<typeof idParamSchema>;
  try {
    params = idParamSchema.parse(req.params);
  } catch (err) {
    return next(err);
  }
  const updated = await db
    .update(gigsTable)
    .set({
      deletedAt: new Date(),
      deletedByUserId: req.session?.userId ?? null,
    })
    .where(and(eq(gigsTable.id, params.id), isNull(gigsTable.deletedAt)))
    .returning({ id: gigsTable.id });
  if (updated.length === 0) {
    return next(new HttpError(404, "gig_not_found", "Gig not found"));
  }
  res.status(204).end();
}

// ─── Line item add/patch/delete ─────────────────────────────────────────────

async function handleAddLineItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let params: z.infer<typeof idParamSchema>;
  let body: z.infer<typeof lineItemSchema>;
  try {
    params = idParamSchema.parse(req.params);
    body = lineItemSchema.parse(req.body);
  } catch (err) {
    return next(err);
  }
  // Verify XOR invariant at the API boundary; the DB also enforces it.
  if (body.isPlatformLine && body.supplierId) {
    return next(
      new HttpError(
        400,
        "platform_line_supplier_conflict",
        "Platform-lines must not carry a supplierId",
      ),
    );
  }
  if (!body.isPlatformLine && !body.supplierId) {
    return next(
      new HttpError(
        400,
        "supplier_line_missing_supplier",
        "Non-platform lines must carry a supplierId",
      ),
    );
  }

  // Verify gig exists.
  const gig = await db
    .select({ id: gigsTable.id })
    .from(gigsTable)
    .where(and(eq(gigsTable.id, params.id), isNull(gigsTable.deletedAt)))
    .limit(1);
  if (gig.length === 0) {
    return next(new HttpError(404, "gig_not_found", "Gig not found"));
  }

  const inserted = await db
    .insert(gigLineItemsTable)
    .values({
      gigId: params.id,
      supplierId: body.isPlatformLine ? null : body.supplierId ?? null,
      description: body.description,
      lineType: body.lineType,
      amountPence: body.amountPence,
      vatRateBps: body.vatRateBps,
      isPlatformLine: body.isPlatformLine,
      invoicePhase: body.invoicePhase,
    })
    .returning();
  res.status(201).json(inserted[0]);
}

const updateLineItemSchema = z.object({
  description: z.string().min(1).max(500).optional(),
  amountPence: z.number().int().positive().optional(),
  vatRateBps: z.number().int().min(0).max(10000).optional(),
  invoicePhase: invoicePhaseEnum.optional(),
});

async function handleUpdateLineItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let params: z.infer<typeof lineItemIdParamSchema>;
  let body: z.infer<typeof updateLineItemSchema>;
  try {
    params = lineItemIdParamSchema.parse(req.params);
    body = updateLineItemSchema.parse(req.body);
  } catch (err) {
    return next(err);
  }
  if (Object.keys(body).length === 0) {
    return next(
      new HttpError(
        400,
        "no_fields_to_update",
        "PATCH body must contain at least one updatable field",
      ),
    );
  }
  const updated = await db
    .update(gigLineItemsTable)
    .set(body)
    .where(
      and(
        eq(gigLineItemsTable.id, params.lineItemId),
        eq(gigLineItemsTable.gigId, params.id),
      ),
    )
    .returning();
  if (updated.length === 0) {
    return next(
      new HttpError(404, "line_item_not_found", "Line item not found"),
    );
  }
  res.status(200).json(updated[0]);
}

async function handleDeleteLineItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let params: z.infer<typeof lineItemIdParamSchema>;
  try {
    params = lineItemIdParamSchema.parse(req.params);
  } catch (err) {
    return next(err);
  }
  const deleted = await db
    .delete(gigLineItemsTable)
    .where(
      and(
        eq(gigLineItemsTable.id, params.lineItemId),
        eq(gigLineItemsTable.gigId, params.id),
      ),
    )
    .returning({ id: gigLineItemsTable.id });
  if (deleted.length === 0) {
    return next(
      new HttpError(404, "line_item_not_found", "Line item not found"),
    );
  }
  res.status(204).end();
}

// ─── Reservation invoice ────────────────────────────────────────────────────

/**
 * POST /api/admin/gigs/:id/reservation-invoice
 *
 * Composes a Stripe Invoicing invoice from the gig's line items where
 * `invoice_phase = 'reservation'`, finalises it, and sends it via
 * Stripe-hosted email to the client. Persists the resulting invoice
 * row in our `invoices` table and transitions the gig to `reserved`.
 *
 * Idempotent at the gig level: an existing reservation invoice with
 * a non-void status returns 409 rather than creating a second one.
 * If you need to retry, void the existing invoice in Stripe first
 * and our reconciliation will sync that back (Step 9 — webhooks).
 */
async function handleCreateReservationInvoice(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let params: z.infer<typeof idParamSchema>;
  try {
    params = idParamSchema.parse(req.params);
  } catch (err) {
    return next(err);
  }
  const stripe = getStripe();

  // Load gig + client + reservation-phase line items + platform settings.
  const gigRows = await db
    .select()
    .from(gigsTable)
    .where(and(eq(gigsTable.id, params.id), isNull(gigsTable.deletedAt)))
    .limit(1);
  if (gigRows.length === 0) {
    return next(new HttpError(404, "gig_not_found", "Gig not found"));
  }
  const gig = gigRows[0];

  const clientRows = await db
    .select()
    .from(clientsTable)
    .where(
      and(
        eq(clientsTable.id, gig.clientId),
        isNull(clientsTable.deletedAt),
      ),
    )
    .limit(1);
  if (clientRows.length === 0) {
    return next(
      new HttpError(404, "client_not_found", "Gig's client not found"),
    );
  }
  const client = clientRows[0];

  const lineItems = await db
    .select()
    .from(gigLineItemsTable)
    .where(
      and(
        eq(gigLineItemsTable.gigId, gig.id),
        eq(gigLineItemsTable.invoicePhase, "reservation"),
      ),
    );
  if (lineItems.length === 0) {
    return next(
      new HttpError(
        400,
        "no_reservation_lines",
        "Gig has no line items with invoice_phase = 'reservation'",
      ),
    );
  }

  // Reject if there's already a non-void reservation invoice.
  const existingInvoices = await db
    .select()
    .from(invoicesTable)
    .where(
      and(
        eq(invoicesTable.gigId, gig.id),
        eq(invoicesTable.invoiceType, "reservation"),
      ),
    );
  const blocking = existingInvoices.find((inv) => inv.status !== "void");
  if (blocking) {
    return next(
      new HttpError(
        409,
        "reservation_invoice_exists",
        `Gig already has a non-void reservation invoice (${blocking.id})`,
      ),
    );
  }

  const settingsRows = await db
    .select()
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.id, "singleton"))
    .limit(1);
  if (settingsRows.length === 0) {
    return next(
      new HttpError(
        500,
        "platform_settings_missing",
        "platform_settings singleton row not found",
      ),
    );
  }
  const settings = settingsRows[0];

  // Get-or-create the Stripe customer for this client.
  let stripeCustomerId = client.stripeCustomerId;
  try {
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: client.email,
        name: client.fullName,
        phone: client.phone ?? undefined,
        address: client.addressLines
          ? {
              line1: client.addressLines[0] ?? "",
              line2: client.addressLines[1],
              postal_code: client.postcode ?? undefined,
            }
          : undefined,
        metadata: { clientId: client.id },
      });
      stripeCustomerId = customer.id;
      await db
        .update(clientsTable)
        .set({ stripeCustomerId })
        .where(eq(clientsTable.id, client.id));
    }
  } catch (err) {
    req.log.error({ err, clientId: client.id }, "stripe customers.create failed");
    return next(
      new HttpError(
        502,
        "stripe_customer_create_failed",
        (err as Error).message,
      ),
    );
  }

  // Total amount on this invoice (gross of VAT).
  const totalPence = lineItems.reduce(
    (sum, li) =>
      sum + Math.round((li.amountPence * (10000 + li.vatRateBps)) / 10000),
    0,
  );

  // Create one invoice item per gig line, then finalize+send.
  // Days-until-due taken from settings; reservation invoices typically
  // want to be paid quickly, so we use a tighter window than the
  // settings default. Override here if you'd like.
  let stripeInvoiceId: string;
  let pdfUrl: string | undefined;
  try {
    for (const li of lineItems) {
      const grossPence = Math.round(
        (li.amountPence * (10000 + li.vatRateBps)) / 10000,
      );
      await stripe.invoiceItems.create({
        customer: stripeCustomerId,
        amount: grossPence,
        currency: settings.currency,
        description: li.description,
        metadata: {
          gigId: gig.id,
          gigLineItemId: li.id,
          vatRateBps: li.vatRateBps.toString(),
        },
      });
    }
    const stripeInvoice = await stripe.invoices.create({
      customer: stripeCustomerId,
      collection_method: "send_invoice",
      days_until_due: settings.defaultInvoicePaymentTermsDays,
      metadata: { gigId: gig.id, invoiceType: "reservation" },
      auto_advance: false,
    });
    if (!stripeInvoice.id) {
      throw new Error("Stripe invoice was created without an id");
    }
    const finalised = await stripe.invoices.finalizeInvoice(stripeInvoice.id);
    if (!finalised.id) {
      throw new Error("Stripe invoice finalize returned no id");
    }
    await stripe.invoices.sendInvoice(finalised.id);
    stripeInvoiceId = finalised.id;
    pdfUrl = finalised.invoice_pdf ?? undefined;
  } catch (err) {
    req.log.error({ err, gigId: gig.id }, "stripe invoice flow failed");
    return next(
      new HttpError(
        502,
        "stripe_invoice_flow_failed",
        (err as Error).message,
      ),
    );
  }

  // Persist locally + transition gig status.
  const persisted = await db.transaction(async (tx) => {
    const [invoice] = await tx
      .insert(invoicesTable)
      .values({
        gigId: gig.id,
        invoiceType: "reservation",
        stripeInvoiceId,
        status: "open",
        totalPence,
        currency: settings.currency,
        issuedAt: new Date(),
        pdfUrl: pdfUrl ?? null,
      })
      .returning();
    await tx
      .update(gigsTable)
      .set({ status: "reserved" })
      .where(eq(gigsTable.id, gig.id));
    return invoice;
  });

  res.status(201).json(persisted);
}

// ─── Balance invoice ────────────────────────────────────────────────────────

/**
 * POST /api/admin/gigs/:id/balance-invoice
 *
 * Mirror of the reservation invoice handler but filters
 * invoice_phase = 'balance'. Allowed when gig.status is 'reserved' or
 * 'lineup_confirmed'. Transitions gig to 'balance_invoiced'.
 *
 * Idempotent at the gig level: an existing non-void balance invoice
 * blocks re-issue with 409 (void it in Stripe first to retry).
 */
async function handleCreateBalanceInvoice(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let params: z.infer<typeof idParamSchema>;
  try {
    params = idParamSchema.parse(req.params);
  } catch (err) {
    return next(err);
  }
  const stripe = getStripe();

  const gigRows = await db
    .select()
    .from(gigsTable)
    .where(and(eq(gigsTable.id, params.id), isNull(gigsTable.deletedAt)))
    .limit(1);
  if (gigRows.length === 0) {
    return next(new HttpError(404, "gig_not_found", "Gig not found"));
  }
  const gig = gigRows[0];
  if (gig.status !== "reserved" && gig.status !== "lineup_confirmed") {
    return next(
      new HttpError(
        400,
        "gig_status_invalid",
        `Cannot send balance invoice when gig status is '${gig.status}' (need 'reserved' or 'lineup_confirmed')`,
      ),
    );
  }

  const clientRows = await db
    .select()
    .from(clientsTable)
    .where(
      and(
        eq(clientsTable.id, gig.clientId),
        isNull(clientsTable.deletedAt),
      ),
    )
    .limit(1);
  if (clientRows.length === 0) {
    return next(
      new HttpError(404, "client_not_found", "Gig's client not found"),
    );
  }
  const client = clientRows[0];

  const lineItems = await db
    .select()
    .from(gigLineItemsTable)
    .where(
      and(
        eq(gigLineItemsTable.gigId, gig.id),
        eq(gigLineItemsTable.invoicePhase, "balance"),
      ),
    );
  if (lineItems.length === 0) {
    return next(
      new HttpError(
        400,
        "no_balance_lines",
        "Gig has no line items with invoice_phase = 'balance'",
      ),
    );
  }

  const existing = await db
    .select()
    .from(invoicesTable)
    .where(
      and(
        eq(invoicesTable.gigId, gig.id),
        eq(invoicesTable.invoiceType, "balance"),
      ),
    );
  const blocking = existing.find((inv) => inv.status !== "void");
  if (blocking) {
    return next(
      new HttpError(
        409,
        "balance_invoice_exists",
        `Gig already has a non-void balance invoice (${blocking.id})`,
      ),
    );
  }

  const settingsRows = await db
    .select()
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.id, "singleton"))
    .limit(1);
  if (settingsRows.length === 0) {
    return next(
      new HttpError(
        500,
        "platform_settings_missing",
        "platform_settings singleton row not found",
      ),
    );
  }
  const settings = settingsRows[0];

  let stripeCustomerId = client.stripeCustomerId;
  try {
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: client.email,
        name: client.fullName,
        phone: client.phone ?? undefined,
        metadata: { clientId: client.id },
      });
      stripeCustomerId = customer.id;
      await db
        .update(clientsTable)
        .set({ stripeCustomerId })
        .where(eq(clientsTable.id, client.id));
    }
  } catch (err) {
    req.log.error({ err, clientId: client.id }, "stripe customers.create failed");
    return next(
      new HttpError(
        502,
        "stripe_customer_create_failed",
        (err as Error).message,
      ),
    );
  }

  const totalPence = lineItems.reduce(
    (sum, li) =>
      sum + Math.round((li.amountPence * (10000 + li.vatRateBps)) / 10000),
    0,
  );

  let stripeInvoiceId: string;
  let pdfUrl: string | undefined;
  try {
    for (const li of lineItems) {
      const grossPence = Math.round(
        (li.amountPence * (10000 + li.vatRateBps)) / 10000,
      );
      await stripe.invoiceItems.create({
        customer: stripeCustomerId,
        amount: grossPence,
        currency: settings.currency,
        description: li.description,
        metadata: {
          gigId: gig.id,
          gigLineItemId: li.id,
          vatRateBps: li.vatRateBps.toString(),
          ...(li.supplierId ? { supplierId: li.supplierId } : {}),
        },
      });
    }
    const stripeInvoice = await stripe.invoices.create({
      customer: stripeCustomerId,
      collection_method: "send_invoice",
      days_until_due: settings.defaultInvoicePaymentTermsDays,
      metadata: { gigId: gig.id, invoiceType: "balance" },
      auto_advance: false,
    });
    if (!stripeInvoice.id) {
      throw new Error("Stripe invoice was created without an id");
    }
    const finalised = await stripe.invoices.finalizeInvoice(stripeInvoice.id);
    if (!finalised.id) {
      throw new Error("Stripe invoice finalize returned no id");
    }
    await stripe.invoices.sendInvoice(finalised.id);
    stripeInvoiceId = finalised.id;
    pdfUrl = finalised.invoice_pdf ?? undefined;
  } catch (err) {
    req.log.error({ err, gigId: gig.id }, "stripe balance invoice flow failed");
    return next(
      new HttpError(
        502,
        "stripe_invoice_flow_failed",
        (err as Error).message,
      ),
    );
  }

  const persisted = await db.transaction(async (tx) => {
    const [invoice] = await tx
      .insert(invoicesTable)
      .values({
        gigId: gig.id,
        invoiceType: "balance",
        stripeInvoiceId,
        status: "open",
        totalPence,
        currency: settings.currency,
        issuedAt: new Date(),
        pdfUrl: pdfUrl ?? null,
      })
      .returning();
    await tx
      .update(gigsTable)
      .set({ status: "balance_invoiced" })
      .where(eq(gigsTable.id, gig.id));
    return invoice;
  });

  res.status(201).json(persisted);
}

// ─── Transfer scheduling ────────────────────────────────────────────────────

/**
 * POST /api/admin/gigs/:id/transfers
 *
 * Creates Stripe Transfers to each supplier's connected account for
 * every line item on every PAID invoice (reservation + balance) that
 * has an underlying Stripe charge_id. Each transfer carries
 * `source_transaction = <charge_id>` so funds are pulled from the
 * original platform charge (HMRC-defensible Separate Charges and
 * Transfers pattern).
 *
 * Idempotent per line item: if a transfer row already exists for a
 * given gig_line_item_id, it's skipped (and the existing row is
 * returned with `skipped: true`). Stripe-side idempotency uses a
 * `transfer-<line_item_id>-<uuid>` key passed via the
 * `Idempotency-Key` header so retries hit the same transfer.
 *
 * In Step 9 the V2 thin webhook handler will trigger this
 * automatically when an invoice transitions to paid. For now an
 * admin invokes it manually after marking the underlying invoice
 * paid in Stripe Test (or in production after the real charge
 * lands).
 */
async function handleCreateTransfers(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let params: z.infer<typeof idParamSchema>;
  try {
    params = idParamSchema.parse(req.params);
  } catch (err) {
    return next(err);
  }

  const result = await createTransfersForGig(params.id, { log: req.log });
  if (!result.ok) {
    if (result.reason === "gig_not_found") {
      return next(new HttpError(404, "gig_not_found", "Gig not found"));
    }
    if (result.reason === "no_paid_invoices") {
      return next(
        new HttpError(
          400,
          "no_paid_invoices",
          "Cannot create transfers — no invoice on this gig has a captured Stripe charge yet",
        ),
      );
    }
    if (result.reason === "settings_missing") {
      return next(
        new HttpError(
          500,
          "platform_settings_missing",
          "platform_settings singleton row not found",
        ),
      );
    }
    return next(new HttpError(500, "unknown", "Unexpected failure"));
  }

  res.status(200).json({
    transfers: (result.transfers ?? []).map((r) => ({
      ...r.transfer,
      ...(r.skipped ? { skipped: true } : {}),
    })),
  });
}

/**
 * GET /api/admin/gigs/:id/transfers
 *
 * Lists every Stripe Transfer attempted for this gig. Useful for
 * debugging transfer failures and seeing the audit trail of payouts.
 */
async function handleListTransfers(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let params: z.infer<typeof idParamSchema>;
  try {
    params = idParamSchema.parse(req.params);
  } catch (err) {
    return next(err);
  }
  const rows = await db
    .select()
    .from(transfersTable)
    .where(eq(transfersTable.gigId, params.id))
    .orderBy(asc(transfersTable.createdAt));
  res.status(200).json({ items: rows });
}

const router: IRouter = Router();
const gates = [requireAuth, requireRole("admin")] as const;

router.post("/admin/gigs", ...gates, handleCreateGig);
router.get("/admin/gigs", ...gates, handleListGigs);
router.get("/admin/gigs/:id", ...gates, handleGetGig);
router.patch("/admin/gigs/:id", ...gates, handleUpdateGig);
router.delete("/admin/gigs/:id", ...gates, handleDeleteGig);
router.post("/admin/gigs/:id/line-items", ...gates, handleAddLineItem);
router.patch(
  "/admin/gigs/:id/line-items/:lineItemId",
  ...gates,
  handleUpdateLineItem,
);
router.delete(
  "/admin/gigs/:id/line-items/:lineItemId",
  ...gates,
  handleDeleteLineItem,
);
router.post(
  "/admin/gigs/:id/reservation-invoice",
  ...gates,
  handleCreateReservationInvoice,
);
router.post(
  "/admin/gigs/:id/balance-invoice",
  ...gates,
  handleCreateBalanceInvoice,
);
router.post("/admin/gigs/:id/transfers", ...gates, handleCreateTransfers);
router.get("/admin/gigs/:id/transfers", ...gates, handleListTransfers);

export default router;
