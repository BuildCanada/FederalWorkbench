import parse from "html-react-parser";
import { ExternalLinkIcon } from "lucide-react";
import React, { type ReactNode } from "react";
import { buildJusticeCanadaUrl } from "@/lib/legislation/constants";
import type { ContentNode } from "@/lib/legislation/types";

type Props = {
  nodes: ContentNode[];
  language?: "en" | "fr";
  /** Callback when an internal reference is clicked. Receives the target section label. */
  onNavigate?: (target: string) => void;
};

/**
 * Extract plain text from ContentNode children (for XRefInternal targets)
 */
function extractTextFromChildren(children: ContentNode[] | undefined): string {
  if (!children) {
    return "";
  }
  return children
    .map((child) => {
      if (child.type === "text") {
        return child.value;
      }
      if ("children" in child) {
        return extractTextFromChildren(child.children);
      }
      return "";
    })
    .join("");
}

/**
 * MathML renderer - uses html-react-parser to safely convert
 * MathML XML to React elements for browser math rendering.
 */
function MathMLRenderer({
  raw,
  display,
}: {
  raw: string;
  display?: "block" | "inline";
}) {
  return (
    <span
      className={
        display === "block" ? "my-2 block text-center" : "inline-block"
      }
    >
      {parse(raw)}
    </span>
  );
}

export function ContentTreeRenderer({
  nodes,
  language = "en",
  onNavigate,
}: Props): ReactNode {
  return (
    <>{nodes.map((node, i) => renderNode(node, i, language, onNavigate))}</>
  );
}

function renderNode(
  node: ContentNode,
  key: number,
  language: string,
  onNavigate?: (target: string) => void
): ReactNode {
  if (node.type === "text") {
    return node.value;
  }

  const children =
    "children" in node && node.children
      ? node.children.map((child, i) =>
          renderNode(child, i, language, onNavigate)
        )
      : null;

  switch (node.type) {
    case "Label":
      return (
        <span className="label font-semibold" key={key}>
          {children}{" "}
        </span>
      );
    case "Text":
      return <span key={key}>{children}</span>;
    case "Subsection":
      return (
        <div className="subsection mt-2 ml-4" key={key}>
          {children}
        </div>
      );
    case "Paragraph":
      return (
        <div className="paragraph mt-1 ml-6" key={key}>
          {children}
        </div>
      );
    case "Subparagraph":
      return (
        <div className="subparagraph mt-1 ml-8" key={key}>
          {children}
        </div>
      );
    case "Clause":
      return (
        <div className="clause mt-1 ml-10" key={key}>
          {children}
        </div>
      );
    case "Subclause":
      return (
        <div className="subclause mt-1 ml-12" key={key}>
          {children}
        </div>
      );
    case "Subsubclause":
      return (
        <div className="subsubclause mt-1 ml-14" key={key}>
          {children}
        </div>
      );
    case "Definition":
    case "DefinitionEnOnly":
    case "DefinitionFrOnly":
      return (
        <div className="definition mt-2" key={key}>
          {children}
        </div>
      );
    case "Continued":
    case "ContinuedSubparagraph":
    case "ContinuedClause":
    case "ContinuedSubclause":
    case "ContinuedFormulaParagraph":
    case "ContinuedSectionSubsection":
    case "ContinuedParagraph":
    case "ContinuedDefinition":
      return (
        <div className="continued" key={key}>
          {children}
        </div>
      );

    case "DefinedTermEn":
    case "DefinedTermFr":
      return (
        <dfn className="font-semibold" key={key}>
          {children}
        </dfn>
      );
    case "DefinitionRef":
      return (
        <span className="text-primary" key={key}>
          {children}
        </span>
      );
    case "XRefExternal": {
      if (node.link) {
        const href = buildJusticeCanadaUrl(
          node.link,
          node.refType === "regulation" ? "regulation" : "act",
          language as "en" | "fr"
        );
        return (
          <a
            className="inline-flex items-center gap-1 text-primary underline hover:text-primary/80"
            href={href}
            key={key}
            rel="noopener noreferrer"
            target="_blank"
          >
            {children}
            <ExternalLinkIcon className="size-3 shrink-0" />
          </a>
        );
      }
      return (
        <em className="text-foreground" key={key}>
          {children}
        </em>
      );
    }
    case "XRefInternal": {
      const target = node.target || extractTextFromChildren(node.children);
      if (onNavigate && target) {
        return (
          <button
            className="text-primary underline hover:text-primary/80"
            key={key}
            onClick={() => onNavigate(target)}
            type="button"
          >
            {children}
          </button>
        );
      }
      return (
        <span className="text-primary" key={key}>
          {children}
        </span>
      );
    }

    case "Emphasis":
      if (node.style === "italic") {
        return (
          <em className="italic" key={key}>
            {children}
          </em>
        );
      }
      if (node.style === "smallcaps") {
        return (
          <span className="text-[0.85em] uppercase tracking-wide" key={key}>
            {children}
          </span>
        );
      }
      return (
        <strong className="font-bold" key={key}>
          {children}
        </strong>
      );
    case "Sup":
    case "Superscript":
      return <sup key={key}>{children}</sup>;
    case "Sub":
    case "Subscript":
      return <sub key={key}>{children}</sub>;
    case "Base":
      return <span key={key}>{children}</span>;
    case "Repealed":
      return (
        <span className="text-muted-foreground italic" key={key}>
          {children}
        </span>
      );
    case "FootnoteRef":
      return (
        <sup className="text-primary" key={key}>
          {children}
        </sup>
      );
    case "LineBreak":
      return <br key={key} />;
    case "PageBreak":
      return <hr className="my-4 border-dashed" key={key} />;
    case "FormBlank":
      if (children && node.children && node.children.length > 0) {
        return (
          <span className="form-blank-with-content block text-center" key={key}>
            <span className="inline-block border-current border-t pt-1">
              {children}
            </span>
          </span>
        );
      }
      return (
        <span
          className="inline-block border-current border-b"
          key={key}
          style={{ width: node.width || "4em" }}
        >
          &nbsp;
        </span>
      );
    case "Fraction": {
      const numerator = node.children?.find(
        (c) => "type" in c && c.type === "Numerator"
      );
      const denominator = node.children?.find(
        (c) => "type" in c && c.type === "Denominator"
      );

      if (numerator && denominator) {
        return (
          <span className="inline-fraction" key={key}>
            <span className="numerator">
              {renderNode(numerator, 0, language, onNavigate)}
            </span>
            <span className="mx-0.5">/</span>
            <span className="denominator">
              {renderNode(denominator, 1, language, onNavigate)}
            </span>
          </span>
        );
      }
      return (
        <span className="inline-fraction" key={key}>
          {children}
        </span>
      );
    }
    case "Numerator":
    case "Denominator":
      return <span key={key}>{children}</span>;
    case "Leader": {
      const width = node.length || "4em";
      const borderStyle =
        node.style === "none"
          ? "none"
          : node.style === "solid"
            ? "1px solid currentColor"
            : node.style === "dash"
              ? "1px dashed currentColor"
              : "1px dotted currentColor";
      return (
        <span
          className="leader inline-block"
          key={key}
          style={{
            width,
            minWidth: width,
            borderBottom: borderStyle,
          }}
        >
          &nbsp;
        </span>
      );
    }
    case "Separator":
      return <hr className="my-2" key={key} />;
    case "Language":
      return (
        <span key={key} lang={node.lang}>
          {children}
        </span>
      );

    // Lists
    case "List": {
      const isOrdered =
        node.style?.includes("alpha") ||
        node.style?.includes("arabic") ||
        node.style?.includes("roman");
      const ListTag = isOrdered ? "ol" : "ul";
      return (
        <ListTag className="my-2 ml-4 list-inside" key={key}>
          {children}
        </ListTag>
      );
    }
    case "Item":
      return (
        <li className="mt-1" key={key}>
          {children}
        </li>
      );

    case "TableGroup":
      return (
        <div className="table-group my-4 overflow-x-auto" key={key}>
          {children}
        </div>
      );
    case "Table": {
      const tableChildren =
        "children" in node && node.children
          ? node.children.filter(
              (c) =>
                "type" in c &&
                ["TGroup", "THead", "TBody", "TFoot", "ColSpec"].includes(
                  c.type
                )
            )
          : [];
      const captionChildren =
        "children" in node && node.children
          ? node.children.filter(
              (c) =>
                c.type === "text" ||
                ("type" in c &&
                  !["TGroup", "THead", "TBody", "TFoot", "ColSpec"].includes(
                    c.type
                  ))
            )
          : [];

      const captionText = captionChildren
        .map((c, i) => renderNode(c, i, language, onNavigate))
        .filter(Boolean);

      return (
        <table
          className="min-w-full border-collapse border border-border text-sm"
          key={key}
        >
          {captionText.length > 0 && (
            <caption className="mb-2 text-left font-medium">
              {captionText}
            </caption>
          )}
          {tableChildren.map((c, i) => renderNode(c, i, language, onNavigate))}
        </table>
      );
    }
    case "TGroup":
      return <React.Fragment key={key}>{children}</React.Fragment>;
    case "THead":
      return (
        <thead className="bg-muted" key={key}>
          {children}
        </thead>
      );
    case "TBody":
      return <tbody key={key}>{children}</tbody>;
    case "TFoot":
      return (
        <tfoot className="bg-muted/50" key={key}>
          {children}
        </tfoot>
      );
    case "Row":
      return (
        <tr className="border-border border-b" key={key}>
          {children}
        </tr>
      );
    case "Entry": {
      const attrs = node.attrs || {};
      const rowSpan = attrs.morerows
        ? Number.parseInt(attrs.morerows, 10) + 1
        : undefined;
      return (
        <td className="border border-border p-2" key={key} rowSpan={rowSpan}>
          {children}
        </td>
      );
    }
    case "ColSpec":
      return null;

    case "FormulaGroup":
      return (
        <div className="formula-group my-4" key={key}>
          {children}
        </div>
      );
    case "Formula":
      return (
        <div className="formula my-2 overflow-x-auto text-center" key={key}>
          {children}
        </div>
      );
    case "FormulaText":
      return (
        <code
          className="formula-text rounded bg-muted px-2 py-1 font-mono"
          key={key}
        >
          {children}
        </code>
      );
    case "FormulaConnector":
      return (
        <p className="formula-connector my-1 ml-4" key={key}>
          {children}
        </p>
      );
    case "FormulaDefinition":
      return (
        <div className="formula-definition mt-2 ml-4" key={key}>
          {children}
        </div>
      );
    case "FormulaTerm":
      return (
        <React.Fragment key={key}>
          <var className="formula-term font-semibold italic">
            {children}
          </var>{" "}
        </React.Fragment>
      );
    case "FormulaParagraph":
      return (
        <div className="formula-paragraph my-1" key={key}>
          {children}
        </div>
      );

    case "MathML":
      return <MathMLRenderer display={node.display} key={key} raw={node.raw} />;

    case "ImageGroup":
      return (
        <figure className="image-group my-4" key={key}>
          {children}
        </figure>
      );
    case "Image":
      return node.source ? (
        // biome-ignore lint/nursery/useImageSize: legislation images need natural sizing
        // biome-ignore lint/performance/noImgElement: Next.js Image doesn't support variable sizes
        <img
          alt=""
          className="legislation-image inline-block max-w-full"
          key={key}
          src={`/legislation/images/${node.source}`}
        />
      ) : null;
    case "Caption":
      return (
        <figcaption className="mt-2 text-center text-sm italic" key={key}>
          {children}
        </figcaption>
      );

    case "BilingualGroup":
      return (
        <div className="bilingual-group my-2 flex gap-4" key={key}>
          {children}
        </div>
      );
    case "BilingualItemEn":
      return (
        <span className="bilingual-en flex-1" key={key} lang="en">
          {children}
        </span>
      );
    case "BilingualItemFr":
      return (
        <span className="bilingual-fr flex-1" key={key} lang="fr">
          {children}
        </span>
      );

    case "QuotedText":
      return (
        <blockquote
          className="quoted-text my-2 border-muted border-l-4 pl-4 italic"
          key={key}
        >
          {children}
        </blockquote>
      );
    case "CenteredText":
      return (
        <p className="centered-text my-2 text-center" key={key}>
          {children}
        </p>
      );
    case "FormGroup":
      return (
        <div className="form-group my-4 rounded border p-4" key={key}>
          {children}
        </div>
      );
    case "Oath":
      return (
        <div className="oath my-4 border-primary border-l-4 pl-4" key={key}>
          {children}
        </div>
      );
    case "ReadAsText":
      return (
        <div className="read-as-text my-2 bg-muted/50 p-2" key={key}>
          {children}
        </div>
      );
    case "ScheduleFormHeading":
      return (
        <div className="schedule-form-heading my-4 font-semibold" key={key}>
          {children}
        </div>
      );
    case "Heading": {
      const level = "level" in node ? (node.level as number) : 3;
      const HeadingTag = `h${Math.min(Math.max(level + 1, 2), 6)}` as
        | "h2"
        | "h3"
        | "h4"
        | "h5"
        | "h6";
      return (
        <HeadingTag className="my-4 font-bold text-foreground" key={key}>
          {children}
        </HeadingTag>
      );
    }
    case "LeaderRightJustified":
      return (
        <span className="leader-right flex justify-between" key={key}>
          {children}
        </span>
      );

    case "MarginalNote":
      return (
        <aside
          className="marginal-note mb-2 border-amber-400 border-l-2 bg-amber-50 py-1 pr-2 pl-3 text-amber-900 text-sm dark:border-amber-600 dark:bg-amber-950/30 dark:text-amber-200"
          key={key}
        >
          <span className="font-medium">Marginal Note: </span>
          {children}
        </aside>
      );
    case "HistoricalNote":
      return (
        <aside
          className="historical-note mt-3 border-slate-300 border-l-2 bg-slate-50 py-1 pr-2 pl-3 text-slate-600 text-xs dark:border-slate-600 dark:bg-slate-900/30 dark:text-slate-400"
          key={key}
        >
          <span className="font-medium">Historical Note: </span>
          {children}
        </aside>
      );
    case "HistoricalNoteSubItem":
      return (
        <span className="historical-note-subitem" key={key}>
          {children}
        </span>
      );
    case "Footnote":
      return (
        <aside
          className="footnote mt-2 border-blue-300 border-l-2 bg-blue-50 py-1 pr-2 pl-3 text-blue-800 text-xs dark:border-blue-600 dark:bg-blue-950/30 dark:text-blue-300"
          key={key}
        >
          <span className="font-medium">
            Footnote{node.id ? ` [${node.id}]` : ""}: {""}
          </span>
          {children}
        </aside>
      );

    case "SectionPiece":
    case "AmendedText":
    case "AmendedContent":
    case "Order":
    case "Recommendation":
    case "Notice":
    case "Reserved":
      return (
        <div className="my-2" key={key}>
          {children}
        </div>
      );

    default:
      if (node.type === "Unknown" && "tag" in node) {
        if (node.tag === "AlternateText") {
          return (
            <span className="sr-only" key={key}>
              {children}
            </span>
          );
        }
        if (node.tag === "Provision") {
          const hasLabel =
            node.children?.some(
              (child) =>
                child.type === "Label" ||
                (child.type === "Unknown" &&
                  "tag" in child &&
                  child.tag === "Label")
            ) ?? false;
          return (
            <div
              className={
                hasLabel
                  ? "provision-item my-1 ml-6 flex items-baseline gap-1"
                  : "provision-block my-2"
              }
              key={key}
            >
              {children}
            </div>
          );
        }
      }
      return <React.Fragment key={key}>{children}</React.Fragment>;
  }
}
