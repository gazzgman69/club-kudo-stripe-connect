import {
  pgTable,
  uuid,
  date,
  timestamp,
  integer,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { reconciliationStatusEnum } from "./enums";

export const reconciliationRunsTable = pgTable(
  "reconciliation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runDate: date("run_date").notNull(),
    status: reconciliationStatusEnum("status").notNull().default("running"),
    discrepanciesFound: integer("discrepancies_found").notNull().default(0),
    discrepanciesJson: jsonb("discrepancies_json"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("reconciliation_runs_run_date_unique").on(table.runDate),
  ],
);

export const insertReconciliationRunSchema = createInsertSchema(
  reconciliationRunsTable,
).omit({ id: true, createdAt: true });
export type InsertReconciliationRun = z.infer<
  typeof insertReconciliationRunSchema
>;
export type ReconciliationRun = typeof reconciliationRunsTable.$inferSelect;
