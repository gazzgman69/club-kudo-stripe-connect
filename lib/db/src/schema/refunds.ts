import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { gigsTable } from "./gigs";
import { invoicesTable } from "./invoices";
import { usersTable } from "./users";
import { refundStatusEnum } from "./enums";

export const refundsTable = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gigId: uuid("gig_id")
      .notNull()
      .references(() => gigsTable.id),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoicesTable.id),
    stripeRefundId: text("stripe_refund_id"),
    amountPence: integer("amount_pence").notNull(),
    reason: text("reason"),
    status: refundStatusEnum("status").notNull().default("pending"),
    initiatedByUserId: uuid("initiated_by_user_id")
      .notNull()
      .references(() => usersTable.id),
    approvedByUserId: uuid("approved_by_user_id").references(
      () => usersTable.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("refunds_stripe_refund_id_unique")
      .on(table.stripeRefundId)
      .where(sql`${table.stripeRefundId} IS NOT NULL`),
    index("refunds_gig_id_idx").on(table.gigId),
    index("refunds_invoice_id_idx").on(table.invoiceId),
  ],
);

export const insertRefundSchema = createInsertSchema(refundsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertRefund = z.infer<typeof insertRefundSchema>;
export type Refund = typeof refundsTable.$inferSelect;
