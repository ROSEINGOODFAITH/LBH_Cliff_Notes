import { requireTeamMember } from "@/lib/auth";
import { AppNav } from "@/components/app-nav";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, fieldClass } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { listContentMentions, type ContentFilters } from "@/lib/content";
import { modashConfigured, type ModashPlatform } from "@/lib/modash";
import { formatCompact } from "@/lib/utils";
import { SyncMentionsButton } from "./content-forms";

export const dynamic = "force-dynamic";

function pickStr(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const team = await requireTeamMember();
  const sp = await searchParams;
  const platform = pickStr(sp.platform);
  const filters: ContentFilters = {
    q: pickStr(sp.q),
    platform: (["instagram", "tiktok", "youtube"].includes(platform ?? "") ? platform : undefined) as
      | ModashPlatform
      | undefined,
  };
  const items = await listContentMentions(filters);
  const modashOn = modashConfigured();

  return (
    <div className="min-h-screen">
      <AppNav active="/content" email={team.email} />
      <main className="container space-y-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-sm font-semibold">Content library</h1>
            <p className="text-xs text-muted-foreground">
              Brand-mentioning posts by tracked creators. {items.length} post(s).
            </p>
          </div>
          <SyncMentionsButton disabled={!modashOn} />
        </div>

        {!modashOn && (
          <div className="rounded-md border border-border bg-secondary/40 px-4 py-2 text-xs text-muted-foreground">
            Modash isn&apos;t configured — mention tracking is disabled. Add <code>MODASH_API_KEY</code>.
          </div>
        )}

        <form className="flex flex-wrap items-end gap-2" action="/content" method="get">
          <Input name="q" defaultValue={filters.q ?? ""} placeholder="Creator handle" className="max-w-[220px]" />
          <select name="platform" defaultValue={platform ?? ""} className={`${fieldClass} max-w-[150px]`}>
            <option value="">All platforms</option>
            <option value="instagram">Instagram</option>
            <option value="tiktok">TikTok</option>
            <option value="youtube">YouTube</option>
          </select>
          <Button type="submit" size="sm" variant="secondary">
            Filter
          </Button>
        </form>

        {items.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              No tracked posts yet. Activate creators and run a mention sync.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((it) => {
              const m = it.mention;
              const stats = (m.metricsJson as { likes?: number; comments?: number; views?: number; plays?: number } | null) ?? {};
              const views = stats.views ?? stats.plays;
              return (
                <Card key={m.id} className="overflow-hidden">
                  <div className="aspect-square w-full bg-secondary">
                    {m.mediaUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.mediaUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">no preview</div>
                    )}
                  </div>
                  <CardContent className="space-y-1 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">@{it.handle}</span>
                      <Badge variant="secondary">{m.platform}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {m.postedAt ? new Date(m.postedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                    </div>
                    <div className="flex gap-3 text-xs text-muted-foreground">
                      <span>♥ {formatCompact(stats.likes ?? null)}</span>
                      <span>💬 {formatCompact(stats.comments ?? null)}</span>
                      {views != null && <span>▶ {formatCompact(views)}</span>}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
