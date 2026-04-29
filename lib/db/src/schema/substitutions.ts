import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { gigsTable, gigLineItemsTable } from "./gigs";
import { suppliersTable } from "./suppliers";
import { usersTable } from "./users";

export const substitutionsTable = pgTable(
  "substitutions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gigId: uuid("gig_id")
      .notNull()
      .references(() => gigsTable.id),
    gigLineItemId: uuid("gig_line_item_id")
      .notNull()
      .references(() => gigLineItemsTable.id),
    originalSupplierId: uuid("original_supplier_id")
      .notNull()
      .references(() => suppliersTable.id),
    replacementSupplierId: uuid("replacement_supplier_id")
      .notNull()
      .references(() => suppliersTable.id),
    reason: text("reason"),
    substitutedAt: timestamp("substituted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    substitutedByUserId: uuid("substituted_by_user_id")
      .notNull()
      .references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("substitutions_gig_id_idx").on(table.gigId)],
);

export const insertSubstitutionSchema = createInsertSchema(
  substitutionsTable,
).omit({ id: true, createdAt: true });
export type InsertSubstitution = z.infer<typeof insertSubstitutionSchema>;
export type Substitution = typeof substitutionsTable.$inferSelect;
