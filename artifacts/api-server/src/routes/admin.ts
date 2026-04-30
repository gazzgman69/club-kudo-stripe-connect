import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execAsync = promisify(exec);

// Repo root, resolved from this file's location at runtime. The build
// emits dist/index.mjs at artifacts/api-server/dist/, so we walk up
// three levels to reach the monorepo root where pnpm-workspace.yaml lives.
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

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
 *   typecheck=1                  (off) Run `pnpm -w run typecheck`.
 *   test=1                       (off) Run the api-server test suite
 *                                via vitest.
 *   build=1                      (off) Run `pnpm --filter
 *                                @workspace/api-server run build` to
 *                                regenerate dist/.
 *   restart=1                    (off) After everything else succeeds,
 *                                exit the process so Replit's workflow
 *                                supervisor respawns it. Combine with
 *                                build=1 for a full code deploy.
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
  const typecheck = flag("typecheck");
  const test = flag("test");
  const build = flag("build");
  const restart = flag("restart");

  const cmds: string[] = [];
  cmds.push(
    force
      ? "git fetch origin main && git reset --hard origin/main"
      : "git pull origin main",
  );
  if (install) cmds.push("pnpm install --no-frozen-lockfile");
  if (schema) cmds.push("pnpm --filter @workspace/db run push");
  if (typecheck) cmds.push("pnpm -w run typecheck");
  if (test) cmds.push("pnpm --filter @workspace/api-server run test");
  if (build) cmds.push("pnpm --filter @workspace/api-server run build");

  const cmd = cmds.join(" && ");

  // Heuristic timeouts. Cold pnpm install can take ~2 min on Replit;
  // schema push, build, and tests are typically tens of seconds.
  const timeoutMs = install ? 4 * 60_000 : 2 * 60_000;

  const startedAt = Date.now();
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: repoRoot,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env },
    });

    res.json({
      ok: true,
      mode: force ? "force" : "pull",
      ranAt: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
      steps: { install, schema, typecheck, test, build, restart },
      stdout: stdout.trim(),
      stderr: stderr.trim() || undefined,
    });

    if (restart) {
      // Defer briefly so the response actually flushes before the
      // process exits. Replit's workflow supervisor respawns the
      // process; the next start runs `pnpm run build && pnpm run start`
      // (see api-server package.json `dev` script) which picks up the
      // newly-pulled code.
      setTimeout(() => process.exit(0), 500);
    }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
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
