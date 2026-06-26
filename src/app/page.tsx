import { AppNav } from "@/components/app-nav";
import {
  Search,
  Mail,
  Users,
  Link2,
  Image as ImageIcon,
  BarChart3,
  ShoppingBag,
  Sparkles,
  CheckCircle2,
  Circle,
  type LucideIcon,
} from "lucide-react";
import { requireTeamMember } from "@/lib/auth";
import { integrations } from "@/lib/env";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

function readIntegrations() {
  try {
    return {
      shopify: integrations.shopify(),
      modash: integrations.modash(),
      anthropic: integrations.anthropic(),
      gmail: integrations.gmail(),
    };
  } catch {
    return null;
  }
}

const FUNNEL = [
  { label: "Discovered", icon: Search },
  { label: "Contacted", icon: Mail },
  { label: "Replied", icon: Users },
  { label: "Active", icon: Sparkles },
  { label: "Posted", icon: ImageIcon },
  { label: "Orders", icon: ShoppingBag },
  { label: "Revenue", icon: BarChart3 },
];

const ROADMAP = [
  { id: "P0", label: "Foundation — scaffold, schema, auth, Shopify", state: "current" },
  { id: "P1", label: "Creator DB — discovery, enrichment, search", state: "next" },
  { id: "P2", label: "AI Outreach — drafts, send, reply sync, inbox", state: "todo" },
  { id: "P3", label: "Affiliates — codes + order attribution", state: "todo" },
  { id: "P4", label: "Content tracking + funnel analytics", state: "todo" },
  { id: "P5", label: "TikTok Shop + polish + hardening", state: "todo" },
];

export default async function DashboardPage() {
  const team = await requireTeamMember();
  const ints = readIntegrations();

  const integrationCards: {
    key: string;
    name: string;
    icon: LucideIcon;
    on: boolean | undefined;
    test?: string;
  }[] = [
    { key: "shopify", name: "Shopify", icon: ShoppingBag, on: ints?.shopify, test: "/api/shopify/ping" },
    { key: "modash", name: "Modash", icon: Search, on: ints?.modash },
    { key: "anthropic", name: "Claude (AI)", icon: Sparkles, on: ints?.anthropic },
    { key: "gmail", name: "Gmail", icon: Mail, on: ints?.gmail },
  ];

  return (
    <div className="min-h-screen">
      <AppNav active="/" email={team.email} />

      <main className="container space-y-8 py-8">
        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Data sources
          </h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {integrationCards.map((c) => (
              <Card key={c.key}>
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <c.icon className="size-4 text-muted-foreground" />
                    <div>
                      <div className="text-sm font-medium">{c.name}</div>
                      {c.test && c.on ? (
                        <a
                          href={c.test}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                        >
                          Test connection →
                        </a>
                      ) : (
                        <div className="text-xs text-muted-foreground">
                          {c.on == null ? "Status unknown" : c.on ? "Ready" : "Not configured"}
                        </div>
                      )}
                    </div>
                  </div>
                  <Badge variant={c.on ? "success" : "secondary"}>{c.on ? "Connected" : "Off"}</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Funnel
            </h2>
            <span className="text-xs text-muted-foreground">
              Lights up as Modules A–E come online — no placeholder numbers.
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {FUNNEL.map((f) => (
              <Card key={f.label}>
                <CardContent className="p-4">
                  <f.icon className="mb-2 size-4 text-muted-foreground" />
                  <div className="text-2xl font-semibold tabular-nums">—</div>
                  <div className="text-xs text-muted-foreground">{f.label}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Build roadmap</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {ROADMAP.map((p) => (
                <div key={p.id} className="flex items-center gap-3 text-sm">
                  {p.state === "current" ? (
                    <CheckCircle2 className="size-4 text-success" />
                  ) : (
                    <Circle className="size-4 text-muted-foreground" />
                  )}
                  <span className="w-8 font-mono text-xs text-muted-foreground">{p.id}</span>
                  <span className={p.state === "current" ? "font-medium" : "text-muted-foreground"}>
                    {p.label}
                  </span>
                  {p.state === "current" && (
                    <Badge variant="outline" className="ml-auto">
                      In progress
                    </Badge>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
