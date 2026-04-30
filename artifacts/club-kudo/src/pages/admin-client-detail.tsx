import { useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { Client } from "@/lib/types";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ClientForm,
  clientToFormValues,
  type ClientFormValues,
} from "@/components/client-form";

export default function AdminClientDetailPage() {
  const [, params] = useRoute<{ id: string }>("/admin/clients/:id");
  const id = params?.id ?? "";
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [editError, setEditError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const client = useQuery({
    queryKey: ["client", id],
    queryFn: () => apiFetch<Client>(`/api/admin/clients/${id}`),
    enabled: !!id,
  });

  const update = useMutation({
    mutationFn: (values: ClientFormValues) =>
      apiFetch<Client>(`/api/admin/clients/${id}`, {
        method: "PATCH",
        body: {
          fullName: values.fullName,
          email: values.email,
          phone: values.phone || undefined,
          addressLines: values.addressLines,
          postcode: values.postcode || undefined,
          notes: values.notes || undefined,
        },
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["client", id], updated);
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (err) => setEditError((err as Error).message),
  });

  const remove = useMutation({
    mutationFn: () =>
      apiFetch(`/api/admin/clients/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setLocation("/admin/clients");
    },
    onError: (err) => setActionError((err as Error).message),
  });

  if (client.isPending) {
    return (
      <AdminShell>
        <p className="text-sm text-gray-500">Loading…</p>
      </AdminShell>
    );
  }
  if (client.isError || !client.data) {
    return (
      <AdminShell>
        <p className="text-sm text-red-600">
          Couldn't load client: {(client.error as Error)?.message ?? "not found"}
        </p>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <div className="mb-4 text-sm">
        <Link href="/admin/clients" className="text-blue-600 hover:underline">
          ← Back to clients
        </Link>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{client.data.fullName}</CardTitle>
            </CardHeader>
            <CardContent>
              <ClientForm
                initial={clientToFormValues(client.data)}
                submitLabel="Save changes"
                submitting={update.isPending}
                errorMessage={editError}
                onSubmit={(values) => {
                  setEditError(null);
                  update.mutate(values);
                }}
              />
            </CardContent>
          </Card>
        </div>
        <div>
          <Card>
            <CardHeader>
              <CardTitle>Stripe</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-500">Customer ID</span>
                <span className="font-mono text-xs break-all">
                  {client.data.stripeCustomerId ?? "—"}
                </span>
              </div>
              <p className="text-xs text-gray-500">
                Auto-created on the first invoice. Reused across this
                client's gigs so Stripe shows one customer per couple.
              </p>
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Danger zone</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-3">
              <p className="text-gray-700">
                Soft-deletes the client. Existing gigs and invoices stay.
              </p>
              {actionError ? (
                <p className="text-xs text-red-600">{actionError}</p>
              ) : null}
              <Button
                variant="destructive"
                className="w-full"
                onClick={() => {
                  if (
                    confirm(`Soft-delete "${client.data?.fullName}"?`)
                  ) {
                    setActionError(null);
                    remove.mutate();
                  }
                }}
                disabled={remove.isPending}
              >
                {remove.isPending ? "Deleting…" : "Delete client"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminShell>
  );
}
