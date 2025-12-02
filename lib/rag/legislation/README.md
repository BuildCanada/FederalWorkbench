# Legislation RAG System Documentation

Retrieval for federal acts and regulations from Justice Canada, providing grounded, bilingual answers with citations.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           User Query                                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│     Language Detection (parliament/query-analysis.ts: detectLanguage)    │
│  - Heuristic EN/FR detection with fallback                              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│        Hybrid Search (legislation/search.ts)                            │
│  - Vector (pgvector) + keyword (tsvector) with caching                  │
│  - Source filters: acts, act_sections, regulations, regulation_sections │
│  - Language retry without filter if zero hits                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│        Context Building (legislation/context-builder.ts)                │
│  - Deduplicate by act/reg + section                                     │
│  - Similarity sort, top N (default 10)                                  │
│  - Snippet truncation (~480 chars) with citation prefix `L`             │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│        Hydration (legislation/hydrate.ts)                               │
│  - Hydrate the top act or regulation (sections limited for size)        │
│  - Fallback to opposite language if preferred language missing          │
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

Shared with Parliament RAG; uses Cohere `embed-multilingual-v3.0` (1024 dims) with 24-hour caching.

### 2. Chunking (`lib/rag/legislation/chunking.ts`, `lib/rag/shared/chunking.ts`)

Section-aware chunking for acts and regulations:

- Prepends document title + section label/marginal note for context.
- Uses shared 4800-character chunks with 800-character overlap for long sections.

```typescript
const chunks = chunkSection(section, section.documentTitle);
```

### 3. Hybrid Search (`lib/rag/legislation/search.ts`)

pgvector + `tsvector` hybrid retrieval:

- Weighting: 0.7 vector, 0.3 keyword (from `HYBRID_SEARCH_CONFIG`).
- Filters: language, sourceType (`act`, `act_section`, `regulation`, `regulation_section`), actId, regulationId.
- Language fallback retry if filtered search returns zero results.
- Returns citations built from Justice Canada URLs.

Helpers:
- `searchActs()` searches act metadata + sections.
- `searchRegulations()` searches regulation metadata + sections.

### 4. Context Building (`lib/rag/legislation/context-builder.ts`)

Builds LLM-ready context with citation prefix `L`:

- Deduplicates by act/reg + section + chunk index.
- Similarity sort (no cross-encoder reranker yet); defaults to top 10 via `RERANKER_CONFIG.DEFAULT_TOP_N`.
- Snippet truncation (~480 chars) with sentence-aware cut and duplicate snippet removal.

### 5. Hydration (`lib/rag/legislation/hydrate.ts`)

Hydrates the top act or regulation for artifact display:

- Fetches sections (capped at 150) and trims output (~100KB) with table of contents when large.
- Adds truncation notices and language fallback notes when needed.
- Returns `HydratedLegislationSource` with markdown, language used, and optional note.

## Data Sources

The system indexes four legislation source types:

| Source Type | Description | Chunked |
|-------------|-------------|---------|
| `act` | Act metadata | No (metadata chunk) |
| `act_section` | Act sections | Yes |
| `regulation` | Regulation metadata | No (metadata chunk) |
| `regulation_section` | Regulation sections | Yes |

## Database Schema

### Resources Table (`lib/db/rag/schema.ts`)

Stores legislation content chunks with metadata:

```typescript
type LegResourceMetadata = {
  sourceType: "act" | "act_section" | "regulation" | "regulation_section";
  language: "en" | "fr";
  chunkIndex?: number; // 0 for metadata, 1+ for content
  actId?: string;
  regulationId?: string;
  sectionId?: string;
  sectionLabel?: string;
  marginalNote?: string;
  documentTitle: string;
};
```

### Embeddings Table

Vector storage with HNSW index and `tsvector` for hybrid search:

```sql
CREATE TABLE rag.leg_embeddings (
  id VARCHAR(191) PRIMARY KEY,
  resourceId VARCHAR(191) REFERENCES rag.leg_resources(id),
  content TEXT NOT NULL,
  embedding VECTOR(1024) NOT NULL,
  tsv TSVECTOR  -- For hybrid keyword + semantic search
);

CREATE INDEX leg_embeddings_embedding_idx ON rag.leg_embeddings
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX leg_embeddings_tsv_idx ON rag.leg_embeddings
  USING gin(tsv);
```

## Caching Strategy

| Cache Type | TTL | Key Pattern |
|------------|-----|-------------|
| Embeddings | 24 hours | `emb:{sha1(text)}` |
| Search results | 1 hour | `leg:search:{lang}:{type}:{act}:{reg}:{threshold}:{limit}:{sha1(query)}` |
| Context | 1 hour | `leg:ctx:{sha1(query|limit)}` |

Set `RAG_CACHE_DISABLE=true` to bypass Redis during development.

## Integration Points

### Chat API (`app/(chat)/api/chat/route.ts`)

Legislation and Parliament RAG are enabled by default; set `LEG_RAG_ENABLED=false` (or `NEXT_PUBLIC_LEG_RAG_ENABLED=false`) to disable legislation retrieval.

```typescript
const parlResult = isParlRagEnabled
  ? await getParliamentContext(userText, 10)
  : undefined;
const legResult = isLegRagEnabled
  ? await getLegislationContext(userText, 10)
  : undefined;
const contextParts = [parlResult?.prompt, legResult?.prompt].filter(Boolean);
```

### Tool Call (`lib/ai/tools/retrieve-legislation-context.ts`)

AI tool for on-demand retrieval:

```typescript
export const retrieveLegislationContext = tool({
  description: "Retrieve Canadian federal legislation context...",
  execute: async ({ query, limit }) => getLegislationContext(query, limit),
});
```
