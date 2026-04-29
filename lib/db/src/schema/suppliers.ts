import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { supplierOnboardingStatusEnum } from "./enums";

export const suppliersTable = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id),
    tradingName: text("trading_name").notNull(),
    contactEmail: text("contact_email").notNull(),
    instrument: text("instrument").array(),
    bio: text("bio"),
    stripeAccountId: text("stripe_account_id"),
    stripeOnboardingStatus: supplierOnboardingStatusEnum(
      "stripe_onboarding_status",
    )
      .notNull()
      .default("pending"),
    stripeCapabilitiesJson: jsonb("stripe_capabilities_json"),
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
    uniqueIndex("suppliers_stripe_account_id_unique")
      .on(table.stripeAccountId)
      .where(sql`${table.stripeAccountId} IS NOT NULL`),
    index("suppliers_user_id_idx").on(table.userId),
    index("suppliers_stripe_onboarding_status_idx").on(
      table.stripeOnboardingStatus,
    ),
  ],
);

export const insertSupplierSchema = createInsertSchema(suppliersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;
export type Supplier = typeof suppliersTable.$inferSelect;
