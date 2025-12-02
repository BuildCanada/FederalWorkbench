# RAG System Documentation

The Retrieval-Augmented Generation (RAG) system powers the Parliament chatbot by retrieving relevant Canadian Parliament data to provide grounded, accurate responses with citations.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           User Query                                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│      Query Analysis (query-analysis.ts + intent-config.ts)              │
│  - Language detection (LLM + heuristic fallback)                        │
│  - Priority intent → deterministic search types & citation allowlist    │
│  - Query reformulations (2) for multi-query search                      │
│  - Enumeration detection (votes, politicians, committees)               │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                 ┌──────────────────┴──────────────────┐
                 │                                     │
                 ▼                                     ▼
┌────────────────────────────────────────────────┐   (fallback to search)
│     Enumeration Fast-Path (enumeration.ts)     │
│  - Complete vote lists or MP lists with cites  │
│  - Bill hydration for vote enumerations        │
└────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│   Multi-Query Search (multi-query.ts / search.ts)                       │
│  - Original + reformulations across intent-selected source types        │
│  - Ensures bill sources are included when a bill number is detected     │
│  - Hybrid search (search-utils.ts): vector + keyword with caching       │
│  - Candidates per query ~25 (split from VECTOR_SEARCH_CANDIDATES)       │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│   Reranking & Filtering (reranking.ts / reranker.ts)                    │
│  - Cohere rerank-multilingual-v3.0 cross-encoder                        │
│  - Diversity + intent-based citation slot allocation                    │
│  - Adaptive filtering + allowed-citation enforcement                    │
│  - Heuristic fallback if reranker fails                                 │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              Hydration (hydrate-dispatcher.ts)                          │
│  - Top result per source type fetched from DB                           │
│  - Bill hydration requires number + session metadata                    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│             Context Building (context-builder.ts)                       │
│  - Trusts reranker order; dedup snippets                                 │
│  - Numbered citations with snippet truncation                           │
│  - Language-specific preface and sources list                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           LLM Response                                   │
│  System prompt includes: context snippets, hydrated sources, citations  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Embedding Generation (`lib/ai/embeddings.ts`)

Uses Cohere's `embed-multilingual-v3.0` model for bilingual (EN/FR) support:

- **Dimensions**: 1024 vectors
- **Query embeddings**: Uses `search_query` input type
- **Document embeddings**: Uses `search_document` input type
- **Caching**: 24-hour Redis cache for embeddings

```typescript
// Query embedding
const embedding = await generateEmbedding("What is Bill C-11?");

// Batch document embedding
const embeddings = await generateEmbeddings(["chunk1", "chunk2"], 3);
```

### 2. Semantic Chunking (`lib/rag/parliament/semantic-chunking.ts`, `lib/rag/shared/chunking.ts`)

Structure-aware chunking with contextual headers:

- **Bills**: Split at PART/DIVISION/SCHEDULE/SUMMARY markers, prepend headers with bill number, name, session, and section; fall back to character chunking when needed.
- **Hansard**: Strip HTML, split on paragraphs, add speaker/date/document headers before chunking.
- **Fallback**: Shared `chunkText` keeps 4800-character chunks with 800-character overlap and sentence-aware breaks.

```typescript
const billChunks = chunkBill(text, { number: "C-11", sessionId: "44-1" });
const hansardChunks = chunkHansard(statement, { speakerName: "Prime Minister" });
```

### 3. Query Analysis (`lib/rag/parliament/query-analysis.ts`, `lib/rag/parliament/intent-config.ts`)

Unified LLM analysis drives the pipeline:

- **Priority intent** → deterministic search types and citation allowlist from `intent-config.ts`.
- **Language detection** with heuristic fallback; **reformulations** (2) stay in the same language.
- **Enumeration detection**: vote lists, MP lists, or committee lists take a fast path; bill numbers extracted heuristically to force bill search.
- **Standalone helpers**: `detectSearchTypes` and `generateQueryReformulations` are available for legacy callers.

```typescript
const analysis = await analyzeQuery("Who voted against Bill C-11?");
// { language: "en", priorityIntent: "vote_focused", searchTypes: { memberVotes: true, ... }, reformulatedQueries: [...] }
```

### 4. Multi-Query Search (`lib/rag/parliament/multi-query.ts`, `lib/rag/parliament/search.ts`, `lib/rag/parliament/search-utils.ts`)

Hybrid retrieval across intent-selected sources:

- Runs the original query plus reformulations across enabled source types; bills are forced in when a bill number is detected.
- `executeVectorSearch` combines pgvector cosine similarity with `tsvector` keyword search (0.7 vector, 0.3 keyword), caches for 1 hour, and retries without language filter on zero hits.
- Candidates per query are capped to roughly half of `VECTOR_SEARCH_CANDIDATES` (min 20) to feed reranking with diverse results.

```typescript
const results = await multiQuerySearch(analysis, 20);
// searchParliament uses source-specific search functions under the hood
```

### 5. Reranking & Filtering (`lib/rag/parliament/reranking.ts`, `lib/rag/parliament/reranker.ts`, `lib/rag/parliament/adaptive-filter.ts`)

Cross-encoder reranking with intent-aware controls:

- Deduplicates by `(sourceType, sourceId, chunkIndex)`, then Cohere `rerank-multilingual-v3.0` reranks with cacheable results.
- `ensureSourceDiversity` and `allocateCitationSlots` keep primary sources for the detected intent; `filterByAllowedCitations` enforces the intent allowlist.
- `adaptiveFilter` applies relative thresholds with a minimum score floor; reranker failures fall back to heuristic boosts (language +0.12, intent/type +0.03, recency +0.01).

```typescript
const ranked = await deduplicateAndRerank(candidates, 10, analysis);
```

### 6. Hydration (`lib/rag/parliament/hydrate-dispatcher.ts`)

Enriches top search results with full database context:

- Hydrates the top result per source type in parallel; bills require `billNumber` + `sessionId` metadata.
- Enumeration of vote lists hydrates the related bill so the UI can show full text.
- Returns language used and optional notes for downstream prompts.

### 7. Context Building (`lib/rag/parliament/context-builder.ts`)

Assembles final LLM context:

- Respects reranker ordering, deduplicates repeated snippets, and truncates to ~480 characters at sentence boundaries.
- Prefixes citations with `P` to avoid collisions with legislation RAG and adds a language-specific preface plus sources list.

## Data Sources

The system indexes 14 source types from the Parliament database:

| Source Type | Description | Chunked |
|-------------|-------------|---------|
| `bill` | Legislation text and metadata | Yes |
| `hansard` | Parliamentary debate transcripts | Yes |
| `vote_question` | Vote descriptions and results | No |
| `vote_party` | Party voting records | No |
| `vote_member` | Individual MP voting records | No |
| `politician` | MP profiles | No |
| `committee` | Committee information | No |
| `committee_report` | Committee reports | No |
| `committee_meeting` | Committee meeting records | No |
| `party` | Political party information | No |
| `election` | Election records | No |
| `candidacy` | Candidate information | No |
| `session` | Parliamentary sessions | No |
| `riding` | Electoral district information | No |

## Database Schema

### Resources Table (`lib/db/rag/schema.ts`)

Stores content chunks with rich metadata:

```typescript
type ResourceMetadata = {
  sourceType: "bill" | "hansard" | "committee" | ...;
  sourceId: number | string;
  sessionId?: string;       // e.g., "45-1"
  chunkIndex?: number;      // 0 for metadata, 1+ for text
  language?: "en" | "fr";
  billNumber?: string;      // e.g., "C-11"
  // ... source-specific fields
};
```

### Embeddings Table

Vector storage with HNSW index and `tsvector` for hybrid search:

```sql
CREATE TABLE rag.parl_embeddings (
  id VARCHAR(191) PRIMARY KEY,
  resourceId VARCHAR(191) REFERENCES rag.parl_resources(id),
  content TEXT NOT NULL,
  embedding VECTOR(1024) NOT NULL,
  tsv TSVECTOR  -- For hybrid keyword + semantic search (language-neutral)
);

CREATE INDEX parl_embeddings_embedding_idx ON rag.parl_embeddings
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX parl_embeddings_tsv_idx ON rag.parl_embeddings
  USING gin(tsv);
```

## Caching Strategy

| Cache Type | TTL | Key Pattern |
|------------|-----|-------------|
| Embeddings | 24 hours | `emb:{sha1(text)}` |
| Search results | 1 hour | `search:{source}:{lang}:{threshold}:{limit}:{sha1(query)}` |
| Rerank results | 1 hour | `rerank:{topN}:{hash}` |
| Context | 1 hour | `ctx:v2:{sha1(query|limit)}` |

Set `RAG_CACHE_DISABLE=true` to bypass Redis during development.

## Integration Points

### Chat API (`app/(chat)/api/chat/route.ts`)

Pre-fetches Parliament (and optional legislation) context before streaming:

```typescript
const parlResult = isParlRagEnabled
  ? await getParliamentContext(userText, 10)
  : undefined;
const legResult = isLegRagEnabled
  ? await getLegislationContext(userText, 10)
  : undefined;
const langGuess =
  parlResult?.language ??
  legResult?.language ??
  detectLanguage(userText).language;
const contextParts = [parlResult?.prompt, legResult?.prompt].filter(Boolean);

const ragSystem =
  contextParts.length > 0
    ? parliamentPrompt({
        requestHints,
        language: langGuess,
        context: contextParts.join("\n\n"),
      })
    : systemPrompt({ selectedChatModel, requestHints, language: langGuess });
```

Parliament and legislation RAG are enabled by default; set `PARL_RAG_ENABLED=false` (or `NEXT_PUBLIC_PARL_RAG_ENABLED=false`) to disable this branch.

### Tool Call (`lib/ai/tools/retrieve-parliament-context.ts`)

Available as an AI tool for on-demand retrieval:

```typescript
export const retrieveParliamentContext = tool({
  description: "Retrieve Canadian Parliament context...",
  execute: async ({ query, limit }) => getParliamentContext(query, limit),
});
```

---

# IMPROVEMENTS

Based on the RAG best practices from [Yakko Majuri's local RAG guide](https://blog.yakkomajuri.com/blog/local-rag), here are recommended improvements:

## 1. ~~Replace Heuristic Reranking with a Cross-Encoder Reranker~~ DONE

**Implemented**: Cross-encoder reranking using Cohere's `rerank-multilingual-v3.0` model.

**Files Changed**:
- `lib/rag/parliament/reranker.ts` - New module with `rerankResults()` function
- `lib/rag/parliament/reranking.ts` - Updated with `deduplicateAndRerank()` that uses cross-encoder with heuristic fallback
- `lib/rag/parliament/constants.ts` - Added `RERANKER_CONFIG` with model settings
- `lib/ai/tools/retrieve-parliament-context.ts` - Integrated into pipeline

**How it works**:
1. Multi-query search targets ~50 candidates overall (`VECTOR_SEARCH_CANDIDATES`)
2. Cohere cross-encoder reranks candidates considering query-document pairs
3. Top 10 results returned with relevance scores (0-1)
4. Falls back to heuristic scoring if API fails

## 2. ~~Increase TopK for Vector Search Before Reranking~~ DONE

**Implemented**: Pipeline now targets 50 candidates (split across multi-query variations) before reranking to top 10.

See `RERANKER_CONFIG.VECTOR_SEARCH_CANDIDATES` in `lib/rag/parliament/constants.ts`.

## 3. ~~Implement Query Expansion / Multi-Query~~ DONE

**Implemented**: LLM-based query reformulation with multi-source search.

**Changes**:
- `lib/rag/parliament/query-analysis.ts`: Unified `analyzeQuery()` generates two reformulations and priority intent for deterministic search types
- `lib/rag/parliament/multi-query.ts`: Searches all relevant source types via `searchParliament()` instead of just bills
- `lib/ai/prompts.ts`: Added `queryReformulationPrompt()` for bilingual query expansion

**How it works**:
1. LLM generates two query variations (e.g., "What is Bill C-35?" → "What is the purpose of Bill C-35 and what are its main provisions?")
2. Each variation is searched in parallel across all relevant source types
3. Results are deduplicated and reranked by cross-encoder
4. Falls back to template-based reformulations if LLM is unavailable

## 4. ~~Add Hybrid Search (Keyword + Semantic)~~ DONE

**Implemented**: Hybrid search combining vector similarity with BM25-style keyword matching.

**Files Changed**:
- `lib/db/rag/schema.ts` - Added `tsvector` custom type and `tsv` column to embeddings table with GIN index
- `lib/rag/parliament/search-utils.ts` - Updated `executeVectorSearch` to use hybrid scoring
- `lib/rag/parliament/constants.ts` - Added `HYBRID_SEARCH_CONFIG` with weights (70% vector, 30% keyword)
- `lib/db/migrations/0016_glamorous_malice.sql` - Migration for tsv column and index

**How it works**:
1. Query matches results via vector similarity OR keyword full-text search
2. Hybrid score = `0.7 * vector_similarity + 0.3 * ts_rank(tsv, query)`
3. Uses PostgreSQL `plainto_tsquery` with 'simple' config for language-neutral tokenization
4. `tsv` column is populated during embedding generation
5. Results ordered by hybrid score descending

## 5. ~~Improve Chunking Strategy~~ DONE

**Implemented**: Semantic chunking based on document structure.

**Files Changed**:
- `lib/rag/parliament/semantic-chunking.ts` - New module with `chunkBill()` and `chunkHansard()` functions
- `scripts/generate-embeddings.ts` - Updated to use semantic chunking
- `scripts/generate-test-embeddings.ts` - Updated to use semantic chunking

**How it works**:
1. **Bills**: Split at major section boundaries (PART, SUMMARY, RECOMMENDATION, SCHEDULE, etc.)
2. **Hansard**: Split at paragraph boundaries, strip HTML, preserve speaker context
3. **Contextual headers**: Each chunk includes bill number, name, session, and section info
4. Falls back to character-based chunking within sections if content exceeds size limits

```typescript
// Semantic chunking for bills
const chunks = chunkBill(billText, {
  number: "C-11",
  nameEn: "Online Streaming Act",
  sessionId: "44-1"
}, "en");
// Returns chunks with section info and contextual headers
```

## 6. ~~Add Contextual Chunk Headers~~ DONE

**Implemented**: As part of semantic chunking (see above).

Each chunk now includes a contextual header prepended to the content:

```
Bill C-11 | Online Streaming Act | Session: 44-1 | PART 1

[chunk content here]
```

This ensures chunks are self-contained and can be understood without the full document.

## 7. ~~Implement Confidence-Based Filtering~~ DONE

**Implemented**: Adaptive filtering using relative thresholds instead of fixed thresholds.

**Files Changed**:
- `lib/rag/parliament/adaptive-filter.ts` - New module with `adaptiveFilter()`, `findNaturalCutoff()`, and `smartFilter()` functions
- `lib/rag/parliament/constants.ts` - Added `ADAPTIVE_FILTER_CONFIG` with configurable thresholds
- `lib/rag/parliament/reranking.ts` - Integrated adaptive filtering into both cross-encoder and heuristic paths

**How it works**:
1. **Relative threshold**: Keep results within 70% of the top score (configurable)
2. **Absolute minimum**: Never include results below 0.05 score floor
3. **Minimum guarantee**: Always return at least 3 results for context
4. **Gap detection**: Optional natural cutoff detection based on score gaps

```typescript
// Adaptive filtering respects query-specific score distributions
const filtered = adaptiveFilter(results, {
  relativeThreshold: 0.7,  // Keep results >= 70% of top score
  absoluteMinimum: 0.05,   // Never go below this floor
  minimumResults: 3,       // Always return at least this many
});
```

This handles queries that naturally produce lower scores without discarding useful results.

## 8. ~~Add Evaluation Framework~~ DONE

**Implemented**: LLM-as-judge evaluation framework for measuring RAG quality.

**Files Changed**:
- `lib/rag/parliament/eval/cases.ts` - Test cases with queries and expected output descriptions
- `lib/rag/parliament/eval/judge.ts` - LLM judge using the configured `small-model`
- `scripts/eval-rag.ts` - CLI script for running evaluations

**How it works**:
1. Define test cases with queries and expected output descriptions
2. Run RAG pipeline for each query
3. LLM judge evaluates if retrieved context matches expectations
4. Results include pass/fail, 1-5 score, and reasoning

**Usage**:
```bash
# Run all test cases
pnpm eval:rag

# Run single case
pnpm eval:rag --case bill-c11

# Run cases for a source type
pnpm eval:rag --source bill

# Output JSON results
pnpm eval:rag --json --output results.json
```

**Test Case Format**:
```typescript
{
  id: "bill-c11-about",
  query: "What is Bill C-11 about?",
  expectedOutput: "Should mention online streaming, broadcasting, CRTC regulation",
  expectedSources: ["bill"],
  mustMention: ["C-11"],
}
```

## Priority Order

1. **Cross-Encoder Reranker** - Highest impact on accuracy
2. **Increase Vector Search TopK** - Quick win, pairs with reranker
3. **Hybrid Search** - Improves exact-match queries
4. **Query Expansion** - Helps with terminology mismatches
5. **Evaluation Framework** - Enables measuring improvements
6. **Semantic Chunking** - Improves context coherence
7. **Contextual Headers** - Improves chunk understanding
8. **Adaptive Thresholds** - Fine-tuning improvement
