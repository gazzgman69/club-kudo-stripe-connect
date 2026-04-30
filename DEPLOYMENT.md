# Deployment runbook

## TL;DR

Code lives on GitHub at `gazzgman69/club-kudo-stripe-connect`. The live API
runs on Replit. Pushing to `main` does **not** auto-deploy. To deploy:

```bash
# From the repo on your laptop (or a Cowork session):
git push origin main

# Then trigger Replit to pull, build, and restart:
curl "$REPL_URL/api/admin/reload?key=$RELOAD_SECRET&build=1&restart=1"
```

`$REPL_URL` and `$RELOAD_SECRET` live in
`.cowork-credentials/credentials.env` (one level above the repo).

## What `/api/admin/reload` does

| Flag         | Effect                                                                           |
| ------------ | -------------------------------------------------------------------------------- |
| `force=1`    | `git fetch && git reset --hard origin/main` (use after a forced push or drift)   |
| `install=1`  | `pnpm install --no-frozen-lockfile` — set when `package.json` or lockfile change |
| `schema=1`   | `pnpm --filter @workspace/db run push` — dev-only schema sync (no migrations)    |
| `migrate=1`  | `pnpm --filter @workspace/db run migrate` — apply versioned SQL migrations       |
| `seed=1`     | `pnpm --filter @workspace/db run seed-admin` — idempotent admin seed             |
| `typecheck=1`| `pnpm -w run typecheck`                                                          |
| `test=1`     | `pnpm --filter @workspace/api-server run test`                                   |
| `build=1`    | `pnpm --filter @workspace/api-server run build` — rebuilds `dist/index.mjs`      |
| `restart=1`  | `pkill -USR2 -f nodemon` so nodemon respawns the node child                      |
| `exit=1`     | `process.exit(0)` so the bash supervisor / Replit workflow respawns              |

Combine flags via `&`. Flags run in order: pull → install → schema → seed →
typecheck → test → build → (restart / exit).

## Common deploy recipes

| Change                          | Command                                                                  |
| ------------------------------- | ------------------------------------------------------------------------ |
| Backend code only               | `…?key=&build=1&restart=1`                                               |
| Frontend code only              | `…?key=&restart=1` (Vite dev server picks up changes automatically)       |
| Schema sync (dev only)          | `…?key=&schema=1`                                                        |
| Schema migration (production)   | `…?key=&migrate=1` (after committing new SQL files)                      |
| New npm dependency              | `…?key=&install=1&build=1&restart=1`                                     |
| Force-redeploy after drift      | `…?key=&force=1&install=1&schema=1&build=1&exit=1`                       |

## Troubleshooting

### Endpoint returns 404 after a successful build

Symptom: `/api/admin/reload?…&build=1&restart=1` returns `ok:true` and the
build wrote `dist/index.mjs`, but the new endpoint still 404s.

Cause: `nodemon` isn't running, so `pkill -USR2 -f nodemon` is a no-op and the
running process never reloads the new bundle.

Fix: add `&exit=1` to the reload call. The handler then `process.exit(0)`s
after responding, and the bash supervisor (or Replit's workflow run command)
respawns from the new bundle.

If `exit=1` was added in a code change that itself hasn't deployed yet —
i.e. the running process doesn't know about `exit=1` — you have to restart
the process manually. From the Replit shell:

```bash
# Find the running node process(es):
ps aux | grep "dist/index.mjs" | grep -v grep
# Kill it/them — the supervisor respawns from the latest dist/:
pkill -9 -f "dist/index.mjs"
```

### Build fails

Check the `stderr` field in the response. Common failures:

- `Cannot find module '@workspace/db'` — `node_modules` are stale; add `install=1`
- TypeScript errors — fix locally, push, retry; the build calls esbuild not
  tsc, so types are NOT checked at build time. Add `typecheck=1` to catch them.
- `Out of memory` during build — happens occasionally on Replit; just retry.

### Schema push fails

Drizzle Kit refuses to drop columns interactively. If the failing message
mentions "data loss", review the diff with:

```bash
pnpm --filter @workspace/db run push --verbose
```

…then run the destructive change manually via `psql $DATABASE_URL` if it's
safe.

## Schema migrations

For production-bound schema changes, prefer the **versioned migration** path
over `schema=1`:

```bash
# 1. Edit schema files in lib/db/src/schema/
# 2. Generate the SQL diff:
pnpm --filter @workspace/db run generate
# 3. Review and commit the new file in lib/db/migrations/
git add lib/db/migrations
git commit -m "Add migration: <what changed>"
git push
# 4. Apply on Replit:
curl "$REPL_URL/api/admin/reload?key=$RELOAD_SECRET&migrate=1&build=1&exit=1"
```

The migrator tracks applied migrations in `__drizzle_migrations` so re-runs
are no-ops. Trigger SQL and seed SQL in `lib/db/sql/` are re-applied after
each migrate run (they're written idempotently — `CREATE TRIGGER IF NOT
EXISTS`, etc).

**First-time bootstrap.** When you first switch to versioned migrations on
an existing database, run `generate` to snapshot the current schema as
the baseline migration, then commit that file. The migrator will record
the existing schema as already-applied on first run.

`schema=1` (drizzle-kit push) remains available for fast iteration on a
dev branch, but should never be used against the production database.

## Rollback

There's no `rollback=1` flag. To undo a bad deploy:

```bash
git revert HEAD          # creates a revert commit
git push origin main
curl "$REPL_URL/api/admin/reload?key=$RELOAD_SECRET&build=1&exit=1"
```

For a fast rollback without a revert commit:

```bash
git push origin <last-good-sha>:main --force
curl "$REPL_URL/api/admin/reload?key=$RELOAD_SECRET&force=1&build=1&exit=1"
```

## Replit workflow

The Replit workflow that supervises the api-server is configured in the
Replit web UI (it doesn't live in this repo). It runs the bash supervisor
script at `/tmp/run-api-server.sh`, which loops `pnpm dev` so a dead node
child gets respawned.

If everything stops working and the supervisor itself died, restart it from
the Replit Run button.
