import crypto from "node:crypto";
import { tool } from "ai";
import { z } from "zod";
import { cacheGet, cacheSet } from "@/lib/cache/redis";
import {
  type BuiltCitation,
  buildContext,
} from "@/lib/rag/parliament/context-builder";
import { ragDebug } from "@/lib/rag/parliament/debug";
import {
  getAllPoliticians,
  getCompleteMemberVotesForBill,
} from "@/lib/rag/parliament/enumeration";
import {
  type HydratedSource,
  hydrateTopPerType,
} from "@/lib/rag/parliament/hydrate-dispatcher";
import { filterByAllowedCitations } from "@/lib/rag/parliament/intent-config";
import { multiQuerySearch } from "@/lib/rag/parliament/multi-query";
import {
  analyzeQuery,
  detectSearchTypes,
  type EnumerationIntent,
  generateQueryReformulations,
  type QueryAnalysis,
} from "@/lib/rag/parliament/query-analysis";
import { getHydratedBillMarkdown } from "@/lib/rag/parliament/sources/bills/hydrate";
import { buildVoteQuestionCitation } from "@/lib/rag/parliament/sources/votes/citations";
import type { Lang } from "@/lib/rag/parliament/types";
import {
  CACHE_TTL,
  isRagCacheDisabled,
  RERANKER_CONFIG,
  SEARCH_LIMITS,
} from "@/lib/rag/shared/constants";

const dbgRetrieve = ragDebug("parl:retrieve");
const dbgEnum = ragDebug("parl:retrieve:enum");

/**
 * Handle enumeration queries by fetching complete result sets.
 * Returns null if enumeration fails (caller should fall back to normal search).
 */
async function handleEnumerationQuery(
  enumeration: EnumerationIntent,
  language: Lang,
  cacheDisabled: boolean,
  cacheKey: string
): Promise<ParliamentContextResult | null> {
  // Handle vote enumeration
  if (enumeration.type === "vote" && enumeration.billNumber) {
    dbgEnum(
      "handling vote enumeration: bill=%s, voteType=%s, party=%s",
      enumeration.billNumber,
      enumeration.voteType,
      enumeration.partySlug
    );

    const votes = await getCompleteMemberVotesForBill({
      billNumber: enumeration.billNumber,
      voteType: enumeration.voteType,
      partySlug: enumeration.partySlug,
      language,
    });

    if (!votes) {
      dbgEnum("no votes found for bill %s", enumeration.billNumber);
      return null;
    }

    dbgEnum(
      "enumeration returned %d votes for bill %s",
      votes.memberVotes.length,
      enumeration.billNumber
    );

    // Build citation using the shared builder with enumeration-specific overrides
    const citation = buildVoteQuestionCitation(
      {
        sessionId: votes.voteQuestion.sessionId,
        voteNumber: votes.voteQuestion.number,
        date: votes.voteQuestion.date,
        result: votes.voteQuestion.result,
      },
      {
        // Richer context for enumeration
        titleEn: `Vote #${votes.voteQuestion.number} on Bill ${votes.bill.number}`,
        titleFr: `Vote nº ${votes.voteQuestion.number} sur le projet de loi ${votes.bill.number}`,
        textEn: `${votes.memberVotes.length} member votes for ${votes.bill.nameEn}`,
        textFr: `${votes.memberVotes.length} votes des membres pour ${votes.bill.nameFr}`,
      }
    );

    // Hydrate the bill so the "Open full bill text" button appears
    const hydratedSources: HydratedSource[] = [];
    const [pStr, sStr] = votes.bill.sessionId.split("-");
    const parliament = Number.parseInt(pStr, 10);
    const session = Number.parseInt(sStr, 10);
    if (Number.isFinite(parliament) && Number.isFinite(session)) {
      try {
        const hydrated = await getHydratedBillMarkdown({
          billNumber: votes.bill.number,
          parliament,
          session,
          language,
        });
        hydratedSources.push({
          sourceType: "bill",
          markdown: hydrated.markdown,
          languageUsed: hydrated.languageUsed,
          id: `bill-${votes.bill.number}-${votes.bill.sessionId}`,
          note: hydrated.note,
        });
        dbgEnum("hydrated bill %s for enumeration", votes.bill.number);
      } catch (err) {
        dbgEnum("failed to hydrate bill %s: %O", votes.bill.number, err);
      }
    }

    const result: ParliamentContextResult = {
      language,
      prompt: votes.markdown,
      citations: [
        {
          id: 1,
          prefixedId: "P1",
          type: citation.sourceType,
          titleEn: citation.titleEn,
          titleFr: citation.titleFr,
          textEn: citation.textEn,
          textFr: citation.textFr,
          urlEn: citation.urlEn,
          urlFr: citation.urlFr,
        },
      ],
      hydratedSources,
    };

    if (!cacheDisabled) {
      await cacheSet(
        cacheKey,
        JSON.stringify(result),
        CACHE_TTL.PARLIAMENT_CONTEXT
      );
    }

    return result;
  }

  // Handle politician enumeration
  if (enumeration.type === "politician") {
    dbgEnum("handling politician enumeration: party=%s", enumeration.partySlug);

    // For now, require a party filter or default to current MPs
    const politicians = await getAllPoliticians({
      partySlug: enumeration.partySlug,
      currentOnly: !enumeration.partySlug, // If no party filter, get current MPs
      language,
    });

    if (!politicians) {
      dbgEnum("no politicians found");
      return null;
    }

    dbgEnum("enumeration returned %d politicians", politicians.total);

    const result: ParliamentContextResult = {
      language,
      prompt: politicians.markdown,
      citations: [
        {
          id: 1,
          prefixedId: "P1",
          type: "politicians",
          titleEn: enumeration.partySlug
            ? `${enumeration.partySlug} MPs`
            : "Current Members of Parliament",
          titleFr: enumeration.partySlug
            ? `Députés ${enumeration.partySlug}`
            : "Députés actuels",
          textEn: `${politicians.total} members`,
          textFr: `${politicians.total} membres`,
          urlEn: "https://www.ourcommons.ca/members/en",
          urlFr: "https://www.noscommunes.ca/members/fr",
        },
      ],
      hydratedSources: [],
    };

    if (!cacheDisabled) {
      await cacheSet(
        cacheKey,
        JSON.stringify(result),
        CACHE_TTL.PARLIAMENT_CONTEXT
      );
    }

    return result;
  }

  // Committee enumeration not yet implemented
  if (enumeration.type === "committee") {
    dbgEnum("committee enumeration not yet implemented");
    return null;
  }

  return null;
}

export type ParliamentContextResult = {
  readonly language: "en" | "fr" | "unknown";
  readonly prompt: string;
  readonly citations: BuiltCitation[];
  /** Hydrated sources - one per source type that had search results */
  readonly hydratedSources: HydratedSource[];
};

/**
 * Core logic for retrieving Parliament context. Can be called directly or via tool.
 */
export async function getParliamentContext(
  query: string,
  limit: number = SEARCH_LIMITS.DEFAULT_LIMIT
): Promise<ParliamentContextResult> {
  // Enforce limit bounds to prevent over-fetching
  const boundedLimit = Math.min(Math.max(1, limit), SEARCH_LIMITS.MAX_LIMIT);
  const t0 = Date.now();
  const cacheDisabled = isRagCacheDisabled();
  const cacheKey = `ctx:v2:${crypto.createHash("sha1").update(`${query}|${boundedLimit}`).digest("hex")}`;

  if (!cacheDisabled) {
    const cached = await cacheGet(cacheKey);
    if (cached) {
      try {
        const obj = JSON.parse(cached) as ParliamentContextResult;
        dbgRetrieve("cache hit ctx %s", cacheKey);
        return obj;
      } catch {
        // ignore JSON parse errors, refetch context
      }
    }
  }

  let analysis: QueryAnalysis = await analyzeQuery(query);
  dbgRetrieve("analysis: %o", {
    lang: analysis.language,
    priorityIntent: analysis.priorityIntent,
    searchTypes: analysis.searchTypes,
    reformulations: analysis.reformulatedQueries.length,
    enumeration: analysis.enumeration,
  });
  const preferLang = analysis.language === "fr" ? "fr" : "en";

  // Handle enumeration queries - fetch complete results directly
  if (analysis.enumeration.isEnumeration) {
    const enumResult = await handleEnumerationQuery(
      analysis.enumeration,
      preferLang,
      cacheDisabled,
      cacheKey
    );
    if (enumResult) {
      const t1 = Date.now();
      dbgRetrieve("timing: enumeration total=%dms", t1 - t0);
      return enumResult;
    }
    // Fall through to normal search if enumeration failed
    // Re-run type detection and reformulation since they were skipped for enumeration
    dbgRetrieve(
      "enumeration failed, re-running type detection for fallback search"
    );
    const [searchTypes, reformulatedQueries] = await Promise.all([
      detectSearchTypes(query),
      generateQueryReformulations(query, analysis.language),
    ]);
    analysis = {
      ...analysis,
      searchTypes,
      reformulatedQueries,
      enumeration: { isEnumeration: false }, // Clear enumeration flag for normal search
    };
    dbgRetrieve(
      "fallback analysis: searchTypes=%o, reformulations=%d",
      searchTypes,
      reformulatedQueries.length
    );
  }

  // Multi-query search: original + reformulations, then rerank
  const candidatesPerQuery = Math.max(
    Math.ceil(RERANKER_CONFIG.VECTOR_SEARCH_CANDIDATES / 2),
    20
  );
  const searchResults = await multiQuerySearch(
    analysis,
    boundedLimit * 2, // Get extra to allow for filtering
    candidatesPerQuery
  );

  // HARD FILTER: Only allow citation types defined for this intent
  // This is the key enforcement - intent determines what citations are allowed
  const results = filterByAllowedCitations(
    searchResults,
    analysis.priorityIntent
  ).slice(0, boundedLimit);

  dbgRetrieve(
    "pipeline: multiQuery=%d -> filtered=%d (intent=%s)",
    searchResults.length,
    results.length,
    analysis.priorityIntent
  );

  // Hydrate top result per source type in parallel
  const hydratedSources = await hydrateTopPerType(results, preferLang);

  // Build context prompt with citations
  const ctx = buildContext(results, {
    language: analysis.language,
  });

  const t1 = Date.now();
  dbgRetrieve(
    "timing: total=%dms hydratedTypes=%d hits=%d",
    t1 - t0,
    hydratedSources.length,
    results.length
  );

  const result: ParliamentContextResult = {
    language: ctx.language,
    prompt: ctx.prompt,
    citations: ctx.citations,
    hydratedSources,
  } as const;

  if (!cacheDisabled) {
    await cacheSet(
      cacheKey,
      JSON.stringify(result),
      CACHE_TTL.PARLIAMENT_CONTEXT
    );
  }
  return result;
}

export const retrieveParliamentContext = tool({
  description:
    "Retrieve Canadian Parliament context (bills, committees, elections, hansard, parties, politicians, ridings, sessions, votes) with bilingual support and citations.",
  inputSchema: z.object({
    query: z.string().describe("User query in EN or FR"),
    limit: z
      .number()
      .default(SEARCH_LIMITS.DEFAULT_LIMIT)
      .optional()
      .describe("Max results (1-100)"),
  }),
  execute: async ({ query, limit }) => {
    return await getParliamentContext(query, limit);
  },
});
