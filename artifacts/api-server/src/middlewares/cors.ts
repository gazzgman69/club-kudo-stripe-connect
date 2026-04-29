import cors from "cors";
import type { RequestHandler } from "express";
import { getEnv } from "../lib/env";

export function corsMiddleware(): RequestHandler {
  const env = getEnv();
  const allowed = new Set(env.CORS_ALLOWED_ORIGINS);
  // Always allow the dev domain so the workspace preview can hit the API
  const replitDevDomain = process.env.REPLIT_DEV_DOMAIN;
  if (replitDevDomain) {
    allowed.add(`https://${replitDevDomain}`);
  }

  return cors({
    origin: (origin, callback) => {
      // Same-origin / curl / server-to-server have no Origin header — allow
      if (!origin) return callback(null, true);
      if (allowed.size === 0) {
        // No explicit allowlist configured: in dev allow all, in prod deny.
        if (env.NODE_ENV !== "production") return callback(null, true);
        return callback(new Error(`CORS: origin ${origin} not allowed`));
      }
      if (allowed.has(origin)) return callback(null, true);
      return callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Request-Id",
      "X-CSRF-Token",
    ],
    exposedHeaders: ["X-Request-Id"],
  });
}
