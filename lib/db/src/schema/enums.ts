import { pgEnum } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["admin", "supplier"]);

export const supplierOnboardingStatusEnum = pgEnum(
  "supplier_onboarding_status",
  ["pending", "onboarding", "active", "suspended", "deauthorized"],
);

export const gigStatusEnum = pgEnum("gig_status", [
  "enquiry",
  "reserved",
  "lineup_confirmed",
  "balance_invoiced",
  "balance_paid",
  "complete",
  "cancelled",
]);

export const gigLineTypeEnum = pgEnum("gig_line_type", [
  "dj_performance",
  "sax_performance",
  "equipment_hire",
  "booking_commission",
  "reservation_fee",
]);

export const invoiceTypeEnum = pgEnum("invoice_type", [
  "reservation",
  "balance",
  "self_billing",
]);

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "open",
  "paid",
  "void",
  "uncollectible",
]);

export const transferStatusEnum = pgEnum("transfer_status", [
  "pending",
  "created",
  "failed",
  "reversed",
  "manual_override",
]);

export const refundStatusEnum = pgEnum("refund_status", [
  "pending",
  "succeeded",
  "failed",
  "cancelled",
]);

export const disputeStatusEnum = pgEnum("dispute_status", [
  "warning_needs_response",
  "warning_under_review",
  "warning_closed",
  "needs_response",
  "under_review",
  "charge_refunded",
  "won",
  "lost",
]);

export const reconciliationStatusEnum = pgEnum("reconciliation_status", [
  "running",
  "complete",
  "failed",
  "needs_review",
]);
