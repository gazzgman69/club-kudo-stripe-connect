import {
  pgTable,
  uuid,
  text,
  date,
  timestamp,
  integer,
  boolean,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { clientsTable } from "./clients";
import { suppliersTable } from "./suppliers";
import { gigStatusEnum, gigLineTypeEnum, invoicePhaseEnum } from "./enums";

export const gigsTable = pgTable(
  "gigs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clientsTable.id),
    eventDate: date("event_date").notNull(),
    eventName: text("event_name").notNull(),
    venue: text("venue"),
    status: gigStatusEnum("status").notNull().default("enquiry"),
    reservationPaidAt: timestamp("reservation_paid_at", { withTimezone: true }),
    lineupConfirmedAt: timestamp("lineup_confirmed_at", { withTimezone: true }),
    balanceDueDate: date("balance_due_date"),
    cancellationPolicyApplied: text("cancellation_policy_applied"),
    notes: text("notes"),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedByUserId: uuid("deleted_by_user_id").references(() => usersTable.id),
  },
  (table) => [
    index("gigs_client_id_idx").on(table.clientId),
    index("gigs_event_date_idx").on(table.eventDate),
    index("gigs_status_idx").on(table.status),
    index("gigs_status_event_date_idx").on(table.status, table.eventDate),
    check(
      "gigs_balance_due_date_valid",
      sql`(
        (
          (status IN ('enquiry', 'reserved') AND balance_due_date IS NULL)
          OR (status IN ('balance_invoiced', 'balance_paid', 'complete') AND balance_due_date IS NOT NULL)
          OR (status IN ('lineup_confirmed', 'cancelled'))
        )
        AND (balance_due_date IS NULL OR balance_due_date <= event_date)
      )`,
    ),
  ],
);

export const gigLineItemsTable = pgTable(
  "gig_line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gigId: uuid("gig_id")
      .notNull()
      .references(() => gigsTable.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id").references(() => suppliersTable.id),
    description: text("description").notNull(),
    lineType: gigLineTypeEnum("line_type").notNull(),
    amountPence: integer("amount_pence").notNull(),
    vatRateBps: integer("vat_rate_bps").notNull().default(0),
    vatAmountPence: integer("vat_amount_pence")
      .notNull()
      .generatedAlwaysAs(sql`(amount_pence * vat_rate_bps / 10000)`),
    totalPence: integer("total_pence")
      .notNull()
      .generatedAlwaysAs(
        sql`(amount_pence + (amount_pence * vat_rate_bps / 10000))`,
      ),
    isPlatformLine: boolean("is_platform_line").notNull().default(false),
    // Which invoice this line goes on. Default 'balance' so most
    // supplier lines fall through naturally; reservation-fee and any
    // upfront supplier deposits get explicitly set to 'reservation'.
    invoicePhase: invoicePhaseEnum("invoice_phase")
      .notNull()
      .default("balance"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("gig_line_items_gig_id_idx").on(table.gigId),
    index("gig_line_items_supplier_id_idx").on(table.supplierId),
    index("gig_line_items_invoice_phase_idx").on(table.invoicePhase),
    check("gig_line_items_amount_positive", sql`amount_pence > 0`),
    check(
      "gig_line_items_platform_line_supplier_xor",
      sql`(
        (is_platform_line = true AND supplier_id IS NULL)
        OR (is_platform_line = false AND supplier_id IS NOT NULL)
      )`,
    ),
  ],
);

export const insertGigSchema = createInsertSchema(gigsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  version: true,
});
export type InsertGig = z.infer<typeof insertGigSchema>;
export type Gig = typeof gigsTable.$inferSelect;

export const insertGigLineItemSchema = createInsertSchema(
  gigLineItemsTable,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertGigLineItem = z.infer<typeof insertGigLineItemSchema>;
export type GigLineItem = typeof gigLineItemsTable.$inferSelect;
