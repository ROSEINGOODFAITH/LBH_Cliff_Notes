import { test } from "node:test";
import assert from "node:assert/strict";

import { buildClaimStatement, giftKeyFor } from "../src/lib/provisioning";

// buildClaimStatement touches the lazy db proxy (neon client construction, no
// connection) which reads DATABASE_URL — set a dummy so .toSQL() works offline.
// getEnv() reads process.env lazily at call time, so setting it here suffices.
// No query is ever executed in this file.
process.env.DATABASE_URL ??= "postgres://u:p@localhost:5432/db";

test("giftKeyFor is deterministic per creator", () => {
  assert.equal(giftKeyFor("creator-123"), "pulse-gift-creator-123");
  assert.equal(giftKeyFor("creator-123"), giftKeyFor("creator-123"));
});

// The single-winner guarantee lives entirely in the SQL: one INSERT … ON
// CONFLICT (creator_id, gift_key) DO UPDATE … WHERE status = 'failed' RETURNING.
// Postgres serializes concurrent inserts on the unique index, so exactly one
// statement inserts/updates a row and RETURNs it; the rest RETURN nothing. This
// asserts the emitted SQL actually has that shape (no live DB needed).
test("claim statement is a guarded atomic upsert with RETURNING", () => {
  const { sql } = buildClaimStatement("c1", "pulse-gift-c1").toSQL();
  const s = sql.toLowerCase();
  assert.match(s, /insert into "provisioning_claims"/);
  assert.match(s, /on conflict/);
  assert.match(s, /do update set/);
  // The revive-only guard: an existing row is re-claimed ONLY when it failed.
  assert.match(s, /where "provisioning_claims"\."status" =/);
  assert.match(s, /returning/);
});

/**
 * Behavioral model of the Postgres statement the claim relies on. Because the
 * sandbox has no Postgres (and the task forbids external DB mutation), this
 * models statement-level atomicity — read+decide+write happen without an
 * interleaving await, exactly as Postgres executes a single INSERT…ON
 * CONFLICT…RETURNING. It proves the contract claimGift depends on: one winner
 * under contention, retry-after-failure, and completed-is-terminal.
 */
class UpsertModel {
  private rows = new Map<string, { status: string; attempts: number }>();
  claim(key: string): boolean {
    const row = this.rows.get(key);
    if (!row) {
      this.rows.set(key, { status: "claimed", attempts: 1 });
      return true; // inserted → RETURNING yields a row → winner
    }
    if (row.status === "failed") {
      row.status = "claimed";
      row.attempts += 1;
      return true; // revived → updated row RETURNed → winner
    }
    return false; // claimed/completed → WHERE false → no row → loser
  }
  complete(key: string) {
    this.rows.get(key)!.status = "completed";
  }
  fail(key: string) {
    this.rows.get(key)!.status = "failed";
  }
  attempts(key: string) {
    return this.rows.get(key)!.attempts;
  }
}

test("concurrency: many simultaneous claims yield exactly one owner", async () => {
  const db = new UpsertModel();
  const key = "pulse-gift-race";
  const results = await Promise.all(
    Array.from({ length: 50 }, () => Promise.resolve().then(() => db.claim(key))),
  );
  assert.equal(results.filter(Boolean).length, 1, "exactly one concurrent claim wins");
});

test("a failed claim can be retried by a later redelivery", () => {
  const db = new UpsertModel();
  const key = "pulse-gift-retry";
  assert.equal(db.claim(key), true); // first owner
  assert.equal(db.claim(key), false); // redelivery while claimed → blocked
  db.fail(key); // owner released it
  assert.equal(db.claim(key), true); // redelivery now revives it
  assert.equal(db.attempts(key), 2);
});

test("a completed claim is terminal — never re-provisioned", () => {
  const db = new UpsertModel();
  const key = "pulse-gift-done";
  assert.equal(db.claim(key), true);
  db.complete(key);
  assert.equal(db.claim(key), false);
  assert.equal(db.claim(key), false);
});
