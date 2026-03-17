"use client";

import type { ParliamentContextResult } from "@/lib/ai/tools/retrieve-parliament-context";
import { cn } from "@/lib/utils";

export function ParliamentContextView({
  result,
  className,
}: {
  result: ParliamentContextResult;
  className?: string;
}) {
  const isFr = result.language === "fr";
  const sourcesLabel = isFr ? "## Sources" : "## Sources";
  const items = result.citations || [];

  // Show hydrated source types
  const hydratedTypes = result.hydratedSources.map((s) => s.sourceType);

  return (
    <div className={cn("rounded-md border bg-muted/30 p-4", className)}>
      {hydratedTypes.length > 0 && (
        <div className="mb-3 text-muted-foreground text-sm">
          {isFr ? "Sources enrichies:" : "Enriched sources:"}{" "}
          {hydratedTypes.join(", ")}
        </div>
      )}
      <div className="prose prose-sm dark:prose-invert">
        <h3>{sourcesLabel}</h3>
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {isFr ? "Aucune source" : "No sources"}
          </p>
        ) : (
          <ul className="list-disc pl-5">
            {items.map((c) => {
              const isFrench = result.language === "fr";
              const href = isFrench ? c.urlFr : c.urlEn;
              const text = isFrench ? c.textFr : c.textEn;
              const title = isFrench ? c.titleFr : c.titleEn;
              return (
                <li key={c.id}>
                  <a
                    className="underline"
                    href={href}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {text}
                  </a>
                  {title ? <span> — {title}</span> : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
