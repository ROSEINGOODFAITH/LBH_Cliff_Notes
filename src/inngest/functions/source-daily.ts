import { inngest } from "@/lib/inngest";
import { db } from "@/db";
import { creators } from "@/db/schema";
import { modashSearch } from "@/lib/integrations";

export const sourceDaily = inngest.createFunction(
  { id: "pulse-source-daily" },
  { cron: "TZ=America/Los_Angeles 0 7 * * *" },
  async ({ step }) => {
    let inserted = 0;
    for (let page = 0; page < 20 && inserted < 300; page++) {
      const res = await step.run(`search-p${page}`, () => modashSearch(page));
      const users = res.users ?? [];
      if (!users.length) break;
      for (const u of users) {
        if (inserted >= 300) break;
        const p = u.profile ?? {};
        const row = await step.run(`insert-${u.userId}`, () =>
          db.insert(creators).values({
            modashId: u.userId, handle: p.username ?? "unknown",
            email: p.emails?.[0] ?? null, followerCount: p.followers ?? null,
            engagementRate: p.engagementRate ?? null, // 0..1 fraction (repo convention)
            avgViews: p.averageViews ?? null, fakeFollowerPct: p.fakeFollowerPct ?? null,
            geo: p.geo ?? "US", niche: p.niche ?? null, rawModash: u,
            source: "modash", primaryPlatform: "tiktok",
          }).onConflictDoNothing({ target: creators.modashId }).returning({ id: creators.id }));
        if (row.length) {
          inserted++;
          await step.sendEvent("emit-sourced", { name: "creator.sourced", data: { creatorId: row[0].id } });
        }
      }
    }
    return { inserted };
  });
