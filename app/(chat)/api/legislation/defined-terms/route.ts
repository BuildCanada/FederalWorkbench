import type { NextRequest } from "next/server";
import { auth } from "@/app/(auth)/auth";
import {
  type DefinedTermItem,
  getDefinedTermsForSection,
  isValidActId,
  isValidLanguage,
  isValidRegulationId,
  isValidSectionLabel,
} from "@/lib/db/legislation/queries";
import { ChatSDKError } from "@/lib/errors";

export type DefinedTermsResponse = {
  terms: DefinedTermItem[];
};

/**
 * GET /api/legislation/defined-terms
 *
 * Query params:
 * - docType: "act" | "regulation" (optional, default "act")
 * - docId: string (required) - Document identifier (e.g., "C-46" for acts, "SOR-96-433" for regulations)
 * - language: "en" | "fr" (optional, default "en")
 * - sectionLabel: string (required) - The section to get applicable terms for
 * - partLabel: string (optional) - The part the section belongs to (for part-scoped definitions)
 *
 * Returns defined terms that apply to the specified section
 */
export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  const { searchParams } = new URL(request.url);
  const docTypeParam = searchParams.get("docType") || "act";
  const docId = searchParams.get("docId");
  const languageParam = searchParams.get("language");
  const sectionLabel = searchParams.get("sectionLabel");
  const partLabel = searchParams.get("partLabel") ?? undefined;

  if (docTypeParam !== "act" && docTypeParam !== "regulation") {
    return Response.json(
      { error: "Invalid docType, must be 'act' or 'regulation'" },
      { status: 400 }
    );
  }
  const docType = docTypeParam;

  const language = isValidLanguage(languageParam) ? languageParam : "en";

  if (!docId) {
    return Response.json({ error: "docId is required" }, { status: 400 });
  }

  if (!sectionLabel) {
    return Response.json(
      { error: "sectionLabel is required" },
      { status: 400 }
    );
  }

  if (!isValidSectionLabel(sectionLabel)) {
    return Response.json(
      { error: "Invalid sectionLabel format" },
      { status: 400 }
    );
  }

  if (partLabel && !isValidSectionLabel(partLabel)) {
    return Response.json(
      { error: "Invalid partLabel format" },
      { status: 400 }
    );
  }

  if (docType === "regulation") {
    if (!isValidRegulationId(docId)) {
      return Response.json(
        { error: "Invalid regulation ID format" },
        { status: 400 }
      );
    }
  } else if (!isValidActId(docId)) {
    return Response.json({ error: "Invalid act ID format" }, { status: 400 });
  }

  try {
    const terms = await getDefinedTermsForSection({
      docType,
      docId,
      language,
      sectionLabel,
      partLabel,
    });

    const response: DefinedTermsResponse = { terms };
    return Response.json(response);
  } catch (error) {
    console.error("Error fetching defined terms:", error);
    return Response.json(
      { error: "Failed to fetch defined terms" },
      { status: 500 }
    );
  }
}
