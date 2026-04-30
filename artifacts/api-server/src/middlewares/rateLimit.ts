import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import { getRedis } from "../lib/redis";
import { getEnv } from "../lib/env";

export async function buildGlobalRateLimiter(): Promise<RateLimitRequestHandler> {
  const env = getEnv();
  const client = await getRedis();

  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: env.RATE_LIMIT_MAX,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    store: new RedisStore({
      sendCommand: (...args: string[]) =>
        client.sendCommand(args) as Promise<RedisReply>,
      prefix: "ck:rl:global:",
    }),
  });
}

export async function buildAuthRateLimiter(): Promise<RateLimitRequestHandler> {
  const client = await getRedis();
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 10, // tight: 10 magic-link requests per IP per 15 min
    standardHeaders: "draft-7",
    legacyHeaders: false,
    store: new RedisStore({
      sendCommand: (...args: string[]) =>
        client.sendCommand(args) as Promise<RedisReply>,
      prefix: "ck:rl:auth-ip:",
    }),
  });
}

/**
 * Per-email rate limiter for /auth/magic-link. Defends against an
 * attacker spamming a known address with sign-in requests from many
 * IPs (which the per-IP limiter wouldn't catch). 3 requests per email
 * per 15 min is generous for a real human ("oops, didn't get the
 * link, try again") but blocks abuse.
 *
 * Falls back to req.ip if no email is present so a malformed body
 * still gets some throttling rather than escaping the limiter
 * entirely.
 */
export async function buildAuthEmailRateLimiter(): Promise<RateLimitRequestHandler> {
  const client = await getRedis();
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 3,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => {
      const raw = (req.body as { email?: unknown })?.email;
      const email =
        typeof raw === "string" ? raw.trim().toLowerCase() : "";
      return email || `ip:${req.ip ?? "unknown"}`;
    },
    store: new RedisStore({
      sendCommand: (...args: string[]) =>
        client.sendCommand(args) as Promise<RedisReply>,
      prefix: "ck:rl:auth-email:",
    }),
  });
}
