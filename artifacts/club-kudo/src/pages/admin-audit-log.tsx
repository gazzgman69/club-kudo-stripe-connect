import { Fragment, useEffect, useMemo, useState } from "react";
import { useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { AuditLogEntry, PaginatedList } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface Filters {
  entityType: string;
  entityId: string;
  action: string;
  stripeEventId: string;
}

function emptyFilters(): Filters {
  return { entityType: "", entityId: "", action: "", stripeEventId: "" };
}

export default function AdminAuditLogPage() {
  const search = useSearch();
  const initial = useMemo<Filters>(() => {
    const sp = new URLSearchParams(search);
    return {
      entityType: sp.get("entityType") ?? "",
      entityId: sp.get("entityId") ?? "",
      action: sp.get("action") ?? "",
      stripeEventId: sp.get("stripeEventId") ?? "",
    };
  }, [search]);
  const [filters, setFilters] = useState<Filters>(initial);
  const [applied, setApplied] = useState<Filters>(initial);
  const [cursor, setCursor] = useState<string | null>(null);
  const [stack, setStack] = useState<(string | null)[]>([null]);
  const [openId, setOpenId] = useState<string | null>(null);

  // If the URL search changes (e.g. user clicked a deep link), reset state
  useEffect(() => {
    setFilters(initial);
    setApplied(initial);
    setCursor(null);
    setStack([null]);
  }, [initial]);

  const query = useQuery({
    queryKey: ["admin-audit-log", cursor, applied],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "50" });
      if (cursor) params.set("cursor", cursor);
      if (applied.entityType) params.set("entityType", applied.entityType);
      if (applied.entityId) params.set("entityId", applied.entityId);
      if (applied.action) params.set("action", applied.action);
      if (applied.stripeEventId)
        params.set("stripeEventId", applied.stripeEventId);
      return apiFetch<PaginatedList<AuditLogEntry>>(
        `/api/admin/audit-log?${params.toString()}`,
      );
    },
  });

  function applyFilters() {
    setApplied(filters);
    setCursor(null);
    setStack([null]);
  }

  function clearFilters() {
    const empty = emptyFilters();
    setFilters(empty);
    setApplied(empty);
    setCursor(null);
    setStack([null]);
  }

  return (
    <AdminShell>
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-gray-900">Audit log</h1>
        <p className="text-sm text-gray-500">
          Append-only record of every state-changing event. Webhooks, admin
          actions, and Stripe events all land here.
        </p>
      </div>

      <Card className="mb-4">
        <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Entity type</span>
            <input
              value={filters.entityType}
              onChange={(e) =>
                setFilters((f) => ({ ...f, entityType: e.target.value }))
              }
              placeholder="invoice, gig, supplier…"
              className="border border-gray-300 rounded px-2 py-1.5 bg-white"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Entity ID</span>
            <input
              value={filters.entityId}
              onChange={(e) =>
                setFilters((f) => ({ ...f, entityId: e.target.value }))
              }
              placeholder="UUID"
              className="border border-gray-300 rounded px-2 py-1.5 bg-white font-mono text-xs"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Action</span>
            <input
              value={filters.action}
              onChange={(e) =>
                setFilters((f) => ({ ...f, action: e.target.value }))
              }
              placeholder="invoice.paid, transfer.created…"
              className="border border-gray-300 rounded px-2 py-1.5 bg-white"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">Stripe event ID</span>
            <input
              value={filters.stripeEventId}
              onChange={(e) =>
                setFilters((f) => ({ ...f, stripeEventId: e.target.value }))
              }
              placeholder="evt_…"
              className="border border-gray-300 rounded px-2 py-1.5 bg-white font-mono text-xs"
            />
          </label>
          <div className="sm:col-span-4 flex gap-2">
            <Button size="sm" onClick={applyFilters}>
              Apply
            </Button>
            <Button size="sm" variant="outline" onClick={clearFilters}>
              Clear
            </Button>
          </div>
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
              No audit entries match these filters.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Action</th>
                  <th className="px-4 py-2 font-medium">Entity</th>
                  <th className="px-4 py-2 font-medium">Actor</th>
                  <th className="px-4 py-2 font-medium">Stripe event</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {query.data.items.map((entry) => {
                  const isOpen = openId === entry.id;
                  return (
                    <Fragment key={entry.id}>
                      <tr
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() =>
                          setOpenId(isOpen ? null : entry.id)
                        }
                      >
                        <td className="px-4 py-2 text-gray-700 whitespace-nowrap">
                          {formatDateTime(entry.timestamp)}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-gray-900">
                          {entry.action}
                        </td>
                        <td className="px-4 py-2 text-gray-700">
                          <span className="text-gray-500">
                            {entry.entityType}
                          </span>
                          {entry.entityId ? (
                            <span className="font-mono text-xs ml-1">
                              {entry.entityId.slice(0, 8)}…
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-2 text-gray-600">
                          {entry.actorEmail ?? "system"}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-gray-500">
                          {entry.stripeEventId ?? "-"}
                        </td>
                        <td className="px-4 py-2 text-xs text-blue-600">
                          {isOpen ? "Hide" : "Details"}
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr className="bg-gray-50">
                          <td colSpan={6} className="px-4 py-3">
                            <pre className="text-xs whitespace-pre-wrap break-all text-gray-700">
                              {JSON.stringify(
                                {
                                  beforeState: entry.beforeState,
                                  afterState: entry.afterState,
                                  metadata: entry.metadata,
                                  idempotencyKey: entry.idempotencyKey,
                                  stripeEventId: entry.stripeEventId,
                                },
                                null,
                                2,
                              )}
                            </pre>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
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
