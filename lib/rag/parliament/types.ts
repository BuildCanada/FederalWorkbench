/**
 * RAG System Shared Types
 *
 * Common types used across the RAG (Retrieval-Augmented Generation) system.
 */

/**
 * Supported languages for bilingual content
 */
export type Lang = "en" | "fr";

/**
 * Format a date for display in YYYY-MM-DD format.
 *
 * Uses local time (not UTC) to avoid date shifting issues.
 * Example: A date stored as "2024-01-15" won't become "2024-01-14"
 * due to timezone conversion.
 *
 * @param date - Date object, ISO string, or null/undefined
 * @param fallback - Value to return if date is null/undefined (default: null)
 */
export function formatDate(
  date: Date | string | null | undefined
): string | null;
export function formatDate<T extends string>(
  date: Date | string | null | undefined,
  fallback: T
): string;
export function formatDate(
  date: Date | string | null | undefined,
  fallback: string | null = null
): string | null {
  if (!date) {
    return fallback;
  }
  if (typeof date === "string") {
    return date.slice(0, 10);
  }
  // Use local time methods to avoid UTC date shifting
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Format a time for display in HH:MM format.
 *
 * Uses local time (not UTC) to avoid time shifting issues.
 *
 * @param date - Date object or null/undefined
 * @returns Time string in HH:MM format or null
 */
export function formatTime(date: Date | null | undefined): string | null {
  if (!date) {
    return null;
  }
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}
