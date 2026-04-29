import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const auditLogTable = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    timestamp: timestamp("timestamp", { withTimezone: true })
      .notNull()
      .defaultNow(),
    actorUserId: uuid("actor_user_id").references(() => usersTable.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    stripeEventId: text("stripe_event_id"),
    idempotencyKey: uuid("idempotency_key"),
    metadata: jsonb("metadata"),
  },
  (table) => [
    index("audit_log_entity_idx").on(table.entityType, table.entityId),
    index("audit_log_actor_user_id_idx").on(table.actorUserId),
    index("audit_log_timestamp_idx").on(table.timestamp),
    index("audit_log_stripe_event_id_idx")
      .on(table.stripeEventId)
      .where(sql`${table.stripeEventId} IS NOT NULL`),
  ],
);

export const insertAuditLogSchema = createInsertSchema(auditLogTable).omit({
  id: true,
  timestamp: true,
});
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogTable.$inferSelect;
