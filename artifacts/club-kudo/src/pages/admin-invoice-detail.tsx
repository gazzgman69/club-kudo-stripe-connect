import { useState } from "react";
import { Link, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { Invoice } from "@/lib/types";
import {
  formatDate,
  formatDateTime,
  formatPence,
  statusBadgeClasses,
} from "@/lib/format";
import { AdminShell } from "@/components/admin-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const TYPE_LABELS: Record<string, string> = {
  reservation: "Reservation",
  balance: "Balance",
  self_billing: "Self-billing",
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm text-gray-900 break-words">{children}</dd>
    </div>
  );
}

export default function AdminInvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();
  const [forceVoidError, setForceVoidError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["admin-invoice", id],
    queryFn: () => apiFetch<Invoice>(`/api/admin/invoices/${id}`),
    enabled: !!id,
  });

  const forceVoid = useMutation({
    mutationFn: (reason: string) =>
      apiFetch<Invoice>(`/api/admin/invoices/${id}/force-void`, {
        method: "POST",
        body: { reason },
      }),
    onSuccess: () => {
      setForceVoidError(null);
      queryClient.invalidateQueries({ queryKey: ["admin-invoice", id] });
      queryClient.invalidateQueries({ queryKey: ["admin-invoices"] });
    },
    onError: (err: Error) => setForceVoidError(err.message),
  });

  function handleForceVoidClick() {
    const reason = window.prompt(
      "Force-void this invoice locally?\n\nThis marks the local row as void without touching Stripe. Used to release the gig's invoice guard when Stripe-side state can't be reconciled.\n\nEnter a reason for the audit log:",
    );
    if (!reason) return;
    const trimmed = reason.trim();
    if (!trimmed) return;
    forceVoid.mutate(trimmed);
  }

  return (
    <AdminShell>
      <div className="mb-4">
        <Link href="/admin/invoices" className="text-sm text-blue-600 hover:underline">
          ← Back to invoices
        </Link>
      </div>

      {query.isPending ? (
        <Card>
          <CardContent className="p-6 text-sm text-gray-500">
            Loading…
          </CardContent>
        </Card>
      ) : query.isError ? (
        <Card>
          <CardContent className="p-6 text-sm text-red-600">
            Failed to load: {(query.error as Error).message}
          </CardContent>
        </Card>
      ) : !query.data ? null : (
        <div className="space-y-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl font-semibold text-gray-900">
                Invoice {query.data.id.slice(0, 8)}
              </h1>
              <p className="text-sm text-gray-500">
                {TYPE_LABELS[query.data.invoiceType] ?? query.data.invoiceType}{" "}
                · {query.data.gigName ?? "-"}
              </p>
            </div>
            <span className={statusBadgeClasses(query.data.status)}>
              {query.data.status}
            </span>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Amounts</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Field label="Total">
                  <span className="font-semibold">
                    {formatPence(
                      query.data.totalPence,
                      query.data.currency.toUpperCase(),
                    )}
                  </span>
                </Field>
                <Field label="Currency">
                  {query.data.currency.toUpperCase()}
                </Field>
                <Field label="Type">
                  {TYPE_LABELS[query.data.invoiceType] ??
                    query.data.invoiceType}
                </Field>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Client &amp; gig</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Gig">
                  <Link
                    href={`/admin/gigs/${query.data.gigId}`}
                    className="text-blue-600 hover:underline"
                  >
                    {query.data.gigName ?? query.data.gigId}
                  </Link>
                </Field>
                <Field label="Client">{query.data.clientName ?? "-"}</Field>
                <Field label="Client email">
                  {query.data.clientEmail ?? "-"}
                </Field>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Stripe references</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Invoice ID">
                  <span className="font-mono text-xs">
                    {query.data.stripeInvoiceId ?? "-"}
                  </span>
                </Field>
                <Field label="Charge">
                  <span className="font-mono text-xs">
                    {query.data.stripeChargeId ?? "-"}
                  </span>
                </Field>
                <Field label="Pay online">
                  {query.data.hostedInvoiceUrl ? (
                    <a
                      href={query.data.hostedInvoiceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-blue-600 hover:underline font-medium"
                    >
                      Open hosted invoice -&gt;
                    </a>
                  ) : (
                    "-"
                  )}
                </Field>
                <Field label="PDF">
                  {query.data.pdfUrl ? (
                    <a
                      href={query.data.pdfUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-blue-600 hover:underline"
                    >
                      Download PDF
                    </a>
                  ) : (
                    "-"
                  )}
                </Field>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Lifecycle</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Created">
                  {formatDateTime(query.data.createdAt)}
                </Field>
                <Field label="Last updated">
                  {formatDateTime(query.data.updatedAt)}
                </Field>
                <Field label="Issued">
                  {formatDateTime(query.data.issuedAt)}
                </Field>
                <Field label="Due">{formatDate(query.data.dueDate)}</Field>
                <Field label="Paid at">
                  {formatDateTime(query.data.paidAt)}
                </Field>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Audit trail</CardTitle>
            </CardHeader>
            <CardContent>
              <Link
                href={`/admin/audit-log?entityType=invoice&entityId=${query.data.id}`}
                className="text-sm text-blue-600 hover:underline"
              >
                View audit-log entries for this invoice →
              </Link>
            </CardContent>
          </Card>

          {query.data.status !== "void" && (
            <Card className="border-red-200">
              <CardHeader>
                <CardTitle className="text-sm text-red-700">
                  Danger zone
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-gray-600">
                  Force-void marks this invoice as <code>void</code> locally
                  without touching Stripe. Use only when Stripe-side state
                  cannot be reconciled (e.g. a £0 auto-paid orphan blocking
                  the gig&apos;s invoice guard). Writes an audit-log entry
                  with the reason you provide.
                </p>
                {forceVoidError && (
                  <p className="text-sm text-red-600">{forceVoidError}</p>
                )}
                <Button
                  type="button"
                  size="sm"
                  className="bg-red-600 text-white hover:bg-red-700 border-transparent"
                  onClick={handleForceVoidClick}
                  disabled={forceVoid.isPending}
                >
                  {forceVoid.isPending
                    ? "Voiding…"
                    : "Force void (local only)"}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </AdminShell>
  );
}
