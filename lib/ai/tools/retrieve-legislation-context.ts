/**
 * Retrieve Legislation Context Tool
 *
 * AI tool for retrieving context from Canadian federal legislation
 * (acts and regulations) with bilingual support and proper citations.
 */

import crypto from "node:crypto";
import { tool } from "ai";
import { z } from "zod";
import { cacheGet, cacheSet } from "@/lib/cache/redis";
import {
  buildLegislationContext,
  type LegislationContext,
} from "@/lib/rag/legislation/context-builder";
import { hydrateTopAct } from "@/lib/rag/legislation/hydrate";
import { searchLegislation } from "@/lib/rag/legislation/search";
import {
  CACHE_TTL,
  isRagCacheDisabled,
  RERANKER_CONFIG,
  SEARCH_LIMITS,
} from "@/lib/rag/parliament/constants";
import { ragDebug } from "@/lib/rag/parliament/debug";
import { detectLanguage } from "@/lib/rag/parliament/query-analysis";

const dbg = ragDebug("leg:retrieve");

export type LegislationContextResult = LegislationContext;

/**
 * Core logic for retrieving legislation context.
 * Can be called directly or via tool.
 *
 * @param query - Search query in EN or FR
 * @param limit - Maximum results (1-100)
 * @returns Context with prompt and citations
 */
export async function getLegislationContext(
  query: string,
  limit: number = SEARCH_LIMITS.DEFAULT_LIMIT
): Promise<LegislationContextResult> {
  const t0 = Date.now();

  // Enforce limit bounds
  const boundedLimit = Math.min(Math.max(1, limit), SEARCH_LIMITS.MAX_LIMIT);

  // Check cache
  const cacheDisabled = isRagCacheDisabled();
  const cacheKey = `leg:ctx:${crypto.createHash("sha1").update(`${query}|${boundedLimit}`).digest("hex")}`;

  if (!cacheDisabled) {
    const cached = await cacheGet(cacheKey);
    if (cached) {
      try {
        const obj = JSON.parse(cached) as LegislationContextResult;
        dbg("cache hit %s", cacheKey);
        return obj;
      } catch {
        // ignore parse errors
      }
    }
  }

  // Detect language from query
  const langDetection = detectLanguage(query);
  const preferLang = langDetection.language;

  dbg(
    "query: %s, lang: %s, limit: %d",
    query.slice(0, 50),
    preferLang,
    boundedLimit
  );

  // Search with more candidates than needed for reranking
  const candidates = Math.max(
    boundedLimit * 2,
    RERANKER_CONFIG.VECTOR_SEARCH_CANDIDATES
  );
  const results = await searchLegislation(query, {
    limit: candidates,
    language: preferLang,
  });

  dbg("search returned %d results", results.length);

  // Build context with reranking (now async with Cohere cross-encoder)
  const context = await buildLegislationContext(query, results, {
    language: preferLang,
    topN: boundedLimit,
  });

  // Hydrate top act for artifact display
  const hydratedSources = await hydrateTopAct(results, preferLang);
  context.hydratedSources = hydratedSources;

  const t1 = Date.now();
  dbg(
    "timing: total=%dms, citations=%d, hydrated=%d",
    t1 - t0,
    context.citations.length,
    hydratedSources.length
  );

  // Cache result
  if (!cacheDisabled) {
    await cacheSet(
      cacheKey,
      JSON.stringify(context),
      CACHE_TTL.PARLIAMENT_CONTEXT
    );
  }

  return context;
}

/**
 * AI Tool for retrieving legislation context
 */
export const retrieveLegislationContext = tool({
  description:
    "Retrieve Canadian federal legislation context (acts and regulations) with bilingual EN/FR support. Use for questions about laws, legal provisions, section content, or regulatory requirements.",
  inputSchema: z.object({
    query: z.string().describe("Search query about legislation in EN or FR"),
    limit: z
      .number()
      .default(SEARCH_LIMITS.DEFAULT_LIMIT)
      .optional()
      .describe("Maximum number of results (default: 10)"),
  }),
  execute: async ({ query, limit }) => {
    return await getLegislationContext(query, limit);
  },
});
