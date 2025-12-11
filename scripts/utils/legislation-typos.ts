/**
 * Typo corrections for legislation defined term linking.
 *
 * The Justice Canada XML source files contain typos and text mismatches
 * that prevent proper bilingual term linking (EN↔FR). This module defines
 * corrections applied during the linking phase.
 *
 * Corrections are scoped per document to prevent unintended side effects.
 * The paired term is corrected before normalization and lookup.
 *
 * Usage:
 *   import { correctPairedTermForLinking } from "@/scripts/utils/legislation-typos";
 *   const corrected = correctPairedTermForLinking(documentId, pairedTerm);
 *   const normalized = normalizeTermForMatching(corrected);
 */

/**
 * A single typo correction entry.
 */
export type TypoCorrection = {
  /** The typo as it appears in the source text */
  typo: string;
  /** The correct spelling/text for matching */
  correction: string;
};

/**
 * Typo corrections for ACTUAL TERMS (not paired terms).
 *
 * These fix typos in the term field itself, which affects how terms
 * are indexed in the lookup map during linking.
 *
 * Document IDs use the format from the source document where the typo appears.
 *
 * Example: If EN document C.R.C._c. 870 has term "mutiple-serving prepackaged product"
 * (typo: missing 'l' in "mutiple"), add correction here so it can be found
 * when FR looks for "multiple-serving prepackaged product".
 */
export const TERM_TYPOS: Record<string, TypoCorrection[]> = {
  // "mutiple-serving prepackaged product" → "multiple-serving prepackaged product"
  // Source: EN document C.R.C._c. 870, actual term has typo "mutiple"
  "C.R.C._c. 870": [{ typo: "mutiple", correction: "multiple" }],
};

/**
 * Typo corrections organized by document ID.
 *
 * Document IDs use the format from the source document where the term appears:
 * - Acts: "A-1", "C-46", "E-15"
 * - Regulations EN: "SOR-2020-258", "C.R.C._c. 870"
 * - Regulations FR: "DORS-2020-258", "C.R.C._ch. 870"
 *
 * The paired term points TO the other language, so corrections fix what
 * the source document says about the target language term.
 *
 * Example: If EN document SOR-2020-258 has pairedTerm "smoke emission"
 * but FR has "smoke emissions", add correction to "SOR-2020-258".
 */
export const LEGISLATION_TYPOS: Record<string, TypoCorrection[]> = {
  // ==========================================================================
  // TYPOS: Spelling errors in source XML
  // ==========================================================================

  // "accord de reconnaisance mutuelle" → "accord de reconnaissance mutuelle"
  // Source: EN document C.R.C._c. 870, pairedTerm pointing to FR
  "C.R.C._c. 870": [{ typo: "reconnaisance", correction: "reconnaissance" }],

  // "amphibious vehicule" → "amphibious vehicle"
  // Source: FR document DORS-2011-10, pairedTerm pointing to EN
  "DORS-2011-10": [{ typo: "vehicule", correction: "vehicle" }],

  // "qualified medical practioner" → "qualified medical practitioner"
  // Source: FR document DORS-2014-304, pairedTerm pointing to EN
  "DORS-2014-304": [{ typo: "practioner", correction: "practitioner" }],

  // "Chartre" → "Charte"
  // Source: EN document SI-2004-134, pairedTerm pointing to FR
  "SI-2004-134": [{ typo: "Chartre", correction: "Charte" }],

  // "longeur" → "longueur"
  // "voyage en eaux internes" → "voyages en eaux internes" (singular→plural)
  // Source: EN document SOR-2023-257, pairedTerm pointing to FR
  "SOR-2023-257": [
    { typo: "longeur", correction: "longueur" },
    { typo: "voyage en eaux internes", correction: "voyages en eaux internes" },
  ],

  // "chaudièreà" → "chaudière à" (missing space)
  // Source: EN document SOR-86-304, pairedTerm pointing to FR
  "SOR-86-304": [{ typo: "chaudièreà", correction: "chaudière à" }],

  // "Chief of Justice" → "Chief Justice"
  // Source: FR document TR-2009-3, pairedTerm pointing to EN
  "TR-2009-3": [{ typo: "Chief of Justice", correction: "Chief Justice" }],

  // "matérial de ventilation" → "matériel de ventilation"
  // Source: EN document SOR-2010-120, pairedTerm pointing to FR
  "SOR-2010-120": [{ typo: "matérial", correction: "matériel" }],

  // "équipment de conservation" → "équipement de conservation"
  // Source: EN document SOR-2018-66, pairedTerm pointing to FR
  "SOR-2018-66": [{ typo: "équipment", correction: "équipement" }],

  // "activités professionelles" → "activités professionnelles"
  // Source: EN document SOR-2018-144, pairedTerm pointing to FR
  "SOR-2018-144": [{ typo: "professionelles", correction: "professionnelles" }],

  // ==========================================================================
  // TEXT MISMATCHES: Different wording between languages (not spelling errors)
  // ==========================================================================

  // "projection de flamme" → "projection de la flamme" (missing "la")
  // Source: EN documents, pairedTerm pointing to FR
  "C.R.C._c. 869": [
    { typo: "projection de flamme", correction: "projection de la flamme" },
  ],
  // Note: C.R.C._c. 870 already has "reconnaisance" correction, add this too
  // Will be handled by multiple corrections in same document

  // "Canadian Biosafety Standard and Guidelines" → "Canadian Biosafety Standards and Guidelines"
  // Source: FR document DORS-2005-248, pairedTerm pointing to EN (singular→plural)
  "DORS-2005-248": [
    {
      typo: "Canadian Biosafety Standard and Guidelines",
      correction: "Canadian Biosafety Standards and Guidelines",
    },
  ],

  // "excluded compound" → "excluded compounds" (singular→plural)
  // Source: FR document DORS-2009-264, pairedTerm pointing to EN
  "DORS-2009-264": [
    { typo: "excluded compound", correction: "excluded compounds" },
  ],

  // "smoke emission" → "smoke emissions" (singular→plural)
  // Source: FR document DORS-2020-258, pairedTerm pointing to EN
  "DORS-2020-258": [{ typo: "smoke emission", correction: "smoke emissions" }],

  // "containment" → "containment system" (incomplete term)
  // Source: FR document DORS-2010-120, pairedTerm pointing to EN
  "DORS-2010-120": [{ typo: "containment", correction: "containment system" }],

  // "confinement" → "système de confinement" (incomplete term)
  // Source: EN document SOR-2011-87, pairedTerm pointing to FR
  "SOR-2011-87": [
    { typo: "confinement", correction: "système de confinement" },
  ],

  // "voyage en eaux internes" → "voyages en eaux internes" (singular→plural)
  // Source: EN document SOR-2023-257, pairedTerm pointing to FR
  // Note: SOR-2023-257 already has "longeur" correction

  // "méthode A de l’EC" → "méthode A d’EC" (different preposition)
  // Note: Uses Unicode right single quotation mark U+2019 (')
  // Source: EN document SOR-2016-151, pairedTerm pointing to FR
  "SOR-2016-151": [
    { typo: "méthode A de l’EC", correction: "méthode A d’EC" },
    { typo: "méthode B de l’EC", correction: "méthode B d’EC" },
    { typo: "méthode D de l’EC", correction: "méthode D d’EC" },
  ],

  // "COV à faible pression de vapeur" → "COV à pression de vapeur faible" (word order)
  // Source: EN document SOR-2021-268, pairedTerm pointing to FR
  "SOR-2021-268": [
    {
      typo: "COV à faible pression de vapeur",
      correction: "COV à pression de vapeur faible",
    },
  ],

  // "montant fédéral admissible" → "montant admissible fédéral" (word order)
  // Source: EN document SOR-91-37, pairedTerm pointing to FR
  "SOR-91-37": [
    {
      typo: "montant fédéral admissible",
      correction: "montant admissible fédéral",
    },
  ],

  // "en benzène" → "de benzène" (different preposition)
  // Source: EN document SOR-2025-88, pairedTerm pointing to FR
  "SOR-2025-88": [
    {
      typo: "rampe de chargement de liquide à haute concentration en benzène",
      correction:
        "rampe de chargement de liquide à haute concentration de benzène",
    },
    {
      typo: "réservoir de liquide à haute concentration en benzène",
      correction: "réservoir de liquide à haute concentration de benzène",
    },
  ],
};

// Add "projection de flamme" correction to C.R.C._c. 870 (already has reconnaisance)
LEGISLATION_TYPOS["C.R.C._c. 870"].push({
  typo: "projection de flamme",
  correction: "projection de la flamme",
});

/**
 * Escape special regex characters in a string.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Apply typo corrections to a paired term before matching.
 *
 * @param documentId - The document ID where this term appears (source document)
 * @param pairedTerm - The pairedTerm value to potentially correct
 * @returns Corrected term (or original if no correction applies)
 */
export function correctPairedTermForLinking(
  documentId: string,
  pairedTerm: string
): string {
  const corrections = LEGISLATION_TYPOS[documentId];
  if (!corrections) {
    return pairedTerm;
  }

  let result = pairedTerm;
  for (const { typo, correction } of corrections) {
    // Case-insensitive match
    const regex = new RegExp(escapeRegExp(typo), "gi");
    result = result.replace(regex, (match) => {
      // Preserve case pattern of original
      if (match === match.toUpperCase()) {
        return correction.toUpperCase();
      }
      if (match[0] === match[0].toUpperCase()) {
        return correction[0].toUpperCase() + correction.slice(1);
      }
      return correction;
    });
  }

  return result;
}

/**
 * Apply typo corrections to an actual term for indexing.
 *
 * This is used when building lookup maps to ensure terms with typos
 * can still be found when the other language has the correct spelling.
 *
 * @param documentId - The document ID where this term appears
 * @param term - The actual term value to potentially correct
 * @returns Corrected term (or original if no correction applies)
 */
export function correctActualTermForLinking(
  documentId: string,
  term: string
): string {
  const corrections = TERM_TYPOS[documentId];
  if (!corrections) {
    return term;
  }

  let result = term;
  for (const { typo, correction } of corrections) {
    // Case-insensitive match
    const regex = new RegExp(escapeRegExp(typo), "gi");
    result = result.replace(regex, (match) => {
      // Preserve case pattern of original
      if (match === match.toUpperCase()) {
        return correction.toUpperCase();
      }
      if (match[0] === match[0].toUpperCase()) {
        return correction[0].toUpperCase() + correction.slice(1);
      }
      return correction;
    });
  }

  return result;
}

/**
 * Get the list of document IDs that have typo corrections.
 * Useful for logging/debugging.
 */
export function getDocumentsWithCorrections(): string[] {
  return Object.keys(LEGISLATION_TYPOS);
}

/**
 * Get the list of document IDs that have actual term corrections.
 */
export function getDocumentsWithTermCorrections(): string[] {
  return Object.keys(TERM_TYPOS);
}

/**
 * Get the count of total paired term corrections defined.
 */
export function getTotalCorrectionCount(): number {
  return Object.values(LEGISLATION_TYPOS).reduce(
    (sum, corrections) => sum + corrections.length,
    0
  );
}

/**
 * Get the count of total actual term corrections defined.
 */
export function getTotalTermCorrectionCount(): number {
  return Object.values(TERM_TYPOS).reduce(
    (sum, corrections) => sum + corrections.length,
    0
  );
}

/**
 * Helper to validate a set of corrections.
 */
function validateCorrectionSet(
  corrections: Record<string, TypoCorrection[]>,
  prefix: string
): string[] {
  const warnings: string[] = [];

  for (const [docId, entries] of Object.entries(corrections)) {
    for (const { typo, correction } of entries) {
      // Check for empty values
      if (!typo.trim()) {
        warnings.push(`${prefix}${docId}: Empty typo value`);
      }
      if (!correction.trim()) {
        warnings.push(`${prefix}${docId}: Empty correction value`);
      }
      // Check for identical values
      if (typo === correction) {
        warnings.push(
          `${prefix}${docId}: Typo and correction are identical: "${typo}"`
        );
      }
      // Check for very short typos (might cause false positives)
      if (typo.length < 3) {
        warnings.push(
          `${prefix}${docId}: Very short typo "${typo}" may cause false positives`
        );
      }
    }
  }

  return warnings;
}

/**
 * Validate that corrections don't have obvious issues.
 * Returns array of warnings (empty if all OK).
 */
export function validateCorrections(): string[] {
  const pairedWarnings = validateCorrectionSet(LEGISLATION_TYPOS, "");
  const termWarnings = validateCorrectionSet(TERM_TYPOS, "[TERM] ");
  return [...pairedWarnings, ...termWarnings];
}
