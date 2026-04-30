import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, auditLogTable, usersTable } from "@workspace/db";
import { HttpError } from "../../middlewares/errorHandler";
import { requireAuth, requireRole } from "../../middlewares/auth";

const listQuerySchema = z.object({
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(200))
    .optional()
    .default("50"),
  cursor: z.string().optional(),
  entityType: z.string().max(80).optional(),
  entityId: z.string().uuid().optional(),
  action: z.string().max(120).optional(),
  actorUserId: z.string().uuid().optional(),
  stripeEventId: z.string().max(120).optional(),
});

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

async function handleListAuditLog(
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
  if (query.entityType)
    conditions.push(eq(auditLogTable.entityType, query.entityType));
  if (query.entityId)
    conditions.push(eq(auditLogTable.entityId, query.entityId));
  if (query.action) conditions.push(eq(auditLogTable.action, query.action));
  if (query.actorUserId)
    conditions.push(eq(auditLogTable.actorUserId, query.actorUserId));
  if (query.stripeEventId)
    conditions.push(eq(auditLogTable.stripeEventId, query.stripeEventId));
  if (cursor) {
    conditions.push(
      sql`(${auditLogTable.timestamp}, ${auditLogTable.id}) < (${cursor.k}::timestamptz, ${cursor.id}::uuid)`,
    );
  }

  const rows = await db
    .select({
      entry: auditLogTable,
      actorEmail: usersTable.email,
    })
    .from(auditLogTable)
    .leftJoin(usersTable, eq(usersTable.id, auditLogTable.actorUserId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditLogTable.timestamp), desc(auditLogTable.id))
    .limit(query.limit + 1);

  const hasMore = rows.length > query.limit;
  const itemsRaw = hasMore ? rows.slice(0, query.limit) : rows;
  const items = itemsRaw.map((r) => ({
    ...r.entry,
    actorEmail: r.actorEmail,
  }));
  const nextCursor =
    hasMore && items.length > 0
      ? encodeCursor({
          v: 1,
          k: items[items.length - 1].timestamp.toISOString(),
          id: items[items.length - 1].id,
        })
      : null;

  res.status(200).json({ items, nextCursor });
}

const router: IRouter = Router();
const gates = [requireAuth, requireRole("admin")] as const;
router.get("/admin/audit-log", ...gates, handleListAuditLog);

export default router;
