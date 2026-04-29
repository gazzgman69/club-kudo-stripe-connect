import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { gigsTable, gigLineItemsTable } from "./gigs";
import { suppliersTable } from "./suppliers";
import { transferStatusEnum } from "./enums";

export const transfersTable = pgTable(
  "transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gigId: uuid("gig_id")
      .notNull()
      .references(() => gigsTable.id),
    gigLineItemId: uuid("gig_line_item_id")
      .notNull()
      .references(() => gigLineItemsTable.id),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliersTable.id),
    stripeTransferId: text("stripe_transfer_id"),
    stripeChargeId: text("stripe_charge_id"),
    amountPence: integer("amount_pence").notNull(),
    currency: text("currency").notNull().default("gbp"),
    status: transferStatusEnum("status").notNull().default("pending"),
    failureReason: text("failure_reason"),
    retryCount: integer("retry_count").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    idempotencyKey: uuid("idempotency_key").notNull(),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("transfers_stripe_transfer_id_unique")
      .on(table.stripeTransferId)
      .where(sql`${table.stripeTransferId} IS NOT NULL`),
    index("transfers_gig_id_idx").on(table.gigId),
    index("transfers_supplier_id_idx").on(table.supplierId),
    index("transfers_status_idx").on(table.status),
    index("transfers_idempotency_key_idx").on(table.idempotencyKey),
    check("transfers_amount_positive", sql`amount_pence > 0`),
  ],
);

export const insertTransferSchema = createInsertSchema(transfersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  version: true,
});
export type InsertTransfer = z.infer<typeof insertTransferSchema>;
export type Transfer = typeof transfersTable.$inferSelect;
