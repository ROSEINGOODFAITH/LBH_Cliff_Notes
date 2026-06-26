import { requireTeamMember } from "@/lib/auth";
import { AppNav } from "@/components/app-nav";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { listInbox } from "@/lib/outreach";
import { gmailConfigured } from "@/lib/gmail";
import { SyncNowButton, FollowUpButton } from "./inbox-forms";

export const dynamic = "force-dynamic";

const LABEL_VARIANT: Record<string, BadgeProps["variant"]> = {
  interested: "success",
  needs_follow_up: "warning",
  maybe: "secondary",
  ooo: "outline",
  not_interested: "destructive",
};

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default async function InboxPage() {
  const team = await requireTeamMember();
  const items = await listInbox();
  const gmailOn = gmailConfigured();

  return (
    <div className="min-h-screen">
      <AppNav active="/inbox" email={team.email} />
      <main className="container space-y-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-sm font-semibold">Priority inbox</h1>
            <p className="text-xs text-muted-foreground">Hottest replies first. {items.length} active thread(s).</p>
          </div>
          <SyncNowButton disabled={!gmailOn} />
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="p-3 font-medium">Creator</th>
                    <th className="p-3 font-medium">Interest</th>
                    <th className="p-3 font-medium">Latest reply</th>
                    <th className="p-3 font-medium">When</th>
                    <th className="p-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-sm text-muted-foreground">
                        No threads yet. Send outreach, then sync replies here.
                      </td>
                    </tr>
                  ) : (
                    items.map((it) => {
                      const label = it.thread.aiInterestLabel;
                      const rationale = (it.latestInbound?.classificationJson as { rationale?: string } | null)?.rationale;
                      const preview = it.latestInbound?.body ?? (it.thread.status === "awaiting_reply" ? "Sent — awaiting reply" : "—");
                      return (
                        <tr key={it.thread.id} className="border-b border-border/60 align-top last:border-0">
                          <td className="p-3">
                            <div className="font-medium">@{it.creatorHandle}</div>
                            <div className="text-xs text-muted-foreground">{it.creatorEmail ?? ""}</div>
                          </td>
                          <td className="p-3">
                            {label ? (
                              <Badge variant={LABEL_VARIANT[label] ?? "outline"}>{label.replace(/_/g, " ")}</Badge>
                            ) : (
                              <Badge variant="outline">{it.thread.status.replace(/_/g, " ")}</Badge>
                            )}
                          </td>
                          <td className="max-w-[420px] p-3">
                            <div className="line-clamp-2 text-muted-foreground">{preview}</div>
                            {rationale && <div className="mt-1 text-xs text-muted-foreground/70">AI: {rationale}</div>}
                          </td>
                          <td className="p-3 text-xs text-muted-foreground">{fmtDate(it.thread.lastMessageAt)}</td>
                          <td className="p-3 text-right">
                            <FollowUpButton creatorId={it.thread.creatorId} campaignId={it.thread.campaignId} />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
