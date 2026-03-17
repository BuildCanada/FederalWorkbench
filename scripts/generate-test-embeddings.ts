/**
 * Generate test parlEmbeddings for Bill C-35 from the 44th Parliament
 *
 * Creates a minimal but comprehensive test dataset by generating parlEmbeddings
 * for ONE bill (C-35) and ALL related entities across all source types:
 *
 * Direct relationships:
 * - The bill itself (metadata + text)
 * - Hansard statements debating/mentioning the bill
 * - Vote questions on the bill
 * - Party votes on those vote questions
 * - Member votes on those vote questions
 *
 * Derived relationships:
 * - Politicians who spoke about or voted on the bill
 * - Parties that voted on the bill
 * - Ridings of the involved politicians
 * - The session the bill belongs to (44-1)
 *
 * Committee context (from same session):
 * - Committees active in session 44-1
 * - Committee reports from session 44-1
 * - Committee meetings from session 44-1
 *
 * Election context:
 * - Most recent election before the bill
 * - Candidacies of involved politicians
 *
 * Usage:
 *   npx tsx scripts/generate-test-parlEmbeddings.ts
 *   npx tsx scripts/generate-test-parlEmbeddings.ts --skip-existing
 *   npx tsx scripts/generate-test-parlEmbeddings.ts --truncate
 */

import { config } from "dotenv";

config({ path: ".env.local" });

import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
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
  coreElectedmember,
  coreParty,
  corePolitician,
  coreRiding,
  coreSession,
  electionsCandidacy,
  electionsElection,
  hansardsDocument,
  hansardsStatement,
  hansardsStatementBills,
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

// ---------- Configuration ----------
const TEST_BILL_NUMBER = "C-35";
const TEST_SESSION_ID = "44-1";

// ---------- DB setup ----------
const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!dbUrl) {
  throw new Error(
    "DATABASE_URL or POSTGRES_URL environment variable is required"
  );
}
const connection = postgres(dbUrl);
const db = drizzle(connection);

// Check command line flags
const args = process.argv.slice(2);
const skipExisting = args.includes("--skip-existing");
const truncateFirst = args.includes("--truncate");

// ---------- Configuration Constants ----------
const EMBEDDING_RETRY_ATTEMPTS = 3;
const EMBEDDING_BATCH_SIZE = 50;
const PROGRESS_LOG_INTERVAL = 10;

// ---------- Utilities ----------
type ChunkInput = { content: string; metadata: ResourceMetadata };

/**
 * Build a unique key for a resource based on its metadata
 */
function buildResourceKey(meta: ResourceMetadata): string {
  return `${meta.sourceType}:${meta.sourceId}:${meta.language}:${meta.chunkIndex ?? 0}`;
}

/**
 * Batch load existing parlResources for a given source type
 * Returns a Set of resource keys for fast lookup
 */
async function loadExistingResourceKeys(
  sourceType: ResourceMetadata["sourceType"]
): Promise<Set<string>> {
  const rows = await db
    .select({ metadata: parlResources.metadata })
    .from(parlResources)
    .where(sql`${parlResources.metadata}->>'sourceType' = ${sourceType}`);

  const keys = new Set<string>();
  for (const row of rows) {
    const meta = row.metadata as ResourceMetadata;
    keys.add(buildResourceKey(meta));
  }
  return keys;
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
  _label: string
): Promise<number> {
  if (chunks.length === 0) {
    return 0;
  }

  let inserted = 0;

  // Process in batches to avoid memory issues with large embedding requests
  for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
    const batchNum = Math.floor(i / EMBEDDING_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(chunks.length / EMBEDDING_BATCH_SIZE);

    if (totalBatches > 1) {
      console.log(`   📦 Processing batch ${batchNum}/${totalBatches}...`);
    }

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

    inserted += batch.length;
  }

  return inserted;
}

/**
 * Filter chunks that don't already exist in the database
 */
function filterNewChunks(
  chunks: ChunkInput[],
  existingKeys: Set<string>
): ChunkInput[] {
  return chunks.filter(
    (ch) => !existingKeys.has(buildResourceKey(ch.metadata))
  );
}

/**
 * Log progress for long-running operations
 */
function logProgress(current: number, total: number, label: string): void {
  if (current % PROGRESS_LOG_INTERVAL === 0 || current === total) {
    const pct = Math.round((current / total) * 100);
    console.log(`   📊 ${label}: ${current}/${total} (${pct}%)`);
  }
}

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
        `Type: ${bill.privatemember ? "Projet de loi d'initiative parlementaire" : "Projet de loi du gouvernement"}`
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

// ---------- Main ----------
async function main() {
  try {
    console.log("\n🏛️  Test Embedding Generator - Bill C-35 Focus\n");
    console.log(
      `Target: Bill ${TEST_BILL_NUMBER} from session ${TEST_SESSION_ID}`
    );
    console.log(`Skip existing: ${skipExisting ? "yes" : "no"}`);
    console.log(`Truncate first: ${truncateFirst ? "yes" : "no"}\n`);

    // Truncate tables if requested
    if (truncateFirst) {
      console.log("🗑️  Truncating parlEmbeddings and parlResources tables...");
      await db.delete(parlEmbeddings);
      await db.delete(parlResources);
      console.log("   ✓ Tables truncated\n");
    }

    if (!process.env.COHERE_API_KEY) {
      console.warn(
        "⚠️  COHERE_API_KEY not set: embedding calls will fail or hang.\n"
      );
    }

    // Step 1: Find Bill C-35
    console.log("📋 Finding Bill C-35...");
    const testBills = await db
      .select()
      .from(billsBill)
      .where(
        and(
          eq(billsBill.number, TEST_BILL_NUMBER),
          eq(billsBill.sessionId, TEST_SESSION_ID)
        )
      )
      .limit(1);

    if (testBills.length === 0) {
      console.log(
        `❌ Bill ${TEST_BILL_NUMBER} not found in session ${TEST_SESSION_ID}`
      );
      await connection.end();
      return;
    }

    const bill = testBills[0];
    console.log(`   ✓ Found: ${bill.number} - ${bill.nameEn}`);
    console.log("");

    // Step 2: Gather all related entity IDs
    console.log("📊 Analyzing related entities...\n");

    // Get statements mentioning this bill
    const [stmtIdsFromDebate, stmtIdsFromBills, voteQuestions] =
      await Promise.all([
        db
          .selectDistinct({ id: hansardsStatement.id })
          .from(hansardsStatement)
          .where(eq(hansardsStatement.billDebatedId, bill.id)),
        db
          .selectDistinct({ id: hansardsStatementBills.statementId })
          .from(hansardsStatementBills)
          .where(eq(hansardsStatementBills.billId, bill.id)),
        db
          .select()
          .from(billsVotequestion)
          .where(eq(billsVotequestion.billId, bill.id)),
      ]);

    const stmtIds = [
      ...new Set([
        ...stmtIdsFromDebate.map((s) => s.id),
        ...stmtIdsFromBills.map((s) => s.id),
      ]),
    ];

    const voteQuestionIds = voteQuestions.map((vq) => vq.id);

    // Get party and member votes
    const [partyVotes, memberVotes] =
      voteQuestionIds.length > 0
        ? await Promise.all([
            db
              .select()
              .from(billsPartyvote)
              .where(inArray(billsPartyvote.votequestionId, voteQuestionIds)),
            db
              .select()
              .from(billsMembervote)
              .where(inArray(billsMembervote.votequestionId, voteQuestionIds)),
          ])
        : [[], []];

    // Collect politician IDs from statements and votes
    const politicianIdsFromStatements =
      stmtIds.length > 0
        ? (
            await db
              .selectDistinct({ id: hansardsStatement.politicianId })
              .from(hansardsStatement)
              .where(
                and(
                  inArray(hansardsStatement.id, stmtIds),
                  sql`${hansardsStatement.politicianId} IS NOT NULL`
                )
              )
          ).map((r) => r.id as number)
        : [];

    const politicianIdsFromVotes = memberVotes.map((mv) => mv.politicianId);
    const allPoliticianIds = [
      ...new Set([...politicianIdsFromStatements, ...politicianIdsFromVotes]),
    ];

    // Collect party IDs from votes
    const partyIdsFromVotes = [...new Set(partyVotes.map((pv) => pv.partyId))];

    // Get elected members to find ridings
    const electedMembers =
      allPoliticianIds.length > 0
        ? await db
            .select()
            .from(coreElectedmember)
            .where(inArray(coreElectedmember.politicianId, allPoliticianIds))
        : [];

    const ridingIds = [...new Set(electedMembers.map((em) => em.ridingId))];

    // Get session info
    const session = await db
      .select()
      .from(coreSession)
      .where(eq(coreSession.id, TEST_SESSION_ID))
      .limit(1);

    // Get committees from the same session
    const committees = await db.select().from(committeesCommittee).limit(5); // Just get a few committees

    // Get committee reports and meetings from same session
    const [committeeReports, committeeMeetings] = await Promise.all([
      db
        .select()
        .from(committeesCommitteereport)
        .where(eq(committeesCommitteereport.sessionId, TEST_SESSION_ID))
        .limit(5),
      db
        .select()
        .from(committeesCommitteemeeting)
        .where(eq(committeesCommitteemeeting.sessionId, TEST_SESSION_ID))
        .limit(5),
    ]);

    // Get most recent election and candidacies for involved politicians
    const recentElection = await db
      .select()
      .from(electionsElection)
      .where(
        bill.introduced
          ? lte(electionsElection.date, bill.introduced)
          : sql`true`
      )
      .orderBy(desc(electionsElection.date))
      .limit(1);

    const candidacies =
      allPoliticianIds.length > 0 && recentElection.length > 0
        ? await db
            .select()
            .from(electionsCandidacy)
            .where(
              and(
                eq(electionsCandidacy.electionId, recentElection[0].id),
                inArray(electionsCandidacy.candidateId, allPoliticianIds)
              )
            )
        : [];

    // Display summary
    console.log("Document counts:");
    console.log(`   📄 Bill: 1 (${bill.number})`);
    console.log(`   💬 Hansard statements: ${stmtIds.length}`);
    console.log(`   🗳️  Vote questions: ${voteQuestions.length}`);
    console.log(`   🎭 Party votes: ${partyVotes.length}`);
    console.log(`   👤 Member votes: ${memberVotes.length}`);
    console.log(`   🧑‍💼 Politicians: ${allPoliticianIds.length}`);
    console.log(`   🏛️  Parties: ${partyIdsFromVotes.length}`);
    console.log(`   🗺️  Ridings: ${ridingIds.length}`);
    console.log(`   📅 Sessions: ${session.length}`);
    console.log(`   👥 Committees: ${committees.length}`);
    console.log(`   📋 Committee reports: ${committeeReports.length}`);
    console.log(`   📆 Committee meetings: ${committeeMeetings.length}`);
    console.log(`   🗳️  Elections: ${recentElection.length}`);
    console.log(`   🎯 Candidacies: ${candidacies.length}`);
    console.log("   ━━━━━━━━━━━━━━━━━━━━━━");
    const totalDocs =
      1 +
      stmtIds.length +
      voteQuestions.length +
      partyVotes.length +
      memberVotes.length +
      allPoliticianIds.length +
      partyIdsFromVotes.length +
      ridingIds.length +
      session.length +
      committees.length +
      committeeReports.length +
      committeeMeetings.length +
      recentElection.length +
      candidacies.length;
    console.log(`   📦 Total documents: ~${totalDocs}`);
    console.log("");

    // Load lookup maps
    const sessionMap = new Map(session.map((s) => [s.id, s]));
    const allParties = await db.select().from(coreParty);
    const partyById = new Map(allParties.map((p) => [p.id, p]));
    const allPoliticians =
      allPoliticianIds.length > 0
        ? await db
            .select()
            .from(corePolitician)
            .where(inArray(corePolitician.id, allPoliticianIds))
        : [];
    const polById = new Map(allPoliticians.map((p) => [p.id, p]));
    const allRidings =
      ridingIds.length > 0
        ? await db
            .select()
            .from(coreRiding)
            .where(inArray(coreRiding.id, ridingIds))
        : [];
    const ridingById = new Map(allRidings.map((r) => [r.id, r]));

    // ========== PROCESS ALL SOURCE TYPES ==========
    // Pre-load existing resource keys for batch existence checking
    const existingKeysByType = new Map<string, Set<string>>();

    async function getExistingKeys(
      sourceType: ResourceMetadata["sourceType"]
    ): Promise<Set<string>> {
      if (!skipExisting) {
        return new Set();
      }
      if (!existingKeysByType.has(sourceType)) {
        console.log(`   📂 Loading existing ${sourceType} parlResources...`);
        existingKeysByType.set(
          sourceType,
          await loadExistingResourceKeys(sourceType)
        );
      }
      return existingKeysByType.get(sourceType) ?? new Set();
    }

    // 1. BILLS
    console.log("• Processing bill...");
    const existingBillKeys = await getExistingKeys("bill");
    const billRows = await db
      .select({ bill: billsBill, billtext: billsBilltext })
      .from(billsBill)
      .leftJoin(billsBilltext, eq(billsBill.id, billsBilltext.billId))
      .where(eq(billsBill.id, bill.id));

    const allBillChunks: ChunkInput[] = [];
    for (const row of billRows) {
      const b = row.bill;
      const bt = row.billtext;

      const sessInfo = sessionMap.get(b.sessionId);
      const baseMetadata = {
        sourceType: "bill" as const,
        sourceId: b.id,
        sessionId: b.sessionId,
        billNumber: b.number,
        billStatusCode: b.statusCode || undefined,
        billIntroduced: b.introduced
          ? b.introduced.toISOString().slice(0, 10)
          : undefined,
        billStatusDate: b.statusDate
          ? b.statusDate.toISOString().slice(0, 10)
          : undefined,
        institution: (b.institution as "C" | "S") ?? undefined,
        privateMember: b.privatemember ?? undefined,
        law: b.law ?? undefined,
        sessionName: sessInfo?.name ?? undefined,
        parliamentnum: sessInfo?.parliamentnum ?? undefined,
        sessnum: sessInfo?.sessnum ?? undefined,
      };

      // Metadata chunks (EN + FR)
      allBillChunks.push({
        content: billMetadataText(b, "en"),
        metadata: {
          ...baseMetadata,
          language: "en",
          billTitle: b.nameEn || undefined,
          nameEn: b.nameEn || undefined,
          chunkIndex: 0,
        },
      });
      allBillChunks.push({
        content: billMetadataText(b, "fr"),
        metadata: {
          ...baseMetadata,
          language: "fr",
          billTitle: b.nameFr || undefined,
          nameFr: b.nameFr || undefined,
          chunkIndex: 0,
        },
      });

      // Text chunks using semantic chunking
      const billContext: BillContext = {
        number: b.number,
        nameEn: b.nameEn || undefined,
        nameFr: b.nameFr || undefined,
        sessionId: b.sessionId,
      };

      if (bt?.textEn?.trim()) {
        const textChunks = chunkBill(bt.textEn, billContext, "en");
        for (const ch of textChunks) {
          allBillChunks.push({
            content: ch.content,
            metadata: {
              ...baseMetadata,
              language: "en",
              billTitle: b.nameEn || undefined,
              nameEn: b.nameEn || undefined,
              chunkIndex: ch.index,
              ...(ch.section ? { billSection: ch.section } : {}),
            },
          });
        }
      }
      if (bt?.textFr?.trim()) {
        const textChunks = chunkBill(bt.textFr, billContext, "fr");
        for (const ch of textChunks) {
          allBillChunks.push({
            content: ch.content,
            metadata: {
              ...baseMetadata,
              language: "fr",
              billTitle: b.nameFr || undefined,
              nameFr: b.nameFr || undefined,
              chunkIndex: ch.index,
              ...(ch.section ? { billSection: ch.section } : {}),
            },
          });
        }
      }
    }

    const newBillChunks = filterNewChunks(allBillChunks, existingBillKeys);
    const billChunksInserted = await insertChunksBatched(newBillChunks, "bill");
    console.log(
      `   ✅ Inserted ${billChunksInserted} chunks for bill (${allBillChunks.length - newBillChunks.length} skipped)\n`
    );

    // 2. HANSARD STATEMENTS
    console.log("• Processing Hansard statements...");
    if (stmtIds.length === 0) {
      console.log("   ⚠️  No Hansard statements found\n");
    } else {
      const existingHansardKeys = await getExistingKeys("hansard");
      const hansardRows = await db
        .select({ st: hansardsStatement, doc: hansardsDocument })
        .from(hansardsStatement)
        .innerJoin(
          hansardsDocument,
          eq(hansardsStatement.documentId, hansardsDocument.id)
        )
        .where(inArray(hansardsStatement.id, stmtIds));

      const allHansardChunks: ChunkInput[] = [];
      let processed = 0;
      for (const row of hansardRows) {
        const st = row.st;
        const doc = row.doc;

        const headerEn = [st.h1En, st.h2En, st.h3En]
          .filter(Boolean)
          .join(" – ");
        const headerFr = [st.h1Fr, st.h2Fr, st.h3Fr]
          .filter(Boolean)
          .join(" – ");
        const dateIso = st.time?.toISOString();

        // Base metadata including politicianId for better filtering
        const baseHansardMeta = {
          sourceType: "hansard" as const,
          sourceId: st.id,
          documentId: st.documentId,
          sessionId: doc.sessionId,
          statementId: st.id,
          politicianId: st.politicianId ?? undefined, // Added for filtering
          speakerNameEn: st.whoEn || undefined,
          speakerNameFr: st.whoFr || undefined,
          nameEn: headerEn || undefined,
          nameFr: headerFr || undefined,
          docNumber: doc.number || undefined,
          date: dateIso?.slice(0, 10),
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
            allHansardChunks.push({
              content: ch.content,
              metadata: {
                ...baseHansardMeta,
                language: "en",
                chunkIndex: ch.index,
              },
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
            allHansardChunks.push({
              content: ch.content,
              metadata: {
                ...baseHansardMeta,
                language: "fr",
                chunkIndex: ch.index,
              },
            });
          }
        }

        processed++;
        logProgress(processed, hansardRows.length, "Hansard statements");
      }

      const newHansardChunks = filterNewChunks(
        allHansardChunks,
        existingHansardKeys
      );
      const hansardChunksInserted = await insertChunksBatched(
        newHansardChunks,
        "hansard"
      );
      console.log(
        `   ✅ Inserted ${hansardChunksInserted} chunks for ${hansardRows.length} statements (${allHansardChunks.length - newHansardChunks.length} skipped)\n`
      );
    }

    // Create shared vote question lookup map (used by vote_question, vote_party, vote_member)
    const voteQuestionById = new Map(voteQuestions.map((q) => [q.id, q]));

    // 3. VOTE QUESTIONS
    console.log("• Processing vote questions...");
    if (voteQuestions.length === 0) {
      console.log("   ⚠️  No vote questions found\n");
    } else {
      const existingVqKeys = await getExistingKeys("vote_question");
      const allVqChunks: ChunkInput[] = [];

      for (const vq of voteQuestions) {
        const dateIso = vq.date?.toISOString().slice(0, 10);
        const baseMeta = {
          sourceType: "vote_question" as const,
          sourceId: vq.id,
          sessionId: vq.sessionId,
          voteQuestionId: vq.id,
          voteNumber: vq.number,
          billId: vq.billId ?? undefined,
          billNumber: bill.number,
          date: dateIso,
          result: vq.result,
        };

        allVqChunks.push({
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
            chunkIndex: 0,
            title: vq.descriptionEn || undefined,
          },
        });

        allVqChunks.push({
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
            chunkIndex: 0,
            title: vq.descriptionFr || undefined,
          },
        });
      }

      const newVqChunks = filterNewChunks(allVqChunks, existingVqKeys);
      const vqChunksInserted = await insertChunksBatched(
        newVqChunks,
        "vote_question"
      );
      console.log(
        `   ✅ Inserted ${vqChunksInserted} chunks for ${voteQuestions.length} vote questions (${allVqChunks.length - newVqChunks.length} skipped)\n`
      );
    }

    // 4. PARTY VOTES
    console.log("• Processing party votes...");
    if (partyVotes.length === 0) {
      console.log("   ⚠️  No party votes found\n");
    } else {
      const existingPvKeys = await getExistingKeys("vote_party");
      const allPvChunks: ChunkInput[] = [];

      for (const v of partyVotes) {
        const q = voteQuestionById.get(v.votequestionId);
        const p = partyById.get(v.partyId);
        if (!q || !p) {
          continue;
        }

        const dateIso = q.date?.toISOString().slice(0, 10);
        const baseMeta = {
          sourceType: "vote_party" as const,
          sourceId: v.id,
          partyVoteId: v.id, // Required for hydration
          sessionId: q.sessionId,
          voteQuestionId: q.id,
          voteNumber: q.number,
          partyId: p.id,
          partyNameEn: p.nameEn,
          partyNameFr: p.nameFr,
          partyShortEn: p.shortNameEn || undefined,
          partyShortFr: p.shortNameFr || undefined,
          date: dateIso,
          result: v.vote,
        };

        allPvChunks.push({
          content: [
            `Party vote: ${p.nameEn} (${p.shortNameEn})`,
            `Vote: ${v.vote}`,
            `Question #${q.number}`,
            q.descriptionEn && `Description: ${q.descriptionEn}`,
            dateIso && `Date: ${dateIso}`,
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: { ...baseMeta, language: "en", chunkIndex: 0 },
        });

        allPvChunks.push({
          content: [
            `Vote du parti: ${p.nameFr} (${p.shortNameFr})`,
            `Vote: ${v.vote}`,
            `Question n° ${q.number}`,
            q.descriptionFr && `Description: ${q.descriptionFr}`,
            dateIso && `Date: ${dateIso}`,
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: { ...baseMeta, language: "fr", chunkIndex: 0 },
        });
      }

      const newPvChunks = filterNewChunks(allPvChunks, existingPvKeys);
      const pvChunksInserted = await insertChunksBatched(
        newPvChunks,
        "vote_party"
      );
      console.log(
        `   ✅ Inserted ${pvChunksInserted} chunks for ${partyVotes.length} party votes (${allPvChunks.length - newPvChunks.length} skipped)\n`
      );
    }

    // 5. MEMBER VOTES
    console.log("• Processing member votes...");
    if (memberVotes.length === 0) {
      console.log("   ⚠️  No member votes found\n");
    } else {
      const existingMvKeys = await getExistingKeys("vote_member");
      const allMvChunks: ChunkInput[] = [];
      let processed = 0;

      for (const v of memberVotes) {
        const q = voteQuestionById.get(v.votequestionId);
        const p = polById.get(v.politicianId);
        if (!q || !p) {
          continue;
        }

        const dateIso = q.date?.toISOString().slice(0, 10);
        const baseMeta = {
          sourceType: "vote_member" as const,
          sourceId: v.id,
          memberVoteId: v.id,
          sessionId: q.sessionId,
          voteQuestionId: q.id,
          voteNumber: q.number,
          politicianId: p.id,
          politicianName: p.name,
          date: dateIso,
          result: v.vote,
        };

        allMvChunks.push({
          content: [
            `Member vote: ${p.name}`,
            `Vote: ${v.vote}`,
            `Question #${q.number}`,
            q.descriptionEn && `Description: ${q.descriptionEn}`,
            dateIso && `Date: ${dateIso}`,
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: { ...baseMeta, language: "en", chunkIndex: 0 },
        });

        allMvChunks.push({
          content: [
            `Vote du député/de la députée: ${p.name}`,
            `Vote: ${v.vote}`,
            `Question n° ${q.number}`,
            q.descriptionFr && `Description: ${q.descriptionFr}`,
            dateIso && `Date: ${dateIso}`,
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: { ...baseMeta, language: "fr", chunkIndex: 0 },
        });

        processed++;
        logProgress(processed, memberVotes.length, "Member votes");
      }

      const newMvChunks = filterNewChunks(allMvChunks, existingMvKeys);
      const mvChunksInserted = await insertChunksBatched(
        newMvChunks,
        "vote_member"
      );
      console.log(
        `   ✅ Inserted ${mvChunksInserted} chunks for ${memberVotes.length} member votes (${allMvChunks.length - newMvChunks.length} skipped)\n`
      );
    }

    // 6. POLITICIANS
    console.log("• Processing politicians...");
    if (allPoliticians.length === 0) {
      console.log("   ⚠️  No politicians found\n");
    } else {
      const existingPolKeys = await getExistingKeys("politician");
      const allPolChunks: ChunkInput[] = [];

      for (const p of allPoliticians) {
        const baseMeta = {
          sourceType: "politician" as const,
          sourceId: p.id,
          politicianId: p.id, // Required for hydration
          title: p.name,
          politicianName: p.name,
        };

        allPolChunks.push({
          content: [`Politician: ${p.name}`, p.slug && `Slug: ${p.slug}`]
            .filter(Boolean)
            .join("\n"),
          metadata: {
            ...baseMeta,
            language: "en",
            chunkIndex: 0,
            nameEn: p.name,
          },
        });

        allPolChunks.push({
          content: [
            `Politicien/ne: ${p.name}`,
            p.slug && `Identifiant: ${p.slug}`,
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: {
            ...baseMeta,
            language: "fr",
            chunkIndex: 0,
            nameFr: p.name,
          },
        });
      }

      const newPolChunks = filterNewChunks(allPolChunks, existingPolKeys);
      const polChunksInserted = await insertChunksBatched(
        newPolChunks,
        "politician"
      );
      console.log(
        `   ✅ Inserted ${polChunksInserted} chunks for ${allPoliticians.length} politicians (${allPolChunks.length - newPolChunks.length} skipped)\n`
      );
    }

    // 7. PARTIES
    console.log("• Processing parties...");
    const involvedParties = allParties.filter((p) =>
      partyIdsFromVotes.includes(p.id)
    );
    if (involvedParties.length === 0) {
      console.log("   ⚠️  No parties found\n");
    } else {
      const existingPartyKeys = await getExistingKeys("party");
      const allPartyChunks: ChunkInput[] = [];

      for (const p of involvedParties) {
        const baseMeta = {
          sourceType: "party" as const,
          sourceId: p.id,
          partyId: p.id, // Required for hydration
          partyNameEn: p.nameEn,
          partyNameFr: p.nameFr,
          partyShortEn: p.shortNameEn || undefined,
          partyShortFr: p.shortNameFr || undefined,
        };

        allPartyChunks.push({
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
            chunkIndex: 0,
            title: p.nameEn,
            nameEn: p.nameEn,
          },
        });

        allPartyChunks.push({
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
            chunkIndex: 0,
            title: p.nameFr,
            nameFr: p.nameFr,
          },
        });
      }

      const newPartyChunks = filterNewChunks(allPartyChunks, existingPartyKeys);
      const partyChunksInserted = await insertChunksBatched(
        newPartyChunks,
        "party"
      );
      console.log(
        `   ✅ Inserted ${partyChunksInserted} chunks for ${involvedParties.length} parties (${allPartyChunks.length - newPartyChunks.length} skipped)\n`
      );
    }

    // 8. RIDINGS
    console.log("• Processing ridings...");
    if (allRidings.length === 0) {
      console.log("   ⚠️  No ridings found\n");
    } else {
      const existingRidingKeys = await getExistingKeys("riding");
      const allRidingChunks: ChunkInput[] = [];

      for (const r of allRidings) {
        const baseMeta = {
          sourceType: "riding" as const,
          sourceId: r.id,
          ridingId: r.id, // Required for hydration
          ridingNameEn: r.nameEn,
          ridingNameFr: r.nameFr,
          province: r.province,
        };

        allRidingChunks.push({
          content: [
            `Riding: ${r.nameEn}`,
            `Province: ${r.province}`,
            `Current: ${r.current ? "Yes" : "No"}`,
          ].join("\n"),
          metadata: {
            ...baseMeta,
            language: "en",
            chunkIndex: 0,
            title: r.nameEn,
          },
        });

        allRidingChunks.push({
          content: [
            `Circonscription: ${r.nameFr}`,
            `Province: ${r.province}`,
            `Actuelle: ${r.current ? "Oui" : "Non"}`,
          ].join("\n"),
          metadata: {
            ...baseMeta,
            language: "fr",
            chunkIndex: 0,
            title: r.nameFr,
          },
        });
      }

      const newRidingChunks = filterNewChunks(
        allRidingChunks,
        existingRidingKeys
      );
      const ridingChunksInserted = await insertChunksBatched(
        newRidingChunks,
        "riding"
      );
      console.log(
        `   ✅ Inserted ${ridingChunksInserted} chunks for ${allRidings.length} ridings (${allRidingChunks.length - newRidingChunks.length} skipped)\n`
      );
    }

    // 9. SESSION
    console.log("• Processing session...");
    if (session.length === 0) {
      console.log("   ⚠️  No session found\n");
    } else {
      const existingSessKeys = await getExistingKeys("session");
      const allSessChunks: ChunkInput[] = [];

      for (const s of session) {
        const dStart = s.start?.toISOString().slice(0, 10);
        const dEnd = s.end?.toISOString().slice(0, 10);
        const baseMeta = {
          sourceType: "session" as const,
          sourceId: s.id,
          sessionId: s.id, // Required for hydration (e.g., "44-1")
          sessionName: s.name,
          parliamentnum: s.parliamentnum ?? undefined,
          sessnum: s.sessnum ?? undefined,
        };

        allSessChunks.push({
          content: [
            `Session ${s.id} – ${s.name}`,
            dStart && `Start: ${dStart}`,
            dEnd && `End: ${dEnd}`,
            s.parliamentnum && `Parliament: ${s.parliamentnum}`,
            s.sessnum && `Session #: ${s.sessnum}`,
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: { ...baseMeta, language: "en", chunkIndex: 0 },
        });

        allSessChunks.push({
          content: [
            `Session ${s.id} – ${s.name}`,
            dStart && `Début: ${dStart}`,
            dEnd && `Fin: ${dEnd}`,
            s.parliamentnum && `Législature: ${s.parliamentnum}`,
            s.sessnum && `Session n°: ${s.sessnum}`,
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: { ...baseMeta, language: "fr", chunkIndex: 0 },
        });
      }

      const newSessChunks = filterNewChunks(allSessChunks, existingSessKeys);
      const sessChunksInserted = await insertChunksBatched(
        newSessChunks,
        "session"
      );
      console.log(
        `   ✅ Inserted ${sessChunksInserted} chunks for ${session.length} session (${allSessChunks.length - newSessChunks.length} skipped)\n`
      );
    }

    // 10. COMMITTEES
    console.log("• Processing committees...");
    if (committees.length === 0) {
      console.log("   ⚠️  No committees found\n");
    } else {
      const existingCommKeys = await getExistingKeys("committee");
      const allCommChunks: ChunkInput[] = [];

      for (const c of committees) {
        const baseMeta = {
          sourceType: "committee" as const,
          sourceId: c.id,
          committeeId: c.id,
          committeeSlug: c.slug,
          committeeNameEn: c.nameEn,
          committeeNameFr: c.nameFr,
          nameEn: c.nameEn,
          nameFr: c.nameFr,
        };

        allCommChunks.push({
          content: [
            `Committee: ${c.nameEn}`,
            c.shortNameEn && `Short: ${c.shortNameEn}`,
            `Slug: ${c.slug}`,
            `Joint: ${c.joint ? "Yes" : "No"}`,
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: {
            ...baseMeta,
            language: "en",
            chunkIndex: 0,
            title: c.nameEn,
          },
        });

        allCommChunks.push({
          content: [
            `Comité: ${c.nameFr}`,
            c.shortNameFr && `Abrégé: ${c.shortNameFr}`,
            `Identifiant: ${c.slug}`,
            `Mixte: ${c.joint ? "Oui" : "Non"}`,
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: {
            ...baseMeta,
            language: "fr",
            chunkIndex: 0,
            title: c.nameFr,
          },
        });
      }

      const newCommChunks = filterNewChunks(allCommChunks, existingCommKeys);
      const commChunksInserted = await insertChunksBatched(
        newCommChunks,
        "committee"
      );
      console.log(
        `   ✅ Inserted ${commChunksInserted} chunks for ${committees.length} committees (${allCommChunks.length - newCommChunks.length} skipped)\n`
      );
    }

    // 11. COMMITTEE REPORTS
    console.log("• Processing committee reports...");
    if (committeeReports.length === 0) {
      console.log("   ⚠️  No committee reports found\n");
    } else {
      const existingReportKeys = await getExistingKeys("committee_report");
      const allReportChunks: ChunkInput[] = [];

      for (const r of committeeReports) {
        const baseMeta = {
          sourceType: "committee_report" as const,
          sourceId: r.id,
          reportId: r.id, // Required for hydration
          committeeId: r.committeeId ?? undefined,
          sessionId: r.sessionId ?? undefined,
        };

        allReportChunks.push({
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
          metadata: {
            ...baseMeta,
            language: "en",
            chunkIndex: 0,
            title: r.nameEn,
          },
        });

        allReportChunks.push({
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
          metadata: {
            ...baseMeta,
            language: "fr",
            chunkIndex: 0,
            title: r.nameFr,
          },
        });
      }

      const newReportChunks = filterNewChunks(
        allReportChunks,
        existingReportKeys
      );
      const reportChunksInserted = await insertChunksBatched(
        newReportChunks,
        "committee_report"
      );
      console.log(
        `   ✅ Inserted ${reportChunksInserted} chunks for ${committeeReports.length} committee reports (${allReportChunks.length - newReportChunks.length} skipped)\n`
      );
    }

    // 12. COMMITTEE MEETINGS
    console.log("• Processing committee meetings...");
    if (committeeMeetings.length === 0) {
      console.log("   ⚠️  No committee meetings found\n");
    } else {
      const existingMeetingKeys = await getExistingKeys("committee_meeting");
      const allMeetingChunks: ChunkInput[] = [];

      for (const m of committeeMeetings) {
        const d = m.date?.toISOString().slice(0, 10);
        const baseMeta = {
          sourceType: "committee_meeting" as const,
          sourceId: m.id,
          meetingId: m.id, // Required for hydration
          sessionId: m.sessionId,
          date: d,
        };

        allMeetingChunks.push({
          content: [
            `Committee Meeting #${m.number}`,
            d ? `Date: ${d}` : undefined,
            m.sessionId ? `Session: ${m.sessionId}` : undefined,
            `Webcast: ${m.webcast ? "Yes" : "No"}`,
            `Televised: ${m.televised ? "Yes" : "No"}`,
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: { ...baseMeta, language: "en", chunkIndex: 0 },
        });

        allMeetingChunks.push({
          content: [
            `Réunion du comité n° ${m.number}`,
            d ? `Date: ${d}` : undefined,
            m.sessionId ? `Session: ${m.sessionId}` : undefined,
            `Diffusé sur le Web: ${m.webcast ? "Oui" : "Non"}`,
            `Télévisé: ${m.televised ? "Oui" : "Non"}`,
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: { ...baseMeta, language: "fr", chunkIndex: 0 },
        });
      }

      const newMeetingChunks = filterNewChunks(
        allMeetingChunks,
        existingMeetingKeys
      );
      const meetingChunksInserted = await insertChunksBatched(
        newMeetingChunks,
        "committee_meeting"
      );
      console.log(
        `   ✅ Inserted ${meetingChunksInserted} chunks for ${committeeMeetings.length} committee meetings (${allMeetingChunks.length - newMeetingChunks.length} skipped)\n`
      );
    }

    // 13. ELECTIONS
    console.log("• Processing elections...");
    if (recentElection.length === 0) {
      console.log("   ⚠️  No elections found\n");
    } else {
      const existingElectionKeys = await getExistingKeys("election");
      const allElectionChunks: ChunkInput[] = [];

      for (const e of recentElection) {
        const d = e.date?.toISOString().slice(0, 10);
        const baseMeta = {
          sourceType: "election" as const,
          sourceId: e.id,
          electionId: e.id, // Required for hydration
          date: d,
        };

        allElectionChunks.push({
          content: [
            "Election",
            d && `Date: ${d}`,
            `By-election: ${e.byelection ? "Yes" : "No"}`,
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: { ...baseMeta, language: "en", chunkIndex: 0 },
        });

        allElectionChunks.push({
          content: [
            "Élection",
            d && `Date: ${d}`,
            `Élection partielle: ${e.byelection ? "Oui" : "Non"}`,
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: { ...baseMeta, language: "fr", chunkIndex: 0 },
        });
      }

      const newElectionChunks = filterNewChunks(
        allElectionChunks,
        existingElectionKeys
      );
      const electionChunksInserted = await insertChunksBatched(
        newElectionChunks,
        "election"
      );
      console.log(
        `   ✅ Inserted ${electionChunksInserted} chunks for ${recentElection.length} election (${allElectionChunks.length - newElectionChunks.length} skipped)\n`
      );
    }

    // 14. CANDIDACIES
    console.log("• Processing candidacies...");
    if (candidacies.length === 0) {
      console.log("   ⚠️  No candidacies found\n");
    } else {
      const existingCandKeys = await getExistingKeys("candidacy");
      const allCandChunks: ChunkInput[] = [];
      const election = recentElection[0];
      const electionDateIso = election?.date?.toISOString().slice(0, 10);

      for (const c of candidacies) {
        const pol = polById.get(c.candidateId);
        const party = partyById.get(c.partyId);
        const riding = ridingById.get(c.ridingId);

        const baseMeta = {
          sourceType: "candidacy" as const,
          sourceId: c.id,
          candidacyId: c.id, // Required for hydration
          electionId: c.electionId,
          ridingId: c.ridingId,
          partyId: c.partyId,
          politicianId: c.candidateId,
          date: electionDateIso,
          politicianName: pol?.name,
          partyNameEn: party?.nameEn,
          partyNameFr: party?.nameFr,
          ridingNameEn: riding?.nameEn,
          ridingNameFr: riding?.nameFr,
          province: riding?.province,
        };

        allCandChunks.push({
          content: [
            `Candidacy: ${pol?.name ?? c.candidateId}`,
            party ? `Party: ${party.nameEn}` : undefined,
            riding ? `Riding: ${riding.nameEn}, ${riding.province}` : undefined,
            electionDateIso ? `Election Date: ${electionDateIso}` : undefined,
            c.votepercent != null ? `Vote %: ${c.votepercent}` : undefined,
            c.votetotal != null ? `Votes: ${c.votetotal}` : undefined,
            c.elected != null
              ? `Elected: ${c.elected ? "Yes" : "No"}`
              : undefined,
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: { ...baseMeta, language: "en", chunkIndex: 0 },
        });

        allCandChunks.push({
          content: [
            `Candidature: ${pol?.name ?? c.candidateId}`,
            party ? `Parti: ${party.nameFr}` : undefined,
            riding
              ? `Circonscription: ${riding.nameFr}, ${riding.province}`
              : undefined,
            electionDateIso
              ? `Date de l'élection: ${electionDateIso}`
              : undefined,
            c.votepercent != null
              ? `Pourcentage de votes: ${c.votepercent}`
              : undefined,
            c.votetotal != null ? `Votes: ${c.votetotal}` : undefined,
            c.elected != null
              ? `Élu(e): ${c.elected ? "Oui" : "Non"}`
              : undefined,
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: { ...baseMeta, language: "fr", chunkIndex: 0 },
        });
      }

      const newCandChunks = filterNewChunks(allCandChunks, existingCandKeys);
      const candChunksInserted = await insertChunksBatched(
        newCandChunks,
        "candidacy"
      );
      console.log(
        `   ✅ Inserted ${candChunksInserted} chunks for ${candidacies.length} candidacies (${allCandChunks.length - newCandChunks.length} skipped)\n`
      );
    }

    console.log("✨ Test embedding generation complete!\n");
  } catch (err) {
    console.error("\n❌ Fatal error:", err);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
