/**
 * RAG retrieval smoke test (bilingual, multi-source)
 *
 * Exercises:
 * - Query analysis (language, bill numbers, reformulations)
 * - Multi-query bill retrieval with reranking + language bias
 * - Bill-only retrieval and citations
 *
 * Usage examples:
 *   npx tsx scripts/test-search.ts
 *   npx tsx scripts/test-search.ts "What is Bill C-11?" --limit=5
 *   npx tsx scripts/test-search.ts "Qu’est-ce que le projet de loi C-11 ?" --limit 6
 */

import { config } from "dotenv";

config({ path: ".env.local" });

import { getParliamentContext } from "@/lib/ai/tools/retrieve-parliament-context";
import { multiQuerySearch } from "@/lib/rag/parliament/multi-query";
import { analyzeQuery } from "@/lib/rag/parliament/query-analysis";
import type { ParliamentSearchResult } from "@/lib/rag/parliament/search";
import { getHydratedBillMarkdown } from "@/lib/rag/parliament/sources/bills/hydrate";
import {
  type BillSearchResult,
  searchBills,
} from "@/lib/rag/parliament/sources/bills/search";

function readOptValue(name: string): string | undefined {
  const args = process.argv.slice(2);
  const withEq = args.find((a) => a.startsWith(`--${name}=`));
  if (withEq) {
    return withEq.split("=")[1];
  }
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && idx + 1 < args.length) {
    const val = args[idx + 1];
    if (!val.startsWith("-")) {
      return val;
    }
  }
  return;
}

const cliArgs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const inputQuery = cliArgs[0];
const limit = Number.parseInt(readOptValue("limit") ?? "5", 10);

function printHeader(title: string) {
  console.log(`\n${title}`);
  console.log("".padEnd(80, "─"));
}

function printResults(
  label: string,
  results: (BillSearchResult | ParliamentSearchResult)[]
) {
  console.log(`\n${label}: ${results.length} result(s)`);
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const chunk =
      (r.metadata as any).chunkIndex === 0
        ? "metadata"
        : `text#${(r.metadata as any).chunkIndex ?? "n/a"}`;
    const lang = (r.metadata as any).language ?? "n/a";
    const type = r.metadata.sourceType;
    console.log(
      `\n${i + 1}. ${r.citation.textEn}\n   type=${type} lang=${lang} chunk=${chunk} similarity=${(r.similarity * 100).toFixed(1)}%`
    );
    if (r.citation.titleEn) {
      console.log(`   titleEn: ${r.citation.titleEn}`);
    }
    if (r.citation.titleFr) {
      console.log(`   titleFr: ${r.citation.titleFr}`);
    }
    console.log(`   urlEn: ${r.citation.urlEn}`);
    console.log(`   urlFr: ${r.citation.urlFr}`);
  }
}

async function runOne(query: string) {
  printHeader(`🔎 Query: "${query}" (limit=${limit})`);

  // 1) Analysis
  const analysis = await analyzeQuery(query);
  console.log(
    `analysis → lang=${analysis.language} intent=${analysis.intent} bills=${analysis.entities.billNumbers?.join(",") ?? "—"}\n` +
      `reformulations: ${analysis.reformulatedQueries.join(" | ")}`
  );

  // 2) Single-query bill search (use for hydration disambiguation)
  const sq = await searchBills(query, { limit });
  // 2b) If a specific bill and a session are known, preview hydrated full bill markdown
  const bn = analysis.entities.billNumbers?.[0];
  if (bn) {
    const pick = sq.find(
      (r) =>
        r.metadata.sourceType === "bill" &&
        r.metadata.sessionId &&
        r.metadata.billNumber
    );
    if (pick?.metadata.sessionId) {
      const [pStr, sStr] = String(pick.metadata.sessionId).split("-");
      const parliament = Number.parseInt(pStr, 10);
      const session = Number.parseInt(sStr, 10);
      if (Number.isFinite(parliament) && Number.isFinite(session)) {
        try {
          const { markdown, bill, languageUsed, note } =
            await getHydratedBillMarkdown({
              billNumber: bn,
              parliament,
              session,
              language: analysis.language === "fr" ? "fr" : "en",
            });
          const preview = markdown.slice(0, 400).replace(/\n/g, "\n   ");
          console.log(
            `\nfull-bill (hydrated): session=${bill.sessionId} lang=${languageUsed}${note ? ` note=${note}` : ""}`
          );
          console.log(
            `   preview: ${preview}${markdown.length > 400 ? "…" : ""}`
          );
        } catch (e: any) {
          console.log(
            `\nfull-bill (hydrated): unavailable (${e?.message || e})`
          );
        }
      }
    }
  }
  printResults("single-query (bills only)", sq);

  // 3) Multi-query bill retrieval (tests bill-number strict threshold + reranking)
  const mq = await multiQuerySearch(analysis, limit);
  printResults("multi-query (bills only)", mq);

  // 4) Chat-context simulation using the RAG tool
  const ctx = await getParliamentContext(query, 10);
  const ctxPreview = ctx.prompt.slice(0, 400).replace(/\n/g, "\n   ");
  console.log("\nchat-context (assembled):");
  console.log(`   lang=${ctx.language}`);
  if (ctx.hydratedSources.length > 0) {
    console.log(`   hydrated sources (${ctx.hydratedSources.length}):`);
    for (const src of ctx.hydratedSources) {
      console.log(
        `     - ${src.sourceType}: ${src.id} (${src.markdown.length} chars)`
      );
    }
  }
  console.log(`   prompt: ${ctxPreview}${ctx.prompt.length > 400 ? "…" : ""}`);
}

async function main() {
  try {
    console.log("\n🏛️  RAG Retrieval Smoke Test");
    console.log(
      `DB: ${process.env.DATABASE_URL || process.env.POSTGRES_URL ? "configured" : "missing"}`
    );
    console.log(
      "Note: analysis may fall back to heuristics if gateway is unavailable."
    );

    if (inputQuery) {
      await runOne(inputQuery);
    } else {
      // Concise default suite hitting EN/FR (bills only)
      // Note: Uses C-35 as that's what's currently in the database
      const queries = [
        "What is Bill C-35?",
        "Qu'est-ce que le projet de loi C-35 ?",
      ];
      for (const q of queries) {
        await runOne(q);
      }
    }

    console.log("\n✨ Done");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Test failed:", err);
    process.exit(1);
  }
}

main();
