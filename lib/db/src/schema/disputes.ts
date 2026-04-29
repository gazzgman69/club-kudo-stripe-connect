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
import { disputeStatusEnum } from "./enums";

export const disputesTable = pgTable(
  "disputes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gigId: uuid("gig_id")
      .notNull()
      .references(() => gigsTable.id),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoicesTable.id),
    stripeDisputeId: text("stripe_dispute_id"),
    amountPence: integer("amount_pence").notNull(),
    reason: text("reason"),
    status: disputeStatusEnum("status").notNull(),
    evidenceDueBy: timestamp("evidence_due_by", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("disputes_stripe_dispute_id_unique")
      .on(table.stripeDisputeId)
      .where(sql`${table.stripeDisputeId} IS NOT NULL`),
    index("disputes_gig_id_idx").on(table.gigId),
  ],
);

export const insertDisputeSchema = createInsertSchema(disputesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDispute = z.infer<typeof insertDisputeSchema>;
export type Dispute = typeof disputesTable.$inferSelect;
