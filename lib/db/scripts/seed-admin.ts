import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { usersTable, userRolesTable } from "../src/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const email = (process.env.ADMIN_EMAIL ?? "skinnycheck@gmail.com")
  .trim()
  .toLowerCase();
const displayName = process.env.ADMIN_NAME ?? "Gareth Gwyn";

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  try {
    console.log(`Seeding admin: ${displayName} <${email}>`);

    // Insert the user (or fetch the existing one) idempotently.
    const inserted = await db
      .insert(usersTable)
      .values({ email, displayName })
      .onConflictDoNothing({ target: usersTable.email })
      .returning({ id: usersTable.id });

    let userId: string;
    if (inserted.length > 0) {
      userId = inserted[0].id;
      console.log(`Created user ${userId}`);
    } else {
      const existing = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.email, email))
        .limit(1);
      if (existing.length === 0) {
        throw new Error(
          "user lookup failed after insert with onConflictDoNothing",
        );
      }
      userId = existing[0].id;
      console.log(`User already existed: ${userId}`);
    }

    // Grant the admin role. user_roles has composite PK (user_id, role)
    // so onConflictDoNothing makes this idempotent.
    await db
      .insert(userRolesTable)
      .values({ userId, role: "admin" })
      .onConflictDoNothing();

    console.log("Granted admin role.");
    console.log("Done.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("seed-admin failed:", err);
  process.exit(1);
});
