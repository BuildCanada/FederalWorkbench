/**
 * Database Reset Script
 *
 * Drops all tables in the public schema and re-runs all migrations.
 * This is equivalent to `supabase db reset` but only affects the public schema.
 *
 * Usage:
 *   npx tsx lib/db/reset.ts
 */

import { config } from "dotenv";

config({
  path: ".env.local",
});

import { createInterface } from "node:readline";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Prompt user for confirmation
 * @returns Promise that resolves to true if user confirms (Y/y), false otherwise
 */
function promptConfirmation(message: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} (Y/n): `, (answer) => {
      rl.close();
      resolve(answer.trim().toUpperCase() === "Y");
    });
  });
}

/**
 * Drop all tables in the public schema
 */
async function dropAllPublicTables(db: ReturnType<typeof drizzle>) {
  console.log("\n🗑️  Dropping all tables in public schema...");

  // Get all tables in the public schema
  const tables = await db.execute<{ tablename: string }>(sql`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  `);

  if (tables.length === 0) {
    console.log("   No tables found in public schema");
    return;
  }

  console.log(`   Found ${tables.length} tables to drop`);

  // Drop all tables with CASCADE
  for (const table of tables) {
    try {
      await db.execute(
        sql.raw(`DROP TABLE IF EXISTS "public"."${table.tablename}" CASCADE`)
      );
      console.log(`   ✅ Dropped table: ${table.tablename}`);
    } catch (error) {
      console.error(`   ❌ Failed to drop table ${table.tablename}:`, error);
      throw error;
    }
  }

  // Drop the drizzle migrations table and schema if they exist
  try {
    await db.execute(
      sql`DROP TABLE IF EXISTS "drizzle"."__drizzle_migrations" CASCADE`
    );
    await db.execute(sql`DROP SCHEMA IF EXISTS "drizzle" CASCADE`);
    console.log("   ✅ Dropped drizzle migration tracking");
  } catch (_error) {
    // Ignore errors if they don't exist
    console.log("   ℹ️  No drizzle migration tracking to drop");
  }

  console.log("\n✨ All public schema tables dropped successfully\n");
}

/**
 * Run all migrations
 */
async function runMigrations(db: ReturnType<typeof drizzle>) {
  console.log("⏳ Running migrations...");

  const start = Date.now();
  await migrate(db, { migrationsFolder: "./lib/db/migrations" });
  const end = Date.now();

  console.log(`✅ Migrations completed in ${end - start}ms\n`);
}

/**
 * Main execution
 */
async function main() {
  const dbUrl = process.env.POSTGRES_URL;
  if (!dbUrl) {
    throw new Error("POSTGRES_URL environment variable is required");
  }

  console.log("\n⚠️  WARNING: DATABASE RESET\n");
  console.log("This will:");
  console.log("  1. Drop ALL tables in the public schema");
  console.log("  2. Reset drizzle migration tracking");
  console.log("  3. Re-run all migrations from scratch\n");
  console.log(
    "After reset, your database will be fresh with all migrations applied."
  );
  console.log("You can continue using drizzle migrations normally.\n");
  console.log("⚠️  This action CANNOT be undone!\n");
  console.log("Note: The parliament schema will NOT be affected.\n");

  const confirmed = await promptConfirmation(
    "Are you sure you want to reset the database? Type Y to continue"
  );

  if (!confirmed) {
    console.log("\n❌ Database reset cancelled by user\n");
    process.exit(0);
  }

  const connection = postgres(dbUrl, { max: 1 });
  const db = drizzle(connection);

  try {
    // Step 1: Drop all tables in public schema
    await dropAllPublicTables(db);

    // Step 2: Run migrations
    await runMigrations(db);

    console.log("✨ Database reset complete!\n");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Database reset failed:", error);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

main();
