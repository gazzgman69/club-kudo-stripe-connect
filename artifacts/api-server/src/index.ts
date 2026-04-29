// Sentry is initialized via `node --import ./dist/instrument.mjs` (see
// package.json + artifact.toml). Do NOT import Sentry init here — ESM
// hoists imports, so `--import` is the only way to guarantee Sentry's
// instrumentation runs before Express, HTTP, etc. are loaded.
import { logger } from "./lib/logger";
import { getEnv } from "./lib/env";
import { buildApp } from "./app";

async function main() {
  const env = getEnv();
  const app = await buildApp();

  const server = app.listen(env.PORT, (err) => {
    if (err) {
      logger.error({ err }, "failed to bind port");
      process.exit(1);
    }
    logger.info({ port: env.PORT, env: env.NODE_ENV }, "api server listening");
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, "shutting down");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "fatal error during startup");
  process.exit(1);
});
