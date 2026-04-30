import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { Request, Response, NextFunction } from "express";

// Hoist shared mocks via vi.hoisted so the factory inside vi.mock can
// reference them without the "Cannot access before initialization"
// hoisting trap.
const { dbMock, sendMock } = vi.hoisted(() => ({
  dbMock: {
    select: vi.fn() as Mock,
    insert: vi.fn() as Mock,
    update: vi.fn() as Mock,
  },
  sendMock: vi.fn() as Mock,
}));

vi.mock("@workspace/db", () => ({
  db: dbMock,
  usersTable: {
    id: { name: "id" },
    email: { name: "email" },
  },
  magicLinkTokensTable: {
    id: { name: "id" },
    userId: { name: "user_id" },
    tokenHash: { name: "token_hash" },
    expiresAt: { name: "expires_at" },
    usedAt: { name: "used_at" },
  },
}));

vi.mock("../lib/email", () => ({
  sendMagicLinkEmail: sendMock,
}));

vi.mock("../lib/env", () => ({
  getEnv: () => ({
    RESEND_API_KEY: "test-key",
    APP_BASE_URL: "https://example.test",
    EMAIL_FROM: "Test <noreply@example.test>",
    EMAIL_REPLY_TO: undefined,
  }),
}));

import authRouter from "./auth";
import { HttpError } from "../middlewares/errorHandler";

// Express's Router exposes its handler stack via `.stack` — pluck the
// individual handler functions so we can call them directly without
// spinning up an HTTP server.
function findHandler(method: "post" | "get", path: string) {
  // Router internals: stack of layers; each layer has `route` for
  // mounted routes. Find the matching one and return its handler.
  // Cast through unknown so we can poke at the runtime shape.
  const stack = (authRouter as unknown as { stack: unknown[] }).stack;
  for (const layer of stack) {
    const l = layer as {
      route?: {
        path: string;
        stack: { method: string; handle: unknown }[];
      };
    };
    if (l.route && l.route.path === path) {
      const layerEntry = l.route.stack.find((s) => s.method === method);
      if (layerEntry) {
        return layerEntry.handle as (
          req: Request,
          res: Response,
          next: NextFunction,
        ) => Promise<void> | void;
      }
    }
  }
  throw new Error(`handler not found: ${method.toUpperCase()} ${path}`);
}

const handleRequestMagicLink = findHandler("post", "/auth/magic-link");
const handleVerifyToken = findHandler("get", "/auth/verify");

// ─── Helpers ────────────────────────────────────────────────────────────────

interface MockRes {
  statusCode: number;
  lastBody?: unknown;
  status: Mock;
  json: Mock;
}

function makeRes(): MockRes {
  const res = { statusCode: 200, lastBody: undefined as unknown } as MockRes;
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body: unknown) => {
    res.lastBody = body;
    return res;
  });
  return res;
}

function makeReq(opts: {
  body?: unknown;
  query?: Record<string, string>;
  session?: Record<string, unknown>;
}): Partial<Request> & { log: { error: Mock; warn: Mock; info: Mock } } {
  return {
    body: opts.body ?? {},
    query: opts.query ?? {},
    headers: {},
    session: (opts.session ?? {}) as Request["session"],
    protocol: "https",
    get: vi.fn((header: string) =>
      header.toLowerCase() === "host" ? "example.test" : undefined,
    ) as unknown as Request["get"],
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  } as Partial<Request> & {
    log: { error: Mock; warn: Mock; info: Mock };
  };
}

// Stub the chained drizzle select/where/limit returning a list of rows.
function stubSelect(rows: unknown[]) {
  dbMock.select.mockReturnValue({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(rows),
      }),
      innerJoin: () => ({
        where: () => ({
          limit: () => Promise.resolve(rows),
        }),
      }),
    }),
  });
}

function stubInsert() {
  const values = vi.fn(() => Promise.resolve());
  dbMock.insert.mockReturnValue({ values });
  return values;
}

function stubUpdate(returningRows: unknown[]) {
  const returning = vi.fn(() => Promise.resolve(returningRows));
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  dbMock.update.mockReturnValue({ set });
  return { set, where, returning };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("POST /auth/magic-link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubSelect([]);
    stubInsert();
    sendMock.mockResolvedValue(undefined);
  });

  it("returns generic 200 for a known email and sends an email", async () => {
    stubSelect([{ id: "user-1", email: "alice@example.com" }]);
    const insertValues = stubInsert();

    const req = makeReq({ body: { email: "alice@example.com" } });
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await handleRequestMagicLink(req as Request, res as unknown as Response, next);

    expect(res.statusCode).toBe(200);
    expect(res.lastBody).toMatchObject({ ok: true });
    expect(insertValues).toHaveBeenCalledOnce();
    expect(sendMock).toHaveBeenCalledOnce();
    const sendArgs = sendMock.mock.calls[0][0];
    expect(sendArgs.toEmail).toBe("alice@example.com");
    expect(sendArgs.magicLink).toMatch(
      /^https:\/\/example\.test\/api\/auth\/verify\?token=[0-9a-f]{64}$/,
    );
  });

  it("returns the same generic 200 for an unknown email and does NOT send", async () => {
    stubSelect([]); // no user

    const req = makeReq({ body: { email: "stranger@example.com" } });
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await handleRequestMagicLink(req as Request, res as unknown as Response, next);

    expect(res.statusCode).toBe(200);
    expect(res.lastBody).toMatchObject({ ok: true });
    expect(sendMock).not.toHaveBeenCalled();
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it("response body is identical for known vs unknown emails (anti-enumeration)", async () => {
    stubSelect([{ id: "user-1", email: "alice@example.com" }]);
    const reqA = makeReq({ body: { email: "alice@example.com" } });
    const resA = makeRes();
    await handleRequestMagicLink(
      reqA as Request,
      resA as unknown as Response,
      vi.fn(),
    );

    stubSelect([]);
    const reqB = makeReq({ body: { email: "stranger@example.com" } });
    const resB = makeRes();
    await handleRequestMagicLink(
      reqB as Request,
      resB as unknown as Response,
      vi.fn(),
    );

    expect(resA.lastBody).toEqual(resB.lastBody);
    expect(resA.statusCode).toBe(resB.statusCode);
  });

  it("rejects an invalid email body via the zod schema", async () => {
    const req = makeReq({ body: { email: "not-an-email" } });
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await handleRequestMagicLink(req as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.json).not.toHaveBeenCalled();
  });

  it(
    "enforces a minimum response time so timing doesn't leak whether the email is known",
    async () => {
      stubSelect([{ id: "user-1", email: "alice@example.com" }]);
      const t0 = Date.now();
      await handleRequestMagicLink(
        makeReq({ body: { email: "alice@example.com" } }) as Request,
        makeRes() as unknown as Response,
        vi.fn(),
      );
      const knownMs = Date.now() - t0;

      stubSelect([]);
      const t1 = Date.now();
      await handleRequestMagicLink(
        makeReq({ body: { email: "stranger@example.com" } }) as Request,
        makeRes() as unknown as Response,
        vi.fn(),
      );
      const unknownMs = Date.now() - t1;

      // Both should clear the floor (~800ms).
      expect(knownMs).toBeGreaterThanOrEqual(750);
      expect(unknownMs).toBeGreaterThanOrEqual(750);
    },
    { timeout: 5000 },
  );

  it("still returns 200 if the email send throws (logs but doesn't leak)", async () => {
    stubSelect([{ id: "user-1", email: "alice@example.com" }]);
    sendMock.mockRejectedValueOnce(new Error("Resend down"));

    const req = makeReq({ body: { email: "alice@example.com" } });
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await handleRequestMagicLink(req as Request, res as unknown as Response, next);

    expect(res.statusCode).toBe(200);
    expect(req.log.error).toHaveBeenCalled();
  });
});

describe("GET /auth/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const VALID_TOKEN = "a".repeat(64);

  it("returns 401 magic_link_invalid when no token row matches", async () => {
    stubSelect([]);

    const req = makeReq({ query: { token: VALID_TOKEN } });
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await handleVerifyToken(req as Request, res as unknown as Response, next);

    const err = (next as Mock).mock.calls[0][0];
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(401);
    expect(err.code).toBe("magic_link_invalid");
  });

  it("rejects a malformed token with a zod 400", async () => {
    const req = makeReq({ query: { token: "too-short" } });
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await handleVerifyToken(req as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledOnce();
    // The handler should not have proceeded to a DB call.
    expect(dbMock.select).not.toHaveBeenCalled();
  });

  it("succeeds, marks the token used, and sets the session on a valid token", async () => {
    stubSelect([
      {
        tokenId: "tok-1",
        userId: "user-1",
        userEmail: "alice@example.com",
      },
    ]);
    const updateStub = stubUpdate([{ id: "tok-1" }]);

    const session: Record<string, unknown> = {};
    const req = makeReq({
      query: { token: VALID_TOKEN },
      session,
    });
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await handleVerifyToken(req as Request, res as unknown as Response, next);

    expect(res.statusCode).toBe(200);
    expect(res.lastBody).toMatchObject({
      ok: true,
      user: { id: "user-1", email: "alice@example.com" },
    });
    expect(updateStub.set).toHaveBeenCalledOnce();
    expect(session.userId).toBe("user-1");
    expect(session.userEmail).toBe("alice@example.com");
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 if the consume-update finds nothing (race lost)", async () => {
    stubSelect([
      {
        tokenId: "tok-1",
        userId: "user-1",
        userEmail: "alice@example.com",
      },
    ]);
    stubUpdate([]); // returning [] means UPDATE matched zero rows

    const req = makeReq({ query: { token: VALID_TOKEN } });
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await handleVerifyToken(req as Request, res as unknown as Response, next);

    const err = (next as Mock).mock.calls[0][0];
    expect(err).toBeInstanceOf(HttpError);
    expect(err.code).toBe("magic_link_invalid");
  });
});
