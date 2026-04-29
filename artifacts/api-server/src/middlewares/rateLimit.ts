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
      prefix: "ck:rl:auth:",
    }),
  });
}
