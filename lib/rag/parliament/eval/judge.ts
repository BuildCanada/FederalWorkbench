/**
 * LLM-as-Judge Evaluation Module
 *
 * Uses an LLM to evaluate whether retrieved RAG context
 * would allow correctly answering a query.
 */

import { generateText } from "ai";
import { myProvider } from "@/lib/ai/providers";
import type { BuiltContext } from "../context-builder";
import type { EvalCase } from "./cases";

/**
 * Result of evaluating a single test case
 */
export type JudgeResult = {
  caseId: string;
  query: string;
  pass: boolean;
  score: number; // 1-5 scale
  reasoning: string;
  sourceTypesFound: string[];
  mustMentionFound: string[];
  mustMentionMissing: string[];
};

/**
 * Summary statistics for an evaluation run
 */
export type EvalSummary = {
  totalCases: number;
  passed: number;
  failed: number;
  averageScore: number;
  results: JudgeResult[];
};

// Regex for extracting JSON from LLM response
const JSON_REGEX = /\{[\s\S]*\}/;

const JUDGE_PROMPT = `You are evaluating RAG (Retrieval-Augmented Generation) search quality for a Canadian Parliament chatbot.

Given a user query and the retrieved context, determine if the context contains enough relevant information to correctly answer the query.

## User Query
{query}

## Expected Output
The context should contain: {expectedOutput}

## Retrieved Context
{context}

## Evaluation Criteria
1. **Relevance**: Does the context contain information directly relevant to the query?
2. **Completeness**: Does it cover the key aspects mentioned in "Expected Output"?
3. **Source Quality**: Are the sources appropriate for this query type?
4. **Accuracy Potential**: Would an LLM using this context likely give an accurate answer?

## Response Format
Respond with a JSON object only, no markdown:
{
  "pass": true or false,
  "score": 1-5 (1=irrelevant, 2=poor, 3=partial, 4=good, 5=excellent),
  "reasoning": "Brief explanation of your evaluation"
}`;

/**
 * Judge a single test case using LLM
 */
export async function judgeCase(
  evalCase: EvalCase,
  context: BuiltContext
): Promise<JudgeResult> {
  const prompt = JUDGE_PROMPT.replace("{query}", evalCase.query)
    .replace("{expectedOutput}", evalCase.expectedOutput)
    .replace("{context}", context.prompt || "(No context retrieved)");

  // Extract source types from context
  const sourceTypesFound = extractSourceTypes(context.prompt);

  // Check for must-mention terms
  const mustMentionFound: string[] = [];
  const mustMentionMissing: string[] = [];
  if (evalCase.mustMention) {
    for (const term of evalCase.mustMention) {
      if (context.prompt.toLowerCase().includes(term.toLowerCase())) {
        mustMentionFound.push(term);
      } else {
        mustMentionMissing.push(term);
      }
    }
  }

  try {
    const { text } = await generateText({
      model: myProvider.languageModel("small-model"),
      prompt,
      temperature: 0,
    });

    // Parse JSON response
    const jsonMatch = text.match(JSON_REGEX);
    if (!jsonMatch) {
      return {
        caseId: evalCase.id,
        query: evalCase.query,
        pass: false,
        score: 1,
        reasoning: `Failed to parse judge response: ${text}`,
        sourceTypesFound,
        mustMentionFound,
        mustMentionMissing,
      };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      pass: boolean;
      score: number;
      reasoning: string;
    };

    return {
      caseId: evalCase.id,
      query: evalCase.query,
      pass: parsed.pass,
      score: parsed.score,
      reasoning: parsed.reasoning,
      sourceTypesFound,
      mustMentionFound,
      mustMentionMissing,
    };
  } catch (error) {
    return {
      caseId: evalCase.id,
      query: evalCase.query,
      pass: false,
      score: 1,
      reasoning: `Judge error: ${error instanceof Error ? error.message : String(error)}`,
      sourceTypesFound,
      mustMentionFound,
      mustMentionMissing,
    };
  }
}

/**
 * Extract source types mentioned in context
 */
function extractSourceTypes(contextPrompt: string): string[] {
  const sourceTypes = [
    "bill",
    "hansard",
    "vote_question",
    "vote_party",
    "vote_member",
    "politician",
    "committee",
    "committee_report",
    "committee_meeting",
    "party",
    "election",
    "candidacy",
    "session",
    "riding",
  ];

  return sourceTypes.filter((type) => contextPrompt.includes(`(${type})`));
}

/**
 * Compute summary statistics from results
 */
export function computeSummary(results: JudgeResult[]): EvalSummary {
  const passed = results.filter((r) => r.pass).length;
  const totalScore = results.reduce((sum, r) => sum + r.score, 0);

  return {
    totalCases: results.length,
    passed,
    failed: results.length - passed,
    averageScore: results.length > 0 ? totalScore / results.length : 0,
    results,
  };
}

/**
 * Format results for console output
 */
export function formatResults(summary: EvalSummary): string {
  const lines: string[] = [
    "",
    "═══════════════════════════════════════════════════════════",
    "                    RAG EVALUATION RESULTS                  ",
    "═══════════════════════════════════════════════════════════",
    "",
  ];

  for (const result of summary.results) {
    const status = result.pass ? "✓ PASS" : "✗ FAIL";
    const scoreBar = "█".repeat(result.score) + "░".repeat(5 - result.score);

    lines.push(`${status} [${scoreBar}] ${result.caseId}`);
    lines.push(`  Query: ${result.query}`);
    lines.push(`  Score: ${result.score}/5 - ${result.reasoning}`);

    if (result.mustMentionMissing.length > 0) {
      lines.push(`  Missing: ${result.mustMentionMissing.join(", ")}`);
    }
    lines.push("");
  }

  lines.push("═══════════════════════════════════════════════════════════");
  lines.push(`  Total: ${summary.totalCases} cases`);
  lines.push(
    `  Passed: ${summary.passed} (${Math.round((summary.passed / summary.totalCases) * 100)}%)`
  );
  lines.push(`  Failed: ${summary.failed}`);
  lines.push(`  Average Score: ${summary.averageScore.toFixed(2)}/5`);
  lines.push("═══════════════════════════════════════════════════════════");
  lines.push("");

  return lines.join("\n");
}
