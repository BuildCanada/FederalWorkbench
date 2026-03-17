"use client";

import { ExternalLinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Generic citation type that works for both parliament and legislation
type Citation = {
  id: number;
  textEn: string;
  textFr: string;
  urlEn?: string;
  urlFr?: string;
  titleEn?: string;
  titleFr?: string;
};

type CitationsProps = {
  citations: Citation[];
  language: "en" | "fr" | "unknown";
  className?: string;
};

export function Citations({ citations, language, className }: CitationsProps) {
  if (!citations || citations.length === 0) {
    return null;
  }

  const isFrench = language === "fr";
  const title = isFrench ? "Sources" : "Sources";

  return (
    <div className={cn("mt-4 border-border border-t pt-4", className)}>
      <h4 className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {title}
      </h4>
      <ol className="space-y-1.5 text-sm">
        {citations.map((citation) => {
          const text = isFrench ? citation.textFr : citation.textEn;
          const url = isFrench ? citation.urlFr : citation.urlEn;
          const citationTitle = isFrench ? citation.titleFr : citation.titleEn;

          return (
            <li className="flex items-start gap-2" key={citation.id}>
              <span className="shrink-0 text-muted-foreground">
                [{citation.id}]
              </span>
              {url ? (
                <a
                  className="group flex items-start gap-1 text-primary hover:underline"
                  href={url}
                  rel="noopener noreferrer"
                  target="_blank"
                  title={citationTitle || text}
                >
                  <span className="line-clamp-2">
                    {citationTitle ? `${text} — ${citationTitle}` : text}
                  </span>
                  <ExternalLinkIcon className="mt-0.5 size-3 shrink-0 opacity-50 group-hover:opacity-100" />
                </a>
              ) : (
                <span className="text-foreground">
                  {citationTitle ? `${text} — ${citationTitle}` : text}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
