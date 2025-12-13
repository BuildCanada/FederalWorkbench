/**
 * Normalize regulation ID (SOR/97-175 -> SOR-97-175)
 */
export function normalizeRegulationId(instrumentNumber: string): string {
  // Replace / with - for consistent ID format
  return instrumentNumber.replace(/\//g, "-").replace(/,\s*/g, "_");
}
