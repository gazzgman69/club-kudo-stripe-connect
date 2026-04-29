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
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7,
      domain: env.COOKIE_DOMAIN,
      path: "/",
    },
  });
}
