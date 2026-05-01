import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { Gig, PaginatedList } from "@/lib/types";
import { formatDate, statusBadgeClasses } from "@/lib/format";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function AdminGigsListPage() {
  const [, setLocation] = useLocation();
  const [cursor, setCursor] = useState<string | null>(null);
  const [stack, setStack] = useState<(string | null)[]>([null]);

  const query = useQuery({
    queryKey: ["gigs", cursor],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "25" });
      if (cursor) params.set("cursor", cursor);
      return apiFetch<PaginatedList<Gig>>(
        `/api/admin/gigs?${params.toString()}`,
      );
    },
  });

  return (
    <AdminShell>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Gigs</h1>
          <p className="text-sm text-gray-500">
            Bookings: enquiry → reserved → balance paid → complete.
          </p>
        </div>
        <Link href="/admin/gigs/new">
          <Button>+ New gig</Button>
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
              No gigs yet. Create a client first, then add a gig.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Event</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Venue</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {query.data.items.map((g) => (
                  <tr
                    key={g.id}
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => setLocation(`/admin/gigs/${g.id}`)}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {g.eventName}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {formatDate(g.eventDate)}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {g.venue ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={statusBadgeClasses(g.status)}>
                        {g.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {formatDate(g.createdAt)}
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
