# Club Kudo — Handover Notes

**Date of handover:** 2026-04-29
**From:** Replit Agent (this session)
**To:** Cowork (next assistant)
**Repo state at handover:** branch `main`, head includes Phase 1 Steps 1–4 complete

---

## Project context (one-paragraph recap)

Production-grade **Stripe Connect routing service** for **Club Kudo Ltd**, a UK
wedding entertainment booking agency turning over ~£252k/year across ~155 gigs.
Club Kudo is a **disclosed booking agent** (not a merchant of record): a single
client invoice is split across multiple suppliers (DJ, photographer, band, etc.)
using Stripe's **Separate Charges and Transfers** model on **Connect V2**. The
build is phased; the user wants confirmation between phases and at the end of
each Phase 1 step. Always show files before pushing.

---

## Phase 1 progress

| Step | Description | Status |
|------|-------------|--------|
| 1 | Web artifact bootstrap (`artifacts/club-kudo`, port 24668, base path `/`) | ✅ DONE |
| 2 | Drizzle schema — 14 tables pushed to Neon (users, user_roles, suppliers, gigs, gig_line_items, invoices, payments, transfers, refunds, audit_log, sessions, magic_link_tokens, idempotency_replay, plus enums file) | ✅ DONE |
| 3 | Middleware stack — Sentry preload, Pino logging, Helmet, CORS, sessions (Redis), CSRF, body parsers, rate limiter | ✅ DONE (incl. 3 polish items) |
| 4 | OpenAPI spec + orval codegen (react-query client + zod runtime validators) | ✅ DONE — this commit |
| 5 | Auth: magic-link, sessions, idempotency middleware, requireAuth/requireRole | 🚧 **NOT STARTED** — see "Where Step 5 was about to start" below |
| 6 | Suppliers CRUD + Stripe V2 onboarding link/status | ⏳ pending |
| 7 | Gigs + line items + invoice generation | ⏳ pending |
| 8 | Payment Intents (Separate Charges) + transfer scheduling | ⏳ pending |
| 9 | Stripe V2 thin webhooks (event handler + reconciliation) | ⏳ pending |
| 10 | Admin UI wiring + e2e tests + production readiness pass | ⏳ pending |

---

## Critical things a cold reader will miss

These are non-obvious design decisions or implementation requirements that are
NOT immediately apparent from reading the schema or middleware files. **Read
this section before touching any of the affected files.**

### 1. Sentry preload pattern (touches `package.json` start script + `instrument.ts`)

The API server is bundled with `esbuild` (see `artifacts/api-server/build.mjs`)
but `express`, `@sentry/*`, `@opentelemetry/*`, `import-in-the-middle`, and
`require-in-the-middle` are **deliberately externalized** so OpenTelemetry can
patch them at runtime. Sentry v10.x requires Node to load the instrumentation
BEFORE any application code via `--import` flags.

The exact start command (in `artifacts/api-server/package.json`):

```
SENTRY_PRELOAD_INTEGRATIONS=Http,Express \
  node --enable-source-maps \
       --import @sentry/node/preload \
       --import ./dist/instrument.mjs \
       ./dist/index.mjs
```

If you change the start command, lose either `--import` flag, or fail to set
`SENTRY_PRELOAD_INTEGRATIONS`, OTel won't patch Express and Sentry traces will
silently be empty. The minimal `instrument.ts` only calls `Sentry.init()` — it
intentionally does NOT register integrations imperatively because the preload
flag does that.

Required: `@opentelemetry/instrumentation-express` is a real runtime dep, not
just a dev dep.

### 2. CSRF mounting and the `/api/csrf-token` endpoint

`csrf-csrf` v4.0.3 is double-submit. The cookie name is `__Host-ck.csrf` in
production and `ck.csrf` in development. The `getSessionIdentifier` callback
requires the session to be persisted, which means a fresh visitor with no
session yet would get a cryptic CSRF error on their first POST.

To work around this, `GET /api/csrf-token` deliberately writes
`req.session.csrfBound = true` to **force the session cookie (`ck.sid`) to be
issued**. Clients MUST call `GET /api/csrf-token` first to obtain both the
session cookie and the CSRF token before issuing any state-changing request.
Don't "optimize" away that session write — it's load-bearing.

All 5 CSRF forgery scenarios were verified manually in Step 3:
1. No token → 403
2. Wrong token → 403
3. Valid token but no session cookie → 403
4. Valid token from a different session → 403
5. Valid token + matching session → 200/201

### 3. Webhook mount order (NOT YET IMPLEMENTED — Step 9, but the comment is in `app.ts`)

When you add the Stripe webhook route in Step 9, it MUST satisfy ALL FOUR of:

1. **Before the global `express.json()` parser** — Stripe signature verification
   needs the raw body bytes.
2. **Use route-level `express.raw({type: "application/json"})`** — only this
   route, not globally.
3. **Before CSRF middleware** — Stripe POSTs without CSRF tokens (it's a
   server-to-server callback).
4. **Before the global rate limiter** — Stripe's retry storms can be heavy and
   we need the dedicated webhook-specific rate limiter (TBD in Step 9).

This is documented in detail in a multi-line comment in
`artifacts/api-server/src/app.ts` near the future mount point.

### 4. Session cookie sameSite=lax is DELIBERATE (not strict)

Comment in `artifacts/api-server/src/middlewares/session.ts` explains: magic
links are clicked from external email clients (Gmail web, Apple Mail, etc.).
With `sameSite=strict`, the session cookie wouldn't be sent on the verify
request and the magic link would always fail. `lax` is the correct choice for
this auth model. Don't change to strict without redesigning the magic-link flow.

### 5. Two-key idempotency design (resolved in Step 4)

There are TWO independent idempotency systems in this codebase. Conflating them
will cause subtle bugs in Phase 4:

- **Client-facing idempotency** (`Idempotency-Key` request header):
  - REQUIRED on every POST/PATCH/DELETE
  - Format: UUID v4 (validated)
  - Persisted in `audit_log.idempotency_key` (uuid column)
  - Replay protection for OUR API endpoints
  - Implemented in Step 5a (idempotency middleware)

- **Stripe-side idempotency** (sent in `Idempotency-Key` header to Stripe API):
  - Server-generated, NOT exposed to clients
  - Format: `<action>-<entity_id>-<uuid>` (e.g. `transfer-inv_abc123-d290…`)
  - Persisted in `transfers.stripe_idempotency_key` (text column with unique index)
  - Replay protection for OUR retries against the Stripe API
  - Implemented in Step 8 (transfer scheduling)

The `transfers` table column was renamed and retyped in Step 4
(`idempotency_key uuid` → `stripe_idempotency_key text`) and a unique index was
added. The DB is in sync — verified with `\d transfers`.

### 6. Audit log is append-only at the DB level

`lib/db/sql/audit_log_append_only.sql` (applied automatically by
`pnpm --filter @workspace/db run push`) installs PostgreSQL triggers that block
UPDATE and DELETE on the `audit_log` table. Application code can only INSERT.
There is intentionally NO API endpoint to write audit entries — the API only
exposes a read endpoint (`GET /audit-log`, admin-only).

### 7. Cursor pagination contract (documented in OpenAPI but worth reading)

Cursors are `base64url(JSON({v, k, id}))` where `v` is a version int. Servers
MUST reject unknown versions with `400 cursor_invalid` so old cursors don't
silently misbehave across deploys. Always sorted `created_at DESC, id DESC`
unless an endpoint documents otherwise. **Cursors are bound to the exact filter
set that produced them** — changing filters mid-pagination is undefined; the
client must restart from page 1.

### 8. Generated client namespace

`@workspace/api-zod` exports zod schemas under a `schemas` namespace because the
zod constants and the TS types share the same names (e.g.
`GetSupplierOnboardingStatusParams` exists as both a zod schema and a TS type).
Consumers do:

```ts
import { schemas, type SomeType } from "@workspace/api-zod";
const { SomeSchema } = schemas;
```

Currently only one consumer (`artifacts/api-server/src/routes/health.ts`). Keep
this pattern when wiring further routes in Step 5+.

### 9. Drizzle interactive renames

`pnpm --filter @workspace/db run push` (and even `push-force`) is INTERACTIVE
when a column rename is detected — it asks "create or rename?" and stdin pipes
don't reliably feed it. In Step 4 the rename was applied via raw SQL instead.
For future renames, either:
- Run the push interactively in a terminal, OR
- Apply the SQL by hand and then re-run push (it'll be a no-op).

---

## Where Step 5 was about to start

Step 5 (Auth + idempotency foundation) was approved by the user and broken into
four substeps. **Step 5a was the next thing to begin.**

### Step 5a: Idempotency middleware (foundation — everything else depends on it)

**File to create:** `artifacts/api-server/src/middlewares/idempotency.ts`

**Behaviour:**
1. On every state-changing request (POST/PATCH/DELETE), parse the
   `Idempotency-Key` header. Reject with `400 idempotency_key_required` if
   missing, `400 idempotency_key_invalid` if not a UUID v4.
2. Look up the key in a `idempotency_replay` table (already exists in schema —
   columns: `key uuid pk`, `user_id uuid nullable`, `path text`, `method text`,
   `status_code int`, `response_body jsonb`, `created_at timestamptz`,
   `expires_at timestamptz`).
3. **Same key + same path + same authenticated user** → return the stored
   `status_code` + `response_body` directly. Do NOT call the route handler.
4. **Same key + DIFFERENT path or user** → `409 idempotency_key_collision`.
5. **No match** → call `next()`. Wrap `res.json` / `res.send` to capture the
   final response and persist it to `idempotency_replay` after the handler
   completes (only for 2xx responses; 4xx/5xx should NOT be cached so clients
   can retry validation errors).
6. Use a 24-hour TTL on the replay rows; a separate cron (Step 10) prunes
   expired entries.

**Tests to write alongside:**
- Replay returns identical response without re-executing handler (use a
  side-effect counter to prove the handler ran exactly once).
- Collision returns 409.
- Missing/malformed key returns 400 with the right error code.
- Failed responses (4xx/5xx) are NOT cached — second attempt re-executes.

### Step 5b: Magic-link routes

`POST /auth/magic-link`, `GET /auth/verify`. Use `crypto.randomBytes(32)` for
the token; store SHA-256 hash in `magic_link_tokens` (the table already has the
schema). Token TTL: 15 minutes. Single-use enforced by setting `consumed_at`.

The anti-enumeration contract (documented in OpenAPI) is critical: the response
must look identical for known and unknown emails, AND the response time must be
constant (use a timing-safe sleep to mask the database lookup).

### Step 5c: Session routes

`GET /auth/me`, `POST /auth/logout`. Standard express-session destruction.

### Step 5d: Rate limiting + e2e tests

Per-IP and per-email rate limiters on `/auth/magic-link` (use `rate-limit-redis`
since Redis is already configured). The e2e tests should include a timing
oracle test for the anti-enumeration property.

---

## Open question for the next assistant

### Resend email integration — needs the user's call

Step 5b sends the magic-link email via Resend (`bookings@clubkudo.com` is the
intended sender). Two paths:

**Option A (simpler):** User adds `RESEND_API_KEY` to Replit Secrets manually.
Use the standard `resend` npm package directly. This is what I would have
defaulted to, but I never confirmed it with the user.

**Option B (Replit-native):** Use Replit's Integrations system (see
`.local/skills/integrations`). This may or may not have a Resend connector —
needs to be checked via `searchIntegrations("resend")` in code execution. If
it exists, the integration provides credentials via `listConnections("resend")`
without the user needing to manage the secret directly.

**Recommendation:** Check the integrations catalogue first. If a Resend
integration exists and is appropriate, use it. If not, fall back to the manual
secret. Either way, ASK THE USER before adding the dependency or making the
choice — they were emphatic about confirmation between phases.

The other secrets the API server already uses (`REDIS_URL`, `SENTRY_DSN`) are
already in Secrets and working.

---

## Files of interest (quickest path to context)

```
lib/api-spec/openapi.yaml                              ← API surface (locked)
lib/api-spec/orval.config.ts                           ← codegen config
lib/api-zod/src/index.ts                               ← namespaced re-export
lib/api-client-react/src/generated/api.ts              ← react-query client
lib/db/src/schema/                                     ← all 14 tables
lib/db/sql/audit_log_append_only.sql                   ← audit trigger
artifacts/api-server/src/app.ts                        ← middleware wiring
artifacts/api-server/src/instrument.ts                 ← Sentry preload init
artifacts/api-server/src/middlewares/session.ts        ← sameSite=lax rationale
artifacts/api-server/src/middlewares/csrf.ts           ← CSRF setup
artifacts/api-server/src/routes/csrf.ts                ← session-issuing endpoint
artifacts/api-server/src/routes/health.ts              ← only api-zod consumer
artifacts/api-server/build.mjs                         ← esbuild externals list
artifacts/api-server/package.json                      ← exact start command
artifacts/api-server/README.md                         ← Production Deployment notes
.local/tasks/phase-1-foundation.md                     ← original task plan
```

---

## Verification commands

Anyone resuming work should run these to confirm a clean starting state:

```bash
# Workspace typecheck (must be clean)
pnpm -w run typecheck

# Codegen is up to date with the spec
pnpm --filter @workspace/api-spec run codegen

# DB schema in sync
pnpm --filter @workspace/db run push

# API server boots and serves /api/healthz
curl http://localhost:8080/api/healthz
# → {"status":"ok"}
```

---

## Things explicitly out of scope for the resumed work

The user noted these as "noted but not changing" in Step 4 review:

- Audit log filter by `idempotency_key` — add later if needed
- Supplier self-service endpoints — Phase 6 as planned
- Cursor encoding details — assumed sufficient as documented
- No operationId renames

Don't surface these unless the user asks.

---

## Stop point

Work paused after Step 4 completion. Do not begin Step 5a until the user
confirms the resume. The next conversation should start with the user
explicitly authorising work to continue.
