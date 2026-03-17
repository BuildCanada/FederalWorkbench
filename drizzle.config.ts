import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({
  path: ".env.local",
});

export default defineConfig({
  schema: [
    "./lib/db/schema.ts",
    "./lib/db/rag/schema.ts",
    "./lib/db/legislation/schema.ts",
    "./lib/db/parliament/schema.ts",
  ],
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // biome-ignore lint: Forbidden non-null assertion.
    url: process.env.POSTGRES_URL!,
  },
});
