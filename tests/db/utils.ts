/**
 * Database fixtures and utilities for Parliament schema tests
 */

import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// Create database connection for tests
function getTestDb() {
  if (!process.env.POSTGRES_URL) {
    throw new Error("POSTGRES_URL environment variable is required for tests");
  }
  const client = postgres(process.env.POSTGRES_URL);
  return drizzle(client);
}

export const testDb = getTestDb();

/**
 * Check if a table has data
 */
export async function hasData(table: any, limit = 1): Promise<boolean> {
  try {
    const result = await testDb.select().from(table).limit(limit);
    return result.length > 0;
  } catch {
    return false;
  }
}

/**
 * Get row count for a table
 */
export async function getRowCount(table: any): Promise<number> {
  try {
    const result = await testDb.select({ count: count() }).from(table);
    return Number(result[0]?.count ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Get a sample record from a table
 */
// biome-ignore lint/suspicious/useAwait: This function returns a Promise for consistency with async API
export async function getSampleRecord<T = any>(
  table: any,
  limit = 1
): Promise<T[]> {
  return testDb.select().from(table).limit(limit) as Promise<T[]>;
}

/**
 * Check if a foreign key relationship resolves correctly
 */
export async function checkForeignKey(options: {
  fkValue: number | string | null;
  referencedTable: any;
  referencedColumn: any;
}): Promise<boolean> {
  const { fkValue, referencedTable, referencedColumn } = options;
  if (fkValue === null || fkValue === undefined) {
    return true; // Null foreign keys are valid
  }

  try {
    const result = await testDb
      .select()
      .from(referencedTable)
      .where(eq(referencedColumn, fkValue))
      .limit(1);
    return result.length > 0;
  } catch {
    return false;
  }
}
