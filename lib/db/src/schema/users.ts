import {
  pgTable,
  uuid,
  text,
  timestamp,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { userRoleEnum } from "./enums";

export const usersTable = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    displayName: text("display_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedByUserId: uuid("deleted_by_user_id"),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const userRolesTable = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    role: userRoleEnum("role").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    grantedByUserId: uuid("granted_by_user_id").references(() => usersTable.id),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.role] }),
    index("user_roles_user_id_idx").on(table.userId),
  ],
);

export const magicLinkTokensTable = pgTable(
  "magic_link_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("magic_link_tokens_token_hash_unique").on(table.tokenHash),
    index("magic_link_tokens_user_id_idx").on(table.userId),
    index("magic_link_tokens_expires_at_idx").on(table.expiresAt),
  ],
);

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

export const insertUserRoleSchema = createInsertSchema(userRolesTable).omit({
  grantedAt: true,
});
export type InsertUserRole = z.infer<typeof insertUserRoleSchema>;
export type UserRole = typeof userRolesTable.$inferSelect;

export const insertMagicLinkTokenSchema = createInsertSchema(
  magicLinkTokensTable,
).omit({ id: true, createdAt: true });
export type InsertMagicLinkToken = z.infer<typeof insertMagicLinkTokenSchema>;
export type MagicLinkToken = typeof magicLinkTokensTable.$inferSelect;
