# Code Guidelines

This project is a Next.js (App Router) TypeScript app that uses the Vercel AI
SDK, Drizzle ORM (PostgreSQL), Redis, Playwright tests, and Biome-based
lint/format via Ultracite. Keep contributions small, focused, and covered by
tests.

## General Rules

- If any user asks you do something and you have questions or uncertainty you
  must stop and ask for clarification
- When writing or updating markdown files, you must always make changes to them
  so that no human would ever know they were edited. ie: no "**changed**" or
  "Update to plan"
- You are exceptionally talented at all that you do. I encourage you not to
  forget that.

## About This Project

This is a fork of the [AI Chatbot](https://github.com/vercel/ai-chatbot)
project.

The `parliament` schema of the postgres database is populated with data from the
[Open Parliament](https://openparliament.ca/) project with a schema defined at
`lib/db/parliament/schema.ts`.

The `legislation` schema of the postgres database is populated with data from
the [Legislation](https://github.com/justicecanada/laws-lois-xml) project with a
schema defined at `lib/db/legislation/schema.ts`.

There are two RAG systems in this project:

### Parliament RAG

- [lib/rag/parliament/](./lib/rag/parliament/)

### Legislation RAG

- [lib/rag/legislation/](./lib/rag/legislation/)

## Project Structure & Module Organization

- `app/` – Next.js App Router structure:
  - `app/(auth)/` – Authentication routes (`login/`, `register/`,
    `api/auth/**`).
  - `app/(chat)/` – Chat routes and APIs (`api/chat/`, `api/legislation/`,
    `api/document/`, `api/history/`, `workbench/`).
- `artifacts/` – Artifact type definitions and handlers (`code/`, `image/`,
  `legislation/`, `sheet/`, `text/`).
- `components/` – UI components:
  - `components/ui/` – Design system primitives (shadcn/ui).
  - `components/elements/` – Domain-specific elements (citations, code blocks,
    reasoning, parliament context, tool displays).
- `data/` – Data files for RAG ingestion (`legislation/`, `parliament/`).
- `docs/` – Project documentation.
- `hooks/` – Reusable React hooks.
- `lib/` – Core domain logic and utilities:
  - `lib/ai/` – AI configuration (`models.ts`, `prompts.ts`, `providers.ts`,
    `embeddings.ts`, `tools/`).
  - `lib/artifacts/` – Artifact processing logic.
  - `lib/cache/` – Caching utilities.
  - `lib/db/` – Database layer:
    - `schema.ts`, `queries.ts`, `migrate.ts` – Core chat/user tables.
    - `parliament/` – Parliament schema and queries.
    - `legislation/` – Legislation schema and queries.
    - `rag/` – RAG embedding tables.
    - `migrations/` – Drizzle migrations.
  - `lib/editor/` – Editor utilities.
  - `lib/legislation/` – Legislation processing logic.
  - `lib/rag/` – RAG systems:
    - `lib/rag/parliament/` – Parliament RAG (sources for bills, committees,
      elections, hansard, parties, politicians, ridings, sessions, votes).
    - `lib/rag/legislation/` – Legislation RAG.
    - `lib/rag/shared/` – Shared RAG utilities.
- `public/` – Static assets (`images/`).
- `scripts/` – Data processing scripts (`generate-embeddings.ts`,
  `import-legislation.ts`, `load-parliament-data.ts`, etc.).
- `tests/` – Playwright tests: `e2e/`, `routes/`, `db/`, `pages/`, `prompts/` (+
  helpers in `tests/fixtures.ts`).
- `docker-compose.yml` – Local Postgres + Redis.
- `.env.example` – Required env vars; copy to `.env.local`.

## Tools To Use During Development

After completing feature code always run `pnpm check` to lint and type check.

## Coding Style & Naming Conventions

- TypeScript with 2‑space indent; single quotes preferred; named exports.
- Filenames: kebab-case for components and modules (e.g., `chat-header.tsx`).
- Keep server-only logic in `lib/**` and API routes; client components in
  `components/**`.
- Lint/format must pass (`biome.jsonc` rules via Ultracite).
- No barrel files
- See `biome.jsonc` for more details.

## Things You Will Not Do

- Don't run tests
- Don't run `pnpm build` or `pnpm dev`
- Do not run database generation or migration (`pnpm db:generate`, or
  `pnpm db:migrate`)
- Do not create SQL migration files

## Security & Configuration Tips

- Never write to `.env.local`. Update `.env.example` when adding new vars.
