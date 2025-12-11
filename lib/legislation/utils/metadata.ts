import type { ChangeType, LimsMetadata, Status } from "../types";
import { parseDate } from "./dates";

/**
 * Determine status from XML attributes and content
 *
 * Checks for:
 * 1. Root-level <Repealed> element - indicates entire document is repealed
 * 2. @in-force="no" attribute - indicates not yet in force
 * 3. Default: in-force
 */
export function determineStatus(el: Record<string, unknown>): Status {
  // Check for root-level Repealed element (direct child of Statute/Regulation)
  // This indicates the entire document has been repealed, even if in-force="yes"
  if (el.Repealed !== undefined) {
    return "repealed";
  }

  if (el["@_in-force"] === "no") {
    return "not-in-force";
  }
  return "in-force";
}

/**
 * Extract LIMS metadata from XML element attributes
 */
export function extractLimsMetadata(
  el: Record<string, unknown>
): LimsMetadata | undefined {
  const fid = el["@_lims:fid"] as string | undefined;
  const id = el["@_lims:id"] as string | undefined;
  const enactedDate = parseDate(
    el["@_lims:enacted-date"] as string | undefined
  );
  const enactId = el["@_lims:enactId"] as string | undefined;
  const pitDate = parseDate(el["@_lims:pit-date"] as string | undefined);
  const currentDate = parseDate(
    el["@_lims:current-date"] as string | undefined
  );
  const inForceStartDate = parseDate(
    el["@_lims:inforce-start-date"] as string | undefined
  );

  if (
    !fid &&
    !id &&
    !enactedDate &&
    !enactId &&
    !pitDate &&
    !currentDate &&
    !inForceStartDate
  ) {
    return;
  }

  return {
    fid,
    id,
    enactedDate,
    enactId,
    pitDate,
    currentDate,
    inForceStartDate,
  };
}

/**
 * Extract @change attribute value (ins/del/off/alt)
 */
export function extractChangeType(
  el: Record<string, unknown>
): ChangeType | undefined {
  const change = el["@_change"] as string | undefined;
  if (change && ["ins", "del", "off", "alt"].includes(change)) {
    return change as ChangeType;
  }
  return;
}
