import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { Client, PaginatedList } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function AdminClientsListPage() {
  const [, setLocation] = useLocation();
  const [cursor, setCursor] = useState<string | null>(null);
  const [stack, setStack] = useState<(string | null)[]>([null]);

  const query = useQuery({
    queryKey: ["clients", cursor],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "25" });
      if (cursor) params.set("cursor", cursor);
      return apiFetch<PaginatedList<Client>>(
        `/api/admin/clients?${params.toString()}`,
      );
    },
  });

  return (
    <AdminShell>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Clients</h1>
          <p className="text-sm text-gray-500">
            The wedding couples and event hosts booking gigs.
          </p>
        </div>
        <Link href="/admin/clients/new">
          <Button>+ New client</Button>
        </Link>
      </div>

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
              No clients yet. Click <span className="font-medium">+ New client</span>.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">Phone</th>
                  <th className="px-4 py-2 font-medium">Stripe Customer</th>
                  <th className="px-4 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {query.data.items.map((c) => (
                  <tr
                    key={c.id}
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => setLocation(`/admin/clients/${c.id}`)}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {c.fullName}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{c.email}</td>
                    <td className="px-4 py-3 text-gray-700">{c.phone ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 font-mono">
                      {c.stripeCustomerId ? "✓" : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {formatDate(c.createdAt)}
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
