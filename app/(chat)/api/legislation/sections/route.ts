import type { NextRequest } from "next/server";
import { auth } from "@/app/(auth)/auth";
import {
  getActSections,
  getRegulationSections,
  isValidActId,
  isValidLanguage,
  isValidRegulationId,
} from "@/lib/db/legislation/queries";
import { ChatSDKError } from "@/lib/errors";

export type {
  ActMetadata,
  LegislationSectionsResponse,
  RegulationMetadata,
  RegulationSectionsResponse,
  SectionContent,
  SectionTocItem,
} from "@/lib/db/legislation/queries";

export type SectionContentResponse = {
  sections: import("@/lib/db/legislation/queries").SectionContent[];
};

/**
 * GET /api/legislation/sections
 *
 * Query params:
 * - docType: "act" | "regulation" (optional, default "act")
 * - docId: string (required if docType specified) - Document identifier
 * - actId: string (legacy, use docType + docId instead) - The act identifier (e.g., "C-46")
 * - language: "en" | "fr" (optional, default "en")
 *
 * Returns act/regulation metadata and TOC (all section labels/marginalNotes for navigation)
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

  const language = isValidLanguage(languageParam) ? languageParam : "en";

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

    const result = await getRegulationSections({
      regulationId: docId,
      language,
    });

    if (!result) {
      return Response.json({ error: "Regulation not found" }, { status: 404 });
    }

    return Response.json({ ...result, docType: "regulation" });
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

  const result = await getActSections({ actId: effectiveActId, language });

  if (!result) {
    return Response.json({ error: "Act not found" }, { status: 404 });
  }

  return Response.json({ ...result, docType: "act" });
}
