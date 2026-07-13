import { AppNav } from "@/components/app-nav";
import { Mail, ShoppingBag, Sparkles, CheckCircle2, Circle } from "lucide-react";
import { requireTeamMember } from "@/lib/auth";
import { integrations } from "@/lib/env";
import { getFunnelCounts } from "@/lib/analytics";
import { formatUSD } from "@/lib/utils";
import { BentoGrid, BentoCell, StatTile } from "@/components/bento";
import { Funnel } from "@/components/funnel";

export const dynamic = "force-dynamic";

function readIntegrations() {
  try {
    return {
      shopify: integrations.shopify(),
      anthropic: integrations.anthropic(),
      gmail: integrations.gmail(),
    };
  } catch {
    return null;
  }
}

const ROADMAP = [
  { id: "P0", label: "Foundation", done: true },
  { id: "P1", label: "Creator DB & discovery", done: true },
  { id: "P2", label: "AI outreach + inbox", done: true },
  { id: "P3", label: "Affiliates + attribution", done: true },
  { id: "P4", label: "Content + analytics", done: true },
  { id: "P5", label: "Polish / production", done: true },
];

export default async function DashboardPage() {
  const team = await requireTeamMember();
  const ints = readIntegrations();
  const funnel = await getFunnelCounts().catch(() => null);

  const integrationCards = [
    { key: "shopify", name: "Shopify", icon: ShoppingBag, on: ints?.shopify },
    { key: "anthropic", name: "Claude", icon: Sparkles, on: ints?.anthropic },
    { key: "gmail", name: "Gmail", icon: Mail, on: ints?.gmail },
  ];
  const n = (v: number | undefined): string => (funnel && v != null ? String(v) : "—");

  return (
    <div className="min-h-screen">
      <AppNav active="/" email={team.email} />
      <main className="container space-y-5 py-8">
        <BentoGrid>
          {/* Hero — attributed revenue */}
          <BentoCell span={6} mobile={2} className="flex min-h-[180px] flex-col justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              Attributed revenue
            </div>
            <div>
              <div className="text-5xl font-semibold tnum tracking-[-0.03em] text-primary">
                {funnel ? formatUSD(funnel.revenueCents) : "—"}
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                {funnel
                  ? `${funnel.orders} attributed order${funnel.orders === 1 ? "" : "s"}`
                  : "Connect data to see revenue"}
              </div>
            </div>
          </BentoCell>
          <StatTile span={3} label="Active" value={n(funnel?.active)} sub="creators" />
          <StatTile span={3} label="Orders" value={n(funnel?.orders)} sub="attributed" />

          {/* Pipeline funnel — shape/labels come solely from canonical lifecycle */}
          <BentoCell span={12} mobile={2}>
            <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              Pipeline
            </div>
            <Funnel counts={funnel} />
          </BentoCell>
        </BentoGrid>

        <BentoGrid>
          {/* Data sources */}
          <BentoCell span={7} mobile={2}>
            <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              Data sources
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {integrationCards.map((c) => (
                <div
                  key={c.key}
                  className="flex items-center justify-between rounded-ctrl bg-secondary/50 px-3 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    <c.icon className="size-4 text-muted-foreground" />
                    <span className="text-sm">{c.name}</span>
                  </div>
                  <span className={`size-2 rounded-full ${c.on ? "bg-success" : "bg-muted-foreground/40"}`} />
                </div>
              ))}
            </div>
            <div className="mt-4 text-xs text-muted-foreground">
              Shopify connection:{" "}
              <a href="/api/shopify/ping" target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
                run test →
              </a>
            </div>
          </BentoCell>

          {/* Build roadmap */}
          <BentoCell span={5} mobile={2}>
            <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              Build status
            </div>
            <div className="space-y-2.5">
              {ROADMAP.map((p) => (
                <div key={p.id} className="flex items-center gap-3 text-sm">
                  {p.done ? (
                    <CheckCircle2 className="size-4 text-success" />
                  ) : (
                    <Circle className="size-4 text-muted-foreground/50" />
                  )}
                  <span className="w-7 font-mono text-xs text-muted-foreground">{p.id}</span>
                  <span className="text-foreground">{p.label}</span>
                </div>
              ))}
            </div>
          </BentoCell>
        </BentoGrid>
      </main>
    </div>
  );
}
