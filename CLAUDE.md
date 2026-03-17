# Repository Guidelines

This project is a Next.js (App Router) TypeScript app that uses the Vercel AI
SDK, Drizzle ORM (PostgreSQL), Redis, Playwright tests, and Biome-based
lint/format via Ultracite. Keep contributions small, focused, and covered by
tests.

## About This Project

This is a fork of the [AI Chatbot](https://github.com/vercel/ai-chatbot)
project. The `parliament` schema of the postgres database is populated with data
from the [Open Parliament](https://openparliament.ca/) project with a schema
defined at `lib/db/parl/schema.ts`.

The purpose of this project is to build a chatbot that can answer questions
about the Canadian Parliament.

## Project Structure & Module Organization

- `app/` – Next.js routes and server actions (e.g., `app/(chat)/actions.ts`,
  `app/(chat)/api/**`).
- `components/` – UI components (`components/ui/` is the design system).
- `lib/` – Domain and utilities: `lib/db/schema.ts`, `lib/db/migrations/`,
  `lib/db/queries.ts`, `lib/db/migrate.ts`, `lib/db/parl/schema.ts`,
  `lib/db/parl/queries.ts` (server-only DB code).
- `hooks/` – Reusable React hooks.
- `public/` – Static assets.
- `tests/` – Playwright tests: `e2e/`, `routes/`, `db/` (+ helpers in
  `tests/fixtures.ts`).
- `docker-compose.yml` – Local Postgres + Redis.
- `.env.example` – Required env vars; copy to `.env.local`.

## Build, Test, and Development Commands

- `pnpm install` – Install deps (package manager: `pnpm`).
- `docker-compose up -d` – Start Postgres (15432) and Redis (16379) locally.
- `pnpm check` – Lint and type check.

## Coding Style & Naming Conventions

- TypeScript with 2‑space indent; single quotes preferred; named exports.
- Filenames: kebab-case for components and modules (e.g., `chat-header.tsx`).
- Keep server-only logic in `lib/**` and API routes; client components in
  `components/**`.
- Lint/format must pass (`biome.jsonc` rules via Ultracite).

## Testing Guidelines

- Use Playwright; name tests `*.test.ts` under `tests/{e2e,routes,db}`.
- Prefer deterministic tests; use `tests/fixtures.ts` helpers.
- Ensure `.env.local` is set and run `pnpm db:migrate`; the Playwright config
  boots the dev server.

## Commit & Pull Request Guidelines

- Follow Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`
  with optional scope (e.g., `fix(artifacts): …`) and issue refs (`#123`).
- PRs must include: clear description, linked issues, screenshots for UI
  changes, and any env/doc updates.
- CI expectations: run `pnpm type-check && pnpm lint && pnpm test` locally
  before opening a PR.

## Security & Configuration Tips

- Never commit secrets. Use `.env.local`; update `.env.example` when adding new
  vars.
- Local URLs: set `POSTGRES_URL` and `REDIS_URL` to match `docker-compose`
  ports.
- For Vercel projects, use `vercel env pull` to sync environment variables.
