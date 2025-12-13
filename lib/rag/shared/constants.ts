/**
 * Shared RAG System Constants
 *
 * Centralized configuration shared between parliament and legislation RAG systems.
 * These constants are domain-agnostic and apply to both retrieval contexts.
 */

/**
 * Cache TTL values in seconds
 */
export const CACHE_TTL = {
  /** Embeddings are deterministic and expensive to compute - cache for 24 hours */
  EMBEDDING: 86_400, // 24 hours

  /** Search results can change as data updates - cache for 1 hour */
  SEARCH_RESULTS: 3600, // 1 hour

  /** Parliament context for queries - cache for 1 hour */
  PARLIAMENT_CONTEXT: 3600, // 1 hour

  /** Rerank results - cache for 1 hour (tied to search results) */
  RERANK_RESULTS: 3600, // 1 hour
} as const;

/**
 * Search limits and thresholds
 */
export const SEARCH_LIMITS = {
  /** Default number of results to return */
  DEFAULT_LIMIT: 10,

  /** Maximum allowed limit to prevent over-fetching */
  MAX_LIMIT: 100,

  /** Minimum similarity score for results (0-1 scale) */
  DEFAULT_SIMILARITY_THRESHOLD: 0.4,
} as const;

/**
 * Reranker configuration
 *
 * Cross-encoder reranking improves retrieval quality by considering
 * query-document pairs together, rather than comparing embeddings separately.
 */
export const RERANKER_CONFIG = {
  /** Cohere reranking model - multilingual v3.5 for EN/FR support */
  MODEL: "rerank-multilingual-v3.0" as const,

  /** Default number of top results to return after reranking */
  DEFAULT_TOP_N: 10,

  /** Number of candidates to retrieve before reranking (higher = better recall) */
  VECTOR_SEARCH_CANDIDATES: 50,

  /** Maximum tokens per document for reranking (controls cost/quality tradeoff) */
  MAX_TOKENS_PER_DOC: 1000,

  /** Minimum rerank score to include in results (0-1 scale) */
  MIN_RERANK_SCORE: 0.1,
} as const;

/**
 * Hybrid search configuration
 *
 * Combines vector (semantic) and keyword (BM25-style) search for better
 * retrieval of exact matches (bill numbers, names) alongside semantic matches.
 */
export const HYBRID_SEARCH_CONFIG = {
  /** Weight for vector similarity score (0-1) */
  VECTOR_WEIGHT: 0.7,

  /** Weight for keyword/full-text score (0-1) */
  KEYWORD_WEIGHT: 0.3,

  /** Boost for exact keyword matches */
  EXACT_MATCH_BOOST: 0.15,
} as const;

/**
 * Check if RAG caching is disabled via environment variable
 */
export function isRagCacheDisabled(): boolean {
  const value = process.env.RAG_CACHE_DISABLE;
  return value === "true" || value === "1";
}
