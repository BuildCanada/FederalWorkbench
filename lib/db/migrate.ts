import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const isProd = process.argv.includes("--prod");
const envFile = isProd ? ".env.production.local" : ".env.local";

config({
  path: envFile,
});

const runMigrate = async () => {
  if (!process.env.POSTGRES_URL) {
    throw new Error(`POSTGRES_URL is not defined in ${envFile}`);
  }

  const connection = postgres(process.env.POSTGRES_URL, { max: 1 });
  const db = drizzle(connection);

  const target = isProd ? "PRODUCTION" : "local";
  console.log(`⏳ Running migrations on ${target} database...`);

  const start = Date.now();
  await migrate(db, { migrationsFolder: "./lib/db/migrations" });
  const end = Date.now();

  console.log("✅ Migrations completed in", end - start, "ms");
  process.exit(0);
};

runMigrate().catch((err) => {
  console.error("❌ Migration failed");
  console.error(err);
  process.exit(1);
});
