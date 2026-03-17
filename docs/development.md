# Development

## Installation

```bash

# Clone the repository
git clone https://github.com/sprice/federal-workbench.git
cd federal-workbench

# Set up environment variables
cp .env.example .env.local

## Init submodules
git submodule update --init --recursive

# Install dependencies
pnpm install

# Install Playwright browsers
pnpm exec playwright install

# Run DB migrations
pnpm db:migrate

# Read [Open Parliament README](./data/parliament/README.md)
# to download the Open Parliament SQL database file

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

# Start Docker
docker compose up -d

# Start the application
pnpm dev
```
