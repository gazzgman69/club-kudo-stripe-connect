import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Platform-wide settings (single-row table). Holds the configurable
 * defaults that apply to all gigs: VAT status, default reservation
 * percentage, default commission percentage, currency, payment terms,
 * cancellation policy text.
 *
 * The CHECK constraint plus the constant default `id = 'singleton'`
 * ensures the table only ever holds one row.
 *
 * NOTE: every line item on a gig snapshots the relevant rate at
 * creation time. Changes here only affect future gigs. In-flight
 * invoices are immutable.
 *
 * When the multi-tenant SaaS refactor lands later, this becomes one
 * row per agency in an `agencies` table, and `agency_id` flows down
 * to gigs / suppliers / clients. Today's code is forward-compatible:
 * just one tenant.
 */
export const platformSettingsTable = pgTable(
  "platform_settings",
  {
    id: text("id").primaryKey().default("singleton"),

    // VAT status of the platform entity (Club Kudo Ltd today).
    vatRegistered: boolean("vat_registered").notNull().default(true),
    // Default VAT rate applied to platform-line items (reservation
    // fee, booking commission). Stored in basis points: 2000 = 20%.
    vatRateBps: integer("vat_rate_bps").notNull().default(2000),

    // Default reservation-fee percentage for new gigs, basis points.
    // The admin UI uses this to prefill the reservation fee amount
    // when an admin adds line items; admin can override per-gig.
    defaultReservationPercentBps: integer("default_reservation_percent_bps")
      .notNull()
      .default(2500),

    // Default booking-commission percentage. Nullable because Gareth
    // wants commission to be variable per-gig with no global default.
    defaultBookingCommissionPercentBps: integer(
      "default_booking_commission_percent_bps",
    ),

    // ISO 4217 lower-case currency code used on all invoices.
    currency: text("currency").notNull().default("gbp"),

    // Default `days_until_due` on Stripe Invoicing invoices for the
    // balance phase. Reservation invoices typically have a tighter
    // window (handled per-invoice).
    defaultInvoicePaymentTermsDays: integer(
      "default_invoice_payment_terms_days",
    )
      .notNull()
      .default(14),

    // Free-text cancellation policy applied by default to new gigs.
    // Surfaced as the gig's `cancellation_policy_applied` value
    // unless admin overrides per-gig.
    cancellationPolicyText: text("cancellation_policy_text"),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check("platform_settings_singleton", sql`${table.id} = 'singleton'`),
    check(
      "platform_settings_vat_rate_bps_valid",
      sql`${table.vatRateBps} >= 0 AND ${table.vatRateBps} <= 10000`,
    ),
    check(
      "platform_settings_reservation_percent_valid",
      sql`${table.defaultReservationPercentBps} >= 0 AND ${table.defaultReservationPercentBps} <= 10000`,
    ),
    check(
      "platform_settings_commission_percent_valid",
      sql`${table.defaultBookingCommissionPercentBps} IS NULL OR (${table.defaultBookingCommissionPercentBps} >= 0 AND ${table.defaultBookingCommissionPercentBps} <= 10000)`,
    ),
  ],
);

export const insertPlatformSettingsSchema = createInsertSchema(
  platformSettingsTable,
).omit({ id: true, updatedAt: true });
export type InsertPlatformSettings = z.infer<typeof insertPlatformSettingsSchema>;
export type PlatformSettings = typeof platformSettingsTable.$inferSelect;
