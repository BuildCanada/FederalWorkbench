/**
 * Normalize a term for matching, using enhanced logic for cross-lingual pairing.
 *
 * Steps:
 * 1. Expand ligatures to ASCII equivalents (œ→oe, æ→ae) - must be before NFD
 * 2. NFD normalize to decompose accented characters (é → e + combining accent)
 * 3. Remove combining diacritical marks (the accent parts)
 * 4. Lowercase
 * 5. Replace dashes with spaces for consistent word separation
 * 6. Remove remaining non-alphanumeric characters (except spaces)
 * 7. Collapse multiple spaces to single space
 * 8. Trim
 *
 * This preserves base letters while removing accents:
 * - "café" → "cafe" (é→e, base letter preserved)
 * - "bœuf" → "boeuf" (œ expanded, then preserved)
 * - "définition" → "definition"
 *
 * Examples:
 * - "Canada–Colombia" → "canada colombia" (en-dash becomes space)
 * - "œuf" → "oeuf" (ligature expanded)
 * - "produit d'œufs" → "produit doeufs"
 * - "boîte à œufs" → "boite a oeufs"
 *
 * Used for:
 * - Creating term_normalized in the parser
 * - Matching pairedTerm text to find paired term IDs
 */
export function normalizeTermForMatching(term: string): string {
  return (
    term
      // Expand ligatures first (NFD doesn't decompose these)
      .replace(/œ/gi, "oe")
      .replace(/æ/gi, "ae")
      // NFD decompose: é → e + combining accent mark
      .normalize("NFD")
      // Remove combining diacritical marks (U+0300 to U+036F)
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      // Replace dashes with spaces
      .replace(/[\u2013\u2014\-—–]/g, " ")
      // Remove remaining non-alphanumeric (punctuation, etc.)
      .replace(/[^a-z0-9\s]/g, "")
      // Collapse whitespace
      .replace(/\s+/g, " ")
      .trim()
  );
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
