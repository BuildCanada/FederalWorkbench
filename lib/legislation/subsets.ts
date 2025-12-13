/**
 * Named subsets for legislation testing.
 * Regulations are resolved automatically via lookup.xml relationships.
 */

import {
  getRelatedRegulations,
  type LookupData,
  lookupStatute,
} from "./lookup-parser";

export const SUBSETS = {
  strategic: {
    name: "strategic",
    description:
      "Strategic test subset: 10 acts, ~6.5% of regulations, all complexity dimensions",
    acts: [
      // Baseline/validation
      "A-1", // Access to Information Act - 4 regs, 0.5 MB
      "P-21", // Privacy Act - 10 regs, 0.3 MB
      // Scale + cross-references
      "C-46", // Criminal Code - 97 regs, 5.2 MB, 1,809 sections
      // Terminology (replaces I-3.3 which is 13 MB)
      "E-15", // Excise Tax Act - 59 regs, 4.6 MB, 619 defined terms
      // Complex content (formulas, tables)
      "G-11.55", // Greenhouse Gas Pollution Pricing Act - 3 regs, 18 formulas, 9 tables
      "C-8", // Canada Pension Plan - 4 regs, 10 formulas, 3 tables
      // Regulatory ecosystem
      "L-2", // Canada Labour Code - 28 regs
      "C-15.31", // Canadian Environmental Protection Act - 65 regs
      "N-5", // National Defence Act - 24 regs, cross-refs
      "F-27", // Food and Drugs Act - 21 regs
    ],
  },
  smoke: {
    name: "smoke",
    description: "Quick smoke test for CI",
    acts: ["A-1", "P-21", "C-46", "E-15"],
  },
} as const;

export type SubsetName = keyof typeof SUBSETS;
export const DEFAULT_SUBSET: SubsetName = "strategic";

const SUBSET_ARG_PATTERN = /^--subset=(.+)$/;

/**
 * Convert lookup.xml alphaNumber to filename format.
 *
 * lookup.xml uses: "SOR/2007-151", "C.R.C., c. 870"
 * Filenames use:   "SOR-2007-151", "C.R.C.,_c._870"
 *
 * Transformation: slashes become dashes, spaces become underscores
 *
 * NOTE: This is different from normalizeRegulationId in utils/ids.ts which
 * normalizes instrumentNumber from parsed XML. That function replaces
 * comma-whitespace patterns differently. This function specifically converts
 * lookup.xml alphaNumber format to match filesystem filenames.
 */
export function alphaNumberToFilename(alphaNumber: string): string {
  return alphaNumber.replace(/\//g, "-").replace(/ /g, "_");
}

/**
 * Resolved subset with act IDs and regulation filenames ready for filtering.
 */
export type ResolvedSubset = {
  name: string;
  actIds: Set<string>;
  regulationFilenames: Set<string>;
};

/**
 * Resolve a named subset using lookup.xml to find related regulations.
 * Validates all act IDs exist in lookup.xml.
 *
 * @throws Error if any act ID is not found in lookup.xml
 */
export function resolveSubset(
  subsetName: SubsetName,
  lookupData: LookupData
): ResolvedSubset {
  const subset = SUBSETS[subsetName];
  const actIds = new Set(subset.acts);
  const regulationFilenames = new Set<string>();
  const missingActs: string[] = [];

  for (const actId of actIds) {
    // Validate act exists in lookup.xml (check both languages)
    const foundEn = lookupStatute(lookupData, actId, "en");
    const foundFr = lookupStatute(lookupData, actId, "fr");

    if (!foundEn && !foundFr) {
      missingActs.push(actId);
      continue;
    }

    // Get related regulations for both languages
    // EN returns alphaNumbers like "SOR/2007-151"
    // FR returns alphaNumbers like "DORS/2007-151"
    const relatedEn = getRelatedRegulations(lookupData, actId, "en");
    const relatedFr = getRelatedRegulations(lookupData, actId, "fr");

    for (const alphaNumber of [...relatedEn, ...relatedFr]) {
      regulationFilenames.add(alphaNumberToFilename(alphaNumber));
    }
  }

  if (missingActs.length > 0) {
    throw new Error(
      `Subset "${subsetName}" contains invalid act IDs not found in lookup.xml: ${missingActs.join(", ")}`
    );
  }

  return {
    name: subsetName,
    actIds,
    regulationFilenames,
  };
}

/**
 * Parse --subset CLI argument.
 * Returns subset name or null if flag not present.
 *
 * @throws Error if invalid subset name provided
 */
export function parseSubsetArg(args: string[]): SubsetName | null {
  const subsetArg = args.find((a) => a.startsWith("--subset"));

  if (!subsetArg) {
    return null;
  }

  if (subsetArg === "--subset") {
    return DEFAULT_SUBSET;
  }

  const match = subsetArg.match(SUBSET_ARG_PATTERN);
  if (match) {
    const name = match[1];
    if (!(name in SUBSETS)) {
      const available = Object.keys(SUBSETS).join(", ");
      throw new Error(`Unknown subset: "${name}". Available: ${available}`);
    }
    return name as SubsetName;
  }

  return DEFAULT_SUBSET;
}
