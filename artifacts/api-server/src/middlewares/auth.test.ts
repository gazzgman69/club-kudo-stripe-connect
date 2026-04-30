import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { Request, Response, NextFunction } from "express";

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    select: vi.fn() as Mock,
  },
}));

vi.mock("@workspace/db", () => ({
  db: dbMock,
  userRolesTable: {
    userId: { name: "user_id" },
    role: { name: "role" },
  },
}));

import { requireAuth, requireRole } from "./auth";
import { HttpError } from "./errorHandler";

function makeReq(opts: { userId?: string }): Partial<Request> {
  return {
    session: { userId: opts.userId } as unknown as Request["session"],
  };
}

const noopRes = {} as unknown as Response;

function stubRoles(rows: { role: string }[]) {
  dbMock.select.mockReturnValue({
    from: () => ({
      where: () => Promise.resolve(rows),
    }),
  });
}

describe("requireAuth", () => {
  it("calls next() with 401 when session has no userId", () => {
    const req = makeReq({});
    const next = vi.fn() as NextFunction;
    requireAuth(req as Request, noopRes, next);
    const err = (next as Mock).mock.calls[0][0];
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(401);
    expect(err.code).toBe("unauthorized");
  });

  it("calls next() with no error when session has a userId", () => {
    const req = makeReq({ userId: "user-1" });
    const next = vi.fn() as NextFunction;
    requireAuth(req as Request, noopRes, next);
    expect(next).toHaveBeenCalledWith();
  });
});

describe("requireRole", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws if called with no roles", () => {
    expect(() => requireRole()).toThrow();
  });

  it("returns 401 when no session userId", async () => {
    const mw = requireRole("admin");
    const req = makeReq({});
    const next = vi.fn() as NextFunction;
    await mw(req as Request, noopRes, next);
    const err = (next as Mock).mock.calls[0][0];
    expect(err.status).toBe(401);
  });

  it("returns 403 when user has none of the required roles", async () => {
    stubRoles([{ role: "supplier" }]);
    const mw = requireRole("admin");
    const req = makeReq({ userId: "user-1" });
    const next = vi.fn() as NextFunction;
    await mw(req as Request, noopRes, next);
    const err = (next as Mock).mock.calls[0][0];
    expect(err.status).toBe(403);
    expect(err.code).toBe("forbidden");
  });

  it("calls next() cleanly when user has the required role", async () => {
    stubRoles([{ role: "admin" }]);
    const mw = requireRole("admin");
    const req = makeReq({ userId: "user-1" });
    const next = vi.fn() as NextFunction;
    await mw(req as Request, noopRes, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("admits the user if any of multiple required roles match", async () => {
    stubRoles([{ role: "supplier" }]);
    const mw = requireRole("admin", "supplier");
    const req = makeReq({ userId: "user-1" });
    const next = vi.fn() as NextFunction;
    await mw(req as Request, noopRes, next);
    expect(next).toHaveBeenCalledWith();
  });
});
