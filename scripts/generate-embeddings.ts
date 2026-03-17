/**
 * Generate parlEmbeddings for Parliament data (bilingual)
 *
 * Supports multiple source types: bills, hansard statements, committees,
 * committee reports/meetings, vote questions, party/member votes, politicians,
 * parties, elections, candidacies, sessions, ridings.
 *
 * Usage examples:
 *   npx tsx scripts/generate-parlEmbeddings.ts --types=bills --session 45-1 --skip-existing
 *   npx tsx scripts/generate-parlEmbeddings.ts --types=bills,hansard --limit 100
 *   npx tsx scripts/generate-parlEmbeddings.ts --drop-tables
 *   npx tsx scripts/generate-parlEmbeddings.ts --empty-tables
 *   npx tsx scripts/generate-parlEmbeddings.ts --sync-progress  # Rebuild SQLite from Postgres
 *   npx tsx scripts/generate-parlEmbeddings.ts --clear-progress # Clear local progress tracking
 */

import { config } from "dotenv";

config({ path: ".env.local" });

import { existsSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import Database from "better-sqlite3";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { nanoid } from "nanoid";
import postgres from "postgres";

import { generateEmbeddings } from "@/lib/ai/embeddings";
import {
  type BillsBill,
  billsBill,
  billsBilltext,
  billsMembervote,
  billsPartyvote,
  billsVotequestion,
  committeesCommittee,
  committeesCommitteemeeting,
  committeesCommitteereport,
  coreParty,
  corePolitician,
  coreRiding,
  coreSession,
  electionsCandidacy,
  electionsElection,
  hansardsDocument,
  hansardsStatement,
} from "@/lib/db/parliament/schema";
import {
  parlEmbeddings,
  parlResources,
  type ResourceMetadata,
} from "@/lib/db/rag/schema";
import {
  type BillContext,
  chunkBill,
  chunkHansard,
  type HansardContext,
} from "@/lib/rag/parliament/semantic-chunking";

// ---------- CLI args ----------
const args = process.argv.slice(2);

function readOptValue(name: string): string | undefined {
  // Supports both --name=value and --name value
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

const limitStr = readOptValue("limit");
const sessionFilter = readOptValue("session");
const typesStr = readOptValue("types");
const skipExisting = args.includes("--skip-existing");
const dropTables = args.includes("--drop-tables");
const emptyTables = args.includes("--empty-tables");
const syncProgress = args.includes("--sync-progress");
const clearProgress = args.includes("--clear-progress");

const limit = limitStr ? Number.parseInt(limitStr, 10) : undefined;
const types = (typesStr ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const ALL_TYPES = [
  "bills",
  "hansard",
  "committees",
  "committee_reports",
  "committee_meetings",
  "vote_questions",
  "party_votes",
  "member_votes",
  "politicians",
  "parties",
  "elections",
  "candidacies",
  "sessions",
  "ridings",
] as const;
type SourceTypeKey = (typeof ALL_TYPES)[number];

const selectedTypes: SourceTypeKey[] = types.length
  ? (types.filter((t) =>
      (ALL_TYPES as readonly string[]).includes(t)
    ) as SourceTypeKey[])
  : ALL_TYPES.slice();

// ---------- DB setup ----------
const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!dbUrl) {
  throw new Error(
    "DATABASE_URL or POSTGRES_URL environment variable is required"
  );
}
const connection = postgres(dbUrl);
const db = drizzle(connection);

// ---------- Configuration Constants ----------
const EMBEDDING_RETRY_ATTEMPTS = 3;
const EMBEDDING_BATCH_SIZE = 50;
const PROGRESS_LOG_INTERVAL = 10;
const DB_FETCH_BATCH_SIZE = 1000; // Fetch from DB in batches to avoid OOM
const PROGRESS_DB_PATH = "scripts/.embedding-progress.db";
const PROGRESS_SYNC_BATCH_SIZE = 10_000; // Batch size when syncing from Postgres

// ---------- SQLite Progress Tracker ----------
// Uses a local SQLite database for fast existence checks instead of slow Postgres JSONB queries
class ProgressTracker {
  private readonly sqlite: Database.Database;
  private readonly checkStmt: Database.Statement;
  private readonly insertStmt: Database.Statement;
  private readonly insertManyStmt: Database.Transaction<
    (keys: string[]) => void
  >;

  constructor() {
    // Ensure scripts directory exists
    const dir = PROGRESS_DB_PATH.split("/").slice(0, -1).join("/");
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.sqlite = new Database(PROGRESS_DB_PATH);
    this.sqlite.pragma("journal_mode = WAL"); // Better concurrent performance
    this.sqlite.pragma("synchronous = NORMAL"); // Good balance of safety/speed

    // Create table with index
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS processed (
        key TEXT PRIMARY KEY,
        created_at INTEGER DEFAULT (unixepoch())
      ) WITHOUT ROWID;
    `);

    // Prepare statements for reuse (much faster)
    this.checkStmt = this.sqlite.prepare(
      "SELECT 1 FROM processed WHERE key = ?"
    );
    this.insertStmt = this.sqlite.prepare(
      "INSERT OR IGNORE INTO processed (key) VALUES (?)"
    );

    // Transaction for bulk inserts (much faster than individual inserts)
    this.insertManyStmt = this.sqlite.transaction((keys: string[]) => {
      for (const key of keys) {
        this.insertStmt.run(key);
      }
    });
  }

  /** Check if a key has been processed */
  has(key: string): boolean {
    return this.checkStmt.get(key) !== undefined;
  }

  /** Mark a key as processed */
  mark(key: string): void {
    this.insertStmt.run(key);
  }

  /** Mark multiple keys as processed (uses transaction for speed) */
  markMany(keys: string[]): void {
    if (keys.length > 0) {
      this.insertManyStmt(keys);
    }
  }

  /** Get count of processed items for a source type prefix */
  countByPrefix(prefix: string): number {
    const stmt = this.sqlite.prepare(
      "SELECT COUNT(*) as count FROM processed WHERE key LIKE ?"
    );
    const result = stmt.get(`${prefix}%`) as { count: number };
    return result.count;
  }

  /** Clear all progress for a specific source type */
  clearByPrefix(prefix: string): number {
    const stmt = this.sqlite.prepare("DELETE FROM processed WHERE key LIKE ?");
    const result = stmt.run(`${prefix}%`);
    return result.changes;
  }

  /** Clear all progress */
  clearAll(): void {
    this.sqlite.exec("DELETE FROM processed");
  }

  /** Get total count */
  totalCount(): number {
    const stmt = this.sqlite.prepare("SELECT COUNT(*) as count FROM processed");
    const result = stmt.get() as { count: number };
    return result.count;
  }

  /** Get sample keys for debugging */
  sampleKeys(prefix: string, maxResults = 5): string[] {
    const stmt = this.sqlite.prepare(
      "SELECT key FROM processed WHERE key LIKE ? LIMIT ?"
    );
    const rows = stmt.all(`${prefix}%`, maxResults) as { key: string }[];
    return rows.map((r) => r.key);
  }

  close(): void {
    this.sqlite.close();
  }
}

// Initialize progress tracker
const progressTracker = new ProgressTracker();

/**
 * Sync progress tracker from Postgres for a specific source type.
 * This is useful for first-time setup or if SQLite was cleared.
 */
async function syncProgressFromPostgres(
  sourceType?: ResourceMetadata["sourceType"]
): Promise<void> {
  const whereClause = sourceType
    ? sql`WHERE ${parlResources.metadata}->>'sourceType' = ${sourceType}`
    : sql``;

  // Get total count first
  const countResult = await db.execute<{ count: string }>(
    sql`SELECT COUNT(*) as count FROM ${parlResources} ${whereClause}`
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
      .select({ metadata: parlResources.metadata })
      .from(parlResources)
      .where(
        sourceType
          ? sql`${parlResources.metadata}->>'sourceType' = ${sourceType}`
          : sql`1=1`
      )
      .orderBy(parlResources.id) // Required for deterministic pagination
      .limit(PROGRESS_SYNC_BATCH_SIZE)
      .offset(offset);

    const keys = rows.map((r) =>
      buildResourceKey(r.metadata as ResourceMetadata)
    );
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
 * Clear progress and optionally sync fresh from Postgres
 */
async function clearProgressWithConfirmation(): Promise<void> {
  const count = progressTracker.totalCount();
  console.log("\n⚠️  WARNING: CLEAR PROGRESS OPERATION\n");
  console.log(
    `This will clear ${count.toLocaleString()} tracked items from the local SQLite database.`
  );
  console.log(`File: ${PROGRESS_DB_PATH}\n`);

  const confirmed = await promptConfirmation(
    "Are you sure you want to clear progress? Type Y to continue"
  );
  if (!confirmed) {
    console.log("\n❌ Operation cancelled by user\n");
    return;
  }

  progressTracker.clearAll();
  console.log("\n✅ Progress cleared\n");
}

// Small cached lookups for cross-linking
const sessionMapPromise = (async () => {
  const rows = await db.select().from(coreSession);
  const m = new Map<
    string,
    {
      name: string | null;
      parliamentnum: number | null;
      sessnum: number | null;
    }
  >();
  for (const s of rows) {
    m.set(s.id, {
      name: s.name ?? null,
      parliamentnum: s.parliamentnum ?? null,
      sessnum: s.sessnum ?? null,
    });
  }
  return m;
})();

const billNumberMapPromise = (async () => {
  const rows = sessionFilter
    ? await db
        .select({ id: billsBill.id, number: billsBill.number })
        .from(billsBill)
        .where(eq(billsBill.sessionId, sessionFilter))
    : await db
        .select({ id: billsBill.id, number: billsBill.number })
        .from(billsBill);
  const m = new Map<number, string>();
  for (const r of rows) {
    m.set(r.id, r.number);
  }
  return m;
})();

// ---------- Utilities ----------
function promptConfirmation(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} (Y/n): `, (answer) => {
      rl.close();
      resolve(answer.trim().toUpperCase() === "Y");
    });
  });
}

async function dropTablesWithConfirmation(): Promise<void> {
  console.log("\n⚠️  WARNING: DROP TABLES OPERATION\n");
  console.log("This will permanently delete the following tables:");
  console.log("  • parlEmbeddings (all vector parlEmbeddings)");
  console.log("  • parlResources (all resource metadata)\n");
  console.log("⚠️  This action CANNOT be undone!\n");
  const confirmed = await promptConfirmation(
    "Are you sure you want to drop these tables? Type Y to continue"
  );
  if (!confirmed) {
    console.log("\n❌ Operation cancelled by user\n");
    process.exit(0);
  }
  console.log("\n🗑️  Dropping tables...");
  await db.execute(sql`DROP TABLE IF EXISTS parlEmbeddings CASCADE`);
  console.log("   ✅ Dropped parlEmbeddings table");
  await db.execute(sql`DROP TABLE IF EXISTS parlResources CASCADE`);
  console.log("   ✅ Dropped parlResources table");
  console.log("\n✨ Tables dropped successfully\n");
}

async function emptyTablesWithConfirmation(): Promise<void> {
  console.log("\n⚠️  WARNING: EMPTY TABLES OPERATION\n");
  console.log("This will delete all data from the following tables:");
  console.log("  • parlEmbeddings (all vector parlEmbeddings)");
  console.log("  • parlResources (all resource metadata)\n");
  console.log("The table structure will remain intact.");
  console.log("\n⚠️  This action CANNOT be undone!\n");
  const confirmed = await promptConfirmation(
    "Are you sure you want to empty these tables? Type Y to continue"
  );
  if (!confirmed) {
    console.log("\n❌ Operation cancelled by user\n");
    process.exit(0);
  }
  console.log("\n🧹 Emptying tables...");
  await db.execute(sql`TRUNCATE TABLE parlEmbeddings CASCADE`);
  console.log("   ✅ Emptied parlEmbeddings table");
  await db.execute(sql`TRUNCATE TABLE parlResources CASCADE`);
  console.log("   ✅ Emptied parlResources table");
  console.log("\n✨ Tables emptied successfully\n");
}

type ChunkInput = { content: string; metadata: ResourceMetadata };

/**
 * Build a unique key for a resource based on its metadata
 */
function buildResourceKey(meta: ResourceMetadata): string {
  return `${meta.sourceType}:${meta.sourceId}:${meta.language}:${meta.chunkIndex ?? 0}`;
}

/**
 * Check if progress tracker has any data for a source type.
 * If local cache is missing records that exist in Postgres, sync them.
 */
async function ensureProgressSynced(
  sourceType: ResourceMetadata["sourceType"]
): Promise<void> {
  const localCount = progressTracker.countByPrefix(`${sourceType}:`);

  // Always check Postgres count to ensure we're not missing records
  const pgCountResult = await db.execute<{ count: string }>(
    sql`SELECT COUNT(*) as count FROM ${parlResources} WHERE ${parlResources.metadata}->>'sourceType' = ${sourceType}`
  );
  const pgCount = Number.parseInt(pgCountResult[0]?.count ?? "0", 10);

  if (pgCount === 0) {
    console.log(
      `   📋 No existing records in database (local cache: ${localCount.toLocaleString()})`
    );
    return;
  }

  // If local cache has significantly fewer records than Postgres, re-sync
  // Use 95% threshold to account for potential race conditions
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
  await syncProgressFromPostgres(sourceType);

  const newLocalCount = progressTracker.countByPrefix(`${sourceType}:`);
  console.log(
    `   ✅ Sync complete: ${newLocalCount.toLocaleString()} items now cached`
  );
}

/**
 * Generate parlEmbeddings with retry logic and error handling
 */
async function generateEmbeddingsWithRetry(
  contents: string[],
  maxRetries = EMBEDDING_RETRY_ATTEMPTS
): Promise<number[][]> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await generateEmbeddings(contents, maxRetries);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(
        `   ⚠️  Embedding attempt ${attempt}/${maxRetries} failed: ${lastError.message}`
      );
      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s...
        const delay = 1000 * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(
    `Embedding generation failed after ${maxRetries} attempts: ${lastError?.message}`
  );
}

/**
 * Insert chunks in batches with progress logging
 */
async function insertChunksBatched(
  chunks: ChunkInput[],
  label: string
): Promise<number> {
  if (chunks.length === 0) {
    console.log(`   📦 No new chunks to embed for ${label}`);
    return 0;
  }

  let inserted = 0;

  // Process in batches to avoid memory issues with large embedding requests
  const totalBatches = Math.ceil(chunks.length / EMBEDDING_BATCH_SIZE);
  for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
    const batchNum = Math.floor(i / EMBEDDING_BATCH_SIZE) + 1;

    console.log(
      `   📦 Embedding batch ${batchNum}/${totalBatches} (${batch.length} chunks)...`
    );

    // Generate parlEmbeddings for batch
    const vectors = await generateEmbeddingsWithRetry(
      batch.map((c) => c.content)
    );

    // Insert in a single transaction per batch
    await db.transaction(async (tx) => {
      const resourceIds: string[] = [];
      for (const ch of batch) {
        const id = nanoid();
        resourceIds.push(id);
        await tx.insert(parlResources).values({
          id,
          content: ch.content,
          metadata: ch.metadata,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      for (let j = 0; j < vectors.length; j++) {
        const content = batch[j].content;
        await tx.insert(parlEmbeddings).values({
          id: nanoid(),
          resourceId: resourceIds[j],
          content,
          embedding: vectors[j],
          // Generate tsvector for hybrid keyword search
          // Uses 'simple' config for language-neutral tokenization (EN/FR)
          tsv: sql`to_tsvector('simple', ${content})`,
        });
      }
    });

    // Mark as processed in SQLite (after successful Postgres insert)
    const processedKeys = batch.map((ch) => buildResourceKey(ch.metadata));
    progressTracker.markMany(processedKeys);

    inserted += batch.length;
  }

  return inserted;
}

/**
 * Filter chunks that haven't been processed yet (using SQLite progress tracker)
 */
function filterNewChunks(chunks: ChunkInput[]): ChunkInput[] {
  if (!skipExisting) {
    return chunks; // Process everything if not skipping
  }

  const newChunks: ChunkInput[] = [];
  let skipped = 0;

  for (const ch of chunks) {
    const key = buildResourceKey(ch.metadata);
    if (progressTracker.has(key)) {
      skipped++;
    } else {
      newChunks.push(ch);
    }
  }

  // Debug: show filtering stats
  if (chunks.length > 0) {
    console.log(
      `   🔍 Filter: ${skipped} skipped, ${newChunks.length} new (of ${chunks.length} total)`
    );
    // Show sample keys for debugging
    if (skipped === 0 && chunks.length > 0) {
      const sourceType = chunks[0].metadata.sourceType;
      const sampleKey = buildResourceKey(chunks[0].metadata);
      const cachedCount = progressTracker.countByPrefix(`${sourceType}:`);
      const cachedSamples = progressTracker.sampleKeys(`${sourceType}:`, 3);
      console.log(`   ⚠️  No items skipped! Chunk key: "${sampleKey}"`);
      console.log(
        `   ⚠️  Cached ${sourceType}: ${cachedCount} items. Samples: ${cachedSamples.join(", ") || "(none)"}`
      );
    }
    // Show sample of "new" items when some were skipped but not all
    if (newChunks.length > 0 && skipped > 0) {
      const sampleNew = newChunks
        .slice(0, 3)
        .map((ch) => buildResourceKey(ch.metadata));
      console.log(`   📝 Sample NEW keys: ${sampleNew.join(", ")}`);
    }
  }

  return newChunks;
}

/**
 * Log progress for long-running operations
 * Always logs first item, last item, and every PROGRESS_LOG_INTERVAL items
 */
function logProgress(current: number, total: number, label: string): void {
  if (
    current === 1 ||
    current === total ||
    current % PROGRESS_LOG_INTERVAL === 0
  ) {
    const pct = Math.round((current / total) * 100);
    console.log(`   📊 ${label}: ${current}/${total} (${pct}%)`);
  }
}

// ---------- Content builders ----------
function billMetadataText(bill: BillsBill, lang: "en" | "fr"): string {
  const parts: string[] = [];
  const date = (d?: Date | null) =>
    d ? d.toISOString().slice(0, 10) : undefined;
  const inst =
    bill.institution === "C"
      ? lang === "fr"
        ? "Chambre des communes"
        : "House of Commons"
      : lang === "fr"
        ? "Sénat"
        : "Senate";
  if (lang === "fr") {
    parts.push(`Projet de loi ${bill.number}`);
    parts.push(`Session: ${bill.sessionId}`);
    if (bill.nameFr) {
      parts.push(`Titre: ${bill.nameFr}`);
    }
    if (bill.shortTitleFr) {
      parts.push(`Titre abrégé: ${bill.shortTitleFr}`);
    }
    if (bill.statusCode) {
      parts.push(`Statut: ${bill.statusCode}`);
    }
    if (bill.introduced) {
      parts.push(`Présenté: ${date(bill.introduced)}`);
    }
    if (bill.statusDate) {
      parts.push(`Date du statut: ${date(bill.statusDate)}`);
    }
    parts.push(`Institution: ${inst}`);
    if (bill.privatemember !== null) {
      parts.push(
        `Type: ${bill.privatemember ? "Projet de loi d’initiative parlementaire" : "Projet de loi du gouvernement"}`
      );
    }
    if (bill.law !== null) {
      parts.push(`Devenu loi: ${bill.law ? "Oui" : "Non"}`);
    }
  } else {
    parts.push(`Bill ${bill.number}`);
    parts.push(`Session: ${bill.sessionId}`);
    if (bill.nameEn) {
      parts.push(`Title: ${bill.nameEn}`);
    }
    if (bill.shortTitleEn) {
      parts.push(`Short Title: ${bill.shortTitleEn}`);
    }
    if (bill.statusCode) {
      parts.push(`Status: ${bill.statusCode}`);
    }
    if (bill.introduced) {
      parts.push(`Introduced: ${date(bill.introduced)}`);
    }
    if (bill.statusDate) {
      parts.push(`Status Date: ${date(bill.statusDate)}`);
    }
    parts.push(`Institution: ${inst}`);
    if (bill.privatemember !== null) {
      parts.push(
        `Type: ${bill.privatemember ? "Private Member's Bill" : "Government Bill"}`
      );
    }
    if (bill.law !== null) {
      parts.push(`Law: ${bill.law ? "Yes" : "No"}`);
    }
  }
  return parts.join("\n");
}

// ---------- Processors ----------
async function processBills(): Promise<void> {
  console.log("• Bills");
  if (skipExisting) {
    await ensureProgressSynced("bill");
  }

  const query = db
    .select({ bill: billsBill, billtext: billsBilltext })
    .from(billsBill)
    .leftJoin(billsBilltext, eq(billsBill.id, billsBilltext.billId))
    .orderBy(billsBill.number);
  const rows = sessionFilter
    ? await query
        .where(eq(billsBill.sessionId, sessionFilter))
        .limit(limit ?? Number.MAX_SAFE_INTEGER)
    : await (limit ? query.limit(limit) : query);
  console.log(`   Found ${rows.length} bills`);

  const allChunks: ChunkInput[] = [];
  let i = 0;
  for (const row of rows) {
    const bill = row.bill;
    const bt = row.billtext;
    i++;
    logProgress(i, rows.length, "Bills");

    // Metadata chunks (EN + FR)
    const sessInfo = (await sessionMapPromise).get(bill.sessionId);
    const baseMetadata = {
      sourceType: "bill" as const,
      sourceId: bill.id,
      sessionId: bill.sessionId,
      billNumber: bill.number,
      billStatusCode: bill.statusCode || undefined,
      billIntroduced: bill.introduced
        ? bill.introduced.toISOString().slice(0, 10)
        : undefined,
      billStatusDate: bill.statusDate
        ? bill.statusDate.toISOString().slice(0, 10)
        : undefined,
      institution: (bill.institution as "C" | "S") ?? undefined,
      privateMember: bill.privatemember ?? undefined,
      law: bill.law ?? undefined,
      sessionName: sessInfo?.name ?? undefined,
      parliamentnum: (sessInfo?.parliamentnum ?? undefined) as
        | number
        | undefined,
      sessnum: (sessInfo?.sessnum ?? undefined) as number | undefined,
    };

    allChunks.push({
      content: billMetadataText(bill, "en"),
      metadata: {
        ...baseMetadata,
        language: "en",
        billTitle: bill.nameEn || undefined,
        nameEn: bill.nameEn || undefined,
        chunkIndex: 0,
      },
    });
    allChunks.push({
      content: billMetadataText(bill, "fr"),
      metadata: {
        ...baseMetadata,
        language: "fr",
        billTitle: bill.nameFr || undefined,
        nameFr: bill.nameFr || undefined,
        chunkIndex: 0,
      },
    });

    // Text chunks by language using semantic chunking
    const billContext: BillContext = {
      number: bill.number,
      nameEn: bill.nameEn || undefined,
      nameFr: bill.nameFr || undefined,
      sessionId: bill.sessionId,
    };

    if (bt?.textEn?.trim()) {
      const textChunks = chunkBill(bt.textEn, billContext, "en");
      for (const ch of textChunks) {
        allChunks.push({
          content: ch.content,
          metadata: {
            ...baseMetadata,
            language: "en",
            billTitle: bill.nameEn || undefined,
            nameEn: bill.nameEn || undefined,
            chunkIndex: ch.index,
            // Store section info if available
            ...(ch.section ? { billSection: ch.section } : {}),
          },
        });
      }
    }
    if (bt?.textFr?.trim()) {
      const textChunks = chunkBill(bt.textFr, billContext, "fr");
      for (const ch of textChunks) {
        allChunks.push({
          content: ch.content,
          metadata: {
            ...baseMetadata,
            language: "fr",
            billTitle: bill.nameFr || undefined,
            nameFr: bill.nameFr || undefined,
            chunkIndex: ch.index,
            ...(ch.section ? { billSection: ch.section } : {}),
          },
        });
      }
    }
  }

  const newChunks = filterNewChunks(allChunks);
  const created = await insertChunksBatched(newChunks, "bills");
  console.log(
    `   ↳ inserted ${created} chunks for bills (${allChunks.length - newChunks.length} skipped)`
  );
}

async function processHansard(): Promise<void> {
  console.log("• Hansard statements");
  if (skipExisting) {
    await ensureProgressSynced("hansard");
  }

  // Get total count first
  const countQuery = sessionFilter
    ? db
        .select({ count: sql<number>`count(*)::int` })
        .from(hansardsStatement)
        .innerJoin(
          hansardsDocument,
          eq(hansardsStatement.documentId, hansardsDocument.id)
        )
        .where(eq(hansardsDocument.sessionId, sessionFilter))
    : db.select({ count: sql<number>`count(*)::int` }).from(hansardsStatement);
  const [{ count: totalCount }] = await countQuery;
  const effectiveTotal = limit ? Math.min(limit, totalCount) : totalCount;
  console.log(`   Found ${effectiveTotal} statements (fetching in batches)`);

  let totalInserted = 0;
  let totalSkipped = 0;
  let processed = 0;

  // Process in batches to avoid OOM
  for (let offset = 0; offset < effectiveTotal; offset += DB_FETCH_BATCH_SIZE) {
    const batchLimit = Math.min(DB_FETCH_BATCH_SIZE, effectiveTotal - offset);
    const batchNum = Math.floor(offset / DB_FETCH_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(effectiveTotal / DB_FETCH_BATCH_SIZE);
    console.log(
      `   📥 Fetching DB batch ${batchNum}/${totalBatches} (offset ${offset})...`
    );

    const baseQuery = db
      .select({ st: hansardsStatement, doc: hansardsDocument })
      .from(hansardsStatement)
      .innerJoin(
        hansardsDocument,
        eq(hansardsStatement.documentId, hansardsDocument.id)
      )
      .orderBy(hansardsStatement.id)
      .limit(batchLimit)
      .offset(offset);

    const rows = sessionFilter
      ? await baseQuery.where(eq(hansardsDocument.sessionId, sessionFilter))
      : await baseQuery;

    const batchChunks: ChunkInput[] = [];
    for (const row of rows) {
      const st = row.st;
      const doc = row.doc;
      processed++;
      logProgress(processed, effectiveTotal, "Hansard");

      const headerEn = [st.h1En, st.h2En, st.h3En].filter(Boolean).join(" – ");
      const headerFr = [st.h1Fr, st.h2Fr, st.h3Fr].filter(Boolean).join(" – ");
      const dateIso = st.time?.toISOString();

      const baseMeta = {
        sourceType: "hansard" as const,
        sourceId: st.id,
        documentId: st.documentId,
        sessionId: doc.sessionId,
        date: dateIso?.slice(0, 10),
        statementId: st.id,
        politicianId: st.politicianId ?? undefined,
        speakerNameEn: st.whoEn || undefined,
        speakerNameFr: st.whoFr || undefined,
        nameEn: headerEn || undefined,
        nameFr: headerFr || undefined,
        docNumber: doc.number || undefined,
      };

      // EN content using semantic chunking
      if (st.contentEn?.trim()) {
        const hansardContext: HansardContext = {
          speakerName: st.whoEn || undefined,
          date: dateIso?.slice(0, 10),
          documentNumber: doc.number?.toString(),
        };
        const textChunks = chunkHansard(st.contentEn, hansardContext, "en");
        for (const ch of textChunks) {
          batchChunks.push({
            content: ch.content,
            metadata: { ...baseMeta, language: "en", chunkIndex: ch.index },
          });
        }
      }
      // FR content using semantic chunking
      if (st.contentFr?.trim()) {
        const hansardContext: HansardContext = {
          speakerName: st.whoFr || undefined,
          date: dateIso?.slice(0, 10),
          documentNumber: doc.number?.toString(),
        };
        const textChunks = chunkHansard(st.contentFr, hansardContext, "fr");
        for (const ch of textChunks) {
          batchChunks.push({
            content: ch.content,
            metadata: { ...baseMeta, language: "fr", chunkIndex: ch.index },
          });
        }
      }
    }

    // Filter and insert this batch immediately to free memory
    const newChunks = filterNewChunks(batchChunks);
    const inserted = await insertChunksBatched(newChunks, "hansard");
    totalInserted += inserted;
    totalSkipped += batchChunks.length - newChunks.length;
    // Progress tracking is now handled in insertChunksBatched via SQLite
  }

  console.log(
    `   ↳ inserted ${totalInserted} chunks for hansard (${totalSkipped} skipped)`
  );
}

async function processCommittees(): Promise<void> {
  console.log("• Committees");
  if (skipExisting) {
    await ensureProgressSynced("committee");
  }

  const rows = await (limit
    ? db.select().from(committeesCommittee).limit(limit)
    : db.select().from(committeesCommittee));
  console.log(`   Found ${rows.length} committees`);

  const allChunks: ChunkInput[] = [];
  let i = 0;
  for (const c of rows) {
    i++;
    logProgress(i, rows.length, "Committees");

    const baseMeta = {
      sourceType: "committee" as const,
      sourceId: c.id,
      committeeId: c.id,
      committeeSlug: c.slug,
      chunkIndex: 0,
      committeeNameEn: c.nameEn,
      committeeNameFr: c.nameFr,
      nameEn: c.nameEn,
      nameFr: c.nameFr,
    };

    allChunks.push({
      content: [
        `Committee: ${c.nameEn}`,
        c.shortNameEn && `Short: ${c.shortNameEn}`,
        `Slug: ${c.slug}`,
        `Joint: ${c.joint ? "Yes" : "No"}`,
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: { ...baseMeta, language: "en", title: c.nameEn },
    });

    allChunks.push({
      content: [
        `Comité: ${c.nameFr}`,
        c.shortNameFr && `Abrégé: ${c.shortNameFr}`,
        `Identifiant: ${c.slug}`,
        `Mixte: ${c.joint ? "Oui" : "Non"}`,
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: { ...baseMeta, language: "fr", title: c.nameFr },
    });
  }

  const newChunks = filterNewChunks(allChunks);
  const created = await insertChunksBatched(newChunks, "committees");
  console.log(
    `   ↳ inserted ${created} chunks for committees (${allChunks.length - newChunks.length} skipped)`
  );
}

async function processCommitteeReports(): Promise<void> {
  console.log("• Committee reports");
  if (skipExisting) {
    await ensureProgressSynced("committee_report");
  }

  const base = db.select().from(committeesCommitteereport);
  const rows = sessionFilter
    ? await (limit
        ? base
            .where(eq(committeesCommitteereport.sessionId, sessionFilter))
            .limit(limit)
        : base.where(eq(committeesCommitteereport.sessionId, sessionFilter)))
    : await (limit ? base.limit(limit) : base);
  console.log(`   Found ${rows.length} committee reports`);

  const allChunks: ChunkInput[] = [];
  let i = 0;
  for (const r of rows) {
    i++;
    logProgress(i, rows.length, "Committee reports");

    const baseMeta = {
      sourceType: "committee_report" as const,
      sourceId: r.id,
      committeeId: r.committeeId ?? undefined,
      sessionId: r.sessionId ?? undefined,
      chunkIndex: 0,
    };

    allChunks.push({
      content: [
        `Committee Report: ${r.nameEn}`,
        r.number != null ? `Number: ${r.number}` : undefined,
        r.sessionId ? `Session: ${r.sessionId}` : undefined,
        r.adoptedDate
          ? `Adopted: ${r.adoptedDate.toISOString().slice(0, 10)}`
          : undefined,
        r.presentedDate
          ? `Presented: ${r.presentedDate.toISOString().slice(0, 10)}`
          : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: { ...baseMeta, language: "en", title: r.nameEn },
    });

    allChunks.push({
      content: [
        `Rapport de comité: ${r.nameFr}`,
        r.number != null ? `Numéro: ${r.number}` : undefined,
        r.sessionId ? `Session: ${r.sessionId}` : undefined,
        r.adoptedDate
          ? `Adopté: ${r.adoptedDate.toISOString().slice(0, 10)}`
          : undefined,
        r.presentedDate
          ? `Présenté: ${r.presentedDate.toISOString().slice(0, 10)}`
          : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: { ...baseMeta, language: "fr", title: r.nameFr },
    });
  }

  const newChunks = filterNewChunks(allChunks);
  const created = await insertChunksBatched(newChunks, "committee_reports");
  console.log(
    `   ↳ inserted ${created} chunks for committee reports (${allChunks.length - newChunks.length} skipped)`
  );
}

async function processCommitteeMeetings(): Promise<void> {
  console.log("• Committee meetings");
  if (skipExisting) {
    await ensureProgressSynced("committee_meeting");
  }

  const base = db.select().from(committeesCommitteemeeting);
  const rows = sessionFilter
    ? await (limit
        ? base
            .where(eq(committeesCommitteemeeting.sessionId, sessionFilter))
            .limit(limit)
        : base.where(eq(committeesCommitteemeeting.sessionId, sessionFilter)))
    : await (limit ? base.limit(limit) : base);
  console.log(`   Found ${rows.length} committee meetings`);

  const allChunks: ChunkInput[] = [];
  let i = 0;
  for (const m of rows) {
    i++;
    logProgress(i, rows.length, "Committee meetings");

    const d = m.date?.toISOString().slice(0, 10);
    const baseMeta = {
      sourceType: "committee_meeting" as const,
      sourceId: m.id,
      sessionId: m.sessionId,
      chunkIndex: 0,
      date: d,
    };

    allChunks.push({
      content: [
        `Committee Meeting #${m.number}`,
        d ? `Date: ${d}` : undefined,
        m.sessionId ? `Session: ${m.sessionId}` : undefined,
        `Webcast: ${m.webcast ? "Yes" : "No"}`,
        `Televised: ${m.televised ? "Yes" : "No"}`,
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: { ...baseMeta, language: "en" },
    });

    allChunks.push({
      content: [
        `Réunion du comité n° ${m.number}`,
        d ? `Date: ${d}` : undefined,
        m.sessionId ? `Session: ${m.sessionId}` : undefined,
        `Diffusé sur le Web: ${m.webcast ? "Oui" : "Non"}`,
        `Télévisé: ${m.televised ? "Oui" : "Non"}`,
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: { ...baseMeta, language: "fr" },
    });
  }

  const newChunks = filterNewChunks(allChunks);
  const created = await insertChunksBatched(newChunks, "committee_meetings");
  console.log(
    `   ↳ inserted ${created} chunks for committee meetings (${allChunks.length - newChunks.length} skipped)`
  );
}

async function processVoteQuestions(): Promise<void> {
  console.log("• Vote questions");
  if (skipExisting) {
    await ensureProgressSynced("vote_question");
  }

  const base = db
    .select()
    .from(billsVotequestion)
    .orderBy(billsVotequestion.id);
  const rows = sessionFilter
    ? await base
        .where(eq(billsVotequestion.sessionId, sessionFilter))
        .limit(limit ?? Number.MAX_SAFE_INTEGER)
    : await (limit ? base.limit(limit) : base);
  console.log(`   Found ${rows.length} vote questions`);

  const allChunks: ChunkInput[] = [];
  const billNumMap = await billNumberMapPromise;
  let i = 0;
  for (const vq of rows) {
    i++;
    logProgress(i, rows.length, "Vote questions");

    const dateIso = vq.date?.toISOString().slice(0, 10);
    const billNum = vq.billId ? billNumMap.get(vq.billId) : undefined;
    const baseMeta = {
      sourceType: "vote_question" as const,
      sourceId: vq.id,
      sessionId: vq.sessionId,
      voteQuestionId: vq.id,
      voteNumber: vq.number,
      billId: vq.billId ?? undefined,
      billNumber: billNum ?? undefined,
      chunkIndex: 0,
      date: dateIso,
      result: vq.result,
    };

    allChunks.push({
      content: [
        `Vote Question #${vq.number}`,
        vq.descriptionEn && `Description: ${vq.descriptionEn}`,
        dateIso && `Date: ${dateIso}`,
        vq.result && `Result: ${vq.result}`,
        `Yea: ${vq.yeaTotal}  Nay: ${vq.nayTotal}  Paired: ${vq.pairedTotal}`,
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: {
        ...baseMeta,
        language: "en",
        title: vq.descriptionEn || undefined,
      },
    });

    allChunks.push({
      content: [
        `Question de vote n° ${vq.number}`,
        vq.descriptionFr && `Description: ${vq.descriptionFr}`,
        dateIso && `Date: ${dateIso}`,
        vq.result && `Résultat: ${vq.result}`,
        `Pour: ${vq.yeaTotal}  Contre: ${vq.nayTotal}  Jumelés: ${vq.pairedTotal}`,
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: {
        ...baseMeta,
        language: "fr",
        title: vq.descriptionFr || undefined,
      },
    });
  }

  const newChunks = filterNewChunks(allChunks);
  const created = await insertChunksBatched(newChunks, "vote_questions");
  console.log(
    `   ↳ inserted ${created} chunks for vote questions (${allChunks.length - newChunks.length} skipped)`
  );
}

async function processPartyVotes(): Promise<void> {
  console.log("• Party votes");
  if (skipExisting) {
    await ensureProgressSynced("vote_party");
  }

  // Load vote questions and parties for lookup
  const [votes, questions, parties] = await Promise.all([
    limit
      ? db.select().from(billsPartyvote).limit(limit)
      : db.select().from(billsPartyvote),
    db.select().from(billsVotequestion),
    db.select().from(coreParty),
  ]);
  console.log(`   Found ${votes.length} party votes`);

  const qById = new Map(questions.map((q) => [q.id, q] as const));
  const pById = new Map(parties.map((p) => [p.id, p] as const));
  const allChunks: ChunkInput[] = [];
  let i = 0;
  for (const v of votes) {
    i++;
    logProgress(i, votes.length, "Party votes");

    const q = qById.get(v.votequestionId);
    const p = pById.get(v.partyId);
    if (!q || !p) {
      continue;
    }

    const dateIso = q.date?.toISOString().slice(0, 10);
    const baseMeta = {
      sourceType: "vote_party" as const,
      sourceId: v.id,
      sessionId: q.sessionId,
      voteQuestionId: q.id,
      voteNumber: q.number,
      partyId: p.id,
      partyNameEn: p.nameEn,
      partyNameFr: p.nameFr,
      partyShortEn: p.shortNameEn || undefined,
      partyShortFr: p.shortNameFr || undefined,
      chunkIndex: 0,
      date: dateIso,
      result: v.vote,
    };

    allChunks.push({
      content: [
        `Party vote: ${p.nameEn} (${p.shortNameEn})`,
        `Vote: ${v.vote}`,
        `Question #${q.number}`,
        q.descriptionEn && `Description: ${q.descriptionEn}`,
        dateIso && `Date: ${dateIso}`,
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: { ...baseMeta, language: "en" },
    });

    allChunks.push({
      content: [
        `Vote du parti: ${p.nameFr} (${p.shortNameFr})`,
        `Vote: ${v.vote}`,
        `Question n° ${q.number}`,
        q.descriptionFr && `Description: ${q.descriptionFr}`,
        dateIso && `Date: ${dateIso}`,
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: { ...baseMeta, language: "fr" },
    });
  }

  const newChunks = filterNewChunks(allChunks);
  const created = await insertChunksBatched(newChunks, "party_votes");
  console.log(
    `   ↳ inserted ${created} chunks for party votes (${allChunks.length - newChunks.length} skipped)`
  );
}

async function processMemberVotes(): Promise<void> {
  console.log("• Member votes");
  if (skipExisting) {
    await ensureProgressSynced("vote_member");
  }

  // Load vote questions and politicians for lookup
  const [votes, questions, pols] = await Promise.all([
    limit
      ? db.select().from(billsMembervote).limit(limit)
      : db.select().from(billsMembervote),
    db.select().from(billsVotequestion),
    db.select().from(corePolitician),
  ]);
  console.log(`   Found ${votes.length} member votes`);

  const qById = new Map(questions.map((q) => [q.id, q] as const));
  const pById = new Map(pols.map((p) => [p.id, p] as const));
  const allChunks: ChunkInput[] = [];
  let i = 0;
  for (const v of votes) {
    i++;
    logProgress(i, votes.length, "Member votes");

    const q = qById.get(v.votequestionId);
    const p = pById.get(v.politicianId);
    if (!q || !p) {
      continue;
    }

    const dateIso = q.date?.toISOString().slice(0, 10);
    const baseMeta = {
      sourceType: "vote_member" as const,
      sourceId: v.id,
      sessionId: q.sessionId,
      voteQuestionId: q.id,
      voteNumber: q.number,
      politicianId: p.id,
      politicianName: p.name,
      chunkIndex: 0,
      date: dateIso,
      result: v.vote,
    };

    allChunks.push({
      content: [
        `Member vote: ${p.name}`,
        `Vote: ${v.vote}`,
        `Question #${q.number}`,
        q.descriptionEn && `Description: ${q.descriptionEn}`,
        dateIso && `Date: ${dateIso}`,
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: { ...baseMeta, language: "en" },
    });

    allChunks.push({
      content: [
        `Vote du député/de la députée: ${p.name}`,
        `Vote: ${v.vote}`,
        `Question n° ${q.number}`,
        q.descriptionFr && `Description: ${q.descriptionFr}`,
        dateIso && `Date: ${dateIso}`,
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: { ...baseMeta, language: "fr" },
    });
  }

  const newChunks = filterNewChunks(allChunks);
  const created = await insertChunksBatched(newChunks, "member_votes");
  console.log(
    `   ↳ inserted ${created} chunks for member votes (${allChunks.length - newChunks.length} skipped)`
  );
}

async function processPoliticians(): Promise<void> {
  console.log("• Politicians");
  if (skipExisting) {
    await ensureProgressSynced("politician");
  }

  const rows = await (limit
    ? db.select().from(corePolitician).limit(limit)
    : db.select().from(corePolitician));
  console.log(`   Found ${rows.length} politicians`);

  const allChunks: ChunkInput[] = [];
  let i = 0;
  for (const p of rows) {
    i++;
    logProgress(i, rows.length, "Politicians");

    const baseMeta = {
      sourceType: "politician" as const,
      sourceId: p.id,
      chunkIndex: 0,
      title: p.name,
      politicianName: p.name,
    };

    allChunks.push({
      content: [`Politician: ${p.name}`, p.slug ? `Slug: ${p.slug}` : undefined]
        .filter(Boolean)
        .join("\n"),
      metadata: { ...baseMeta, language: "en", nameEn: p.name },
    });

    allChunks.push({
      content: [
        `Politicien/ne: ${p.name}`,
        p.slug ? `Identifiant: ${p.slug}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: { ...baseMeta, language: "fr", nameFr: p.name },
    });
  }

  const newChunks = filterNewChunks(allChunks);
  const created = await insertChunksBatched(newChunks, "politicians");
  console.log(
    `   ↳ inserted ${created} chunks for politicians (${allChunks.length - newChunks.length} skipped)`
  );
}

async function processParties(): Promise<void> {
  console.log("• Parties");
  if (skipExisting) {
    await ensureProgressSynced("party");
  }

  const rows = await (limit
    ? db.select().from(coreParty).limit(limit)
    : db.select().from(coreParty));
  console.log(`   Found ${rows.length} parties`);

  const allChunks: ChunkInput[] = [];
  let i = 0;
  for (const p of rows) {
    i++;
    logProgress(i, rows.length, "Parties");

    const baseMeta = {
      sourceType: "party" as const,
      sourceId: p.id,
      chunkIndex: 0,
      partyNameEn: p.nameEn,
      partyNameFr: p.nameFr,
      partyShortEn: p.shortNameEn || undefined,
      partyShortFr: p.shortNameFr || undefined,
    };

    allChunks.push({
      content: [
        `Party: ${p.nameEn}`,
        p.shortNameEn && `Short: ${p.shortNameEn}`,
        p.slug && `Slug: ${p.slug}`,
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: {
        ...baseMeta,
        language: "en",
        title: p.nameEn,
        nameEn: p.nameEn,
      },
    });

    allChunks.push({
      content: [
        `Parti: ${p.nameFr}`,
        p.shortNameFr && `Abrégé: ${p.shortNameFr}`,
        p.slug && `Identifiant: ${p.slug}`,
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: {
        ...baseMeta,
        language: "fr",
        title: p.nameFr,
        nameFr: p.nameFr,
      },
    });
  }

  const newChunks = filterNewChunks(allChunks);
  const created = await insertChunksBatched(newChunks, "parties");
  console.log(
    `   ↳ inserted ${created} chunks for parties (${allChunks.length - newChunks.length} skipped)`
  );
}

async function processElections(): Promise<void> {
  console.log("• Elections");
  if (skipExisting) {
    await ensureProgressSynced("election");
  }

  const rows = await (limit
    ? db.select().from(electionsElection).limit(limit)
    : db.select().from(electionsElection));
  console.log(`   Found ${rows.length} elections`);

  const allChunks: ChunkInput[] = [];
  let i = 0;
  for (const e of rows) {
    i++;
    logProgress(i, rows.length, "Elections");

    const d = e.date?.toISOString().slice(0, 10);
    const baseMeta = {
      sourceType: "election" as const,
      sourceId: e.id,
      chunkIndex: 0,
      date: d,
    };

    allChunks.push({
      content: [
        "Election",
        d && `Date: ${d}`,
        `By-election: ${e.byelection ? "Yes" : "No"}`,
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: { ...baseMeta, language: "en" },
    });

    allChunks.push({
      content: [
        "Élection",
        d && `Date: ${d}`,
        `Élection partielle: ${e.byelection ? "Oui" : "Non"}`,
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: { ...baseMeta, language: "fr" },
    });
  }

  const newChunks = filterNewChunks(allChunks);
  const created = await insertChunksBatched(newChunks, "elections");
  console.log(
    `   ↳ inserted ${created} chunks for elections (${allChunks.length - newChunks.length} skipped)`
  );
}

async function processCandidacies(): Promise<void> {
  console.log("• Candidacies");
  if (skipExisting) {
    await ensureProgressSynced("candidacy");
  }

  const rows = await (limit
    ? db.select().from(electionsCandidacy).limit(limit)
    : db.select().from(electionsCandidacy));
  console.log(`   Found ${rows.length} candidacies`);

  // Load lookups
  const [pols, parties, ridings, elections] = await Promise.all([
    db.select().from(corePolitician),
    db.select().from(coreParty),
    db.select().from(coreRiding),
    db.select().from(electionsElection),
  ]);
  const polById = new Map(pols.map((p) => [p.id, p] as const));
  const partyById = new Map(parties.map((p) => [p.id, p] as const));
  const ridingById = new Map(ridings.map((r) => [r.id, r] as const));
  const electionById = new Map(elections.map((e) => [e.id, e] as const));

  const allChunks: ChunkInput[] = [];
  let i = 0;
  for (const c of rows) {
    i++;
    logProgress(i, rows.length, "Candidacies");

    const pol = polById.get(c.candidateId);
    const party = partyById.get(c.partyId);
    const riding = ridingById.get(c.ridingId);
    const election = electionById.get(c.electionId);
    const dateIso = election?.date?.toISOString().slice(0, 10);

    const baseMeta = {
      sourceType: "candidacy" as const,
      sourceId: c.id,
      electionId: c.electionId,
      ridingId: c.ridingId,
      partyId: c.partyId,
      politicianId: c.candidateId,
      chunkIndex: 0,
      date: dateIso,
      politicianName: pol?.name,
      partyNameEn: party?.nameEn,
      partyNameFr: party?.nameFr,
      ridingNameEn: riding?.nameEn,
      ridingNameFr: riding?.nameFr,
      province: riding?.province,
    };

    allChunks.push({
      content: [
        `Candidacy: ${pol?.name ?? c.candidateId}`,
        party ? `Party: ${party.nameEn}` : undefined,
        riding ? `Riding: ${riding.nameEn}, ${riding.province}` : undefined,
        dateIso ? `Election Date: ${dateIso}` : undefined,
        c.votepercent != null ? `Vote %: ${c.votepercent}` : undefined,
        c.votetotal != null ? `Votes: ${c.votetotal}` : undefined,
        c.elected != null ? `Elected: ${c.elected ? "Yes" : "No"}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: { ...baseMeta, language: "en" },
    });

    allChunks.push({
      content: [
        `Candidature: ${pol?.name ?? c.candidateId}`,
        party ? `Parti: ${party.nameFr}` : undefined,
        riding
          ? `Circonscription: ${riding.nameFr}, ${riding.province}`
          : undefined,
        dateIso ? `Date de l'élection: ${dateIso}` : undefined,
        c.votepercent != null
          ? `Pourcentage de votes: ${c.votepercent}`
          : undefined,
        c.votetotal != null ? `Votes: ${c.votetotal}` : undefined,
        c.elected != null ? `Élu(e): ${c.elected ? "Oui" : "Non"}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: { ...baseMeta, language: "fr" },
    });
  }

  const newChunks = filterNewChunks(allChunks);
  const created = await insertChunksBatched(newChunks, "candidacies");
  console.log(
    `   ↳ inserted ${created} chunks for candidacies (${allChunks.length - newChunks.length} skipped)`
  );
}

async function processSessions(): Promise<void> {
  console.log("• Sessions");
  if (skipExisting) {
    await ensureProgressSynced("session");
  }

  const rows = await (limit
    ? db.select().from(coreSession).limit(limit)
    : db.select().from(coreSession));
  console.log(`   Found ${rows.length} sessions`);

  const allChunks: ChunkInput[] = [];
  let i = 0;
  for (const s of rows) {
    i++;
    logProgress(i, rows.length, "Sessions");

    const dStart = s.start?.toISOString().slice(0, 10);
    const dEnd = s.end?.toISOString().slice(0, 10);
    const baseMeta = {
      sourceType: "session" as const,
      sourceId: s.id,
      chunkIndex: 0,
      sessionName: s.name,
      parliamentnum: s.parliamentnum ?? undefined,
      sessnum: s.sessnum ?? undefined,
    };

    allChunks.push({
      content: [
        `Session ${s.id} – ${s.name}`,
        dStart && `Start: ${dStart}`,
        dEnd && `End: ${dEnd}`,
        s.parliamentnum && `Parliament: ${s.parliamentnum}`,
        s.sessnum && `Session #: ${s.sessnum}`,
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: { ...baseMeta, language: "en" },
    });

    allChunks.push({
      content: [
        `Session ${s.id} – ${s.name}`,
        dStart && `Début: ${dStart}`,
        dEnd && `Fin: ${dEnd}`,
        s.parliamentnum && `Législature: ${s.parliamentnum}`,
        s.sessnum && `Session n°: ${s.sessnum}`,
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: { ...baseMeta, language: "fr" },
    });
  }

  const newChunks = filterNewChunks(allChunks);
  const created = await insertChunksBatched(newChunks, "sessions");
  console.log(
    `   ↳ inserted ${created} chunks for sessions (${allChunks.length - newChunks.length} skipped)`
  );
}

async function processRidings(): Promise<void> {
  console.log("• Ridings");
  if (skipExisting) {
    await ensureProgressSynced("riding");
  }

  const rows = await (limit
    ? db.select().from(coreRiding).limit(limit)
    : db.select().from(coreRiding));
  console.log(`   Found ${rows.length} ridings`);

  const allChunks: ChunkInput[] = [];
  let i = 0;
  for (const r of rows) {
    i++;
    logProgress(i, rows.length, "Ridings");

    const baseMeta = {
      sourceType: "riding" as const,
      sourceId: r.id,
      chunkIndex: 0,
      ridingNameEn: r.nameEn,
      ridingNameFr: r.nameFr,
      province: r.province,
    };

    allChunks.push({
      content: [
        `Riding: ${r.nameEn}`,
        `Province: ${r.province}`,
        `Current: ${r.current ? "Yes" : "No"}`,
      ].join("\n"),
      metadata: { ...baseMeta, language: "en", title: r.nameEn },
    });

    allChunks.push({
      content: [
        `Circonscription: ${r.nameFr}`,
        `Province: ${r.province}`,
        `Actuelle: ${r.current ? "Oui" : "Non"}`,
      ].join("\n"),
      metadata: { ...baseMeta, language: "fr", title: r.nameFr },
    });
  }

  const newChunks = filterNewChunks(allChunks);
  const created = await insertChunksBatched(newChunks, "ridings");
  console.log(
    `   ↳ inserted ${created} chunks for ridings (${allChunks.length - newChunks.length} skipped)`
  );
}

// ---------- Main ----------
async function main() {
  try {
    console.log("\n🏛️  Embedding Generator (bilingual)\n");
    console.log(`Types: ${selectedTypes.join(", ")}`);
    console.log(`Session filter: ${sessionFilter ?? "none"}`);
    console.log(`Limit: ${limit ?? "none"}`);
    console.log(`Skip existing: ${skipExisting ? "yes" : "no"}`);
    console.log(`Drop tables: ${dropTables ? "yes" : "no"}`);
    console.log(`Empty tables: ${emptyTables ? "yes" : "no"}`);
    console.log(`Sync progress: ${syncProgress ? "yes" : "no"}`);
    console.log(`Clear progress: ${clearProgress ? "yes" : "no"}`);
    console.log(
      `Progress cache: ${progressTracker.totalCount().toLocaleString()} items in ${PROGRESS_DB_PATH}\n`
    );
    if (!process.env.COHERE_API_KEY) {
      console.warn(
        "⚠️  COHERE_API_KEY not set: embedding calls will fail or hang."
      );
    }

    if (dropTables) {
      await dropTablesWithConfirmation();
      await connection.end();
      return;
    }
    if (emptyTables) {
      await emptyTablesWithConfirmation();
      await connection.end();
      return;
    }
    if (clearProgress) {
      await clearProgressWithConfirmation();
      await connection.end();
      return;
    }
    if (syncProgress) {
      console.log("\n📥 Syncing progress from Postgres...\n");
      await syncProgressFromPostgres();
      console.log(
        `\n✅ Progress synced: ${progressTracker.totalCount().toLocaleString()} items now cached\n`
      );
      await connection.end();
      return;
    }

    // Execute processors in a sensible order
    for (const t of selectedTypes) {
      switch (t) {
        case "bills":
          await processBills();
          break;
        case "hansard":
          await processHansard();
          break;
        case "committees":
          await processCommittees();
          break;
        case "committee_reports":
          await processCommitteeReports();
          break;
        case "committee_meetings":
          await processCommitteeMeetings();
          break;
        case "vote_questions":
          await processVoteQuestions();
          break;
        case "party_votes":
          await processPartyVotes();
          break;
        case "member_votes":
          await processMemberVotes();
          break;
        case "politicians":
          await processPoliticians();
          break;
        case "parties":
          await processParties();
          break;
        case "elections":
          await processElections();
          break;
        case "candidacies":
          await processCandidacies();
          break;
        case "sessions":
          await processSessions();
          break;
        case "ridings":
          await processRidings();
          break;
        default:
          console.warn(`Unknown type: ${t}`);
      }
    }

    console.log("\n✨ Generation complete!\n");
    console.log(
      `Progress cache: ${progressTracker.totalCount().toLocaleString()} items tracked`
    );
  } catch (err) {
    console.error("\n❌ Fatal error:", err);
    process.exit(1);
  } finally {
    progressTracker.close();
    await connection.end();
  }
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
