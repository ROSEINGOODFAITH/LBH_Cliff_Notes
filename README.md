# LBH Cliff Notes

Single-brand, internal **influencer marketing CRM** for **Laurel Bath House** — discover
creators, run AI-assisted 1:1 outreach, convert them to affiliates with per-creator Shopify
codes, track brand-mention content, and see the whole funnel (outreach → revenue) on one
dashboard. Single-tenant. Official/licensed data only. Secrets server-side.

**Stack:** Next.js (App Router, TS) · Vercel · Neon Postgres · Drizzle · Clerk · Shopify
Admin API · Anthropic · Gmail API · Inngest. Tailwind + shadcn, dark mode default.

> Build is phased (P0–P5). See `STATUS.md` for what's done and what's next. This is P0.

---

## Quick start (local)

```bash
npm install
cp .env.example .env.local      # then fill in the values below
npm run db:migrate              # apply drizzle/0000_init.sql to your Neon DB
npm run dev                     # http://localhost:3000
```

## Environment / accounts

Every secret is server-side (env vars). Nothing is committed. Fill `.env.local` from
`.env.example`.

### Required for P0
1. **Neon Postgres** — create a project at neon.tech, copy the connection string into
   `DATABASE_URL`. (Use the pooled string for the app; the direct string also works for
   migrations.)
2. **Clerk** — create an application at clerk.com (no public signup needed). Copy
   `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`. Add your team emails to
   `brand.config.ts → teamEmails`. For extra safety set Clerk → **Restrictions → Allowlist**
   so only your team can create accounts.
3. **Shopify Admin token** — in Shopify admin → Settings → Apps → *Develop apps* → create a
   custom app with `read_orders` (and later `write_price_rules`, `write_discounts` for P3).
   Put the Admin API access token in `SHOPIFY_ADMIN_TOKEN` and your `*.myshopify.com` handle
   in `SHOPIFY_STORE_DOMAIN`.

### Added in later phases
- **Modash** (`MODASH_API_KEY`) — P1 creator data. Discovery shows an empty state until set.
- **Anthropic** (`ANTHROPIC_API_KEY`) — P2 outreach generation + reply classification.
- **Gmail API** (`GMAIL_*`) — P2 send + reply sync (one Google OAuth app,
  `gmail.send` + `gmail.readonly`).
- **Inngest** (`INNGEST_*`) — P2+ background jobs.

## Deploy (Vercel)

1. Push this repo to GitHub and import it in Vercel.
2. Add every variable from `.env.example` in Vercel → Project → Settings → Environment Variables.
3. Run migrations against the production DB (`npm run db:migrate` with prod `DATABASE_URL`,
   or via a Vercel deploy hook).
4. In Clerk, add your production domain to the allowed origins.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` / `start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | Next/ESLint |
| `npm run db:generate` | Generate a new migration from `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Drizzle Studio (browse the DB) |

## Project layout

```
brand.config.ts            Single source of brand truth (EDIT-ME fields here)
drizzle/                   Generated SQL migrations
src/
  app/
    page.tsx               Dashboard shell
    sign-in/ not-authorized/
    api/health/            DB + integration status (public)
    api/shopify/ping/      Reads a real order (P0 checkpoint, team-only)
  db/schema.ts             Full data model (§4)
  db/index.ts              Neon + Drizzle client
  lib/env.ts               Server-only env validation + integration flags
  lib/auth.ts              Clerk + team-email allowlist
  lib/shopify.ts           Admin API client (retry/backoff)
  lib/brand.ts             Re-export of brand.config
  components/ui/           Button, Card, Badge
  middleware.ts            Clerk route protection
```

## How to test P0 manually

With env set and migrations applied: run `npm run dev`, sign in with an email listed in
`brand.config.ts → teamEmails`, and confirm the dashboard loads. Click **Shopify → Test
connection** (or open `/api/shopify/ping`) — it returns a real recent order from Laurel Bath
House. Open `/api/health` — it returns `{ ok: true, database: "connected", ... }`. Signing in
with a non-allowlisted email lands on `/not-authorized`.

## Guardrails (enforced)

- **Single-tenant** — no tenant tables; all brand identity in `brand.config.ts`.
- **Official data only** — Modash + official platform/Shopify APIs. No HTML scraping in core.
- **Secrets server-side** — env vars, `.env.example` documented, nothing client-exposed.
- **Idempotency** — unique keys on `shopify_order_id`, `post_url`, `gmail_message_id`,
  `discount_code` so order sync and code creation can't double-up.
- **Evidence-first** — unconfigured integrations render empty states, never fake numbers.

## App routes

| Route | What it does |
|---|---|
| `/` | Overview dashboard — live funnel counts + data-source status |
| `/creators` | Creator database: search/filter, manual add, CSV import, Shopify-tag seed, enrich |
| `/discovery` | Competitor-collaboration discovery → review queue → approve into creators |
| `/outreach` | Campaigns + AI draft generation, edit/regenerate, approve & send |
| `/inbox` | Priority inbox — replies auto-classified, hottest first; draft follow-ups |
| `/affiliates` | Activate creators → mint Shopify codes; per-affiliate revenue; order sync |
| `/content` | Content library of brand-mention posts with engagement metrics |
| `/join` | **Public** affiliate signup (no auth) |
| `/api/health` | Public DB + integration health |
| `/api/inngest` | Inngest endpoint for scheduled jobs (reply / order / mention sync) |

## Daily / weekly operating workflow

1. **Discover** (`/discovery`) — run competitor discovery, approve promising creators.
2. **Enrich & triage** (`/creators`) — enrich saved creators, filter by niche / followers / ER.
3. **Outreach** (`/outreach`) — pick a campaign, generate AI drafts, review, approve & send.
4. **Work the inbox** (`/inbox`) — replies are auto-classified; act on "interested" first, draft
   follow-ups for the rest. (Inngest syncs every 10 min, or hit Sync now.)
5. **Convert** (`/affiliates`) — activate replied creators into affiliates; their Shopify code is
   minted automatically. Share `/join` with inbound creators.
6. **Measure** (`/` + `/affiliates` + `/content`) — funnel counts, attributed revenue per
   affiliate, and the content they've posted, all update from live data.

## Going fully live (checklist)

- Add the remaining env vars in Vercel: `MODASH_API_KEY`, `ANTHROPIC_API_KEY`, `GMAIL_*`,
  `SHOPIFY_*`, `INNGEST_*`.
- Shopify custom app scopes: `read_orders`, `write_discounts`.
- Gmail OAuth app scopes: `gmail.send`, `gmail.readonly`.
- Register the Inngest app (point it at `https://<your-domain>/api/inngest`) for scheduled jobs.
- **Relax Vercel Deployment Protection** (Settings → Deployment Protection) so the public `/join`
  page and `/api/inngest` / webhook routes are reachable without Vercel SSO.

> **TikTok Shop** (P5) is deferred until TikTok Shop API access is granted; the affiliate
> code/attribution model is built to extend to it.
