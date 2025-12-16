"use client";

import { ChevronRightIcon, ScaleIcon } from "lucide-react";
import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { HydratedLegislationSource } from "@/lib/rag/legislation/hydrate";
import { cn } from "@/lib/utils";

type LegislationContextPanelProps = {
  hydratedSources: HydratedLegislationSource[];
  language: "en" | "fr" | "unknown";
  onOpenSource: (source: HydratedLegislationSource) => void;
};

/**
 * Legislation source pill - consistent interactive element for acts and regulations.
 * Opens in-app legislation viewer (slide-over panel).
 */
function LegislationSourcePill({
  source,
  onOpen,
  isFr,
}: {
  source: HydratedLegislationSource;
  onOpen: () => void;
  isFr: boolean;
}) {
  const isAct = source.sourceType === "act";
  const label = source.displayLabel ?? (isAct ? "View Act" : "View Regulation");
  const ariaLabel = isFr
    ? `Ouvrir ${label} dans le visualiseur`
    : `Open ${label} in viewer`;

  return (
    <button
      aria-label={ariaLabel}
      className="group flex w-full items-center gap-2.5 rounded-lg border border-border/60 bg-card/50 px-3 py-2 text-left transition-all hover:border-primary/30 hover:bg-accent/50"
      onClick={onOpen}
      type="button"
    >
      <ScaleIcon className="size-4 shrink-0 text-muted-foreground group-hover:text-primary" />
      <span className="flex-1 truncate font-medium text-foreground text-sm">
        {label}
      </span>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
    </button>
  );
}

/**
 * Multi-tier display for legislation context in chat messages.
 *
 * Primary: Act/Regulation - prominent pill buttons
 * Secondary: Related Resources - expandable panel with sections, terms, cross-refs
 */
export function LegislationContextPanel({
  hydratedSources,
  language,
  onOpenSource,
}: LegislationContextPanelProps) {
  const [open, setOpen] = useState(false);
  const isFr = language === "fr";

  if (!hydratedSources || hydratedSources.length === 0) {
    return null;
  }

  // Extract sources by tier
  const actSource = hydratedSources.find((s) => s.sourceType === "act");
  const regSource = hydratedSources.find((s) => s.sourceType === "regulation");
  const panelSources = hydratedSources.filter((s) =>
    ["act_section", "defined_term", "cross_reference"].includes(s.sourceType)
  );

  const hasPrimarySources = actSource || regSource;

  // Format label for panel items
  const formatPanelLabel = (source: HydratedLegislationSource): string => {
    switch (source.sourceType) {
      case "act_section":
        return isFr
          ? `Article ${source.sectionLabel ?? ""}`
          : `Section ${source.sectionLabel ?? ""}`;
      case "defined_term":
        return source.term
          ? `"${source.term}" — ${isFr ? "définition" : "definition"}`
          : isFr
            ? "Terme défini"
            : "Defined term";
      case "cross_reference":
        return source.targetTitle
          ? `${isFr ? "Renvoi:" : "Cross-ref:"} ${source.targetTitle}`
          : isFr
            ? "Renvoi"
            : "Cross-reference";
      default:
        return source.displayLabel ?? source.id;
    }
  };

  return (
    <div className="mt-3 space-y-2">
      {/* Primary legislation sources - equal visual weight */}
      {hasPrimarySources && (
        <div className="space-y-1.5">
          {actSource && (
            <LegislationSourcePill
              isFr={isFr}
              onOpen={() => onOpenSource(actSource)}
              source={actSource}
            />
          )}
          {regSource && (
            <LegislationSourcePill
              isFr={isFr}
              onOpen={() => onOpenSource(regSource)}
              source={regSource}
            />
          )}
        </div>
      )}

      {/* Expandable panel for additional resources */}
      {panelSources.length > 0 && (
        <Collapsible onOpenChange={setOpen} open={open}>
          <CollapsibleTrigger
            aria-label={
              isFr
                ? `${open ? "Masquer" : "Afficher"} les ressources connexes`
                : `${open ? "Hide" : "Show"} related resources`
            }
            className="flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
          >
            <ChevronRightIcon
              className={cn(
                "size-4 transition-transform duration-200",
                open && "rotate-90"
              )}
            />
            <span>
              {isFr ? "Ressources connexes" : "Related Resources"} (
              {panelSources.length})
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1 ml-5 space-y-1">
            {panelSources.map((source) => (
              <button
                className="block text-primary text-sm hover:underline"
                key={source.id}
                onClick={() => onOpenSource(source)}
                type="button"
              >
                {formatPanelLabel(source)}
              </button>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
