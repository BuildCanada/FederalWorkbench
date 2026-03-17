-- Backfill tsvector column for hybrid keyword search
-- This enables the hybrid search functionality that combines vector similarity with keyword matching
UPDATE rag.parl_embeddings
SET tsv = to_tsvector('simple', content)
WHERE tsv IS NULL;
