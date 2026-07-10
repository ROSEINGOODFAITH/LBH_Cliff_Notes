import { eq } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import { db } from "@/db";
import { creators, modelWeights } from "@/db/schema";
import { modashReport, claude, parseClaudeJson } from "@/lib/integrations";
import { fitScore } from "@/lib/model";

const NICHES = ["fragrance", "beauty", "lifestyle", "grwm", "fitness", "fashion", "skincare", "unboxing"];
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const enrichOnSourced = inngest.createFunction(
  {
    id: "pulse-enrich-on-sourced",
    concurrency: 5,
    // Modash rate-limits profile-report pulls (bulk imports produced 429 storms).
    // Pace new runs to 6/min and give rate-limited runs enough retries to drain.
    throttle: { limit: 6, period: "1m" },
    retries: 10,
  },
  { event: "creator.sourced" },
  async ({ event, step }) => {
    const c = (await db.select().from(creators).where(eq(creators.id, event.data.creatorId)))[0];
    if (!c || c.stage !== "sourced") return;
    // Best-effort: if Modash is rate-limited/out of API credits, proceed with
    // whatever data the row already has (CSV import) rather than sticking at `sourced`.
    const report = await step.run("modash-report", async () => {
      try { return await modashReport(c.modashId!); }
      catch (e) {
        console.warn(`[pulse] modash report unavailable for @${c.handle}:`, String(e).slice(0, 400));
        return { __unavailable: String(e).slice(0, 300) };
      }
    });
    // Backfill profile stats from the report — manual list-intake rows start with
    // nulls (daily-search rows already carry them from the search response).
    const p = (report as any)?.profile ?? {};
    const pp = p?.profile ?? {};
    const interests: string[] = (Array.isArray(p?.interests) ? p.interests : [])
      .map((i: any) => String(i?.name ?? "").toLowerCase());
    const stats = {
      followerCount: c.followerCount ?? num(pp.followers),
      engagementRate: c.engagementRate ?? num(pp.engagementRate), // 0..1 fraction (repo convention)
      avgViews: c.avgViews ?? num(pp.averageViews ?? pp.avgViews),
      fakeFollowerPct: c.fakeFollowerPct ??
        (num(p?.audience?.credibility) != null ? Math.round((1 - p.audience.credibility) * 100) : null),
      geo: c.geo ?? (p?.audience?.geoCountries?.[0]?.code ?? pp.country ?? null),
      niche: c.niche ?? (NICHES.find((n) => interests.includes(n)) ?? null),
      email: c.email ??
        ((Array.isArray(p?.contacts) ? p.contacts : []).find((x: any) => x?.type === "email")?.value ?? null),
    };
    // Best-effort: a failed Claude call must not strand the creator at `sourced`.
    const profileJson = (report as any)?.__unavailable
      ? { handle: c.handle, ...stats, note: "Modash report unavailable — stats from import" }
      : report;
    const ai = await step.run("claude-brand-fit", async () => {
      try {
        return parseClaudeJson(await claude(
          `You score TikTok creators for Laurel Bath House, a refined DTC fragrance brand launching PULSE.
Profile JSON: ${JSON.stringify(profileJson).slice(0, 6000)}
Return ONLY JSON: {"aestheticScore": 0-100 brand fit, "firstLine": "one specific, warm, non-generic opening line referencing their content"}`));
      } catch (e) {
        console.warn(`[pulse] claude scoring unavailable for @${c.handle}:`, String(e).slice(0, 400));
        return { aestheticScore: null, firstLine: "", __unavailable: String(e).slice(0, 300) };
      }
    });
    const [w] = await db.select().from(modelWeights);
    const merged = { ...c, ...stats, aestheticScore: ai.aestheticScore ?? null };
    await step.run("save", () => db.update(creators).set({
      ...stats,
      aestheticScore: ai.aestheticScore ?? null,
      fitScore: fitScore(merged, (w?.weights as any) ?? {}),
      rawModash: { ...(c.rawModash as any), report, firstLine: ai.firstLine },
      stage: "review", updatedAt: new Date(),
    }).where(eq(creators.id, c.id)));
  });
