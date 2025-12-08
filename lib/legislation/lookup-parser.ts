/**
 * Parser for Justice Canada lookup.xml metadata file
 *
 * The lookup.xml contains metadata about all legislation including:
 * - Reversed short titles (for alphabetical indexes)
 * - Consolidation flags
 * - Official numbers/citations
 * - Act-to-regulation relationships
 */

import { readFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import type { Language } from "./types";

/**
 * Lookup entry for a statute (act)
 */
export type StatuteLookupEntry = {
  id: string;
  chapterNumber: string; // e.g., "A-1" - maps to actId
  officialNumber: string; // e.g., "A-1" or "2019, c. 10"
  language: Language;
  shortTitle: string;
  reversedShortTitle: string;
  lastConsolidationDate?: string; // YYYYMMDD format
  consolidateFlag: boolean;
  relatedRegulationIds: string[]; // IDs from Relationships
};

/**
 * Lookup entry for a regulation
 */
export type RegulationLookupEntry = {
  id: string;
  otherLanguageId?: string; // olid - link to other language version
  alphaNumber: string; // e.g., "SOR/2007-151" or "DORS/2007-151"
  language: Language;
  shortTitle: string;
  reversedShortTitle: string;
  lastConsolidationDate?: string; // YYYYMMDD format
  consolidateFlag: boolean;
};

/**
 * Complete lookup data parsed from lookup.xml
 */
export type LookupData = {
  statutes: Map<string, StatuteLookupEntry>; // keyed by "chapterNumber|language"
  regulations: Map<string, RegulationLookupEntry>; // keyed by "alphaNumber|language"
  regulationIdToAlphaNumber: Map<string, string>; // maps internal IDs to alphaNumbers
  actRelationships: Map<string, string[]>; // maps statute IDs to regulation IDs
};

// Configure XML parser with same settings as main parser
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  preserveOrder: false,
  trimValues: true,
  parseAttributeValue: false,
  parseTagValue: false,
});

/**
 * Normalize regulation alpha number to a consistent format
 * e.g., "SOR/2007-151" -> "SOR-2007-151"
 */
export function normalizeAlphaNumber(alphaNumber: string): string {
  // Replace / with -
  const normalized = alphaNumber.replace(/\//g, "-");
  // Handle C.R.C., c. format -> C.R.C., c.
  // Keep it as-is for CRC regulations since they have unique format
  return normalized;
}

/**
 * Get lookup key for a statute
 */
function getStatuteKey(chapterNumber: string, language: Language): string {
  return `${chapterNumber}|${language}`;
}

/**
 * Get lookup key for a regulation
 */
function getRegulationKey(alphaNumber: string, language: Language): string {
  const normalized = normalizeAlphaNumber(alphaNumber);
  return `${normalized}|${language}`;
}

/**
 * Parse the lookup.xml file and return structured lookup data
 */
export function parseLookupXml(filePath: string): LookupData {
  const xml = readFileSync(filePath, "utf-8");
  const parsed = parser.parse(xml);

  const statutes = new Map<string, StatuteLookupEntry>();
  const regulations = new Map<string, RegulationLookupEntry>();
  const regulationIdToAlphaNumber = new Map<string, string>();
  const actRelationships = new Map<string, string[]>();

  // Parse statutes
  const statutesArray = ensureArray(parsed?.Database?.Statutes?.Statute);
  for (const statute of statutesArray) {
    const id = statute["@_id"];
    const chapterNumber = getTextContent(statute.ChapterNumber);
    const languageRaw = getTextContent(statute.Language);

    if (!id || !chapterNumber || !languageRaw) {
      continue;
    }

    const language = languageRaw.toLowerCase() === "fr" ? "fr" : "en";
    const officialNumber =
      getTextContent(statute.OfficialNumber) || chapterNumber;
    const shortTitle = getTextContent(statute.ShortTitle) || "";
    const reversedShortTitle =
      getTextContent(statute.ReversedShortTitle) || shortTitle;
    const lastConsolidationDate = getTextContent(statute.LastConsolidationDate);
    const consolidateFlagRaw = getTextContent(statute.ConsolidateFlag);
    const consolidateFlag =
      consolidateFlagRaw?.toLowerCase() === "true" ||
      consolidateFlagRaw === "1";

    // Parse relationships (regulation IDs linked to this act)
    const relatedRegulationIds: string[] = [];
    const relationships = ensureArray(statute.Relationships?.Relationship);
    for (const rel of relationships) {
      const rid = rel["@_rid"];
      if (rid) {
        relatedRegulationIds.push(rid);
      }
    }

    // Store relationships for later lookup
    if (relatedRegulationIds.length > 0) {
      actRelationships.set(id, relatedRegulationIds);
    }

    const entry: StatuteLookupEntry = {
      id,
      chapterNumber,
      officialNumber,
      language,
      shortTitle,
      reversedShortTitle,
      lastConsolidationDate,
      consolidateFlag,
      relatedRegulationIds,
    };

    statutes.set(getStatuteKey(chapterNumber, language), entry);
  }

  // Parse regulations
  const regulationsArray = ensureArray(
    parsed?.Database?.Regulations?.Regulation
  );
  for (const regulation of regulationsArray) {
    const id = regulation["@_id"];
    const otherLanguageId = regulation["@_olid"];
    const alphaNumber = getTextContent(regulation.AlphaNumber);
    const languageRaw = getTextContent(regulation.Language);

    if (!id || !alphaNumber || !languageRaw) {
      continue;
    }

    const language = languageRaw.toLowerCase() === "fr" ? "fr" : "en";
    const shortTitle = getTextContent(regulation.ShortTitle) || "";
    const reversedShortTitle =
      getTextContent(regulation.ReversedShortTitle) || shortTitle;
    const lastConsolidationDate = getTextContent(
      regulation.LastConsolidationDate
    );
    const consolidateFlagRaw = getTextContent(regulation.ConsolidateFlag);
    const consolidateFlag =
      consolidateFlagRaw?.toLowerCase() === "true" ||
      consolidateFlagRaw === "1";

    // Map internal ID to alphaNumber for relationship resolution
    regulationIdToAlphaNumber.set(id, alphaNumber);

    const entry: RegulationLookupEntry = {
      id,
      otherLanguageId,
      alphaNumber,
      language,
      shortTitle,
      reversedShortTitle,
      lastConsolidationDate,
      consolidateFlag,
    };

    regulations.set(getRegulationKey(alphaNumber, language), entry);
  }

  return {
    statutes,
    regulations,
    regulationIdToAlphaNumber,
    actRelationships,
  };
}

/**
 * Look up statute metadata by chapter number and language
 */
export function lookupStatute(
  data: LookupData,
  chapterNumber: string,
  language: Language
): StatuteLookupEntry | undefined {
  return data.statutes.get(getStatuteKey(chapterNumber, language));
}

/**
 * Look up regulation metadata by alpha number and language
 */
export function lookupRegulation(
  data: LookupData,
  alphaNumber: string,
  language: Language
): RegulationLookupEntry | undefined {
  return data.regulations.get(getRegulationKey(alphaNumber, language));
}

/**
 * Get the enabling act ID for a regulation based on relationships
 *
 * This searches the act relationships to find which act(s) this regulation
 * is related to, and returns the first matching act's chapter number.
 */
export function getEnablingActFromRelationships(
  data: LookupData,
  regulationId: string,
  language: Language
): string | undefined {
  // Look through all act relationships to find this regulation
  for (const [statuteId, regIds] of data.actRelationships) {
    if (regIds.includes(regulationId)) {
      // Find the statute entry by ID
      for (const [, entry] of data.statutes) {
        if (entry.id === statuteId && entry.language === language) {
          return entry.chapterNumber;
        }
      }
    }
  }
  return;
}

/**
 * Get all regulation alpha numbers related to a statute
 */
export function getRelatedRegulations(
  data: LookupData,
  chapterNumber: string,
  language: Language
): string[] {
  const statute = lookupStatute(data, chapterNumber, language);
  if (!statute) {
    return [];
  }

  const alphaNumbers: string[] = [];
  for (const regId of statute.relatedRegulationIds) {
    const alphaNumber = data.regulationIdToAlphaNumber.get(regId);
    if (alphaNumber) {
      alphaNumbers.push(alphaNumber);
    }
  }
  return alphaNumbers;
}

/**
 * Helper to ensure a value is an array
 */
function ensureArray<T>(val: T | T[] | undefined): T[] {
  if (!val) {
    return [];
  }
  return Array.isArray(val) ? val : [val];
}

/**
 * Helper to get text content from XML element
 */
function getTextContent(el: unknown): string | undefined {
  if (typeof el === "string") {
    return el;
  }
  if (typeof el === "number") {
    return String(el);
  }
  if (el && typeof el === "object" && "#text" in el) {
    return String((el as { "#text": unknown })["#text"]);
  }
  return;
}
