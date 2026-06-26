import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

/**
 * Neon serverless (HTTP) driver — works in Vercel serverless + edge-adjacent
 * route handlers and Inngest jobs. For long-running/transactional jobs later we
 * can swap to `drizzle-orm/neon-serverless` (Pool) without touching call sites.
 */
const sql = neon(getEnv().DATABASE_URL);

export const db = drizzle(sql, { schema });
export type DB = typeof db;

export { schema };
export * from "./schema";
