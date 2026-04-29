# Club Kudo API Server

Express + TypeScript API server for the Club Kudo Stripe Connect routing platform.

> This README is a living document. Phase 1 Step 9 will expand it with full
> architecture overview, local dev setup, env-var reference, and Stripe CLI
> commands. The Production Deployment section below is authoritative now.

## Production Deployment

### Required Node start command

The server **must** be started with both `--import` flags below — in this exact
order — and with `SENTRY_PRELOAD_INTEGRATIONS` set:

```bash
SENTRY_PRELOAD_INTEGRATIONS=Http,Express \
  node \
  --enable-source-maps \
  --import @sentry/node/preload \
  --import ./dist/instrument.mjs \
  ./dist/index.mjs
```

**Why this matters.** Sentry's auto-instrumentation patches Express, HTTP,
Postgres, Redis, etc. at module-load time using OpenTelemetry's
`import-in-the-middle` hook. In ESM, `import` statements are hoisted, so
instrumentation has to be registered **before** any application module is
loaded. The two flags do different jobs:

| Flag                                    | Purpose                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `--import @sentry/node/preload`         | Registers the OTel module-load hook. Reads `SENTRY_PRELOAD_INTEGRATIONS` to know which to enable.|
| `--import ./dist/instrument.mjs`        | Calls `Sentry.init()` with our DSN, environment, sample rate, and integrations.                  |
| `SENTRY_PRELOAD_INTEGRATIONS=Http,Express` | Tells the preload hook which OTel instrumentations to register before Sentry.init() runs.     |

If any of these are missing, the server will start but Sentry will log
`[Sentry] express is not instrumented` and per-route spans / Express middleware
spans will be lost (exception capture still works via `setupExpressErrorHandler`,
but tracing becomes much less useful).

### Constraints on the deployment platform

Whatever process manager / deployment platform we choose for Phase 7 (Replit
Deployments, Fly.io, Railway, ECS, etc.) **must** support:

1. **Custom Node arguments** — both `--import` flags above. Deployment platforms
   that only let you set an entrypoint script (and not Node CLI flags) require
   either:
   - Wrapping the start command in a shell script that invokes `node` directly, or
   - Setting `NODE_OPTIONS="--import @sentry/node/preload --import ./dist/instrument.mjs --enable-source-maps"`
     (note: `NODE_OPTIONS` is honored by `node` but **not** by `npm start` on
     some platforms — verify before relying on it).
2. **Environment variables** — all secrets in `src/lib/env.ts` plus
   `SENTRY_PRELOAD_INTEGRATIONS`. See env-var reference (Step 9).
3. **A persistent Redis instance** — sessions, rate limiting, idempotency keys,
   and (Phase 2+) BullMQ all depend on it. Upstash, Redis Cloud, ElastiCache,
   etc. are all fine; the connection string goes in `REDIS_URL`.
4. **A managed Postgres instance** — `DATABASE_URL` for Drizzle.
5. **HTTPS termination at the proxy** with `X-Forwarded-Proto` set correctly so
   `app.set("trust proxy", 1)` can mark cookies `Secure` and treat the request
   as TLS.

### Build artifacts

`pnpm --filter @workspace/api-server run build` produces these files in `dist/`:

- `index.mjs` — main bundled application
- `instrument.mjs` — Sentry init (preloaded)
- `pino-*.mjs`, `thread-stream-worker.mjs` — Pino transport workers (must be
  shipped alongside `index.mjs`; they're loaded by Pino at runtime via the
  `esbuild-plugin-pino` configuration)

The deployment must include the entire `dist/` directory plus `node_modules/`
(or a re-installed `node_modules` from `pnpm install --prod` — `express`,
`@sentry/*`, `@opentelemetry/*`, and a few others are intentionally
externalized from the bundle so OTel can hook them at runtime).
