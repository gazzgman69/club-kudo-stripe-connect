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

const router: IRouter = Router();
const gates = [requireAuth, requireRole("admin")] as const;
router.get("/admin/invoices", ...gates, handleListInvoices);
router.get("/admin/invoices/:id", ...gates, handleGetInvoice);

export default router;
