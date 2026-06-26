# LBH Cliff Notes — Build Status

Single-brand, internal influencer marketing CRM for Laurel Bath House. Single-tenant,
official/licensed data only, secrets server-side, phased delivery.

---

## P0 — Foundation ✅ code complete (awaiting account provisioning to run live)

### Built
- **Next.js (App Router, TypeScript)** + Tailwind + shadcn-style UI primitives. Dark mode default.
- **Single-tenant `brand.config.ts`** — brand identity, competitors, niches, team allowlist,
  sending domain, brand-voice brief. No tenant tables, no per-org scoping.
- **Full Drizzle schema** for every §4 table — `creators`, `creator_socials`, `campaigns`,
  `campaign_creators`, `outreach_threads`, `messages`, `affiliates`, `orders_attributed`,
  `content_mentions`, `events` — with enums, relations, indexes and idempotency uniques
  (`shopify_order_id`, `post_url`, `gmail_message_id`, `discount_code`).
- **Initial migration** generated → `drizzle/0000_init.sql` (+ meta). Verified to compile.
- **Minimal single-team auth (Clerk)** — `middleware.ts` protects everything except public
  routes; `lib/auth.ts` enforces the `brand.config` team-email allowlist; `/sign-in` and
  `/not-authorized` pages. No public signup.
- **Shopify Admin client** (`lib/shopify.ts`) with retry + exponential backoff + 429
  `Retry-After` handling. `/api/shopify/ping` reads a **real order** (P0 checkpoint).
- **Server-only env validation** (`lib/env.ts`, zod) + complete **`.env.example`**.
  Optional integrations degrade to empty states — never fake values.
- **`/api/health`** — DB connectivity + integration-config status.
- **Dashboard shell** — data-source status, funnel scaffold (em-dash empty states, no
  placeholder numbers), build roadmap.

### Skipped (by design — later phases)
- Modash / Anthropic / Gmail / Inngest wiring → P1–P2.
- Affiliate engine + attribution → P3. Content tracking + analytics → P4. TikTok Shop → P5.

### Next (P1 — Creator DB, Module A)
- Modash enrichment client with caching + the "no re-enrich within 30 days" rule.
- Creator search/filter UI; manual add + CSV import.
- Competitor-mention discovery review queue.

### Blocking on you (to make P0 run live)
Provide these and I'll wire + verify end-to-end (see README → Setup):
1. **Neon** `DATABASE_URL`
2. **Clerk** publishable + secret keys
3. **Shopify** Admin API token + exact `*.myshopify.com` domain

Modash, Anthropic and Gmail keys aren't needed until P1/P2.

### Manual test (P0)
With env set: `npm install` → `npm run db:migrate` → `npm run dev`. Sign in with a
`teamEmails` address → dashboard loads. Click **Shopify → Test connection** (or hit
`/api/shopify/ping`) → returns a real recent order. `/api/health` returns
`{ ok: true, database: "connected" }`.

---

## P1 — Creator DB + Discovery (Module A) ✅ code complete

### Built
- **Modash client** (`lib/modash.ts`) — verified against current docs: `POST /{platform}/search`,
  `GET /{platform}/profile/{userId}/report` (enrichment), `POST /collaborations/posts`
  (creators linked to a brand), dictionary endpoints. Retry/backoff, dictionary caching, and a
  graceful not-configured error.
- **`discovery_candidates`** table + migration `0001` (deduped review queue).
- **Creator database UI** (`/creators`) — dense table with server-side filters (search,
  platform, status, niche, min followers, min ER) backed by real queries (`lib/creators.ts`).
- **On-demand enrichment** — Modash report → creator fields (followers, ER, email, avatar,
  niches, audience geo/age) with the **30-day re-enrich guard** (`modashLastEnrichedAt`).
- **Manual add + CSV import** + **first-party Shopify seed** (import customers by tag).
- **Competitor discovery** (`/discovery`) — runs Modash collaborations per competitor brand,
  dedupes vs creators + existing candidates, presents an approve/dismiss queue. Approve → saves
  to `creators` as `competitor_mention`. Never auto-promoted.
- **Empty/disabled states wherever Modash is unset** — no fabricated data.

### Verified
- Schema → migration generated cleanly (11 tables, 12 enums). All 31 source files parse. Core
  data/logic layer (`modash`, `creators`, `csv`, `env`, `shopify`, `db`, `schema`) type-checks
  clean against real drizzle-orm / zod / neon types.

### Needs Modash to run live
Discovery + enrichment light up the moment `MODASH_API_KEY` is set; until then they show
disabled states. Manual add / CSV / Shopify seed work without Modash.

### Next (P2 — AI Outreach, Module B)
Brand-voice draft generation (Claude) → Gmail send → reply sync (Inngest) → reply
classification → priority inbox.

### Manual test (P1)
On `/creators`: add a creator, import a CSV, filter the table — results update from the DB.
With `MODASH_API_KEY` set: click **Enrich** on a creator (pulls a live Modash report); on
`/discovery`, **Run discovery** against the competitor defaults, then **Approve** a candidate
and confirm it appears on `/creators`.
