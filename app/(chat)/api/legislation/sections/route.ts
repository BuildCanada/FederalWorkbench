import type { NextRequest } from "next/server";
import { auth } from "@/app/(auth)/auth";
import {
  getActSections,
  isValidActId,
  isValidLanguage,
} from "@/lib/db/legislation/queries";
import { ChatSDKError } from "@/lib/errors";

export type {
  ActMetadata,
  LegislationSectionsResponse,
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
 * - actId: string (required) - The act identifier (e.g., "C-46")
 * - language: "en" | "fr" (optional, default "en")
 *
 * Returns act metadata and TOC (all section labels/marginalNotes for navigation)
 */
export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  const { searchParams } = new URL(request.url);
  const actId = searchParams.get("actId");
  const languageParam = searchParams.get("language");

  if (!actId) {
    return Response.json({ error: "actId is required" }, { status: 400 });
  }

  if (!isValidActId(actId)) {
    return Response.json({ error: "Invalid actId format" }, { status: 400 });
  }

  const language = isValidLanguage(languageParam) ? languageParam : "en";

  const result = await getActSections({ actId, language });

  if (!result) {
    return Response.json({ error: "Act not found" }, { status: 404 });
  }

  return Response.json(result);
}
