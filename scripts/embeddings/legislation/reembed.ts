/**
 * Re-embedding migration script for legislation embeddings
 *
 * Use this script when upgrading to a newer embedding model. It re-generates
 * embeddings for records created with older model versions.
 *
 * Usage:
 *   npx tsx scripts/embeddings/legislation/reembed.ts --help
 *   npx tsx scripts/embeddings/legislation/reembed.ts --from-model=cohere-embed-multilingual-v3.0 --dry-run
 *   npx tsx scripts/embeddings/legislation/reembed.ts --from-model=cohere-embed-multilingual-v3.0 --limit=1000
 *   npx tsx scripts/embeddings/legislation/reembed.ts --list-models
 *   npx tsx scripts/embeddings/legislation/reembed.ts --null-models --limit=500
 *
 * Options:
 *   --from-model=<model>  Target embeddings created with this model for re-embedding
 *   --null-models         Target embeddings with NULL model (legacy records before tracking)
 *   --to-model=<model>    Model identifier to use for new embeddings (default: current model)
 *   --limit=N             Process only N embeddings (useful for testing)
 *   --batch-size=N        Number of embeddings per batch (default: 50)
 *   --dry-run             Count records without re-embedding
 *   --list-models         List all distinct model versions in the database
 *   --source-type=<type>  Only re-embed specific source type (act, regulation, etc.)
 *   --help                Show this help message
 *
 * Migration Process:
 *   1. First, run with --list-models to see current model distribution
 *   2. Run with --from-model=<old> --dry-run to see how many need updating
 *   3. Run with --from-model=<old> --limit=100 to test on a small batch
 *   4. Run full migration: --from-model=<old> (without --limit)
 *
 * Notes:
 *   - This script updates embeddings in-place (same resource, new vector)
 *   - The legResources.metadata.embeddingModelVersion is also updated
 *   - Progress is logged but not tracked in SQLite (re-running is idempotent)
 *   - For safety, always test with --dry-run and --limit first
 */

import { config } from "dotenv";

config({ path: ".env.local" });

import type { SQL } from "drizzle-orm";
import { eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { DEFAULT_EMBEDDING_MODEL, legEmbeddings } from "@/lib/db/rag/schema";
import { normalizeForEmbedding } from "@/lib/rag/shared/chunking";

import {
  EMBEDDING_BATCH_SIZE,
  formatDuration,
  generateEmbeddingsWithRetry,
  parsePositiveInteger,
  readOptValue,
  validateEmbedding,
  validateEnvironment,
} from "./utilities";

type DbConnection = ReturnType<typeof drizzle>;

// ---------- CLI Args ----------
const args = process.argv.slice(2);

const helpFlag = args.includes("--help") || args.includes("-h");
const listModels = args.includes("--list-models");
const dryRun = args.includes("--dry-run");
const nullModels = args.includes("--null-models");

const fromModel = readOptValue(args, "from-model");
const toModel = readOptValue(args, "to-model") ?? DEFAULT_EMBEDDING_MODEL;
const limitStr = readOptValue(args, "limit");
const batchSizeStr = readOptValue(args, "batch-size");
const sourceType = readOptValue(args, "source-type");

const limit = parsePositiveInteger(limitStr, "--limit");
const batchSize =
  parsePositiveInteger(batchSizeStr, "--batch-size") ?? EMBEDDING_BATCH_SIZE;

// ---------- Help ----------
function showHelp(): void {
  console.log(`
Re-embedding Migration Script for Legislation Embeddings

Use this script when upgrading to a newer embedding model.

USAGE:
  npx tsx scripts/embeddings/legislation/reembed.ts [OPTIONS]

OPTIONS:
  --from-model=<model>  Target embeddings created with this model
  --null-models         Target embeddings with NULL model (legacy records)
  --to-model=<model>    Model identifier for new embeddings (default: ${DEFAULT_EMBEDDING_MODEL})
  --limit=N             Process only N embeddings
  --batch-size=N        Embeddings per batch (default: ${EMBEDDING_BATCH_SIZE})
  --dry-run             Count records without re-embedding
  --list-models         List all distinct model versions in database
  --source-type=<type>  Only re-embed specific source type
  --help                Show this help message

EXAMPLES:
  # List current model distribution
  npx tsx scripts/embeddings/legislation/reembed.ts --list-models

  # Dry run to see how many legacy records exist
  npx tsx scripts/embeddings/legislation/reembed.ts --null-models --dry-run

  # Re-embed legacy records (no model tracking)
  npx tsx scripts/embeddings/legislation/reembed.ts --null-models --limit=1000

  # Re-embed from specific old model
  npx tsx scripts/embeddings/legislation/reembed.ts --from-model=cohere-embed-multilingual-v3.0

  # Re-embed only act sections
  npx tsx scripts/embeddings/legislation/reembed.ts --null-models --source-type=act_section
`);
}

// ---------- DB Setup ----------
function setupDb() {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_URL or POSTGRES_URL required");
  }
  const connection = postgres(dbUrl);
  const db = drizzle(connection);
  return { db, connection };
}

// ---------- List Models ----------
async function listModelVersions(db: DbConnection): Promise<void> {
  console.log("\n📊 Embedding Model Distribution\n");

  const results = await db.execute<{
    embedding_model: string | null;
    count: string;
  }>(sql`
    SELECT
      embedding_model,
      COUNT(*) as count
    FROM rag.leg_embeddings
    GROUP BY embedding_model
    ORDER BY count DESC
  `);

  if (results.length === 0) {
    console.log("No embeddings found in database.");
    return;
  }

  console.log("Model Version                         Count");
  console.log("─".repeat(50));

  let total = 0;
  for (const row of results) {
    const model = row.embedding_model ?? "(NULL - legacy)";
    const count = Number.parseInt(row.count, 10);
    total += count;
    console.log(`${model.padEnd(38)} ${count.toLocaleString()}`);
  }

  console.log("─".repeat(50));
  console.log(`${"Total".padEnd(38)} ${total.toLocaleString()}`);
  console.log();
}

// ---------- Count Embeddings ----------
async function countEmbeddingsToMigrate(
  db: DbConnection,
  fromModelVersion: string | null,
  sourceTypeFilter?: string
): Promise<number> {
  if (sourceTypeFilter) {
    // Join with resources to filter by source type
    const result = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*) as count
      FROM rag.leg_embeddings e
      JOIN rag.leg_resources r ON e.resource_id = r.id
      WHERE ${fromModelVersion === null ? sql`e.embedding_model IS NULL` : sql`e.embedding_model = ${fromModelVersion}`}
        AND r.source_type = ${sourceTypeFilter}
    `);
    return Number.parseInt(result[0]?.count ?? "0", 10);
  }

  const modelCondition: SQL =
    fromModelVersion === null
      ? isNull(legEmbeddings.embeddingModel)
      : eq(legEmbeddings.embeddingModel, fromModelVersion);

  const result = await db
    .select({ count: sql<string>`COUNT(*)` })
    .from(legEmbeddings)
    .where(modelCondition);

  return Number.parseInt(result[0]?.count ?? "0", 10);
}

// ---------- Fetch Batch ----------
type EmbeddingRecord = {
  embeddingId: string;
  resourceId: string;
  content: string;
};

type FetchBatchOptions = {
  db: DbConnection;
  fromModelVersion: string | null;
  sourceTypeFilter: string | undefined;
  size: number;
  offset: number;
};

async function fetchEmbeddingBatch(
  options: FetchBatchOptions
): Promise<EmbeddingRecord[]> {
  const { db, fromModelVersion, sourceTypeFilter, size, offset } = options;

  if (sourceTypeFilter) {
    const rows = await db.execute<{
      embedding_id: string;
      resource_id: string;
      content: string;
    }>(sql`
      SELECT
        e.id as embedding_id,
        e.resource_id,
        e.content
      FROM rag.leg_embeddings e
      JOIN rag.leg_resources r ON e.resource_id = r.id
      WHERE ${fromModelVersion === null ? sql`e.embedding_model IS NULL` : sql`e.embedding_model = ${fromModelVersion}`}
        AND r.source_type = ${sourceTypeFilter}
      ORDER BY e.id
      LIMIT ${size}
      OFFSET ${offset}
    `);

    return rows.map((row) => ({
      embeddingId: row.embedding_id,
      resourceId: row.resource_id,
      content: row.content,
    }));
  }

  const modelCondition: SQL =
    fromModelVersion === null
      ? isNull(legEmbeddings.embeddingModel)
      : eq(legEmbeddings.embeddingModel, fromModelVersion);

  const rows = await db
    .select({
      embeddingId: legEmbeddings.id,
      resourceId: legEmbeddings.resourceId,
      content: legEmbeddings.content,
    })
    .from(legEmbeddings)
    .where(modelCondition)
    .orderBy(legEmbeddings.id)
    .limit(size)
    .offset(offset);

  return rows;
}

// ---------- Update Batch ----------
async function updateEmbeddingBatch(
  db: DbConnection,
  records: EmbeddingRecord[],
  newModel: string
): Promise<number> {
  if (records.length === 0) {
    return 0;
  }

  // Normalize content for consistent embedding generation
  const normalizedContents = records.map((r) =>
    normalizeForEmbedding(r.content)
  );

  // Generate new embeddings
  const vectors = await generateEmbeddingsWithRetry(normalizedContents);

  // Validate all embeddings
  for (let i = 0; i < vectors.length; i++) {
    if (!validateEmbedding(vectors[i])) {
      throw new Error(
        `Invalid embedding at index ${i}: expected 1024-dimensional number array`
      );
    }
  }

  // Update each record in a transaction
  await db.transaction(async (tx) => {
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const vector = vectors[i];

      // Update embedding record
      await tx
        .update(legEmbeddings)
        .set({
          embedding: vector,
          embeddingModel: newModel,
        })
        .where(eq(legEmbeddings.id, record.embeddingId));

      // Update resource metadata to include new model version
      await tx.execute(sql`
        UPDATE rag.leg_resources
        SET metadata = jsonb_set(
          metadata,
          '{embeddingModelVersion}',
          ${JSON.stringify(newModel)}::jsonb
        ),
        updated_at = NOW()
        WHERE id = ${record.resourceId}
      `);
    }
  });

  return records.length;
}

// ---------- Main ----------
async function main() {
  if (helpFlag) {
    showHelp();
    return;
  }

  validateEnvironment(dryRun);

  const { db, connection } = setupDb();

  try {
    // List models mode
    if (listModels) {
      await listModelVersions(db);
      return;
    }

    // Validate required args
    if (!fromModel && !nullModels) {
      console.error(
        "Error: Must specify --from-model=<model> or --null-models"
      );
      console.error("Run with --help for usage information.");
      process.exit(1);
    }

    // fromModel is guaranteed to exist if nullModels is false (validated above)
    const fromModelVersion: string | null = nullModels
      ? null
      : (fromModel as string);
    const modelLabel = fromModelVersion ?? "(NULL - legacy records)";

    console.log("\n🔄 Re-embedding Migration\n");
    console.log(`From model: ${modelLabel}`);
    console.log(`To model: ${toModel}`);
    console.log(`Batch size: ${batchSize}`);
    console.log(`Limit: ${limit ?? "none"}`);
    console.log(`Source type filter: ${sourceType ?? "all"}`);
    console.log(`Dry run: ${dryRun ? "yes" : "no"}`);

    // Count records to migrate
    const totalCount = await countEmbeddingsToMigrate(
      db,
      fromModelVersion,
      sourceType
    );

    console.log(
      `\n📊 Found ${totalCount.toLocaleString()} embeddings to migrate\n`
    );

    if (totalCount === 0) {
      console.log("✅ No embeddings need migration.");
      return;
    }

    if (dryRun) {
      console.log("🔍 Dry run complete. No changes made.");
      return;
    }

    // Check if from and to are the same
    if (fromModelVersion === toModel) {
      console.error(
        `Error: Source and target model are the same (${toModel}). Nothing to migrate.`
      );
      process.exit(1);
    }

    // Process in batches
    const startTime = Date.now();
    const processLimit = limit ?? totalCount;
    let processed = 0;
    let offset = 0;

    while (processed < processLimit) {
      const currentBatchSize = Math.min(batchSize, processLimit - processed);

      console.log(
        `   📦 Processing batch at offset ${offset} (${currentBatchSize} records)...`
      );

      const records = await fetchEmbeddingBatch({
        db,
        fromModelVersion,
        sourceTypeFilter: sourceType,
        size: currentBatchSize,
        offset,
      });

      if (records.length === 0) {
        console.log("   ℹ️  No more records to process.");
        break;
      }

      const updated = await updateEmbeddingBatch(db, records, toModel);
      processed += updated;
      offset += records.length;

      const elapsed = Date.now() - startTime;
      const rate = processed / (elapsed / 1000);
      const pct = Math.round((processed / processLimit) * 100);

      console.log(
        `   ✅ Processed ${processed.toLocaleString()}/${processLimit.toLocaleString()} (${pct}%) - ${rate.toFixed(1)} records/sec`
      );
    }

    const elapsed = Date.now() - startTime;
    console.log("\n✨ Migration complete!");
    console.log(`   Records updated: ${processed.toLocaleString()}`);
    console.log(`   Duration: ${formatDuration(elapsed)}`);
    console.log(`   New model: ${toModel}`);
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error("\n❌ Fatal error:", err);
  process.exit(1);
});
