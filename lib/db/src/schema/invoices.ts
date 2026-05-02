import {
  pgTable,
  uuid,
  text,
  date,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { gigsTable } from "./gigs";
import { invoiceTypeEnum, invoiceStatusEnum } from "./enums";

export const invoicesTable = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gigId: uuid("gig_id")
      .notNull()
      .references(() => gigsTable.id),
    invoiceType: invoiceTypeEnum("invoice_type").notNull(),
    stripeInvoiceId: text("stripe_invoice_id"),
    status: invoiceStatusEnum("status").notNull().default("draft"),
    totalPence: integer("total_pence").notNull(),
    currency: text("currency").notNull().default("gbp"),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    dueDate: date("due_date"),
    stripeChargeId: text("stripe_charge_id"),
    pdfUrl: text("pdf_url"),
    // Stripe's hosted invoice payment page. Distinct from pdfUrl,
    // which points at the PDF download. The hosted URL is what you
    // share with the client for self-serve payment.
    hostedInvoiceUrl: text("hosted_invoice_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("invoices_stripe_invoice_id_unique")
      .on(table.stripeInvoiceId)
      .where(sql`${table.stripeInvoiceId} IS NOT NULL`),
    index("invoices_gig_id_idx").on(table.gigId),
    index("invoices_status_idx").on(table.status),
  ],
);

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;
