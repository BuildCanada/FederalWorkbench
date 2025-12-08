/**
 * Utilities for legislation embedding generation
 *
 * Contains shared types, configuration, progress tracking, and helper functions
 * used by acts.ts and regulations.ts processors.
 */

import { existsSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import Database from "better-sqlite3";
import { eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { nanoid } from "nanoid";

import { generateEmbeddings } from "@/lib/ai/embeddings";
import type { Section } from "@/lib/db/legislation/schema";
import type { LegResourceMetadata, LegSourceType } from "@/lib/db/rag/schema";
import {
  DEFAULT_EMBEDDING_MODEL,
  legEmbeddings,
  legResources,
} from "@/lib/db/rag/schema";

// Re-export LegSourceType for use by other modules in this directory
export type { LegSourceType } from "@/lib/db/rag/schema";

import { normalizeForEmbedding } from "@/lib/rag/shared/chunking";

// ---------- Configuration Constants ----------
export const EMBEDDING_BATCH_SIZE = 50;
export const EMBEDDING_RETRY_ATTEMPTS = 3;
export const PROGRESS_LOG_INTERVAL = 100;
export const DB_FETCH_BATCH_SIZE = 1000;
export const PROGRESS_DB_PATH = "scripts/.leg-embedding-progress.db";
export const PROGRESS_SYNC_BATCH_SIZE = 10_000;
export const EMBEDDING_DIMENSIONS = 1024; // Cohere embed-multilingual-v3.0

const POSTGRES_URL_REGEX = /^postgres(ql)?:\/\/.+/;

// ---------- Section Grouping ----------
/**
 * Group sections by a parent ID field (actId or regulationId) and language for O(1) lookup.
 * Assumes sections are already sorted by sectionOrder from SQL query.
 */
export function groupSectionsBy(
  allSections: Section[],
  idField: "actId" | "regulationId"
): Map<string, Section[]> {
  const grouped = new Map<string, Section[]>();
  for (const section of allSections) {
    const parentId = section[idField];
    if (!parentId) {
      continue;
    }
    const key = `${parentId}:${section.language}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.push(section);
    } else {
      grouped.set(key, [section]);
    }
  }
  return grouped;
}

/**
 * Memory Usage Note:
 *
 * This script loads all acts/regulations and their sections into memory before
 * processing. For ~280k chunks at ~2-3KB each, expect ~500MB-1GB memory usage.
 *
 * A streaming approach would reduce memory but would complicate:
 * - Progress tracking (need to check existence before generating)
 * - Batch embedding (need to accumulate chunks for API efficiency)
 * - Error recovery (need to track partial progress)
 *
 * Current trade-off: Higher memory usage for simpler, more reliable processing.
 * If memory becomes an issue, consider processing acts and regulations in
 * separate runs using --acts-only and --regs-only flags.
 */

// ---------- Types ----------
export type ChunkData = {
  content: string;
  chunkIndex: number;
  totalChunks: number;
  metadata: LegResourceMetadata;
  resourceKey: string;
};

export type ProcessOptions = {
  db: PostgresJsDatabase;
  progressTracker: ProgressTracker;
  limit?: number;
  dryRun: boolean;
  skipExisting: boolean;
};

export type ProcessResult = {
  chunksProcessed: number;
  chunksSkipped: number;
  itemsProcessed: number;
  errors: ProcessError[];
};

export type ProcessError = {
  itemType:
    | "act"
    | "regulation"
    | "section"
    | "term"
    | "preamble"
    | "treaty"
    | "cross_reference"
    | "table_of_provisions"
    | "signature_block"
    | "related_provisions"
    | "footnote"
    | "marginal_note";
  itemId: string;
  message: string;
  retryable: boolean;
};

// ---------- SQLite Progress Tracker ----------
/**
 * Uses a local SQLite database for fast existence checks instead of slow Postgres JSONB queries.
 * This provides ~100-1000x faster lookups for skip-existing logic.
 */
export class ProgressTracker {
  private readonly sqlite: Database.Database;
  private readonly checkStmt: Database.Statement;
  private readonly insertStmt: Database.Statement;
  private readonly insertManyStmt: Database.Transaction<
    (keys: string[]) => void
  >;
  // Cached statements for better performance
  private readonly countByPrefixStmt: Database.Statement;
  private readonly clearByPrefixStmt: Database.Statement;
  private readonly totalCountStmt: Database.Statement;
  private readonly sampleKeysStmt: Database.Statement;
  // Cache for hasMany() statements by placeholder count
  private readonly hasManyStmtCache: Map<number, Database.Statement>;

  constructor(dbPath: string = PROGRESS_DB_PATH) {
    // Support :memory: for tests
    if (dbPath !== ":memory:") {
      const dir = dbPath.split("/").slice(0, -1).join("/");
      if (dir && !existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }

    this.sqlite = new Database(dbPath);
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("synchronous = NORMAL");

    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS processed (
        key TEXT PRIMARY KEY,
        created_at INTEGER DEFAULT (unixepoch())
      ) WITHOUT ROWID;
    `);

    // Cache all prepared statements for performance
    this.checkStmt = this.sqlite.prepare(
      "SELECT 1 FROM processed WHERE key = ?"
    );
    this.insertStmt = this.sqlite.prepare(
      "INSERT OR IGNORE INTO processed (key) VALUES (?)"
    );
    this.countByPrefixStmt = this.sqlite.prepare(
      "SELECT COUNT(*) as count FROM processed WHERE key LIKE ?"
    );
    this.clearByPrefixStmt = this.sqlite.prepare(
      "DELETE FROM processed WHERE key LIKE ?"
    );
    this.totalCountStmt = this.sqlite.prepare(
      "SELECT COUNT(*) as count FROM processed"
    );
    this.sampleKeysStmt = this.sqlite.prepare(
      "SELECT key FROM processed WHERE key LIKE ? LIMIT ?"
    );
    this.insertManyStmt = this.sqlite.transaction((keys: string[]) => {
      for (const key of keys) {
        this.insertStmt.run(key);
      }
    });

    // Initialize statement cache for hasMany batches
    this.hasManyStmtCache = new Map();
  }

  /**
   * Get or create a prepared statement for hasMany() with given placeholder count.
   */
  private getHasManyStmt(count: number): Database.Statement {
    let stmt = this.hasManyStmtCache.get(count);
    if (!stmt) {
      const placeholders = new Array(count).fill("?").join(",");
      stmt = this.sqlite.prepare(
        `SELECT key FROM processed WHERE key IN (${placeholders})`
      );
      this.hasManyStmtCache.set(count, stmt);
    }
    return stmt;
  }

  has(key: string): boolean {
    return this.checkStmt.get(key) !== undefined;
  }

  /**
   * Batch check for multiple keys. Returns a Set of keys that exist.
   * Uses batched IN queries for efficiency (SQLite limit is 999 params).
   * Caches prepared statements by batch size for better performance.
   */
  hasMany(keys: string[]): Set<string> {
    if (keys.length === 0) {
      return new Set();
    }

    const existing = new Set<string>();
    const BATCH_SIZE = 500; // Stay well under SQLite's 999 param limit

    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
      const batch = keys.slice(i, i + BATCH_SIZE);
      const stmt = this.getHasManyStmt(batch.length);
      const rows = stmt.all(...batch) as { key: string }[];
      for (const row of rows) {
        existing.add(row.key);
      }
    }

    return existing;
  }

  mark(key: string): void {
    this.insertStmt.run(key);
  }

  markMany(keys: string[]): void {
    if (keys.length > 0) {
      this.insertManyStmt(keys);
    }
  }

  countByPrefix(prefix: string): number {
    const result = this.countByPrefixStmt.get(`${prefix}%`) as {
      count: number;
    };
    return result.count;
  }

  clearByPrefix(prefix: string): number {
    const result = this.clearByPrefixStmt.run(`${prefix}%`);
    return result.changes;
  }

  clearAll(): void {
    this.sqlite.exec("DELETE FROM processed");
  }

  totalCount(): number {
    const result = this.totalCountStmt.get() as { count: number };
    return result.count;
  }

  sampleKeys(prefix: string, maxResults = 5): string[] {
    const rows = this.sampleKeysStmt.all(`${prefix}%`, maxResults) as {
      key: string;
    }[];
    return rows.map((r) => r.key);
  }

  close(): void {
    this.sqlite.close();
  }
}

// ---------- Security Validation ----------
/**
 * Validates that an embedding is a valid array of finite numbers.
 * Prevents SQL injection through malformed API responses.
 */
export function validateEmbedding(
  embedding: unknown,
  expectedDimensions = EMBEDDING_DIMENSIONS
): embedding is number[] {
  if (!Array.isArray(embedding)) {
    return false;
  }
  if (embedding.length !== expectedDimensions) {
    return false;
  }
  return embedding.every(
    (val) => typeof val === "number" && Number.isFinite(val)
  );
}

/**
 * Validates required environment variables are set.
 * @param dryRun - If true, only warn about missing COHERE_API_KEY instead of throwing
 */
export function validateEnvironment(dryRun = false): void {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!dbUrl || dbUrl.trim().length === 0) {
    throw new Error(
      "DATABASE_URL or POSTGRES_URL environment variable is required"
    );
  }

  if (!POSTGRES_URL_REGEX.test(dbUrl)) {
    throw new Error(
      "Invalid DATABASE_URL format: must start with postgresql:// or postgres://"
    );
  }

  const cohereKey = process.env.COHERE_API_KEY;
  if (!cohereKey || cohereKey.trim().length === 0) {
    if (dryRun) {
      console.warn("⚠️  COHERE_API_KEY not set (OK for --dry-run mode)");
    } else {
      throw new Error(
        "COHERE_API_KEY environment variable is required for embedding generation. " +
          "Use --dry-run to test without generating embeddings."
      );
    }
  }
}

/**
 * Validates language code is "en" or "fr".
 * Returns null for invalid languages to allow graceful skipping.
 */
export function validateLanguage(lang: string): "en" | "fr" | null {
  if (lang !== "en" && lang !== "fr") {
    return null;
  }
  return lang;
}

// ---------- CLI Helpers ----------
export function readOptValue(args: string[], name: string): string | undefined {
  const withEq = args.find((a) => a.startsWith(`--${name}=`));
  if (withEq) {
    return withEq.split("=")[1];
  }
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && idx + 1 < args.length) {
    const val = args[idx + 1];
    if (!val.startsWith("-")) {
      return val;
    }
  }
  return;
}

export function parsePositiveInteger(
  value: string | undefined,
  paramName: string
): number | undefined {
  if (!value) {
    return;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    throw new Error(`Invalid ${paramName}: "${value}" is not a valid number`);
  }

  if (parsed < 1) {
    throw new Error(`Invalid ${paramName}: must be positive (got ${parsed})`);
  }

  const MAX_LIMIT = 1_000_000;
  if (parsed > MAX_LIMIT) {
    throw new Error(
      `Invalid ${paramName}: maximum value is ${MAX_LIMIT} (got ${parsed})`
    );
  }

  return parsed;
}

export function promptConfirmation(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} (Y/n): `, (answer) => {
      rl.close();
      resolve(answer.trim().toUpperCase() === "Y");
    });
  });
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

export function logProgress(
  current: number,
  total: number,
  label: string
): void {
  if (
    current === 1 ||
    current === total ||
    current % PROGRESS_LOG_INTERVAL === 0
  ) {
    const pct = Math.round((current / total) * 100);
    console.log(`   📊 ${label}: ${current}/${total} (${pct}%)`);
  }
}

// ---------- Resource Key Builder ----------
export function buildResourceKey(
  sourceType: string,
  sourceId: string,
  language: string,
  chunkIndex: number
): string {
  return `${sourceType}:${sourceId}:${language}:${chunkIndex}`;
}

/**
 * Build paired resource key for bilingual linking (Task 2.3).
 * Returns the resource key for the same content in the opposite language.
 * Enables cross-lingual search - users searching in EN can discover FR matches.
 */
export function buildPairedResourceKey(
  sourceType: string,
  sourceId: string,
  language: "en" | "fr",
  chunkIndex: number
): string {
  const pairedLanguage = language === "en" ? "fr" : "en";
  return `${sourceType}:${sourceId}:${pairedLanguage}:${chunkIndex}`;
}

// ---------- Embedding Generation ----------
export async function generateEmbeddingsWithRetry(
  contents: string[],
  maxRetries = EMBEDDING_RETRY_ATTEMPTS
): Promise<number[][]> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Pass 0 to disable AI SDK's internal retries - we handle retries here with exponential backoff
      return await generateEmbeddings(contents, 0);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(
        `   ⚠️  Embedding attempt ${attempt}/${maxRetries} failed: ${lastError.message}`
      );
      if (attempt < maxRetries) {
        const delay = 1000 * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(
    `Embedding generation failed after ${maxRetries} attempts: ${lastError?.message}`
  );
}

// ---------- Batch Insertion ----------
export type InsertBatchedOptions = {
  db: PostgresJsDatabase;
  chunks: ChunkData[];
  progressTracker: ProgressTracker;
  label: string;
  dryRun: boolean;
};

/**
 * Insert chunks in batches with progress logging.
 * Each batch is wrapped in a transaction for atomicity.
 */
export async function insertChunksBatched(
  options: InsertBatchedOptions
): Promise<number> {
  const { db, chunks, progressTracker, label, dryRun } = options;
  if (chunks.length === 0) {
    console.log(`   📦 No new chunks to embed for ${label}`);
    return 0;
  }

  if (dryRun) {
    console.log(
      `   [DRY RUN] Would embed ${chunks.length} chunks for ${label}`
    );
    return 0;
  }

  let inserted = 0;
  const totalBatches = Math.ceil(chunks.length / EMBEDDING_BATCH_SIZE);

  for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
    const batchNum = Math.floor(i / EMBEDDING_BATCH_SIZE) + 1;

    console.log(
      `   📦 Embedding batch ${batchNum}/${totalBatches} (${batch.length} chunks)...`
    );

    // Normalize content for embedding consistency
    // This ensures stored content matches what was used to generate the embedding
    const normalizedContents = batch.map((c) =>
      normalizeForEmbedding(c.content)
    );

    const vectors = await generateEmbeddingsWithRetry(normalizedContents);

    // Validate embeddings before insertion (security fix)
    for (let j = 0; j < vectors.length; j++) {
      if (!validateEmbedding(vectors[j])) {
        throw new Error(
          `Invalid embedding at index ${j}: expected ${EMBEDDING_DIMENSIONS}-dimensional number array`
        );
      }
    }

    // Check for existing resourceKeys to prevent duplicates on restart
    // This handles the case where Postgres insert succeeded but SQLite update failed
    const batchKeys = batch.map((c) => c.resourceKey);
    const existingRows = await db
      .select({ resourceKey: legResources.resourceKey })
      .from(legResources)
      .where(inArray(legResources.resourceKey, batchKeys));
    const existingSet = new Set(existingRows.map((r) => r.resourceKey));

    // Filter to only new chunks
    const newChunksWithIndex = batch
      .map((chunk, idx) => ({ chunk, idx }))
      .filter(({ chunk }) => !existingSet.has(chunk.resourceKey));

    if (newChunksWithIndex.length === 0) {
      console.log(
        `   ⏭️  Batch ${batchNum} already exists in database, skipping`
      );
      // Still mark as processed in SQLite to stay in sync
      progressTracker.markMany(batchKeys);
      continue;
    }

    if (newChunksWithIndex.length < batch.length) {
      console.log(
        `   ⚠️  Batch ${batchNum}: ${batch.length - newChunksWithIndex.length} already exist, inserting ${newChunksWithIndex.length}`
      );
    }

    await db.transaction(async (tx) => {
      // Prepare resource IDs upfront for correlation
      const resourceIds = newChunksWithIndex.map(() => nanoid());

      // Batch insert all resources at once (much faster than sequential)
      // Use normalized content to match what was embedded
      await tx.insert(legResources).values(
        newChunksWithIndex.map(({ chunk, idx }, j) => ({
          id: resourceIds[j],
          resourceKey: chunk.resourceKey,
          content: normalizedContents[idx],
          metadata: {
            ...chunk.metadata,
            // Add embedding model version to metadata (Task 3.3)
            embeddingModelVersion: DEFAULT_EMBEDDING_MODEL,
          },
          // Denormalized columns for fast filtering
          language: chunk.metadata.language,
          sourceType: chunk.metadata.sourceType,
          // Bilingual pairing (Task 2.3)
          pairedResourceKey: chunk.metadata.pairedResourceKey ?? null,
        }))
      );

      // Batch insert all embeddings at once
      // Use normalized content to match what was embedded
      await tx.insert(legEmbeddings).values(
        newChunksWithIndex.map(({ chunk, idx }, j) => ({
          id: nanoid(),
          resourceId: resourceIds[j],
          content: normalizedContents[idx],
          embedding: vectors[idx],
          tsv: sql`to_tsvector('simple', ${normalizedContents[idx]})`,
          chunkIndex: chunk.chunkIndex,
          totalChunks: chunk.totalChunks,
          // Embedding model tracking (Task 3.3)
          embeddingModel: DEFAULT_EMBEDDING_MODEL,
        }))
      );
    });

    // Mark as processed in SQLite after successful Postgres insert
    progressTracker.markMany(batchKeys);

    inserted += newChunksWithIndex.length;
  }

  return inserted;
}

/**
 * Filter chunks that haven't been processed yet using SQLite progress tracker.
 * Uses batch lookup for efficiency (O(n/500) queries instead of O(n)).
 */
export function filterNewChunks(
  chunks: ChunkData[],
  progressTracker: ProgressTracker,
  skipExisting: boolean
): { newChunks: ChunkData[]; skipped: number } {
  if (!skipExisting) {
    return { newChunks: chunks, skipped: 0 };
  }

  // Batch lookup all keys at once (much faster than individual lookups)
  const allKeys = chunks.map((ch) => ch.resourceKey);
  const existingKeys = progressTracker.hasMany(allKeys);

  const newChunks: ChunkData[] = [];
  let skipped = 0;

  for (const ch of chunks) {
    if (existingKeys.has(ch.resourceKey)) {
      skipped++;
    } else {
      newChunks.push(ch);
    }
  }

  if (chunks.length > 0) {
    console.log(
      `   🔍 Filter: ${skipped} skipped, ${newChunks.length} new (of ${chunks.length} total)`
    );
  }

  return { newChunks, skipped };
}

// ---------- Progress Sync ----------
/**
 * Sync progress tracker from Postgres for a specific source type.
 * Useful for first-time setup or if SQLite was cleared.
 */
export async function syncProgressFromPostgres(
  db: PostgresJsDatabase,
  progressTracker: ProgressTracker,
  sourceType?: LegSourceType
): Promise<void> {
  // Use denormalized sourceType column for fast filtering (avoids JSONB extraction)
  const whereClause = sourceType
    ? sql`WHERE ${legResources.sourceType} = ${sourceType}`
    : sql``;

  const countResult = await db.execute<{ count: string }>(
    sql`SELECT COUNT(*) as count FROM ${legResources} ${whereClause}`
  );
  const totalCount = Number.parseInt(countResult[0]?.count ?? "0", 10);

  if (totalCount === 0) {
    console.log(
      `   No existing records found${sourceType ? ` for ${sourceType}` : ""}`
    );
    return;
  }

  console.log(
    `   📥 Syncing ${totalCount.toLocaleString()} records from Postgres...`
  );

  let synced = 0;
  let offset = 0;

  while (offset < totalCount) {
    const rows = await db
      .select({ resourceKey: legResources.resourceKey })
      .from(legResources)
      .where(sourceType ? eq(legResources.sourceType, sourceType) : sql`1=1`)
      .orderBy(legResources.id)
      .limit(PROGRESS_SYNC_BATCH_SIZE)
      .offset(offset);

    const keys = rows.map((r) => r.resourceKey);
    progressTracker.markMany(keys);
    synced += keys.length;
    offset += PROGRESS_SYNC_BATCH_SIZE;

    const pct = Math.round((synced / totalCount) * 100);
    console.log(
      `   📊 Synced ${synced.toLocaleString()}/${totalCount.toLocaleString()} (${pct}%)`
    );
  }

  console.log(`   ✅ Sync complete: ${synced.toLocaleString()} records`);
}

/**
 * Ensure progress tracker has data synced from Postgres if needed.
 */
export async function ensureProgressSynced(
  db: PostgresJsDatabase,
  progressTracker: ProgressTracker,
  sourceType: LegSourceType
): Promise<void> {
  const localCount = progressTracker.countByPrefix(`${sourceType}:`);

  // Use denormalized sourceType column for fast filtering (avoids JSONB extraction)
  const pgCountResult = await db.execute<{ count: string }>(
    sql`SELECT COUNT(*) as count FROM ${legResources} WHERE ${legResources.sourceType} = ${sourceType}`
  );
  const pgCount = Number.parseInt(pgCountResult[0]?.count ?? "0", 10);

  if (pgCount === 0) {
    console.log(
      `   📋 No existing records in database (local cache: ${localCount.toLocaleString()})`
    );
    return;
  }

  const syncThreshold = Math.floor(pgCount * 0.95);
  if (localCount >= syncThreshold) {
    console.log(
      `   📋 Local cache: ${localCount.toLocaleString()} / Postgres: ${pgCount.toLocaleString()} - in sync`
    );
    return;
  }

  console.log(
    `   ⚠️  Local cache: ${localCount.toLocaleString()} / Postgres: ${pgCount.toLocaleString()} - syncing missing records...`
  );
  await syncProgressFromPostgres(db, progressTracker, sourceType);

  const newLocalCount = progressTracker.countByPrefix(`${sourceType}:`);
  console.log(
    `   ✅ Sync complete: ${newLocalCount.toLocaleString()} items now cached`
  );
}
