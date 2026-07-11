import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

/**
 * Neon serverless (HTTP) driver — works in Vercel serverless + edge-adjacent
 * route handlers and Inngest jobs. For long-running/transactional jobs later we
 * can swap to `drizzle-orm/neon-serverless` (Pool) without touching call sites.
 *
 * The client is created lazily on first use. Evaluating `getEnv()` at module
 * load broke `next build` (and CI) whenever DATABASE_URL wasn't present: Next
 * imports every route module during page-data collection, so a missing secret
 * threw before a single request ran. Deferring construction keeps the build
 * secret-free while call sites still `import { db }` unchanged.
 */
type DrizzleClient = ReturnType<typeof drizzle<typeof schema>>;

let _db: DrizzleClient | null = null;

function getDb(): DrizzleClient {
  if (_db) return _db;
  const sql = neon(getEnv().DATABASE_URL);
  _db = drizzle(sql, { schema });
  return _db;
}

export const db = new Proxy({} as DrizzleClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb() as object, prop, receiver);
  },
}) as DrizzleClient;

export type DB = DrizzleClient;

export { schema };
export * from "./schema";
