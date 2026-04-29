import { doubleCsrf } from "csrf-csrf";
import type { RequestHandler } from "express";
import { getEnv } from "../lib/env";

const env = getEnv();

const {
  generateCsrfToken,
  doubleCsrfProtection,
  invalidCsrfTokenError,
} = doubleCsrf({
  getSecret: () => env.SESSION_SECRET,
  getSessionIdentifier: (req) => req.sessionID ?? "",
  cookieName:
    env.NODE_ENV === "production" ? "__Host-ck.csrf" : "ck.csrf",
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
  },
  size: 32,
  getCsrfTokenFromRequest: (req) => {
    const headerToken = req.headers["x-csrf-token"];
    if (typeof headerToken === "string") return headerToken;
    if (req.body && typeof req.body === "object") {
      const bodyToken = (req.body as Record<string, unknown>)._csrf;
      if (typeof bodyToken === "string") return bodyToken;
    }
    return undefined;
  },
});

export const csrfProtection: RequestHandler = doubleCsrfProtection;
export { generateCsrfToken, invalidCsrfTokenError };
