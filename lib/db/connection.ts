import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

let dbInstance: PostgresJsDatabase | null = null;
let clientInstance: ReturnType<typeof postgres> | null = null;

/**
 * Get a shared database connection
 *
 * Lazily initializes and reuses the same connection across all calls.
 * Works in both Next.js server context and CLI scripts.
 */
export function getDb(): PostgresJsDatabase {
  if (!dbInstance) {
    const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!dbUrl) {
      throw new Error(
        "DATABASE_URL or POSTGRES_URL environment variable is required"
      );
    }
    clientInstance = postgres(dbUrl);
    dbInstance = drizzle(clientInstance);
  }
  return dbInstance;
}

/**
 * Close the database connection
 *
 * Call this when shutting down the application or cleaning up resources.
 * Primarily used by CLI scripts.
 */
export async function closeDb(): Promise<void> {
  if (clientInstance) {
    await clientInstance.end();
    clientInstance = null;
    dbInstance = null;
  }
}
