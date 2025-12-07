/**
 * Link paired defined terms between EN and FR versions
 *
 * This script populates the pairedTermId field in the defined_terms table,
 * enabling fast language toggles without requiring JOIN + normalization at query time.
 *
 * The linking process:
 * 1. For each term with a pairedTerm (the text of the equivalent term in the other language)
 * 2. Normalize the pairedTerm using the same logic as term_normalized
 * 3. Find the matching term in the other language within the same act/regulation
 * 4. Update pairedTermId on both sides to create bidirectional links
 *
 * Usage:
 *   npx tsx scripts/embeddings/legislation/link-defined-terms.ts
 *   npx tsx scripts/embeddings/legislation/link-defined-terms.ts --dry-run
 *   npx tsx scripts/embeddings/legislation/link-defined-terms.ts --limit=100
 */

import { config } from "dotenv";

config({ path: ".env.local" });

import { and, eq, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { definedTerms } from "@/lib/db/legislation/schema";
import { normalizeTermForMatching } from "./utilities";

// ---------- CLI args ----------
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitArg = args.find((arg) => arg.startsWith("--limit="));
const limit = limitArg
  ? Number.parseInt(limitArg.split("=")[1], 10)
  : undefined;

// ---------- Types ----------
type LinkStats = {
  totalTerms: number;
  termsWithPairedText: number;
  pairsLinked: number;
  alreadyLinked: number;
  noMatchFound: number;
  errors: number;
};

/**
 * Link defined term pairs within a transaction.
 */
export async function linkDefinedTermPairs(
  db: PostgresJsDatabase,
  options: { dryRun: boolean; limit?: number }
): Promise<LinkStats> {
  const stats: LinkStats = {
    totalTerms: 0,
    termsWithPairedText: 0,
    pairsLinked: 0,
    alreadyLinked: 0,
    noMatchFound: 0,
    errors: 0,
  };

  // Fetch all terms that have pairedTerm but no pairedTermId
  const query = db
    .select({
      id: definedTerms.id,
      language: definedTerms.language,
      term: definedTerms.term,
      termNormalized: definedTerms.termNormalized,
      pairedTerm: definedTerms.pairedTerm,
      pairedTermId: definedTerms.pairedTermId,
      actId: definedTerms.actId,
      regulationId: definedTerms.regulationId,
    })
    .from(definedTerms)
    .where(
      and(
        sql`${definedTerms.pairedTerm} IS NOT NULL`,
        isNull(definedTerms.pairedTermId)
      )
    );

  const termsToLink = limit ? await query.limit(limit) : await query;

  stats.totalTerms = termsToLink.length;
  stats.termsWithPairedText = termsToLink.length;

  console.log(
    `Found ${termsToLink.length} terms with pairedTerm but no pairedTermId`
  );

  if (termsToLink.length === 0) {
    console.log("No terms to link.");
    return stats;
  }

  // Build a lookup map for fast matching
  // Key: `${language}:${actId|regulationId}:${termNormalized}`
  const allTerms = await db
    .select({
      id: definedTerms.id,
      language: definedTerms.language,
      termNormalized: definedTerms.termNormalized,
      actId: definedTerms.actId,
      regulationId: definedTerms.regulationId,
    })
    .from(definedTerms);

  const termLookup = new Map<string, string>();
  for (const t of allTerms) {
    const docId = t.actId || t.regulationId || "";
    const key = `${t.language}:${docId}:${t.termNormalized}`;
    termLookup.set(key, t.id);
  }

  console.log(`Built lookup map with ${termLookup.size} entries`);

  // Track pairs to update (batch for efficiency)
  const updates: Array<{ id: string; pairedTermId: string }> = [];

  for (const term of termsToLink) {
    if (!term.pairedTerm) {
      continue;
    }

    // Determine the target language
    const targetLang = term.language === "en" ? "fr" : "en";
    const docId = term.actId || term.regulationId || "";

    // Normalize the pairedTerm text using the same logic as term_normalized
    const normalizedPairedTerm = normalizeTermForMatching(term.pairedTerm);

    // Look up the matching term
    const lookupKey = `${targetLang}:${docId}:${normalizedPairedTerm}`;
    const matchedId = termLookup.get(lookupKey);

    if (matchedId) {
      updates.push({ id: term.id, pairedTermId: matchedId });
      stats.pairsLinked++;
    } else {
      stats.noMatchFound++;
    }
  }

  console.log(
    `Found ${updates.length} pairs to link, ${stats.noMatchFound} with no match`
  );

  if (options.dryRun) {
    console.log("[DRY RUN] Would update pairedTermId for these terms:");
    for (const update of updates.slice(0, 10)) {
      console.log(`  - ${update.id} -> ${update.pairedTermId}`);
    }
    if (updates.length > 10) {
      console.log(`  ... and ${updates.length - 10} more`);
    }
    return stats;
  }

  // Batch update in chunks of 1000
  const BATCH_SIZE = 1000;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);

    await db.transaction(async (tx) => {
      for (const update of batch) {
        await tx
          .update(definedTerms)
          .set({ pairedTermId: update.pairedTermId })
          .where(eq(definedTerms.id, update.id));
      }
    });

    console.log(
      `Updated ${Math.min(i + BATCH_SIZE, updates.length)} / ${updates.length} terms`
    );
  }

  return stats;
}

/**
 * Get count of already-linked terms
 */
async function getAlreadyLinkedCount(db: PostgresJsDatabase): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(definedTerms)
    .where(sql`${definedTerms.pairedTermId} IS NOT NULL`);
  return Number(result[0]?.count || 0);
}

// ---------- Main ----------
async function main() {
  console.log("=== Link Defined Term Pairs ===\n");

  if (dryRun) {
    console.log("[DRY RUN MODE - No changes will be made]\n");
  }

  const databaseUrl = process.env.POSTGRES_URL;
  if (!databaseUrl) {
    console.error("Error: POSTGRES_URL environment variable is not set");
    process.exit(1);
  }

  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  try {
    // Check current state
    const alreadyLinked = await getAlreadyLinkedCount(db);
    console.log(`Already linked terms: ${alreadyLinked}`);

    // Run linking
    const stats = await linkDefinedTermPairs(db, { dryRun, limit });

    // Summary
    console.log("\n=== Summary ===");
    console.log(`Terms processed: ${stats.totalTerms}`);
    console.log(`Pairs linked: ${stats.pairsLinked}`);
    console.log(`No match found: ${stats.noMatchFound}`);
    if (stats.errors > 0) {
      console.log(`Errors: ${stats.errors}`);
    }

    // Verify final state
    if (!dryRun) {
      const finalLinked = await getAlreadyLinkedCount(db);
      console.log(`\nTotal linked terms after update: ${finalLinked}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

export type { LinkStats };
