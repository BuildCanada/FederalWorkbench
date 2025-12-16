import { Artifact } from "@/components/create-artifact";
import { LegislationViewer } from "@/components/legislation-viewer";

type LegislationArtifactMetadata = {
  docType?: "act" | "regulation";
  docId?: string;
  actId?: string; // Legacy support
  language: "en" | "fr";
};

export const legislationArtifact = new Artifact<
  "legislation",
  LegislationArtifactMetadata
>({
  kind: "legislation",
  description:
    "Display Canadian legislation (acts and regulations) with virtualized section navigation.",
  onStreamPart: () => {
    // Legislation artifacts are not streamed
  },
  content: ({ content, isLoading, metadata }) => {
    // Parse document info from metadata or content
    let docType = metadata?.docType || "act";
    let docId = metadata?.docId || metadata?.actId;
    let language = metadata?.language || "en";

    // Fallback: try parsing from content if metadata not set
    if (!docId && content) {
      try {
        const parsed = JSON.parse(content);
        docType = parsed.docType || "act";
        docId = parsed.docId || parsed.actId;
        language = parsed.language || "en";
      } catch {
        // Content might be plain markdown for backwards compatibility
      }
    }

    if (!docId) {
      return (
        <div className="flex h-full items-center justify-center p-8">
          <div className="text-muted-foreground">
            No legislation specified. Please open an act or regulation from the
            chat.
          </div>
        </div>
      );
    }

    return (
      <LegislationViewer
        docId={docId}
        docType={docType}
        isLoading={isLoading}
        language={language}
      />
    );
  },
  actions: [],
  toolbar: [],
});
