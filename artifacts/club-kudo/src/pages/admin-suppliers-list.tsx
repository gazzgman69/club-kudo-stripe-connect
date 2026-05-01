import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { PaginatedList, Supplier } from "@/lib/types";
import { formatDate, statusBadgeClasses } from "@/lib/format";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function AdminSuppliersListPage() {
  const [, setLocation] = useLocation();
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);

  const query = useQuery({
    queryKey: ["suppliers", cursor],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("limit", "25");
      if (cursor) params.set("cursor", cursor);
      return apiFetch<PaginatedList<Supplier>>(
        `/api/admin/suppliers?${params.toString()}`,
      );
    },
  });

  function goNext() {
    if (!query.data?.nextCursor) return;
    setCursorStack((s) => [...s, query.data!.nextCursor]);
    setCursor(query.data.nextCursor);
  }
  function goPrev() {
    if (cursorStack.length <= 1) return;
    const next = [...cursorStack];
    next.pop();
    const prev = next[next.length - 1];
    setCursorStack(next);
    setCursor(prev);
  }

  return (
    <AdminShell>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Suppliers</h1>
          <p className="text-sm text-gray-500">
            DJs, sax players, equipment hire, anyone who supplies a gig.
          </p>
        </div>
        <Link href="/admin/suppliers/new">
          <Button>+ New supplier</Button>
        </Link>
      </div>

      <Card>
        <CardContent className="p-0">
          {query.isPending ? (
            <div className="p-6 text-sm text-gray-500">Loading…</div>
          ) : query.isError ? (
            <div className="p-6 text-sm text-red-600">
              Failed to load suppliers: {(query.error as Error).message}
            </div>
          ) : query.data && query.data.items.length === 0 ? (
            <div className="p-6 text-sm text-gray-500">
              No suppliers yet. Click <span className="font-medium">+ New supplier</span> to create one.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Trading name</th>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">Stripe status</th>
                  <th className="px-4 py-2 font-medium">VAT</th>
                  <th className="px-4 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {query.data?.items.map((s) => (
                  <tr
                    key={s.id}
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => setLocation(`/admin/suppliers/${s.id}`)}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {s.tradingName}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {s.contactEmail ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={statusBadgeClasses(s.stripeOnboardingStatus)}
                      >
                        {s.stripeOnboardingStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {s.vatRegistered ? `Yes (${s.vatRateBps / 100}%)` : "No"}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {formatDate(s.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
        <Button
          variant="outline"
          size="sm"
          disabled={cursorStack.length <= 1}
          onClick={goPrev}
        >
          ← Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!query.data?.nextCursor}
          onClick={goNext}
        >
          Next →
        </Button>
      </div>
    </AdminShell>
  );
}
