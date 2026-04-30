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

  res.status(200).json({
    ok: true,
    user: { id: userId, email: userEmail },
  });
}

const router: IRouter = Router();
router.post("/auth/magic-link", handleRequestMagicLink);
router.get("/auth/verify", handleVerifyToken);

export default router;
