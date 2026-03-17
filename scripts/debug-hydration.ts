/**
 * Debug script to check why hydration is failing
 */

import { hydrateSearchResult } from "@/lib/rag/parliament/hydrate-dispatcher";
import { multiQuerySearch } from "@/lib/rag/parliament/multi-query";
import { analyzeQuery } from "@/lib/rag/parliament/query-analysis";

async function debug() {
  const query = "who voted yea on bill c-35";

  console.log("=== Analyzing query ===");
  const analysis = await analyzeQuery(query);
  console.log("Language:", analysis.language);
  console.log("Search types:", analysis.searchTypes);
  console.log("Reformulations:", analysis.reformulatedQueries);

  console.log("\n=== Running search ===");
  const results = await multiQuerySearch(analysis, 25);
  console.log(`Found ${results.length} results after reranking`);

  console.log("\n=== Results by source type ===");
  const byType = new Map<string, typeof results>();
  for (const r of results) {
    const t = r.metadata.sourceType;
    if (!byType.has(t)) {
      byType.set(t, []);
    }
    byType.get(t)?.push(r);
  }

  for (const [type, items] of byType) {
    console.log(`\n${type}: ${items.length} results`);
    const first = items[0];
    console.log(
      "  First result metadata:",
      JSON.stringify(first.metadata, null, 2)
    );

    // Try to hydrate
    console.log("  Attempting hydration...");
    const hydrated = await hydrateSearchResult(
      first,
      analysis.language === "fr" ? "fr" : "en"
    );
    if (hydrated) {
      console.log(`  ✅ Hydrated successfully! ID: ${hydrated.id}`);
      console.log(`  Markdown preview: ${hydrated.markdown.slice(0, 200)}...`);
    } else {
      console.log("  ❌ Hydration returned null");

      // Debug why
      const meta = first.metadata as any;
      if (type === "bill") {
        console.log("    billNumber:", meta.billNumber);
        console.log("    sessionId:", meta.sessionId);
        if (meta.sessionId) {
          const [p, s] = String(meta.sessionId).split("-");
          console.log("    parsed parliament:", p, "session:", s);
        }
      } else if (type === "vote_member") {
        console.log("    memberVoteId:", meta.memberVoteId);
      } else if (type === "vote_question") {
        console.log("    voteQuestionId:", meta.voteQuestionId);
      }
    }
  }
}

debug()
  .then(() => {
    console.log("\n=== Done ===");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
