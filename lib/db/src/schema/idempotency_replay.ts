import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// Server-side replay protection for state-changing API requests.
// The `key` column holds the client-supplied UUID v4 from the
// `Idempotency-Key` request header. A row is written by the idempotency
// middleware (Phase 1 Step 5a) AFTER the underlying handler completes
// successfully; replays of the same key on the same path by the same
// authenticated user return the cached response without re-executing.
//
// Distinct from `transfers.stripe_idempotency_key`, which protects OUR
// retries against the Stripe API and uses a server-generated structured
// key. These two systems must never share a column or be conflated.
//
// A separate cron job (Phase 1 Step 10) is expected to delete rows where
// `expires_at < now()` — typical TTL is 24h.
export const idempotencyReplayTable = pgTable(
  "idempotency_replay",
  {
    key: uuid("key").primaryKey(),
    userId: uuid("user_id").references(() => usersTable.id),
    path: text("path").notNull(),
    method: text("method").notNull(),
    statusCode: integer("status_code").notNull(),
    responseBody: jsonb("response_body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("idempotency_replay_expires_at_idx").on(table.expiresAt),
    index("idempotency_replay_user_id_idx").on(table.userId),
  ],
);

export const insertIdempotencyReplaySchema = createInsertSchema(
  idempotencyReplayTable,
).omit({
  createdAt: true,
});
export type InsertIdempotencyReplay = z.infer<
  typeof insertIdempotencyReplaySchema
>;
export type IdempotencyReplay = typeof idempotencyReplayTable.$inferSelect;
