export const JUSTICE_CANADA_BASE_URL = "https://laws-lois.justice.gc.ca";

// Pattern to parse amendment citations like "2023, c. 8, s. 46"
const AMENDMENT_CITATION_PATTERN =
  /(\d{4}),\s*c\.\s*(\d+)(?:,\s*s\.\s*(\d+))?/i;

export const JUSTICE_CANADA_PATHS = {
  en: {
    acts: "eng/acts",
    regulations: "eng/regulations",
    annualStatutes: "eng/AnnualStatutes",
  },
  fr: {
    acts: "fra/lois",
    regulations: "fra/reglements",
    annualStatutes: "fra/LoisAnnuelles",
  },
} as const;

/**
 * Build a canonical URL to Justice Canada for an act or regulation.
 */
export function buildJusticeCanadaUrl(
  id: string,
  type: "act" | "regulation",
  language: "en" | "fr"
): string {
  const path =
    type === "act"
      ? JUSTICE_CANADA_PATHS[language].acts
      : JUSTICE_CANADA_PATHS[language].regulations;
  return `${JUSTICE_CANADA_BASE_URL}/${path}/${id.toLowerCase()}/`;
}

/**
 * Build URL to an annual statute (amending act) on Justice Canada.
 * Citation format: "2023, c. 8, s. 46" → year=2023, chapter=8
 */
export function buildAnnualStatuteUrl(
  year: number,
  chapter: number,
  language: "en" | "fr"
): string {
  const path = JUSTICE_CANADA_PATHS[language].annualStatutes;
  return `${JUSTICE_CANADA_BASE_URL}/${path}/${year}_${chapter}/`;
}

/**
 * Build URL to point-in-time index for an act on Justice Canada.
 */
export function buildPointInTimeIndexUrl(
  actId: string,
  language: "en" | "fr"
): string {
  const path = JUSTICE_CANADA_PATHS[language].acts;
  return `${JUSTICE_CANADA_BASE_URL}/${path}/${actId}/PITIndex.html`;
}

/**
 * Parse an amendment citation to extract year and chapter.
 * Handles formats like: "2023, c. 8, s. 46" or "2019, c. 10, s. 42"
 * Returns null if parsing fails.
 */
export function parseAmendmentCitation(
  citation: string
): { year: number; chapter: number; section?: number } | null {
  const match = citation.match(AMENDMENT_CITATION_PATTERN);
  if (!match) {
    return null;
  }
  return {
    year: Number.parseInt(match[1], 10),
    chapter: Number.parseInt(match[2], 10),
    section: match[3] ? Number.parseInt(match[3], 10) : undefined,
  };
}
