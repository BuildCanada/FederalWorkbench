import { Artifact } from "@/components/create-artifact";
import { LegislationViewer } from "@/components/legislation-viewer";

type LegislationArtifactMetadata = {
  actId: string;
  language: "en" | "fr";
};

export const legislationArtifact = new Artifact<
  "legislation",
  LegislationArtifactMetadata
>({
  kind: "legislation",
  description:
    "Display Canadian legislation acts with virtualized section navigation.",
  onStreamPart: () => {
    // Legislation artifacts are not streamed
  },
  content: ({ content, isLoading, metadata }) => {
    // Parse actId and language from content (stored as JSON)
    let actId = metadata?.actId;
    let language = metadata?.language || "en";

    // Fallback: try parsing from content if metadata not set
    if (!actId && content) {
      try {
        const parsed = JSON.parse(content);
        actId = parsed.actId;
        language = parsed.language || "en";
      } catch {
        // Content might be plain markdown for backwards compatibility
      }
    }

    if (!actId) {
      return (
        <div className="flex h-full items-center justify-center p-8">
          <div className="text-muted-foreground">
            No act specified. Please open an act from the chat.
          </div>
        </div>
      );
    }

    return (
      <LegislationViewer
        actId={actId}
        isLoading={isLoading}
        language={language}
      />
    );
  },
  actions: [],
  toolbar: [],
});
