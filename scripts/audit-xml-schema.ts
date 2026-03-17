/**
 * XML Schema Audit Tool
 *
 * Analyzes XML legislation files to inventory ALL elements and attributes,
 * helping identify gaps between XML data and database schema.
 *
 * Usage:
 *   npx tsx scripts/audit-xml-schema.ts [options]
 *
 * Options:
 *   --limit=N      Analyze only N files per category
 *   --output=FILE  Write results to JSON file
 *   --verbose      Show detailed element paths
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";

const BASE_PATH = "./data/legislation";

// Parse command line arguments
const args = process.argv.slice(2);
const limit = args.find((a) => a.startsWith("--limit="))?.split("=")[1];
const outputFile = args.find((a) => a.startsWith("--output="))?.split("=")[1];
const verbose = args.includes("--verbose");

// Configure XML parser to preserve all attributes
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  preserveOrder: false,
  trimValues: false, // Keep all whitespace
  parseAttributeValue: false,
  parseTagValue: false,
});

type ElementInfo = {
  count: number;
  attributes: Map<string, Set<string>>; // attr name -> set of sample values
  hasText: boolean;
  children: Set<string>;
  paths: Set<string>; // Full paths where this element appears
};

type AuditResult = {
  elements: Map<string, ElementInfo>;
  rootElements: Set<string>;
  totalFiles: number;
  errors: string[];
};

function log(message: string) {
  console.log(`[audit] ${message}`);
}

function logVerbose(message: string) {
  if (verbose) {
    console.log(`  ${message}`);
  }
}

/**
 * Recursively traverse XML object and collect element/attribute info
 */
function traverseXml(
  obj: unknown,
  result: AuditResult,
  currentPath = "",
  parentElement = ""
): void {
  if (!obj || typeof obj !== "object") {
    return;
  }

  const record = obj as Record<string, unknown>;

  for (const [key, value] of Object.entries(record)) {
    // Skip text nodes and attributes at this level
    if (key === "#text") {
      continue;
    }
    if (key.startsWith("@_")) {
      continue;
    }

    const fullPath = currentPath ? `${currentPath}/${key}` : key;

    // Get or create element info
    if (!result.elements.has(key)) {
      result.elements.set(key, {
        count: 0,
        attributes: new Map(),
        hasText: false,
        children: new Set(),
        paths: new Set(),
      });
    }
    const elementInfo = result.elements.get(key);
    if (!elementInfo) {
      continue;
    }

    // Handle arrays (multiple instances of same element)
    const items = Array.isArray(value) ? value : [value];

    for (const item of items) {
      elementInfo.count++;
      elementInfo.paths.add(fullPath);

      // Add as child of parent
      if (parentElement) {
        const parentInfo = result.elements.get(parentElement);
        if (parentInfo) {
          parentInfo.children.add(key);
        }
      }

      if (!item || typeof item !== "object") {
        // Primitive value means this element has text content
        elementInfo.hasText = true;
        continue;
      }

      const itemRecord = item as Record<string, unknown>;

      // Collect attributes
      for (const [attrKey, attrValue] of Object.entries(itemRecord)) {
        if (attrKey.startsWith("@_")) {
          const attrName = attrKey.slice(2); // Remove @_ prefix
          if (!elementInfo.attributes.has(attrName)) {
            elementInfo.attributes.set(attrName, new Set());
          }
          // Store sample values (limit to 5)
          const attrValues = elementInfo.attributes.get(attrName);
          if (attrValues && attrValues.size < 5) {
            attrValues.add(String(attrValue).substring(0, 100));
          }
        } else if (attrKey === "#text") {
          elementInfo.hasText = true;
        }
      }

      // Recurse into children
      traverseXml(itemRecord, result, fullPath, key);
    }
  }
}

/**
 * Analyze a single XML file
 */
function analyzeFile(filePath: string, result: AuditResult): void {
  try {
    const content = readFileSync(filePath, "utf-8");
    const parsed = parser.parse(content);

    // Track root elements
    for (const key of Object.keys(parsed)) {
      if (!key.startsWith("?")) {
        // Skip XML declaration
        result.rootElements.add(key);
      }
    }

    traverseXml(parsed, result);
    result.totalFiles++;
  } catch (error) {
    result.errors.push(
      `${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get list of test fixture files
 */
function getTestFiles(): { path: string; type: string; lang: string }[] {
  const files: { path: string; type: string; lang: string }[] = [];

  // Acts
  const actIds = ["A-1", "A-0.6"];
  for (const id of actIds) {
    files.push({
      path: `${BASE_PATH}/eng/acts/${id}.xml`,
      type: "act",
      lang: "en",
    });
    files.push({
      path: `${BASE_PATH}/fra/lois/${id}.xml`,
      type: "act",
      lang: "fr",
    });
  }

  // Regulations
  const regFilesEn = ["C.R.C.,_c._10", "SOR-2000-1"];
  const regFilesFr = ["C.R.C.,_ch._10", "DORS-2000-1"];
  for (let i = 0; i < regFilesEn.length; i++) {
    files.push({
      path: `${BASE_PATH}/eng/regulations/${regFilesEn[i]}.xml`,
      type: "regulation",
      lang: "en",
    });
    files.push({
      path: `${BASE_PATH}/fra/reglements/${regFilesFr[i]}.xml`,
      type: "regulation",
      lang: "fr",
    });
  }

  return files.filter((f) => existsSync(f.path));
}

/**
 * Format audit results for display
 */
function formatResults(result: AuditResult): string {
  const lines: string[] = [];

  lines.push("=".repeat(80));
  lines.push("XML SCHEMA AUDIT REPORT");
  lines.push("=".repeat(80));
  lines.push(`Files analyzed: ${result.totalFiles}`);
  lines.push(`Errors: ${result.errors.length}`);
  lines.push(`Root elements: ${Array.from(result.rootElements).join(", ")}`);
  lines.push(`Unique elements: ${result.elements.size}`);
  lines.push("");

  // Sort elements by count (descending)
  const sortedElements = Array.from(result.elements.entries()).sort(
    (a, b) => b[1].count - a[1].count
  );

  lines.push("-".repeat(80));
  lines.push("ELEMENTS AND ATTRIBUTES");
  lines.push("-".repeat(80));

  for (const [elementName, info] of sortedElements) {
    lines.push("");
    lines.push(`<${elementName}> (count: ${info.count})`);

    if (info.hasText) {
      lines.push("  [has text content]");
    }

    if (info.attributes.size > 0) {
      lines.push("  Attributes:");
      for (const [attrName, values] of info.attributes.entries()) {
        const sampleValues = Array.from(values).slice(0, 3).join(", ");
        lines.push(
          `    @${attrName}: ${sampleValues}${values.size > 3 ? "..." : ""}`
        );
      }
    }

    if (info.children.size > 0 && verbose) {
      lines.push(`  Children: ${Array.from(info.children).join(", ")}`);
    }

    if (verbose && info.paths.size > 0) {
      lines.push(
        `  Paths: ${Array.from(info.paths).slice(0, 3).join(", ")}${info.paths.size > 3 ? "..." : ""}`
      );
    }
  }

  if (result.errors.length > 0) {
    lines.push("");
    lines.push("-".repeat(80));
    lines.push("ERRORS");
    lines.push("-".repeat(80));
    for (const error of result.errors) {
      lines.push(`  ${error}`);
    }
  }

  return lines.join("\n");
}

/**
 * Generate JSON summary
 */
function toJsonSummary(result: AuditResult): object {
  const elements: Record<
    string,
    {
      count: number;
      hasText: boolean;
      attributes: Record<string, string[]>;
      children: string[];
    }
  > = {};

  for (const [name, info] of result.elements.entries()) {
    const attrs: Record<string, string[]> = {};
    for (const [attrName, values] of info.attributes.entries()) {
      attrs[attrName] = Array.from(values);
    }
    elements[name] = {
      count: info.count,
      hasText: info.hasText,
      attributes: attrs,
      children: Array.from(info.children),
    };
  }

  return {
    totalFiles: result.totalFiles,
    rootElements: Array.from(result.rootElements),
    uniqueElements: result.elements.size,
    elements,
    errors: result.errors,
  };
}

function main() {
  log("Starting XML schema audit...");

  const result: AuditResult = {
    elements: new Map(),
    rootElements: new Set(),
    totalFiles: 0,
    errors: [],
  };

  // Get test fixture files
  const files = getTestFiles();
  const maxFiles = limit ? Number.parseInt(limit, 10) : files.length;

  log(`Found ${files.length} test fixture files (analyzing ${maxFiles})`);

  for (let i = 0; i < Math.min(maxFiles, files.length); i++) {
    const file = files[i];
    logVerbose(`Analyzing: ${file.path}`);
    analyzeFile(file.path, result);
  }

  // Output results
  const report = formatResults(result);
  console.log(`\n${report}`);

  // Write JSON if requested
  if (outputFile) {
    const json = toJsonSummary(result);
    writeFileSync(outputFile, JSON.stringify(json, null, 2));
    log(`\nJSON output written to: ${outputFile}`);
  }

  log("\nAudit complete.");
}

try {
  main();
} catch (error) {
  console.error("Fatal error:", error);
  process.exit(1);
}
