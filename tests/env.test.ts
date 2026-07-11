import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Guards the lazy-env contract that keeps `next build` working without secrets:
 * importing the module must NOT validate, and getEnv() must validate only when
 * called. (The DB client relies on this: it constructs lazily on first query.)
 */
test("env module imports without throwing even when required vars are absent", async () => {
  const before = { ...process.env };
  delete process.env.DATABASE_URL;
  delete process.env.CLERK_SECRET_KEY;
  try {
    const mod = await import("../src/lib/env");
    assert.equal(typeof mod.getEnv, "function");
    assert.equal(typeof mod.integrations.shopify, "function");
  } finally {
    Object.assign(process.env, before);
  }
});

test("getEnv throws a clear error listing the missing required vars", async () => {
  const before = { ...process.env };
  delete process.env.DATABASE_URL;
  delete process.env.CLERK_SECRET_KEY;
  try {
    const { getEnv } = await import("../src/lib/env");
    assert.throws(() => getEnv(), (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      assert.match(msg, /Invalid environment configuration/);
      assert.match(msg, /DATABASE_URL/);
      assert.match(msg, /CLERK_SECRET_KEY/);
      return true;
    });
  } finally {
    Object.assign(process.env, before);
  }
});
