/**
 * Link paired defined terms between EN and FR versions
 *
 * This script populates the pairedTermId field in the defined_terms table,
 * enabling fast language toggles without requiring JOIN + normalization at query time.
 *
 * The linking process uses three passes:
 *
 * Pass 1 - Exact section match (terms with pairedTerm from XML):
 *   Match terms by document + section + normalized term.
 *   This is the strict/correct approach when a term may have different
 *   definitions in different sections of the same document.
 *
 * Pass 2 - Fallback for unique terms (terms with pairedTerm from XML):
 *   For terms that didn't match in pass 1 (e.g., due to translated section
 *   labels like RULE/RÈGLE), fall back to document + normalized term matching,
 *   but ONLY if both the source term and target term appear exactly once
 *   in their respective documents. This prevents incorrect links when a term
 *   has multiple definitions.
 *
 * Pass 3 - Section-based matching (terms WITHOUT pairedTerm):
 *   For terms where the XML didn't include a <DefinedTermFr> or <DefinedTermEn> tag,
 *   link terms if:
 *   - Same document (act_id or regulation_id)
 *   - Same section_label
 *   - Exactly one EN term and one FR term in that section (both without pairedTerm)
 *   This catches inline definitions that weren't cross-referenced in the source XML.
 *
 * Usage:
 *   npx tsx scripts/embeddings/legislation/link-defined-terms.ts
 *   npx tsx scripts/embeddings/legislation/link-defined-terms.ts --dry-run
 *   npx tsx scripts/embeddings/legislation/link-defined-terms.ts --limit=100
 *   npx tsx scripts/embeddings/legislation/link-defined-terms.ts --debug
 *   npx tsx scripts/embeddings/legislation/link-defined-terms.ts --debug --dry-run
 */

import { config } from "dotenv";

config({ path: ".env.local" });

import { and, eq, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { definedTerms } from "@/lib/db/legislation/schema";
import {
  normalizeTermForMatching,
  translateRegulationId,
} from "@/lib/legislation/utils/normalization";
import {
  correctActualTermForLinking,
  correctPairedTermForLinking,
  getDocumentsWithCorrections,
  getDocumentsWithTermCorrections,
  getTotalCorrectionCount,
  getTotalTermCorrectionCount,
} from "@/scripts/utils/legislation-typos";

/**
 * Calculate Levenshtein distance between two strings.
 * Used for typo detection in paired terms.
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  // Initialize first column
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }

  // Initialize first row
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[a.length][b.length];
}

/**
 * Check if two terms are similar enough to suggest a typo.
 * Returns true if edit distance is small relative to term length.
 */
function isPotentialTypo(
  term1: string,
  term2: string,
  maxDistance = 3
): boolean {
  // Normalize for comparison
  const t1 = term1.toLowerCase();
  const t2 = term2.toLowerCase();

  // Skip if lengths are too different
  const lenDiff = Math.abs(t1.length - t2.length);
  if (lenDiff > maxDistance) {
    return false;
  }

  // Skip very short terms (too many false positives)
  if (t1.length < 5 || t2.length < 5) {
    return false;
  }

  const distance = levenshteinDistance(t1, t2);

  // Allow more distance for longer terms
  const threshold = Math.min(maxDistance, Math.floor(t1.length / 4));
  return distance > 0 && distance <= Math.max(threshold, 2);
}

/**
 * Potential typo detected in source data
 */
type PotentialTypo = {
  sourceTermId: string;
  sourceLanguage: string;
  sourceTerm: string;
  pairedTerm: string;
  pairedTermNormalized: string;
  similarTerm: string;
  similarTermNormalized: string;
  editDistance: number;
  docId: string;
  sectionLabel: string | null;
};

/**
 * Regex to detect if a term contains alternatives.
 * Triggers on: " or ", " ou ", or commas (comma-separated lists)
 * Placed at module level for performance.
 */
const HAS_ALTERNATIVES_REGEX = /(?:,| (?:or|ou) )/i;

/**
 * Regex to split alternatives: " or ", " ou ", and commas
 * Only used as fallback when exact match fails.
 * Placed at module level for performance.
 */
const ALTERNATIVES_SPLIT_REGEX = /\s+(?:or|ou)\s+|,\s*/i;

/**
 * Regex to detect language-only markers.
 * These indicate the term intentionally has no translation.
 * Examples: "Version anglaise seulement", "French version only"
 */
const LANGUAGE_ONLY_MARKER_REGEX =
  /^(?:Version (?:anglaise|française) seulement|(?:English|French) version only)$/i;

/**
 * Check if a paired term is a language-only marker.
 */
function isLanguageOnlyMarker(pairedTerm: string): boolean {
  return LANGUAGE_ONLY_MARKER_REGEX.test(pairedTerm.trim());
}

/**
 * Get alternative terms to try matching.
 * Returns the full term first, then split alternatives as fallback.
 *
 * This handles cases like:
 * - "voie X or voie Y" → try "voie X or voie Y", then "voie X", then "voie Y"
 * - "dirigeant ou employé" → try "dirigeant ou employé" first (matches as single term)
 */
function getMatchCandidates(pairedTerm: string): string[] {
  // Skip splitting for "language only" markers
  if (pairedTerm.includes("Version") || pairedTerm.includes("version only")) {
    return [pairedTerm];
  }

  const candidates = [pairedTerm]; // Always try full term first

  // Only try splitting if the term contains " or " or " ou " (not "and")
  // "and" typically means both parts together, not alternatives
  if (HAS_ALTERNATIVES_REGEX.test(pairedTerm)) {
    const parts = pairedTerm
      .split(ALTERNATIVES_SPLIT_REGEX)
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && p !== pairedTerm);
    candidates.push(...parts);
  }

  return candidates;
}

// ---------- CLI args ----------
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const debug = args.includes("--debug");
const limitArg = args.find((arg) => arg.startsWith("--limit="));
const limit = limitArg
  ? Number.parseInt(limitArg.split("=")[1], 10)
  : undefined;

// ---------- Types ----------
type LinkStats = {
  totalTerms: number;
  termsWithPairedText: number;
  /** Terms linked via exact section match (pass 1) */
  linkedExact: number;
  /** Terms linked via fallback when both sides unique in doc (pass 2) */
  linkedFallback: number;
  /** Terms linked via section-based matching for terms without pairedTerm (pass 3) */
  linkedSectionBased: number;
  /** Total pairs linked (linkedExact + linkedFallback + linkedSectionBased) */
  pairsLinked: number;
  alreadyLinked: number;
  /** Terms skipped because paired term is a language-only marker */
  languageOnlySkipped: number;
  /** Terms where a typo correction was applied */
  typosCorrected: number;
  noMatchFound: number;
  /** Terms without pairedTerm that couldn't be matched */
  noPairedTermNoMatch: number;
  errors: number;
};

/**
 * Info about a term skipped due to language-only marker
 */
type LanguageOnlyTerm = {
  id: string;
  language: string;
  term: string;
  pairedTerm: string;
  docId: string;
};

/**
 * Debug info for an unmatched term
 */
type DebugUnmatchedTerm = {
  id: string;
  language: string;
  term: string;
  termNormalized: string;
  pairedTerm: string;
  pairedTermNormalized: string;
  docId: string;
  targetDocId: string;
  sectionLabel: string | null;
  targetLang: string;
  exactKeysAttempted: string[];
  docKeysAttempted: string[];
  failureReason: string;
  sourceCount?: number;
  targetCounts?: Array<{ key: string; count: number }>;
};

/**
 * Link defined term pairs within a transaction.
 */
export async function linkDefinedTermPairs(
  db: PostgresJsDatabase,
  options: { dryRun: boolean; limit?: number; debug?: boolean }
): Promise<LinkStats> {
  const stats: LinkStats = {
    totalTerms: 0,
    termsWithPairedText: 0,
    linkedExact: 0,
    linkedFallback: 0,
    linkedSectionBased: 0,
    pairsLinked: 0,
    alreadyLinked: 0,
    languageOnlySkipped: 0,
    typosCorrected: 0,
    noMatchFound: 0,
    noPairedTermNoMatch: 0,
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
      sectionLabel: definedTerms.sectionLabel,
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

  // Fetch all terms for building lookup maps
  const allTerms = await db
    .select({
      id: definedTerms.id,
      language: definedTerms.language,
      term: definedTerms.term,
      termNormalized: definedTerms.termNormalized,
      actId: definedTerms.actId,
      regulationId: definedTerms.regulationId,
      sectionLabel: definedTerms.sectionLabel,
    })
    .from(definedTerms);

  // Build lookup maps:
  // 1. Exact match: `${language}:${docId}:${sectionLabel}:${termNormalized}` → id
  //    Used for pass 1 - matches terms within the same section
  // 2. Doc-level match: `${language}:${docId}:${termNormalized}` → id
  //    Used for pass 2 fallback - only safe when term is unique in document
  // 3. Term count per doc: `${language}:${docId}:${termNormalized}` → count
  //    Used to check if a term appears exactly once in a document
  // 4. Terms by doc: `${language}:${docId}` → Array of {term, termNormalized}
  //    Used for typo detection - find similar terms in target document
  const exactLookup = new Map<string, string>();
  const docLevelLookup = new Map<string, string>();
  const termCountPerDoc = new Map<string, number>();
  const termsByDoc = new Map<
    string,
    Array<{ term: string; termNormalized: string }>
  >();

  for (const t of allTerms) {
    const docId = t.actId || t.regulationId || "";

    // Apply term corrections for documents with known typos in actual terms
    // This allows the corrected version to be found in lookups
    const correctedTerm = correctActualTermForLinking(docId, t.term);
    const correctedTermNormalized =
      correctedTerm !== t.term
        ? normalizeTermForMatching(correctedTerm)
        : t.termNormalized;

    // Exact lookup (with section) - use corrected/normalized term
    const exactKey = `${t.language}:${docId}:${t.sectionLabel}:${correctedTermNormalized}`;
    exactLookup.set(exactKey, t.id);

    // Also add original term to lookup if it was corrected (for reverse lookups)
    if (correctedTermNormalized !== t.termNormalized) {
      const originalExactKey = `${t.language}:${docId}:${t.sectionLabel}:${t.termNormalized}`;
      exactLookup.set(originalExactKey, t.id);
    }

    // Doc-level lookup (without section) - stores last seen id
    const docKey = `${t.language}:${docId}:${correctedTermNormalized}`;
    docLevelLookup.set(docKey, t.id);

    // Also add original term to doc-level lookup if corrected
    if (correctedTermNormalized !== t.termNormalized) {
      const originalDocKey = `${t.language}:${docId}:${t.termNormalized}`;
      docLevelLookup.set(originalDocKey, t.id);
    }

    // Count occurrences per document (use corrected term for consistency)
    termCountPerDoc.set(docKey, (termCountPerDoc.get(docKey) || 0) + 1);

    // Store term by doc for typo detection (use corrected term)
    const docOnlyKey = `${t.language}:${docId}`;
    if (!termsByDoc.has(docOnlyKey)) {
      termsByDoc.set(docOnlyKey, []);
    }
    termsByDoc
      .get(docOnlyKey)
      ?.push({ term: correctedTerm, termNormalized: correctedTermNormalized });
  }

  console.log(`Built exact lookup map with ${exactLookup.size} entries`);
  console.log(`Built doc-level lookup map with ${docLevelLookup.size} entries`);

  // Debug: show sample lookup keys
  if (options.debug) {
    console.log("\n--- DEBUG: Sample exact lookup keys ---");
    let count = 0;
    for (const key of exactLookup.keys()) {
      if (count++ >= 5) {
        break;
      }
      console.log(`  ${key}`);
    }
    console.log("\n--- DEBUG: Sample doc-level lookup keys ---");
    count = 0;
    for (const key of docLevelLookup.keys()) {
      if (count++ >= 5) {
        break;
      }
      console.log(`  ${key} (count: ${termCountPerDoc.get(key)})`);
    }
  }

  // Track pairs to update (batch for efficiency)
  const updates: Array<{ id: string; pairedTermId: string }> = [];
  // Track unmatched terms for pass 2
  const unmatchedTerms: typeof termsToLink = [];
  // Track debug info for unmatched terms
  const debugUnmatched: DebugUnmatchedTerm[] = [];
  // Track potential typos for reporting
  const potentialTypos: PotentialTypo[] = [];
  // Track language-only markers (terms with no translation)
  const languageOnlyTerms: LanguageOnlyTerm[] = [];

  // ---------- PASS 1: Exact section match ----------
  console.log("\n--- Pass 1: Exact section matching ---");

  for (const term of termsToLink) {
    if (!term.pairedTerm) {
      continue;
    }

    // Check for language-only markers - these have no translation by design
    if (isLanguageOnlyMarker(term.pairedTerm)) {
      stats.languageOnlySkipped++;
      languageOnlyTerms.push({
        id: term.id,
        language: term.language,
        term: term.term,
        pairedTerm: term.pairedTerm,
        docId: term.actId || term.regulationId || "",
      });
      continue;
    }

    // Determine the target language
    const targetLang = term.language === "en" ? "fr" : "en";
    const fromLang = term.language as "en" | "fr";

    // For acts, the actId is the same across languages
    // For regulations, we need to translate the regulationId to the target language
    let docId: string;
    if (term.actId) {
      docId = term.actId;
    } else if (term.regulationId) {
      docId = translateRegulationId(term.regulationId, fromLang, targetLang);
    } else {
      docId = "";
    }

    // Apply typo corrections before matching
    const sourceDocId = term.actId || term.regulationId || "";
    const correctedPairedTerm = correctPairedTermForLinking(
      sourceDocId,
      term.pairedTerm
    );
    const wasCorrected = correctedPairedTerm !== term.pairedTerm;
    if (wasCorrected) {
      stats.typosCorrected++;
      if (options.debug) {
        console.log(
          `  [TYPO] "${term.pairedTerm}" → "${correctedPairedTerm}" (${sourceDocId})`
        );
      }
    }

    // Try to match the paired term with exact section match
    const candidates = getMatchCandidates(correctedPairedTerm);
    let matchedId: string | undefined;
    const exactKeysAttempted: string[] = [];

    for (const candidate of candidates) {
      const normalizedCandidate = normalizeTermForMatching(candidate);
      const lookupKey = `${targetLang}:${docId}:${term.sectionLabel}:${normalizedCandidate}`;
      exactKeysAttempted.push(lookupKey);
      matchedId = exactLookup.get(lookupKey);
      if (matchedId) {
        break;
      }
    }

    if (matchedId) {
      updates.push({ id: term.id, pairedTermId: matchedId });
      stats.linkedExact++;
    } else {
      // Save for pass 2 with debug info
      unmatchedTerms.push(term);
      if (options.debug) {
        debugUnmatched.push({
          id: term.id,
          language: term.language,
          term: term.term,
          termNormalized: term.termNormalized || "",
          pairedTerm: term.pairedTerm,
          pairedTermNormalized: normalizeTermForMatching(term.pairedTerm),
          docId: term.actId || term.regulationId || "",
          targetDocId: docId,
          sectionLabel: term.sectionLabel,
          targetLang,
          exactKeysAttempted,
          docKeysAttempted: [], // Will be filled in pass 2
          failureReason: "pass1_no_exact_match",
        });
      }
    }
  }

  console.log(`Pass 1: ${stats.linkedExact} linked via exact section match`);
  console.log(
    `Pass 1: ${stats.languageOnlySkipped} skipped (language-only markers)`
  );
  console.log(`Pass 1: ${unmatchedTerms.length} unmatched, trying fallback...`);

  // ---------- PASS 2: Fallback for unique terms ----------
  // Only link if BOTH the source term and target term appear exactly once in their documents
  // This prevents incorrect links when a term has multiple definitions in different sections
  console.log("\n--- Pass 2: Fallback matching (unique terms only) ---");

  for (let i = 0; i < unmatchedTerms.length; i++) {
    const term = unmatchedTerms[i];
    if (!term.pairedTerm) {
      continue;
    }

    const targetLang = term.language === "en" ? "fr" : "en";
    const fromLang = term.language as "en" | "fr";

    // Get source document ID (in source language)
    const sourceDocId = term.actId || term.regulationId || "";

    // Get target document ID (translated for regulations)
    let targetDocId: string;
    if (term.actId) {
      targetDocId = term.actId;
    } else if (term.regulationId) {
      targetDocId = translateRegulationId(
        term.regulationId,
        fromLang,
        targetLang
      );
    } else {
      targetDocId = "";
    }

    // Check if source term appears exactly once in source document
    const sourceKey = `${fromLang}:${sourceDocId}:${term.termNormalized}`;
    const sourceCount = termCountPerDoc.get(sourceKey) || 0;

    if (sourceCount !== 1) {
      // Source term appears multiple times - ambiguous, skip
      stats.noMatchFound++;
      // Update debug info
      if (options.debug && debugUnmatched[i]) {
        debugUnmatched[i].sourceCount = sourceCount;
        debugUnmatched[i].failureReason =
          `pass2_source_not_unique (count: ${sourceCount})`;
      }
      continue;
    }

    // Apply typo corrections (may have been corrected in pass 1, but we
    // need the corrected value here for pass 2 matching)
    const correctedPairedTerm = correctPairedTermForLinking(
      sourceDocId,
      term.pairedTerm
    );

    // Try to find a unique match in target document
    const candidates = getMatchCandidates(correctedPairedTerm);
    let matchedId: string | undefined;
    const docKeysAttempted: string[] = [];
    const targetCounts: Array<{ key: string; count: number }> = [];

    for (const candidate of candidates) {
      const normalizedCandidate = normalizeTermForMatching(candidate);
      const targetKey = `${targetLang}:${targetDocId}:${normalizedCandidate}`;
      const targetCount = termCountPerDoc.get(targetKey) || 0;
      docKeysAttempted.push(targetKey);
      targetCounts.push({ key: targetKey, count: targetCount });

      if (targetCount === 1) {
        // Target term appears exactly once - safe to link
        matchedId = docLevelLookup.get(targetKey);
        if (matchedId) {
          break;
        }
      }
    }

    if (matchedId) {
      updates.push({ id: term.id, pairedTermId: matchedId });
      stats.linkedFallback++;
      // Remove from debug list since it was linked
      if (options.debug && debugUnmatched[i]) {
        debugUnmatched.splice(i, 1);
      }
    } else {
      stats.noMatchFound++;
      // Update debug info with pass 2 details
      if (options.debug && debugUnmatched[i]) {
        debugUnmatched[i].sourceCount = sourceCount;
        debugUnmatched[i].docKeysAttempted = docKeysAttempted;
        debugUnmatched[i].targetCounts = targetCounts;
        // Determine specific failure reason
        const hasTargetInLookup = targetCounts.some((tc) => tc.count > 0);
        if (hasTargetInLookup) {
          const notUnique = targetCounts.filter((tc) => tc.count > 1);
          if (notUnique.length > 0) {
            debugUnmatched[i].failureReason =
              `pass2_target_not_unique (counts: ${notUnique.map((tc) => `${tc.count}`).join(", ")})`;
          } else {
            debugUnmatched[i].failureReason = "pass2_target_count_zero";
          }
        } else {
          debugUnmatched[i].failureReason = "pass2_target_not_found";
        }
      }
    }
  }

  console.log(
    `Pass 2: ${stats.linkedFallback} linked via fallback (unique terms)`
  );
  console.log(`Pass 2: ${stats.noMatchFound} still unmatched after pass 2`);

  // ---------- PASS 3: Section-based matching for terms without pairedTerm ----------
  // These are terms where the XML didn't include a <DefinedTermFr> or <DefinedTermEn> tag
  // But we can still link them if:
  // 1. Same document (act_id or regulation_id)
  // 2. Same section_label
  // 3. Exactly one EN term and one FR term in that section (both without pairedTerm)
  console.log(
    "\n--- Pass 3: Section-based matching (terms without pairedTerm) ---"
  );

  // Fetch terms that have NO pairedTerm and no pairedTermId
  const termsWithoutPairedText = await db
    .select({
      id: definedTerms.id,
      language: definedTerms.language,
      term: definedTerms.term,
      termNormalized: definedTerms.termNormalized,
      actId: definedTerms.actId,
      regulationId: definedTerms.regulationId,
      sectionLabel: definedTerms.sectionLabel,
    })
    .from(definedTerms)
    .where(
      and(isNull(definedTerms.pairedTerm), isNull(definedTerms.pairedTermId))
    );

  console.log(
    `Found ${termsWithoutPairedText.length} terms without pairedTerm to analyze`
  );

  if (termsWithoutPairedText.length > 0) {
    // Group terms by document + section + language
    // Key: `${docId}:${sectionLabel}` → { en: term[], fr: term[] }
    const termsBySection = new Map<
      string,
      {
        en: Array<{ id: string; term: string; termNormalized: string | null }>;
        fr: Array<{ id: string; term: string; termNormalized: string | null }>;
      }
    >();

    for (const t of termsWithoutPairedText) {
      const docId = t.actId || t.regulationId || "";
      const sectionKey = `${docId}:${t.sectionLabel || ""}`;

      if (!termsBySection.has(sectionKey)) {
        termsBySection.set(sectionKey, { en: [], fr: [] });
      }

      const group = termsBySection.get(sectionKey);
      if (group) {
        if (t.language === "en") {
          group.en.push({
            id: t.id,
            term: t.term,
            termNormalized: t.termNormalized,
          });
        } else if (t.language === "fr") {
          group.fr.push({
            id: t.id,
            term: t.term,
            termNormalized: t.termNormalized,
          });
        }
      }
    }

    // Find sections with exactly 1 EN and 1 FR term - these can be safely linked
    let sectionsWithOneToOne = 0;
    let sectionsWithMultiple = 0;

    for (const [sectionKey, group] of termsBySection.entries()) {
      if (group.en.length === 1 && group.fr.length === 1) {
        // Safe to link: exactly one term in each language
        const enTerm = group.en[0];
        const frTerm = group.fr[0];

        // Link EN → FR
        updates.push({ id: enTerm.id, pairedTermId: frTerm.id });
        // Link FR → EN
        updates.push({ id: frTerm.id, pairedTermId: enTerm.id });
        stats.linkedSectionBased += 2;
        sectionsWithOneToOne++;

        if (options.debug) {
          console.log(
            `  [SECTION MATCH] ${sectionKey}: "${enTerm.term}" ↔ "${frTerm.term}"`
          );
        }
      } else if (group.en.length > 0 && group.fr.length > 0) {
        // Multiple terms in section - can't safely match without more info
        sectionsWithMultiple++;
        stats.noPairedTermNoMatch += group.en.length + group.fr.length;

        if (options.debug && sectionsWithMultiple <= 5) {
          console.log(
            `  [SKIP] ${sectionKey}: ${group.en.length} EN, ${group.fr.length} FR terms`
          );
          console.log(`    EN: ${group.en.map((t) => t.term).join(", ")}`);
          console.log(`    FR: ${group.fr.map((t) => t.term).join(", ")}`);
        }
      } else {
        // Only one language present in this section
        stats.noPairedTermNoMatch += group.en.length + group.fr.length;
      }
    }

    console.log(
      `Pass 3: ${stats.linkedSectionBased} terms linked via section matching (${sectionsWithOneToOne} sections)`
    );
    console.log(
      `Pass 3: ${sectionsWithMultiple} sections skipped (multiple terms per language)`
    );
    console.log(
      `Pass 3: ${stats.noPairedTermNoMatch} terms could not be matched`
    );
  }

  stats.pairsLinked =
    stats.linkedExact + stats.linkedFallback + stats.linkedSectionBased;

  console.log(
    `\nTotal: ${updates.length} pairs to link, ${stats.noMatchFound + stats.noPairedTermNoMatch} with no match`
  );

  // Debug output for unmatched terms
  if (options.debug && debugUnmatched.length > 0) {
    console.log("\n========================================");
    console.log("DEBUG: UNMATCHED TERMS ANALYSIS");
    console.log("========================================\n");

    // Group by failure reason
    const byReason = new Map<string, DebugUnmatchedTerm[]>();
    for (const term of debugUnmatched) {
      const reason = term.failureReason;
      if (!byReason.has(reason)) {
        byReason.set(reason, []);
      }
      byReason.get(reason)?.push(term);
    }

    console.log("--- Failure Reason Summary ---");
    for (const [reason, terms] of byReason.entries()) {
      console.log(`  ${reason}: ${terms.length} terms`);
    }

    console.log("\n--- Detailed Unmatched Terms ---\n");
    for (const term of debugUnmatched) {
      console.log(`Term ID: ${term.id}`);
      console.log(`  Language: ${term.language} -> ${term.targetLang}`);
      console.log(`  Term: "${term.term}"`);
      console.log(`  Term Normalized: "${term.termNormalized}"`);
      console.log(`  Paired Term: "${term.pairedTerm}"`);
      console.log(`  Paired Term Normalized: "${term.pairedTermNormalized}"`);
      console.log(`  Doc ID (source): ${term.docId}`);
      console.log(`  Doc ID (target): ${term.targetDocId}`);
      console.log(`  Section Label: ${term.sectionLabel || "(null)"}`);
      console.log(`  Failure Reason: ${term.failureReason}`);
      if (term.sourceCount !== undefined) {
        console.log(`  Source Count: ${term.sourceCount}`);
      }
      console.log("  Exact Keys Attempted:");
      for (const key of term.exactKeysAttempted) {
        console.log(`    - ${key}`);
      }
      if (term.docKeysAttempted.length > 0) {
        console.log("  Doc Keys Attempted:");
        for (const key of term.docKeysAttempted) {
          const tc = term.targetCounts?.find((t) => t.key === key);
          console.log(`    - ${key} (count: ${tc?.count ?? "?"})`);
        }
      }
      console.log("");
    }

    // Search for similar terms in lookup to help diagnose
    console.log("--- Looking for Similar Terms in Target Language ---\n");
    for (const term of debugUnmatched.slice(0, 10)) {
      // Only check first 10 to avoid too much output
      const normalizedPaired = term.pairedTermNormalized;
      const targetDocId = term.targetDocId;
      const targetLang = term.targetLang;

      // Find any keys that match the pattern but might have different section
      const similarKeys: string[] = [];
      for (const key of exactLookup.keys()) {
        if (
          key.startsWith(`${targetLang}:${targetDocId}:`) &&
          key.includes(normalizedPaired)
        ) {
          similarKeys.push(key);
        }
      }

      if (similarKeys.length > 0) {
        console.log(`Term: "${term.term}" (looking for "${term.pairedTerm}")`);
        console.log("  Found similar exact keys:");
        for (const key of similarKeys.slice(0, 5)) {
          console.log(`    - ${key}`);
        }
        console.log("");
      }
    }

    // Typo detection: find terms in target document that are similar to paired term
    console.log("--- Potential Typos Detection (Levenshtein Distance) ---\n");
    for (const term of debugUnmatched) {
      const targetDocId = term.targetDocId;
      const targetLang = term.targetLang;
      const docKey = `${targetLang}:${targetDocId}`;
      const targetTerms = termsByDoc.get(docKey) || [];

      if (targetTerms.length === 0) {
        continue;
      }

      // Check each term in target document for similarity
      for (const targetTerm of targetTerms) {
        if (
          isPotentialTypo(term.pairedTermNormalized, targetTerm.termNormalized)
        ) {
          const distance = levenshteinDistance(
            term.pairedTermNormalized.toLowerCase(),
            targetTerm.termNormalized.toLowerCase()
          );
          potentialTypos.push({
            sourceTermId: term.id,
            sourceLanguage: term.language,
            sourceTerm: term.term,
            pairedTerm: term.pairedTerm,
            pairedTermNormalized: term.pairedTermNormalized,
            similarTerm: targetTerm.term,
            similarTermNormalized: targetTerm.termNormalized,
            editDistance: distance,
            docId: term.docId,
            sectionLabel: term.sectionLabel,
          });
        }
      }
    }

    // Output potential typos for manual review
    if (potentialTypos.length > 0) {
      console.log("========================================");
      console.log("POTENTIAL TYPOS FOR MANUAL REVIEW");
      console.log("========================================\n");
      console.log(
        `Found ${potentialTypos.length} potential typos in source XML data.\n`
      );
      console.log(
        "These may indicate spelling errors in the original legislation XML"
      );
      console.log("that prevent correct EN↔FR term linking.\n");

      // Group by document for easier review
      const byDoc = new Map<string, PotentialTypo[]>();
      for (const typo of potentialTypos) {
        if (!byDoc.has(typo.docId)) {
          byDoc.set(typo.docId, []);
        }
        byDoc.get(typo.docId)?.push(typo);
      }

      for (const [docId, typos] of byDoc.entries()) {
        console.log(`Document: ${docId}`);
        console.log("-".repeat(40));
        for (const typo of typos) {
          console.log(
            `  Source (${typo.sourceLanguage}): "${typo.sourceTerm}"`
          );
          console.log(`    Paired term expected: "${typo.pairedTerm}"`);
          console.log(`    Similar term found:   "${typo.similarTerm}"`);
          console.log(`    Edit distance: ${typo.editDistance}`);
          console.log(`    Section: ${typo.sectionLabel || "(root)"}`);
          console.log("");
        }
      }

      console.log(
        "\nTo fix these, the source XML files would need to be corrected."
      );
      console.log(
        "This is for informational purposes to identify data quality issues.\n"
      );
    } else {
      console.log("No potential typos detected.\n");
    }

    // Output language-only terms
    if (languageOnlyTerms.length > 0) {
      console.log("========================================");
      console.log("LANGUAGE-ONLY TERMS (No Translation)");
      console.log("========================================\n");
      console.log(
        `Found ${languageOnlyTerms.length} terms marked as single-language only.\n`
      );
      console.log(
        "These terms intentionally have no translation in the other language.\n"
      );

      // Group by document
      const byDoc = new Map<string, LanguageOnlyTerm[]>();
      for (const lot of languageOnlyTerms) {
        if (!byDoc.has(lot.docId)) {
          byDoc.set(lot.docId, []);
        }
        byDoc.get(lot.docId)?.push(lot);
      }

      for (const [docId, terms] of byDoc.entries()) {
        console.log(`Document: ${docId}`);
        console.log("-".repeat(40));
        for (const lot of terms) {
          console.log(`  Term (${lot.language}): "${lot.term}"`);
          console.log(`    Marker: "${lot.pairedTerm}"`);
          console.log("");
        }
      }
    }
  }

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
  if (debug) {
    console.log("[DEBUG MODE - Detailed output enabled]\n");
  }

  // Show typo corrections loaded
  const pairedCorrectionCount = getTotalCorrectionCount();
  const docsWithPairedCorrections = getDocumentsWithCorrections();
  const termCorrectionCount = getTotalTermCorrectionCount();
  const docsWithTermCorrections = getDocumentsWithTermCorrections();
  console.log(
    `Loaded ${pairedCorrectionCount} paired-term corrections for ${docsWithPairedCorrections.length} documents`
  );
  console.log(
    `Loaded ${termCorrectionCount} actual-term corrections for ${docsWithTermCorrections.length} documents\n`
  );

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
    const stats = await linkDefinedTermPairs(db, { dryRun, limit, debug });

    // Summary
    console.log("\n=== Summary ===");
    console.log(`Terms with pairedTerm processed: ${stats.totalTerms}`);
    console.log(`Terms linked: ${stats.pairsLinked}`);
    console.log(`  - Pass 1 (exact section match): ${stats.linkedExact}`);
    console.log(`  - Pass 2 (fallback, unique terms): ${stats.linkedFallback}`);
    console.log(
      `  - Pass 3 (section-based, no pairedTerm): ${stats.linkedSectionBased}`
    );
    console.log(`Typos corrected: ${stats.typosCorrected}`);
    console.log(`Language-only (skipped): ${stats.languageOnlySkipped}`);
    console.log(`No match found (with pairedTerm): ${stats.noMatchFound}`);
    console.log(
      `No match found (without pairedTerm): ${stats.noPairedTermNoMatch}`
    );
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

// Only run main() when executed directly, not when imported as a module
const isDirectExecution =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("link-defined-terms.ts");

if (isDirectExecution) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export type { LinkStats };
