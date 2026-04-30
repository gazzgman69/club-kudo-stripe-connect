import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { Supplier } from "@/lib/types";
import { AdminShell } from "@/components/admin-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SupplierForm,
  type SupplierFormValues,
  emptySupplierFormValues,
} from "@/components/supplier-form";

export default function AdminSupplierNewPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (values: SupplierFormValues) =>
      apiFetch<Supplier>("/api/admin/suppliers", {
        method: "POST",
        body: {
          tradingName: values.tradingName,
          contactEmail: values.contactEmail,
          instrument: values.instrument.length ? values.instrument : undefined,
          bio: values.bio || undefined,
          vatRegistered: values.vatRegistered,
          vatRateBps: values.vatRegistered ? values.vatRateBps : 0,
        },
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      setLocation(`/admin/suppliers/${created.id}`);
    },
    onError: (err) => {
      setErrorMessage((err as Error).message);
    },
  });

  return (
    <AdminShell>
      <div className="mb-4 text-sm">
        <Link href="/admin/suppliers" className="text-blue-600 hover:underline">
          ← Back to suppliers
        </Link>
      </div>
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>New supplier</CardTitle>
        </CardHeader>
        <CardContent>
          <SupplierForm
            initial={emptySupplierFormValues}
            submitLabel="Create supplier"
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
