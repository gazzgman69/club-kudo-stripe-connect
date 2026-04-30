import helmet from "helmet";
import type { RequestHandler } from "express";

// Tight default CSP for the API. The api-server emits JSON for almost
// every route; the one exception is /api/auth/verify, which sends a
// short HTML page with an inline meta-refresh and a one-line redirect
// script. That route overrides the CSP at response time (see auth.ts)
// so this default can stay lean.
//
// frame-ancestors 'none' blocks click-jacking via iframe.
// default-src 'none' is the safest possible default — every directive
// must be explicitly opt-in.
export const securityHeaders: RequestHandler = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      "default-src": ["'none'"],
      "frame-ancestors": ["'none'"],
      "base-uri": ["'none'"],
      "form-action": ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  // Frontend is served from a different origin in dev; API responses
  // need to be loadable cross-origin. In production with a same-origin
  // deploy, this can be tightened to "same-origin".
  crossOriginResourcePolicy: { policy: "cross-origin" },
  // Sane defaults from helmet remain for the rest:
  // - X-Content-Type-Options: nosniff
  // - X-Frame-Options: SAMEORIGIN (belt-and-braces with frame-ancestors)
  // - Strict-Transport-Security: max-age=15552000; includeSubDomains
  // - Referrer-Policy: no-referrer
  // - X-DNS-Prefetch-Control: off
});
