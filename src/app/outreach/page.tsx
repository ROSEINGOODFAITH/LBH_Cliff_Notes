import { requireTeamMember } from "@/lib/auth";
import { AppNav } from "@/components/app-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listCreators } from "@/lib/creators";
import { listCampaigns, listDrafts } from "@/lib/outreach";
import { anthropicConfigured } from "@/lib/anthropic";
import { gmailConfigured } from "@/lib/gmail";
import { CreateCampaignForm, GenerateForm, DraftCard } from "./outreach-forms";

export const dynamic = "force-dynamic";

export default async function OutreachPage() {
  const team = await requireTeamMember();
  const [creators, campaigns, drafts] = await Promise.all([
    listCreators({ limit: 200 }),
    listCampaigns(),
    listDrafts(),
  ]);
  const aiOn = anthropicConfigured();
  const gmailOn = gmailConfigured();
  const draftItems = drafts.filter((d) => d.draft);

  return (
    <div className="min-h-screen">
      <AppNav active="/outreach" email={team.email} />
      <main className="container space-y-6 py-8">
        {(!aiOn || !gmailOn) && (
          <div className="rounded-md border border-border bg-secondary/40 px-4 py-2 text-xs text-muted-foreground">
            {!aiOn && (
              <>
                Add <code>ANTHROPIC_API_KEY</code> to generate drafts.{" "}
              </>
            )}
            {!gmailOn && (
              <>
                Add <code>GMAIL_*</code> to send. Drafts are always shown for approval before sending.
              </>
            )}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">New campaign</CardTitle>
            </CardHeader>
            <CardContent>
              <CreateCampaignForm />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Generate outreach</CardTitle>
            </CardHeader>
            <CardContent>
              <GenerateForm
                creators={creators.map((c) => ({ id: c.id, handle: c.handle, email: c.email }))}
                campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
                disabled={!aiOn}
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Drafts awaiting approval · {draftItems.length}
          </h2>
          {draftItems.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                No drafts yet. Pick a creator above and generate one.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {draftItems.map((d) => (
                <DraftCard
                  key={d.thread.id}
                  threadId={d.thread.id}
                  creatorId={d.thread.creatorId}
                  campaignId={d.thread.campaignId}
                  handle={d.creatorHandle}
                  email={d.creatorEmail}
                  subject={d.thread.subject}
                  body={d.draft?.body ?? ""}
                  generateDisabled={!aiOn}
                  sendDisabled={!gmailOn}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
