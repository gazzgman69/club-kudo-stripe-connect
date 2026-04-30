import type {
  Request,
  Response,
  NextFunction,
  RequestHandler,
  Send,
} from "express";
import { and, eq, gt } from "drizzle-orm";
import { db, idempotencyReplayTable } from "@workspace/db";
import { HttpError } from "./errorHandler";

// Methods that mutate state and therefore require an Idempotency-Key.
// GET/HEAD/OPTIONS bypass the middleware entirely.
const STATE_CHANGING_METHODS = new Set(["POST", "PATCH", "DELETE"]);

// 24-hour replay window. A separate cron job (Phase 1 Step 10) is expected
// to prune rows where `expires_at < now()`.
const TTL_MS = 24 * 60 * 60 * 1000;

// Strict UUID v4: third group starts with `4`, fourth group starts with
// `8|9|a|b` (the variant). Lowercase or uppercase hex.
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface CapturedResponse {
  statusCode: number;
  body: unknown;
}

/**
 * Idempotency middleware (Phase 1 Step 5a).
 *
 * Contract:
 *   - On POST/PATCH/DELETE, the client MUST send `Idempotency-Key: <UUID v4>`.
 *   - Same key + same path + same user (or both unauthenticated) within the
 *     TTL window → the cached 2xx response is replayed directly; the
 *     downstream handler is NOT invoked.
 *   - Same key + different path or user → 409 idempotency_key_collision.
 *   - First time the key is seen → handler runs as normal; on a 2xx response
 *     the response body and status are captured and persisted for replay.
 *     4xx/5xx responses are deliberately NOT cached so clients can correct
 *     a bad request and retry with the same key.
 *
 * This is the CLIENT-FACING idempotency system. It is distinct from the
 * server-to-Stripe idempotency keys stored in `transfers.stripe_idempotency_key`,
 * which protect our own retries against the Stripe API. The two systems
 * must not be conflated.
 *
 * Concurrency note: this implementation is best-effort. If two requests
 * with the same key arrive simultaneously, both may pass the existence
 * check and both will attempt the handler; only one INSERT will succeed
 * (PK conflict, swallowed via `onConflictDoNothing`). True mutex semantics
 * would require a Redis lock or DB advisory lock — defer to a future
 * hardening pass if observed in practice.
 */
export const idempotencyMiddleware: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!STATE_CHANGING_METHODS.has(req.method)) {
    return next();
  }

  const headerValue = req.headers["idempotency-key"];
  const key = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  if (!key) {
    return next(
      new HttpError(
        400,
        "idempotency_key_required",
        "Missing Idempotency-Key header on state-changing request",
      ),
    );
  }

  if (!UUID_V4_RE.test(key)) {
    return next(
      new HttpError(
        400,
        "idempotency_key_invalid",
        "Idempotency-Key must be a UUID v4",
      ),
    );
  }

  const userId = req.session?.userId ?? null;
  // Use originalUrl (minus query string) so the recorded path is the full
  // request path the client saw, not a router-mount-relative slice.
  const path = req.originalUrl.split("?")[0];

  let existing: typeof idempotencyReplayTable.$inferSelect | undefined;
  try {
    const rows = await db
      .select()
      .from(idempotencyReplayTable)
      .where(
        and(
          eq(idempotencyReplayTable.key, key),
          gt(idempotencyReplayTable.expiresAt, new Date()),
        ),
      )
      .limit(1);
    existing = rows[0];
  } catch (err) {
    return next(err);
  }

  if (existing) {
    const samePath = existing.path === path;
    const sameUser = (existing.userId ?? null) === userId;

    if (samePath && sameUser) {
      // Replay the cached 2xx response. Status was already validated as 2xx
      // before persistence, so no need to re-check here.
      res.status(existing.statusCode).json(existing.responseBody);
      return;
    }

    return next(
      new HttpError(
        409,
        "idempotency_key_collision",
        "Idempotency-Key has already been used for a different path or user",
      ),
    );
  }

  // No row yet. Wrap res.json AND res.send so we capture whichever the
  // downstream handler uses. Internally Express's res.json calls res.send,
  // so guard against double-capture.
  let captured: CapturedResponse | null = null;

  const originalJson = res.json.bind(res);
  res.json = function (body: unknown): Response {
    if (!captured) captured = { statusCode: res.statusCode, body };
    return originalJson(body);
  } as Response["json"];

  const originalSend = res.send.bind(res);
  res.send = function (body: unknown): Response {
    if (!captured) captured = { statusCode: res.statusCode, body };
    return originalSend(body);
  } as Send<unknown, Response>;

  res.on("finish", () => {
    if (!captured) return;
    if (captured.statusCode < 200 || captured.statusCode >= 300) return;

    void persistReplayRow({
      key,
      userId,
      path,
      method: req.method,
      statusCode: captured.statusCode,
      body: captured.body,
    }).catch((err) => {
      // Persistence failure must not break the response (already sent).
      // Surface to logs/Sentry but swallow so the response stays clean.
      req.log?.error(
        { err, idempotencyKey: key, path },
        "failed to persist idempotency replay row",
      );
    });
  });

  next();
};

interface PersistArgs {
  key: string;
  userId: string | null;
  path: string;
  method: string;
  statusCode: number;
  body: unknown;
}

async function persistReplayRow(args: PersistArgs): Promise<void> {
  await db
    .insert(idempotencyReplayTable)
    .values({
      key: args.key,
      userId: args.userId,
      path: args.path,
      method: args.method,
      statusCode: args.statusCode,
      // jsonb columns accept any JSON-serializable value.
      responseBody: args.body as Record<string, unknown>,
      expiresAt: new Date(Date.now() + TTL_MS),
    })
    .onConflictDoNothing({ target: idempotencyReplayTable.key });
}
