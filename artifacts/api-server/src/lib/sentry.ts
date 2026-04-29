import * as Sentry from "@sentry/node";
import { getEnv } from "./env";

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  const env = getEnv();
  if (!env.SENTRY_DSN) {
    return;
  }
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    sendDefaultPii: false,
  });
  initialized = true;
}

export { Sentry };
