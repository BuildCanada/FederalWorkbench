/**
 * Generate legislation embeddings for acts and regulations
 *
 * Usage:
 *   npx tsx scripts/generate-legislation-embeddings.ts
 *   npx tsx scripts/generate-legislation-embeddings.ts --limit=100 --dry-run
 *   npx tsx scripts/generate-legislation-embeddings.ts --acts-only --skip-existing
 *   npx tsx scripts/generate-legislation-embeddings.ts --truncate
 *
 * Options:
 *   --limit=N        Process N acts AND N regulations (applies to each type separately)
 *   --skip-existing  Skip resources that already exist in the database
 *   --truncate       Delete all existing legislation embeddings before starting
 *   --dry-run        Count chunks without writing to database or calling API
 *   --acts-only      Only process acts
 *   --regs-only      Only process regulations
 */

import { config } from "dotenv";

config({ path: ".env.local" });

import { createInterface } from "node:readline";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { nanoid } from "nanoid";
import postgres from "postgres";

import { generateEmbeddings } from "@/lib/ai/embeddings";
import {
  type Act,
  acts,
  type Regulation,
  regulations,
  sections,
} from "@/lib/db/legislation/schema";
import { type LegResourceMetadata, legResources } from "@/lib/db/rag/schema";
import {
  chunkSection,
  shouldSkipSection,
} from "@/lib/rag/legislation/chunking";

// ---------- CLI args ----------
const args = process.argv.slice(2);

function readOptValue(name: string): string | undefined {
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
const skipExisting = args.includes("--skip-existing");
const truncate = args.includes("--truncate");
const dryRun = args.includes("--dry-run");
const actsOnly = args.includes("--acts-only");
const regsOnly = args.includes("--regs-only");

const limit = limitStr ? Number.parseInt(limitStr, 10) : undefined;

// ---------- Configuration ----------
const BATCH_SIZE = 50;
const EMBEDDING_RETRY_ATTEMPTS = 3;
const PROGRESS_LOG_INTERVAL = 100;

// ---------- DB setup ----------
const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!dbUrl) {
  throw new Error("DATABASE_URL or POSTGRES_URL required");
}
const connection = postgres(dbUrl);
const db = drizzle(connection);

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
        `   ⚠️  Attempt ${attempt}/${maxRetries} failed: ${lastError.message}`
      );
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
      }
    }
  }
  throw new Error(
    `Embedding failed after ${maxRetries} attempts: ${lastError?.message}`
  );
}

type ChunkData = {
  content: string;
  chunkIndex: number;
  totalChunks: number;
  metadata: LegResourceMetadata;
  /** For act/regulation metadata chunks, this is the act/reg ID; for sections, it's the section ID */
  resourceKey: string;
};

async function insertBatch(chunks: ChunkData[]): Promise<void> {
  const embeddings = await generateEmbeddingsWithRetry(
    chunks.map((c) => c.content)
  );

  await db.transaction(async (tx) => {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = embeddings[i];

      const [resource] = await tx
        .insert(legResources)
        .values({
          id: nanoid(),
          sectionId: chunk.resourceKey,
          content: chunk.content,
          metadata: chunk.metadata,
        })
        .returning({ id: legResources.id });

      await tx.execute(sql`
        INSERT INTO rag.leg_embeddings (id, resource_id, content, embedding, tsv, chunk_index, total_chunks)
        VALUES (
          ${nanoid()},
          ${resource.id},
          ${chunk.content},
          ${sql.raw(`'[${embedding.join(",")}]'::vector`)},
          to_tsvector('simple', ${chunk.content}),
          ${chunk.chunkIndex},
          ${chunk.totalChunks}
        )
      `);
    }
  });
}

// ---------- Metadata Text Builders ----------
function buildActMetadataText(act: Act): string {
  const parts: string[] = [];
  const lang = act.language as "en" | "fr";

  if (lang === "fr") {
    parts.push(`Loi: ${act.title}`);
    if (act.longTitle) {
      parts.push(`Titre complet: ${act.longTitle}`);
    }
    parts.push(`Identifiant: ${act.actId}`);
    parts.push(`Statut: ${act.status}`);
    if (act.inForceDate) {
      parts.push(`En vigueur: ${act.inForceDate}`);
    }
    if (act.enactedDate) {
      parts.push(`Adoptée: ${act.enactedDate}`);
    }
    if (act.consolidationDate) {
      parts.push(`Consolidation: ${act.consolidationDate}`);
    }
    if (act.billOrigin) {
      const origin =
        act.billOrigin === "commons" ? "Chambre des communes" : "Sénat";
      parts.push(`Origine: ${origin}`);
    }
  } else {
    parts.push(`Act: ${act.title}`);
    if (act.longTitle) {
      parts.push(`Long Title: ${act.longTitle}`);
    }
    parts.push(`ID: ${act.actId}`);
    parts.push(`Status: ${act.status}`);
    if (act.inForceDate) {
      parts.push(`In Force: ${act.inForceDate}`);
    }
    if (act.enactedDate) {
      parts.push(`Enacted: ${act.enactedDate}`);
    }
    if (act.consolidationDate) {
      parts.push(`Consolidation: ${act.consolidationDate}`);
    }
    if (act.billOrigin) {
      const origin =
        act.billOrigin === "commons" ? "House of Commons" : "Senate";
      parts.push(`Origin: ${origin}`);
    }
  }

  return parts.join("\n");
}

function buildRegulationMetadataText(reg: Regulation): string {
  const parts: string[] = [];
  const lang = reg.language as "en" | "fr";

  if (lang === "fr") {
    parts.push(`Règlement: ${reg.title}`);
    if (reg.longTitle) {
      parts.push(`Titre complet: ${reg.longTitle}`);
    }
    parts.push(`Identifiant: ${reg.regulationId}`);
    if (reg.instrumentNumber) {
      parts.push(`Numéro d'instrument: ${reg.instrumentNumber}`);
    }
    parts.push(`Statut: ${reg.status}`);
    if (reg.regulationType) {
      parts.push(`Type: ${reg.regulationType}`);
    }
    if (reg.registrationDate) {
      parts.push(`Date d'enregistrement: ${reg.registrationDate}`);
    }
    if (reg.enablingActTitle) {
      parts.push(`Loi habilitante: ${reg.enablingActTitle}`);
    }
    if (reg.consolidationDate) {
      parts.push(`Consolidation: ${reg.consolidationDate}`);
    }
  } else {
    parts.push(`Regulation: ${reg.title}`);
    if (reg.longTitle) {
      parts.push(`Long Title: ${reg.longTitle}`);
    }
    parts.push(`ID: ${reg.regulationId}`);
    if (reg.instrumentNumber) {
      parts.push(`Instrument Number: ${reg.instrumentNumber}`);
    }
    parts.push(`Status: ${reg.status}`);
    if (reg.regulationType) {
      parts.push(`Type: ${reg.regulationType}`);
    }
    if (reg.registrationDate) {
      parts.push(`Registration Date: ${reg.registrationDate}`);
    }
    if (reg.enablingActTitle) {
      parts.push(`Enabling Act: ${reg.enablingActTitle}`);
    }
    if (reg.consolidationDate) {
      parts.push(`Consolidation: ${reg.consolidationDate}`);
    }
  }

  return parts.join("\n");
}

// ---------- Processing ----------
async function processActs(existingKeys: Set<string>): Promise<number> {
  console.log("• Processing acts...");

  const allActs = limit
    ? await db.select().from(acts).limit(limit)
    : await db.select().from(acts);
  console.log(`   Found ${allActs.length} acts`);

  let totalChunks = 0;
  let batchChunks: ChunkData[] = [];

  for (let i = 0; i < allActs.length; i++) {
    const act = allActs[i];
    if (i % PROGRESS_LOG_INTERVAL === 0 && i > 0) {
      console.log(`   📊 Acts: ${i}/${allActs.length}`);
    }

    const actKey = `act:${act.actId}:${act.language}`;
    const lang = act.language as "en" | "fr";

    // Add act metadata chunk (chunkIndex 0)
    if (!existingKeys.has(actKey)) {
      batchChunks.push({
        content: buildActMetadataText(act),
        chunkIndex: 0,
        totalChunks: 1,
        resourceKey: actKey,
        metadata: {
          sourceType: "act",
          language: lang,
          actId: act.actId,
          documentTitle: act.title,
          longTitle: act.longTitle ?? undefined,
          status: act.status,
          inForceDate: act.inForceDate ?? undefined,
          consolidationDate: act.consolidationDate ?? undefined,
          enactedDate: act.enactedDate ?? undefined,
          billOrigin: act.billOrigin ?? undefined,
          chunkIndex: 0,
        },
      });

      if (batchChunks.length >= BATCH_SIZE) {
        if (!dryRun) {
          await insertBatch(batchChunks);
        }
        totalChunks += batchChunks.length;
        process.stdout.write(`\r   Acts: ${totalChunks} chunks...`);
        batchChunks = [];
      }
    }

    // Get sections for this act in this language
    const actSections = await db
      .select()
      .from(sections)
      .where(
        and(eq(sections.actId, act.actId), eq(sections.language, act.language))
      )
      .orderBy(sections.sectionOrder);

    for (const section of actSections) {
      if (existingKeys.has(section.id)) {
        continue;
      }
      if (shouldSkipSection(section)) {
        continue;
      }

      const chunks = chunkSection(section, act.title);

      for (const chunk of chunks) {
        batchChunks.push({
          content: chunk.content,
          chunkIndex: chunk.chunkIndex,
          totalChunks: chunk.totalChunks,
          resourceKey: section.id,
          metadata: {
            sourceType: "act_section",
            sectionId: section.id,
            language: lang,
            actId: act.actId,
            documentTitle: act.title,
            sectionLabel: section.sectionLabel,
            marginalNote: section.marginalNote ?? undefined,
            chunkIndex: chunk.chunkIndex,
          },
        });

        if (batchChunks.length >= BATCH_SIZE) {
          if (!dryRun) {
            await insertBatch(batchChunks);
          }
          totalChunks += batchChunks.length;
          process.stdout.write(`\r   Acts: ${totalChunks} chunks...`);
          batchChunks = [];
        }
      }
    }
  }

  // Final batch
  if (batchChunks.length > 0 && !dryRun) {
    await insertBatch(batchChunks);
    totalChunks += batchChunks.length;
  }

  console.log(`\n   ↳ Acts: ${totalChunks} chunks embedded`);
  return totalChunks;
}

async function processRegulations(existingKeys: Set<string>): Promise<number> {
  console.log("• Processing regulations...");

  const allRegs = limit
    ? await db.select().from(regulations).limit(limit)
    : await db.select().from(regulations);
  console.log(`   Found ${allRegs.length} regulations`);

  let totalChunks = 0;
  let batchChunks: ChunkData[] = [];

  for (let i = 0; i < allRegs.length; i++) {
    const reg = allRegs[i];
    if (i % PROGRESS_LOG_INTERVAL === 0 && i > 0) {
      console.log(`   📊 Regulations: ${i}/${allRegs.length}`);
    }

    const regKey = `reg:${reg.regulationId}:${reg.language}`;
    const lang = reg.language as "en" | "fr";

    // Add regulation metadata chunk (chunkIndex 0)
    if (!existingKeys.has(regKey)) {
      batchChunks.push({
        content: buildRegulationMetadataText(reg),
        chunkIndex: 0,
        totalChunks: 1,
        resourceKey: regKey,
        metadata: {
          sourceType: "regulation",
          language: lang,
          regulationId: reg.regulationId,
          documentTitle: reg.title,
          longTitle: reg.longTitle ?? undefined,
          status: reg.status,
          instrumentNumber: reg.instrumentNumber ?? undefined,
          regulationType: reg.regulationType ?? undefined,
          enablingActId: reg.enablingActId ?? undefined,
          enablingActTitle: reg.enablingActTitle ?? undefined,
          registrationDate: reg.registrationDate ?? undefined,
          consolidationDate: reg.consolidationDate ?? undefined,
          chunkIndex: 0,
        },
      });

      if (batchChunks.length >= BATCH_SIZE) {
        if (!dryRun) {
          await insertBatch(batchChunks);
        }
        totalChunks += batchChunks.length;
        process.stdout.write(`\r   Regulations: ${totalChunks} chunks...`);
        batchChunks = [];
      }
    }

    // Get sections for this regulation in this language
    const regSections = await db
      .select()
      .from(sections)
      .where(
        and(
          eq(sections.regulationId, reg.regulationId),
          eq(sections.language, reg.language)
        )
      )
      .orderBy(sections.sectionOrder);

    for (const section of regSections) {
      if (existingKeys.has(section.id)) {
        continue;
      }
      if (shouldSkipSection(section)) {
        continue;
      }

      const chunks = chunkSection(section, reg.title);

      for (const chunk of chunks) {
        batchChunks.push({
          content: chunk.content,
          chunkIndex: chunk.chunkIndex,
          totalChunks: chunk.totalChunks,
          resourceKey: section.id,
          metadata: {
            sourceType: "regulation_section",
            sectionId: section.id,
            language: lang,
            regulationId: reg.regulationId,
            documentTitle: reg.title,
            sectionLabel: section.sectionLabel,
            marginalNote: section.marginalNote ?? undefined,
            chunkIndex: chunk.chunkIndex,
          },
        });

        if (batchChunks.length >= BATCH_SIZE) {
          if (!dryRun) {
            await insertBatch(batchChunks);
          }
          totalChunks += batchChunks.length;
          process.stdout.write(`\r   Regulations: ${totalChunks} chunks...`);
          batchChunks = [];
        }
      }
    }
  }

  // Final batch
  if (batchChunks.length > 0 && !dryRun) {
    await insertBatch(batchChunks);
    totalChunks += batchChunks.length;
  }

  console.log(`\n   ↳ Regulations: ${totalChunks} chunks embedded`);
  return totalChunks;
}

// ---------- Timing ----------
function formatDuration(ms: number): string {
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

// ---------- Main ----------
async function main() {
  const startTime = Date.now();

  console.log("\n📚 Legislation Embeddings Generator\n");
  console.log(`Limit: ${limit ?? "none"}`);
  console.log(`Skip existing: ${skipExisting}`);
  console.log(`Truncate: ${truncate}`);
  console.log(`Dry run: ${dryRun}`);
  console.log(`Acts only: ${actsOnly}`);
  console.log(`Regs only: ${regsOnly}\n`);

  if (!process.env.COHERE_API_KEY) {
    console.warn("⚠️  COHERE_API_KEY not set\n");
  }

  if (truncate && !dryRun) {
    const confirmed = await promptConfirmation(
      "⚠️  This will delete all legislation embeddings. Continue?"
    );
    if (!confirmed) {
      console.log("Cancelled.");
      process.exit(0);
    }
    console.log("Truncating tables...");
    await db.execute(sql`TRUNCATE TABLE rag.leg_embeddings CASCADE`);
    await db.execute(sql`TRUNCATE TABLE rag.leg_resources CASCADE`);
  }

  // Load existing keys if skipping
  const existingKeys = new Set<string>();
  if (skipExisting) {
    const existing = await db
      .select({ sectionId: legResources.sectionId })
      .from(legResources);
    for (const row of existing) {
      existingKeys.add(row.sectionId);
    }
    console.log(`Skipping ${existingKeys.size} existing resources\n`);
  }

  let totalChunks = 0;

  if (!regsOnly) {
    totalChunks += await processActs(existingKeys);
  }

  if (!actsOnly) {
    totalChunks += await processRegulations(existingKeys);
  }

  const elapsed = Date.now() - startTime;
  const chunksPerSecond = totalChunks / (elapsed / 1000);

  console.log(`\n✨ Complete! Total chunks: ${totalChunks}`);
  console.log(`⏱️  Duration: ${formatDuration(elapsed)}`);
  console.log(`📈 Rate: ${chunksPerSecond.toFixed(1)} chunks/sec`);

  // Estimate full run time if running with a limit
  if (limit && totalChunks > 0) {
    const estimatedTotalChunks = 280_000; // ~280k based on earlier estimates
    const estimatedMs = (estimatedTotalChunks / chunksPerSecond) * 1000;
    console.log(
      `📊 Estimated full run: ${formatDuration(estimatedMs)} (for ~${estimatedTotalChunks.toLocaleString()} chunks)`
    );
  }

  console.log();
  await connection.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
