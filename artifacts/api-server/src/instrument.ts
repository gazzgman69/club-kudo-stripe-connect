// Preloaded via `node --import ./dist/instrument.mjs` so that Sentry's
// auto-instrumentation hooks into HTTP, Express, etc. BEFORE they are
// imported by application code. Keep this file MINIMAL — any extra
// imports here delay Sentry.init() and cause "express is not
// instrumented" warnings.
//
// HTTP and Express integrations are registered via the
// `SENTRY_PRELOAD_INTEGRATIONS=Http,Express` env var (see the start
// script in package.json). They MUST NOT be added to the integrations
// array below — the preload flag handles that, and registering them
// here a second time is redundant noise that obscures intent.
import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
    sendDefaultPii: false,
  });
}
