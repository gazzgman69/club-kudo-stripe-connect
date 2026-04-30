// Shared TypeScript types mirroring the API response shapes. These
// are hand-maintained for now; once the OpenAPI spec covers the full
// admin surface, the orval-generated client will provide them with
// stronger guarantees.

export interface Supplier {
  id: string;
  userId: string;
  tradingName: string;
  contactEmail: string | null;
  instrument: string[] | null;
  bio: string | null;
  stripeAccountId: string | null;
  stripeOnboardingStatus:
    | "pending"
    | "onboarding"
    | "active"
    | "suspended"
    | "deauthorized";
  stripeCapabilitiesJson: unknown;
  vatRegistered: boolean;
  vatRateBps: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deletedByUserId: string | null;
}

export interface Client {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  addressLines: string[] | null;
  postcode: string | null;
  notes: string | null;
  stripeCustomerId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deletedByUserId: string | null;
}

export type GigStatus =
  | "enquiry"
  | "reserved"
  | "lineup_confirmed"
  | "balance_invoiced"
  | "balance_paid"
  | "complete"
  | "cancelled";

export type GigLineType =
  | "dj_performance"
  | "sax_performance"
  | "equipment_hire"
  | "booking_commission"
  | "reservation_fee";

export type InvoicePhase = "reservation" | "balance";

export interface Gig {
  id: string;
  clientId: string;
  eventDate: string;
  eventName: string;
  venue: string | null;
  status: GigStatus;
  reservationPaidAt: string | null;
  lineupConfirmedAt: string | null;
  balanceDueDate: string | null;
  cancellationPolicyApplied: string | null;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deletedByUserId: string | null;
}

export interface GigLineItem {
  id: string;
  gigId: string;
  supplierId: string | null;
  description: string;
  lineType: GigLineType;
  amountPence: number;
  vatRateBps: number;
  vatAmountPence: number;
  totalPence: number;
  isPlatformLine: boolean;
  invoicePhase: InvoicePhase;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedList<T> {
  items: T[];
  nextCursor: string | null;
}

export interface OnboardingLinkResponse {
  stripeAccountId: string;
  onboardingUrl: string;
  emailedAt: string | null;
}
