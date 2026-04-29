// Preloaded via `node --import ./dist/instrument.mjs` so that Sentry's
// auto-instrumentation hooks into HTTP, Express, etc. BEFORE they are
// imported by application code. Keep this file MINIMAL — any extra
// imports here delay Sentry.init() and cause "express is not
// instrumented" warnings.
import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
    sendDefaultPii: false,
    integrations: [Sentry.expressIntegration()],
  });
}
