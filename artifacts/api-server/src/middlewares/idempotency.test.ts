import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { Request, Response, NextFunction } from "express";

// Mock the workspace DB module BEFORE importing the middleware. vi.mock
// is hoisted by vitest, so its factory runs before any top-level
// `const`. Lift the shared mock object via vi.hoisted so the same
// reference is visible to both the factory and the test bodies.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    select: vi.fn() as Mock,
    insert: vi.fn() as Mock,
  },
}));

vi.mock("@workspace/db", () => ({
  db: dbMock,
  // The middleware only needs column references for drizzle's query
  // builder; the mocked select/insert ignore them.
  idempotencyReplayTable: {
    key: { name: "key" },
    expiresAt: { name: "expires_at" },
    userId: { name: "user_id" },
  },
}));

import { idempotencyMiddleware } from "./idempotency";
import { HttpError } from "./errorHandler";

// ─── UUIDs used in tests ────────────────────────────────────────────────────
// All four are syntactically valid: third group starts with 4, fourth group
// starts with 8/9/a/b. Distinct values let us assert key isolation.
const VALID_KEY_A = "11111111-1111-4111-8111-111111111111";
const VALID_KEY_B = "22222222-2222-4222-9222-222222222222";
// Version digit is 1 (UUID v1 layout) — must be rejected.
const INVALID_V1_KEY = "11111111-1111-1111-8111-111111111111";

// ─── Test helpers ───────────────────────────────────────────────────────────
type MockReq = Partial<Request> & {
  log: { error: Mock; warn: Mock };
  session: { userId?: string | null };
};

function makeReq(opts: {
  method?: string;
  path?: string;
  idempotencyKey?: string | null;
  userId?: string | null;
}): MockReq {
  return {
    method: opts.method ?? "POST",
    originalUrl: opts.path ?? "/api/test",
    headers: opts.idempotencyKey
      ? { "idempotency-key": opts.idempotencyKey }
      : {},
    session: { userId: opts.userId ?? undefined },
    log: { error: vi.fn(), warn: vi.fn() },
  } as MockReq;
}

interface MockRes {
  statusCode: number;
  lastBody?: unknown;
  status: Mock;
  json: Mock;
  send: Mock;
  on: Mock;
  finishHandler?: () => void;
}

function makeRes(): MockRes {
  const res = {
    statusCode: 200,
    lastBody: undefined as unknown,
  } as MockRes;
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body: unknown) => {
    res.lastBody = body;
    return res;
  });
  res.send = vi.fn((body: unknown) => {
    res.lastBody = body;
    return res;
  });
  res.on = vi.fn((event: string, handler: () => void) => {
    if (event === "finish") {
      res.finishHandler = handler;
    }
    return res;
  });
  return res;
}

function stubSelectResult(rows: unknown[]) {
  dbMock.select.mockReturnValue({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(rows),
      }),
    }),
  });
}

function stubInsert() {
  const onConflictDoNothing = vi.fn(() => Promise.resolve());
  const values = vi.fn(() => ({ onConflictDoNothing }));
  dbMock.insert.mockReturnValue({ values });
  return { values, onConflictDoNothing };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("idempotencyMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubSelectResult([]);
    stubInsert();
  });

  describe("method filtering", () => {
    it("bypasses GET requests", async () => {
      const req = makeReq({ method: "GET" });
      const res = makeRes();
      const next = vi.fn() as NextFunction;

      await idempotencyMiddleware(req as Request, res as unknown as Response, next);

      expect(next).toHaveBeenCalledOnce();
      expect(next).toHaveBeenCalledWith(); // no error arg
      expect(dbMock.select).not.toHaveBeenCalled();
    });

    it("bypasses HEAD and OPTIONS requests", async () => {
      for (const method of ["HEAD", "OPTIONS"]) {
        const req = makeReq({ method });
        const res = makeRes();
        const next = vi.fn() as NextFunction;
        await idempotencyMiddleware(req as Request, res as unknown as Response, next);
        expect(next).toHaveBeenCalledWith();
      }
      expect(dbMock.select).not.toHaveBeenCalled();
    });
  });

  describe("header validation", () => {
    it("returns 400 idempotency_key_required when header is missing", async () => {
      const req = makeReq({ method: "POST", idempotencyKey: null });
      const res = makeRes();
      const next = vi.fn() as NextFunction;

      await idempotencyMiddleware(req as Request, res as unknown as Response, next);

      const err = (next as Mock).mock.calls[0][0];
      expect(err).toBeInstanceOf(HttpError);
      expect(err.status).toBe(400);
      expect(err.code).toBe("idempotency_key_required");
      expect(dbMock.select).not.toHaveBeenCalled();
    });

    it("returns 400 idempotency_key_invalid when header is not a UUID v4", async () => {
      const req = makeReq({ method: "POST", idempotencyKey: "not-a-uuid" });
      const res = makeRes();
      const next = vi.fn() as NextFunction;

      await idempotencyMiddleware(req as Request, res as unknown as Response, next);

      const err = (next as Mock).mock.calls[0][0];
      expect(err).toBeInstanceOf(HttpError);
      expect(err.status).toBe(400);
      expect(err.code).toBe("idempotency_key_invalid");
    });

    it("rejects a UUID v1 (wrong version digit)", async () => {
      const req = makeReq({ method: "POST", idempotencyKey: INVALID_V1_KEY });
      const res = makeRes();
      const next = vi.fn() as NextFunction;

      await idempotencyMiddleware(req as Request, res as unknown as Response, next);

      const err = (next as Mock).mock.calls[0][0];
      expect(err.code).toBe("idempotency_key_invalid");
    });
  });

  describe("replay", () => {
    it("returns the cached response without invoking next() when key+path+user match", async () => {
      stubSelectResult([
        {
          key: VALID_KEY_A,
          userId: "user-1",
          path: "/api/test",
          method: "POST",
          statusCode: 201,
          responseBody: { ok: true, n: 1 },
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        },
      ]);

      const req = makeReq({
        method: "POST",
        path: "/api/test",
        idempotencyKey: VALID_KEY_A,
        userId: "user-1",
      });
      const res = makeRes();
      const next = vi.fn() as NextFunction;

      await idempotencyMiddleware(req as Request, res as unknown as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ ok: true, n: 1 });
    });

    it("returns 409 idempotency_key_collision when path differs", async () => {
      stubSelectResult([
        {
          key: VALID_KEY_A,
          userId: "user-1",
          path: "/api/originals",
          method: "POST",
          statusCode: 201,
          responseBody: { ok: true },
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        },
      ]);

      const req = makeReq({
        method: "POST",
        path: "/api/different-path",
        idempotencyKey: VALID_KEY_A,
        userId: "user-1",
      });
      const res = makeRes();
      const next = vi.fn() as NextFunction;

      await idempotencyMiddleware(req as Request, res as unknown as Response, next);

      const err = (next as Mock).mock.calls[0][0];
      expect(err).toBeInstanceOf(HttpError);
      expect(err.status).toBe(409);
      expect(err.code).toBe("idempotency_key_collision");
    });

    it("returns 409 idempotency_key_collision when user differs", async () => {
      stubSelectResult([
        {
          key: VALID_KEY_A,
          userId: "user-1",
          path: "/api/test",
          method: "POST",
          statusCode: 201,
          responseBody: { ok: true },
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        },
      ]);

      const req = makeReq({
        method: "POST",
        path: "/api/test",
        idempotencyKey: VALID_KEY_A,
        userId: "user-2",
      });
      const res = makeRes();
      const next = vi.fn() as NextFunction;

      await idempotencyMiddleware(req as Request, res as unknown as Response, next);

      const err = (next as Mock).mock.calls[0][0];
      expect(err.status).toBe(409);
      expect(err.code).toBe("idempotency_key_collision");
    });

    it("treats both unauthenticated as the same user (null === null)", async () => {
      stubSelectResult([
        {
          key: VALID_KEY_A,
          userId: null,
          path: "/api/test",
          method: "POST",
          statusCode: 201,
          responseBody: { ok: true },
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        },
      ]);

      const req = makeReq({
        method: "POST",
        path: "/api/test",
        idempotencyKey: VALID_KEY_A,
        userId: null,
      });
      const res = makeRes();
      const next = vi.fn() as NextFunction;

      await idempotencyMiddleware(req as Request, res as unknown as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });
  });

  describe("first-time request", () => {
    it("calls next() when no row exists and persists the response on 2xx finish", async () => {
      const insertStub = stubInsert();

      const req = makeReq({
        method: "POST",
        path: "/api/test",
        idempotencyKey: VALID_KEY_B,
        userId: "user-1",
      });
      const res = makeRes();
      const next = vi.fn() as NextFunction;

      await idempotencyMiddleware(req as Request, res as unknown as Response, next);

      expect(next).toHaveBeenCalledOnce();
      expect(next).toHaveBeenCalledWith(); // no error

      // Simulate the downstream handler responding with 201.
      res.statusCode = 201;
      res.json({ created: true });

      // Trigger the 'finish' listener that was registered.
      expect(res.finishHandler).toBeDefined();
      res.finishHandler!();

      // Persistence runs asynchronously inside the listener; flush microtasks.
      await Promise.resolve();
      await Promise.resolve();

      expect(dbMock.insert).toHaveBeenCalledOnce();
      expect(insertStub.values).toHaveBeenCalledWith(
        expect.objectContaining({
          key: VALID_KEY_B,
          userId: "user-1",
          path: "/api/test",
          method: "POST",
          statusCode: 201,
          responseBody: { created: true },
        }),
      );
      expect(insertStub.onConflictDoNothing).toHaveBeenCalledOnce();
    });

    it("does NOT persist when the response is 4xx", async () => {
      const req = makeReq({
        method: "POST",
        path: "/api/test",
        idempotencyKey: VALID_KEY_B,
        userId: "user-1",
      });
      const res = makeRes();
      const next = vi.fn() as NextFunction;

      await idempotencyMiddleware(req as Request, res as unknown as Response, next);
      expect(next).toHaveBeenCalledWith();

      res.statusCode = 422;
      res.json({ error: { code: "validation_error" } });
      res.finishHandler!();
      await Promise.resolve();

      expect(dbMock.insert).not.toHaveBeenCalled();
    });

    it("does NOT persist when the response is 5xx", async () => {
      const req = makeReq({
        method: "POST",
        path: "/api/test",
        idempotencyKey: VALID_KEY_B,
        userId: "user-1",
      });
      const res = makeRes();
      const next = vi.fn() as NextFunction;

      await idempotencyMiddleware(req as Request, res as unknown as Response, next);

      res.statusCode = 500;
      res.json({ error: { code: "internal_error" } });
      res.finishHandler!();
      await Promise.resolve();

      expect(dbMock.insert).not.toHaveBeenCalled();
    });
  });
});
