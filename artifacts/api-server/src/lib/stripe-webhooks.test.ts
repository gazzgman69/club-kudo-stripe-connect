import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// Mock the workspace DB module BEFORE importing the webhook dispatcher.
// vi.hoisted ensures the same object identity is visible to both the
// vi.mock factory and the test bodies.
const { dbMock, stripeMock, transferServiceMock } = vi.hoisted(() => ({
  dbMock: {
    select: vi.fn() as Mock,
    insert: vi.fn() as Mock,
    update: vi.fn() as Mock,
  },
  stripeMock: {
    v2: {
      core: {
        events: {
          retrieve: vi.fn() as Mock,
        },
      },
    },
  },
  transferServiceMock: {
    createTransfersForGig: vi.fn() as Mock,
  },
}));

vi.mock("@workspace/db", () => ({
  db: dbMock,
  invoicesTable: {
    id: { name: "id" },
    stripeInvoiceId: { name: "stripe_invoice_id" },
  },
  suppliersTable: { id: { name: "id" } },
  auditLogTable: {
    id: { name: "id" },
    stripeEventId: { name: "stripe_event_id" },
  },
  gigsTable: { id: { name: "id" }, status: { name: "status" } },
}));

vi.mock("./stripe", () => ({
  getStripe: () => stripeMock,
}));

vi.mock("./transfer-service", () => transferServiceMock);

import { dispatchV1Event } from "./stripe-webhooks";

const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };

function withRows(rows: unknown[]): unknown {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue(rows);
  chain.then = (resolve: (v: unknown) => void) => resolve(rows);
  return chain;
}

beforeEach(() => {
  dbMock.select.mockReset();
  dbMock.insert.mockReset();
  dbMock.update.mockReset();
  transferServiceMock.createTransfersForGig.mockReset();
  log.error.mockReset();
  log.warn.mockReset();
  log.info.mockReset();
});

describe("dispatchV1Event — idempotency", () => {
  it("returns false and skips side effects when stripe_event_id already in audit_log", async () => {
    // First select() is the alreadyProcessed lookup — return one row.
    dbMock.select.mockReturnValueOnce(
      withRows([{ id: "audit-row-existing" }]),
    );

    const event = {
      id: "evt_already_seen",
      type: "invoice.paid",
      data: { object: { id: "in_xyz" } },
    } as never;

    const result = await dispatchV1Event(event, { log });

    expect(result).toBe(false);
    expect(dbMock.update).not.toHaveBeenCalled();
    expect(dbMock.insert).not.toHaveBeenCalled();
    expect(transferServiceMock.createTransfersForGig).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "evt_already_seen" }),
      expect.stringContaining("replay"),
    );
  });

  it("returns true and records audit_log on a never-seen event of an unhandled type", async () => {
    // alreadyProcessed → empty
    dbMock.select.mockReturnValueOnce(withRows([]));
    dbMock.insert.mockImplementation(() => ({
      values: vi.fn().mockResolvedValue([{ id: "new-audit-row" }]),
    }));

    const event = {
      id: "evt_unhandled_type",
      type: "charge.refunded", // unhandled in V1 dispatcher
      data: { object: { id: "ch_xyz" } },
    } as never;

    const result = await dispatchV1Event(event, { log });

    expect(result).toBe(true);
    // No side effects on the domain tables — only audit_log insert.
    expect(dbMock.update).not.toHaveBeenCalled();
    expect(dbMock.insert).toHaveBeenCalledTimes(1);
  });
});
