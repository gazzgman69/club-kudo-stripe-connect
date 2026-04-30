# Club Kudo — Stripe Connect Routing

Production-grade payment routing service for **Club Kudo Ltd**, a UK wedding
entertainment booking agency operating as a **disclosed booking agent**. A
single client invoice is split across multiple suppliers (DJs, photographers,
bands, etc.) using Stripe Connect V2's **Separate Charges and Transfers** model.

## Status

**Phase 1 of 10 in progress.** Steps 1–4 complete (project scaffold, database
schema, middleware infrastructure, OpenAPI spec + codegen). See
[`HANDOVER.md`](./HANDOVER.md) for a detailed breakdown of progress, design
decisions, and pending work.

## Repository layout

This is a **pnpm monorepo** managed via `pnpm-workspace.yaml`.

```
artifacts/
  api-server/      Express + TypeScript backend (port 8080)
  club-kudo/       React + Vite admin frontend (port 24668)
  mockup-sandbox/  Component preview sandbox (design only)
lib/
  api-spec/        OpenAPI 3 spec + Orval codegen config
  api-client-react/  Generated React Query client
  api-zod/         Generated Zod runtime validators + TS types
  db/              Drizzle ORM schema + migration scripts
scripts/           Workspace-wide tooling
```

Detailed deployment notes for the API server live in
[`artifacts/api-server/README.md`](./artifacts/api-server/README.md) — read it
before deploying or modifying the start command.

## Required environment variables

Secrets are managed via the deployment platform (Replit Secrets in dev, your
production secret manager in prod). **Nothing in this table belongs in any
committed file.**

| Variable                       | Purpose                                                                                          | Required in     | Where to obtain                                                                 |
|--------------------------------|--------------------------------------------------------------------------------------------------|-----------------|---------------------------------------------------------------------------------|
| `NODE_ENV`                     | Runtime mode (`development`, `production`, `test`). Drives cookie security, logging format, etc. | dev + prod      | Set per-environment (defaults to `development`)                                 |
| `PORT`                         | TCP port the API server binds to                                                                 | dev + prod      | Set by platform (Replit auto-assigns; production is platform-specific)          |
| `LOG_LEVEL`                    | Pino log threshold (`fatal`/`error`/`warn`/`info`/`debug`/`trace`/`silent`)                      | optional        | Defaults to `info`                                                              |
| `DATABASE_URL`                 | Postgres connection string (Drizzle target)                                                      | dev + prod      | Replit Postgres (auto-injected) or any managed Postgres provider                |
| `REDIS_URL`                    | Redis connection string for sessions, rate limiting, idempotency replay                          | dev + prod      | Upstash, Redis Cloud, ElastiCache, or any managed Redis (`rediss://` for TLS)   |
| `SESSION_SECRET`               | HMAC key for session cookie signing. **Minimum 32 chars; production requires fresh value.**      | dev + prod      | Generate with `openssl rand -hex 32`                                            |
| `SENTRY_DSN`                   | Sentry project DSN for error reporting + tracing                                                 | prod (optional dev) | Sentry → project → Settings → Client Keys (DSN)                              |
| `SENTRY_TRACES_SAMPLE_RATE`    | Fraction of requests traced (0.0–1.0)                                                            | optional        | Defaults to `0.1` (10% sampling)                                                |
| `SENTRY_PRELOAD_INTEGRATIONS`  | Comma-separated OTel integrations to preload. **Must be `Http,Express` for Express tracing.**     | dev + prod      | Set to `Http,Express` (see `artifacts/api-server/README.md` for why)            |
| `CORS_ALLOWED_ORIGINS`         | Comma-separated origin allowlist for the CORS middleware                                         | prod            | Set to your frontend origin(s), e.g. `https://admin.clubkudo.com`               |
| `RATE_LIMIT_WINDOW_MS`         | Rate-limit window in ms                                                                          | optional        | Defaults to `60000` (1 minute)                                                  |
| `RATE_LIMIT_MAX`               | Max requests per IP per window                                                                   | optional        | Defaults to `100`                                                               |
| `COOKIE_DOMAIN`                | Cookie `Domain` attribute. Leave unset for host-only cookies.                                    | optional (prod) | Set if frontend and API are on different subdomains of the same parent domain   |
| `RELOAD_SECRET`                | Auth secret for the `/api/admin/reload` endpoint. Without this set, the endpoint returns 503.    | optional        | Generate with `openssl rand -hex 32`. Set in Replit Secrets.                    |
| `RESEND_API_KEY`               | API key for outbound transactional email (magic-link sign-in).                                   | dev + prod      | Resend → API keys (sending-only scope, scoped to `bookings.clubkudo.com`).      |
| `APP_BASE_URL`                 | Public URL used to build outbound magic-link URLs (no trailing slash). If unset, derived from the request.  | optional   | Set explicitly when frontend and API are on different origins.                  |
| `EMAIL_FROM`                   | From-header identity for outbound transactional email. Must be at a Resend-verified domain.      | optional        | Defaults to `Club Kudo <noreply@bookings.clubkudo.com>`.                        |
| `EMAIL_REPLY_TO`               | Reply-To header for outbound transactional email. Set if you want replies to land in an inbox.   | optional        | E.g. `bookings@clubkudo.com`. Leave unset to omit the header.                   |

### Future env vars (not yet validated in `env.ts`)

These will be added in later phases — listed here so the next assistant doesn't
have to rediscover them:

| Variable                  | Purpose                                                          | Phase | Where to obtain                                                          |
|---------------------------|------------------------------------------------------------------|-------|--------------------------------------------------------------------------|
| `STRIPE_SECRET_KEY`       | Stripe Connect V2 server-side API key                            | 8     | Stripe Dashboard → Developers → API keys (use `sk_test_…` in dev)       |
| `STRIPE_WEBHOOK_SECRET`   | Signing secret for the `/webhooks/stripe` endpoint               | 9     | Stripe Dashboard → Developers → Webhooks → endpoint signing secret       |
| `STRIPE_CONNECT_CLIENT_ID`| Connect platform client ID (V2)                                  | 8     | Stripe Dashboard → Connect → Settings                                    |

## Quick start (development)

```bash
pnpm install
pnpm --filter @workspace/db run push      # apply Drizzle schema to DATABASE_URL
pnpm --filter @workspace/api-spec run codegen   # generate API client + zod schemas
pnpm dev                                  # starts all configured workflows
```

The API server is at `http://localhost:8080` (health: `/api/healthz`); the
admin frontend is at `http://localhost:24668`.

## Verification commands

```bash
pnpm -w run typecheck                      # workspace-wide TS typecheck
pnpm --filter @workspace/api-spec run codegen   # regen + typecheck
pnpm --filter @workspace/db run push       # ensure DB schema is current
```

## Cowork reload endpoint

`POST /api/admin/reload` lets a Cowork session sync the running Replit
instance after pushing to GitHub. Auth is via the `RELOAD_SECRET` env
var (set in Replit Secrets). Without it, the endpoint returns 503.

```bash
# Code-only change, run tests after pulling:
curl "$REPL_URL/api/admin/reload?key=$RELOAD_SECRET&test=1"

# New dependency + schema change + full deploy:
curl "$REPL_URL/api/admin/reload?key=$RELOAD_SECRET&install=1&schema=1&build=1&restart=1"

# Working tree drifted, force-reset to origin/main:
curl "$REPL_URL/api/admin/reload?key=$RELOAD_SECRET&force=1"
```

Query params: `force`, `install`, `schema`, `typecheck`, `test`,
`build`, `restart`. See `artifacts/api-server/src/routes/admin.ts` for
the full contract.

## Documentation

- [`HANDOVER.md`](./HANDOVER.md) — phase status, design rationale, pending work
- [`artifacts/api-server/README.md`](./artifacts/api-server/README.md) — production deployment specifics (Sentry preload, raw-body webhook constraints, etc.)
- [`lib/api-spec/openapi.yaml`](./lib/api-spec/openapi.yaml) — API contract (source of truth for codegen)

## License

Proprietary — Club Kudo Ltd. Not for redistribution.
