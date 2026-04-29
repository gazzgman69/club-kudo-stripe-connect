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
import { buildGlobalRateLimiter } from "./middlewares/rateLimit";
import { csrfProtection } from "./middlewares/csrf";
import { errorHandler, notFoundHandler } from "./middlewares/errorHandler";

import router from "./routes";

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

  // NOTE: Body parsers are mounted on the API router below — NOT globally.
  // The Stripe webhook route mounts its own express.raw() so signature
  // verification gets the untouched bytes. Mount /api/webhooks BEFORE the
  // body parsers + CSRF below so it sees raw bytes and bypasses CSRF
  // (Stripe signs the request — that IS the auth).
  // app.use("/api/webhooks", webhooksRouter);  // added in Phase 1 Step 7

  app.use("/api", express.json({ limit: "1mb" }));
  app.use("/api", express.urlencoded({ extended: true, limit: "1mb" }));

  // CSRF: double-submit cookie pattern. Auto-bypasses GET/HEAD/OPTIONS,
  // so /api/healthz and /api/csrf-token (both GET) work without a token.
  // Every state-changing request must echo the token via x-csrf-token header.
  app.use("/api", csrfProtection);

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
