/**
 * Query functions for Parliament data
 * Access data from the parliament schema
 */

import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// biome-ignore lint: Forbidden non-null assertion.
const client = postgres(process.env.POSTGRES_URL!);

// Create drizzle instance for parliament schema queries
export const parliamentDb = drizzle(client);

// TODO: Add query functions
// Examples:
// - getBillById(id: number)
// - searchBills(query: string)
// - getHansardStatements(filters)
// - getPoliticianById(id: number)
