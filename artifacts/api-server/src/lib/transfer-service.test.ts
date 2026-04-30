import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// ─── Test scaffolding ───────────────────────────────────────────────────────
// vi.mock is hoisted, so any reference made by the factory must come
// from vi.hoisted to ensure the same object identity in tests.
const { dbMock, stripeMock } = vi.hoisted(() => ({
  dbMock: {
    select: vi.fn() as Mock,
    insert: vi.fn() as Mock,
  },
  stripeMock: {
    transfers: {
      create: vi.fn() as Mock,
    },
  },
}));

vi.mock("@workspace/db", () => ({
  db: dbMock,
  // Drizzle column refs — the mocked db ignores them.
  gigsTable: { id: { name: "id" }, deletedAt: { name: "deleted_at" } },
  gigLineItemsTable: {
    id: { name: "id" },
    gigId: { name: "gig_id" },
    supplierId: { name: "supplier_id" },
    isPlatformLine: { name: "is_platform_line" },
  },
  invoicesTable: {
    id: { name: "id" },
    gigId: { name: "gig_id" },
  },
  suppliersTable: {
    id: { name: "id" },
  },
  transfersTable: {
    id: { name: "id" },
    gigId: { name: "gig_id" },
  },
  platformSettingsTable: {
    id: { name: "id" },
  },
}));

vi.mock("./stripe", () => ({
  getStripe: () => stripeMock,
}));

import { createTransfersForGig } from "./transfer-service";

// ─── Helpers ────────────────────────────────────────────────────────────────

const GIG_ID = "11111111-1111-4111-8111-111111111111";
const LINE_ID = "22222222-2222-4222-8222-222222222222";
const SUPPLIER_ID = "33333333-3333-4333-8333-333333333333";
const CHARGE_ID = "ch_test_balance";

interface FakeQueryShape {
  rows: unknown[];
}

/**
 * Build a chainable mock for `db.select().from().where()...limit()` so
 * the transfer service's drizzle queries can be answered with canned
 * data. Each call to db.select() shifts the next entry from the queue.
 */
function queueSelect(queue: FakeQueryShape[]): void {
  let i = 0;
  dbMock.select.mockImplementation(() => {
    const idx = i++;
    const next = queue[idx] ?? { rows: [] };
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.innerJoin = vi.fn().mockReturnValue(chain);
    chain.leftJoin = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockResolvedValue(next.rows);
    // For queries without .limit(), make the chain itself thenable so
    // `await db.select().from().where()` resolves to the rows.
    chain.then = (resolve: (v: unknown) => void) => resolve(next.rows);
    return chain;
  });
}

/**
 * Build a chainable mock for `db.insert(t).values(v).returning()` that
 * returns the values back as if the row were inserted with an id.
 */
function setupInsertEcho(): void {
  dbMock.insert.mockImplementation(() => ({
    values: (v: Record<string, unknown>) => ({
      returning: () =>
        Promise.resolve([
          {
            id: "new-row-id",
            createdAt: new Date(),
            updatedAt: new Date(),
            ...v,
          },
        ]),
    }),
  }));
}

beforeEach(() => {
  dbMock.select.mockReset();
  dbMock.insert.mockReset();
  stripeMock.transfers.create.mockReset();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("createTransfersForGig", () => {
  it("returns gig_not_found when no gig row exists", async () => {
    queueSelect([{ rows: [] /* gig lookup → empty */ }]);
    const result = await createTransfersForGig(GIG_ID);
    expect(result).toEqual({ ok: false, reason: "gig_not_found" });
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
  });

  it("returns no_paid_invoices when no invoice has a charge", async () => {
    queueSelect([
      { rows: [{ id: GIG_ID, deletedAt: null }] }, // gig
      { rows: [{ id: "inv-1", gigId: GIG_ID, stripeChargeId: null, status: "open", invoiceType: "balance" }] }, // invoices
    ]);
    const result = await createTransfersForGig(GIG_ID);
    expect(result).toEqual({ ok: false, reason: "no_paid_invoices" });
  });

  it("returns settings_missing when platform_settings is empty", async () => {
    queueSelect([
      { rows: [{ id: GIG_ID, deletedAt: null }] },
      {
        rows: [
          {
            id: "inv-1",
            gigId: GIG_ID,
            stripeChargeId: CHARGE_ID,
            status: "paid",
            invoiceType: "balance",
          },
        ],
      },
      { rows: [] /* settings */ },
    ]);
    const result = await createTransfersForGig(GIG_ID);
    expect(result).toEqual({ ok: false, reason: "settings_missing" });
  });

  it("creates a Stripe transfer and inserts a row for a happy path", async () => {
    queueSelect([
      { rows: [{ id: GIG_ID, deletedAt: null }] },
      {
        rows: [
          {
            id: "inv-1",
            gigId: GIG_ID,
            stripeChargeId: CHARGE_ID,
            status: "paid",
            invoiceType: "balance",
          },
        ],
      },
      { rows: [{ id: "singleton", currency: "gbp" }] },
      {
        rows: [
          {
            lineItem: {
              id: LINE_ID,
              gigId: GIG_ID,
              supplierId: SUPPLIER_ID,
              amountPence: 50000,
              vatRateBps: 2000,
              invoicePhase: "balance",
              isPlatformLine: false,
            },
            supplier: {
              id: SUPPLIER_ID,
              stripeAccountId: "acct_test_supplier",
            },
          },
        ],
      },
      { rows: [] /* existing transfers — none */ },
    ]);
    setupInsertEcho();
    stripeMock.transfers.create.mockResolvedValue({ id: "tr_test_xyz" });

    const result = await createTransfersForGig(GIG_ID);

    expect(result.ok).toBe(true);
    expect(result.transfers).toHaveLength(1);
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
    const [args, options] = stripeMock.transfers.create.mock.calls[0];
    // 50,000p + 20% VAT = 60,000p gross
    expect(args.amount).toBe(60000);
    expect(args.currency).toBe("gbp");
    expect(args.destination).toBe("acct_test_supplier");
    expect(args.source_transaction).toBe(CHARGE_ID);
    expect(args.transfer_group).toBe(GIG_ID);
    expect(options?.idempotencyKey).toMatch(/^transfer-/);
    expect(result.transfers?.[0].transfer.status).toBe("created");
    expect(result.transfers?.[0].transfer.stripeTransferId).toBe("tr_test_xyz");
  });

  it("skips a line item that already has a transfer row", async () => {
    queueSelect([
      { rows: [{ id: GIG_ID, deletedAt: null }] },
      {
        rows: [
          {
            id: "inv-1",
            gigId: GIG_ID,
            stripeChargeId: CHARGE_ID,
            status: "paid",
            invoiceType: "balance",
          },
        ],
      },
      { rows: [{ id: "singleton", currency: "gbp" }] },
      {
        rows: [
          {
            lineItem: {
              id: LINE_ID,
              gigId: GIG_ID,
              supplierId: SUPPLIER_ID,
              amountPence: 50000,
              vatRateBps: 0,
              invoicePhase: "balance",
              isPlatformLine: false,
            },
            supplier: { id: SUPPLIER_ID, stripeAccountId: "acct_test" },
          },
        ],
      },
      {
        rows: [
          {
            id: "tr_existing",
            gigId: GIG_ID,
            gigLineItemId: LINE_ID,
            supplierId: SUPPLIER_ID,
            status: "created",
          },
        ],
      },
    ]);
    setupInsertEcho();

    const result = await createTransfersForGig(GIG_ID);

    expect(result.ok).toBe(true);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(result.transfers?.[0].skipped).toBe(true);
  });

  it("inserts a failed transfer when the supplier has no Stripe account", async () => {
    queueSelect([
      { rows: [{ id: GIG_ID, deletedAt: null }] },
      {
        rows: [
          {
            id: "inv-1",
            gigId: GIG_ID,
            stripeChargeId: CHARGE_ID,
            status: "paid",
            invoiceType: "balance",
          },
        ],
      },
      { rows: [{ id: "singleton", currency: "gbp" }] },
      {
        rows: [
          {
            lineItem: {
              id: LINE_ID,
              gigId: GIG_ID,
              supplierId: SUPPLIER_ID,
              amountPence: 50000,
              vatRateBps: 0,
              invoicePhase: "balance",
              isPlatformLine: false,
            },
            supplier: { id: SUPPLIER_ID, stripeAccountId: null },
          },
        ],
      },
      { rows: [] },
    ]);
    setupInsertEcho();

    const result = await createTransfersForGig(GIG_ID);

    expect(result.ok).toBe(true);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(result.transfers?.[0].transfer.status).toBe("failed");
    expect(result.transfers?.[0].transfer.failureReason).toBe(
      "supplier_not_onboarded",
    );
  });

  it("inserts a failed transfer when stripe.transfers.create throws", async () => {
    queueSelect([
      { rows: [{ id: GIG_ID, deletedAt: null }] },
      {
        rows: [
          {
            id: "inv-1",
            gigId: GIG_ID,
            stripeChargeId: CHARGE_ID,
            status: "paid",
            invoiceType: "balance",
          },
        ],
      },
      { rows: [{ id: "singleton", currency: "gbp" }] },
      {
        rows: [
          {
            lineItem: {
              id: LINE_ID,
              gigId: GIG_ID,
              supplierId: SUPPLIER_ID,
              amountPence: 50000,
              vatRateBps: 0,
              invoicePhase: "balance",
              isPlatformLine: false,
            },
            supplier: { id: SUPPLIER_ID, stripeAccountId: "acct_x" },
          },
        ],
      },
      { rows: [] },
    ]);
    setupInsertEcho();
    stripeMock.transfers.create.mockRejectedValue(
      new Error("balance_insufficient"),
    );

    const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    const result = await createTransfersForGig(GIG_ID, { log });

    expect(result.ok).toBe(true);
    expect(result.transfers?.[0].transfer.status).toBe("failed");
    expect(result.transfers?.[0].transfer.failureReason).toBe(
      "balance_insufficient",
    );
    expect(log.error).toHaveBeenCalled();
  });

  it("skips a balance line item when only the reservation invoice is paid", async () => {
    queueSelect([
      { rows: [{ id: GIG_ID, deletedAt: null }] },
      {
        rows: [
          {
            id: "inv-1",
            gigId: GIG_ID,
            stripeChargeId: "ch_reservation",
            status: "paid",
            invoiceType: "reservation",
          },
        ],
      },
      { rows: [{ id: "singleton", currency: "gbp" }] },
      {
        rows: [
          {
            lineItem: {
              id: LINE_ID,
              gigId: GIG_ID,
              supplierId: SUPPLIER_ID,
              amountPence: 50000,
              vatRateBps: 0,
              invoicePhase: "balance", // unpaid phase
              isPlatformLine: false,
            },
            supplier: { id: SUPPLIER_ID, stripeAccountId: "acct_x" },
          },
        ],
      },
      { rows: [] },
    ]);
    setupInsertEcho();

    const result = await createTransfersForGig(GIG_ID);

    expect(result.ok).toBe(true);
    expect(result.transfers).toEqual([]);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
  });
});
