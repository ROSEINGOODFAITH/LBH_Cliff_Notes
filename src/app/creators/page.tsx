import { requireTeamMember } from "@/lib/auth";
import { AppNav } from "@/components/app-nav";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StageBadge } from "@/components/stage-badge";
import { Input, fieldClass } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { listCreators, type CreatorFilters, type Platform } from "@/lib/creators";
import { CREATOR_STAGES, stageMeta, type CreatorStage } from "@/lib/lifecycle";
import { formatCompact } from "@/lib/utils";
import { AddCreatorForm, CsvImportForm, ShopifySeedForm } from "./creator-forms";

export const dynamic = "force-dynamic";

function pickStr(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function fmtER(er: number | null): string {
  return er != null ? `${(er * 100).toFixed(1)}%` : "—";
}

export default async function CreatorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const team = await requireTeamMember();
  const sp = await searchParams;
  const platform = pickStr(sp.platform);
  const stage = pickStr(sp.stage);
  const minFollowersRaw = pickStr(sp.minFollowers);
  const minEngRaw = pickStr(sp.minEngagement);

  const filters: CreatorFilters = {
    q: pickStr(sp.q),
    platform: (["instagram", "tiktok", "youtube"].includes(platform ?? "") ? platform : undefined) as
      | Platform
      | undefined,
    stage: (CREATOR_STAGES.includes((stage ?? "") as CreatorStage) ? stage : undefined) as CreatorStage | undefined,
    niche: pickStr(sp.niche),
    minFollowers: minFollowersRaw ? Number(minFollowersRaw.replace(/[, ]/g, "")) : undefined,
    minEngagement: minEngRaw ? Number(minEngRaw) / 100 : undefined,
  };

  const rows = await listCreators(filters);

  return (
    <div className="min-h-screen">
      <AppNav active="/creators" email={team.email} />
      <main className="container space-y-6 py-8">
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-sm">Add creator</CardTitle>
            </CardHeader>
            <CardContent>
              <AddCreatorForm />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Seed first-party</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Import Shopify customers carrying a tag as first-party creators.
              </p>
              <ShopifySeedForm />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">CSV import</CardTitle>
          </CardHeader>
          <CardContent>
            <CsvImportForm />
          </CardContent>
        </Card>

        <form className="flex flex-wrap items-end gap-2" action="/creators" method="get">
          <Input name="q" defaultValue={filters.q ?? ""} placeholder="Search handle / name" className="max-w-[220px]" />
          <select name="platform" defaultValue={platform ?? ""} className={`${fieldClass} max-w-[150px]`}>
            <option value="">All platforms</option>
            <option value="instagram">Instagram</option>
            <option value="tiktok">TikTok</option>
            <option value="youtube">YouTube</option>
          </select>
          <select name="stage" defaultValue={stage ?? ""} className={`${fieldClass} max-w-[150px]`}>
            <option value="">All stages</option>
            {CREATOR_STAGES.map((s) => (
              <option key={s} value={s}>
                {stageMeta(s).label}
              </option>
            ))}
          </select>
          <Input name="niche" defaultValue={filters.niche ?? ""} placeholder="Niche" className="max-w-[150px]" />
          <Input
            name="minFollowers"
            defaultValue={minFollowersRaw ?? ""}
            placeholder="Min followers"
            className="max-w-[140px]"
          />
          <Input name="minEngagement" defaultValue={minEngRaw ?? ""} placeholder="Min ER %" className="max-w-[110px]" />
          <Button type="submit" size="sm" variant="secondary">
            Filter
          </Button>
        </form>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="p-3 font-medium">Creator</th>
                    <th className="p-3 font-medium">Platform</th>
                    <th className="p-3 font-medium">Followers</th>
                    <th className="p-3 font-medium">ER</th>
                    <th className="p-3 font-medium">Stage</th>
                    <th className="p-3 font-medium">Source</th>
                    <th className="p-3 font-medium">Niches</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-sm text-muted-foreground">
                        No creators match. Add one above, import a CSV, or run Discovery.
                      </td>
                    </tr>
                  ) : (
                    rows.map((c) => (
                      <tr key={c.id} className="border-b border-border/60 last:border-0">
                        <td className="p-3">
                          <Link href={`/creators/${c.id}`} className="font-medium hover:text-primary hover:underline underline-offset-2">
                            @{c.handle}
                          </Link>
                          {c.displayName && (
                            <div className="text-xs text-muted-foreground">{c.displayName}</div>
                          )}
                        </td>
                        <td className="p-3">
                          {c.primaryPlatform ? <Badge variant="secondary">{c.primaryPlatform}</Badge> : "—"}
                        </td>
                        <td className="p-3 tabular-nums">{formatCompact(c.followerCount)}</td>
                        <td className="p-3 tabular-nums">{fmtER(c.engagementRate)}</td>
                        <td className="p-3">
                          <StageBadge stage={c.stage} />
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">{c.source}</td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {c.nicheTags?.length ? c.nicheTags.slice(0, 3).join(", ") : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground">{rows.length} creator(s) shown.</p>
      </main>
    </div>
  );
}
