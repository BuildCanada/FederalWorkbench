/**
 * Sync local database data to production
 * Usage: npx tsx scripts/sync-to-prod.ts
 *
 * This script syncs data from local PostgreSQL to production.
 * It reads from .env.local (local) and .env.production.local (prod).
 *
 * Options:
 *   1. Parliament schema - All parliament.* tables
 *   2. Legislation schema - All legislation.* tables
 *   3. RAG leg_* tables - rag.leg_embeddings, rag.leg_resources
 *   4. RAG parl_* tables - rag.parl_embeddings, rag.parl_resources
 *
 * WARNING: This will REPLACE data in production. Use with caution.
 */

import { spawn } from "node:child_process";
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
};

type SyncOption = "parliament" | "legislation" | "rag_leg" | "rag_parl";

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
  return {
    host: parsed.hostname,
    port: parsed.port || "5432",
    user: parsed.username,
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.slice(1),
  };
}

function buildConnectionString(config: DatabaseConfig): string {
  return `postgres://${config.user}:${encodeURIComponent(config.password)}@${config.host}:${config.port}/${config.database}`;
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
    throw new Error("No valid options selected");
  }

  return indices.map((i) => options[i][0]);
}

async function confirmSync(
  rl: ReturnType<typeof createInterface>,
  selectedOptions: SyncOption[],
  prodConfig: DatabaseConfig
): Promise<boolean> {
  console.log("\n⚠️  WARNING: This will REPLACE data in production!\n");
  console.log(`Production database: ${prodConfig.host}/${prodConfig.database}`);
  console.log("\nSelected for sync:");
  for (const opt of selectedOptions) {
    console.log(`  - ${SYNC_OPTIONS[opt].label}`);
  }

  const answer = await prompt(rl, '\nType "yes" to confirm: ');
  return answer.toLowerCase() === "yes";
}

function buildPgDumpArgs(config: DatabaseConfig): string[] {
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

function buildPsqlArgs(config: DatabaseConfig): string[] {
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

function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  input?: NodeJS.ReadableStream
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: input
        ? ["pipe", "inherit", "pipe"]
        : ["inherit", "inherit", "pipe"],
      env,
    });

    let stderr = "";
    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    if (input && proc.stdin) {
      input.pipe(proc.stdin);
    }

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

async function syncSchema(
  schema: string,
  localConfig: DatabaseConfig,
  prodConfig: DatabaseConfig
): Promise<void> {
  console.log(`\nSyncing schema: ${schema}...`);

  const localEnv = { ...process.env, PGPASSWORD: localConfig.password };
  const prodEnv = { ...process.env, PGPASSWORD: prodConfig.password };

  // Step 1: Drop existing schema in prod
  console.log(`  Dropping existing ${schema} schema in production...`);
  const dropSql = `DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema};`;
  const psqlDropArgs = [...buildPsqlArgs(prodConfig), "-c", dropSql];
  await runCommand("psql", psqlDropArgs, prodEnv);

  // Step 2: Dump from local and pipe to prod
  console.log(`  Dumping ${schema} from local and loading to production...`);

  const pgDumpArgs = [
    ...buildPgDumpArgs(localConfig),
    `--schema=${schema}`,
    "--no-owner",
    "--no-privileges",
    "--no-comments",
  ];

  const psqlArgs = [...buildPsqlArgs(prodConfig), "-q"];

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

    if (pgDump.stdout && psql.stdin) {
      pgDump.stdout.pipe(psql.stdin);
    }

    pgDump.on("error", (error) => {
      psql.kill();
      reject(new Error(`pg_dump failed: ${error.message}`));
    });

    psql.on("error", (error) => {
      pgDump.kill();
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
        reject(new Error(`pg_dump exited with code ${code}: ${pgDumpStderr}`));
      }
    });
  });
}

async function syncTables(
  tables: string[],
  localConfig: DatabaseConfig,
  prodConfig: DatabaseConfig
): Promise<void> {
  const tableList = tables.join(", ");
  console.log(`\nSyncing tables: ${tableList}...`);

  const localEnv = { ...process.env, PGPASSWORD: localConfig.password };
  const prodEnv = { ...process.env, PGPASSWORD: prodConfig.password };

  // Step 1: Truncate existing tables in prod
  console.log("  Truncating existing tables in production...");
  const truncateSql = tables
    .map((t) => `TRUNCATE TABLE ${t} CASCADE;`)
    .join(" ");
  const psqlTruncateArgs = [...buildPsqlArgs(prodConfig), "-c", truncateSql];
  await runCommand("psql", psqlTruncateArgs, prodEnv);

  // Step 2: Dump from local and pipe to prod
  console.log("  Dumping tables from local and loading to production...");
  console.log("  ⚠️  This may take a while for large tables...");

  const pgDumpArgs = [
    ...buildPgDumpArgs(localConfig),
    "--data-only",
    "--inserts", // Use INSERT instead of COPY to handle special characters in content
    "--no-owner",
    "--no-privileges",
    ...tables.flatMap((t) => [`--table=${t}`]),
  ];

  const psqlArgs = [...buildPsqlArgs(prodConfig), "-q"];

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

    if (pgDump.stdout && psql.stdin) {
      pgDump.stdout.pipe(psql.stdin);
    }

    pgDump.on("error", (error) => {
      psql.kill();
      reject(new Error(`pg_dump failed: ${error.message}`));
    });

    psql.on("error", (error) => {
      pgDump.kill();
      reject(new Error(`psql failed: ${error.message}`));
    });

    psql.on("close", (code) => {
      if (code === 0) {
        console.log("  ✓ Tables synced successfully");
        resolve();
      } else {
        reject(new Error(`psql exited with code ${code}: ${psqlStderr}`));
      }
    });

    pgDump.on("close", (code) => {
      if (code !== 0) {
        psql.kill();
        reject(new Error(`pg_dump exited with code ${code}: ${pgDumpStderr}`));
      }
    });
  });
}

async function performSync(
  option: SyncOption,
  localConfig: DatabaseConfig,
  prodConfig: DatabaseConfig
): Promise<void> {
  switch (option) {
    case "parliament":
      await syncSchema("parliament", localConfig, prodConfig);
      break;
    case "legislation":
      await syncSchema("legislation", localConfig, prodConfig);
      break;
    case "rag_leg":
      await syncTables(
        ["rag.leg_embeddings", "rag.leg_resources"],
        localConfig,
        prodConfig
      );
      break;
    case "rag_parl":
      await syncTables(
        ["rag.parl_embeddings", "rag.parl_resources"],
        localConfig,
        prodConfig
      );
      break;
    default: {
      const _exhaustive: never = option;
      throw new Error(`Unknown sync option: ${_exhaustive}`);
    }
  }
}

async function main() {
  const rl = createReadlineInterface();

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

    // Query sizes from local database
    console.log("Querying local database sizes...");
    const sizes = await getSyncOptionSizes(localConfig);

    // Select options
    const selectedOptions = await selectSyncOptions(rl, sizes);

    // Confirm
    const confirmed = await confirmSync(rl, selectedOptions, prodConfig);
    if (!confirmed) {
      console.log("\nSync cancelled.");
      return;
    }

    // Perform sync
    const startTime = Date.now();
    console.log("\n=== Starting sync ===");

    for (const option of selectedOptions) {
      await performSync(option, localConfig, prodConfig);
    }

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
