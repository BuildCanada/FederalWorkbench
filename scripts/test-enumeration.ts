/**
 * Test script for enumeration queries.
 *
 * Tests the enumeration intent detection and full context retrieval
 * for queries that need complete result sets (e.g., "who voted yea for bill c-35").
 *
 * Usage: npx tsx scripts/test-enumeration.ts
 */

import { getParliamentContext } from "../lib/ai/tools/retrieve-parliament-context";
import { detectEnumerationIntent } from "../lib/rag/parliament/enumeration";

const TEST_QUERIES = [
  "who voted yea for bill c-35",
  "who voted against bill C-11",
  "list all Liberal MPs",
  "which members voted for bill c-35",
  "who are the Conservative members",
  "what is bill c-35 about", // Should NOT be enumeration
];

async function main() {
  console.log("=== Enumeration Intent Detection ===\n");

  for (const query of TEST_QUERIES) {
    const intent = await detectEnumerationIntent(query);
    console.log(`Query: "${query}"`);
    console.log(`  isEnumeration: ${intent.isEnumeration}`);
    if (intent.isEnumeration) {
      console.log(`  type: ${intent.type}`);
      console.log(`  billNumber: ${intent.billNumber || "N/A"}`);
      console.log(`  partySlug: ${intent.partySlug || "N/A"}`);
      console.log(`  voteType: ${intent.voteType || "N/A"}`);
    }
    console.log("");
  }

  console.log("\n=== Full Context Retrieval Test ===\n");

  const voteQuery = "who voted yea for bill c-35";
  console.log(`Testing: "${voteQuery}"\n`);

  const result = await getParliamentContext(voteQuery, 10);
  console.log(`Language: ${result.language}`);
  console.log(`Citations: ${result.citations.length}`);
  console.log(`Hydrated sources: ${result.hydratedSources.length}`);
  console.log(`Prompt length: ${result.prompt.length} chars`);
  console.log("\n--- Prompt Preview (first 2000 chars) ---\n");
  console.log(result.prompt.slice(0, 2000));
  if (result.prompt.length > 2000) {
    console.log(`\n... (${result.prompt.length - 2000} more chars)`);
  }

  console.log("\n=== Done ===");
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
