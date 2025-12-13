/**
 * Sync local database data to production
 * Usage: npx tsx scripts/sync-to-prod.ts [--resume] [--rebuild-indexes]
 *
 * This script syncs data from local PostgreSQL to production.
 * It reads from .env.local (local) and .env.production.local (prod).
 *
 * CLI Flags:
 *   --resume          Continue from where it left off (skip truncate, find MAX(id))
 *   --rebuild-indexes ONLY recreate indexes on prod (no data sync) - use after failed sync
 *
 * Options:
 *   1. Parliament schema - All parliament.* tables
 *   2. Legislation schema - All legislation.* tables
 *   3. RAG leg_* tables - rag.leg_embeddings, rag.leg_resources
 *   4. RAG parl_* tables - rag.parl_embeddings, rag.parl_resources
 *
 * Performance optimizations:
 *   - Uses COPY format (not INSERT) for 10-50x faster data transfer
 *   - Parallel processing for independent table groups
 *   - Progress indicator via pv (if installed)
 *   - Keyset pagination for batching (O(1) per batch vs O(n) for OFFSET)
 *   - Batch delay (500ms) to avoid PlanetScale rate limits
 *
 * PlanetScale Compatibility:
 *   - Batch size capped at 10k rows (well under 100k statement limit)
 *   - Resume capability for interrupted syncs
 *
 * WARNING: This will REPLACE data in production. Use with caution.
 */

import { type ChildProcess, execSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { createInterface } from "node:readline";
import postgres from "postgres";

type DatabaseConfig = {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  sslmode?: string;
};

type SyncOption = "parliament" | "legislation" | "rag_leg" | "rag_parl";

type TableRowCount = {
  tableName: string;
  rowCount: number;
};

type TableSyncOptions = {
  table: string;
  localConfig: DatabaseConfig;
  prodConfig: DatabaseConfig;
  localEnv: NodeJS.ProcessEnv;
  prodEnv: NodeJS.ProcessEnv;
  /** For keyset pagination - start after this ID (empty string for first batch) */
  lastId?: string;
  limit?: number;
  /** Timeout in ms - will kill processes if exceeded */
  timeoutMs?: number;
};

const SYNC_OPTIONS: Record<SyncOption, { label: string; details: string }> = {
  parliament: {
    label: "Parliament schema",
    details: "bills, hansards, committees, politicians, etc.",
  },
  legislation: {
    label: "Legislation schema",
    details: "acts, regulations, sections, defined_terms, cross_references",
  },
  rag_leg: {
    label: "RAG leg_* tables",
    details: "leg_embeddings, leg_resources",
  },
  rag_parl: {
    label: "RAG parl_* tables",
    details: "parl_embeddings, parl_resources",
  },
};

// Batch size for large table processing (number of rows per batch)
// PlanetScale enforces 100k row limit per SQL statement
// Use 3k for embeddings tables (large rows with vectors) to avoid timeouts
const BATCH_SIZE = 3000;

// Delay between batches (ms) to ensure clean separation on PlanetScale
const BATCH_DELAY_MS = 500;

// Timeout for batch operations (ms) - fail if a batch takes longer than this
const BATCH_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

/** Sleep for specified milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Tables that benefit from batched processing (large tables with sequential IDs)
// Note: These tables MUST have an `id` column for ORDER BY in batch queries
const LARGE_TABLES = [
  "rag.leg_embeddings",
  "rag.leg_resources",
  "rag.parl_embeddings",
  "rag.parl_resources",
];

// Security: Allowlist of valid schema names for SQL interpolation
// Only these schemas can be synced to prevent SQL injection
const ALLOWED_SCHEMAS = ["parliament", "legislation"] as const;

// Security: Allowlist of valid table names for SQL interpolation
// Only these tables can be synced to prevent SQL injection
const ALLOWED_TABLES = [
  "rag.leg_embeddings",
  "rag.leg_resources",
  "rag.parl_embeddings",
  "rag.parl_resources",
] as const;

// ---------- Index Management ----------
// Indexes are dropped before bulk load and recreated after for performance
// DROP uses IF EXISTS to handle cases where indexes don't exist
// CREATE uses IF NOT EXISTS for idempotency

type IndexDefinition = {
  name: string;
  dropSql: string;
  createSql: string;
};

const LEG_EMBEDDING_INDEXES: IndexDefinition[] = [
  {
    name: "leg_embeddings_resource_id_idx",
    dropSql: "DROP INDEX IF EXISTS rag.leg_embeddings_resource_id_idx",
    createSql:
      "CREATE INDEX IF NOT EXISTS leg_embeddings_resource_id_idx ON rag.leg_embeddings (resource_id)",
  },
  {
    name: "leg_embeddings_embedding_idx",
    dropSql: "DROP INDEX IF EXISTS rag.leg_embeddings_embedding_idx",
    createSql:
      "CREATE INDEX IF NOT EXISTS leg_embeddings_embedding_idx ON rag.leg_embeddings USING hnsw (embedding vector_cosine_ops)",
  },
  {
    name: "leg_embeddings_tsv_idx",
    dropSql: "DROP INDEX IF EXISTS rag.leg_embeddings_tsv_idx",
    createSql:
      "CREATE INDEX IF NOT EXISTS leg_embeddings_tsv_idx ON rag.leg_embeddings USING gin (tsv)",
  },
  {
    name: "leg_embeddings_model_idx",
    dropSql: "DROP INDEX IF EXISTS rag.leg_embeddings_model_idx",
    createSql:
      "CREATE INDEX IF NOT EXISTS leg_embeddings_model_idx ON rag.leg_embeddings (embedding_model)",
  },
];

const LEG_RESOURCE_INDEXES: IndexDefinition[] = [
  // Unique constraint (must be dropped/created as constraint, not index)
  {
    name: "leg_resources_resource_key_unique",
    dropSql:
      "ALTER TABLE rag.leg_resources DROP CONSTRAINT IF EXISTS leg_resources_resource_key_unique",
    createSql:
      "ALTER TABLE rag.leg_resources ADD CONSTRAINT leg_resources_resource_key_unique UNIQUE (resource_key)",
  },
  {
    name: "leg_resources_resource_key_idx",
    dropSql: "DROP INDEX IF EXISTS rag.leg_resources_resource_key_idx",
    createSql:
      "CREATE INDEX IF NOT EXISTS leg_resources_resource_key_idx ON rag.leg_resources (resource_key)",
  },
  {
    name: "leg_resources_lang_source_idx",
    dropSql: "DROP INDEX IF EXISTS rag.leg_resources_lang_source_idx",
    createSql:
      "CREATE INDEX IF NOT EXISTS leg_resources_lang_source_idx ON rag.leg_resources (language, source_type)",
  },
  {
    name: "leg_resources_paired_key_idx",
    dropSql: "DROP INDEX IF EXISTS rag.leg_resources_paired_key_idx",
    createSql:
      "CREATE INDEX IF NOT EXISTS leg_resources_paired_key_idx ON rag.leg_resources (paired_resource_key)",
  },
  {
    name: "leg_resources_metadata_gin",
    dropSql: "DROP INDEX IF EXISTS rag.leg_resources_metadata_gin",
    createSql:
      "CREATE INDEX IF NOT EXISTS leg_resources_metadata_gin ON rag.leg_resources USING gin (metadata)",
  },
  {
    name: "leg_resources_last_amended_date_idx",
    dropSql: "DROP INDEX IF EXISTS rag.leg_resources_last_amended_date_idx",
    createSql:
      "CREATE INDEX IF NOT EXISTS leg_resources_last_amended_date_idx ON rag.leg_resources ((metadata->>'lastAmendedDate'))",
  },
  {
    name: "leg_resources_enacted_date_idx",
    dropSql: "DROP INDEX IF EXISTS rag.leg_resources_enacted_date_idx",
    createSql:
      "CREATE INDEX IF NOT EXISTS leg_resources_enacted_date_idx ON rag.leg_resources ((metadata->>'enactedDate'))",
  },
  {
    name: "leg_resources_in_force_date_idx",
    dropSql: "DROP INDEX IF EXISTS rag.leg_resources_in_force_date_idx",
    createSql:
      "CREATE INDEX IF NOT EXISTS leg_resources_in_force_date_idx ON rag.leg_resources ((metadata->>'inForceDate'))",
  },
  {
    name: "leg_resources_consolidation_date_idx",
    dropSql: "DROP INDEX IF EXISTS rag.leg_resources_consolidation_date_idx",
    createSql:
      "CREATE INDEX IF NOT EXISTS leg_resources_consolidation_date_idx ON rag.leg_resources ((metadata->>'consolidationDate'))",
  },
  {
    name: "leg_resources_registration_date_idx",
    dropSql: "DROP INDEX IF EXISTS rag.leg_resources_registration_date_idx",
    createSql:
      "CREATE INDEX IF NOT EXISTS leg_resources_registration_date_idx ON rag.leg_resources ((metadata->>'registrationDate'))",
  },
  {
    name: "leg_resources_status_idx",
    dropSql: "DROP INDEX IF EXISTS rag.leg_resources_status_idx",
    createSql:
      "CREATE INDEX IF NOT EXISTS leg_resources_status_idx ON rag.leg_resources ((metadata->>'status'))",
  },
  {
    name: "leg_resources_section_status_idx",
    dropSql: "DROP INDEX IF EXISTS rag.leg_resources_section_status_idx",
    createSql:
      "CREATE INDEX IF NOT EXISTS leg_resources_section_status_idx ON rag.leg_resources ((metadata->>'sectionStatus'))",
  },
  {
    name: "leg_resources_act_id_idx",
    dropSql: "DROP INDEX IF EXISTS rag.leg_resources_act_id_idx",
    createSql:
      "CREATE INDEX IF NOT EXISTS leg_resources_act_id_idx ON rag.leg_resources ((metadata->>'actId'))",
  },
  {
    name: "leg_resources_regulation_id_idx",
    dropSql: "DROP INDEX IF EXISTS rag.leg_resources_regulation_id_idx",
    createSql:
      "CREATE INDEX IF NOT EXISTS leg_resources_regulation_id_idx ON rag.leg_resources ((metadata->>'regulationId'))",
  },
  {
    name: "leg_resources_section_label_idx",
    dropSql: "DROP INDEX IF EXISTS rag.leg_resources_section_label_idx",
    createSql:
      "CREATE INDEX IF NOT EXISTS leg_resources_section_label_idx ON rag.leg_resources ((metadata->>'sectionLabel'))",
  },
  {
    name: "leg_resources_status_amended_idx",
    dropSql: "DROP INDEX IF EXISTS rag.leg_resources_status_amended_idx",
    createSql:
      "CREATE INDEX IF NOT EXISTS leg_resources_status_amended_idx ON rag.leg_resources ((metadata->>'status'), (metadata->>'lastAmendedDate'))",
  },
];

const PARL_EMBEDDING_INDEXES: IndexDefinition[] = [
  {
    name: "parl_embeddings_embedding_idx",
    dropSql: "DROP INDEX IF EXISTS rag.parl_embeddings_embedding_idx",
    createSql:
      "CREATE INDEX IF NOT EXISTS parl_embeddings_embedding_idx ON rag.parl_embeddings USING hnsw (embedding vector_cosine_ops)",
  },
  {
    name: "parl_embeddings_tsv_idx",
    dropSql: "DROP INDEX IF EXISTS rag.parl_embeddings_tsv_idx",
    createSql:
      "CREATE INDEX IF NOT EXISTS parl_embeddings_tsv_idx ON rag.parl_embeddings USING gin (tsv)",
  },
];

const PARL_RESOURCE_INDEXES: IndexDefinition[] = [
  {
    name: "parl_resources_metadata_gin",
    dropSql: "DROP INDEX IF EXISTS rag.parl_resources_metadata_gin",
    createSql:
      "CREATE INDEX IF NOT EXISTS parl_resources_metadata_gin ON rag.parl_resources USING gin (metadata)",
  },
];

/**
 * Get all indexes for a table group
 */
function getIndexesForTableGroup(
  tableGroup: "rag_leg" | "rag_parl"
): IndexDefinition[] {
  if (tableGroup === "rag_leg") {
    return [...LEG_RESOURCE_INDEXES, ...LEG_EMBEDDING_INDEXES];
  }
  return [...PARL_RESOURCE_INDEXES, ...PARL_EMBEDDING_INDEXES];
}

/**
 * Drop indexes on a production database for faster bulk loading
 * Uses the dropSql from each IndexDefinition
 */
async function dropIndexes(
  config: DatabaseConfig,
  indexes: IndexDefinition[]
): Promise<void> {
  const sql = postgres(buildConnectionString(config), { max: 1 });

  try {
    console.log(`  Dropping ${indexes.length} indexes...`);
    for (const index of indexes) {
      try {
        await sql.unsafe(index.dropSql);
        console.log(`    ✓ Dropped ${index.name}`);
      } catch (err) {
        // Log warning but continue - index might not exist
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`    ⚠️  Could not drop ${index.name}: ${msg}`);
      }
    }
    console.log("  ✓ Index drop complete");
  } finally {
    await sql.end();
  }
}

/**
 * Create indexes on a production database after bulk loading
 * Uses the createSql from each IndexDefinition
 * HNSW indexes can take several minutes for large tables
 */
async function createIndexes(
  config: DatabaseConfig,
  indexes: IndexDefinition[]
): Promise<void> {
  const sql = postgres(buildConnectionString(config), { max: 1 });

  try {
    console.log(`  Creating ${indexes.length} indexes...`);
    for (const index of indexes) {
      const startTime = Date.now();
      try {
        await sql.unsafe(index.createSql);
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`    ✓ Created ${index.name} (${duration}s)`);
      } catch (err) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `    ❌ Failed to create ${index.name} after ${duration}s: ${msg}`
        );
        // Continue with other indexes - user can manually create failed ones
      }
    }
    console.log("  ✓ Index creation complete");
  } finally {
    await sql.end();
  }
}

/**
 * Validate that a schema name is in the allowlist
 * Throws if invalid to prevent SQL injection via schema names
 */
function validateSchemaName(schema: string): void {
  if (!ALLOWED_SCHEMAS.includes(schema as (typeof ALLOWED_SCHEMAS)[number])) {
    throw new Error(
      `Invalid schema name: "${schema}". Allowed schemas: ${ALLOWED_SCHEMAS.join(", ")}`
    );
  }
}

/**
 * Validate that a table name is in the allowlist
 * Throws if invalid to prevent SQL injection via table names
 */
function validateTableName(table: string): void {
  if (!ALLOWED_TABLES.includes(table as (typeof ALLOWED_TABLES)[number])) {
    throw new Error(
      `Invalid table name: "${table}". Allowed tables: ${ALLOWED_TABLES.join(", ")}`
    );
  }
}

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

    // Remove surrounding quotes if present
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
  const sslmode = parsed.searchParams.get("sslmode") ?? undefined;
  return {
    host: parsed.hostname,
    port: parsed.port || "5432",
    user: parsed.username,
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.slice(1),
    sslmode,
  };
}

function buildConnectionString(config: DatabaseConfig): string {
  const base = `postgres://${config.user}:${encodeURIComponent(config.password)}@${config.host}:${config.port}/${config.database}`;
  return config.sslmode ? `${base}?sslmode=${config.sslmode}` : base;
}

/**
 * Check if pv (pipe viewer) is installed for progress monitoring
 * Result is cached to avoid repeated shell spawns
 */
let _pvInstalledCache: boolean | null = null;
function isPvInstalled(): boolean {
  if (_pvInstalledCache !== null) {
    return _pvInstalledCache;
  }
  try {
    execSync("which pv", { stdio: "ignore" });
    _pvInstalledCache = true;
  } catch {
    _pvInstalledCache = false;
  }
  return _pvInstalledCache;
}

async function getSyncOptionSizes(
  localConfig: DatabaseConfig
): Promise<Record<SyncOption, string>> {
  const sql = postgres(buildConnectionString(localConfig), { max: 1 });

  try {
    const results = await sql`
      SELECT 'parliament' as option,
             pg_size_pretty(COALESCE(SUM(pg_table_size(schemaname || '.' || tablename)), 0)) as size
      FROM pg_tables WHERE schemaname = 'parliament'
      UNION ALL
      SELECT 'legislation' as option,
             pg_size_pretty(COALESCE(SUM(pg_table_size(schemaname || '.' || tablename)), 0)) as size
      FROM pg_tables WHERE schemaname = 'legislation'
      UNION ALL
      SELECT 'rag_leg' as option,
             pg_size_pretty(COALESCE(SUM(pg_table_size('rag.' || tablename)), 0)) as size
      FROM pg_tables WHERE schemaname = 'rag' AND tablename LIKE 'leg_%'
      UNION ALL
      SELECT 'rag_parl' as option,
             pg_size_pretty(COALESCE(SUM(pg_table_size('rag.' || tablename)), 0)) as size
      FROM pg_tables WHERE schemaname = 'rag' AND tablename LIKE 'parl_%'
    `;

    const sizes: Record<SyncOption, string> = {
      parliament: "unknown",
      legislation: "unknown",
      rag_leg: "unknown",
      rag_parl: "unknown",
    };

    for (const row of results) {
      if (row.option in sizes) {
        sizes[row.option as SyncOption] = row.size || "empty";
      }
    }

    return sizes;
  } finally {
    await sql.end();
  }
}

/**
 * Get row counts for tables to enable batching decisions
 */
async function getTableRowCounts(
  config: DatabaseConfig,
  tables: string[]
): Promise<TableRowCount[]> {
  const sql = postgres(buildConnectionString(config), { max: 1 });

  try {
    const counts: TableRowCount[] = [];
    for (const table of tables) {
      const result = await sql.unsafe(`SELECT COUNT(*) as count FROM ${table}`);
      counts.push({
        tableName: table,
        rowCount: Number(result[0]?.count || 0),
      });
    }
    return counts;
  } finally {
    await sql.end();
  }
}

/**
 * Get the maximum ID currently in a table (for resume capability)
 * Returns empty string if table is empty
 */
async function getMaxIdInTable(
  config: DatabaseConfig,
  table: string
): Promise<string> {
  const sql = postgres(buildConnectionString(config), { max: 1 });

  try {
    const result = await sql.unsafe(`SELECT MAX(id) as max_id FROM ${table}`);
    return result[0]?.max_id || "";
  } finally {
    await sql.end();
  }
}

/**
 * Get the last ID in a batch for keyset pagination
 * Uses MAX over a limited window for efficient index-only scan
 * Returns null if no rows exist after lastId
 */
async function getLastIdInBatch(
  config: DatabaseConfig,
  table: string,
  lastId: string,
  limit: number
): Promise<string | null> {
  const sql = postgres(buildConnectionString(config), { max: 1 });

  try {
    // Efficient: uses index to find first `limit` rows after lastId, then gets MAX
    // This is O(batch_size) regardless of how many batches have been processed
    const whereClause = lastId ? `WHERE id > '${lastId}'` : "";
    const result = await sql.unsafe(`
      SELECT MAX(id) as max_id FROM (
        SELECT id FROM ${table}
        ${whereClause}
        ORDER BY id
        LIMIT ${limit}
      ) sub
    `);
    return result[0]?.max_id || null;
  } finally {
    await sql.end();
  }
}

function createReadlineInterface(): ReturnType<typeof createInterface> {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function prompt(
  rl: ReturnType<typeof createInterface>,
  question: string
): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function selectSyncOptions(
  rl: ReturnType<typeof createInterface>,
  sizes: Record<SyncOption, string>
): Promise<SyncOption[]> {
  console.log("\n=== Database Sync: Local → Production ===\n");
  console.log('Select what to sync (comma-separated numbers, or "all"):\n');

  const options = Object.entries(SYNC_OPTIONS) as [
    SyncOption,
    { label: string; details: string },
  ][];

  options.forEach(([key, { label, details }], index) => {
    console.log(`  ${index + 1}. ${label} (${sizes[key]})`);
    console.log(`     ${details}\n`);
  });

  const answer = await prompt(rl, "Your selection: ");

  if (answer.toLowerCase() === "all") {
    return options.map(([key]) => key);
  }

  const indices = answer
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10) - 1)
    .filter((i) => i >= 0 && i < options.length);

  if (indices.length === 0) {
    throw new Error(
      `No valid options selected. Enter numbers 1-${options.length} separated by commas, or "all".`
    );
  }

  return indices.map((i) => options[i][0]);
}

async function confirmSync(
  rl: ReturnType<typeof createInterface>,
  selectedOptions: SyncOption[],
  prodConfig: DatabaseConfig,
  resume = false
): Promise<boolean> {
  if (resume) {
    console.log("\n🔄 RESUME MODE: Will continue from where it left off\n");
  } else {
    console.log("\n⚠️  WARNING: This will REPLACE data in production!\n");
  }
  console.log(`Production database: ${prodConfig.host}/${prodConfig.database}`);
  console.log("\nSelected for sync:");
  for (const opt of selectedOptions) {
    console.log(`  - ${SYNC_OPTIONS[opt].label}`);
  }

  // Show optimization info
  console.log("\n📊 Performance optimizations enabled:");
  console.log("  - COPY format (not INSERT) for fast bulk transfer");
  if (isPvInstalled()) {
    console.log("  - Progress indicator via pv");
  } else {
    console.log(
      "  - Progress indicator (pv not installed, using basic output)"
    );
  }
  if (resume) {
    console.log("  - Resume mode (no truncate, continues from MAX(id))");
  }

  const answer = await prompt(rl, '\nType "yes" to confirm: ');
  return answer.toLowerCase() === "yes";
}

/**
 * Build common PostgreSQL CLI arguments for pg_dump and psql
 * Both tools use the same connection arguments
 */
function buildPgArgs(config: DatabaseConfig): string[] {
  return [
    "-h",
    config.host,
    "-p",
    config.port,
    "-U",
    config.user,
    "-d",
    config.database,
  ];
}

/**
 * Build environment variables for PostgreSQL CLI tools
 * Includes PGPASSWORD and PGSSLMODE when configured
 */
function buildPgEnv(config: DatabaseConfig): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PGPASSWORD: config.password,
  };
  if (config.sslmode) {
    env.PGSSLMODE = config.sslmode;
  }
  return env;
}

/**
 * Pipe data through pv for progress indication if available
 */
function createProgressPipe(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
  label: string
): ChildProcess | null {
  if (!isPvInstalled()) {
    input.pipe(output);
    return null;
  }

  const pv = spawn("pv", ["-N", label, "-c", "-W"], {
    stdio: ["pipe", "pipe", "inherit"],
  });

  input.pipe(pv.stdin as NodeJS.WritableStream);
  (pv.stdout as NodeJS.ReadableStream).pipe(output);

  return pv;
}

async function syncSchema(
  schema: string,
  localConfig: DatabaseConfig,
  prodConfig: DatabaseConfig
): Promise<void> {
  // Validate schema name against allowlist to prevent SQL injection
  validateSchemaName(schema);

  console.log(`\nSyncing schema: ${schema}...`);

  const localEnv = buildPgEnv(localConfig);
  const prodEnv = buildPgEnv(prodConfig);

  // Step 1: Drop existing schema in prod
  console.log(`  Dropping existing ${schema} schema in production...`);
  const dropSql = `DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema};`;
  const psqlDropArgs = [...buildPgArgs(prodConfig), "-c", dropSql];
  await runCommand("psql", psqlDropArgs, prodEnv);

  // Step 2: Dump from local and pipe to prod (using COPY format - default)
  console.log(`  Dumping ${schema} from local and loading to production...`);

  const pgDumpArgs = [
    ...buildPgArgs(localConfig),
    `--schema=${schema}`,
    "--no-owner",
    "--no-privileges",
    "--no-comments",
  ];

  const psqlArgs = [...buildPgArgs(prodConfig), "-q"];

  return new Promise((resolve, reject) => {
    const pgDump = spawn("pg_dump", pgDumpArgs, {
      stdio: ["inherit", "pipe", "pipe"],
      env: localEnv,
    });

    const psql = spawn("psql", psqlArgs, {
      stdio: ["pipe", "inherit", "pipe"],
      env: prodEnv,
    });

    let pgDumpStderr = "";
    let psqlStderr = "";

    pgDump.stderr?.on("data", (data) => {
      pgDumpStderr += data.toString();
    });

    psql.stderr?.on("data", (data) => {
      psqlStderr += data.toString();
    });

    // Use progress pipe if pv is available
    const pvProc = createProgressPipe(
      pgDump.stdout as NodeJS.ReadableStream,
      psql.stdin as NodeJS.WritableStream,
      schema
    );

    pgDump.on("error", (error) => {
      psql.kill();
      pvProc?.kill();
      reject(new Error(`pg_dump failed: ${error.message}`));
    });

    psql.on("error", (error) => {
      pgDump.kill();
      pvProc?.kill();
      reject(new Error(`psql failed: ${error.message}`));
    });

    psql.on("close", (code) => {
      if (code === 0) {
        console.log(`  ✓ Schema ${schema} synced successfully`);
        resolve();
      } else {
        reject(new Error(`psql exited with code ${code}: ${psqlStderr}`));
      }
    });

    pgDump.on("close", (code) => {
      if (code !== 0) {
        psql.kill();
        pvProc?.kill();
        reject(new Error(`pg_dump exited with code ${code}: ${pgDumpStderr}`));
      }
    });
  });
}

function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ["inherit", "inherit", "pipe"],
      env,
    });

    let stderr = "";
    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("error", (error) => {
      reject(new Error(`Failed to start ${command}: ${error.message}`));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}: ${stderr}`));
      }
    });
  });
}

type SyncSingleTableOptions = {
  table: string;
  localConfig: DatabaseConfig;
  prodConfig: DatabaseConfig;
  rowCount: number;
  /** If provided, resume from this ID (skip rows <= this ID) */
  resumeFromId?: string;
};

/**
 * Sync a single table with optimizations
 */
async function syncSingleTable(options: SyncSingleTableOptions): Promise<void> {
  const {
    table,
    localConfig,
    prodConfig,
    rowCount,
    resumeFromId = "",
  } = options;
  const localEnv = buildPgEnv(localConfig);
  const prodEnv = buildPgEnv(prodConfig);

  // Only batch tables explicitly listed in LARGE_TABLES (which must have an `id` column)
  // Batching uses keyset pagination (WHERE id > lastId) for O(1) batch access
  const shouldBatch = LARGE_TABLES.includes(table) && rowCount > BATCH_SIZE;
  const estimatedBatchCount = shouldBatch
    ? Math.ceil(rowCount / BATCH_SIZE)
    : 1;

  const resumeInfo = resumeFromId
    ? ` (resuming from id '${resumeFromId.slice(0, 8)}...')`
    : "";
  console.log(
    `  Syncing ${table} (${rowCount.toLocaleString()} rows${shouldBatch ? `, ~${estimatedBatchCount} batches` : ""}${resumeInfo})...`
  );

  if (shouldBatch) {
    // Batch processing using keyset pagination (O(1) per batch vs O(n) for OFFSET)
    let lastId = resumeFromId;
    let batch = 0;

    while (true) {
      // Get the last ID that will be in this batch
      console.log(
        `    🔍 Looking for batch after id='${lastId.slice(0, 12) || "(start)"}'...`
      );
      const batchEndId = await getLastIdInBatch(
        localConfig,
        table,
        lastId,
        BATCH_SIZE
      );

      // No more rows to process
      if (!batchEndId) {
        console.log(
          `    ✅ No more rows after id='${lastId.slice(0, 12) || "(start)"}'`
        );
        if (batch === 0 && !resumeFromId) {
          console.log("    No rows found in table");
        }
        break;
      }

      batch++;
      const progress = `[${batch}/${estimatedBatchCount}]`;
      console.log(
        `    ${progress} Processing batch (id > '${lastId.slice(0, 8) || "(start)"}...' to '${batchEndId.slice(0, 8)}...')...`
      );

      const batchStartTime = Date.now();
      try {
        await syncTableBatch({
          table,
          localConfig,
          prodConfig,
          localEnv,
          prodEnv,
          lastId,
          limit: BATCH_SIZE,
          timeoutMs: BATCH_TIMEOUT_MS,
        });
        const batchDuration = ((Date.now() - batchStartTime) / 1000).toFixed(1);
        console.log(`      ⏱️  Batch took ${batchDuration}s`);
      } catch (err) {
        const batchDuration = ((Date.now() - batchStartTime) / 1000).toFixed(1);
        console.error(`      ❌ Batch failed after ${batchDuration}s`);
        throw err;
      }

      // Verify insertion by checking row count in prod
      const prodCountAfter = await getTableRowCounts(prodConfig, [table]);
      const actualCount = prodCountAfter[0]?.rowCount || 0;
      console.log(
        `      📊 Verified: ${actualCount.toLocaleString()} rows now in prod`
      );

      lastId = batchEndId;

      // Delay between batches to ensure clean separation on PlanetScale
      // This prevents potential rate limiting or statement counting issues
      if (BATCH_DELAY_MS > 0) {
        await sleep(BATCH_DELAY_MS);
      }
    }
  } else {
    // Single dump for smaller tables
    await syncTableFull({ table, localConfig, prodConfig, localEnv, prodEnv });
  }
}

/**
 * Sync a batch of rows from a table using COPY with keyset pagination
 * Uses WHERE id > lastId for O(1) batch access instead of OFFSET which is O(n)
 */
function syncTableBatch(options: TableSyncOptions): Promise<void> {
  const {
    table,
    localConfig,
    prodConfig,
    localEnv,
    prodEnv,
    lastId = "",
    limit = BATCH_SIZE,
    timeoutMs = BATCH_TIMEOUT_MS,
  } = options;

  // Keyset pagination: O(1) index seek instead of O(n) OFFSET scan
  const whereClause = lastId ? `WHERE id > '${lastId}'` : "";
  const copyQuery = `\\copy (SELECT * FROM ${table} ${whereClause} ORDER BY id LIMIT ${limit}) TO STDOUT`;

  // Debug: show the actual queries
  console.log(
    `      Export query: SELECT * FROM ${table} ${whereClause} ORDER BY id LIMIT ${limit}`
  );

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    // Export from local
    const psqlExport = spawn(
      "psql",
      [...buildPgArgs(localConfig), "-c", copyQuery],
      {
        stdio: ["inherit", "pipe", "pipe"],
        env: localEnv,
      }
    );

    // Import to prod
    const copyImportQuery = `\\copy ${table} FROM STDIN`;
    const psqlImport = spawn(
      "psql",
      [...buildPgArgs(prodConfig), "-c", copyImportQuery],
      {
        stdio: ["pipe", "inherit", "pipe"],
        env: prodEnv,
      }
    );

    let exportStderr = "";
    let importStderr = "";
    let bytesTransferred = 0;
    let lastProgressLog = Date.now();

    // Helper to kill all processes
    const killAll = () => {
      psqlExport.kill("SIGKILL");
      psqlImport.kill("SIGKILL");
    };

    // Set up timeout that kills processes
    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          const mb = (bytesTransferred / 1024 / 1024).toFixed(2);
          console.error(
            `      ⏰ Timeout after ${timeoutMs / 1000}s (${mb} MB transferred) - killing processes`
          );
          killAll();
          reject(
            new Error(
              `Timeout after ${timeoutMs / 1000}s: batch for ${table} (transferred ${mb} MB)`
            )
          );
        }
      }, timeoutMs);
    }

    psqlExport.stderr?.on("data", (data) => {
      exportStderr += data.toString();
    });

    psqlImport.stderr?.on("data", (data) => {
      importStderr += data.toString();
      // Check for rate limiting or error messages
      const msg = data.toString();
      if (
        msg.includes("rate") ||
        msg.includes("limit") ||
        msg.includes("error") ||
        msg.includes("ERROR")
      ) {
        console.log(`      ⚠️  Import message: ${msg.trim()}`);
      }
    });

    // Track data transfer
    psqlExport.stdout?.on("data", (chunk: Buffer) => {
      bytesTransferred += chunk.length;
      // Log progress every 10 seconds
      const now = Date.now();
      if (now - lastProgressLog > 10_000) {
        const mb = (bytesTransferred / 1024 / 1024).toFixed(1);
        console.log(`      📡 Transferred ${mb} MB so far...`);
        lastProgressLog = now;
      }
    });

    // Pipe directly without pv - pv can buffer data and delay commits
    // We have our own progress logging via bytesTransferred
    psqlExport.stdout?.on("error", (error) => {
      // This catches errors on the stdout of psqlExport, often an EPIPE error
      // when the receiving end (psqlImport.stdin) closes prematurely due to timeout or other issues.
      // We log it but do not reject the promise here, as the main error handling
      // will be done by psqlImport.on('close') or the timeout.
      if (error && (error as NodeJS.ErrnoException).code === "EPIPE") {
        console.error(`      Export pipe broken (EPIPE): ${error.message}`);
      } else if (!settled) {
        console.error(`      Export stdout error: ${error.message}`);
      }
    });

    (psqlExport.stdout as NodeJS.ReadableStream).pipe(
      psqlImport.stdin as NodeJS.WritableStream
    );

    psqlExport.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      psqlImport.kill();
      reject(new Error(`Export failed: ${error.message}`));
    });

    psqlImport.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      psqlExport.kill();
      reject(new Error(`Import failed: ${error.message}`));
    });

    psqlImport.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }

      const mb = (bytesTransferred / 1024 / 1024).toFixed(2);
      if (code === 0) {
        // Log any warnings from stderr even on success
        if (importStderr?.trim()) {
          console.log(`      Import stderr: ${importStderr.trim()}`);
        }
        console.log(`      ✓ Batch complete (${mb} MB transferred)`);
        resolve();
      } else {
        console.error(`      ❌ Import failed (${mb} MB transferred)`);
        reject(new Error(`Import exited with code ${code}: ${importStderr}`));
      }
    });

    psqlExport.on("close", (code) => {
      if (code !== 0 && !settled) {
        settled = true;
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
        }
        psqlImport.kill();
        reject(new Error(`Export exited with code ${code}: ${exportStderr}`));
      } else if (exportStderr?.trim()) {
        // Log any warnings from export stderr
        console.log(`      Export stderr: ${exportStderr.trim()}`);
      }
    });
  });
}

/**
 * Sync entire table using pg_dump COPY format
 */
function syncTableFull(options: TableSyncOptions): Promise<void> {
  const { table, localConfig, prodConfig, localEnv, prodEnv } = options;

  const pgDumpArgs = [
    ...buildPgArgs(localConfig),
    "--data-only",
    "--no-owner",
    "--no-privileges",
    `--table=${table}`,
  ];

  const psqlArgs = [...buildPgArgs(prodConfig), "-q"];

  return new Promise((resolve, reject) => {
    const pgDump = spawn("pg_dump", pgDumpArgs, {
      stdio: ["inherit", "pipe", "pipe"],
      env: localEnv,
    });

    const psql = spawn("psql", psqlArgs, {
      stdio: ["pipe", "inherit", "pipe"],
      env: prodEnv,
    });

    let pgDumpStderr = "";
    let psqlStderr = "";

    pgDump.stderr?.on("data", (data) => {
      pgDumpStderr += data.toString();
    });

    psql.stderr?.on("data", (data) => {
      psqlStderr += data.toString();
    });

    // Use progress pipe if pv is available
    const pvProc = createProgressPipe(
      pgDump.stdout as NodeJS.ReadableStream,
      psql.stdin as NodeJS.WritableStream,
      table.split(".")[1] || table
    );

    pgDump.on("error", (error) => {
      psql.kill();
      pvProc?.kill();
      reject(new Error(`pg_dump failed: ${error.message}`));
    });

    psql.on("error", (error) => {
      pgDump.kill();
      pvProc?.kill();
      reject(new Error(`psql failed: ${error.message}`));
    });

    psql.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`psql exited with code ${code}: ${psqlStderr}`));
      }
    });

    pgDump.on("close", (code) => {
      if (code !== 0) {
        psql.kill();
        pvProc?.kill();
        reject(new Error(`pg_dump exited with code ${code}: ${pgDumpStderr}`));
      }
    });
  });
}

async function syncTables(
  tables: string[],
  localConfig: DatabaseConfig,
  prodConfig: DatabaseConfig,
  resume = false
): Promise<void> {
  // Validate all table names against allowlist to prevent SQL injection
  for (const table of tables) {
    validateTableName(table);
  }

  // Derive a short prefix for logging (helps distinguish parallel output)
  // e.g., "rag.leg_embeddings" -> "[leg]", "rag.parl_resources" -> "[parl]"
  const firstTable = tables[0] || "";
  const isLegTables = firstTable.includes("leg_");
  const isParlTables = firstTable.includes("parl_");
  const logPrefix = isLegTables ? "[leg] " : isParlTables ? "[parl] " : "";

  // Determine table group for index management
  const tableGroup: "rag_leg" | "rag_parl" | null = isLegTables
    ? "rag_leg"
    : isParlTables
      ? "rag_parl"
      : null;

  const tableList = tables.join(", ");
  console.log(
    `\n${logPrefix}Syncing tables: ${tableList}${resume ? " (RESUME MODE)" : ""}...`
  );

  const prodEnv = buildPgEnv(prodConfig);

  // Step 1: Get row counts for batching decisions
  console.log(`${logPrefix}  Checking table sizes...`);
  const rowCounts = await getTableRowCounts(localConfig, tables);
  for (const { tableName, rowCount } of rowCounts) {
    console.log(
      `${logPrefix}    ${tableName}: ${rowCount.toLocaleString()} rows`
    );
  }

  // Step 2: Drop indexes for faster bulk loading
  // This speeds up inserts from O(n) per batch to O(1) by avoiding index updates
  const indexes = tableGroup ? getIndexesForTableGroup(tableGroup) : [];
  if (indexes.length > 0) {
    console.log(
      `${logPrefix}  Dropping ${indexes.length} indexes for faster bulk loading...`
    );
    await dropIndexes(prodConfig, indexes);
  }

  // Step 3: Get resume points (if resuming) or truncate (if not)
  const resumePoints: Map<string, string> = new Map();
  if (resume) {
    console.log(`${logPrefix}  Checking resume points in production...`);
    for (const table of tables) {
      const maxId = await getMaxIdInTable(prodConfig, table);
      if (maxId) {
        resumePoints.set(table, maxId);
        const prodCount = await getTableRowCounts(prodConfig, [table]);
        const count = prodCount[0]?.rowCount || 0;
        console.log(
          `${logPrefix}    ${table}: ${count.toLocaleString()} rows already synced, resuming from '${maxId.slice(0, 8)}...'`
        );
      } else {
        console.log(`${logPrefix}    ${table}: empty, starting from beginning`);
      }
    }
  } else {
    console.log(`${logPrefix}  Truncating existing tables in production...`);
    const truncateSql = tables
      .map((t) => `TRUNCATE TABLE ${t} CASCADE;`)
      .join(" ");
    const psqlTruncateArgs = [...buildPgArgs(prodConfig), "-c", truncateSql];
    await runCommand("psql", psqlTruncateArgs, prodEnv);
  }

  // Step 4: Sync each table (resources before embeddings for FK order)
  const sortedTables = [...tables].sort((a, b) => {
    if (a.includes("resources") && b.includes("embeddings")) {
      return -1;
    }
    if (a.includes("embeddings") && b.includes("resources")) {
      return 1;
    }
    return 0;
  });

  for (const table of sortedTables) {
    const rowCount =
      rowCounts.find((r) => r.tableName === table)?.rowCount || 0;
    const resumeFromId = resumePoints.get(table) || "";
    await syncSingleTable({
      table,
      localConfig,
      prodConfig,
      rowCount,
      resumeFromId,
    });
  }

  // Step 5: Recreate indexes after bulk loading
  // HNSW indexes can take several minutes for large tables (~800k vectors)
  if (indexes.length > 0) {
    console.log(
      `${logPrefix}  Recreating ${indexes.length} indexes (this may take several minutes for HNSW)...`
    );
    await createIndexes(prodConfig, indexes);
  }

  console.log(`${logPrefix}  ✓ Tables synced successfully`);
}

/**
 * Sync multiple table groups in parallel when they're independent
 */
async function syncTablesParallel(
  tableGroups: string[][],
  localConfig: DatabaseConfig,
  prodConfig: DatabaseConfig,
  resume = false
): Promise<void> {
  console.log(`\n🚀 Running ${tableGroups.length} table syncs in parallel...`);

  const promises = tableGroups.map((tables) =>
    syncTables(tables, localConfig, prodConfig, resume)
  );

  await Promise.all(promises);
}

async function performSync(
  options: SyncOption[],
  localConfig: DatabaseConfig,
  prodConfig: DatabaseConfig,
  resume = false
): Promise<void> {
  // Group options for parallel execution
  const schemaOptions: SyncOption[] = [];
  const ragLegOption = options.includes("rag_leg");
  const ragParlOption = options.includes("rag_parl");

  for (const option of options) {
    if (option === "parliament" || option === "legislation") {
      schemaOptions.push(option);
    }
  }

  // Sync schemas first (can be parallelized)
  // Note: Schema sync doesn't support resume (uses pg_dump which replaces entirely)
  if (schemaOptions.length > 0) {
    if (resume) {
      console.log(
        "\n⚠️  Resume mode not supported for schema sync - will do full sync"
      );
    }
    if (schemaOptions.length > 1) {
      console.log("\n🚀 Syncing schemas in parallel...");
      await Promise.all(
        schemaOptions.map((opt) => syncSchema(opt, localConfig, prodConfig))
      );
    } else {
      await syncSchema(schemaOptions[0], localConfig, prodConfig);
    }
  }

  // Sync RAG tables (can be parallelized between leg and parl)
  const ragTableGroups: string[][] = [];
  if (ragLegOption) {
    ragTableGroups.push(["rag.leg_resources", "rag.leg_embeddings"]);
  }
  if (ragParlOption) {
    ragTableGroups.push(["rag.parl_resources", "rag.parl_embeddings"]);
  }

  if (ragTableGroups.length > 0) {
    if (ragTableGroups.length > 1) {
      // Parallel sync of leg and parl RAG tables
      await syncTablesParallel(ragTableGroups, localConfig, prodConfig, resume);
    } else {
      // Single group
      await syncTables(ragTableGroups[0], localConfig, prodConfig, resume);
    }
  }
}

async function main() {
  const rl = createReadlineInterface();

  // Parse CLI flags
  const args = process.argv.slice(2);
  const resumeMode = args.includes("--resume");
  const rebuildIndexesMode = args.includes("--rebuild-indexes");

  try {
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

    console.log(`✓ Local: ${localConfig.host}/${localConfig.database}`);
    console.log(`✓ Production: ${prodConfig.host}/${prodConfig.database}`);

    // Handle --rebuild-indexes mode (standalone operation - no sync)
    if (rebuildIndexesMode) {
      console.log("\n🔧 REBUILD INDEXES MODE");
      console.log(
        "This will ONLY recreate indexes on production. No data will be synced.\n"
      );
      console.log(
        "Use this to restore indexes after a sync was interrupted.\n"
      );

      console.log("Select table group to rebuild indexes for:\n");
      console.log("  1. RAG leg_* tables (leg_resources, leg_embeddings)");
      console.log("  2. RAG parl_* tables (parl_resources, parl_embeddings)\n");
      console.log(
        "Note: Parliament/Legislation schema syncs include indexes automatically.\n"
      );

      const answer = await prompt(rl, "Your selection (1 or 2): ");
      const selection = Number.parseInt(answer.trim(), 10);

      if (selection !== 1 && selection !== 2) {
        console.log("\n❌ Invalid selection. Please enter 1 or 2.");
        return;
      }

      const tableGroup = selection === 1 ? "rag_leg" : "rag_parl";
      const indexes = getIndexesForTableGroup(tableGroup);

      console.log(
        `\nWill create ${indexes.length} indexes on production for ${tableGroup}:`
      );
      for (const idx of indexes) {
        console.log(`  • ${idx.name}`);
      }

      const confirmAnswer = await prompt(rl, '\nType "yes" to proceed: ');
      if (confirmAnswer.toLowerCase() !== "yes") {
        console.log("\n❌ Cancelled.");
        return;
      }

      console.log("\n📊 Creating indexes on production...\n");
      const startTime = Date.now();
      await createIndexes(prodConfig, indexes);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n✅ Index rebuild complete in ${elapsed}s`);
      console.log(
        "No data was synced. Use without --rebuild-indexes to sync data.\n"
      );
      return;
    }

    // Show resume mode status
    if (resumeMode) {
      console.log("✓ Resume mode: ON (will continue from where it left off)");
    }

    // Check for pv
    if (isPvInstalled()) {
      console.log("✓ Progress indicator (pv) available");
    } else {
      console.log(
        "ℹ Progress indicator (pv) not installed - using basic output"
      );
      console.log("  Install with: brew install pv");
    }

    // Query sizes from local database
    console.log("Querying local database sizes...");
    const sizes = await getSyncOptionSizes(localConfig);

    // Select options
    const selectedOptions = await selectSyncOptions(rl, sizes);

    // Confirm
    const confirmed = await confirmSync(
      rl,
      selectedOptions,
      prodConfig,
      resumeMode
    );
    if (!confirmed) {
      console.log("\nSync cancelled.");
      return;
    }

    // Perform sync
    const startTime = Date.now();
    console.log(`\n=== Starting sync${resumeMode ? " (RESUME MODE)" : ""} ===`);

    await performSync(selectedOptions, localConfig, prodConfig, resumeMode);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✓ Sync completed successfully in ${elapsed}s`);
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
