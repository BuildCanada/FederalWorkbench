/**
 * Normalize a term for matching, using enhanced logic for cross-lingual pairing.
 *
 * Steps:
 * 1. Replace dashes (en-dash, em-dash, hyphen) with spaces for consistent word separation
 * 2. Lowercase
 * 3. Remove non-word characters (except spaces)
 * 4. Collapse multiple spaces to single space
 * 5. Trim
 *
 * Note: JavaScript's \w only matches ASCII word characters [a-zA-Z0-9_],
 * so accented characters like é, à, ç are stripped entirely.
 * This is intentional for cross-lingual matching (EN "barrier" matches FR "barrière").
 *
 * Examples:
 * - "Canada–Colombia" → "canada colombia" (en-dash becomes space)
 * - "Canada Colombia" → "canada colombia" (already has space)
 * - "in vitro embryo" → "in vitro embryo"
 * - "l'accès" → "laccs"
 *
 * Used for:
 * - Creating term_normalized in the parser
 * - Matching pairedTerm text to find paired term IDs
 */
export function normalizeTermForMatching(term: string): string {
  return term
    .replace(/[\u2013\u2014\-—–]/g, " ") // Replace dashes with spaces
    .toLowerCase()
    .replace(/[^\w\s]/g, "") // Remove non-word chars
    .replace(/\s+/g, " ") // Collapse whitespace
    .trim();
}

/**
 * Translate a regulation ID from one language to another.
 *
 * Regulation IDs differ by language in the Justice Canada legislation database:
 * - C.R.C._c. X (EN) ↔ C.R.C._ch. X (FR) - Consolidated Regulations of Canada
 * - SOR-XXXX-X (EN) ↔ DORS-XXXX-X (FR) - Statutory Orders and Regulations
 * - SI-XXXX-X (EN) ↔ TR-XXXX-X (FR) - Statutory Instruments
 * - YYYY_c. X_s. Y (EN) ↔ YYYY_ch. X_art. Y (FR) - Annual Statutes
 *
 * This translation is needed when linking bilingual defined term pairs,
 * since the same regulation has different IDs in each language.
 *
 * @param regulationId - The regulation ID to translate
 * @param fromLang - Source language ("en" or "fr")
 * @param toLang - Target language ("en" or "fr")
 * @returns Translated regulation ID, or original if format is unknown
 */
export function translateRegulationId(
  regulationId: string,
  fromLang: "en" | "fr",
  toLang: "en" | "fr"
): string {
  if (fromLang === toLang) {
    return regulationId;
  }

  if (fromLang === "en" && toLang === "fr") {
    // EN → FR
    if (regulationId.startsWith("C.R.C._c. ")) {
      return regulationId.replace("C.R.C._c. ", "C.R.C._ch. ");
    }
    if (regulationId.startsWith("SOR-")) {
      return regulationId.replace("SOR-", "DORS-");
    }
    if (regulationId.startsWith("SI-")) {
      return regulationId.replace("SI-", "TR-");
    }
    // Annual statutes: 2018_c. 12_s. 187 → 2018_ch. 12_art. 187
    if (regulationId.includes("_c. ") && regulationId.includes("_s. ")) {
      return regulationId.replace("_c. ", "_ch. ").replace("_s. ", "_art. ");
    }
  } else {
    // FR → EN
    if (regulationId.startsWith("C.R.C._ch. ")) {
      return regulationId.replace("C.R.C._ch. ", "C.R.C._c. ");
    }
    if (regulationId.startsWith("DORS-")) {
      return regulationId.replace("DORS-", "SOR-");
    }
    if (regulationId.startsWith("TR-")) {
      return regulationId.replace("TR-", "SI-");
    }
    // Annual statutes: 2018_ch. 12_art. 187 → 2018_c. 12_s. 187
    if (regulationId.includes("_ch. ") && regulationId.includes("_art. ")) {
      return regulationId.replace("_ch. ", "_c. ").replace("_art. ", "_s. ");
    }
  }

  // Unknown format - return as-is (won't match, but that's expected)
  return regulationId;
}
