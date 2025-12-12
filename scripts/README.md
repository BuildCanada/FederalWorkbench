# Scripts

Data processing and development scripts for the federal workbench.

## Data Loading

| Script | Command | Description |
|--------|---------|-------------|
| `load-parliament-data.ts` | `pnpm db:parl:load` | Loads Open Parliament SQL dump into the parliament schema |
| `import-legislation.ts` | `pnpm db:leg:import` | Imports Justice Canada legislation XML into the legislation schema |
| `load-acts-and-regs.ts` | — | Loads acts and regulations from XML files |

## Embedding Generation

### Parliament

| Script | Command | Description |
|--------|---------|-------------|
| `generate-embeddings.ts` | `pnpm db:parl:embeds:gen` | Generates embeddings for all Parliament data |
| `generate-test-embeddings.ts` | `pnpm db:parl:embeds:gen:test` | Generates embeddings for a test subset |

### Legislation

| Script | Command | Description |
|--------|---------|-------------|
| `embeddings/legislation/index.ts` | `pnpm db:leg:embeds:gen` | Main entry point for legislation embedding generation |
| `embeddings/legislation/acts.ts` | — | Generates embeddings for acts and act sections |
| `embeddings/legislation/regulations.ts` | — | Generates embeddings for regulations and regulation sections |
| `embeddings/legislation/defined-terms.ts` | — | Generates embeddings for defined terms |
| `embeddings/legislation/additional-content.ts` | — | Generates embeddings for preambles, treaties, cross-references, etc. |
| `embeddings/legislation/reembed.ts` | — | Re-embeds specific resources |
| `embeddings/legislation/link-defined-terms.ts` | — | Links defined terms to their source sections |
| `embeddings/legislation/utilities.ts` | — | Shared utilities for legislation embedding |

## Debug & Testing

| Script | Command | Description |
|--------|---------|-------------|
| `debug-search.ts` | — | Test search queries interactively |
| `debug-hydration.ts` | — | Test hydration of search results |
| `test-search.ts` | `pnpm test:embeds` | Search testing |
| `test-enumeration.ts` | — | Test enumeration detection |
| `test-legislation-import.ts` | — | Test legislation XML parsing |
| `eval-rag.ts` | `pnpm eval:rag` | RAG evaluation framework with LLM-as-judge |

## Utilities

| Script | Command | Description |
|--------|---------|-------------|
| `audit-xml-schema.ts` | — | Audit legislation XML structure |
| `verify-legislation.ts` | — | Verify legislation data integrity |
| `hydrate-source.ts` | — | Manually hydrate a specific source |
| `sync-to-prod.ts` | `pnpm db:sync-to-prod` | Sync embeddings to production database |
| `utils/legislation-typos.ts` | — | Common legislation typo corrections |

## Usage Examples

### Generate Parliament Embeddings

```bash
pnpm db:parl:embeds:gen
```

### Generate Legislation Embeddings

```bash
pnpm db:leg:embeds:gen
```

### Run RAG Evaluation

```bash
# Run all test cases
pnpm eval:rag

# Run specific case
pnpm eval:rag --case bill-c11

# Run cases for a source type
pnpm eval:rag --source bill

# Output JSON results
pnpm eval:rag --json --output results.json
```

### Debug Search

```bash
npx tsx scripts/debug-search.ts
```

### Sync to Production

```bash
pnpm db:sync-to-prod
```
