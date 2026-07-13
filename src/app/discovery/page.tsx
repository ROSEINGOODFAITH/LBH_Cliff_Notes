import { desc, eq } from "drizzle-orm";
import { requireTeamMember } from "@/lib/auth";
import { AppNav } from "@/components/app-nav";
import { db } from "@/db";
import { discoveryCandidates } from "@/db/schema";
import { brandConfig } from "@/lib/brand";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RunDiscoveryForm, ApproveButton, DismissButton } from "./discovery-forms";

export const dynamic = "force-dynamic";

export default async function DiscoveryPage() {
  const team = await requireTeamMember();
  const candidates = await db
    .select()
    .from(discoveryCandidates)
    .where(eq(discoveryCandidates.status, "new"))
    .orderBy(desc(discoveryCandidates.detectedAt))
    .limit(200);

  const defaults = brandConfig.competitorBrands.join(", ");

  return (
    <div className="min-h-screen">
      <AppNav active="/discovery" email={team.email} />
      <main className="container space-y-6 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Discover creators linked to competitors</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Pulls influencers who have collaborated with your competitor brands (via an external
              discovery source), deduped against your database. Defaults to: {defaults}.
            </p>
            <RunDiscoveryForm defaultCompetitors={defaults} />
          </CardContent>
        </Card>

        <div>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Review queue · {candidates.length}
          </h2>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="p-3 font-medium">Creator</th>
                      <th className="p-3 font-medium">Platform</th>
                      <th className="p-3 font-medium">Via competitor</th>
                      <th className="p-3 font-medium">Type</th>
                      <th className="p-3 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-8 text-center text-sm text-muted-foreground">
                          No candidates yet. Run discovery above.
                        </td>
                      </tr>
                    ) : (
                      candidates.map((c) => (
                        <tr key={c.id} className="border-b border-border/60 last:border-0">
                          <td className="p-3">
                            <a
                              href={c.url ?? "#"}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium hover:underline"
                            >
                              @{c.handle}
                            </a>
                          </td>
                          <td className="p-3">
                            <Badge variant="secondary">{c.platform}</Badge>
                          </td>
                          <td className="p-3 text-muted-foreground">{c.sourceCompetitor ?? "—"}</td>
                          <td className="p-3 text-muted-foreground">{c.collaborationType ?? "—"}</td>
                          <td className="p-3">
                            <div className="flex items-center justify-end gap-2">
                              <ApproveButton candidateId={c.id} />
                              <DismissButton candidateId={c.id} />
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
