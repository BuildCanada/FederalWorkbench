import crypto from "node:crypto";
import { cohere } from "@ai-sdk/cohere";
import { embed, embedMany } from "ai";
import { cacheGet, cacheSet } from "@/lib/cache/redis";
import { ragDebug } from "@/lib/rag/parliament/debug";
import { CACHE_TTL, isRagCacheDisabled } from "@/lib/rag/shared/constants";

/**
 * Cohere Embedding Model Configuration
 *
 * Using embed-multilingual-v3.0:
 * - Dimensions: 1024 (not 1536 as initially planned)
 * - Supports 100+ languages including English and French
 * - Input types: search_document (for indexing), search_query (for queries)
 * - Max tokens: ~2048 tokens per input
 *
 * Note: The AI SDK currently supports v3.0 models.
 * If v4.0 becomes available with 1536 dimensions, we can migrate later.
 */
const embeddingModel = cohere.textEmbeddingModel("embed-multilingual-v3.0");

/**
 * Generate a single embedding for a query
 *
 * Use this for user search queries. The inputType is set to 'search_query'
 * to optimize the embedding for retrieval tasks.
 *
 * @param text - The text to embed (e.g., user query)
 * @returns Promise<number[]> - The embedding vector (1024 dimensions)
 */
const dbg = ragDebug("embed");

export async function generateEmbedding(text: string): Promise<number[]> {
  // Normalize whitespace: replace newlines with spaces
  const normalizedText = text.replace(/\n/g, " ").trim();
  const cacheDisabled = isRagCacheDisabled();

  if (!cacheDisabled) {
    const key = `emb:${crypto.createHash("sha1").update(normalizedText).digest("hex")}`;
    const cached = await cacheGet(key);
    if (cached) {
      try {
        const arr = JSON.parse(cached) as number[];
        dbg("cache hit %s", key);
        return arr;
      } catch {
        // ignore JSON parse errors, refetch embedding
      }
    }
  }

  const { embedding } = await embed({
    model: embeddingModel,
    value: normalizedText,
    providerOptions: {
      cohere: {
        inputType: "search_query", // Optimized for query embedding
        truncate: "END", // Truncate from end if text is too long
      },
    },
  });

  if (!cacheDisabled) {
    const key = `emb:${crypto.createHash("sha1").update(normalizedText).digest("hex")}`;
    await cacheSet(key, JSON.stringify(embedding), CACHE_TTL.EMBEDDING);
  }

  return embedding;
}

/**
 * Generate embeddings for multiple documents in batch
 *
 * Use this for indexing document chunks. The inputType is set to 'search_document'
 * to optimize embeddings for document storage.
 *
 * The AI SDK automatically handles:
 * - Batching if there are model limits
 * - Retries on failure (up to maxRetries)
 * - Rate limiting
 *
 * @param texts - Array of text chunks to embed
 * @param maxRetries - Maximum retry attempts (default: 2)
 * @returns Promise<number[][]> - Array of embedding vectors (each 1024 dimensions)
 */
export async function generateEmbeddings(
  texts: string[],
  maxRetries = 2
): Promise<number[][]> {
  // Normalize all texts
  const normalizedTexts = texts.map((text) => text.replace(/\n/g, " ").trim());

  const { embeddings } = await embedMany({
    model: embeddingModel,
    values: normalizedTexts,
    maxRetries,
    providerOptions: {
      cohere: {
        inputType: "search_document", // Optimized for document embedding
        truncate: "END", // Truncate from end if text is too long
      },
    },
  });

  return embeddings;
}

/**
 * Get the embedding dimensions for the current model
 * @returns The number of dimensions in the embedding vector
 */
export function getEmbeddingDimensions(): number {
  return 1024; // embed-multilingual-v3.0 dimensions
}
