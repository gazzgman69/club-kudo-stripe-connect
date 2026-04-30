import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import { sql, isNull } from "drizzle-orm";
import {
  db,
  suppliersTable,
  clientsTable,
  gigsTable,
  invoicesTable,
  transfersTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../../middlewares/auth";

interface StatsResponse {
  suppliers: {
    total: number;
    byStatus: Record<string, number>;
  };
  clients: {
    total: number;
  };
  gigs: {
    total: number;
    byStatus: Record<string, number>;
  };
  invoices: {
    total: number;
    byStatus: Record<string, number>;
    totalAmountPence: number;
    totalPaidPence: number;
  };
  transfers: {
    total: number;
    byStatus: Record<string, number>;
    totalAmountPence: number;
  };
}

async function handleGetStats(_req: Request, res: Response): Promise<void> {
  // Suppliers — group by stripe_onboarding_status, exclude soft-deleted.
  const supplierRows = await db
    .select({
      status: suppliersTable.stripeOnboardingStatus,
      count: sql<number>`count(*)::int`,
    })
    .from(suppliersTable)
    .where(isNull(suppliersTable.deletedAt))
    .groupBy(suppliersTable.stripeOnboardingStatus);

  // Clients
  const clientRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(clientsTable)
    .where(isNull(clientsTable.deletedAt));

  // Gigs by status
  const gigRows = await db
    .select({
      status: gigsTable.status,
      count: sql<number>`count(*)::int`,
    })
    .from(gigsTable)
    .where(isNull(gigsTable.deletedAt))
    .groupBy(gigsTable.status);

  // Invoices by status + totals
  const invoiceRows = await db
    .select({
      status: invoicesTable.status,
      count: sql<number>`count(*)::int`,
      totalAmount: sql<number>`coalesce(sum(${invoicesTable.totalPence}), 0)::bigint`,
    })
    .from(invoicesTable)
    .groupBy(invoicesTable.status);

  // Transfers by status + totals
  const transferRows = await db
    .select({
      status: transfersTable.status,
      count: sql<number>`count(*)::int`,
      totalAmount: sql<number>`coalesce(sum(${transfersTable.amountPence}), 0)::bigint`,
    })
    .from(transfersTable)
    .groupBy(transfersTable.status);

  const stats: StatsResponse = {
    suppliers: {
      total: supplierRows.reduce((s, r) => s + r.count, 0),
      byStatus: Object.fromEntries(supplierRows.map((r) => [r.status, r.count])),
    },
    clients: {
      total: clientRows[0]?.count ?? 0,
    },
    gigs: {
      total: gigRows.reduce((s, r) => s + r.count, 0),
      byStatus: Object.fromEntries(gigRows.map((r) => [r.status, r.count])),
    },
    invoices: {
      total: invoiceRows.reduce((s, r) => s + r.count, 0),
      byStatus: Object.fromEntries(invoiceRows.map((r) => [r.status, r.count])),
      totalAmountPence: invoiceRows.reduce(
        (s, r) => s + Number(r.totalAmount),
        0,
      ),
      totalPaidPence: invoiceRows
        .filter((r) => r.status === "paid")
        .reduce((s, r) => s + Number(r.totalAmount), 0),
    },
    transfers: {
      total: transferRows.reduce((s, r) => s + r.count, 0),
      byStatus: Object.fromEntries(
        transferRows.map((r) => [r.status, r.count]),
      ),
      totalAmountPence: transferRows
        .filter((r) => r.status === "created")
        .reduce((s, r) => s + Number(r.totalAmount), 0),
    },
  };

  res.status(200).json(stats);
}

const router: IRouter = Router();
const gates = [requireAuth, requireRole("admin")] as const;
router.get("/admin/stats", ...gates, handleGetStats);

export default router;
