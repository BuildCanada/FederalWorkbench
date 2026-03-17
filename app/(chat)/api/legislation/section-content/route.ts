import type { NextRequest } from "next/server";
import { auth } from "@/app/(auth)/auth";
import {
  getSectionContentRange,
  isValidActId,
  isValidLanguage,
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
 * - actId: string (required) - The act identifier (e.g., "C-46")
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
  const actId = searchParams.get("actId");
  const languageParam = searchParams.get("language");
  const startOrder = Number.parseInt(searchParams.get("startOrder") || "0", 10);
  const endOrder = Number.parseInt(searchParams.get("endOrder") || "0", 10);

  if (!actId) {
    return Response.json({ error: "actId is required" }, { status: 400 });
  }

  if (!isValidActId(actId)) {
    return Response.json({ error: "Invalid actId format" }, { status: 400 });
  }

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

  const sections = await getSectionContentRange({
    actId,
    language,
    startOrder,
    endOrder,
  });

  const response: SectionContentResponse = { sections };
  return Response.json(response);
}
