import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const execAsync = promisify(exec);

// Resolve the monorepo root by walking up from this file's directory
// until we find pnpm-workspace.yaml. Hard-coded `../..` style paths
// would break across dev (src/routes/admin.ts) vs bundled
// (dist/index.mjs) layouts.
function findRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Last-resort fallback. The Replit workflow runs from
  // artifacts/api-server, so go up two from there.
  return path.resolve(process.cwd(), "../..");
}

const repoRoot = findRepoRoot();

/**
 * /api/admin/reload — server-to-server git-pull-and-rebuild endpoint.
 *
 * Modelled on the TrackMyGigs reload pattern. Lets a Cowork session push
 * to GitHub then curl this endpoint to make Replit pull, install, push
 * schema changes, build, and restart — all without driving the Replit
 * web UI.
 *
 * Auth is via the `RELOAD_SECRET` env var (set in Replit Secrets). If
 * the env var is unset, the endpoint returns 503 to obscure its
 * existence on misconfigured deployments.
 *
 * Query params (all optional booleans, "1" enables, anything else
 * disables; default for each is shown in parentheses):
 *
 *   key=<RELOAD_SECRET>          REQUIRED. Compared via constant-time
 *                                equality.
 *   force=1                      (off) `git fetch origin main && git
 *                                reset --hard origin/main` instead of
 *                                a regular pull. Use when the working
 *                                tree has drifted.
 *   install=1                    (off) Run `pnpm install` after pull.
 *                                Set this when package.json changed.
 *   schema=1                     (off) Run `pnpm --filter @workspace/db
 *                                run push` to apply Drizzle schema
 *                                changes to Neon.
 *   seed=1                       (off) Run the admin seed script
 *                                (`@workspace/db run seed-admin`).
 *                                Idempotent — safe to re-run.
 *   typecheck=1                  (off) Run `pnpm -w run typecheck`.
 *   test=1                       (off) Run the api-server test suite
 *                                via vitest.
 *   build=1                      (off) Run `pnpm --filter
 *                                @workspace/api-server run build` to
 *                                regenerate dist/.
 *   restart=1                    (off) After everything else succeeds,
 *                                signal nodemon to respawn (SIGUSR2 by
 *                                command-name match). Combine with
 *                                build=1 for a full code deploy.
 *   exit=1                       (off) Force-exit the current process
 *                                after responding. Useful when nodemon
 *                                isn't running and the bash supervisor
 *                                (or Replit's workflow run command) is
 *                                relied on to respawn from the new
 *                                dist/. Belt-and-braces: also runs the
 *                                pkill from restart=1 first.
 *
 * Example curl:
 *
 *   # Code-only change, refresh tests
 *   curl "$REPL_URL/api/admin/reload?key=$RELOAD_SECRET&test=1"
 *
 *   # New dependency + schema change + full deploy
 *   curl "$REPL_URL/api/admin/reload?key=$RELOAD_SECRET&install=1&schema=1&build=1&restart=1"
 *
 * The endpoint runs commands sequentially with `&&`; the chain stops on
 * the first failure and the response includes stderr so you can tell
 * which step broke.
 */
async function handleReload(req: Request, res: Response): Promise<void> {
  const expected = process.env.RELOAD_SECRET;
  if (!expected) {
    res
      .status(503)
      .json({ error: "RELOAD_SECRET not configured on this deployment" });
    return;
  }

  const provided =
    typeof req.query.key === "string" ? req.query.key : undefined;
  if (!provided || !constantTimeEquals(provided, expected)) {
    res.status(401).json({ error: "Invalid reload key" });
    return;
  }

  const flag = (name: string): boolean =>
    typeof req.query[name] === "string" && req.query[name] === "1";

  const force = flag("force");
  const install = flag("install");
  const schema = flag("schema");
  const seed = flag("seed");
  const typecheck = flag("typecheck");
  const test = flag("test");
  const build = flag("build");
  const restart = flag("restart");
  const exitAfter = flag("exit");

  const cmds: string[] = [];
  cmds.push(
    force
      ? "git fetch origin main && git reset --hard origin/main"
      : "git pull origin main",
  );
  if (install) cmds.push("pnpm install --no-frozen-lockfile");
  if (schema) cmds.push("pnpm --filter @workspace/db run push");
  if (seed) cmds.push("pnpm --filter @workspace/db run seed-admin");
  if (typecheck) cmds.push("pnpm -w run typecheck");
  if (test) cmds.push("pnpm --filter @workspace/api-server run test");
  if (build) cmds.push("pnpm --filter @workspace/api-server run build");

  const cmd = cmds.join(" && ");

  // Heuristic timeouts. Cold pnpm install can take ~3 min on Replit;
  // schema push and tests are tens of seconds; plain pull should be
  // under 10s.
  const timeoutMs = install ? 4 * 60_000 : test || schema || build ? 90_000 : 30_000;

  req.log.info(
    { cmd, cwd: repoRoot, timeoutMs },
    "admin reload: starting exec",
  );

  const startedAt = Date.now();
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: repoRoot,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env },
    });

    req.log.info(
      { durationMs: Date.now() - startedAt, stderrLen: stderr.length },
      "admin reload: exec completed",
    );

    res.json({
      ok: true,
      mode: force ? "force" : "pull",
      ranAt: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
      steps: { install, schema, seed, typecheck, test, build, restart, exit: exitAfter },
      stdout: stdout.trim(),
      stderr: stderr.trim() || undefined,
    });

    // After a successful build (or an explicit restart=1), nudge
    // nodemon directly by command-name to restart. Going via
    // process.ppid is unreliable on pnpm-launched setups: pnpm wraps
    // the dev script in `sh -c`, so process.ppid points at the shell
    // wrapper, not nodemon. Sending SIGUSR2 to the shell killed it
    // and SIGHUPped the node child (production observation).
    //
    // pkill targets nodemon by command-line match. If pkill succeeds,
    // nodemon catches SIGUSR2 as its restart signal and respawns
    // node cleanly. If pkill fails (no nodemon — e.g. production
    // direct-start), do nothing and rely on the supervisor: the
    // build wrote new dist/, legacyWatch (or any production watcher)
    // will catch up.
    if (build || restart || exitAfter) {
      setTimeout(() => {
        const child = spawn("pkill", ["-USR2", "-f", "nodemon"], {
          stdio: "ignore",
          detached: true,
        });
        child.on("error", (sigErr) => {
          req.log?.warn(
            { err: sigErr },
            "admin reload: pkill -USR2 nodemon failed; bundle change relies on watcher",
          );
        });
        child.unref();
      }, 500);
    }

    // Self-exit fallback for setups where nodemon isn't running.
    // Replit's workflow run command (and the bash supervisor at
    // /tmp/run-api-server.sh) respawns a dead node child from the
    // current dist/index.mjs, so a clean exit forces a deploy of the
    // freshly built bundle. Wait long enough for the response to
    // flush, then exit cleanly.
    if (exitAfter) {
      setTimeout(() => {
        req.log.warn("admin reload: self-exit (exit=1) — supervisor should respawn");
        process.exit(0);
      }, 1500);
    }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    req.log.error(
      { err: e.message, durationMs: Date.now() - startedAt, cmd },
      "admin reload: exec failed",
    );
    res.status(500).json({
      ok: false,
      cmd,
      durationMs: Date.now() - startedAt,
      stderr: (e.stderr || e.message || "unknown error").trim(),
      stdout: (e.stdout || "").trim(),
    });
  }
}

// Constant-time string compare to avoid leaking length/prefix info via
// timing. Falls back to a slower path for unequal lengths but the worst
// case is still O(maxLength) of the longer string.
function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    // Run a dummy comparison so timing is stable for length mismatch.
    const dummy = Buffer.alloc(aBuf.length);
    let _sink = 0;
    for (let i = 0; i < aBuf.length; i++) {
      _sink |= aBuf[i] ^ dummy[i];
    }
    return false;
  }
  let diff = 0;
  for (let i = 0; i < aBuf.length; i++) {
    diff |= aBuf[i] ^ bBuf[i];
  }
  return diff === 0;
}

const router: IRouter = Router();
router.get("/admin/reload", handleReload);
router.post("/admin/reload", handleReload);

export default router;
