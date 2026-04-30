import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";

import { logger } from "./lib/logger";
import { getEnv } from "./lib/env";
import { Sentry } from "./lib/sentry";

import { requestId } from "./middlewares/requestId";
import { securityHeaders } from "./middlewares/security";
import { corsMiddleware } from "./middlewares/cors";
import { buildSessionMiddleware } from "./middlewares/session";
import {
  buildGlobalRateLimiter,
  buildAuthRateLimiter,
  buildAuthEmailRateLimiter,
} from "./middlewares/rateLimit";
import { csrfProtection } from "./middlewares/csrf";
import { idempotencyMiddleware } from "./middlewares/idempotency";
import { errorHandler, notFoundHandler } from "./middlewares/errorHandler";

import router from "./routes";
import adminRouter from "./routes/admin";
import authRouter from "./routes/auth";
import suppliersRouter from "./routes/admin/suppliers";

export async function buildApp(): Promise<Express> {
  const env = getEnv();
  const app: Express = express();

  // Trust the Replit proxy so secure cookies and X-Forwarded-* are honoured
  app.set("trust proxy", 1);

  // 1. Request correlation: assign req.id BEFORE logger so it's in every log line
  app.use(requestId);

  // 2. Structured request logging
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).id,
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url?.split("?")[0],
          };
        },
        res(res) {
          return { statusCode: res.statusCode };
        },
      },
    }),
  );

  // 3. Security headers
  app.use(securityHeaders);

  // 4. CORS (locked to allowlist in production)
  app.use(corsMiddleware());

  // 5. Cookies (must come before session and CSRF)
  app.use(cookieParser());

  // 6. Sessions (Redis-backed)
  app.use(await buildSessionMiddleware());

  // 7. Global rate limit (Redis-backed) — applied AFTER session so it can key by user later
  app.use(await buildGlobalRateLimiter());

  // ─── Stripe webhooks: ALL FOUR constraints below MUST hold (Phase 1 Step 9) ───
  // 1. Mounted BEFORE the global JSON body parser below — Stripe signature
  //    verification needs the untouched raw bytes; any prior parsing breaks it.
  // 2. The route handler must use `express.raw({ type: "application/json" })`
  //    at the route level so only this endpoint sees raw bytes.
  // 3. Must be mounted BEFORE `csrfProtection` — Stripe is server-to-server
  //    and never sends a CSRF token; the webhook signature IS the auth.
  // 4. Must NOT inherit the global rate limiter — Stripe can burst hundreds
  //    of events. Mount `/api/webhooks` BEFORE the global limiter, OR apply
  //    a dedicated webhook limiter sized for Stripe's traffic profile.
  //
  // Example wiring (Step 9):
  //   app.use("/api/webhooks/stripe",
  //     express.raw({ type: "application/json" }),
  //     stripeWebhookRouter);
  //
  // Currently the global rate limiter IS mounted above this point, so when
  // Step 9 adds the webhook router it must be moved above the rate limiter
  // (and the Step 9 PR description must call this out).

  app.use("/api", express.json({ limit: "1mb" }));
  app.use("/api", express.urlencoded({ extended: true, limit: "1mb" }));

  // Admin reload endpoint (server-to-server, secret-gated). Mounted
  // BEFORE CSRF and idempotency because it is called by curl from
  // outside the browser session — no CSRF token, no Idempotency-Key.
  // Auth is via the RELOAD_SECRET env var checked inside the handler.
  app.use("/api", adminRouter);

  // Public auth routes (Phase 1 Step 5b/5c). Mounted BEFORE
  // csrfProtection because the user has no session yet to bind a CSRF
  // token to — they're trying to start one. Mounted BEFORE
  // idempotencyMiddleware for the same reason: requiring
  // Idempotency-Key on a sign-in form is unnecessary friction.
  //
  // /auth/magic-link gets two extra rate limiters layered on top
  // (Phase 1 Step 5d). Per-IP catches naive volume attacks; per-email
  // catches distributed attacks targeting a single mailbox.
  const authIpLimiter = await buildAuthRateLimiter();
  const authEmailLimiter = await buildAuthEmailRateLimiter();
  app.post(
    "/api/auth/magic-link",
    authIpLimiter,
    authEmailLimiter,
    (_req, _res, next) => next(),
  );
  app.use("/api", authRouter);

  // CSRF: double-submit cookie pattern. Auto-bypasses GET/HEAD/OPTIONS,
  // so /api/healthz and /api/csrf-token (both GET) work without a token.
  // Every state-changing request must echo the token via x-csrf-token header.
  app.use("/api", csrfProtection);

  // Idempotency: on POST/PATCH/DELETE, requires a UUID v4 Idempotency-Key
  // header. Replays the cached 2xx response if the same key+path+user has
  // been seen within the TTL. Mounted AFTER csrfProtection so failed CSRF
  // requests don't waste a DB lookup.
  app.use("/api", idempotencyMiddleware);

  // Admin: suppliers (Phase 1 Step 6). Mounted at /api; the router
  // applies requireAuth + requireRole("admin") internally, and uses
  // absolute paths (/admin/suppliers/*) matching the adminRouter
  // pattern.
  app.use("/api", suppliersRouter);

  app.use("/api", router);

  // 404 for unmatched routes
  app.use(notFoundHandler);

  // Sentry error handler must come BEFORE our error handler so it captures everything
  if (env.SENTRY_DSN) {
    Sentry.setupExpressErrorHandler(app);
  }

  // Centralised error handler — must be the last middleware
  app.use(errorHandler);

  return app;
}
