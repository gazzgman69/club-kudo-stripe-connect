// Tiny formatting helpers used across admin screens.

export function formatPence(pence: number, currency = "GBP"): string {
  const major = pence / 100;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
  }).format(major);
}

export function formatBps(bps: number): string {
  // Basis points: 2000 = 20.00%, 0 = 0%.
  if (bps === 0) return "0%";
  return `${(bps / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}%`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function statusBadgeClasses(status: string): string {
  // Map our enum values to tailwind colour combos.
  const map: Record<string, string> = {
    // gig
    enquiry: "bg-gray-100 text-gray-700",
    reserved: "bg-blue-100 text-blue-700",
    lineup_confirmed: "bg-indigo-100 text-indigo-700",
    balance_invoiced: "bg-amber-100 text-amber-800",
    balance_paid: "bg-emerald-100 text-emerald-700",
    complete: "bg-green-100 text-green-800",
    cancelled: "bg-red-100 text-red-700",
    // supplier
    pending: "bg-gray-100 text-gray-700",
    onboarding: "bg-amber-100 text-amber-800",
    active: "bg-emerald-100 text-emerald-700",
    suspended: "bg-red-100 text-red-700",
    deauthorized: "bg-red-100 text-red-700",
    // invoice
    draft: "bg-gray-100 text-gray-700",
    open: "bg-amber-100 text-amber-800",
    paid: "bg-emerald-100 text-emerald-700",
    void: "bg-gray-100 text-gray-500 line-through",
    uncollectible: "bg-red-100 text-red-700",
    // transfer
    created: "bg-emerald-100 text-emerald-700",
    failed: "bg-red-100 text-red-700",
    reversed: "bg-amber-100 text-amber-800",
  };
  return `inline-block px-2 py-0.5 text-xs font-medium rounded ${
    map[status] ?? "bg-gray-100 text-gray-700"
  }`;
}
