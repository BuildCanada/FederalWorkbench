const DATE_YYYYMMDD_REGEX = /^\d{8}$/;
const DATE_YYYY_MM_DD_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a date from LIMS format (YYYY-MM-DD or YYYYMMDD)
 */
export function parseDate(dateStr?: string): string | undefined {
  if (!dateStr) {
    return;
  }
  // Handle YYYYMMDD format
  if (DATE_YYYYMMDD_REGEX.test(dateStr)) {
    return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
  }
  // Already in YYYY-MM-DD format
  if (DATE_YYYY_MM_DD_REGEX.test(dateStr)) {
    return dateStr;
  }
  return;
}

/**
 * Parse a date from XML Date element
 */
export function parseDateElement(
  dateEl: { YYYY?: string; MM?: string; DD?: string } | undefined
): string | undefined {
  if (!dateEl?.YYYY) {
    return;
  }
  const yyyy = dateEl.YYYY;
  const mm = (dateEl.MM || "01").padStart(2, "0");
  const dd = (dateEl.DD || "01").padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
