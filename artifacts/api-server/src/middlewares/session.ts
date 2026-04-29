import session from "express-session";
import { RedisStore } from "connect-redis";
import type { RequestHandler } from "express";
import { getRedis } from "../lib/redis";
import { getEnv } from "../lib/env";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    userEmail?: string;
    csrfSecret?: string;
    // Set true by /api/csrf-token to force session persistence (otherwise
    // express-session's saveUninitialized:false would never set ck.sid).
    csrfBound?: boolean;
  }
}

export async function buildSessionMiddleware(): Promise<RequestHandler> {
  const env = getEnv();
  const client = await getRedis();

  const store = new RedisStore({
    client,
    prefix: "ck:sess:",
    ttl: 60 * 60 * 24 * 7, // 7 days in seconds
  });

  return session({
    store,
    name: "ck.sid",
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      // sameSite: "lax" is DELIBERATE (not "strict"). Magic-link auth requires
      // the user to click a link in their email client, which is a cross-site
      // top-level GET to /api/auth/verify. "strict" would strip the session
      // cookie on that navigation and break the entire auth flow. "lax"
      // sends the cookie on top-level GETs from any origin (safe — the
      // verify endpoint validates the single-use token, not just the session)
      // while still blocking it on cross-site POST/iframe/XHR requests.
      // CSRF protection covers state-changing requests separately.
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7,
      domain: env.COOKIE_DOMAIN,
      path: "/",
    },
  });
}
