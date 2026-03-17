# Contributing

Thanks for your interest in contributing to Federal Parliament & Legislation
Workbench.

## Quick Start

See [Development](./docs/development.md) for detailed instructions.

## Before Submitting a PR

```bash
pnpm check                  # lint + type check
pnpm test                   # run Playwright tests
```

## Code Style

Biome will enforce the rules in the `.biome.jsonc` file.

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(artifacts): add legislation viewer
fix(rag): handle empty embeddings
docs: update deployment guide
```

## Pull Requests

- Clear description of what and why
- Link related issues
- Screenshots for UI changes
- Update `.env.example` if adding env vars

## Project Structure

See `CLAUDE.md` for detailed architecture and module organization.
