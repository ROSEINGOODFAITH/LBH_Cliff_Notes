# PULSE MODULE — Design Specification (v2, AUTHORITATIVE)

> This document describes how the PULSE module is designed to work AS BUILT in
> `pulse-module-v2.zip`. If the implementation in the repo differs from this spec,
> **the repo is wrong** — correct the repo to match this document.
> Stack: Next.js (App Router) · Neon Postgres · Drizzle · Inngest · Smartlead · Modash · Tally · Shopify · Claude API.

## 1. What this system is

A single-brand internal campaign machine for the PULSE TikTok launch. It sources
creators from Modash, ranks them with a model that learns from David's approve/reject
decisions, runs email outreach through Smartlead, onboards responders through Tally,
ships product through Shopify from the Van Nuys warehouse, tracks posting and FTC
compliance, and gates all payouts behind David's explicit approval.

Goal: 500 organic/affiliate posts (Tier B) + 100 paid disclosed reviews (Tier A), driving to LBH DTC.

## 2. Single source of truth

One Postgres row per creator in the `creators` table. One stage enum drives everything:

```
sourced → review → contacted → replied → onboarded → shipped → posted → paid
terminal: rejected, churned
```

Rules:
- Stage changes happen ONLY inside the Inngest functions listed in §5 or the decision API (§6). Nothing else mutates stage.
- Creators in `rejected` or `churned` are never contacted again by any function.
- Every stage-changing function emits an Inngest event so downstream functions chain automatically.

## 3. Data model (5 tables)

| Table | Purpose | Key fields |
|---|---|---|
| `creators` | one row per creator, single source of truth | modashUserId (unique, dedupe key), handle, email, followers, engagementRate (percent), avgViews, fakeFollowerPct, geo, niche, aestheticScore (0–100), fitScore (denormalized rank), stage, tier ('A'/'B'), discountCode (unique), rateUsd, shopifyDraftOrderId, trackingNumber, postUrl, postVerifiedAt, disclosureOk, rawModash (jsonb: full profile + report + firstLine) |
| `decisions` | immutable log of every human tiering action — this is the training data | creatorId, action ('tier_a'/'tier_b'/'reject'), features (jsonb, frozen at decision time), decidedAt |
| `model_weights` | exactly ONE row (id=1), updated transactionally | weights (jsonb map feature→number), decisionCount |
| `outreach_events` | audit log of everything sent/received | creatorId, type (pushed/sent/opened/replied/bounced/unsubscribed/nudge_sent), classification (interested/negotiating/later/no), payload (jsonb) |
| `payouts` | Tier A money trail | creatorId, half ('signing'/'completion'), amountUsd, status (pending/approved/paid), approvedBy |

Indexes: creators(stage), creators(fitScore desc), outreach_events(creatorId, occurredAt).

## 4. The learning model (do not replace with ML)

- **Features** extracted per creator: er_high (ER>5), er_mid (3–5), micro (<50k), mid (50–200k), macro (≥200k), fake_low (<15%), us, one-hot niche (fragrance/beauty/lifestyle/grwm/fitness/fashion/skincare/unboxing), aesthetic (score/100), views_ratio (min(avgViews/followers,2)/2).
- **Score**: `fitScore = clamp(0..100, round(50 + Σ weights[k]·features[k] × 10))`.
- **Learning**: on every decision, `lr = 0.4 / (1 + 0.02·decisionCount)`; each weight moves by `lr · (label−0.5)·2 · feature` where label = 1 for tier_a/tier_b, 0 for reject.
- After every weight update, ALL creators in `review` are re-scored so the queue re-ranks immediately. This is why rejects matter: similar profiles sink before David ever sees them.
- Weight updates are serialized (Inngest concurrency: 1 on the model function).

## 5. Inngest functions (9) — exact behavior

1. **`pulse/source.daily`** — cron 07:00 America/Los_Angeles. Modash TikTok Discovery: US, 10k–500k followers, ER>3%, must-have email, fragrance/beauty-adjacent relevance tags. Up to 300 inserts/day, dedupe on `modashUserId` (onConflictDoNothing). Each insert emits `creator.sourced`.
2. **`pulse/enrich.on-sourced`** (event `creator.sourced`, concurrency 5) — pulls full Modash report; one Claude call returns `{aestheticScore, firstLine}` (firstLine = one specific, warm opener referencing their content, stored in rawModash.firstLine); computes fitScore from current weights; stage → `review`.
3. **`pulse/outreach.on-tiered`** (event `creator.tiered`) — generates `PULSE-<HANDLE6>` Shopify discount code (15%); pushes lead to Smartlead campaign (Tier A or Tier B env-configured campaign IDs) with merge fields {handle, first_line, code}; stage → `contacted`; logs `pushed` event. **Smartlead owns all send pacing** — the app never throttles or schedules sends.
4. **`pulse/replies.webhook`** (event `smartlead/reply.received`, fed by the Smartlead webhook route) — skips terminal/paid creators. Claude classifies the reply text into interested/negotiating/later/no.
   - interested → auto-reply with the Tally form link (`TALLY_FORM_URL?handle=...`); stage → `replied`
   - negotiating (Tier A only) → creates a **pending** `signing` payout at the suggested rate; stage → `replied`; surfaces in the human Approvals queue
   - no → stage → `churned`
   - later → logged only, no stage change
5. **`pulse/onboard.tally-webhook`** (event `tally/intake.submitted`, fed by the Tally webhook route) — **normalizes handles on BOTH sides of the lookup: strip leading `@`, lowercase** (SQL: `lower(regexp_replace(handle,'^@+',''))` = normalized input). Only accepts creators in `replied` or `contacted`. Creates Shopify draft order for `PULSE_SEEDING_VARIANT_ID` with the shipping address; stage → `onboarded`.
6. **`pulse/fulfill.poll`** — cron hourly. For every `onboarded` creator, polls Shopify for a tracking number on their draft order's resulting order. When found: stage → `shipped`, **and sends the shipped email via smartleadReply containing: tracking number, `CREATIVE_BRIEF_URL`, their discount code, and the FTC disclosure line ("one tiny string: tag it #ad or flip on TikTok's paid-partnership label")**. Logs a `sent` event. This email is NOT optional — without it creators receive an unmarked package.
7. **`pulse/activation.check`** — cron daily 16:00 UTC. Two branches, deliberately asymmetric:
   - **Post detection runs on ALL `shipped` creators daily** (no age filter): if postUrl is set → stage → `posted`, set postVerifiedAt, emit `creator.posted`.
   - **Nudges only after 10 quiet days**: max 2 nudges (counted via `nudge_sent` events), 1 per daily run after threshold; after the 2nd unanswered nudge → stage → `churned`.
8. **`pulse/compliance.on-posted`** (event `creator.posted`) —
   - Tier B → stage → `paid` immediately (their "payment" is the commission link; nothing owed).
   - Tier A → Claude checks the post caption for #ad / #sponsored / paid-partnership AND a PULSE-by-LBH mention → sets `disclosureOk`. If ok → creates a **pending** `completion` payout for `rateUsd/2`. Stage does NOT advance here — it advances only when David approves (§6). **No disclosure = no completion payout, ever.**
9. **`pulse/model.on-decision`** (event `decision.recorded`, concurrency 1) — the learning update from §4 + full review-queue re-score.

## 6. API routes

| Route | Behavior |
|---|---|
| `POST /api/pulse/decision` `{creatorId, action}` | Only valid if creator is in `review`. Writes immutable `decisions` row with frozen features, emits `decision.recorded`. reject → stage `rejected`; tier_a/tier_b → sets tier, emits `creator.tiered`. |
| `POST /api/pulse/payout` `{payoutId, approve:true}` | Only valid on `pending` payouts. Marks approved + approvedBy. **Approving a `completion` payout is what moves the creator to stage `paid`.** The route records sign-off only — the actual money transfer happens in David's payment rail, NEVER automatically. |
| `GET /api/pulse/queue` | `review` creators, fitScore desc, limit 50, each with suggestedRate = clamp(75..500, avgViews×$25/1000). |
| `GET /api/pulse/dashboard` | stage counts, goal progress (organic = Tier B in posted/paid vs 500; paid = Tier A in posted/paid vs 100), pending payouts, model weights + decisionCount. |
| `POST /api/webhooks/smartlead?secret=...` | Rejects unless `secret` query param equals `SMARTLEAD_WEBHOOK_SECRET`. Forwards EMAIL_REPLY events to Inngest as `smartlead/reply.received`. |
| `POST /api/webhooks/tally` | Verifies Tally HMAC-SHA256 signature (`tally-signature` header, base64, keyed by `TALLY_SIGNING_SECRET`) over the RAW request body. Maps form fields by lowercase label: "tiktok handle", "name", "address", "city", "state", "zip", "country". Emits `tally/intake.submitted`. |
| `GET/POST/PUT /api/inngest` | Inngest serve handler registering all 9 functions. If the repo already had a serve handler, the 9 pulse functions are merged into it — there must be exactly ONE serve route. |

## 7. UI (`/pulse`) — LBH tokens, port of approved design

Instrument Serif Italic display / Geist body / Geist Mono data, warm off-white oklch background. Tabs:
- **Review** — one creator card at a time, ranked by fitScore; stats grid; suggested rate chip; three actions (Tier A / Tier B / Wrong for LBH); "up next" list of 5. Optimistic removal on decision.
- **Pipeline** — stage columns with counts. Cards advance ONLY via webhooks/crons — clicking does not advance stage (that was the mock-era behavior; it is gone).
- **Campaign Goal** — two progress bars against 500 / 100.
- **Model** — decisionCount + top signed weights (green positive, red negative).
- **Approvals** — appears only when pending payouts exist; each row has a working Approve button hitting `/api/pulse/payout`.

## 8. Environment variables (Vercel)

```
DATABASE_URL                 Neon
MODASH_API_KEY
SMARTLEAD_API_KEY
SMARTLEAD_CAMPAIGN_TIER_A    numeric id from campaign URL
SMARTLEAD_CAMPAIGN_TIER_B
SMARTLEAD_WEBHOOK_SECRET     d5aea1f19267bdf7dba233ae15b0aff1 (already generated)
SHOPIFY_STORE_DOMAIN         laurelbathhouse.myshopify.com
SHOPIFY_ADMIN_TOKEN
ANTHROPIC_API_KEY
TALLY_SIGNING_SECRET         from Tally webhook settings
TALLY_FORM_URL               https://tally.so/r/rj1jqp
CREATIVE_BRIEF_URL           link to the creator brief doc
PULSE_SEEDING_VARIANT_ID     52823217733941
MOCK                         unset/0 in production (1 = fake data, no external calls)
```

## 9. Guardrails (non-negotiable)

1. Money never moves automatically. Payout rows are approval records only.
2. No Tier A completion payout without `disclosureOk = true`.
3. Never contact creators in terminal states.
4. Smartlead owns send pacing and inbox rotation; sending domains and warmup live entirely in Smartlead's dashboard — the app never touches them.
5. Every external API response is logged into a jsonb column (rawModash / payload) for audit.
6. The learning model stays the simple weighted-feature model — no embeddings, no retraining pipelines.

## 10. Known open items (deliberate, not bugs)

- **postUrl automation**: nothing populates postUrl automatically yet. Launch flow: creators reply with their link or David pastes it. Week-3 upgrade: Modash content tracking poll.
- **Tally extra fields**: "Instagram Handle" and "Would you want to?" exist on the live form but are dropped by the webhook parser unless the one-line mapping + `ig_handle` column are added.
- **Seeding SKU**: variant 52823217733941 needs real inventory count + SKU code (`PULSE-EDP-SEED`) before volume shipping.
- **Outreach campaigns stay PAUSED** in Smartlead until sending domains complete ~2–3 weeks of warmup. Sourcing/review can run at full speed meanwhile.

## 11. Correct end-to-end sequence (use this to verify the repo)

1. 7am cron sources ≤300 creators → each enriched by Claude → lands in `review` ranked by fitScore
2. David reviews in `/pulse`: every decision trains the model and re-ranks the queue
3. Tier A/B approval → Shopify code created → lead pushed to the right Smartlead campaign → `contacted`
4. Reply arrives → Smartlead webhook → Claude classifies → interested gets Tally link (`replied`); Tier A negotiations create a pending signing payout
5. Tally submit → handle normalized → Shopify draft order → `onboarded`
6. Warehouse fulfills → hourly poll catches tracking → `shipped` + shipped/brief/code/#ad email sends
7. Daily check finds postUrl → `posted` → compliance: Tier B closes to `paid`; Tier A disclosure check → pending completion payout
8. David clicks Approve → Tier A creator → `paid`. Dashboard bars tick toward 500 / 100.

If any step in the repo deviates from this sequence, fix the repo to match.

## 12. Addendum — manual Modash list intake (2026-07-10, owner-requested)

- `POST /api/pulse/source` `{handles: string[]}` (Clerk-protected, ≤500/request) — normalizes TikTok handles (strips URL/@, lowercases), dedupes on `modashId` (the handle serves as the dedupe key for manual intake), inserts as stage `sourced`, emits `creator.sourced` per new row. UI: "Import from Modash list" panel on the /pulse Review tab. Rationale: Modash's public API does not expose in-app Lists, so curated lists are pasted (or CSV-exported) from the Modash app.
- `pulse/enrich.on-sourced` additionally backfills followerCount, engagementRate, avgViews, fakeFollowerPct (1−credibility), geo, niche, and email from the Modash profile report whenever the creator row lacks them. Daily-search rows already carry these from the search response; intake rows start empty.
- Enrichment is throttled to 6 runs/min with retries=10: Modash rate-limits report pulls (bulk imports caused 429 storms on 2026-07-10). Re-importing the same handles re-emits `creator.sourced` for rows still in stage `sourced` (self-serve retry); the /pulse Pipeline tab shows `sourced` and `review` columns so stuck enrichment is visible.
- Enrichment and the shipped/nudge Smartlead sends are FAIL-SOFT: external failures are logged (console + jsonb payload `__unavailable`) and the creator keeps moving — external outages degrade data, they never strand a stage. Exception per §9.2 unchanged: no disclosure = no completion payout.
- Instagram intake: prospect imports carry a platform (tiktok|instagram); IG rows dedupe on `modashId = "ig:"+handle`, set `igHandle`, and enrichment hits `/instagram/profile/{handle}/report` (emails backfill from report contacts once the Modash token is provisioned).
- Existing-contacts intake (`mode: "contacts"`): name + email (+optional handle/tier) inserted directly at stage `replied` with a tier — they're already in conversation, so cold outreach is skipped; the owner sends the Tally link himself and the webhook matches by email or handle. Owner-approved deviation from §2's "stage changes only in functions" (a stage-`replied` INSERT, not a mutation).
- Review card v2: handle links to the live profile, platform + display name shown, empty stats hidden, inline email add (`POST /api/pulse/creator`), and Tier A/B are disabled in UI + refused by the decision API (409) when no email exists — tiering an unreachable creator previously no-oped silently.
