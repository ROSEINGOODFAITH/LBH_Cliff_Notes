import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { requireTeamMember } from "@/lib/auth";
import { AppNav } from "@/components/app-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StageBadge } from "@/components/stage-badge";
import { RelationshipBadge } from "@/components/relationship-badge";
import { RelationshipEditor } from "./relationship-editor";
import { ActivityTimeline } from "@/components/activity-timeline";
import { getCreator } from "@/lib/creators";
import { getCreatorActivity } from "@/lib/activity";
import { db } from "@/db";
import { creatorSocials } from "@/db/schema";
import { formatCompact } from "@/lib/utils";

export const dynamic = "force-dynamic";

function fmtER(er: number | null): string {
  return er != null ? `${(er * 100).toFixed(1)}%` : "—";
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

export default async function CreatorProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const team = await requireTeamMember();
  const { id } = await params;
  const creator = await getCreator(id);
  if (!creator) notFound();

  const [socials, activity] = await Promise.all([
    db.select().from(creatorSocials).where(eq(creatorSocials.creatorId, id)),
    getCreatorActivity(id),
  ]);

  const shipping = (creator.rawModash as { shipping?: Record<string, string> } | null)?.shipping ?? null;

  return (
    <div className="min-h-screen">
      <AppNav active="/creators" email={team.email} />
      <main className="container space-y-6 py-8">
        <Link
          href="/creators"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to creators
        </Link>

        {/* Identity header */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-[-0.02em]">@{creator.handle}</h1>
              <StageBadge stage={creator.stage} />
              <RelationshipBadge tier={creator.relationshipTier} />
              {creator.tier && <Badge variant="outline">Tier {creator.tier}</Badge>}
              {creator.primaryPlatform && <Badge variant="secondary">{creator.primaryPlatform}</Badge>}
            </div>
            {creator.displayName && (
              <div className="mt-1 text-sm text-muted-foreground">{creator.displayName}</div>
            )}
            <div className="mt-3">
              <RelationshipEditor creatorId={creator.id} initialTier={creator.relationshipTier} />
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {/* Identity + social */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Identity</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Row label="Email">{creator.email ?? "—"}</Row>
              <Row label="IG handle">{creator.igHandle ? `@${creator.igHandle}` : "—"}</Row>
              <Row label="Followers">{formatCompact(creator.followerCount)}</Row>
              <Row label="Engagement">{fmtER(creator.engagementRate)}</Row>
              <Row label="Niche">{creator.niche ?? creator.nicheTags?.[0] ?? "—"}</Row>
              <Row label="Source">{creator.source}</Row>
              {socials.length > 0 && (
                <div className="mt-3 space-y-1.5 border-t border-border/60 pt-3">
                  {socials.map((s) => (
                    <div key={s.id} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{s.platform}</span>
                      {s.url ? (
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          @{s.handle} <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        <span>@{s.handle}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Fulfillment / address */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Fulfillment</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Row label="Discount code">{creator.discountCode ?? "—"}</Row>
              <Row label="Draft order">{creator.shopifyDraftOrderId ?? "—"}</Row>
              <Row label="Tracking">{creator.trackingNumber ?? "—"}</Row>
              {shipping ? (
                <div className="mt-3 border-t border-border/60 pt-3 text-sm text-muted-foreground">
                  {shipping.first_name && <div>{shipping.first_name}</div>}
                  <div>{shipping.address1}</div>
                  <div>
                    {[shipping.city, shipping.province, shipping.zip].filter(Boolean).join(", ")}
                  </div>
                  {shipping.country && <div>{shipping.country}</div>}
                </div>
              ) : (
                <div className="mt-3 border-t border-border/60 pt-3 text-sm text-muted-foreground">
                  No address on file.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Content + notes */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Content</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Row label="Post">
                {creator.postUrl ? (
                  <a
                    href={creator.postUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    view <ExternalLink className="size-3" />
                  </a>
                ) : (
                  "—"
                )}
              </Row>
              <Row label="Verified">
                {creator.postVerifiedAt
                  ? new Date(creator.postVerifiedAt).toLocaleDateString("en-US")
                  : "—"}
              </Row>
              <Row label="Disclosure OK">
                {creator.disclosureOk == null ? "—" : creator.disclosureOk ? "Yes" : "No"}
              </Row>
              {creator.notes && (
                <div className="mt-3 border-t border-border/60 pt-3 text-sm text-muted-foreground">
                  {creator.notes}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Activity timeline */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityTimeline items={activity} />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
