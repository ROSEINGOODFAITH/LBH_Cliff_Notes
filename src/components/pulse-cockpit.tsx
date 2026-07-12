"use client";
import { useEffect, useState } from "react";
import { ArrowRight, AlertTriangle, ChevronDown, Zap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/* PULSE launch cockpit — the "what do I do next" layer above the belt.
 * Reads /api/pulse/cockpit (phase state, readiness, bottlenecks, one Next Best
 * Action, funnel + conversion, rings, metrics, automations). Presentational;
 * all human decisions still happen in the belt below. */

type Cockpit = {
  currentPhase: string;
  readiness: number;
  daysToLaunch: number | null;
  totals: { discovered: number; inMotion: number; posted: number };
  checklist: Array<{ phase: string; label: string; count: number; state: string; owner: string; href: string; blocker: string | null }>;
  bottlenecks: Array<{ phase: string; label: string; count: number; detail: string }>;
  nextBestAction: { label: string; detail: string; href: string; phase: string };
  funnel: Array<{ key: string; label: string; count: number; conversion: number | null }>;
};
type Ring = { key: string; label: string; job: string; nextAction: string; audienceHint: string; count: number };
type Automation = { id: string; label: string; category: string; trigger: string; action: string; approvalRequired: boolean; autoSendsExternal: boolean; delay: string; enabled: boolean; notes?: string };
type Metrics = {
  acceptanceRate: number | null; sampleToPostRate: number | null; usableCreativeRate: number | null;
  buyingIntentSignal: number; attributedFirstOrders: number; attributedRevenueCents: number; repeatPostingRate: number | null;
};
type CockpitData = { cockpit: Cockpit; rings: Ring[]; metrics: Metrics; automations: Automation[] };

const PHASE_ORDER = ["define", "discover", "qualify", "invite", "gift", "delivered", "content", "amplify", "retain"];
const PHASE_LABEL: Record<string, string> = {
  define: "Define", discover: "Discover", qualify: "Qualify", invite: "Invite", gift: "Gift",
  delivered: "Delivered", content: "Content", amplify: "Amplify", retain: "Retain",
};

const stateDot: Record<string, string> = {
  done: "bg-success", active: "bg-pulse-lycra", blocked: "bg-warning", upcoming: "bg-muted-foreground/40",
};

export function PulseCockpit() {
  const [data, setData] = useState<CockpitData | null>(null);
  const [err, setErr] = useState(false);
  const [showAuto, setShowAuto] = useState(false);
  const [showRings, setShowRings] = useState(false);

  useEffect(() => {
    fetch("/api/pulse/cockpit")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setErr(true));
  }, []);

  if (err) return null; // fail-soft: the belt below still works
  if (!data) {
    return <div className="h-40 animate-pulse rounded-cell bg-card" aria-hidden />;
  }

  const { cockpit, rings, metrics, automations } = data;
  const nba = cockpit.nextBestAction;
  const pct = (v: number | null) => (v == null ? "—" : `${v}%`);

  return (
    <section className="space-y-4" data-testid="pulse-cockpit">
      {/* ---- campaign header ---- */}
      <Card className="overflow-hidden">
        <div className="pulse-wash">
          <div className="pulse-spots" aria-hidden>
            <CardContent className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-pulse-coral">PULSE launch</span>
                    {cockpit.daysToLaunch != null && (
                      <span className="text-[11px] text-muted-foreground">
                        {cockpit.daysToLaunch > 0 ? `${cockpit.daysToLaunch} days to launch` : "launched"}
                      </span>
                    )}
                  </div>
                  <h2 className="mt-1 text-xl font-semibold tracking-[-0.02em]">
                    Phase: {PHASE_LABEL[cockpit.currentPhase] ?? cockpit.currentPhase}
                  </h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {cockpit.totals.discovered} discovered · {cockpit.totals.inMotion} in motion · {cockpit.totals.posted} posted
                  </p>
                </div>
                <Readiness value={cockpit.readiness} />
              </div>

              {/* phase progress rail */}
              <div className="mt-5 flex flex-wrap gap-1.5" data-testid="cockpit-phases">
                {PHASE_ORDER.map((p) => {
                  const item = cockpit.checklist.find((c) => c.phase === p);
                  const isCurrent = p === cockpit.currentPhase;
                  return (
                    <div
                      key={p}
                      title={item?.blocker ?? item?.label ?? PHASE_LABEL[p]}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                        isCurrent ? "border-pulse-lycra/50 bg-pulse-lycra/10 text-foreground" : "border-border text-muted-foreground",
                      )}
                    >
                      <span className={cn("size-1.5 rounded-full", stateDot[item?.state ?? "upcoming"])} />
                      {PHASE_LABEL[p]}
                      {item && item.count > 0 && <span className="tnum opacity-70">{item.count}</span>}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </div>
        </div>
      </Card>

      {/* ---- next best action ---- */}
      <a href={nba.href} className="block" data-testid="cockpit-nba">
        <Card className="bento-hover">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Zap className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Next best action</div>
              <div className="truncate text-base font-semibold">{nba.label}</div>
              <div className="truncate text-sm text-muted-foreground">{nba.detail}</div>
            </div>
            <ArrowRight className="size-5 shrink-0 text-muted-foreground" />
          </CardContent>
        </Card>
      </a>

      {/* ---- bottlenecks ---- */}
      {cockpit.bottlenecks.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="cockpit-bottlenecks">
          {cockpit.bottlenecks.map((b) => (
            <a key={b.phase} href={cockpit.checklist.find((c) => c.phase === b.phase)?.href ?? "/pulse"}>
              <Badge variant="warning" className="gap-1.5 py-1">
                <AlertTriangle className="size-3" /> {b.label}: {b.detail}
              </Badge>
            </a>
          ))}
        </div>
      )}

      {/* ---- funnel + conversions ---- */}
      <Card>
        <CardContent className="p-5">
          <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Funnel & conversion</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="cockpit-funnel">
            {cockpit.funnel.map((f) => (
              <div key={f.key}>
                <div className="text-2xl font-semibold tnum">{f.count}</div>
                <div className="text-xs text-muted-foreground">{f.label}</div>
                {f.conversion != null && (
                  <div className="mt-0.5 text-[11px] font-medium text-pulse-lycra tnum">{Math.round(f.conversion * 100)}%</div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ---- performance metrics ---- */}
      <Card>
        <CardContent className="p-5">
          <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Performance</div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" data-testid="cockpit-metrics">
            <Metric label="Acceptance rate" value={pct(metrics.acceptanceRate)} hint="Replied ÷ invited" />
            <Metric label="Sample → post" value={pct(metrics.sampleToPostRate)} hint="Posted ÷ shipped" />
            <Metric label="Usable creative" value={pct(metrics.usableCreativeRate)} hint="Approved-for-use posts" />
            <Metric label="Attributed orders" value={String(metrics.attributedFirstOrders)} hint="From creator codes" />
          </div>
        </CardContent>
      </Card>

      {/* ---- rings ---- */}
      <Card>
        <CardContent className="p-5">
          <button onClick={() => setShowRings((v) => !v)} className="flex w-full items-center justify-between" data-testid="cockpit-rings-toggle">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Creator rings</span>
            <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", showRings && "rotate-180")} />
          </button>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="cockpit-rings">
            {rings.map((r) => (
              <div key={r.key} className="rounded-panel border border-border p-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{r.label}</span>
                  <span className="tnum text-lg font-semibold text-primary">{r.count}</span>
                </div>
                <div className="text-[11px] text-muted-foreground">{r.audienceHint}</div>
                {showRings && (
                  <>
                    <p className="mt-2 text-xs text-muted-foreground">{r.job}</p>
                    <p className="mt-2 text-xs"><span className="text-pulse-coral">Next:</span> {r.nextAction}</p>
                  </>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ---- automation control center ---- */}
      <Card>
        <CardContent className="p-5">
          <button onClick={() => setShowAuto((v) => !v)} className="flex w-full items-center justify-between" data-testid="cockpit-automations-toggle">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Automations · {automations.filter((a) => a.enabled).length} on
            </span>
            <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", showAuto && "rotate-180")} />
          </button>
          {showAuto && (
            <div className="mt-3 divide-y divide-border/60" data-testid="cockpit-automations">
              {automations.map((a) => (
                <div key={a.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{a.label}</span>
                      <Badge variant={a.enabled ? "success" : "secondary"}>{a.enabled ? "on" : "off"}</Badge>
                      {a.approvalRequired && <Badge variant="outline">needs approval</Badge>}
                      {a.autoSendsExternal ? (
                        <Badge variant="warning">auto-sends</Badge>
                      ) : (
                        <Badge variant="outline">no auto-send</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <span className="text-foreground">When</span> {a.trigger} · <span className="text-foreground">then</span> {a.action}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{a.delay}{a.notes ? ` — ${a.notes}` : ""}</p>
                  </div>
                </div>
              ))}
              <p className="pt-3 text-[11px] text-muted-foreground">
                Auto-send stays off unless a step rides a governed mechanism. Money never moves automatically — payouts are approval records only.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function Readiness({ value }: { value: number }) {
  const r = 26;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - value / 100);
  return (
    <div className="flex items-center gap-3" data-testid="cockpit-readiness">
      <svg width="64" height="64" viewBox="0 0 64 64" className="-rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="hsl(var(--secondary))" strokeWidth="6" />
        <circle
          cx="32" cy="32" r={r} fill="none" stroke="hsl(var(--pulse-lycra))" strokeWidth="6"
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 600ms cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <div>
        <div className="text-2xl font-semibold tnum">{value}%</div>
        <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Readiness</div>
      </div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <div className="text-xl font-semibold tnum">{value}</div>
      <div className="text-xs font-medium">{label}</div>
      <div className="text-[11px] text-muted-foreground">{hint}</div>
    </div>
  );
}
