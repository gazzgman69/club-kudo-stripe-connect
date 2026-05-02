import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  db,
  invoicesTable,
  gigsTable,
  clientsTable,
  auditLogTable,
} from "@workspace/db";
import { HttpError } from "../../middlewares/errorHandler";
import { requireAuth, requireRole } from "../../middlewares/auth";

const listQuerySchema = z.object({
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(100))
    .optional()
    .default("25"),
  cursor: z.string().optional(),
  gigId: z.string().uuid().optional(),
  type: z.enum(["reservation", "balance", "self_billing"]).optional(),
  status: z
    .enum(["draft", "open", "paid", "void", "uncollectible"])
    .optional(),
});

const idParamSchema = z.object({ id: z.string().uuid() });

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

async function handleListInvoices(
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
  const conditions = [];
  if (query.gigId) conditions.push(eq(invoicesTable.gigId, query.gigId));
  if (query.type) conditions.push(eq(invoicesTable.invoiceType, query.type));
  if (query.status) conditions.push(eq(invoicesTable.status, query.status));
  if (cursor) {
    conditions.push(
      sql`(${invoicesTable.createdAt}, ${invoicesTable.id}) < (${cursor.k}::timestamptz, ${cursor.id}::uuid)`,
    );
  }

  const rows = await db
    .select({
      invoice: invoicesTable,
      gigName: gigsTable.eventName,
      clientName: clientsTable.fullName,
    })
    .from(invoicesTable)
    .leftJoin(gigsTable, eq(gigsTable.id, invoicesTable.gigId))
    .leftJoin(clientsTable, eq(clientsTable.id, gigsTable.clientId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(invoicesTable.createdAt), desc(invoicesTable.id))
    .limit(query.limit + 1);

  const hasMore = rows.length > query.limit;
  const itemsRaw = hasMore ? rows.slice(0, query.limit) : rows;
  const items = itemsRaw.map((r) => ({
    ...r.invoice,
    gigName: r.gigName,
    clientName: r.clientName,
  }));
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

async function handleGetInvoice(
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
    .select({
      invoice: invoicesTable,
      gigName: gigsTable.eventName,
      clientName: clientsTable.fullName,
      clientEmail: clientsTable.email,
    })
    .from(invoicesTable)
    .leftJoin(gigsTable, eq(gigsTable.id, invoicesTable.gigId))
    .leftJoin(clientsTable, eq(clientsTable.id, gigsTable.clientId))
    .where(eq(invoicesTable.id, params.id))
    .limit(1);

  if (rows.length === 0) {
    return next(
      new HttpError(404, "invoice_not_found", "Invoice not found"),
    );
  }

  const r = rows[0];
  res.status(200).json({
    ...r.invoice,
    gigName: r.gigName,
    clientName: r.clientName,
    clientEmail: r.clientEmail,
  });
}

/**
 * POST /api/admin/invoices/:id/force-void
 *
 * Mark a local invoice row as `void` without touching Stripe.
 *
 * Use case: an orphaned local row whose Stripe-side state can't be
 * reconciled through the normal `invoice.voided` webhook path. Most
 * commonly: a £0 invoice that Stripe auto-finalised and auto-marked as
 * paid before our line items were attached, leaving the gig's
 * reservation-invoice guard locked locally.
 *
 * Safety rails:
 *  - Refuses if the row is already `void`
 *  - Refuses if status is `paid` AND `paidAt` is set (real money was
 *    reconciled - a force-void here would mask a real charge)
 *  - Requires a non-empty `reason` in the body so the audit trail
 *    captures why this lever was pulled
 *  - Wraps the row update and audit insert in a single transaction
 */
async function handleForceVoidInvoice(
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

  const bodySchema = z.object({ reason: z.string().min(1).max(500) });
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(req.body ?? {});
  } catch (err) {
    return next(err);
  }

  const before = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, params.id))
    .limit(1);

  if (before.length === 0) {
    return next(new HttpError(404, "invoice_not_found", "Invoice not found"));
  }

  const current = before[0];
  if (current.status === "void") {
    return next(
      new HttpError(409, "invoice_already_void", "Invoice is already void"),
    );
  }
  if (current.status === "paid" && current.paidAt !== null) {
    return next(
      new HttpError(
        409,
        "invoice_paid_reconciled",
        "Refusing to void a paid invoice with a paid_at timestamp",
      ),
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .update(invoicesTable)
      .set({ status: "void" })
      .where(eq(invoicesTable.id, params.id));

    await tx.insert(auditLogTable).values({
      action: "admin.invoice.force_voided",
      entityType: "invoice",
      entityId: params.id,
      actorUserId: req.session?.userId ?? null,
      beforeState: { status: current.status, paidAt: current.paidAt },
      afterState: { status: "void" },
      metadata: { reason: body.reason },
    });
  });

  const after = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, params.id))
    .limit(1);

  res.status(200).json(after[0]);
}

const router: IRouter = Router();
const gates = [requireAuth, requireRole("admin")] as const;
router.get("/admin/invoices", ...gates, handleListInvoices);
router.get("/admin/invoices/:id", ...gates, handleGetInvoice);
router.post(
  "/admin/invoices/:id/force-void",
  ...gates,
  handleForceVoidInvoice,
);

export default router;
