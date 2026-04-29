import {
  pgTable,
  uuid,
  text,
  date,
  timestamp,
  integer,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { clientsTable } from "./clients";
import { suppliersTable } from "./suppliers";
import { gigStatusEnum, gigLineTypeEnum } from "./enums";

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
    vatAmountPence: integer("vat_amount_pence").notNull().default(0),
    totalPence: integer("total_pence").notNull(),
    isPlatformLine: boolean("is_platform_line").notNull().default(false),
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
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertGigLineItem = z.infer<typeof insertGigLineItemSchema>;
export type GigLineItem = typeof gigLineItemsTable.$inferSelect;
