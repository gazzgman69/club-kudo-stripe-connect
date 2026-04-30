import { type FormEvent, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { Client, Gig, PaginatedList } from "@/lib/types";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AdminGigNewPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const clientsQuery = useQuery({
    queryKey: ["clients", null],
    queryFn: () =>
      apiFetch<PaginatedList<Client>>("/api/admin/clients?limit=100"),
  });

  const [clientId, setClientId] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventName, setEventName] = useState("");
  const [venue, setVenue] = useState("");
  const [notes, setNotes] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      apiFetch<{ gig: Gig }>("/api/admin/gigs", {
        method: "POST",
        body: {
          clientId,
          eventDate,
          eventName,
          venue: venue || undefined,
          notes: notes || undefined,
        },
      }),
    onSuccess: ({ gig }) => {
      queryClient.invalidateQueries({ queryKey: ["gigs"] });
      setLocation(`/admin/gigs/${gig.id}`);
    },
    onError: (err) => setErrorMessage((err as Error).message),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    create.mutate();
  }

  return (
    <AdminShell>
      <div className="mb-4 text-sm">
        <Link href="/admin/gigs" className="text-blue-600 hover:underline">
          ← Back to gigs
        </Link>
      </div>
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>New gig</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="clientId">Client</Label>
              <select
                id="clientId"
                required
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">— Pick a client —</option>
                {clientsQuery.data?.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.fullName} ({c.email})
                  </option>
                ))}
              </select>
              {clientsQuery.data?.items.length === 0 ? (
                <p className="text-xs text-amber-700">
                  No clients yet.{" "}
                  <Link
                    href="/admin/clients/new"
                    className="underline"
                  >
                    Create one
                  </Link>{" "}
                  first.
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="eventDate">Event date</Label>
                <Input
                  id="eventDate"
                  type="date"
                  required
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="venue">Venue</Label>
                <Input
                  id="venue"
                  value={venue}
                  onChange={(e) => setVenue(e.target.value)}
                  placeholder="e.g. Le Chateau"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="eventName">Event name</Label>
              <Input
                id="eventName"
                required
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                placeholder="e.g. Rebecca & Mike's wedding"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <textarea
                id="notes"
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Internal notes."
              />
            </div>

            {errorMessage ? (
              <p className="text-sm text-red-600">{errorMessage}</p>
            ) : null}

            <div className="flex items-center justify-end">
              <Button type="submit" disabled={create.isPending || !clientId}>
                {create.isPending ? "Creating…" : "Create gig"}
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              Line items (commission, reservation fee, supplier slots) get
              added on the gig's detail page after creation.
            </p>
          </form>
        </CardContent>
      </Card>
    </AdminShell>
  );
}
