import { type FormEvent, useState } from "react";
import { Link, useRoute } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type {
  Gig,
  GigLineItem,
  GigLineType,
  InvoicePhase,
  PaginatedList,
  Supplier,
} from "@/lib/types";
import {
  formatBps,
  formatDate,
  formatPence,
  statusBadgeClasses,
} from "@/lib/format";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface GigDetailResponse {
  gig: Gig;
  lineItems: GigLineItem[];
}

interface TransferRow {
  id: string;
  gigId: string;
  gigLineItemId: string;
  supplierId: string;
  stripeTransferId: string | null;
  amountPence: number;
  status: string;
  failureReason: string | null;
  createdAt: string;
}

const LINE_TYPES: { value: GigLineType; label: string; platform: boolean }[] = [
  { value: "reservation_fee", label: "Reservation fee (Club Kudo)", platform: true },
  { value: "booking_commission", label: "Booking commission (Club Kudo)", platform: true },
  { value: "dj_performance", label: "DJ performance", platform: false },
  { value: "sax_performance", label: "Sax performance", platform: false },
  { value: "equipment_hire", label: "Equipment hire", platform: false },
];

export default function AdminGigDetailPage() {
  const [, params] = useRoute<{ id: string }>("/admin/gigs/:id");
  const id = params?.id ?? "";
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["gig", id],
    queryFn: () => apiFetch<GigDetailResponse>(`/api/admin/gigs/${id}`),
    enabled: !!id,
  });

  const suppliers = useQuery({
    queryKey: ["suppliers", null],
    queryFn: () =>
      apiFetch<PaginatedList<Supplier>>("/api/admin/suppliers?limit=100"),
  });

  const transfers = useQuery({
    queryKey: ["gig-transfers", id],
    queryFn: () =>
      apiFetch<{ items: TransferRow[] }>(`/api/admin/gigs/${id}/transfers`),
    enabled: !!id,
  });

  const sendReservationInvoice = useMutation({
    mutationFn: () =>
      apiFetch(`/api/admin/gigs/${id}/reservation-invoice`, { method: "POST" }),
    onSuccess: () => {
      setActionMessage("Reservation invoice sent.");
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["gig", id] });
      queryClient.invalidateQueries({ queryKey: ["gigs"] });
    },
    onError: (err) => {
      setActionError((err as Error).message);
      setActionMessage(null);
    },
  });

  const sendBalanceInvoice = useMutation({
    mutationFn: () =>
      apiFetch(`/api/admin/gigs/${id}/balance-invoice`, { method: "POST" }),
    onSuccess: () => {
      setActionMessage("Balance invoice sent.");
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["gig", id] });
      queryClient.invalidateQueries({ queryKey: ["gigs"] });
    },
    onError: (err) => {
      setActionError((err as Error).message);
      setActionMessage(null);
    },
  });

  const fireTransfers = useMutation({
    mutationFn: () =>
      apiFetch<{ transfers: TransferRow[] }>(`/api/admin/gigs/${id}/transfers`, {
        method: "POST",
      }),
    onSuccess: (data) => {
      setActionMessage(
        `Transfer pass complete: ${data.transfers.length} row(s) recorded.`,
      );
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["gig-transfers", id] });
    },
    onError: (err) => {
      setActionError((err as Error).message);
      setActionMessage(null);
    },
  });

  const removeLineItem = useMutation({
    mutationFn: (lineItemId: string) =>
      apiFetch(`/api/admin/gigs/${id}/line-items/${lineItemId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gig", id] });
    },
    onError: (err) => setActionError((err as Error).message),
  });

  if (detail.isPending) {
    return (
      <AdminShell>
        <p className="text-sm text-gray-500">Loading…</p>
      </AdminShell>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <AdminShell>
        <p className="text-sm text-red-600">
          Couldn't load gig: {(detail.error as Error)?.message ?? "not found"}
        </p>
      </AdminShell>
    );
  }

  const { gig, lineItems } = detail.data;
  const reservationLines = lineItems.filter(
    (li) => li.invoicePhase === "reservation",
  );
  const balanceLines = lineItems.filter((li) => li.invoicePhase === "balance");
  const supplierMap = new Map(
    suppliers.data?.items.map((s) => [s.id, s]) ?? [],
  );

  return (
    <AdminShell>
      <div className="mb-4 text-sm">
        <Link href="/admin/gigs" className="text-blue-600 hover:underline">
          ← Back to gigs
        </Link>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {gig.eventName}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {formatDate(gig.eventDate)}
            {gig.venue ? ` · ${gig.venue}` : ""}
          </p>
        </div>
        <span className={statusBadgeClasses(gig.status)}>
          {gig.status.replace(/_/g, " ")}
        </span>
      </div>

      {actionMessage ? (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3 mb-4 text-sm text-emerald-800">
          {actionMessage}
        </div>
      ) : null}
      {actionError ? (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 mb-4 text-sm text-red-700">
          {actionError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <LineItemsCard
            phase="reservation"
            lineItems={reservationLines}
            supplierMap={supplierMap}
            onRemove={(lineItemId) => removeLineItem.mutate(lineItemId)}
            removing={removeLineItem.isPending}
          />
          <LineItemsCard
            phase="balance"
            lineItems={balanceLines}
            supplierMap={supplierMap}
            onRemove={(lineItemId) => removeLineItem.mutate(lineItemId)}
            removing={removeLineItem.isPending}
          />
          <AddLineItemCard gigId={gig.id} suppliers={suppliers.data?.items ?? []} />
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Invoice actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Button
                className="w-full"
                onClick={() => {
                  setActionMessage(null);
                  setActionError(null);
                  sendReservationInvoice.mutate();
                }}
                disabled={
                  sendReservationInvoice.isPending ||
                  reservationLines.length === 0
                }
              >
                {sendReservationInvoice.isPending
                  ? "Sending…"
                  : "Send reservation invoice"}
              </Button>
              <Button
                className="w-full"
                variant="outline"
                onClick={() => {
                  setActionMessage(null);
                  setActionError(null);
                  sendBalanceInvoice.mutate();
                }}
                disabled={
                  sendBalanceInvoice.isPending ||
                  balanceLines.length === 0 ||
                  (gig.status !== "reserved" &&
                    gig.status !== "lineup_confirmed")
                }
              >
                {sendBalanceInvoice.isPending
                  ? "Sending…"
                  : "Send balance invoice"}
              </Button>
              <Button
                className="w-full"
                variant="outline"
                onClick={() => {
                  setActionMessage(null);
                  setActionError(null);
                  fireTransfers.mutate();
                }}
                disabled={fireTransfers.isPending}
              >
                {fireTransfers.isPending
                  ? "Routing…"
                  : "Trigger supplier transfers"}
              </Button>
              <p className="text-xs text-gray-500">
                Transfers normally fire automatically via Stripe webhook
                when an invoice is paid. The button is here for manual
                retries or test-mode flows.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Transfers</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {transfers.isPending ? (
                <p className="text-gray-500">Loading…</p>
              ) : !transfers.data?.items.length ? (
                <p className="text-gray-500">
                  None yet. Will appear once the first transfer pass runs.
                </p>
              ) : (
                <ul className="space-y-2">
                  {transfers.data.items.map((t) => {
                    const supplier = supplierMap.get(t.supplierId);
                    return (
                      <li
                        key={t.id}
                        className="border rounded-md p-2 text-xs"
                      >
                        <div className="flex justify-between mb-1">
                          <span className="font-medium">
                            {supplier?.tradingName ?? t.supplierId}
                          </span>
                          <span className={statusBadgeClasses(t.status)}>
                            {t.status}
                          </span>
                        </div>
                        <div className="text-gray-600">
                          {formatPence(t.amountPence)}
                        </div>
                        {t.stripeTransferId ? (
                          <div className="text-gray-400 font-mono break-all mt-1">
                            {t.stripeTransferId}
                          </div>
                        ) : null}
                        {t.failureReason ? (
                          <div className="text-red-600 mt-1">
                            {t.failureReason}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminShell>
  );
}

function LineItemsCard({
  phase,
  lineItems,
  supplierMap,
  onRemove,
  removing,
}: {
  phase: InvoicePhase;
  lineItems: GigLineItem[];
  supplierMap: Map<string, Supplier>;
  onRemove: (lineItemId: string) => void;
  removing: boolean;
}) {
  const total = lineItems.reduce((sum, li) => sum + li.totalPence, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {phase === "reservation" ? "Reservation invoice lines" : "Balance invoice lines"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {lineItems.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-500">No lines yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Description</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Supplier</th>
                <th className="px-4 py-2 font-medium text-right">Amount</th>
                <th className="px-4 py-2 font-medium">VAT</th>
                <th className="px-4 py-2 font-medium text-right">Total</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lineItems.map((li) => (
                <tr key={li.id}>
                  <td className="px-4 py-2 text-gray-900">{li.description}</td>
                  <td className="px-4 py-2 text-gray-600 text-xs">
                    {li.lineType.replace(/_/g, " ")}
                  </td>
                  <td className="px-4 py-2 text-gray-600">
                    {li.isPlatformLine
                      ? "Club Kudo"
                      : (li.supplierId &&
                          supplierMap.get(li.supplierId)?.tradingName) ??
                        "-"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {formatPence(li.amountPence)}
                  </td>
                  <td className="px-4 py-2 text-gray-600">
                    {formatBps(li.vatRateBps)}
                  </td>
                  <td className="px-4 py-2 text-right font-medium">
                    {formatPence(li.totalPence)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50"
                      onClick={() => {
                        if (confirm(`Delete "${li.description}"?`))
                          onRemove(li.id);
                      }}
                      disabled={removing}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="bg-gray-50">
                <td colSpan={5} className="px-4 py-2 text-right font-medium">
                  Phase total
                </td>
                <td className="px-4 py-2 text-right font-semibold">
                  {formatPence(total)}
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function AddLineItemCard({
  gigId,
  suppliers,
}: {
  gigId: string;
  suppliers: Supplier[];
}) {
  const queryClient = useQueryClient();
  const [description, setDescription] = useState("");
  const [lineType, setLineType] = useState<GigLineType>("dj_performance");
  const [amountPounds, setAmountPounds] = useState("");
  const [vatRateBps, setVatRateBps] = useState(0);
  const [supplierId, setSupplierId] = useState("");
  const [invoicePhase, setInvoicePhase] = useState<InvoicePhase>("balance");
  const [error, setError] = useState<string | null>(null);

  const meta = LINE_TYPES.find((t) => t.value === lineType);
  const isPlatformLine = meta?.platform ?? false;

  const add = useMutation({
    mutationFn: () => {
      const amountPence = Math.round(Number(amountPounds) * 100);
      return apiFetch(`/api/admin/gigs/${gigId}/line-items`, {
        method: "POST",
        body: {
          description,
          lineType,
          amountPence,
          vatRateBps,
          isPlatformLine,
          supplierId: isPlatformLine ? null : supplierId || null,
          invoicePhase,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gig", gigId] });
      setDescription("");
      setAmountPounds("");
      setSupplierId("");
      setError(null);
    },
    onError: (err) => setError((err as Error).message),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!description.trim() || !amountPounds || Number(amountPounds) <= 0) {
      setError("Description and a positive amount are required.");
      return;
    }
    if (!isPlatformLine && !supplierId) {
      setError("Pick a supplier for non-platform lines.");
      return;
    }
    setError(null);
    add.mutate();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add line item</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. DJ - 4-hour set"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lineType">Line type</Label>
            <select
              id="lineType"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={lineType}
              onChange={(e) => setLineType(e.target.value as GigLineType)}
            >
              {LINE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="invoicePhase">Goes on</Label>
            <select
              id="invoicePhase"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={invoicePhase}
              onChange={(e) => setInvoicePhase(e.target.value as InvoicePhase)}
            >
              <option value="reservation">Reservation invoice</option>
              <option value="balance">Balance invoice</option>
            </select>
          </div>
          {isPlatformLine ? null : (
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="supplierId">Supplier</Label>
              <select
                id="supplierId"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                required={!isPlatformLine}
              >
                <option value="">- Pick a supplier -</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.tradingName}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="amount">Amount (£)</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              min="0.01"
              required
              value={amountPounds}
              onChange={(e) => setAmountPounds(e.target.value)}
              placeholder="500.00"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vatRatePct">VAT rate (%)</Label>
            <Input
              id="vatRatePct"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step={0.01}
              // Display as percent: stored basis points / 100. 2000 -> 20.
              value={vatRateBps / 100}
              onChange={(e) => {
                const pct = Number.parseFloat(e.target.value);
                setVatRateBps(
                  Number.isFinite(pct) ? Math.round(pct * 100) : 0,
                );
              }}
              onFocus={(e) => e.target.select()}
              placeholder="20"
            />
          </div>
          {error ? (
            <p className="text-sm text-red-600 md:col-span-2">{error}</p>
          ) : null}
          <div className="md:col-span-2 flex justify-end">
            <Button type="submit" disabled={add.isPending}>
              {add.isPending ? "Adding…" : "Add line item"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
