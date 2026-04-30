import { Link, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/use-session";
import { apiFetch } from "@/lib/api";
import type { PlatformStats } from "@/lib/types";
import { formatPence, statusBadgeClasses } from "@/lib/format";
import { AdminShell } from "@/components/admin-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function StatCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string;
  sublabel?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-gray-500">
          {label}
        </div>
        <div className="mt-1 text-2xl font-semibold text-gray-900">{value}</div>
        {sublabel ? (
          <div className="mt-1 text-xs text-gray-500">{sublabel}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function StatusBreakdown({
  byStatus,
}: {
  byStatus: Record<string, number>;
}) {
  const entries = Object.entries(byStatus).filter(([, n]) => n > 0);
  if (entries.length === 0) {
    return <span className="text-xs text-gray-500">No records yet</span>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {entries.map(([status, count]) => (
        <span
          key={status}
          className={statusBadgeClasses(status)}
          title={`${status}: ${count}`}
        >
          {status.replace(/_/g, " ")} · {count}
        </span>
      ))}
    </div>
  );
}

export default function AdminHomePage() {
  const session = useSession();
  const search = useSearch();
  const justSignedIn = new URLSearchParams(search).get("signed_in") === "1";

  const stats = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => apiFetch<PlatformStats>("/api/admin/stats"),
    refetchOnMount: true,
  });

  const outstandingPence = stats.data
    ? stats.data.invoices.totalAmountPence - stats.data.invoices.totalPaidPence
    : 0;

  return (
    <AdminShell>
      <div className="space-y-6">
        {justSignedIn ? (
          <div className="rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
            Welcome back, {session.data?.user.displayName ?? "there"}.
          </div>
        ) : null}

        <div>
          <h1 className="text-xl font-semibold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500">
            Live snapshot of suppliers, gigs, invoices, and transfers.
          </p>
        </div>

        {stats.isPending ? (
          <Card>
            <CardContent className="p-6 text-sm text-gray-500">
              Loading dashboard…
            </CardContent>
          </Card>
        ) : stats.isError ? (
          <Card>
            <CardContent className="p-6 text-sm text-red-600">
              Failed to load stats: {(stats.error as Error).message}
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard
                label="Suppliers"
                value={String(stats.data.suppliers.total)}
                sublabel={`${stats.data.suppliers.byStatus.active ?? 0} active`}
              />
              <StatCard
                label="Clients"
                value={String(stats.data.clients.total)}
              />
              <StatCard
                label="Gigs"
                value={String(stats.data.gigs.total)}
                sublabel={`${stats.data.gigs.byStatus.balance_paid ?? 0} balance paid`}
              />
              <StatCard
                label="Invoices"
                value={String(stats.data.invoices.total)}
                sublabel={`${stats.data.invoices.byStatus.paid ?? 0} paid`}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard
                label="Total invoiced"
                value={formatPence(stats.data.invoices.totalAmountPence)}
              />
              <StatCard
                label="Total collected"
                value={formatPence(stats.data.invoices.totalPaidPence)}
              />
              <StatCard
                label="Outstanding"
                value={formatPence(outstandingPence)}
                sublabel={
                  outstandingPence > 0 ? "Awaiting payment" : "All settled"
                }
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Gig pipeline</CardTitle>
                </CardHeader>
                <CardContent>
                  <StatusBreakdown byStatus={stats.data.gigs.byStatus} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Invoice mix</CardTitle>
                </CardHeader>
                <CardContent>
                  <StatusBreakdown byStatus={stats.data.invoices.byStatus} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Supplier onboarding</CardTitle>
                </CardHeader>
                <CardContent>
                  <StatusBreakdown byStatus={stats.data.suppliers.byStatus} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Transfers to suppliers</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-sm text-gray-700">
                    {stats.data.transfers.total} total ·{" "}
                    {formatPence(stats.data.transfers.totalAmountPence)} paid
                    out
                  </div>
                  <StatusBreakdown byStatus={stats.data.transfers.byStatus} />
                </CardContent>
              </Card>
            </div>
          </>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Quick links</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3 text-sm">
              <Link
                href="/admin/invoices"
                className="text-blue-600 hover:underline"
              >
                Invoices →
              </Link>
              <Link
                href="/admin/audit-log"
                className="text-blue-600 hover:underline"
              >
                Audit log →
              </Link>
              <Link
                href="/admin/gigs/new"
                className="text-blue-600 hover:underline"
              >
                New gig →
              </Link>
              <Link
                href="/admin/suppliers/new"
                className="text-blue-600 hover:underline"
              >
                New supplier →
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminShell>
  );
}
