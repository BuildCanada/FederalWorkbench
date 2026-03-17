/**
 * Loads Open Parliament SQL dump into a separate schema
 * Usage: tsx scripts/load-parliament-data.ts
 *
 * This script:
 * 1. Drops the 'parliament' schema if it exists (CASCADE)
 * 2. Creates a fresh 'parliament' schema
 * 3. Loads the SQL dump into that schema (all tables)
 * 4. Drops non-parliamentary tables (Django admin, auth, etc.)
 * 5. Verifies data integrity
 *
 * Environment variables:
 *   POSTGRES_URL (required) - PostgreSQL connection string
 *
 * TABLES IN THE PARLIAMENT SCHEMA:
 * ============================================================================
 *
 * CORE PARLIAMENTARY DATA (27 tables) - These are loaded and kept:
 * ----------------------------------------------------------------------------
 * bills_bill                                    5,637 rows
 * bills_billtext                                5,256 rows
 * bills_bill_similar_bills                          0 rows (relationship table)
 * bills_membervote                          1,461,723 rows
 * bills_partyvote                              22,496 rows
 * bills_votequestion                            4,519 rows
 * committees_committee                            124 rows
 * committees_committeeactivity                  5,142 rows
 * committees_committeeactivityinsession         6,220 rows
 * committees_committeeinsession                   672 rows
 * committees_committeemeeting                  19,885 rows
 * committees_committeemeeting_activities       29,777 rows
 * committees_committeereport                    1,826 rows
 * core_electedmember                            1,861 rows
 * core_electedmember_sessions                   6,440 rows
 * core_party                                       55 rows
 * core_partyalternatename                         134 rows
 * core_politician                              14,507 rows
 * core_politicianinfo                          38,420 rows
 * core_riding                                     802 rows
 * core_session                                     20 rows
 * elections_candidacy                          21,092 rows
 * elections_election                               52 rows
 * hansards_document                            18,282 rows
 * hansards_statement                        3,647,096 rows
 * hansards_statement_bills                     95,964 rows
 * hansards_statement_mentioned_politicians    276,617 rows
 *
 * NON-PARLIAMENTARY TABLES (38 tables) - These are dropped after load:
 * ----------------------------------------------------------------------------
 * Django admin/auth tables:
 *   - auth_group, auth_group_permissions, auth_message, auth_permission
 *   - auth_user, auth_user_groups, auth_user_user_permissions
 *   - django_admin_log, django_content_type, django_flatpage
 *   - django_flatpage_sites, django_migrations, django_session, django_site
 *
 * OpenParliament app tables (not raw parliamentary data):
 *   - accounts_logintoken, accounts_user       (user authentication)
 *   - activity_activity                         (activity tracking)
 *   - alerts_seenitem, alerts_subscription, alerts_topic (alert system)
 *   - contact_contactmessage, contact_contactthread (contact forms)
 *   - search_indexingtask, indexer_index       (search indexing)
 *   - summaries_summary, summaries_summarypoll (AI-generated summaries)
 *   - text_analysis_textanalysis               (text analysis cache)
 *   - labs_haiku                                (experimental features)
 *
 * Deprecated/empty/unused tables:
 *   - core_ridingpostcodecache                 (runtime cache, 0 rows)
 *   - core_sitenews                            (site announcements, 0 rows)
 *   - hansards_oldslugmapping                  (deprecated, 0 rows)
 *   - hansards_oldsequencemapping              (URL redirects, 560K rows, not needed)
 *   - financials_contribution                  (campaign finance, 0 rows)
 *   - financials_contributor                   (campaign finance, 0 rows)
 *
 * Logging/monitoring tables:
 *   - sentry_filtervalue, sentry_groupedmessage, sentry_message
 *   - south_migrationhistory                   (old migration system)
 *
 * ============================================================================
 */

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Sql } from "postgres";
import postgres from "postgres";

const SQL_DUMP_PATH = resolve(
  process.cwd(),
  "data/parliament/openparliament.public.sql"
);

// Tables to keep (core parliamentary data)
const PARLIAMENTARY_TABLES = new Set([
  "bills_bill",
  "bills_billtext",
  "bills_bill_similar_bills",
  "bills_membervote",
  "bills_partyvote",
  "bills_votequestion",
  "committees_committee",
  "committees_committeeactivity",
  "committees_committeeactivityinsession",
  "committees_committeeinsession",
  "committees_committeemeeting",
  "committees_committeemeeting_activities",
  "committees_committeereport",
  "core_electedmember",
  "core_electedmember_sessions",
  "core_party",
  "core_partyalternatename",
  "core_politician",
  "core_politicianinfo",
  "core_riding",
  "core_session",
  "elections_candidacy",
  "elections_election",
  "hansards_document",
  "hansards_statement",
  "hansards_statement_bills",
  "hansards_statement_mentioned_politicians",
]);

function getDatabaseUrl(): string {
  const { POSTGRES_URL } = process.env;
  if (!POSTGRES_URL) {
    throw new Error(
      "POSTGRES_URL environment variable is required. Set it in .env file or environment."
    );
  }
  return POSTGRES_URL;
}

function validateSqlDumpExists(): void {
  if (!existsSync(SQL_DUMP_PATH)) {
    throw new Error(
      `SQL dump file not found: ${SQL_DUMP_PATH}\n` +
        "Please ensure the Open Parliament SQL dump is placed at data/parliament/openparliament.public.sql"
    );
  }
}

function buildPsqlArgs(): string[] {
  const POSTGRES_URL = getDatabaseUrl();
  const args: string[] = [];

  // Parse POSTGRES_URL
  try {
    const url = new URL(POSTGRES_URL);
    if (url.hostname) {
      args.push("-h", url.hostname);
    }
    if (url.port) {
      args.push("-p", url.port);
    }
    if (url.username) {
      args.push("-U", url.username);
    }
    if (url.pathname) {
      const dbName = url.pathname.slice(1); // Remove leading /
      if (dbName) {
        args.push("-d", dbName);
      }
    }
    // Set password via environment variable
    if (url.password) {
      process.env.PGPASSWORD = url.password;
    }
  } catch {
    throw new Error(`Invalid POSTGRES_URL format: ${POSTGRES_URL}`);
  }

  return args;
}

async function createParliamentSchema(sql: Sql): Promise<void> {
  console.log("Setting up parliament schema...");

  // Fix collation version mismatch if it exists
  try {
    await sql`ALTER DATABASE CURRENT REFRESH COLLATION VERSION`;
    console.log("✓ Database collation version refreshed");
  } catch {
    // Ignore if it fails - might not be needed
  }

  // Always drop existing parliament schema if it exists (CASCADE removes all objects)
  console.log("⚠️  Dropping existing parliament schema (if exists)...");
  await sql`DROP SCHEMA IF EXISTS parliament CASCADE`;
  console.log("✓ Existing parliament schema dropped");

  // Create fresh schema
  await sql`CREATE SCHEMA parliament`;
  console.log("✓ Parliament schema created");

  // Enable pgvector extension (must be in public schema)
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  console.log("✓ pgvector extension enabled");
}

// biome-ignore lint/suspicious/useAwait: Function returns Promise<void> for consistency with async API
async function loadSqlDump(sqlPath: string): Promise<void> {
  console.log(`Loading SQL dump from ${sqlPath}...`);
  console.log("⚠️  This may take several minutes for large files...");

  const psqlArgs = buildPsqlArgs();

  // Don't stop on errors like missing roles - we'll own everything as postgres user
  // psqlArgs.push("-v", "ON_ERROR_STOP=1");

  return new Promise((promiseResolve, reject) => {
    let stderr = "";
    const psql = spawn("psql", psqlArgs, {
      stdio: ["pipe", "inherit", "pipe"],
      env: process.env,
    });

    const stdin = psql.stdin;
    if (!stdin) {
      reject(new Error("psql stdin is not available"));
      return;
    }

    // Use sed to replace schema qualifiers in the SQL dump
    // 1. Replace public. with parliament. for all table references
    // 2. Update search_path setting
    const sed = spawn("sed", [
      "-e",
      "s/public\\./parliament\\./g",
      "-e",
      "s/set_config('search_path', '', false)/set_config('search_path', 'parliament, public', false)/g",
      sqlPath,
    ]);

    const fileStream = sed.stdout;

    if (!fileStream) {
      reject(new Error("sed stdout is not available"));
      return;
    }

    // Handle sed errors
    sed.on("error", (error) => {
      psql.kill();
      reject(
        new Error(`Failed to process SQL file with sed: ${error.message}`)
      );
    });

    sed.stderr?.on("data", (data) => {
      console.error("sed error:", data.toString());
    });

    // Collect stderr output
    psql.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    fileStream.on("error", (error) => {
      psql.kill();
      sed.kill();
      reject(new Error(`Failed to read SQL file: ${error.message}`));
    });

    stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") {
        sed.kill();
        reject(new Error(`Stream error: ${error.message}`));
      }
    });

    psql.on("error", (error) => {
      sed.kill();
      reject(
        new Error(
          `Failed to start psql. Make sure PostgreSQL client tools are installed: ${error.message}`
        )
      );
    });

    psql.on("close", (code) => {
      sed.kill();
      if (code === 0) {
        console.log(`✓ Successfully imported ${sqlPath}`);
        promiseResolve();
      } else {
        const errorMsg = stderr.trim() || `psql exited with code ${code}`;
        reject(new Error(errorMsg));
      }
    });

    fileStream.pipe(stdin);
  });
}

async function dropNonParliamentaryTables(sql: Sql): Promise<void> {
  console.log("Cleaning up non-parliamentary tables...");

  // Get all tables in parliament schema
  const allTables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'parliament'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;

  const tablesToDrop = allTables
    .map((t) => t.table_name)
    .filter((name) => !PARLIAMENTARY_TABLES.has(name));

  if (tablesToDrop.length === 0) {
    console.log("✓ No non-parliamentary tables to drop");
    return;
  }

  console.log(`  Dropping ${tablesToDrop.length} non-parliamentary tables...`);

  // Drop all tables in a single statement for efficiency
  const tableList = tablesToDrop.map((t) => `parliament."${t}"`).join(", ");
  await sql.unsafe(`DROP TABLE IF EXISTS ${tableList} CASCADE`);

  console.log(`✓ Dropped ${tablesToDrop.length} non-parliamentary tables`);
}

async function verifyData(sql: Sql): Promise<void> {
  console.log("Verifying data integrity...");

  // Check that key tables exist
  const tables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'parliament'
    ORDER BY table_name
  `;

  if (tables.length === 0) {
    throw new Error(
      "No tables found in parliament schema - import may have failed"
    );
  }

  console.log(`✓ Found ${tables.length} tables in parliament schema`);

  // Verify all expected parliamentary tables exist
  const tableNames = new Set(tables.map((t) => t.table_name));
  const missingTables = [...PARLIAMENTARY_TABLES].filter(
    (t) => !tableNames.has(t)
  );

  if (missingTables.length > 0) {
    throw new Error(
      `Missing required parliamentary tables: ${missingTables.join(", ")}`
    );
  }
  console.log("✓ All 27 parliamentary tables present");

  // Count records in key tables (run in parallel for speed)
  const [billCount, hansardDocs, hansardStatements, politicians, votes] =
    await Promise.all([
      sql`SELECT COUNT(*)::int as count FROM parliament.bills_bill`,
      sql`SELECT COUNT(*)::int as count FROM parliament.hansards_document`,
      sql`SELECT COUNT(*)::int as count FROM parliament.hansards_statement`,
      sql`SELECT COUNT(*)::int as count FROM parliament.core_politician`,
      sql`SELECT COUNT(*)::int as count FROM parliament.bills_membervote`,
    ]);

  console.log("  Record counts:");
  console.log(`    - Bills: ${billCount[0].count.toLocaleString()}`);
  console.log(
    `    - Hansard documents: ${hansardDocs[0].count.toLocaleString()}`
  );
  console.log(
    `    - Hansard statements: ${hansardStatements[0].count.toLocaleString()}`
  );
  console.log(`    - Politicians: ${politicians[0].count.toLocaleString()}`);
  console.log(`    - Member votes: ${votes[0].count.toLocaleString()}`);

  // Sanity check - these tables should have data
  if (billCount[0].count === 0) {
    throw new Error("bills_bill table is empty - import may have failed");
  }
  if (hansardStatements[0].count === 0) {
    throw new Error(
      "hansards_statement table is empty - import may have failed"
    );
  }

  console.log("✓ Data integrity verified");
}

async function analyzeParliamentTables(sql: Sql): Promise<void> {
  console.log("Analyzing tables for query optimization...");

  // Analyze the largest tables for better query planning
  const largeTables = [
    "hansards_statement",
    "bills_membervote",
    "hansards_statement_mentioned_politicians",
    "hansards_statement_bills",
    "core_politicianinfo",
  ];

  await Promise.all(
    largeTables.map((table) =>
      sql.unsafe(`ANALYZE parliament."${table}"`).catch(() => {
        // Ignore if table doesn't exist
      })
    )
  );

  console.log("✓ Table statistics updated");
}

async function main() {
  const startTime = Date.now();
  const POSTGRES_URL = getDatabaseUrl();

  // Validate prerequisites
  validateSqlDumpExists();

  // Create a single connection for all operations
  const sql = postgres(POSTGRES_URL, { max: 1 });

  try {
    console.log("=== Parliament Data Loader ===\n");

    // Step 1: Setup schema
    await createParliamentSchema(sql);
    console.log();

    // Step 2: Load SQL dump (uses psql subprocess)
    await loadSqlDump(SQL_DUMP_PATH);
    console.log();

    // Step 3: Clean up non-parliamentary tables
    await dropNonParliamentaryTables(sql);
    console.log();

    // Step 4: Update table statistics for query optimization
    await analyzeParliamentTables(sql);
    console.log();

    // Step 5: Verify data integrity
    await verifyData(sql);
    console.log();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✓ Parliament data loaded successfully in ${elapsed}s`);
    console.log("✓ Schema contains 27 parliamentary data tables");
  } catch (error) {
    console.error(
      "\n❌ Error:",
      error instanceof Error ? error.message : error
    );
    process.exitCode = 1;
  } finally {
    // Always close the connection
    await sql.end();
  }
}

if (process.argv[1]?.endsWith("load-parliament-data.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
