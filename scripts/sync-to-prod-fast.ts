/**
 * Fast database sync to production using pg_dump/pg_restore
 *
 * Significantly faster than row-by-row COPY because:
 * - Compressed binary format (pg_dump -Fc)
 * - Parallel restore (pg_restore --jobs=N)
 * - No batching overhead or delays
 *
 * Usage: pnpm db:sync-fast
 *
 * Options (select one):
 *   1. Legislation schema - All legislation.* tables
 *   2. Parliament schema - All parliament.* tables
 *   3. RAG legislation tables - rag.leg_resources, rag.leg_embeddings
 *   4. RAG parliament tables - rag.parl_resources, rag.parl_embeddings
 *
 * Requirements:
 *   - pg_dump and pg_restore installed (PostgreSQL client tools)
 *   - .env.local with local POSTGRES_URL
 *   - .env.production.local with production POSTGRES_URL
 *
 * WARNING: This will REPLACE data in production. Use with caution.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { createInterface } from "node:readline";

// ============================================================================
// Types
// ============================================================================

type SyncOption = "legislation" | "parliament" | "rag_leg" | "rag_parl";

type SchemaConfig = {
  type: "schema";
  label: string;
  details: string;
  schema: string;
};

type TablesConfig = {
  type: "tables";
  label: string;
  details: string;
  tables: string[];
};

type SyncConfig = SchemaConfig | TablesConfig;

type DatabaseConfig = {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  sslmode?: string;
};

type IndexInfo = {
  schema: string;
  table: string;
  name: string;
};

// ============================================================================
// Configuration
// ============================================================================

// Number of parallel jobs for pg_restore (adjust based on connection limits)
const PARALLEL_JOBS = 4;

const SYNC_OPTIONS: Record<SyncOption, SyncConfig> = {
  legislation: {
    type: "schema",
    label: "Legislation schema",
    details: "acts, regulations, sections, defined_terms, cross_references",
    schema: "legislation",
  },
  parliament: {
    type: "schema",
    label: "Parliament schema",
    details: "bills, hansards, committees, politicians, etc.",
    schema: "parliament",
  },
  rag_leg: {
    type: "tables",
    label: "RAG legislation tables",
    details: "leg_resources, leg_embeddings (includes HNSW vector indexes)",
    tables: ["rag.leg_resources", "rag.leg_embeddings"],
  },
  rag_parl: {
    type: "tables",
    label: "RAG parliament tables",
    details: "parl_resources, parl_embeddings (includes HNSW vector indexes)",
    tables: ["rag.parl_resources", "rag.parl_embeddings"],
  },
};

// ============================================================================
// Utilities
// ============================================================================

function loadEnvFile(filePath: string): Record<string, string> {
  const fullPath = resolvePath(process.cwd(), filePath);
  if (!existsSync(fullPath)) {
    throw new Error(`Environment file not found: ${fullPath}`);
  }

  const content = readFileSync(fullPath, "utf-8");
  const env: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex);
    let value = trimmed.slice(eqIndex + 1);

    // Remove surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function parsePostgresUrl(url: string): DatabaseConfig {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port || "5432",
    user: parsed.username,
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.slice(1),
    sslmode: parsed.searchParams.get("sslmode") ?? undefined,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

/**
 * Build environment variables for PostgreSQL CLI tools.
 * Uses PGPASSWORD and other PG* env vars to avoid shell escaping issues.
 */
function buildPgEnv(config: DatabaseConfig): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PGHOST: config.host,
    PGPORT: config.port,
    PGUSER: config.user,
    PGPASSWORD: config.password,
    PGDATABASE: config.database,
  };
  if (config.sslmode) {
    env.PGSSLMODE = config.sslmode;
  }
  return env;
}

/**
 * Execute a command using spawn (safe from shell injection).
 * Returns a promise that resolves on success or rejects on failure.
 */
function execCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  options?: { verbose?: boolean }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: options?.verbose ? "inherit" : ["inherit", "inherit", "pipe"],
      env,
    });

    let stderr = "";
    if (!options?.verbose) {
      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });
    }

    proc.on("error", (error) => {
      reject(new Error(`Failed to start ${command}: ${error.message}`));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        const errorMsg = stderr.trim() || `exited with code ${code}`;
        reject(new Error(`${command} failed: ${errorMsg}`));
      }
    });
  });
}

/**
 * Execute a command and capture stdout.
 */
function execCommandWithOutput(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ["inherit", "pipe", "pipe"],
      env,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("error", (error) => {
      reject(new Error(`Failed to start ${command}: ${error.message}`));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`${command} failed: ${stderr.trim()}`));
      }
    });
  });
}

function createReadline(): ReturnType<typeof createInterface> {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function prompt(
  rl: ReturnType<typeof createInterface>,
  question: string
): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

// ============================================================================
// Database Operations
// ============================================================================

async function getTableSizes(
  config: DatabaseConfig,
  option: SyncOption
): Promise<string> {
  try {
    const syncConfig = SYNC_OPTIONS[option];
    let query: string;

    if (syncConfig.type === "schema") {
      query = `SELECT pg_size_pretty(COALESCE(SUM(pg_table_size(schemaname || '.' || tablename)), 0)) as size FROM pg_tables WHERE schemaname = '${syncConfig.schema}'`;
    } else {
      const tables = syncConfig.tables.map((t) => `'${t}'`).join(", ");
      query = `SELECT pg_size_pretty(COALESCE(SUM(pg_table_size(tablename)), 0)) as size FROM (SELECT unnest(ARRAY[${tables}]) as tablename) t`;
    }

    const result = await execCommandWithOutput(
      "psql",
      ["-t", "-c", query],
      buildPgEnv(config)
    );
    return result.trim() || "0 bytes";
  } catch {
    return "unknown";
  }
}

async function getRowCounts(
  config: DatabaseConfig,
  tables: string[]
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const env = buildPgEnv(config);

  for (const table of tables) {
    try {
      const result = await execCommandWithOutput(
        "psql",
        ["-t", "-c", `SELECT COUNT(*) FROM ${table}`],
        env
      );
      counts[table] = Number.parseInt(result.trim(), 10) || 0;
    } catch {
      counts[table] = 0;
    }
  }
  return counts;
}

/**
 * Get all indexes for the given tables (excluding primary keys and constraint-backed indexes).
 * Constraint-backed indexes (UNIQUE, FOREIGN KEY) can't be dropped independently and
 * will be maintained automatically during TRUNCATE + restore.
 */
async function getTableIndexes(
  config: DatabaseConfig,
  tables: string[]
): Promise<IndexInfo[]> {
  const env = buildPgEnv(config);
  const indexes: IndexInfo[] = [];

  for (const table of tables) {
    const [schema, tableName] = table.split(".");
    // Exclude indexes that back constraints (unique, foreign key, etc.)
    const query = `
      SELECT i.schemaname, i.tablename, i.indexname
      FROM pg_indexes i
      LEFT JOIN pg_constraint c
        ON c.conname = i.indexname
        AND c.connamespace = (SELECT oid FROM pg_namespace WHERE nspname = i.schemaname)
      WHERE i.schemaname = '${schema}'
        AND i.tablename = '${tableName}'
        AND i.indexname NOT LIKE '%_pkey'
        AND c.conname IS NULL
      ORDER BY i.indexname
    `;

    try {
      const result = await execCommandWithOutput(
        "psql",
        ["-t", "-A", "-F", "|", "-c", query],
        env
      );

      for (const line of result.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        const [schemaName, tblName, indexName] = trimmed.split("|");
        if (schemaName && tblName && indexName) {
          indexes.push({ schema: schemaName, table: tblName, name: indexName });
        }
      }
    } catch {
      // Table might not exist yet, continue
    }
  }

  return indexes;
}

/**
 * Drop indexes by name.
 */
async function dropIndexes(
  config: DatabaseConfig,
  indexes: IndexInfo[]
): Promise<void> {
  if (indexes.length === 0) {
    console.log("   No indexes to drop");
    return;
  }

  console.log(`   Dropping ${indexes.length} indexes...`);
  const env = buildPgEnv(config);

  for (const index of indexes) {
    try {
      await execCommandWithOutput(
        "psql",
        ["-c", `DROP INDEX IF EXISTS "${index.schema}"."${index.name}"`],
        env
      );
      console.log(`     ✓ ${index.schema}.${index.name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(
        `     ⚠ ${index.schema}.${index.name}: ${msg.split("\n")[0]}`
      );
    }
  }
}

/**
 * Rebuild indexes using REINDEX TABLE.
 * This rebuilds all indexes on the table using their original definitions.
 */
async function reindexTables(
  config: DatabaseConfig,
  tables: string[]
): Promise<void> {
  console.log(`   Rebuilding indexes for ${tables.length} tables...`);
  const env = buildPgEnv(config);

  for (const table of tables) {
    const start = Date.now();
    try {
      await execCommandWithOutput(
        "psql",
        ["-c", `REINDEX TABLE ${table}`],
        env
      );
      console.log(`     ✓ ${table} (${formatDuration(Date.now() - start)})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`     ✗ ${table}: ${msg.split("\n")[0]}`);
    }
  }
}

// ============================================================================
// Sync Operations
// ============================================================================

async function getSchemaTableNames(
  config: DatabaseConfig,
  schema: string
): Promise<string[]> {
  const query = `SELECT tablename FROM pg_tables WHERE schemaname = '${schema}' ORDER BY tablename`;
  const result = await execCommandWithOutput(
    "psql",
    ["-t", "-c", query],
    buildPgEnv(config)
  );
  return result
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((table) => `${schema}.${table}`);
}

async function syncSchema(
  schema: string,
  localConfig: DatabaseConfig,
  prodConfig: DatabaseConfig
): Promise<void> {
  const dumpFile = join(tmpdir(), `ps_${schema}_${Date.now()}.dump`);

  try {
    // Step 1: Get tables in schema and check row counts
    console.log(`\n📊 Checking local ${schema} schema...`);
    const tables = await getSchemaTableNames(localConfig, schema);
    if (tables.length === 0) {
      throw new Error(`No tables found in ${schema} schema on local database.`);
    }
    console.log(`   Found ${tables.length} tables`);

    const localCounts = await getRowCounts(localConfig, tables);
    let totalRows = 0;
    for (const [table, count] of Object.entries(localCounts)) {
      console.log(`   ${table}: ${count.toLocaleString()} rows`);
      totalRows += count;
    }

    // Pre-flight: prevent syncing empty schema to production
    if (totalRows === 0) {
      throw new Error(
        `Local ${schema} schema has no data. Aborting to prevent wiping production.\n` +
          "If you intended to clear production, use TRUNCATE commands directly."
      );
    }

    // Step 2: Dump data only from local (schema structure already exists in prod)
    console.log(`\n📦 Dumping ${schema} schema data from local...`);
    const dumpStart = Date.now();
    await execCommand(
      "pg_dump",
      [
        "-Fc",
        "--verbose",
        "--data-only",
        `--schema=${schema}`,
        "--no-owner",
        "-f",
        dumpFile,
      ],
      buildPgEnv(localConfig),
      { verbose: true }
    );
    const dumpSize = statSync(dumpFile).size;
    console.log(
      `   ✓ Dump complete: ${formatBytes(dumpSize)} (${formatDuration(Date.now() - dumpStart)})`
    );

    // Pre-flight: verify dump file has content
    if (dumpSize === 0) {
      throw new Error(
        "Dump file is empty. This shouldn't happen with non-empty tables."
      );
    }

    // Step 3: Truncate all tables in production schema
    console.log(`\n🗑️  Truncating ${schema} tables on production...`);
    const prodEnv = buildPgEnv(prodConfig);
    // Use CASCADE to handle foreign key dependencies
    await execCommandWithOutput(
      "psql",
      ["-c", `TRUNCATE ${tables.join(", ")} CASCADE`],
      prodEnv
    );
    console.log(`   ✓ Truncated ${tables.length} tables`);

    // Step 4: Restore data to production
    console.log(
      `\n🚀 Restoring data to production (${PARALLEL_JOBS} parallel jobs)...`
    );
    const restoreStart = Date.now();
    await execCommand(
      "pg_restore",
      [
        `--jobs=${PARALLEL_JOBS}`,
        "--verbose",
        "--no-owner",
        "-d",
        prodConfig.database,
        dumpFile,
      ],
      buildPgEnv(prodConfig),
      { verbose: true }
    );
    console.log(
      `   ✓ Restore complete (${formatDuration(Date.now() - restoreStart)})`
    );

    // Step 5: Verify row counts
    console.log("\n📊 Verifying production row counts...");
    const prodCounts = await getRowCounts(prodConfig, tables);
    let allMatch = true;
    for (const table of tables) {
      const local = localCounts[table] || 0;
      const prod = prodCounts[table] || 0;
      const match = local === prod;
      const icon = match ? "✓" : "✗";
      console.log(
        `   ${icon} ${table}: ${prod.toLocaleString()} rows${match ? "" : ` (expected ${local.toLocaleString()})`}`
      );
      if (!match) {
        allMatch = false;
      }
    }
    if (!allMatch) {
      console.log(
        "\n⚠️  Warning: Row counts don't match. Data may be incomplete."
      );
    }
  } finally {
    // Cleanup
    if (existsSync(dumpFile)) {
      console.log("\n🧹 Cleaning up temp file...");
      unlinkSync(dumpFile);
    }
  }
}

async function syncTables(
  config: TablesConfig,
  localConfig: DatabaseConfig,
  prodConfig: DatabaseConfig
): Promise<void> {
  const { tables } = config;
  const dumpFile = join(tmpdir(), `ps_tables_${Date.now()}.dump`);

  try {
    // Step 1: Get row counts from local (pre-flight validation)
    console.log("\n📊 Checking local row counts...");
    const localCounts = await getRowCounts(localConfig, tables);
    let totalRows = 0;
    for (const [table, count] of Object.entries(localCounts)) {
      console.log(`   ${table}: ${count.toLocaleString()} rows`);
      totalRows += count;
    }

    // Pre-flight: prevent syncing empty tables to production
    if (totalRows === 0) {
      throw new Error(
        "Local tables are empty. Aborting to prevent wiping production data.\n" +
          "If you intended to clear production, use a direct TRUNCATE command instead."
      );
    }

    // Step 2: Get indexes from production (we'll drop and rebuild them)
    console.log("\n📋 Getting index information from production...");
    const indexes = await getTableIndexes(prodConfig, tables);
    console.log(`   Found ${indexes.length} indexes to manage`);

    // Step 3: Dump tables from local (data only - tables exist in prod)
    console.log("\n📦 Dumping tables from local...");
    const dumpStart = Date.now();
    const tableFlags = tables.flatMap((t) => ["-t", t]);
    await execCommand(
      "pg_dump",
      [
        "-Fc",
        "--verbose",
        "--data-only",
        ...tableFlags,
        "--no-owner",
        "-f",
        dumpFile,
      ],
      buildPgEnv(localConfig),
      { verbose: true }
    );
    const dumpSize = statSync(dumpFile).size;
    console.log(
      `   ✓ Dump complete: ${formatBytes(dumpSize)} (${formatDuration(Date.now() - dumpStart)})`
    );

    // Pre-flight: verify dump file has content
    if (dumpSize === 0) {
      throw new Error(
        "Dump file is empty. This shouldn't happen with non-empty tables."
      );
    }

    // Step 4: Drop indexes on production for faster loading
    console.log("\n📉 Dropping indexes on production...");
    await dropIndexes(prodConfig, indexes);

    // Step 5: Truncate tables on production
    console.log("\n🗑️  Truncating tables on production...");
    const prodEnv = buildPgEnv(prodConfig);
    // Truncate in reverse order (embeddings before resources due to FK)
    const truncateOrder = [...tables].reverse();
    for (const table of truncateOrder) {
      await execCommandWithOutput(
        "psql",
        ["-c", `TRUNCATE ${table} CASCADE`],
        prodEnv
      );
      console.log(`   ✓ ${table}`);
    }

    // Step 6: Restore data to production
    console.log(`\n🚀 Restoring data (${PARALLEL_JOBS} parallel jobs)...`);
    const restoreStart = Date.now();
    await execCommand(
      "pg_restore",
      [
        `--jobs=${PARALLEL_JOBS}`,
        "--verbose",
        "--no-owner",
        "-d",
        prodConfig.database,
        dumpFile,
      ],
      buildPgEnv(prodConfig),
      { verbose: true }
    );
    console.log(
      `   ✓ Data restore complete (${formatDuration(Date.now() - restoreStart)})`
    );

    // Step 7: Verify row counts
    console.log("\n📊 Verifying production row counts...");
    const prodCounts = await getRowCounts(prodConfig, tables);
    let allMatch = true;
    for (const table of tables) {
      const local = localCounts[table] || 0;
      const prod = prodCounts[table] || 0;
      const match = local === prod;
      const icon = match ? "✓" : "✗";
      console.log(
        `   ${icon} ${table}: ${prod.toLocaleString()} rows${match ? "" : ` (expected ${local.toLocaleString()})`}`
      );
      if (!match) {
        allMatch = false;
      }
    }
    if (!allMatch) {
      console.log(
        "\n⚠️  Warning: Row counts don't match. Data may be incomplete."
      );
    }

    // Step 8: Rebuild indexes using REINDEX
    console.log(
      "\n📈 Rebuilding indexes (HNSW indexes may take several minutes)..."
    );
    const indexStart = Date.now();
    await reindexTables(prodConfig, tables);
    console.log(
      `   Total index time: ${formatDuration(Date.now() - indexStart)}`
    );
  } finally {
    // Cleanup
    if (existsSync(dumpFile)) {
      console.log("\n🧹 Cleaning up temp file...");
      unlinkSync(dumpFile);
    }
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const rl = createReadline();

  try {
    console.log(
      "\n╔═══════════════════════════════════════════════════════════╗"
    );
    console.log(
      "║     Fast Database Sync: Local → Production                ║"
    );
    console.log(
      "║     Using pg_dump/pg_restore for optimal performance      ║"
    );
    console.log(
      "╚═══════════════════════════════════════════════════════════╝\n"
    );

    // Load environment files
    console.log("Loading environment configurations...");
    const localEnv = loadEnvFile(".env.local");
    const prodEnv = loadEnvFile(".env.production.local");

    if (!localEnv.POSTGRES_URL) {
      throw new Error("POSTGRES_URL not found in .env.local");
    }
    if (!prodEnv.POSTGRES_URL) {
      throw new Error("POSTGRES_URL not found in .env.production.local");
    }

    const localConfig = parsePostgresUrl(localEnv.POSTGRES_URL);
    const prodConfig = parsePostgresUrl(prodEnv.POSTGRES_URL);

    console.log(`  Local:      ${localConfig.host}/${localConfig.database}`);
    console.log(`  Production: ${prodConfig.host}/${prodConfig.database}\n`);

    // Check for pg_dump/pg_restore
    try {
      await execCommandWithOutput(
        "which",
        ["pg_dump"],
        process.env as NodeJS.ProcessEnv
      );
      await execCommandWithOutput(
        "which",
        ["pg_restore"],
        process.env as NodeJS.ProcessEnv
      );
    } catch {
      throw new Error(
        "pg_dump and pg_restore are required. Install PostgreSQL client tools.\n" +
          "  macOS: brew install postgresql\n" +
          "  Ubuntu: sudo apt install postgresql-client"
      );
    }
    console.log("✓ PostgreSQL client tools available\n");

    // Show options with sizes
    console.log("Select what to sync:\n");
    const options = Object.entries(SYNC_OPTIONS) as [SyncOption, SyncConfig][];

    for (let i = 0; i < options.length; i++) {
      const [key, syncConfig] = options[i];
      const size = await getTableSizes(localConfig, key);
      console.log(`  ${i + 1}. ${syncConfig.label} (${size})`);
      console.log(`     ${syncConfig.details}\n`);
    }

    // Get selection
    const answer = await prompt(rl, "Enter selection (1-4): ");
    const selection = Number.parseInt(answer.trim(), 10);

    if (selection < 1 || selection > 4) {
      console.log("\n❌ Invalid selection. Please enter 1-4.");
      return;
    }

    const [, selectedConfig] = options[selection - 1];

    // Confirm
    console.log(`\n${"═".repeat(60)}`);
    console.log("⚠️  WARNING: This will REPLACE data in production!");
    console.log(`${"═".repeat(60)}\n`);
    console.log(`Selected: ${selectedConfig.label}`);
    console.log(`Target:   ${prodConfig.host}/${prodConfig.database}\n`);

    if (selectedConfig.type === "tables") {
      console.log("This will:");
      console.log("  1. Drop all indexes on the target tables");
      console.log("  2. Truncate the target tables");
      console.log("  3. Load data from local database");
      console.log(
        "  4. Rebuild indexes using REINDEX (HNSW indexes are slow)\n"
      );
    } else {
      console.log("This will:");
      console.log(
        "  1. Truncate all tables in the schema (preserves structure)"
      );
      console.log("  2. Load data from local database");
      console.log("  3. Verify row counts match\n");
    }

    const confirm = await prompt(rl, 'Type "yes" to proceed: ');
    if (confirm.toLowerCase() !== "yes") {
      console.log("\n❌ Sync cancelled.");
      return;
    }

    // Perform sync
    const totalStart = Date.now();
    console.log(`\n${"═".repeat(60)}`);
    console.log("Starting sync...");
    console.log(`${"═".repeat(60)}`);

    if (selectedConfig.type === "schema") {
      await syncSchema(selectedConfig.schema, localConfig, prodConfig);
    } else {
      await syncTables(selectedConfig, localConfig, prodConfig);
    }

    console.log(`\n${"═".repeat(60)}`);
    console.log("✅ Sync completed successfully!");
    console.log(`   Total time: ${formatDuration(Date.now() - totalStart)}`);
    console.log(`${"═".repeat(60)}\n`);
  } catch (error) {
    console.error(
      "\n❌ Error:",
      error instanceof Error ? error.message : error
    );
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}

main();
