import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { Request, Response, NextFunction } from "express";

const { dbMock, stripeMock, sendMock } = vi.hoisted(() => ({
  dbMock: {
    select: vi.fn() as Mock,
    insert: vi.fn() as Mock,
    update: vi.fn() as Mock,
  },
  stripeMock: {
    v2: {
      core: {
        accounts: {
          create: vi.fn() as Mock,
        },
      },
    },
    accountLinks: {
      create: vi.fn() as Mock,
    },
  },
  sendMock: vi.fn() as Mock,
}));

vi.mock("@workspace/db", () => ({
  db: dbMock,
  suppliersTable: {
    id: { name: "id" },
    userId: { name: "user_id" },
    tradingName: { name: "trading_name" },
    contactEmail: { name: "contact_email" },
    instrument: { name: "instrument" },
    bio: { name: "bio" },
    stripeAccountId: { name: "stripe_account_id" },
    stripeOnboardingStatus: { name: "stripe_onboarding_status" },
    stripeCapabilitiesJson: { name: "stripe_capabilities_json" },
    deletedAt: { name: "deleted_at" },
    deletedByUserId: { name: "deleted_by_user_id" },
    createdAt: { name: "created_at" },
  },
  usersTable: {
    id: { name: "id" },
    email: { name: "email" },
    displayName: { name: "display_name" },
  },
  userRolesTable: {
    userId: { name: "user_id" },
    role: { name: "role" },
  },
}));

vi.mock("../../lib/stripe", () => ({
  getStripe: () => stripeMock,
}));

vi.mock("../../lib/email", () => ({
  sendSupplierOnboardingEmail: sendMock,
}));

vi.mock("../../lib/env", () => ({
  getEnv: () => ({
    APP_BASE_URL: "https://example.test",
  }),
}));

// The suppliers router applies requireAuth + requireRole at the
// router level via router.use(). Stub them out to no-ops here so the
// individual handler tests don't need a session-bearing request.
// The auth middleware factories themselves have their own dedicated
// tests in middlewares/auth.test.ts.
vi.mock("../../middlewares/auth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));

import suppliersRouter from "./suppliers";
import { HttpError } from "../../middlewares/errorHandler";

function findHandler(method: "post" | "get" | "patch" | "delete", path: string) {
  const stack = (suppliersRouter as unknown as { stack: unknown[] }).stack;
  for (const layer of stack) {
    const l = layer as {
      route?: { path: string; stack: { method: string; handle: unknown }[] };
    };
    if (l.route && l.route.path === path) {
      // A route with inline auth gates has the actual handler as the
      // LAST entry in the route stack (after requireAuth + requireRole).
      // Grab the final handle for this method, not the first.
      const matches = l.route.stack.filter((s) => s.method === method);
      const last = matches[matches.length - 1];
      if (last) {
        return last.handle as (
          req: Request,
          res: Response,
          next: NextFunction,
        ) => Promise<void> | void;
      }
    }
  }
  throw new Error(`handler not found: ${method.toUpperCase()} ${path}`);
}

const handleCreate = findHandler("post", "/admin/suppliers");
const handleGetOne = findHandler("get", "/admin/suppliers/:id");
const handleUpdate = findHandler("patch", "/admin/suppliers/:id");
const handleDelete = findHandler("delete", "/admin/suppliers/:id");
const handleOnboarding = findHandler(
  "post",
  "/admin/suppliers/:id/stripe-onboarding-link",
);
const handleStatus = findHandler("get", "/admin/suppliers/:id/stripe-status");

interface MockRes {
  statusCode: number;
  lastBody?: unknown;
  status: Mock;
  json: Mock;
  end: Mock;
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
  res.end = vi.fn(() => res);
  return res;
}

function makeReq(opts: {
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, string>;
  userId?: string;
}): Partial<Request> & { log: { error: Mock; warn: Mock; info: Mock } } {
  return {
    body: opts.body ?? {},
    params: opts.params ?? {},
    query: opts.query ?? {},
    headers: {},
    session: { userId: opts.userId } as unknown as Request["session"],
    protocol: "https",
    get: vi.fn((header: string) =>
      header.toLowerCase() === "host" ? "example.test" : undefined,
    ) as unknown as Request["get"],
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  } as Partial<Request> & {
    log: { error: Mock; warn: Mock; info: Mock };
  };
}

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

describe("POST /admin/suppliers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a supplier and returns 201", async () => {
    // ensureSupplierUser calls select then insert when user is new.
    dbMock.select.mockReturnValueOnce({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([]) }),
      }),
    });
    // First insert call is for usersTable (returning {id})
    let insertCall = 0;
    dbMock.insert.mockImplementation(() => {
      insertCall++;
      if (insertCall === 1) {
        return {
          values: () => ({
            returning: () => Promise.resolve([{ id: "user-1" }]),
          }),
        };
      }
      if (insertCall === 2) {
        // userRolesTable insert (returns the chain with onConflictDoNothing)
        return {
          values: () => ({
            onConflictDoNothing: () => Promise.resolve(),
          }),
        };
      }
      // Third insert is the supplier itself
      return {
        values: () => ({
          returning: () =>
            Promise.resolve([
              {
                id: "sup-1",
                userId: "user-1",
                tradingName: "DJ Alice",
                contactEmail: "alice@example.com",
              },
            ]),
        }),
      };
    });

    const req = makeReq({
      body: {
        tradingName: "DJ Alice",
        contactEmail: "alice@example.com",
      },
    });
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await handleCreate(req as Request, res as unknown as Response, next);

    expect(res.statusCode).toBe(201);
    expect(res.lastBody).toMatchObject({
      id: "sup-1",
      tradingName: "DJ Alice",
    });
  });

  it("rejects malformed body via zod", async () => {
    const req = makeReq({ body: { tradingName: "" } });
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await handleCreate(req as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe("GET /admin/suppliers/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when supplier doesn't exist", async () => {
    dbMock.select.mockReturnValue({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([]) }),
      }),
    });

    const req = makeReq({ params: { id: VALID_UUID } });
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await handleGetOne(req as Request, res as unknown as Response, next);

    const err = (next as Mock).mock.calls[0][0];
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(404);
  });

  it("returns the supplier when found", async () => {
    dbMock.select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([{ id: VALID_UUID, tradingName: "DJ Bob" }]),
        }),
      }),
    });

    const req = makeReq({ params: { id: VALID_UUID } });
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await handleGetOne(req as Request, res as unknown as Response, next);

    expect(res.statusCode).toBe(200);
    expect(res.lastBody).toMatchObject({ id: VALID_UUID });
  });
});

describe("PATCH /admin/suppliers/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects empty body with 400 no_fields_to_update", async () => {
    const req = makeReq({ params: { id: VALID_UUID }, body: {} });
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await handleUpdate(req as Request, res as unknown as Response, next);

    const err = (next as Mock).mock.calls[0][0];
    expect(err.code).toBe("no_fields_to_update");
  });

  it("returns the updated row on success", async () => {
    const returning = vi.fn(() =>
      Promise.resolve([{ id: VALID_UUID, tradingName: "DJ Alice 2" }]),
    );
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    dbMock.update.mockReturnValue({ set });

    const req = makeReq({
      params: { id: VALID_UUID },
      body: { tradingName: "DJ Alice 2" },
    });
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await handleUpdate(req as Request, res as unknown as Response, next);

    expect(res.statusCode).toBe(200);
    expect(res.lastBody).toMatchObject({ tradingName: "DJ Alice 2" });
  });
});

describe("DELETE /admin/suppliers/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("soft-deletes (writes deleted_at), returns 204", async () => {
    const returning = vi.fn(() => Promise.resolve([{ id: VALID_UUID }]));
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    dbMock.update.mockReturnValue({ set });

    const req = makeReq({
      params: { id: VALID_UUID },
      userId: "admin-1",
    });
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await handleDelete(req as Request, res as unknown as Response, next);

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        deletedByUserId: "admin-1",
      }),
    );
    expect(res.statusCode).toBe(204);
  });
});

describe("POST /admin/suppliers/:id/stripe-onboarding-link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates account, generates link, sends email, returns details", async () => {
    dbMock.select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([
              {
                id: VALID_UUID,
                tradingName: "DJ Alice",
                contactEmail: "alice@example.com",
                stripeAccountId: null,
              },
            ]),
        }),
      }),
    });
    const where = vi.fn(() => Promise.resolve());
    const set = vi.fn(() => ({ where }));
    dbMock.update.mockReturnValue({ set });

    stripeMock.v2.core.accounts.create.mockResolvedValue({ id: "acct_123" });
    stripeMock.accountLinks.create.mockResolvedValue({
      url: "https://connect.stripe.com/setup/foo",
    });
    sendMock.mockResolvedValue(undefined);

    const req = makeReq({ params: { id: VALID_UUID } });
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await handleOnboarding(req as Request, res as unknown as Response, next);

    expect(stripeMock.v2.core.accounts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        display_name: "DJ Alice",
        contact_email: "alice@example.com",
        identity: { country: "gb" },
        dashboard: "express",
      }),
    );
    expect(stripeMock.accountLinks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        account: "acct_123",
        type: "account_onboarding",
      }),
    );
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toEmail: "alice@example.com",
        onboardingUrl: "https://connect.stripe.com/setup/foo",
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.lastBody).toMatchObject({
      stripeAccountId: "acct_123",
      onboardingUrl: "https://connect.stripe.com/setup/foo",
    });
  });

  it("reuses existing stripe_account_id rather than creating a new one", async () => {
    dbMock.select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([
              {
                id: VALID_UUID,
                tradingName: "DJ Alice",
                contactEmail: "alice@example.com",
                stripeAccountId: "acct_existing",
              },
            ]),
        }),
      }),
    });
    stripeMock.accountLinks.create.mockResolvedValue({
      url: "https://connect.stripe.com/setup/bar",
    });
    sendMock.mockResolvedValue(undefined);

    const req = makeReq({ params: { id: VALID_UUID } });
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await handleOnboarding(req as Request, res as unknown as Response, next);

    expect(stripeMock.v2.core.accounts.create).not.toHaveBeenCalled();
    expect(stripeMock.accountLinks.create).toHaveBeenCalledWith(
      expect.objectContaining({ account: "acct_existing" }),
    );
  });

  it("still returns 200 with the link if email send fails (logs)", async () => {
    dbMock.select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([
              {
                id: VALID_UUID,
                tradingName: "DJ Alice",
                contactEmail: "alice@example.com",
                stripeAccountId: "acct_existing",
              },
            ]),
        }),
      }),
    });
    stripeMock.accountLinks.create.mockResolvedValue({
      url: "https://connect.stripe.com/setup/baz",
    });
    sendMock.mockRejectedValue(new Error("Resend down"));

    const req = makeReq({ params: { id: VALID_UUID } });
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await handleOnboarding(req as Request, res as unknown as Response, next);

    expect(res.statusCode).toBe(200);
    const body = res.lastBody as { emailedAt: string | null };
    expect(body.emailedAt).toBeNull();
    expect(req.log.error).toHaveBeenCalled();
  });
});

describe("GET /admin/suppliers/:id/stripe-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the cached Stripe status fields", async () => {
    dbMock.select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([
              {
                id: VALID_UUID,
                stripeAccountId: "acct_123",
                stripeOnboardingStatus: "active",
                stripeCapabilitiesJson: { transfers: "active" },
              },
            ]),
        }),
      }),
    });

    const req = makeReq({ params: { id: VALID_UUID } });
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    await handleStatus(req as Request, res as unknown as Response, next);

    expect(res.statusCode).toBe(200);
    expect(res.lastBody).toMatchObject({
      stripeAccountId: "acct_123",
      stripeOnboardingStatus: "active",
    });
  });
});
