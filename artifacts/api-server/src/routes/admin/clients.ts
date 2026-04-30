import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { z } from "zod";
import { eq, and, isNull, sql, desc } from "drizzle-orm";
import { db, clientsTable } from "@workspace/db";
import { HttpError } from "../../middlewares/errorHandler";
import { requireAuth, requireRole } from "../../middlewares/auth";

// ─── Schemas ────────────────────────────────────────────────────────────────

const createClientSchema = z.object({
  fullName: z.string().min(1).max(200),
  email: z.string().email().toLowerCase().trim(),
  phone: z.string().max(50).optional(),
  addressLines: z.array(z.string().min(1)).max(6).optional(),
  postcode: z.string().max(20).optional(),
  notes: z.string().max(2000).optional(),
});

const updateClientSchema = createClientSchema.partial();

const idParamSchema = z.object({ id: z.string().uuid() });

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

// ─── Cursor helpers (shared shape with suppliers) ───────────────────────────

interface CursorPayload {
  v: 1;
  k: string;
  id: string;
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
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

// ─── Handlers ───────────────────────────────────────────────────────────────

async function handleCreateClient(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let body: z.infer<typeof createClientSchema>;
  try {
    body = createClientSchema.parse(req.body);
  } catch (err) {
    return next(err);
  }
  const inserted = await db
    .insert(clientsTable)
    .values({
      fullName: body.fullName,
      email: body.email,
      phone: body.phone ?? null,
      addressLines: body.addressLines ?? null,
      postcode: body.postcode ?? null,
      notes: body.notes ?? null,
    })
    .returning();
  res.status(201).json(inserted[0]);
}

async function handleListClients(
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
  const conditions = [isNull(clientsTable.deletedAt)];
  if (cursor) {
    conditions.push(
      sql`(${clientsTable.createdAt}, ${clientsTable.id}) < (${cursor.k}::timestamptz, ${cursor.id}::uuid)`,
    );
  }
  const rows = await db
    .select()
    .from(clientsTable)
    .where(and(...conditions))
    .orderBy(desc(clientsTable.createdAt), desc(clientsTable.id))
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

async function handleGetClient(
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
    .from(clientsTable)
    .where(
      and(eq(clientsTable.id, params.id), isNull(clientsTable.deletedAt)),
    )
    .limit(1);
  if (rows.length === 0) {
    return next(new HttpError(404, "client_not_found", "Client not found"));
  }
  res.status(200).json(rows[0]);
}

async function handleUpdateClient(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let params: z.infer<typeof idParamSchema>;
  let body: z.infer<typeof updateClientSchema>;
  try {
    params = idParamSchema.parse(req.params);
    body = updateClientSchema.parse(req.body);
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
    .update(clientsTable)
    .set(body)
    .where(
      and(eq(clientsTable.id, params.id), isNull(clientsTable.deletedAt)),
    )
    .returning();
  if (updated.length === 0) {
    return next(new HttpError(404, "client_not_found", "Client not found"));
  }
  res.status(200).json(updated[0]);
}

async function handleDeleteClient(
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
    .update(clientsTable)
    .set({
      deletedAt: new Date(),
      deletedByUserId: req.session?.userId ?? null,
    })
    .where(
      and(eq(clientsTable.id, params.id), isNull(clientsTable.deletedAt)),
    )
    .returning({ id: clientsTable.id });
  if (updated.length === 0) {
    return next(new HttpError(404, "client_not_found", "Client not found"));
  }
  res.status(204).end();
}

const router: IRouter = Router();
const gates = [requireAuth, requireRole("admin")] as const;

router.post("/admin/clients", ...gates, handleCreateClient);
router.get("/admin/clients", ...gates, handleListClients);
router.get("/admin/clients/:id", ...gates, handleGetClient);
router.patch("/admin/clients/:id", ...gates, handleUpdateClient);
router.delete("/admin/clients/:id", ...gates, handleDeleteClient);

export default router;
