# Legislation RAG System

Retrieval-augmented generation for Canadian federal acts and regulations from Justice Canada. The system provides bilingual (English/French) answers with citations linking to the official laws-lois.justice.gc.ca website.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           User Query                                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Language Detection                                │
│  Heuristic EN/FR detection with fallback to English                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          Hybrid Search                                   │
│  Vector similarity (70%) + keyword matching (30%)                       │
│  Filters by language, source type, document ID                          │
│  Retries without language filter if no results found                    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      Cross-Encoder Reranking                            │
│  Cohere rerank-multilingual-v3.0                                        │
│  Filters results below 0.1 relevance threshold                          │
│  Falls back to similarity order on API failure                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Context Building                                  │
│  Deduplicates by document + section + chunk                             │
│  Truncates snippets to ~480 characters at sentence boundaries           │
│  Assigns citation IDs with "L" prefix                                   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           Hydration                                      │
│  Fetches full document for artifact panel display                       │
│  Uses cross-encoder ranking (not vector similarity)                     │
│  Caps at 150 sections / ~100KB for LLM context                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          LLM Response                                    │
│  System prompt includes context snippets and citations                  │
│  Artifact panel shows hydrated document                                 │
└─────────────────────────────────────────────────────────────────────────┘
```

## Retrieval Pipeline

### Language Detection

When a query arrives, the system detects whether it is in English or French using heuristic analysis. This detection determines the preferred language for search results and response formatting. If detection is uncertain, the system defaults to English.

### Hybrid Search

The search combines two retrieval methods weighted together:

**Vector similarity (70% weight)** uses Cohere's `embed-multilingual-v3.0` model to find semantically similar content. This handles paraphrasing, synonyms, and conceptual matches well.

**Keyword matching (30% weight)** uses PostgreSQL's full-text search to find exact term matches. This helps with specific section numbers, act names, and legal terminology that semantic search might miss.

Results must meet a minimum similarity threshold of 0.4. If a language-filtered search returns no results, the system retries without the language filter to ensure the user gets relevant content even if it's in the other official language.

The system provides specialized search modes for different query types. Questions about definitions prioritize defined terms with a relevance boost. Metadata-only queries (like "acts amended in 2023") use database indexes without vector search.

### Cross-Encoder Reranking

After initial retrieval, a cross-encoder model re-evaluates each result by considering the query and document together as a pair, rather than comparing embeddings independently. This produces more accurate relevance scores for legal text where semantic nuance matters.

The system uses Cohere's `rerank-multilingual-v3.0` model, which supports both English and French. Results scoring below 0.1 relevance are filtered out. If the reranking API fails, the system gracefully falls back to the original similarity-based ordering.

Rerank results are cached for one hour to reduce API costs for repeated queries.

### Context Building

The context builder prepares search results for the LLM:

**Deduplication** removes duplicate content that may appear when the same section matches multiple query variations. Results are deduplicated by source type, document ID, section ID, and chunk index.

**Snippet truncation** shortens each result to approximately 480 characters, cutting at sentence boundaries when possible to preserve readability.

**Citation assignment** gives each result a numbered citation with an "L" prefix (L1, L2, L3...) to distinguish legislation citations from Parliament citations when both RAG systems are active.

The context includes both English and French citation text, allowing the response to use the appropriate language.

### Hydration

Hydration fetches the complete document for display in the artifact panel. The system hydrates the top result from the cross-encoder ranking, ensuring users see the document the model determined most relevant rather than just the highest vector similarity match.

For acts and regulations, hydration fetches section content from the database and formats it as markdown. To prevent overwhelming the LLM context window, large documents are capped at 150 sections and approximately 100KB of markdown. A truncation notice informs users when they're viewing a partial document.

When the preferred language version isn't available, the system falls back to the other official language and includes a note explaining the substitution.

## Data Sources

The system indexes 15 types of legislative content:

**Core documents:**
- Acts (federal statutes)
- Act sections (numbered provisions within acts)
- Regulations (delegated legislation)
- Regulation sections (numbered provisions within regulations)

**Interpretive content:**
- Defined terms from interpretation sections
- Preambles stating legislative purpose
- Marginal notes (section headings)

**Supplementary material:**
- Schedules and appendices
- Treaties and conventions referenced in legislation
- Cross-references to other acts or regulations
- Tables of provisions (document outlines)
- Signature blocks (official attestations)
- Related provisions (transitional rules)
- Footnotes (explanatory notes)
- Publication items (regulatory notices and recommendations)

Sections from acts, regulations, and schedules are chunked for embedding. Other content types are embedded as single units.

## Embedding Generation

### Legal-Boundary Chunking

When generating embeddings for sections, the chunking process respects the hierarchical structure of Canadian legislation:

- Subsections: (1), (2), (3)
- Paragraphs: (a), (b), (c)
- Subparagraphs: (i), (ii), (iii)
- Clauses: (A), (B), (C)

The system prefers splitting at these legal boundaries rather than arbitrary character positions. This preserves the semantic coherence of legal provisions.

### Contextual Headers

Each chunk includes a contextual header with the document title and section information. This helps the embedding model understand each chunk's context even when viewed in isolation.

### Token-Based Sizing

Chunks target approximately 1,536 tokens with 256 tokens of overlap between adjacent chunks. The overlap ensures concepts spanning chunk boundaries are captured in multiple embeddings.

Historical amendment notes are appended to section content, making the amendment history searchable.

## Citations

Every search result includes a citation linking to the Justice Canada website. Citations are bilingual, with both English and French text and URLs.

Section-level citations include anchors to scroll directly to the relevant provision. Citation format varies by source type—for example, defined terms show the term in quotes, and cross-references show both source and target documents.

## Database Schema

Legislation content is stored in two tables within the `rag` schema:

**Resources table** stores content chunks with metadata including source type, language, document IDs, section labels, and additional fields specific to each source type. Resources also store a paired resource key for cross-lingual lookups.

**Embeddings table** stores the 1024-dimensional vectors from Cohere's embedding model alongside a `tsvector` column for keyword search. HNSW and GIN indexes enable efficient hybrid retrieval.

## Caching

The system uses Redis caching at multiple levels:

| Cache | TTL | Purpose |
|-------|-----|---------|
| Embeddings | 24 hours | Avoid recomputing expensive embeddings |
| Search results | 1 hour | Speed up repeated queries |
| Rerank results | 1 hour | Reduce Cohere API calls |
| Context | 1 hour | Cache complete retrieval results |

Set `RAG_CACHE_DISABLE=true` to bypass caching during development.

## Integration

### Automatic Context Retrieval

When legislation RAG is enabled, every chat request automatically retrieves relevant legislation context before generating a response. The context is prepended to the system prompt alongside any Parliament context.

### On-Demand Tool

The LLM can also request legislation context on demand using the `retrieveLegislationContext` tool. This allows the model to fetch additional context when the automatic retrieval didn't surface the needed information.

### Configuration

Legislation RAG is disabled by default. Set `LEG_RAG_ENABLED=true` to enable automatic retrieval. When disabled, the system won't search legislation or include legislation context in responses.
