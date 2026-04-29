import { createClient, type RedisClientType } from "redis";
import { getEnv } from "./env";
import { logger } from "./logger";

let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType> | null = null;

export async function getRedis(): Promise<RedisClientType> {
  if (client?.isOpen) return client;
  if (connecting) return connecting;

  const env = getEnv();
  const c: RedisClientType = createClient({ url: env.REDIS_URL });

  c.on("error", (err) => {
    logger.error({ err }, "redis client error");
  });
  c.on("ready", () => {
    logger.info("redis client ready");
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
