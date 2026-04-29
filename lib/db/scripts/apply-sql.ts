import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const sqlFiles = ["audit_log_append_only.sql"];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    for (const file of sqlFiles) {
      const fullPath = path.join(import.meta.dirname, "..", "sql", file);
      const sql = await readFile(fullPath, "utf8");
      console.log(`Applying ${file}...`);
      await pool.query(sql);
    }
    console.log("All SQL files applied successfully.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
