/**
 * Crawls and downloads Acts and Regulations XML files from laws-lois.justice.gc.ca
 *
 * Downloads all XML files for Acts and Regulations in both English and French.
 * Files are organized in docs/acts/ and docs/regs/ directories with language
 * and index-based subdirectories (num/, a/, b/, etc.).
 *
 * Usage:
 *   npx tsx scripts/load-acts-and-regs.ts                    # Download all files
 *   npx tsx scripts/load-acts-and-regs.ts --dry-run          # Show what would be downloaded
 *   npx tsx scripts/load-acts-and-regs.ts --check            # Download small sample for testing
 *
 * Options:
 *   --dry-run    Show what would be downloaded without actually downloading
 *   --check      Download a small sample (1 numbered + 2 lettered from each category)
 *
 * Rate limiting: 1 request every 2 seconds (respectful to the endpoint)
 * Idempotency: Skips files that already exist with matching SHA-256 hash
 */

import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const BASE_URL = "https://laws-lois.justice.gc.ca";

// Rate limiting: 1 seconds between requests
const RATE_LIMIT_MS = 1000;

// Regex patterns for identifier validation and XML extraction
const IDENTIFIER_PATTERN = /^[A-Z0-9.-]+$/;
const FULLDOC_PATTERN = /<p\s+id=["']FullDoc["'][^>]*>[\s\S]*?<\/p>/i;
const UL_PATTERN = /<ul[^>]*>([\s\S]*?)<\/ul>/i;
const XML_LINK_PATTERN = /<a[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?XML/i;
const SOR_PREFIX_PATTERN = /^SOR-/;
const SI_PREFIX_PATTERN = /^SI-/;
const CRC_C_PREFIX_PATTERN = /^C\.R\.C\.-c-/;

// CLI args
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const checkMode = args.includes("--check");

type DownloadStats = {
  downloaded: number;
  skipped: number;
  failed: number;
  total: number;
};

type ActOrRegInfo = {
  identifier: string;
  indexType: "num" | string; // "num" or letter like "a", "b", etc.
  sourceType: "act" | "regulation";
  language: "en" | "fr";
};

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((res) => {
    setTimeout(res, ms);
  });
}

/**
 * Fetch with retry logic and exponential backoff
 */
async function fetchWithRetry(url: string, maxRetries = 3): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; LegalDocsBot/1.0;",
        },
      });

      if (response.ok) {
        return response;
      }

      if (response.status === 404) {
        throw new Error(`404 Not Found: ${url}`);
      }

      if (response.status === 429 || response.status >= 500) {
        // Rate limited or server error - retry with backoff
        const backoffMs = Math.min(1000 * 2 ** attempt, 10_000);
        if (attempt < maxRetries - 1) {
          console.warn(
            `  ⚠️  ${response.status} error, retrying in ${backoffMs}ms...`
          );
          await sleep(backoffMs);
          continue;
        }
      }

      throw new Error(`HTTP ${response.status}: ${url}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries - 1) {
        const backoffMs = Math.min(1000 * 2 ** attempt, 10_000);
        await sleep(backoffMs);
      }
    }
  }

  throw (
    lastError ?? new Error(`Failed to fetch ${url} after ${maxRetries} retries`)
  );
}

/**
 * Calculate SHA-256 hash of content
 */
function calculateHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Extract relative URLs from HTML index page
 * Looks for links like "C-1/index.html" or "SOR-86-946/index.html"
 */
function extractDetailUrls(html: string, _basePath: string): string[] {
  const urls: string[] = [];
  // Match relative URLs that look like act/regulation identifiers followed by /index.html
  // Pattern: href="IDENTIFIER/index.html" where IDENTIFIER can be C-1, SOR-86-946, etc.
  const hrefRegex = /href=["']([^"']+\/index\.html)["']/gi;
  let match: RegExpExecArray | null = null;

  match = hrefRegex.exec(html);
  while (match !== null) {
    const href = match[1];
    // Filter out absolute URLs and non-detail pages
    if (
      !href.startsWith("http") &&
      !href.startsWith("//") &&
      href.includes("/index.html")
    ) {
      // Extract the identifier part (everything before /index.html)
      const identifier = href.replace("/index.html", "");
      // Only include if it looks like a valid identifier
      if (
        identifier.match(IDENTIFIER_PATTERN) &&
        (identifier.includes("-") || identifier.startsWith("C.R.C."))
      ) {
        urls.push(href);
      }
    }
    match = hrefRegex.exec(html);
  }

  return [...new Set(urls)]; // Deduplicate
}

/**
 * Extract XML link from regulation detail page
 * Looks for <p id="FullDoc"> → sibling <ul> → second <li> → <a>XML</a>
 */
function extractXmlUrlFromDetailPage(html: string): string | null {
  // Look for the FullDoc paragraph and its sibling ul
  const fullDocMatch = html.match(FULLDOC_PATTERN);
  if (!fullDocMatch) {
    return null;
  }

  // Find the next <ul> after FullDoc
  const afterFullDoc = html.substring(
    html.indexOf(fullDocMatch[0]) + fullDocMatch[0].length
  );
  const ulMatch = afterFullDoc.match(UL_PATTERN);
  if (!ulMatch) {
    return null;
  }

  // Find all <li> elements and get the second one
  const liMatches = ulMatch[1].match(/<li[^>]*>([\s\S]*?)<\/li>/gi);
  if (!liMatches || liMatches.length < 2) {
    return null;
  }

  // Extract href from second <li> that contains "XML"
  const secondLi = liMatches[1];
  const xmlLinkMatch = secondLi.match(XML_LINK_PATTERN);
  if (xmlLinkMatch) {
    return xmlLinkMatch[1];
  }

  return null;
}

/**
 * Transform regulation identifier from English to French
 */
function transformRegulationId(id: string, toFrench: boolean): string {
  if (!toFrench) {
    return id;
  }

  // SOR-YYYY-NNN → DORS-YYYY-NNN
  if (id.startsWith("SOR-")) {
    return id.replace(SOR_PREFIX_PATTERN, "DORS-");
  }

  // SI-YYYY-NNN → TR-YYYY-NNN
  if (id.startsWith("SI-")) {
    return id.replace(SI_PREFIX_PATTERN, "TR-");
  }

  // C.R.C.-c-NNNN → C.R.C.-ch-NNNN
  if (id.startsWith("C.R.C.-c-")) {
    return id.replace(CRC_C_PREFIX_PATTERN, "C.R.C.-ch-");
  }

  return id;
}

/**
 * Get all index pages to visit
 */
function getIndexPages(
  type: "act" | "regulation",
  language: "en" | "fr"
): Array<{ url: string; indexType: "num" | string }> {
  const basePath =
    type === "act"
      ? language === "en"
        ? "/eng/acts"
        : "/fra/lois"
      : language === "en"
        ? "/eng/regulations"
        : "/fra/reglements";

  const pages: Array<{ url: string; indexType: "num" | string }> = [];

  // Only Regulations have Num.html (Acts don't have it)
  // Note: English uses Num.html (capital N), French uses num.html (lowercase n)
  if (type === "regulation") {
    const numPage = language === "en" ? "Num.html" : "num.html";
    pages.push({
      url: `${BASE_URL}${basePath}/${numPage}`,
      indexType: "num",
    });
  }

  // Add A-Z pages
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i); // A-Z
    pages.push({
      url: `${BASE_URL}${basePath}/${letter}.html`,
      indexType: letter.toLowerCase(),
    });
  }

  return pages;
}

/**
 * Extract act identifiers from index page
 */
async function extractActIdentifiers(
  indexUrl: string,
  _indexType: "num" | string
): Promise<string[]> {
  const response = await fetchWithRetry(indexUrl);
  const html = await response.text();
  const detailUrls = extractDetailUrls(html, indexUrl);

  return detailUrls.map((url) => {
    // Extract identifier from "C-1/index.html" → "C-1"
    return url.replace("/index.html", "");
  });
}

/**
 * Extract regulation identifiers from index page
 * For regulations, we need to visit detail pages to get XML URLs
 */
async function extractRegulationIdentifiers(
  indexUrl: string,
  _indexType: "num" | string
): Promise<string[]> {
  const response = await fetchWithRetry(indexUrl);
  const html = await response.text();
  const detailUrls = extractDetailUrls(html, indexUrl);

  // Extract identifiers from detail URLs
  return detailUrls.map((url) => {
    // Extract identifier from "SOR-86-946/index.html" → "SOR-86-946"
    return url.replace("/index.html", "");
  });
}

/**
 * Get XML URL for an act
 */
function getActXmlUrl(actId: string, language: "en" | "fr"): string {
  const langPath = language === "en" ? "eng" : "fra";
  return `${BASE_URL}/${langPath}/XML/${actId}.xml`;
}

/**
 * Get XML URL for a regulation
 * For regulations, we need to visit the detail page first to get the XML link
 */
async function getRegulationXmlUrl(
  regId: string,
  language: "en" | "fr"
): Promise<string | null> {
  const langPath = language === "en" ? "eng" : "fra";
  const regPath = language === "en" ? "regulations" : "reglements";

  // Transform identifier for French
  const transformedId =
    language === "fr" ? transformRegulationId(regId, true) : regId;

  const detailUrl = `${BASE_URL}/${langPath}/${regPath}/${transformedId}/index.html`;

  try {
    const response = await fetchWithRetry(detailUrl);
    const html = await response.text();
    const xmlHref = extractXmlUrlFromDetailPage(html);

    if (xmlHref) {
      // xmlHref might be relative or absolute
      if (xmlHref.startsWith("http")) {
        return xmlHref;
      }
      if (xmlHref.startsWith("/")) {
        return `${BASE_URL}${xmlHref}`;
      }
      // Relative to detail page
      return `${BASE_URL}/${langPath}/${regPath}/${xmlHref}`;
    }

    // Fallback: construct URL directly (most regulations follow the pattern)
    return `${BASE_URL}/${langPath}/XML/${transformedId}.xml`;
  } catch (error) {
    console.warn(`  ⚠️  Could not fetch detail page for ${regId}: ${error}`);
    // Fallback: construct URL directly
    return `${BASE_URL}/${langPath}/XML/${transformedId}.xml`;
  }
}

/**
 * Download XML file
 */
async function downloadXml(
  xmlUrl: string,
  filePath: string,
  stats: DownloadStats
): Promise<void> {
  if (dryRun) {
    console.log(`  [DRY RUN] Would download: ${xmlUrl} → ${filePath}`);
    stats.total++;
    return;
  }

  // Check if file exists and compare hash
  if (existsSync(filePath)) {
    try {
      const existingContent = await readFile(filePath);
      const existingStr = existingContent.toString("utf8");
      // Check if file needs normalization (has non-breaking spaces)
      const needsNormalization = existingStr.includes("\u00A0");

      // Normalize non-breaking spaces for comparison
      const existingNormalized = existingStr.replace(/\u00A0/g, "\u0020");
      const existingHash = calculateHash(existingNormalized);

      // Fetch to compare
      const response = await fetchWithRetry(xmlUrl);
      const arrayBuffer = await response.arrayBuffer();
      const newContent = Buffer.from(arrayBuffer);
      const newStr = newContent.toString("utf8");
      // Normalize non-breaking spaces for comparison
      const newNormalized = newStr.replace(/\u00A0/g, "\u0020");
      const newHash = calculateHash(newNormalized);

      if (existingHash === newHash) {
        // Content matches, but ensure file is normalized
        if (needsNormalization) {
          // File exists but isn't normalized - normalize and write it
          await mkdir(dirname(filePath), { recursive: true });
          await writeFile(filePath, Buffer.from(existingNormalized, "utf8"));
          console.log(`  ✓ Normalized existing file: ${filePath}`);
          stats.downloaded++;
        } else {
          console.log(`  ✓ Skipped (unchanged): ${filePath}`);
          stats.skipped++;
        }
        return;
      }
    } catch (error) {
      // If comparison fails, proceed with download
      console.warn(`  ⚠️  Could not compare hash, proceeding: ${error}`);
    }
  }

  try {
    const response = await fetchWithRetry(xmlUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // Get raw bytes to preserve exact content (avoid text normalization)
    const arrayBuffer = await response.arrayBuffer();
    let content = Buffer.from(arrayBuffer);

    // Normalize non-breaking spaces (U+00A0) to regular spaces (U+0020)
    // This matches browser view-source behavior for searchability
    const contentStr = content.toString("utf8");
    const normalizedStr = contentStr.replace(/\u00A0/g, "\u0020");
    content = Buffer.from(normalizedStr, "utf8");

    // Ensure directory exists
    await mkdir(dirname(filePath), { recursive: true });

    // Write file with normalized spaces
    await writeFile(filePath, content);

    console.log(`  ✓ Downloaded: ${filePath}`);
    stats.downloaded++;
  } catch (error) {
    console.error(`  ✗ Failed: ${xmlUrl} - ${error}`);
    stats.failed++;
  }
}

/**
 * Get file path for an act or regulation
 */
function getFilePath(info: ActOrRegInfo, docsRoot: string): string {
  const { identifier, indexType, sourceType, language } = info;
  const langDir = language === "en" ? "en" : "fr";
  const typeDir = sourceType === "act" ? "acts" : "regs";
  const subDir = indexType === "num" ? "num" : indexType;

  return resolve(docsRoot, typeDir, langDir, subDir, `${identifier}.xml`);
}

/**
 * Download all acts
 */
async function downloadActs(
  docsRoot: string,
  stats: DownloadStats,
  isCheckMode: boolean
): Promise<void> {
  console.log("\n📜 Downloading Acts...");

  for (const language of ["en", "fr"] as const) {
    console.log(`\n  ${language === "en" ? "English" : "French"} Acts:`);
    const indexPages = getIndexPages("act", language);

    // In check mode, only process num, a, and b
    const pagesToProcess = isCheckMode
      ? indexPages.filter((p) => ["num", "a", "b"].includes(p.indexType))
      : indexPages;

    for (const { url, indexType } of pagesToProcess) {
      console.log(`\n    Index: ${indexType.toUpperCase()} (${url})`);

      try {
        await sleep(RATE_LIMIT_MS); // Rate limit
        const actIds = await extractActIdentifiers(url, indexType);

        if (isCheckMode && indexType === "num") {
          // In check mode, only download first from num
          const idsToProcess = actIds.slice(0, 1);
          for (const actId of idsToProcess) {
            const xmlUrl = getActXmlUrl(actId, language);
            const filePath = getFilePath(
              {
                identifier: actId,
                indexType,
                sourceType: "act",
                language,
              },
              docsRoot
            );

            await sleep(RATE_LIMIT_MS);
            await downloadXml(xmlUrl, filePath, stats);
            stats.total++;
          }
        } else if (isCheckMode && ["a", "b"].includes(indexType)) {
          // In check mode, download first 2 from lettered pages
          const idsToProcess = actIds.slice(0, 2);
          for (const actId of idsToProcess) {
            const xmlUrl = getActXmlUrl(actId, language);
            const filePath = getFilePath(
              {
                identifier: actId,
                indexType,
                sourceType: "act",
                language,
              },
              docsRoot
            );

            await sleep(RATE_LIMIT_MS);
            await downloadXml(xmlUrl, filePath, stats);
            stats.total++;
          }
        } else {
          // Full mode: download all
          for (const actId of actIds) {
            const xmlUrl = getActXmlUrl(actId, language);
            const filePath = getFilePath(
              {
                identifier: actId,
                indexType,
                sourceType: "act",
                language,
              },
              docsRoot
            );

            await sleep(RATE_LIMIT_MS);
            await downloadXml(xmlUrl, filePath, stats);
            stats.total++;
          }
        }
      } catch (error) {
        console.error(`    ✗ Failed to process index page: ${error}`);
        stats.failed++;
      }
    }
  }
}

/**
 * Download all regulations
 */
async function downloadRegulations(
  docsRoot: string,
  stats: DownloadStats,
  isCheckMode: boolean
): Promise<void> {
  console.log("\n📋 Downloading Regulations...");

  for (const language of ["en", "fr"] as const) {
    console.log(`\n  ${language === "en" ? "English" : "French"} Regulations:`);
    const indexPages = getIndexPages("regulation", language);

    // In check mode, only process num, a, and b
    const pagesToProcess = isCheckMode
      ? indexPages.filter((p) => ["num", "a", "b"].includes(p.indexType))
      : indexPages;

    for (const { url, indexType } of pagesToProcess) {
      console.log(`\n    Index: ${indexType.toUpperCase()} (${url})`);

      try {
        await sleep(RATE_LIMIT_MS); // Rate limit
        const regIds = await extractRegulationIdentifiers(url, indexType);

        if (isCheckMode && indexType === "num") {
          // In check mode, only download first from num
          const idsToProcess = regIds.slice(0, 1);
          for (const regId of idsToProcess) {
            await sleep(RATE_LIMIT_MS);
            const xmlUrl = await getRegulationXmlUrl(regId, language);
            if (!xmlUrl) {
              console.warn(`    ⚠️  Could not determine XML URL for ${regId}`);
              stats.failed++;
              continue;
            }

            const filePath = getFilePath(
              {
                identifier:
                  language === "fr"
                    ? transformRegulationId(regId, true)
                    : regId,
                indexType,
                sourceType: "regulation",
                language,
              },
              docsRoot
            );

            await sleep(RATE_LIMIT_MS);
            await downloadXml(xmlUrl, filePath, stats);
            stats.total++;
          }
        } else if (isCheckMode && ["a", "b"].includes(indexType)) {
          // In check mode, download first 2 from lettered pages
          const idsToProcess = regIds.slice(0, 2);
          for (const regId of idsToProcess) {
            await sleep(RATE_LIMIT_MS);
            const xmlUrl = await getRegulationXmlUrl(regId, language);
            if (!xmlUrl) {
              console.warn(`    ⚠️  Could not determine XML URL for ${regId}`);
              stats.failed++;
              continue;
            }

            const filePath = getFilePath(
              {
                identifier:
                  language === "fr"
                    ? transformRegulationId(regId, true)
                    : regId,
                indexType,
                sourceType: "regulation",
                language,
              },
              docsRoot
            );

            await sleep(RATE_LIMIT_MS);
            await downloadXml(xmlUrl, filePath, stats);
            stats.total++;
          }
        } else {
          // Full mode: download all
          for (const regId of regIds) {
            await sleep(RATE_LIMIT_MS);
            const xmlUrl = await getRegulationXmlUrl(regId, language);
            if (!xmlUrl) {
              console.warn(`    ⚠️  Could not determine XML URL for ${regId}`);
              stats.failed++;
              continue;
            }

            const filePath = getFilePath(
              {
                identifier:
                  language === "fr"
                    ? transformRegulationId(regId, true)
                    : regId,
                indexType,
                sourceType: "regulation",
                language,
              },
              docsRoot
            );

            await sleep(RATE_LIMIT_MS);
            await downloadXml(xmlUrl, filePath, stats);
            stats.total++;
          }
        }
      } catch (error) {
        console.error(`    ✗ Failed to process index page: ${error}`);
        stats.failed++;
      }
    }
  }
}

/**
 * Main function
 */
async function main(): Promise<void> {
  const docsRoot = resolve(process.cwd(), "docs");

  const stats: DownloadStats = {
    downloaded: 0,
    skipped: 0,
    failed: 0,
    total: 0,
  };

  console.log("🏛️  Acts & Regulations XML Crawler");
  console.log("===================================\n");

  if (dryRun) {
    console.log("🔍 DRY RUN MODE - No files will be downloaded\n");
  }

  if (checkMode) {
    console.log(
      "🧪 CHECK MODE - Downloading sample files (1 numbered + 2 lettered from each category)\n"
    );
  }

  console.log(`Output directory: ${docsRoot}\n`);

  try {
    await downloadActs(docsRoot, stats, checkMode);
    await downloadRegulations(docsRoot, stats, checkMode);

    console.log(`\n${"=".repeat(50)}`);
    console.log("📊 Summary");
    console.log("=".repeat(50));
    console.log(`Total processed: ${stats.total}`);
    console.log(`Downloaded: ${stats.downloaded}`);
    console.log(`Skipped (unchanged): ${stats.skipped}`);
    console.log(`Failed: ${stats.failed}`);

    if (stats.failed > 0) {
      console.log(
        "\n⚠️  Some downloads failed. Check the logs above for details."
      );
      process.exitCode = 1;
    } else {
      console.log("\n✓ All downloads completed successfully!");
    }
  } catch (error) {
    console.error("\n❌ Fatal error:", error);
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("load-acts-and-regs.ts")) {
  main();
}
