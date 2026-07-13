"use client";
import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { AppNav } from "@/components/app-nav";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, fieldClass } from "@/components/ui/input";
import { StageBadge } from "@/components/stage-badge";
import { PulseCockpit } from "@/components/pulse-cockpit";
import { cn } from "@/lib/utils";

/* PULSE — one screen: what needs you, what's moving, add more.
 * Mental model: a conveyor belt that stops at your desk twice —
 * once to ask "in or out?", once to ask "pay them?". */

const profileUrl = (c: any) =>
  c?.primaryPlatform === "instagram"
    ? `https://www.instagram.com/${c.handle}`
    : `https://www.tiktok.com/@${c.handle}`;

/* The belt: plain-word stations over internal stages. `stage` is the canonical
 * stage a station maps to, so StageBadge stays consistent with the rest of the app. */
const BELT = [
  { key: "sourced", stage: "sourced", label: "Found", auto: "We pull their profile and rank them for you — nothing to do here." },
  { key: "review", stage: "review", label: "Your call", auto: "Waiting on you — decide at the top of this page." },
  { key: "contacted", stage: "contacted", label: "Invited", auto: "Invite email sent. We watch for their reply." },
  { key: "replied", stage: "replied", label: "Replied", auto: "They have the address form. When it comes back, shipping starts." },
  { key: "shipping", stage: "shipped", label: "Shipping", auto: "Order placed. We check tracking every hour and email them when it ships." },
  { key: "posted", stage: "posted", label: "Posted", auto: "Post is live. Gifts finish here; paid reviews come to you for payment approval." },
  { key: "paid", stage: "paid", label: "Done", auto: "Finished and counted toward the goal." },
] as const;

/* Model features, in plain words (shown only inside "How ranking works"). */
const FEATURE_NAMES: Record<string, string> = {
  er_high: "High engagement (>5%)", er_mid: "Engagement 3–5%", micro: "Under 50k followers",
  mid: "50–200k followers", macro: "Over 200k followers", fake_low: "Few fake followers",
  us: "US audience", aesthetic: "Brand fit", views_ratio: "Views vs followers",
  n_fragrance: "Fragrance niche", n_beauty: "Beauty niche", n_lifestyle: "Lifestyle niche",
  n_grwm: "GRWM niche", n_fitness: "Fitness niche", n_fashion: "Fashion niche",
  n_skincare: "Skincare niche", n_unboxing: "Unboxing niche",
};

export default function PulsePage() {
  const [queue, setQueue] = useState<any[]>([]);
  const [dash, setDash] = useState<any>(null);
  const [flash, setFlash] = useState("");
  const [skippedPayouts, setSkippedPayouts] = useState<string[]>([]);
  const [emailDraft, setEmailDraft] = useState("");
  const [openStation, setOpenStation] = useState<string | null>(null);
  const [stationRows, setStationRows] = useState<Record<string, any[]>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [showRanking, setShowRanking] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMode, setImportMode] = useState<"prospects" | "contacts">("prospects");
  const [importPlatform, setImportPlatform] = useState<"tiktok" | "instagram">("tiktok");
  const [contactTier, setContactTier] = useState<"B" | "A">("B");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [q, d] = await Promise.all([
      fetch("/api/pulse/queue").then(r => r.json()),
      fetch("/api/pulse/dashboard").then(r => r.json()),
    ]);
    setQueue(q); setDash(d); setStationRows({}); setOpenStation(null); setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const next = queue[0];
  useEffect(() => { setEmailDraft(""); }, [next?.id]);

  const [flashKind, setFlashKind] = useState<"ok" | "err">("ok");
  const say = (msg: string, ms = 4000, kind: "ok" | "err" = "ok") => { setFlash(msg); setFlashKind(kind); setTimeout(() => setFlash(""), ms); };

  const decide = async (c: any, action: string) => {
    setQueue(q => q.filter(x => x.id !== c.id)); // optimistic
    say(action === "reject" ? `Passed on @${c.handle} — the ranking learns from it.` : `@${c.handle} will be invited.`, 2500);
    await fetch("/api/pulse/decision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creatorId: c.id, action }) });
    load();
  };

  const saveEmail = async () => {
    if (!next || !emailDraft.trim()) return;
    const r = await fetch("/api/pulse/creator", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creatorId: next.id, email: emailDraft.trim() }) });
    const j = await r.json().catch(() => ({}));
    say(r.ok ? `Email saved for @${next.handle}.` : (j.error ?? "That email didn't save — check it and try again."), 4000, r.ok ? "ok" : "err");
    if (r.ok) { setEmailDraft(""); load(); }
  };

  const approvePayout = async (p: any) => {
    setSkippedPayouts(s => [...s, p.id]); // optimistic removal
    say(`Recorded — you approved $${p.amountUsd} for @${p.handle}. The transfer happens in your payment app.`, 5000);
    await fetch("/api/pulse/payout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payoutId: p.id, approve: true }) });
    load();
  };

  const openBelt = async (key: string) => {
    if (openStation === key) { setOpenStation(null); return; }
    setOpenStation(key);
    if (!stationRows[key]) {
      const r = await fetch(`/api/pulse/stage?station=${key}`).then(x => x.json()).catch(() => ({ creators: [] }));
      setStationRows(s => ({ ...s, [key]: r.creators ?? [] }));
    }
  };

  /* ---------- import parsing (handles list, CSV, or name+email lines) ---------- */
  const parseImport = (text: string): any[] => {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return [];
    const delim = lines[0].includes("\t") ? "\t" : ",";
    const split = (line: string) => line
      .split(new RegExp(`${delim === "\t" ? "\\t" : ","}(?=(?:[^"]*"[^"]*")*[^"]*$)`))
      .map(c => c.replace(/^"+|"+$/g, "").trim());
    const header = split(lines[0]).map(h => h.toLowerCase());
    const isCsv = header.length > 1 && header.some(h => /user|handle|follower|engagement|view|email/.test(h));
    if (!isCsv) return text.split(/[\s,;]+/).filter(Boolean).map(handle => ({ handle }));
    const col = (re: RegExp) => header.findIndex(h => re.test(h));
    const iH = (() => { const a = col(/tiktok|instagram|handle|user ?name|^user$/); return a >= 0 ? a : col(/name/); })();
    const iF = col(/follower/), iE = col(/engagement/), iV = col(/view/), iM = col(/e-?mail/);
    const iG = col(/country|geo|location/), iFake = col(/fake/), iCred = col(/credib/);
    const toNum = (s?: string): number | null => {
      if (!s) return null;
      const m = s.replace(/[,\s"]/g, "").match(/^([0-9.]+)([kmKM%])?$/);
      if (!m) return null;
      let n = parseFloat(m[1]); if (Number.isNaN(n)) return null;
      const u = (m[2] || "").toLowerCase();
      if (u === "k") n *= 1e3; if (u === "m") n *= 1e6;
      return n;
    };
    return lines.slice(1).map(line => {
      const c = split(line);
      const erRaw = iE >= 0 ? c[iE] : undefined;
      let er = toNum(erRaw);
      if (er != null && ((erRaw ?? "").includes("%") || er > 1)) er = er / 100;
      const cred = iCred >= 0 ? toNum(c[iCred]) : null;
      // Enrichment cells can hold several emails — capture all of them.
      const allEmails = (iM >= 0 ? (c[iM] ?? "") : line).match(/[^\s@,;"<>]+@[^\s@,;"<>]+\.[^\s@,;"<>]+/g) ?? [];
      return {
        handle: iH >= 0 ? c[iH] : c[0],
        followerCount: iF >= 0 ? toNum(c[iF]) : null,
        engagementRate: er,
        avgViews: iV >= 0 ? toNum(c[iV]) : null,
        fakeFollowerPct: iFake >= 0 ? toNum(c[iFake]) : (cred != null && cred <= 1 ? (1 - cred) * 100 : null),
        geo: iG >= 0 ? (c[iG] || null) : null,
        email: allEmails[0] ?? null,
        emails: allEmails.length > 1 ? allEmails : undefined,
      };
    }).filter(r => r.handle);
  };

  const parseContacts = (text: string): any[] => {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return [];
    const emailRe = /[^\s@,<>;"]+@[^\s@,<>;"]+\.[^\s@,<>;"]+/;
    const delim = lines[0].includes("\t") ? "\t" : ",";
    const split = (line: string) => line
      .split(new RegExp(`${delim === "\t" ? "\\t" : ","}(?=(?:[^"]*"[^"]*")*[^"]*$)`))
      .map(c => c.replace(/^"+|"+$/g, "").trim());
    const header = split(lines[0]).map(h => h.toLowerCase());
    const hasHeader = !emailRe.test(lines[0]) && header.some(h => /e-?mail/.test(h));
    if (hasHeader) {
      const col = (re: RegExp) => header.findIndex(h => re.test(h));
      const iN = col(/name/), iM = col(/e-?mail/), iH = col(/handle|user|tiktok|instagram/);
      return lines.slice(1).map(line => {
        const c = split(line);
        return { name: iN >= 0 ? c[iN] || null : null, email: iM >= 0 ? c[iM] || null : null, handle: iH >= 0 ? c[iH] || null : null };
      }).filter(r => r.email);
    }
    return lines.map(l => {
      const email = l.match(emailRe)?.[0] ?? null;
      const name = l.replace(emailRe, "").replace(/[<>,;"]/g, " ").replace(/\s+/g, " ").trim() || null;
      return { name, email };
    }).filter(r => r.email);
  };

  const runImport = async () => {
    const rows = importMode === "contacts"
      ? parseContacts(importText).map(r => ({ ...r, tier: contactTier }))
      : parseImport(importText).map(r => ({ ...r, platform: importPlatform }));
    if (!rows.length || importing) return;
    setImporting(true);
    try {
      const r = await fetch("/api/pulse/source", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: importMode, rows }) });
      const j = await r.json();
      say(r.ok
        ? (importMode === "contacts"
          ? `Added ${j.queued} to the belt at Replied.${j.duplicates ? ` ${j.duplicates} were already here.` : ""}`
          : `${j.queued + (j.requeued ?? 0)} on the belt — they'll reach "Your call" shortly.${j.duplicates ? ` ${j.duplicates} were already here.` : ""}`)
        : (j.error ?? "That didn't import — check the format."), 6000, r.ok ? "ok" : "err");
      if (r.ok) { setImportText(""); setShowAdd(false); }
    } catch { say("That didn't import — check the format.", 4000, "err"); }
    setImporting(false);
    load();
  };

  /* ------------------------------ derived state ------------------------------ */
  const counts = useMemo(() => Object.fromEntries((dash?.stageCounts ?? []).map((s: any) => [s.stage, Number(s.n)])), [dash]);
  const beltCount = (key: string) => key === "shipping" ? (counts.onboarded ?? 0) + (counts.shipped ?? 0) : key === "review" ? queue.length : (counts[key] ?? 0);
  const payoutsDue = (dash?.pendingPayouts ?? []).filter((p: any) => !skippedPayouts.includes(p.id));
  const needsYou = queue.length + payoutsDue.length;
  const inMotion = (counts.sourced ?? 0) + (counts.contacted ?? 0) + (counts.replied ?? 0) + (counts.onboarded ?? 0) + (counts.shipped ?? 0);
  const postedTotal = (counts.posted ?? 0) + (counts.paid ?? 0);
  const topWeights = useMemo(() => Object.entries((dash?.model?.weights ?? {}) as Record<string, number>)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 6), [dash]);
  const payout = payoutsDue[0];

  const statusLine = !dash
    ? "Loading…"
    : needsYou > 0
      ? [
          queue.length ? `${queue.length} creator${queue.length === 1 ? "" : "s"} waiting for your call` : null,
          payoutsDue.length ? `${payoutsDue.length} payment${payoutsDue.length === 1 ? "" : "s"} to approve` : null,
        ].filter(Boolean).join(" and ") + ". Everything else is moving."
      : `Nothing needs you. ${inMotion} in motion, ${postedTotal} posted.`;

  const hasAddress = Boolean((next as any)?.sourceMetadata?.shipping);
  const canDecide = Boolean(next?.email || hasAddress);
  const cardStats = next ? [
    ["Followers", next.followerCount != null ? Number(next.followerCount).toLocaleString() : null],
    ["Engagement", next.engagementRate != null ? (next.engagementRate * 100).toFixed(1) + "%" : null],
    ["Avg views", next.avgViews != null ? Number(next.avgViews).toLocaleString() : null],
    ["Email", next.email],
  ].filter(([, v]) => v != null && v !== "") : [];

  const Goal = ({ label, g }: { label: string; g: { current: number; target: number } }) => (
    <div className="min-w-[120px] flex-1">
      <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
        <span>{label}</span>
        <span className="tnum">{g.current}/{g.target}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: Math.min(100, (g.current / g.target) * 100) + "%" }} />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      <AppNav active="/pulse" email={dash?.teamEmail} />
      <main className="container space-y-6 py-8">
        {/* Header — title + goals */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">Pulse</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">What needs you, what&apos;s moving, and where to add more.</p>
          </div>
          {dash && (
            <div className="flex w-full max-w-sm gap-4 sm:w-auto">
              <Goal label="Gifted posts" g={dash.goal.organic} />
              <Goal label="Paid reviews" g={dash.goal.paid} />
            </div>
          )}
        </div>

        {flash && (
          <div
            role="status"
            data-testid="pulse-flash"
            className={cn("text-sm font-medium", flashKind === "err" ? "text-destructive" : "text-success")}
          >
            {flash}
          </div>
        )}

        {/* ------------------------------ launch cockpit ------------------------------ */}
        <PulseCockpit />

        {/* ------------------------------ needs you ------------------------------ */}
        <section className="mx-auto w-full max-w-2xl space-y-4">
          <p className="text-lg font-medium tracking-[-0.01em]">{statusLine}</p>

          {payout && (
            <Card data-testid="pulse-payout-card">
              <CardContent className="p-6">
                <div className="text-lg font-semibold">
                  Pay{" "}
                  <a href={profileUrl(payout)} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
                    @{payout.handle}
                  </a>{" "}
                  ${payout.amountUsd}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {payout.half === "signing" ? "First half — agreed when they said yes." : "Final half — their post is live."}
                  {payout.half === "completion" && (payout.disclosureOk
                    ? " #ad disclosure checked ✓."
                    : <> <strong className="text-warning">#ad disclosure not confirmed</strong> — look before you approve.</>)}
                  {payout.postUrl && (
                    <>
                      {" "}
                      <a href={payout.postUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                        View the post <ExternalLink className="size-3" />
                      </a>
                    </>
                  )}
                </p>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <Button size="lg" className="min-h-[44px]" data-testid="pulse-payout-approve" onClick={() => approvePayout(payout)}>Approve</Button>
                  <Button size="lg" variant="outline" className="min-h-[44px]" onClick={() => setSkippedPayouts(s => [...s, payout.id])}>Not yet</Button>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">Approving records your sign-off — money only moves when you send it in your payment app.</p>
              </CardContent>
            </Card>
          )}

          {!payout && next && (
            <Card data-testid="pulse-decision-card">
              <CardContent className="p-6">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <a
                    href={profileUrl(next)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xl font-semibold text-foreground underline-offset-4 hover:underline"
                  >
                    @{next.handle} <ExternalLink className="size-4 text-muted-foreground" />
                  </a>
                  <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                    {(next.primaryPlatform ?? "tiktok").toUpperCase()}{next.displayName ? ` · ${next.displayName}` : ""}
                  </span>
                </div>

                {cardStats.length > 0 ? (
                  <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    {cardStats.map(([k, v]) => (
                      <div key={String(k)}>
                        <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">{String(k)}</div>
                        <div className="mt-1 break-words text-sm font-medium tnum">{v}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-muted-foreground">No stats yet — open their profile above and judge the content.</p>
                )}

                {hasAddress && (
                  <p className="mt-3 text-sm font-medium text-success">Filled your address form ✓ — approving ships to them right away.</p>
                )}
                {(next as any)?.sourceMetadata?.formChoices && (
                  <p className="mt-2 text-sm">They asked for: <strong>{(next as any).sourceMetadata.formChoices}</strong></p>
                )}

                {!next.email && (
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      value={emailDraft}
                      onChange={(e) => setEmailDraft(e.target.value)}
                      placeholder="their email (check the profile bio)"
                      className="h-11 flex-1 sm:h-9"
                      data-testid="pulse-email-input"
                    />
                    <Button variant="outline" className="min-h-[44px] sm:min-h-0" onClick={saveEmail}>Save</Button>
                  </div>
                )}

                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <Button
                    disabled={!canDecide}
                    size="lg"
                    className="min-h-[44px] flex-1"
                    data-testid="pulse-decide-tier-a"
                    onClick={() => decide(next, "tier_a")}
                  >
                    Pay for a review
                  </Button>
                  <Button
                    disabled={!canDecide}
                    size="lg"
                    variant="secondary"
                    className="min-h-[44px] flex-1"
                    data-testid="pulse-decide-tier-b"
                    onClick={() => decide(next, "tier_b")}
                  >
                    Send a gift
                  </Button>
                  <Button
                    size="lg"
                    variant="ghost"
                    className="min-h-[44px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                    data-testid="pulse-decide-reject"
                    onClick={() => decide(next, "reject")}
                  >
                    Pass
                  </Button>
                </div>

                {!canDecide && (
                  <p className="mt-2 text-xs text-destructive">No email — we can&apos;t invite them. Paste one above, or pass.</p>
                )}
                {canDecide && (
                  <p className="mt-2 text-xs text-muted-foreground">Paid review: the rate is agreed after they accept — nothing is owed today.</p>
                )}
                {queue.length > 1 && (
                  <p className="mt-3 text-xs text-muted-foreground">{queue.length - 1} more after this one.</p>
                )}
              </CardContent>
            </Card>
          )}

          {!payout && !next && dash && (
            <p className="text-sm text-muted-foreground">New creators arrive each morning, or add some below.</p>
          )}
          {loading && !dash && <p className="text-sm text-muted-foreground">Loading…</p>}
        </section>

        {/* ------------------------------ the belt ------------------------------ */}
        <section className="mx-auto w-full max-w-3xl space-y-3">
          <div className="flex flex-wrap items-center gap-2" data-testid="pulse-belt">
            {BELT.map((st, i) => (
              <div key={st.key} className="flex items-center gap-2">
                <Button
                  variant={openStation === st.key ? "default" : "outline"}
                  className="min-h-[44px]"
                  data-testid={`pulse-station-${st.key}`}
                  onClick={() => openBelt(st.key)}
                >
                  {st.label} <span className="ml-1 font-semibold tnum">{beltCount(st.key)}</span>
                </Button>
                {i < BELT.length - 1 && <span className="text-xs text-muted-foreground">→</span>}
              </div>
            ))}
          </div>

          {openStation && (
            <Card data-testid="pulse-station-rows">
              <CardContent className="p-5">
                <p className="mb-3 text-sm text-muted-foreground">{BELT.find(b => b.key === openStation)?.auto}</p>
                {(stationRows[openStation] ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No one here right now.</p>
                ) : (
                  <div className="divide-y divide-border/60">
                    {(stationRows[openStation] ?? []).map((c: any) => (
                      <div key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <div className="flex min-w-0 items-center gap-2">
                          <a href={profileUrl(c)} target="_blank" rel="noreferrer" className="truncate text-foreground hover:text-primary hover:underline">
                            @{c.handle}
                          </a>
                          <StageBadge stage={c.stage} />
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {c.postUrl ? "posted" : c.trackingNumber ? `tracking ${String(c.trackingNumber).slice(0, 14)}` : c.email ? "" : "no email"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </section>

        {/* ------------------------------ add creators ------------------------------ */}
        <section className="mx-auto w-full max-w-2xl">
          {!showAdd && (
            <Button variant="outline" className="min-h-[44px]" data-testid="pulse-add-open" onClick={() => setShowAdd(true)}>
              Add creators
            </Button>
          )}
          {showAdd && (
            <Card data-testid="pulse-add-form">
              <CardContent className="space-y-3 p-6">
                <div className="flex flex-wrap gap-2">
                  <Button variant={importMode === "prospects" ? "default" : "outline"} className="min-h-[44px]" onClick={() => setImportMode("prospects")}>New people to consider</Button>
                  <Button variant={importMode === "contacts" ? "default" : "outline"} className="min-h-[44px]" onClick={() => setImportMode("contacts")}>People I&apos;m already talking to</Button>
                </div>

                {importMode === "prospects" && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant={importPlatform === "tiktok" ? "default" : "outline"} className="min-h-[44px]" onClick={() => setImportPlatform("tiktok")}>TikTok</Button>
                    <Button variant={importPlatform === "instagram" ? "default" : "outline"} className="min-h-[44px]" onClick={() => setImportPlatform("instagram")}>Instagram</Button>
                  </div>
                )}
                {importMode === "contacts" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted-foreground">They&apos;ll get</span>
                    <Button variant={contactTier === "B" ? "default" : "outline"} className="min-h-[44px]" onClick={() => setContactTier("B")}>a gift</Button>
                    <Button variant={contactTier === "A" ? "default" : "outline"} className="min-h-[44px]" onClick={() => setContactTier("A")}>a paid review</Button>
                  </div>
                )}

                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  rows={5}
                  placeholder={importMode === "contacts"
                    ? "Jane Doe, jane@example.com — one person per line"
                    : "@handles, profile links, or your CSV export — one per line"}
                  className={cn(fieldClass, "h-auto min-h-[120px] w-full py-2 font-mono")}
                  data-testid="pulse-import-text"
                />
                <input
                  type="file"
                  accept=".csv,.tsv,.txt"
                  className="block text-xs text-muted-foreground file:mr-3 file:rounded-ctrl file:border file:border-border file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:text-foreground hover:file:bg-accent"
                  onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => setImportText(String(rd.result ?? "")); rd.readAsText(f); }}
                />

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button className="min-h-[44px]" disabled={importing} data-testid="pulse-import-submit" onClick={runImport}>
                    {importing ? "Adding…" : "Add"}
                  </Button>
                  <Button variant="outline" className="min-h-[44px]" onClick={() => setShowAdd(false)}>Cancel</Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {importMode === "contacts"
                    ? "They skip the cold invite. Once they fill in your address form, shipping takes over automatically."
                    : "They join the belt at Found and reach “Your call” once ranked."}
                </p>
              </CardContent>
            </Card>
          )}
        </section>

        {/* ------------------------------ how ranking works ------------------------------ */}
        <section className="mx-auto w-full max-w-2xl">
          <button
            onClick={() => setShowRanking(v => !v)}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            How ranking works
          </button>
          {showRanking && (
            <div className="mt-3 text-sm text-muted-foreground">
              <p className="mb-2">
                Creators are ranked by a simple score that learns from every call you make — {dash?.model?.decisionCount ?? 0} so far. Passing on someone teaches it just as much as saying yes.
              </p>
              <div className="divide-y divide-border/60">
                {topWeights.filter(([k]) => FEATURE_NAMES[k]).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between py-2">
                    <span className="text-foreground">{FEATURE_NAMES[k]}</span>
                    <span className={cn("text-xs font-medium", v > 0 ? "text-success" : "text-destructive")}>{v > 0 ? "helps" : "hurts"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
