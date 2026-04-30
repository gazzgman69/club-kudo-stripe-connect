import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { Client } from "@/lib/types";
import { AdminShell } from "@/components/admin-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ClientForm,
  type ClientFormValues,
  emptyClientFormValues,
} from "@/components/client-form";

export default function AdminClientNewPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (values: ClientFormValues) =>
      apiFetch<Client>("/api/admin/clients", {
        method: "POST",
        body: {
          fullName: values.fullName,
          email: values.email,
          phone: values.phone || undefined,
          addressLines: values.addressLines.length
            ? values.addressLines
            : undefined,
          postcode: values.postcode || undefined,
          notes: values.notes || undefined,
        },
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setLocation(`/admin/clients/${created.id}`);
    },
    onError: (err) => setErrorMessage((err as Error).message),
  });

  return (
    <AdminShell>
      <div className="mb-4 text-sm">
        <Link href="/admin/clients" className="text-blue-600 hover:underline">
          ← Back to clients
        </Link>
      </div>
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>New client</CardTitle>
        </CardHeader>
        <CardContent>
          <ClientForm
            initial={emptyClientFormValues}
            submitLabel="Create client"
            submitting={create.isPending}
            errorMessage={errorMessage}
            onSubmit={(values) => {
              setErrorMessage(null);
              create.mutate(values);
            }}
          />
        </CardContent>
      </Card>
    </AdminShell>
  );
}
