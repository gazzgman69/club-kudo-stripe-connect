import { createClient, type RedisClientType } from "redis";
import { getEnv } from "./env";
import { logger } from "./logger";

let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType> | null = null;

// Cap reconnect backoff so we don't sleep for hours after a long outage.
const MAX_RECONNECT_DELAY_MS = 30_000;

export async function getRedis(): Promise<RedisClientType> {
  if (client?.isOpen) return client;
  if (connecting) return connecting;

  const env = getEnv();
  const c: RedisClientType = createClient({
    url: env.REDIS_URL,
    socket: {
      // Exponential backoff: 100ms, 200ms, 400ms, ... capped at 30s.
      // Returning a number tells node-redis to retry; returning Error stops.
      reconnectStrategy: (retries) => {
        const delay = Math.min(100 * 2 ** retries, MAX_RECONNECT_DELAY_MS);
        logger.warn(
          { retries, delayMs: delay },
          "redis reconnect scheduled",
        );
        return delay;
      },
      // Avoid hanging forever on a dead host.
      connectTimeout: 10_000,
    },
  });

  c.on("error", (err) => {
    logger.error({ err }, "redis client error");
  });
  c.on("connect", () => {
    logger.info("redis client connecting");
  });
  c.on("ready", () => {
    logger.info("redis client ready");
  });
  c.on("reconnecting", () => {
    logger.warn("redis client reconnecting");
  });
  c.on("end", () => {
    logger.warn("redis client connection ended");
  });

  connecting = c.connect().then(() => {
    client = c;
    connecting = null;
    return c;
  });
  return connecting;
}
