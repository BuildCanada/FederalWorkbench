import type { NextRequest } from "next/server";
import { auth } from "@/app/(auth)/auth";
import {
  getSectionContentRange,
  getSectionContentRangeForRegulation,
  isValidActId,
  isValidLanguage,
  isValidRegulationId,
  type SectionContent,
} from "@/lib/db/legislation/queries";
import { ChatSDKError } from "@/lib/errors";

export type SectionContentResponse = {
  sections: SectionContent[];
};

const MAX_RANGE_SIZE = 100;

/**
 * GET /api/legislation/section-content
 *
 * Query params:
 * - docType: "act" | "regulation" (optional, default "act")
 * - docId: string (required if docType specified) - Document identifier
 * - actId: string (legacy, use docType + docId instead) - The act identifier (e.g., "C-46")
 * - language: "en" | "fr" (optional, default "en")
 * - startOrder: number (required) - Starting section order (inclusive)
 * - endOrder: number (required) - Ending section order (inclusive)
 *
 * Returns content for sections in the specified range (max 100 sections)
 */
export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  const { searchParams } = new URL(request.url);
  const docType = searchParams.get("docType") || "act";
  const docId = searchParams.get("docId");
  const actId = searchParams.get("actId"); // Legacy support
  const languageParam = searchParams.get("language");
  const startOrder = Number.parseInt(searchParams.get("startOrder") || "0", 10);
  const endOrder = Number.parseInt(searchParams.get("endOrder") || "0", 10);

  const language = isValidLanguage(languageParam) ? languageParam : "en";

  if (startOrder < 0 || endOrder < startOrder) {
    return Response.json(
      { error: "Invalid startOrder/endOrder range" },
      { status: 400 }
    );
  }

  if (endOrder - startOrder > MAX_RANGE_SIZE) {
    return Response.json(
      { error: `Range exceeds maximum of ${MAX_RANGE_SIZE} sections` },
      { status: 400 }
    );
  }

  if (docType === "regulation") {
    if (!docId) {
      return Response.json(
        { error: "docId is required for regulations" },
        { status: 400 }
      );
    }

    if (!isValidRegulationId(docId)) {
      return Response.json(
        { error: "Invalid regulation ID format" },
        { status: 400 }
      );
    }

    const sections = await getSectionContentRangeForRegulation({
      regulationId: docId,
      language,
      startOrder,
      endOrder,
    });

    const response: SectionContentResponse = { sections };
    return Response.json(response);
  }

  const effectiveActId = docId || actId;

  if (!effectiveActId) {
    return Response.json(
      { error: "actId or docId is required" },
      { status: 400 }
    );
  }

  if (!isValidActId(effectiveActId)) {
    return Response.json({ error: "Invalid actId format" }, { status: 400 });
  }

  const sections = await getSectionContentRange({
    actId: effectiveActId,
    language,
    startOrder,
    endOrder,
  });

  const response: SectionContentResponse = { sections };
  return Response.json(response);
}
