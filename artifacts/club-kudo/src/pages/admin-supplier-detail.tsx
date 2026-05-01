import { useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { OnboardingLinkResponse, Supplier } from "@/lib/types";
import { formatDateTime, statusBadgeClasses } from "@/lib/format";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SupplierForm,
  supplierToFormValues,
  type SupplierFormValues,
} from "@/components/supplier-form";

export default function AdminSupplierDetailPage() {
  const [, params] = useRoute<{ id: string }>("/admin/suppliers/:id");
  const id = params?.id ?? "";
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [editError, setEditError] = useState<string | null>(null);
  const [onboardingResult, setOnboardingResult] =
    useState<OnboardingLinkResponse | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const supplier = useQuery({
    queryKey: ["supplier", id],
    queryFn: () => apiFetch<Supplier>(`/api/admin/suppliers/${id}`),
    enabled: !!id,
  });

  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const update = useMutation({
    mutationFn: (values: SupplierFormValues) =>
      apiFetch<Supplier>(`/api/admin/suppliers/${id}`, {
        method: "PATCH",
        body: {
          tradingName: values.tradingName,
          contactEmail: values.contactEmail,
          instrument: values.instrument,
          bio: values.bio,
          vatRegistered: values.vatRegistered,
          vatRateBps: values.vatRegistered ? values.vatRateBps : 0,
        },
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["supplier", id], updated);
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      setEditError(null);
      setSavedAt(new Date());
    },
    onError: (err) => setEditError((err as Error).message),
  });

  const generateOnboarding = useMutation({
    mutationFn: () =>
      apiFetch<OnboardingLinkResponse>(
        `/api/admin/suppliers/${id}/stripe-onboarding-link`,
        { method: "POST" },
      ),
    onSuccess: (data) => {
      setOnboardingResult(data);
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["supplier", id] });
    },
    onError: (err) => setActionError((err as Error).message),
  });

  const refreshStripeStatus = useMutation({
    mutationFn: () =>
      apiFetch<{ supplier: Supplier; stripeTransferStatus: string | null }>(
        `/api/admin/suppliers/${id}/refresh-stripe-status`,
        { method: "POST" },
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(["supplier", id], data.supplier);
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      setActionError(null);
    },
    onError: (err) => setActionError((err as Error).message),
  });

  const remove = useMutation({
    mutationFn: () =>
      apiFetch(`/api/admin/suppliers/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      setLocation("/admin/suppliers");
    },
    onError: (err) => setActionError((err as Error).message),
  });

  if (supplier.isPending) {
    return (
      <AdminShell>
        <p className="text-sm text-gray-500">Loading…</p>
      </AdminShell>
    );
  }
  if (supplier.isError || !supplier.data) {
    return (
      <AdminShell>
        <p className="text-sm text-red-600">
          Couldn't load supplier: {(supplier.error as Error)?.message ?? "not found"}
        </p>
      </AdminShell>
    );
  }

  const s = supplier.data;

  return (
    <AdminShell>
      <div className="mb-4 text-sm">
        <Link href="/admin/suppliers" className="text-blue-600 hover:underline">
          ← Back to suppliers
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>{s.tradingName}</span>
                {savedAt ? (
                  <span className="text-xs font-normal text-emerald-700">
                    Saved {formatDateTime(savedAt.toISOString())}
                  </span>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SupplierForm
                initial={supplierToFormValues(s)}
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

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Stripe Connect</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <dl className="space-y-2">
                <div className="flex justify-between">
                  <dt className="text-gray-500">Status</dt>
                  <dd>
                    <span
                      className={statusBadgeClasses(s.stripeOnboardingStatus)}
                    >
                      {s.stripeOnboardingStatus}
                    </span>
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-500">Account ID</dt>
                  <dd className="font-mono text-xs break-all">
                    {s.stripeAccountId ?? "-"}
                  </dd>
                </div>
              </dl>
              <Button
                className="w-full"
                onClick={() => {
                  setActionError(null);
                  setOnboardingResult(null);
                  generateOnboarding.mutate();
                }}
                disabled={generateOnboarding.isPending}
              >
                {generateOnboarding.isPending
                  ? "Generating…"
                  : s.stripeAccountId
                  ? "Resend onboarding link"
                  : "Generate onboarding link"}
              </Button>
              {s.stripeAccountId ? (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setActionError(null);
                    refreshStripeStatus.mutate();
                  }}
                  disabled={refreshStripeStatus.isPending}
                >
                  {refreshStripeStatus.isPending
                    ? "Checking Stripe…"
                    : "Refresh status from Stripe"}
                </Button>
              ) : null}
              {onboardingResult ? (
                <div className="rounded-md bg-emerald-50 border border-emerald-200 p-3 space-y-2">
                  <p className="text-emerald-800 text-xs font-medium">
                    Onboarding link generated
                    {onboardingResult.emailedAt
                      ? ` and emailed at ${formatDateTime(onboardingResult.emailedAt)}`
                      : " (email failed, share this link directly)"}
                    .
                  </p>
                  <a
                    href={onboardingResult.onboardingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-emerald-700 text-xs underline break-all"
                  >
                    {onboardingResult.onboardingUrl}
                  </a>
                </div>
              ) : null}
              {actionError ? (
                <p className="text-xs text-red-600">{actionError}</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Danger zone</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-3">
              <p className="text-gray-700">
                Soft-deletes the supplier (the row stays in the DB with a
                deleted_at timestamp; existing gigs and transfers stay
                consistent).
              </p>
              <Button
                variant="destructive"
                className="w-full"
                onClick={() => {
                  if (
                    confirm(
                      `Soft-delete supplier "${s.tradingName}"? This can be undone manually but the supplier will disappear from lists.`,
                    )
                  ) {
                    setActionError(null);
                    remove.mutate();
                  }
                }}
                disabled={remove.isPending}
              >
                {remove.isPending ? "Deleting…" : "Delete supplier"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminShell>
  );
}
