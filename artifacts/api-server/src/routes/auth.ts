import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import crypto from "node:crypto";
import { eq, and, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  usersTable,
  userRolesTable,
  magicLinkTokensTable,
} from "@workspace/db";
import { getEnv } from "../lib/env";
import { sendMagicLinkEmail } from "../lib/email";
import { HttpError } from "../middlewares/errorHandler";

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes per HANDOVER spec.
// Minimum response time for /auth/magic-link. The variable parts (DB
// lookup, token insert, Resend send) all complete well below this in
// practice; we sleep until this floor so an attacker can't tell from
// timing alone whether the email exists or not.
const MAGIC_LINK_MIN_RESPONSE_MS = 800;

// ─── Schemas ─────────────────────────────────────────────────────────────────

const requestMagicLinkBody = z.object({
  email: z.string().email().toLowerCase().trim(),
});

const verifyTokenQuery = z.object({
  token: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "token must be a 64-char hex string"),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateMagicLinkToken(): { plain: string; hash: string } {
  const plain = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(plain).digest("hex");
  return { plain, hash };
}

function hashToken(plain: string): string {
  return crypto.createHash("sha256").update(plain).digest("hex");
}

function buildMagicLinkUrl(req: Request, tokenPlain: string): string {
  const env = getEnv();
  const base =
    env.APP_BASE_URL ?? `${req.protocol}://${req.get("host") ?? "localhost"}`;
  return `${base}/api/auth/verify?token=${tokenPlain}`;
}

async function sleepUntil(startedAt: number, floorMs: number): Promise<void> {
  const elapsed = Date.now() - startedAt;
  if (elapsed < floorMs) {
    await new Promise((r) => setTimeout(r, floorMs - elapsed));
  }
}

// ─── Handlers ────────────────────────────────────────────────────────────────

/**
 * POST /auth/magic-link
 * Body: { email: string }
 *
 * Issues a magic link via email. Anti-enumeration: always returns 200
 * with the same generic body regardless of whether the email matches a
 * known user, AND uses a fixed minimum response time so timing alone
 * doesn't leak the lookup result.
 *
 * Side effects (real path only):
 *   - Inserts a magic_link_tokens row with sha256(token) hash.
 *   - Sends an email via Resend containing the plaintext token.
 */
async function handleRequestMagicLink(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const startedAt = Date.now();
  let body: z.infer<typeof requestMagicLinkBody>;
  try {
    body = requestMagicLinkBody.parse(req.body);
  } catch (err) {
    return next(err); // ZodError → 400 via errorHandler
  }

  try {
    const users = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, body.email))
      .limit(1);

    if (users.length > 0) {
      const user = users[0];
      const { plain, hash } = generateMagicLinkToken();
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

      await db.insert(magicLinkTokensTable).values({
        userId: user.id,
        tokenHash: hash,
        expiresAt,
      });

      const magicLink = buildMagicLinkUrl(req, plain);

      try {
        await sendMagicLinkEmail({ toEmail: user.email, magicLink });
      } catch (sendErr) {
        // Don't surface to the caller; anti-enumeration response is
        // identical for known and unknown emails. Log so we can find it.
        req.log.error(
          { err: sendErr, userId: user.id },
          "magic-link: email send failed",
        );
      }
    } else {
      // Dummy work so the unknown-email branch still does something
      // similar in shape. The constant-time floor below is the real
      // defence; this just avoids a glaring per-byte difference.
      generateMagicLinkToken();
    }
  } catch (dbErr) {
    // DB failure: still return generic success after the floor wait,
    // log the error. We deliberately don't 500 here because it would
    // tell an enumerator that something interesting happened.
    req.log.error({ err: dbErr }, "magic-link: db lookup failed");
  }

  await sleepUntil(startedAt, MAGIC_LINK_MIN_RESPONSE_MS);

  res.status(200).json({
    ok: true,
    message: "If that email is registered, a sign-in link is on the way.",
  });
}

/**
 * GET /auth/verify?token=<64 hex chars>
 *
 * Validates a magic-link token, marks it consumed, and starts a session.
 * Returns JSON for now; a future iteration may redirect to APP_BASE_URL
 * once the frontend is ready to receive the post-login state.
 */
async function handleVerifyToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let query: z.infer<typeof verifyTokenQuery>;
  try {
    query = verifyTokenQuery.parse(req.query);
  } catch (err) {
    return next(err);
  }

  const tokenHash = hashToken(query.token);
  const now = new Date();

  const rows = await db
    .select({
      tokenId: magicLinkTokensTable.id,
      userId: magicLinkTokensTable.userId,
      userEmail: usersTable.email,
    })
    .from(magicLinkTokensTable)
    .innerJoin(usersTable, eq(usersTable.id, magicLinkTokensTable.userId))
    .where(
      and(
        eq(magicLinkTokensTable.tokenHash, tokenHash),
        gt(magicLinkTokensTable.expiresAt, now),
        isNull(magicLinkTokensTable.usedAt),
      ),
    )
    .limit(1);

  if (rows.length === 0) {
    return next(
      new HttpError(
        401,
        "magic_link_invalid",
        "Magic link is invalid, expired, or already used",
      ),
    );
  }

  const { tokenId, userId, userEmail } = rows[0];

  // Mark consumed atomically. If the UPDATE matches zero rows (someone
  // raced us between SELECT and UPDATE), reject the verification —
  // single-use enforcement matters for replay protection.
  const updated = await db
    .update(magicLinkTokensTable)
    .set({ usedAt: now })
    .where(
      and(
        eq(magicLinkTokensTable.id, tokenId),
        isNull(magicLinkTokensTable.usedAt),
      ),
    )
    .returning({ id: magicLinkTokensTable.id });

  if (updated.length === 0) {
    return next(
      new HttpError(
        401,
        "magic_link_invalid",
        "Magic link is invalid, expired, or already used",
      ),
    );
  }

  // Establish session. express-session writes the cookie on response
  // (session.save is implicit at end of request unless we mutate after).
  req.session.userId = userId;
  req.session.userEmail = userEmail;

  // Default: redirect to the admin app so email-link clicks land
  // somewhere visible. Opt out via `?format=json` (used by the
  // /auth-verify React splash, by tests, by curl).
  const wantsJson =
    typeof req.query.format === "string"
      ? req.query.format === "json"
      : (req.headers.accept ?? "")
          .toString()
          .toLowerCase()
          .startsWith("application/json");
  if (!wantsJson) {
    res.redirect(302, "/admin?signed_in=1");
    return;
  }
  res.status(200).json({
    ok: true,
    user: { id: userId, email: userEmail },
  });
}

/**
 * GET /auth/me
 *
 * Returns the signed-in user plus their granted roles. 401 when the
 * session has no userId. Useful for the admin UI's session-bootstrap
 * call on page load.
 */
async function handleGetMe(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.session?.userId;
  if (!userId) {
    return next(
      new HttpError(401, "unauthorized", "Not signed in"),
    );
  }

  const userRows = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      displayName: usersTable.displayName,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (userRows.length === 0) {
    // Session points at a user that no longer exists. Treat as 401
    // and clear the dangling session so subsequent calls don't loop.
    req.session.destroy(() => {});
    return next(
      new HttpError(401, "unauthorized", "Session user no longer exists"),
    );
  }

  const roleRows = await db
    .select({ role: userRolesTable.role })
    .from(userRolesTable)
    .where(eq(userRolesTable.userId, userId));

  res.status(200).json({
    user: userRows[0],
    roles: roleRows.map((r) => r.role),
  });
}

/**
 * POST /auth/logout
 *
 * Destroys the session and clears the cookie. Idempotent: returns 204
 * regardless of whether a session was present, so a logged-out user
 * hitting it again gets the same response.
 */
async function handleLogout(req: Request, res: Response): Promise<void> {
  if (!req.session) {
    res.status(204).end();
    return;
  }

  await new Promise<void>((resolve) => {
    req.session.destroy((err) => {
      if (err) {
        // Log but continue — we still want to clear the cookie.
        req.log.warn({ err }, "session destroy failed");
      }
      resolve();
    });
  });

  // express-session sets the cookie name on the session middleware
  // config; mirror it here. The session middleware uses "ck.sid".
  res.clearCookie("ck.sid", { path: "/" });
  res.status(204).end();
}

const router: IRouter = Router();
router.post("/auth/magic-link", handleRequestMagicLink);
router.get("/auth/verify", handleVerifyToken);
router.get("/auth/me", handleGetMe);
router.post("/auth/logout", handleLogout);

export default router;
