/**
 * Heading extraction utilities for legislation XML parsing.
 *
 * Consolidates duplicated TitleText/Label extraction patterns
 * used across Heading, GroupHeading, ScheduleFormHeading, etc.
 */

import { extractTextContentPreserved as extractTextContent } from "./text";

/**
 * Extract Label and TitleText from a heading-like element.
 * Works with Heading, GroupHeading, ScheduleFormHeading, etc.
 *
 * @param obj - Parsed XML object containing Label and/or TitleText children
 * @returns Object with label, title, and combined string
 */
export function extractHeadingComponents(obj: Record<string, unknown>): {
  label: string | undefined;
  title: string | undefined;
  combined: string;
} {
  const label = obj.Label ? extractTextContent(obj.Label) : undefined;
  const title = obj.TitleText ? extractTextContent(obj.TitleText) : undefined;
  const combined = [label, title].filter(Boolean).join(" ");
  return { label, title, combined };
}

/**
 * Extract just TitleText from an element.
 *
 * @param obj - Parsed XML object that may contain TitleText
 * @returns The title text string or undefined if not present
 */
export function extractTitleText(
  obj: Record<string, unknown>
): string | undefined {
  return obj.TitleText ? extractTextContent(obj.TitleText) : undefined;
}
