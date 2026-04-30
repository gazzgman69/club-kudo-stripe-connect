import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type {
  Invoice,
  InvoiceStatus,
  InvoiceType,
  PaginatedList,
} from "@/lib/types";
import { formatDate, formatPence, statusBadgeClasses } from "@/lib/format";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const TYPE_LABELS: Record<InvoiceType, string> = {
  reservation: "Reservation",
  balance: "Balance",
  self_billing: "Self-billing",
};

const STATUS_OPTIONS: ("" | InvoiceStatus)[] = [
  "",
  "draft",
  "open",
  "paid",
  "void",
  "uncollectible",
];

const TYPE_OPTIONS: ("" | InvoiceType)[] = [
  "",
  "reservation",
  "balance",
  "self_billing",
];

export default function AdminInvoicesListPage() {
  const [, setLocation] = useLocation();
  const [cursor, setCursor] = useState<string | null>(null);
  const [stack, setStack] = useState<(string | null)[]>([null]);
  const [status, setStatus] = useState<"" | InvoiceStatus>("");
  const [type, setType] = useState<"" | InvoiceType>("");

  const query = useQuery({
    queryKey: ["admin-invoices", cursor, status, type],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "25" });
      if (cursor) params.set("cursor", cursor);
      if (status) params.set("status", status);
      if (type) params.set("type", type);
      return apiFetch<PaginatedList<Invoice>>(
        `/api/admin/invoices?${params.toString()}`,
      );
    },
  });

  function resetCursor() {
    setCursor(null);
    setStack([null]);
  }

  return (
    <AdminShell>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Invoices</h1>
          <p className="text-sm text-gray-500">
            Reservation, balance, and self-billing invoices across all gigs.
          </p>
        </div>
      </div>

      <Card className="mb-4">
        <CardContent className="p-4 flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Status</span>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as "" | InvoiceStatus);
                resetCursor();
              }}
              className="border border-gray-300 rounded px-2 py-1.5 bg-white"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s === "" ? "All statuses" : s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Type</span>
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value as "" | InvoiceType);
                resetCursor();
              }}
              className="border border-gray-300 rounded px-2 py-1.5 bg-white"
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t === "" ? "All types" : TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          {(status || type) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setStatus("");
                setType("");
                resetCursor();
              }}
            >
              Clear filters
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {query.isPending ? (
            <div className="p-6 text-sm text-gray-500">Loading…</div>
          ) : query.isError ? (
            <div className="p-6 text-sm text-red-600">
              Failed to load: {(query.error as Error).message}
            </div>
          ) : !query.data?.items.length ? (
            <div className="p-6 text-sm text-gray-500">
              No invoices match these filters.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Number</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Gig</th>
                  <th className="px-4 py-2 font-medium">Client</th>
                  <th className="px-4 py-2 font-medium text-right">Total</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {query.data.items.map((inv) => (
                  <tr
                    key={inv.id}
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => setLocation(`/admin/invoices/${inv.id}`)}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">
                      {inv.number ?? inv.id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {TYPE_LABELS[inv.invoiceType]}
                    </td>
                    <td className="px-4 py-3 text-gray-900">
                      {inv.gigName ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {inv.clientName ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900 font-medium">
                      {formatPence(inv.totalPence, inv.currency.toUpperCase())}
                    </td>
                    <td className="px-4 py-3">
                      <span className={statusBadgeClasses(inv.status)}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {formatDate(inv.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between mt-4">
        <Button
          variant="outline"
          size="sm"
          disabled={stack.length <= 1}
          onClick={() => {
            const next = [...stack];
            next.pop();
            setStack(next);
            setCursor(next[next.length - 1]);
          }}
        >
          ← Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!query.data?.nextCursor}
          onClick={() => {
            if (!query.data?.nextCursor) return;
            setStack((s) => [...s, query.data!.nextCursor]);
            setCursor(query.data.nextCursor);
          }}
        >
          Next →
        </Button>
      </div>
    </AdminShell>
  );
}
