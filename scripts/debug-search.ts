/**
 * Debug script to test embedding generation and vector search
 */

import { config } from "dotenv";

config({ path: ".env.local" });

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { generateEmbedding } from "@/lib/ai/embeddings";
import { parlEmbeddings, parlResources } from "@/lib/db/rag/schema";

async function main() {
  console.log("\n🔍 Debug: Embedding & Vector Search Test\n");

  // 1. Test embedding generation
  console.log("1️⃣ Testing embedding generation...");
  const query = "What is Bill C-2?";
  console.log(`   Query: "${query}"`);

  try {
    const embedding = await generateEmbedding(query);
    console.log(`   ✅ Generated embedding: ${embedding.length} dimensions`);
    console.log(`   First 5 values: [${embedding.slice(0, 5).join(", ")}...]`);

    // 2. Test database connection and vector search
    console.log("\n2️⃣ Testing vector search in database...");
    const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!dbUrl) {
      throw new Error("DATABASE_URL or POSTGRES_URL not set");
    }

    const connection = postgres(dbUrl);
    const db = drizzle(connection);

    const embeddingVector = `[${embedding.join(",")}]`;

    // Test without threshold to see all similarities
    console.log("   Testing WITHOUT similarity threshold...");
    const allResults = await db
      .select({
        billNumber: sql<string>`${parlResources.metadata}->>'billNumber'`,
        language: sql<string>`${parlResources.metadata}->>'language'`,
        sourceType: sql<string>`${parlResources.metadata}->>'sourceType'`,
        similarity: sql<number>`1 - (${parlEmbeddings.embedding} <=> ${embeddingVector}::vector)`,
        contentPreview: sql<string>`LEFT(${parlEmbeddings.content}, 80)`,
      })
      .from(parlEmbeddings)
      .innerJoin(
        parlResources,
        sql`${parlEmbeddings.resourceId} = ${parlResources.id}`
      )
      .where(sql`${parlResources.metadata}->>'sourceType' = 'bill'`)
      .orderBy(
        sql`${parlEmbeddings.embedding} <=> ${embeddingVector}::vector ASC`
      )
      .limit(10);

    console.log(`   Found ${allResults.length} results:`);
    for (const r of allResults) {
      console.log(
        `   - Bill ${r.billNumber} (${r.language}): similarity=${(r.similarity * 100).toFixed(2)}%`
      );
      console.log(`     "${r.contentPreview}..."`);
    }

    // Test with 0.7 threshold
    console.log("\n   Testing WITH 0.7 threshold...");
    const filteredResults = await db
      .select({
        billNumber: sql<string>`${parlResources.metadata}->>'billNumber'`,
        language: sql<string>`${parlResources.metadata}->>'language'`,
        similarity: sql<number>`1 - (${parlEmbeddings.embedding} <=> ${embeddingVector}::vector)`,
      })
      .from(parlEmbeddings)
      .innerJoin(
        parlResources,
        sql`${parlEmbeddings.resourceId} = ${parlResources.id}`
      )
      .where(
        sql`${parlResources.metadata}->>'sourceType' = 'bill'
            AND (1 - (${parlEmbeddings.embedding} <=> ${embeddingVector}::vector)) >= 0.7`
      )
      .orderBy(
        sql`${parlEmbeddings.embedding} <=> ${embeddingVector}::vector ASC`
      )
      .limit(10);

    console.log(
      `   Found ${filteredResults.length} results with similarity >= 0.7`
    );

    await connection.end();
  } catch (err) {
    console.error("   ❌ Error:", err);
    process.exit(1);
  }

  console.log("\n✨ Done\n");
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
