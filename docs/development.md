# Development

## Installation

```bash
# Clone the repository
git clone https://github.com/sprice/federal-workbench.git
cd federal-workbench

# Set up environment variables
cp .env.example .env.local

# Init submodules
git submodule update --init --recursive

# Install dependencies
pnpm install

# Install Playwright browsers
pnpm exec playwright install

# Run DB migrations
pnpm db:migrate

# Read data/parliament/README.md to download the Open Parliament SQL database file

# Load Open Parliament database
pnpm db:parl:load

# Generate embeddings for Open Parliament database
pnpm db:parl:embeds:gen

# Load Legislation data
pnpm db:leg:import

# Generate embeddings for Legislation data
pnpm db:leg:embeds:gen
```

## Running the Application

```bash
# Start Docker (Postgres + Redis)
docker compose up -d

# Start the development server
pnpm dev
```

## Environment Variables

Copy `.env.example` to `.env.local` and configure:

| Variable | Description |
|----------|-------------|
| `AUTH_SECRET` | Session encryption key. Generate with `openssl rand -base64 32` |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key for model routing |
| `COHERE_API_KEY` | Required for embeddings and reranking |
| `OPENAI_API_KEY` | OpenAI models |
| `GROQ_API_KEY` | Groq models |
| `POSTGRES_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob storage |
| `DEBUG` | Debug namespaces (e.g., `rag:*,db:queries`) |
| `PARL_RAG_ENABLED` | Enable Parliament RAG (default: false) |
| `LEG_RAG_ENABLED` | Enable Legislation RAG (default: false) |
| `RAG_CACHE_DISABLE` | Disable Redis caching for development |

## Testing

```bash
# Run all tests
pnpm test

# Run specific test suites
pnpm test:db         # Database tests
pnpm test:lib        # Library tests
pnpm test:rag        # RAG system tests
pnpm test:embeddings # Embedding tests
pnpm test:scripts    # Script tests
pnpm test:routes     # API route tests
pnpm test:e2e        # End-to-end tests

# RAG evaluation framework
pnpm eval:rag                  # Run all evaluation cases
pnpm eval:rag --case bill-c11  # Run specific case
pnpm eval:rag --source bill    # Run cases for source type
```

## Development Workflow

### Code Quality

```bash
pnpm check           # Format + type-check
pnpm lint            # Lint only
pnpm format          # Format only
pnpm type-check      # TypeScript check
```

### Database

```bash
pnpm db:studio       # Open Drizzle Studio
pnpm db:generate     # Generate migrations
pnpm db:migrate      # Run migrations
pnpm db:reset        # Reset database
pnpm db:parl:load    # Load Open Parliament data
pnpm db:leg:import   # Load Legislation data
pnpm db:parl:embeds:gen # Generate embeddings for Open Parliament data
pnpm db:leg:embeds:gen # Generate embeddings for Legislation data
```

## Troubleshooting

### Redis Connection Failed

Ensure Docker is running:

```bash
docker compose up -d
```

### Embedding Generation Slow or Failing

Check your `COHERE_API_KEY` is valid. Embeddings use Cohere's `embed-multilingual-v3.0` model with a 24-hour cache.

Disable caching during development to see fresh results:

```bash
RAG_CACHE_DISABLE=true pnpm dev
```

### Database Lock or Connection Issues

Reset the database connection or restart Postgres:

```bash
docker compose restart postgres
```

### Missing Parliament Data

Follow the [Parliament Data README](../data/parliament/README.md) to download and load the Open Parliament SQL dump.
