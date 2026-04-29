import helmet from "helmet";
import type { RequestHandler } from "express";

export const securityHeaders: RequestHandler = helmet({
  contentSecurityPolicy: false, // API server only — no HTML rendered
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
});
