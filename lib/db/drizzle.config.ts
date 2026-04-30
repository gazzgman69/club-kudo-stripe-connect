import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  out: path.join(__dirname, "./migrations"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // Strict mode: refuse to silently drop columns. Forces explicit
  // migration steps for destructive changes.
  strict: true,
  // Output verbose SQL diffs in the generate step so review is meaningful.
  verbose: true,
});
