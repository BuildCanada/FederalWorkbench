#!/usr/bin/env npx tsx

/**
 * RAG Evaluation Script
 *
 * Runs test cases through the RAG pipeline and uses LLM-as-judge
 * to evaluate the quality of retrieved context.
 *
 * Usage:
 *   npx tsx scripts/eval-rag.ts                    # Run all cases
 *   npx tsx scripts/eval-rag.ts --case bill-c11    # Run single case
 *   npx tsx scripts/eval-rag.ts --source bill      # Run cases for source type
 *   npx tsx scripts/eval-rag.ts --json             # Output JSON results
 */

import { config } from "dotenv";

config({ path: ".env.local" });

import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { getParliamentContext } from "@/lib/ai/tools/retrieve-parliament-context";
import type { BuiltContext } from "@/lib/rag/parliament/context-builder";
import {
  evalCases,
  getCaseById,
  getCasesBySource,
} from "@/lib/rag/parliament/eval/cases";
import {
  computeSummary,
  formatResults,
  type JudgeResult,
  judgeCase,
} from "@/lib/rag/parliament/eval/judge";

// Parse command line arguments
const { values } = parseArgs({
  options: {
    case: { type: "string", short: "c" },
    source: { type: "string", short: "s" },
    json: { type: "boolean", short: "j", default: false },
    output: { type: "string", short: "o" },
    verbose: { type: "boolean", short: "v", default: false },
  },
});

async function main() {
  console.log("\n🔍 RAG Evaluation Starting...\n");

  // Determine which cases to run
  let casesToRun = [...evalCases];

  if (values.case) {
    const singleCase = getCaseById(values.case);
    if (!singleCase) {
      console.error(`❌ Case not found: ${values.case}`);
      console.error(
        `Available cases: ${evalCases.map((c) => c.id).join(", ")}`
      );
      process.exit(1);
    }
    casesToRun = [singleCase];
  } else if (values.source) {
    casesToRun = getCasesBySource(values.source);
    if (casesToRun.length === 0) {
      console.error(`❌ No cases found for source: ${values.source}`);
      process.exit(1);
    }
  }

  console.log(`Running ${casesToRun.length} test case(s)...\n`);

  const results: JudgeResult[] = [];

  for (const evalCase of casesToRun) {
    process.stdout.write(`  Evaluating: ${evalCase.id}...`);

    try {
      // Run RAG pipeline
      const ragResult = await getParliamentContext(evalCase.query, 10);

      // Convert to BuiltContext format for judge
      const context: BuiltContext = {
        language: ragResult.language,
        prompt: ragResult.prompt,
        citations: ragResult.citations,
      };

      if (values.verbose) {
        console.log("\n  Context retrieved:");
        console.log(
          ragResult.prompt.slice(0, 500) +
            (ragResult.prompt.length > 500 ? "..." : "")
        );
      }

      // Judge the result
      const judgeResult = await judgeCase(evalCase, context);
      results.push(judgeResult);

      const status = judgeResult.pass ? "✓" : "✗";
      process.stdout.write(` ${status} (${judgeResult.score}/5)\n`);
    } catch (error) {
      console.log(" ❌ ERROR");
      results.push({
        caseId: evalCase.id,
        query: evalCase.query,
        pass: false,
        score: 0,
        reasoning: `Pipeline error: ${error instanceof Error ? error.message : String(error)}`,
        sourceTypesFound: [],
        mustMentionFound: [],
        mustMentionMissing: evalCase.mustMention || [],
      });
    }
  }

  // Compute summary
  const summary = computeSummary(results);

  // Output results
  if (values.json) {
    const jsonOutput = JSON.stringify(summary, null, 2);
    if (values.output) {
      writeFileSync(values.output, jsonOutput);
      console.log(`\nResults written to: ${values.output}`);
    } else {
      console.log(jsonOutput);
    }
  } else {
    console.log(formatResults(summary));

    // Save JSON alongside for tracking
    if (values.output) {
      writeFileSync(values.output, JSON.stringify(summary, null, 2));
      console.log(`Results also saved to: ${values.output}`);
    }
  }

  // Exit with error code if any tests failed
  process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
