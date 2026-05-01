# Operations runbook

This is the page you reach for when something is broken at 3am, when a
secret needs rotating, or when you need to remember which connector is
where.

## Where things live

| Thing                          | Where                                                                |
| ------------------------------ | -------------------------------------------------------------------- |
| Code                           | GitHub `gazzgman69/club-kudo-stripe-connect`                         |
| Live API                       | Replit, exposed at `$REPL_URL`                                       |
| Database                       | Neon Postgres (URL in Replit Secrets as `DATABASE_URL`)              |
| Sessions / rate limit / queues | Upstash Redis (Replit Secret `REDIS_URL`)                            |
| Email transport                | Resend (Replit Secret `RESEND_API_KEY`)                              |
| Payments                       | Stripe Connect V2 (test mode currently; see `LIVE_MODE.md`)          |
| Error / perf telemetry         | Sentry (Replit Secret `SENTRY_DSN`)                                  |
| Cowork-side credentials        | `~/Documents/Claude/Projects/Club Kudo Invoicing/.cowork-credentials/credentials.env` |

## Health checks

```bash
curl "$REPL_URL/api/healthz"          # → {"status":"ok"}
curl "$REPL_URL/api/csrf-token"       # → {"csrfToken":"…"}
```

Both are unauthenticated and side-effect free. Use them as a liveness probe.

## Secrets rotation

All secrets live in Replit's "Secrets" pane (the lock icon in the sidebar).
Rotation is always: revoke old → set new → redeploy.

### `RELOAD_SECRET`

The shared secret used by `/api/admin/reload`. If this leaks, anyone can
trigger a build / restart.

1. Generate a new value: `openssl rand -hex 32`.
2. Update Replit Secret `RELOAD_SECRET`.
3. Update `.cowork-credentials/credentials.env` on your laptop.
4. Redeploy from the Replit "Run" button (Secrets only inject into new shells).

### `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_WEBHOOK_SECRET_V2`

1. Stripe Dashboard → Developers → API keys → reveal current key, then
   "Roll" to create a new one.
2. Update Replit Secret `STRIPE_SECRET_KEY`.
3. **V1 webhook secret**: Developers → Webhooks → your V1 endpoint →
   "Reveal signing secret" → roll. Update `STRIPE_WEBHOOK_SECRET` in
   Replit Secrets.
4. **V2 event destination secret**: Workbench → Webhooks → your V2
   destination → "Reveal signing secret". Update `STRIPE_WEBHOOK_SECRET_V2`
   in Replit Secrets.
5. Redeploy.
6. Test: hit `/api/webhooks/stripe` with a Stripe CLI replay; verify a 200.

If you only have one destination subscribed to both V1 and V2 events,
leave `STRIPE_WEBHOOK_SECRET_V2` unset; the handler falls back to
`STRIPE_WEBHOOK_SECRET` for V2 verification.

### `DATABASE_URL`

1. Neon → branch → "Reset password" or rotate the connection string.
2. Update Replit Secret `DATABASE_URL`.
3. Redeploy.
4. Verify: `/api/healthz` still returns 200 (it does a trivial DB ping).

### `RESEND_API_KEY`

1. Resend dashboard → API Keys → "Reveal" → "Roll".
2. Update Replit Secret `RESEND_API_KEY`.
3. Redeploy.
4. Test: trigger a magic-link sign-in to your own email and confirm
   delivery.

### Github PAT (Cowork-side only)

The PAT in `.cowork-credentials/credentials.env` only needs `Contents: RW`
+ `Metadata: R` on this single repo.

1. https://github.com/settings/personal-access-tokens → revoke old.
2. Create new fine-grained PAT with the same scope.
3. Update `.cowork-credentials/credentials.env`.

## Common operations

### Run the admin seed

The seed creates the initial admin user (`skinnycheck@gmail.com`) so magic-
link sign-in has someone to authenticate as. It's idempotent — safe to
re-run.

```bash
curl "$REPL_URL/api/admin/reload?key=$RELOAD_SECRET&seed=1"
```

### Replay a Stripe webhook

```bash
# In the Stripe Dashboard: Developers → Webhooks → your endpoint → click an
# event → "Resend". Or via CLI:
stripe events resend evt_…
```

The handler is idempotent on `stripe_event_id` (recorded in `audit_log`),
so resends are safe.

### Inspect the audit log for an entity

In the admin UI: `/admin/audit-log?entityType=invoice&entityId=<uuid>`.
Or hit the API directly:

```bash
curl --cookie cookies.txt \
  "$REPL_URL/api/admin/audit-log?entityType=invoice&entityId=<uuid>"
```

### Force a clean restart (when nodemon is dead)

```bash
# In the Replit shell:
ps aux | grep "dist/index.mjs" | grep -v grep
pkill -9 -f "dist/index.mjs"
# The supervisor respawns from the latest dist/index.mjs.
```

### Drop and re-seed the dev database

⚠️ Destroys all data. Only on a Neon dev branch.

```bash
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
curl "$REPL_URL/api/admin/reload?key=$RELOAD_SECRET&schema=1&seed=1"
```

## Incident playbook

### "API is down"

1. Check `/api/healthz` — if it's 200, the issue is route-specific.
2. Replit logs (Replit web UI → Console) — look for crash traces.
3. Sentry → Issues — check the last hour for new errors.
4. If the process is wedged (high CPU, no responses): kill it via
   `pkill -9 -f "dist/index.mjs"` from the Replit shell. The supervisor
   will respawn.

### "Webhooks are failing"

1. Stripe Dashboard → Developers → Webhooks → your endpoint → recent
   events. Look for non-2xx responses.
2. If it's a 401 / signature failure, check `STRIPE_WEBHOOK_SECRET`
   matches the value in the Stripe dashboard.
3. If 500s, check Sentry for the underlying exception.
4. Resends are idempotent. After fixing, "Resend" the failed events.

### "I think we double-charged a customer"

1. Stripe Dashboard → Customers → find the customer → look at recent
   PaymentIntents. Refund any duplicate via the Stripe UI (do NOT do this
   from code).
2. Check the `audit_log` for the relevant `gig_id` — every state change
   is recorded.
3. The schema enforces idempotency on `(stripe_event_id)` for webhooks
   and on `(stripe_idempotency_key)` for transfers, so true duplicates
   should be impossible. If you see one, file a bug with the Stripe
   request IDs.

## Backup & recovery

Neon takes automated point-in-time snapshots — recovery is via Neon's
"Restore" UI, no manual backup script needed.

If you need a logical dump for archival:

```bash
pg_dump "$DATABASE_URL" --format=c --file=club-kudo-$(date +%F).dump
```

Store outside the repo and outside the Cowork credentials directory.

## On-call escalation

It's just you. Sentry will email `skinnycheck@gmail.com` for new issues.
There's no PagerDuty rotation set up; if you want one, that's a Phase 2
item.
