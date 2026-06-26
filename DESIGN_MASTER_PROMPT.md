# MASTER PROMPT — Redesign "LBH CLIFF NOTES" UI/UX: Apple-grade sleekness × Bento UI

> Paste this whole file into a fresh Claude session pointed at the `LBH_Cliff_Notes`
> repo. It is a **visual/UX redesign brief only** — the app already works end-to-end
> (Next.js App Router + Tailwind + shadcn, dark-first). Do **not** change data
> fetching, server actions, routes, schema, or integration wiring. You are re-skinning
> a working product to feel like a first-party Apple dashboard built on a Bento grid.

---

## 0. ROLE & MISSION
You are a senior **design engineer** with an Apple Human Interface Design sensibility.
Re-skin LBH Cliff Notes — an internal influencer-marketing CRM for Laurel Bath House (a
DTC fragrance + body-care brand) — so it looks and feels like a polished Apple product:
calm, precise, deferential to content, with a **Bento UI** layout language (content in
neat, rounded, compartmentalized blocks, like a bento box). Sleek, tactile, quiet
confidence. No "dashboard template" vibes, no AI-slop gradients-everywhere.

Existing routes you'll restyle: `/` (overview/funnel), `/creators`, `/discovery`,
`/outreach`, `/inbox`, `/affiliates`, `/content`, `/join` (public), `/sign-in`,
`/not-authorized`. Existing primitives: `Button`, `Card`, `Badge`, `Input` (in
`src/components/ui/`), shared `AppNav`, and `src/app/globals.css` (CSS-variable theme).

---

## 1. NORTH STAR — Apple's three principles, applied
- **Clarity.** Type is legible at every size; icons precise; negative space does the
  heavy lifting; one focal point per region. Ruthless removal of visual noise.
- **Deference.** The UI recedes; the *data* is the hero. Surfaces are quiet (near-black,
  layered grays), color is rare and intentional, motion is subtle and physical.
- **Depth.** Soft, layered elevation, hairline borders, translucency/"frosted glass,"
  and gentle gradients create a sense of real material — never flat, never heavy.

**Bento as the layout grammar:** compose each screen from rounded, self-contained
"cells" of varying sizes arranged on a consistent grid with even gaps. Each cell is one
idea (one stat, one list, one control group). Asymmetry is welcome but must feel
balanced and intentional, like an Apple keynote slide.

---

## 2. HARD CONSTRAINTS (do not violate)
1. **Visual layer only.** Keep all server components, server actions, queries, routes,
   and the Drizzle schema exactly as-is. If a change needs new data, stop and flag it.
2. **Stack stays:** Next.js App Router, **Tailwind v3 + shadcn structure**, React 19.
   Prefer pure CSS/Tailwind for everything. Do **not** add heavy UI libraries. Motion
   should be CSS/transition-based; only add `framer-motion` if explicitly approved.
3. **Dark mode is the default** (it already is). Build the dark theme first; a light
   theme is optional polish (§11, must also feel Apple, not inverted-cheap).
4. **No `localStorage`/`sessionStorage`.** Persist UI prefs in URL or server only.
5. **Keep it dense + data-first.** Apple-calm ≠ empty. This is a working CRM; elevate it,
   don't dilute it. Tables stay scannable; bento makes them *framed*, not bigger.
6. **No fabricated data, no placeholder numbers.** Preserve every real value and the
   existing empty/disabled states (just make them beautiful).
7. **Accessibility ≥ WCAG AA.** Visible focus rings, ≥4.5:1 text contrast, ≥44px touch
   targets, `prefers-reduced-motion` respected.

---

## 3. DESIGN TOKENS (replace the theme — concrete values)
Rework `src/app/globals.css` CSS variables and `tailwind.config.ts` to these. Values are
HSL-friendly but hex is given for clarity; tune the accent to taste.

### Color — dark (default), layered like iOS system grays
```
--bg            #0B0B0C   /* app canvas — near-black, faint warmth, NOT pure #000 */
--surface-1     #161618   /* bento cell base */
--surface-2     #1F1F22   /* nested cell / input / hover */
--surface-3     #2A2A2E   /* pressed / elevated chip */
--hairline      rgba(255,255,255,0.08)   /* 1px borders & separators */
--hairline-soft rgba(255,255,255,0.05)
--text-primary  rgba(255,255,255,0.92)
--text-secondary rgba(255,255,255,0.56)
--text-tertiary rgba(255,255,255,0.36)
--accent        #C9A876   /* "Laurel" warm champagne — used sparingly */
--accent-weak   rgba(201,168,118,0.14)
--success       #30D158   /* iOS systemGreen (dark) */
--warning       #FFD60A   /* iOS systemYellow (dark) */
--danger        #FF453A   /* iOS systemRed (dark) */
--info          #0A84FF   /* iOS systemBlue (dark) — alt accent if you prefer cool */
```
> Accent guidance: pick **one** accent and use it rarely (active states, the single most
> important number, a focal CTA). Laurel champagne `#C9A876` reads premium/fragrance and
> is on-brand; iOS systemBlue `#0A84FF` is the safe Apple-neutral. Don't use both.

### Radius (generous, Apple/bento)
```
--r-cell  24px   /* bento cells / cards */
--r-panel 20px   /* table panels, modals */
--r-ctrl  12px   /* buttons, inputs, selects */
--r-chip  999px  /* pills / badges / nav items */
```

### Spacing (8px base; bento breathes)
```
grid gap: 16px (mobile) → 20px (desktop)
cell padding: 20px (compact) / 28px (feature cells)
section rhythm: 32–40px between major regions
max content width: 1200–1280px, centered
```

### Elevation / shadow (soft, diffuse, low-opacity — never harsh)
```
--shadow-cell:  0 1px 2px rgba(0,0,0,.35), 0 12px 32px -12px rgba(0,0,0,.45);
--ring-hairline: inset 0 0 0 1px var(--hairline);   /* pair with every cell */
--shadow-hover: 0 2px 4px rgba(0,0,0,.4), 0 20px 48px -16px rgba(0,0,0,.55);
```

### Material (frosted glass for nav, sticky headers, overlays)
```
backdrop-filter: blur(20px) saturate(180%);
background: rgba(18,18,20,0.72);   /* translucent surface over content */
border-bottom: 1px solid var(--hairline);
```

### Subtle cell gradients (optional, very low contrast — adds "depth" not noise)
```
background-image: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0));
```

---

## 4. TYPOGRAPHY — Apple system type ("SF")
- **Font stack** (renders San Francisco on Apple devices, graceful elsewhere; do NOT
  self-host SF Pro — it's not licensed for arbitrary web use). Set on `--font-sans`:
  ```
  -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text",
  "Inter", "Segoe UI", system-ui, sans-serif
  ```
  Optional close fallback for non-Apple: load **Inter** via `next/font` and place it
  after the SF entries so Apple devices still get SF.
- **Display vs Text:** large headings/numbers use Display sizing with **tight tracking**
  (Apple sets negative letter-spacing on big type). Body uses normal tracking.
- **Type scale** (tune within these):
  ```
  Hero number   48–64px / weight 600 / tracking -0.03em / tabular-nums
  Page title    24–28px / 600 / -0.02em
  Section label 11–12px / 600 / +0.06em / UPPERCASE / text-secondary
  Card title    15–16px / 590–600 / -0.01em
  Body          14–15px / 400–450 / 0
  Caption       12–13px / 400 / text-tertiary
  ```
- **Numerics are data:** every metric uses `font-variant-numeric: tabular-nums` so
  columns and KPIs align. This is core to the Apple-data feel.
- Weights: lean on 400/500/600. Avoid 700+ except rare emphasis. Never use all-caps for
  long text — only tiny section labels.

---

## 5. BENTO LAYOUT SYSTEM
- Build a reusable **`<BentoGrid>`** (CSS grid, `grid-template-columns: repeat(12, 1fr)`,
  `gap: var(--gap)`) and **`<BentoCell span={…} rowSpan={…}>`** (maps to `col-span` /
  `row-span`). Cells: `rounded-[var(--r-cell)]`, `bg-surface-1`, `--ring-hairline`,
  `--shadow-cell`, padding per §3, optional cell gradient.
- **Anatomy of a cell:** (1) a tiny section label or icon top-left, (2) the focal content
  (a big number, a chart, a list, a control), (3) optional footnote/trend bottom. One
  idea per cell. Let cells be *quiet* — most are surface-1 with hairline; reserve accent
  or a tinted background for the single most important cell.
- **Rhythm of sizes:** mix `2×2` feature cells (hero stat), `2×1` wide cells (a trend or a
  chip row), and `1×1` stat cells. Avoid a boring uniform grid — but keep gaps and radii
  perfectly consistent. Think App Store "Today" / iOS Fitness rings layout.
- **Tables inside bento:** wrap data tables in a single **panel cell** (`--r-panel`,
  hairline, frosted sticky header). Rows separated by `--hairline-soft`, not boxes.
  Don't bento-ize individual rows — the table *is* one bento module.
- Responsive: collapse 12→ fewer columns on tablet, single column stack on mobile; cells
  reflow gracefully (feature cells become full-width first).

---

## 6. MATERIALS, DEPTH & DETAIL
- **Frosted nav** (`AppNav`): sticky, translucent (`backdrop-blur`), hairline bottom,
  SF nav items as **pill tabs** — active tab is a filled `--surface-2` pill with
  `--text-primary`; inactive are `--text-secondary` → primary on hover. Brand wordmark
  left, `UserButton` right.
- **Hairlines everywhere** instead of heavy borders. 1px at 5–8% white.
- **Layered elevation:** nested content (e.g., an email draft inside a cell) sits on
  `--surface-2` with its own smaller radius — a "card within a card."
- **Iconography:** keep `lucide-react` but at 16–18px, `--text-secondary`, 1.5–2px
  stroke; treat icons as quiet accents, not decoration.
- **Focus & states:** Apple-style focus ring = 2px accent ring with a faint outer glow,
  offset from the control. Hover on interactive cells: lift `translateY(-1px)` +
  `--shadow-hover` + hairline brightens slightly.

---

## 7. MOTION (subtle, physical, optional-to-skip under reduced-motion)
- Easing: `cubic-bezier(0.22, 1, 0.36, 1)` (gentle ease-out) or a soft spring feel.
- Durations: 160–240ms for hovers/toggles; 240–320ms for entrances.
- Entrances: cells fade + rise 6–10px, lightly staggered (≤40ms) on first paint.
- Press: scale `0.98` on buttons; cells settle on release.
- **Always** wrap non-essential motion in `@media (prefers-reduced-motion: reduce)` →
  no transform/opacity animation. Never animate layout in a way that causes shift.

---

## 8. COMPONENT RESTYLE DIRECTION (re-skin existing primitives)
- **Card → BentoCell:** the default surface. Radius `--r-cell`, hairline, soft shadow,
  generous padding, optional top gradient. Headers use the section-label style.
- **Button:** Apple pill. `default` = filled accent (or a clean white-on-dark "primary")
  with SF semibold, `--r-ctrl`, press-scale; `secondary` = `--surface-2`; `outline` =
  transparent + hairline; `ghost` = text-only. Keep variant API; restyle only.
- **Badge → soft capsule:** tinted, low-contrast fills (e.g., success = green text on
  `success/15` bg), `--r-chip`, 11–12px medium. Used for statuses and interest labels.
- **Input/select/textarea:** `--surface-2`, hairline, `--r-ctrl`, comfortable height
  (36–40px), focus ring per §6, placeholder `--text-tertiary`. Native selects styled to
  match (keep the existing `fieldClass` approach).
- **StatTile (new):** the bento KPI unit — tiny label, big tabular number, optional
  trend chip. Used across the dashboard funnel.
- **Table panel (new wrapper):** frosted sticky header, hairline rows, tabular nums,
  hover row highlight (`--surface-2` at low opacity), rounded container.
- **Empty/disabled states:** centered, airy, a quiet line of `--text-secondary` + a small
  icon; integration-off states read as calm guidance, never error-red.

---

## 9. PAGE-BY-PAGE DIRECTION
- **`/` Overview (the showpiece):** a true **bento hero**. One `2×2` feature cell for the
  headline metric (Revenue or Active creators) with a hero number + subtle sparkline; a
  row of `1×1` StatTiles for the funnel (Discovered→…→Orders); a `2×1` "Data sources"
  cell with frosted status chips; a `2×1` "Pipeline/roadmap" cell. Asymmetric, balanced,
  keynote-grade. This is where Apple+Bento must sing.
- **`/creators`, `/affiliates`, `/content`, `/discovery`:** keep the tables, wrap each in a
  table-panel bento; lift the filter bar into its own slim cell; primary actions as pill
  buttons. `/content` becomes a clean image bento grid (rounded thumbnails, hairline,
  metric chips) — very App-Store-gallery.
- **`/outreach`:** bento — "New campaign" and "Generate" as two cells up top; each draft is
  a feature cell with the email rendered on a nested `--surface-2` card (card-in-card),
  edit/regenerate/send as a tidy pill row.
- **`/inbox`:** consider an Apple-Mail-style **two-pane** within a bento frame (priority
  list left, thread preview right) — or, simplest, a refined single list of bento rows
  sorted hottest-first with soft interest-label capsules. Keep it scannable.
- **`/join` & `/sign-in`:** centered, airy, marketing-grade. Soft full-bleed gradient
  backdrop (very subtle), a single frosted card with the form, SF display heading. This is
  the public face — make it feel like an Apple sign-up.

---

## 10. QUALITY BAR / ACCEPTANCE CRITERIA
The redesign is done when:
- The overview reads as a balanced **bento grid** an Apple designer would approve.
- Typography is unmistakably **SF/system**, with tight-tracked display numbers and
  tabular numerics across all metrics.
- Nav and sticky headers use **frosted translucency**; surfaces are layered near-blacks
  with **hairline** separators; **one** restrained accent.
- Radii, gaps, and padding are **consistent** across every screen (audit for stragglers).
- Motion is subtle and **reduced-motion-safe**; focus rings are visible; AA contrast holds.
- **All functionality, routes, and data are unchanged**; `npm run build` passes; no new
  runtime deps beyond (optional, approved) `framer-motion`.

---

## 11. IMPLEMENTATION PLAN (phased, reversible — verify build each phase)
1. **Tokens.** Update `globals.css` variables + `tailwind.config.ts` (radii, fontFamily,
   boxShadow, colors, backgroundImage). Set the SF font stack. Ship; confirm nothing
   breaks.
2. **Primitives + new components.** Restyle `Button`/`Card`/`Badge`/`Input`; add
   `BentoGrid`/`BentoCell`, `StatTile`, `TablePanel`, and the frosted `AppNav`.
3. **Overview bento.** Rebuild `/` as the hero bento grid (wire to existing
   `getFunnelCounts()` + `integrations` data — no new data).
4. **Remaining pages.** Apply table-panel + bento framing to creators/affiliates/content/
   discovery/outreach/inbox; redesign `/join` + `/sign-in`.
5. **Motion + a11y + (optional) light theme.** Add subtle transitions, focus rings,
   reduced-motion guards; optional Apple-style light mode behind the existing `.dark`
   class strategy.
Run the project's full typecheck/build before each push (`npm run build`).

---

## 12. GUARDRAILS (repeat — important)
- Touch **only** presentation: `*.tsx` markup/classes, `components/ui/*`, `globals.css`,
  `tailwind.config.ts`, new presentational components. **Never** edit `src/lib/*` logic,
  `src/db/*`, server actions, or `middleware.ts` behavior.
- Preserve dark-default, density, real data, empty/disabled states, and accessibility.
- No `localStorage`; no fake metrics; no heavy dependencies; keep Tailwind v3 + shadcn.

---

## 13. MOOD / REFERENCES (study before building)
- Apple.com product pages; App Store **Today** tab; iOS **Fitness/Health** card stacks;
  **Apple Music**; macOS **System Settings**; Apple developer dashboards.
- Bento trend: bento.me, and the framed-cell dashboards of Linear, Vercel, Raycast.
- Keywords to channel: *calm, precise, layered, hairline, frosted, tabular, generous
  whitespace, one accent, quiet motion.*

---

## APPENDIX — concrete starting snippets (adapt, don't paste blindly)

**globals.css (dark `:root`/`.dark` additions):**
```css
:root, .dark {
  --font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text",
               "Inter", "Segoe UI", system-ui, sans-serif;
  --r-cell: 24px; --r-panel: 20px; --r-ctrl: 12px;
}
.dark {
  --background: 240 5% 4%;        /* #0B0B0C */
  --card: 240 4% 9%;             /* #161618 */
  --muted: 240 4% 12%;           /* #1F1F22 */
  --border: 0 0% 100% / 0.08;    /* hairline (use rgba in raw CSS) */
  --foreground: 0 0% 100% / 0.92;
  --primary: 38 41% 63%;         /* champagne #C9A876 */
}
body { font-family: var(--font-sans); -webkit-font-smoothing: antialiased;
       font-variant-numeric: tabular-nums; }
.frost { backdrop-filter: blur(20px) saturate(180%);
         background: rgba(18,18,20,0.72); }
.bento-cell { border-radius: var(--r-cell); background: var(--surface-1);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.07),
              0 12px 32px -12px rgba(0,0,0,.45); }
@media (prefers-reduced-motion: reduce){ * { animation:none!important; transition:none!important; } }
```

**tailwind.config.ts extend:**
```ts
extend: {
  borderRadius: { cell: "24px", panel: "20px", ctrl: "12px" },
  boxShadow: {
    cell: "inset 0 0 0 1px rgba(255,255,255,.07), 0 12px 32px -12px rgba(0,0,0,.45)",
    hover: "inset 0 0 0 1px rgba(255,255,255,.10), 0 20px 48px -16px rgba(0,0,0,.55)",
  },
  transitionTimingFunction: { apple: "cubic-bezier(0.22, 1, 0.36, 1)" },
}
```

**BentoGrid / BentoCell sketch:**
```tsx
export function BentoGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-4 lg:grid-cols-12 lg:gap-5">{children}</div>;
}
export function BentoCell({ span = 3, tall = false, className = "", children }:
  { span?: number; tall?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <div className={`bento-cell p-6 lg:col-span-${span} ${tall ? "lg:row-span-2" : ""} ${className}`}>
      {children}
    </div>
  );
}
```
> (For dynamic Tailwind spans, prefer an explicit map of allowed `col-span-*` classes so
> JIT keeps them — don't build class strings Tailwind can't see.)

**StatTile sketch:**
```tsx
export function StatTile({ label, value, trend }:
  { label: string; value: string; trend?: string }) {
  return (
    <div className="bento-cell p-5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-white/40">{label}</div>
      <div className="mt-2 text-3xl font-semibold tabular-nums tracking-[-0.02em] text-white/90">{value}</div>
      {trend && <div className="mt-1 text-xs text-white/45">{trend}</div>}
    </div>
  );
}
```

— End of brief. Build phase by phase, keep it reversible, and let the data stay the hero.
