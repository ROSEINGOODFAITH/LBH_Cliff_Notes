import { defineConfig } from "drizzle-kit";

// drizzle-kit auto-loads `.env` / `.env.local`. For migrations against Neon you
// can use either the pooled or the direct (non-pooled) connection string.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
