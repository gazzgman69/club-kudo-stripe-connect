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
import clientsRouter from "./routes/admin/clients";
import gigsRouter from "./routes/admin/gigs";
import platformSettingsRouter from "./routes/admin/platform-settings";
import stripeWebhookRouter from "./routes/webhooks/stripe";

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

  // ─── Stripe webhooks (Phase 1 Step 9) ───
  // Mounted at "/" so Express dispatches the absolute /api/webhooks/stripe
  // path correctly — mounting at /api/webhooks/stripe with a router-internal
  // POST "/" hits Express 5's trailing-slash trap. Mounted BEFORE the
  // global rate limiter (Stripe burst traffic mustn't be throttled),
  // BEFORE the global JSON parser (signature verification needs raw bytes
  // — the route's express.raw middleware does this route-locally), and
  // BEFORE csrfProtection (Stripe is server-to-server, the webhook
  // signature IS the auth). Handler always sends a response, never
  // calls next(), so subsequent middleware is skipped for matched
  // requests.
  app.use(stripeWebhookRouter);

  // 7. Global rate limit (Redis-backed) — applied AFTER session so it can key by user later
  app.use(await buildGlobalRateLimiter());

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

  // Admin: suppliers (Phase 1 Step 6) + clients + gigs + platform
  // settings (Phase 1 Step 7). All routers mount at /api with
  // absolute paths internally and apply requireAuth + requireRole
  // inline per-route.
  app.use("/api", suppliersRouter);
  app.use("/api", clientsRouter);
  app.use("/api", gigsRouter);
  app.use("/api", platformSettingsRouter);

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
