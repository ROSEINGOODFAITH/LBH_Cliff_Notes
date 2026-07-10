"use client";
import { useEffect, useMemo, useState } from "react";

/* PULSE module UI — port of approved pulse-cliffnotes.jsx, wired to API routes. */
const S: any = {
  page: { fontFamily: "'Geist','Helvetica Neue',sans-serif", background: "oklch(0.975 0.004 90)", color: "oklch(0.22 0.01 90)", minHeight: "100vh", padding: "0 clamp(16px,4vw,48px) 64px", letterSpacing: "-0.01em" },
  serif: { fontFamily: "'Instrument Serif',Georgia,serif", fontStyle: "italic", fontWeight: 400 },
  mono: { fontFamily: "'Geist Mono',ui-monospace,monospace", fontSize: 11, letterSpacing: "0.02em" },
  btn: { border: "1px solid oklch(0.85 0.01 90)", background: "white", borderRadius: 8, padding: "7px 14px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" },
};
const STAGE_COLS = ["sourced", "review", "contacted", "replied", "onboarded", "shipped", "posted", "paid"];

export default function PulsePage() {
  const [queue, setQueue] = useState<any[]>([]);
  const [dash, setDash] = useState<any>(null);
  const [tab, setTab] = useState("review");
  const [flash, setFlash] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);

  const load = async () => {
    const [q, d] = await Promise.all([fetch("/api/pulse/queue").then(r => r.json()), fetch("/api/pulse/dashboard").then(r => r.json())]);
    setQueue(q); setDash(d);
  };
  useEffect(() => { load(); }, []);

  const decide = async (c: any, action: string) => {
    setQueue(q => q.filter(x => x.id !== c.id)); // optimistic
    setFlash(action === "reject" ? `✕ ${c.handle} — model updated` : `✓ ${c.handle} → outreach queue`);
    setTimeout(() => setFlash(""), 2000);
    await fetch("/api/pulse/decision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creatorId: c.id, action }) });
    load();
  };

  const importHandles = async () => {
    const handles = importText.split(/[\s,;]+/).map(h => h.trim()).filter(Boolean);
    if (!handles.length || importing) return;
    setImporting(true);
    try {
      const r = await fetch("/api/pulse/source", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handles }) });
      const j = await r.json();
      setFlash(r.ok
        ? `✓ ${j.queued} queued for enrichment${j.requeued ? ` · ${j.requeued} retried` : ""} · ${j.duplicates} already known${j.invalid ? ` · ${j.invalid} invalid` : ""}`
        : `✕ ${j.error ?? "import failed"}`);
      if (r.ok) { setImportText(""); setShowImport(false); }
    } catch { setFlash("✕ import failed"); }
    setImporting(false);
    setTimeout(() => setFlash(""), 6000);
    load();
  };

  const counts = useMemo(() => Object.fromEntries((dash?.stageCounts ?? []).map((s: any) => [s.stage, Number(s.n)])), [dash]);
  const topWeights = useMemo(() => Object.entries((dash?.model?.weights ?? {}) as Record<string, number>)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 6), [dash]);
  const next = queue[0];

  const Tab = ({ id, label }: any) => (
    <button onClick={() => setTab(id)} style={{ ...S.btn, background: tab === id ? "oklch(0.25 0.02 90)" : "white", color: tab === id ? "white" : "inherit" }}>{label}</button>);

  return (
    <div style={S.page}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&display=swap" rel="stylesheet" />
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "28px 0 8px", borderBottom: "1px solid oklch(0.88 0.01 90)", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={S.mono}>LBH CLIFF NOTES</div>
          <h1 style={{ ...S.serif, fontSize: "clamp(28px,4vw,40px)", margin: "2px 0 0" }}>PULSE — Creator Operations</h1>
        </div>
        <nav style={{ display: "flex", gap: 8 }}>
          <Tab id="review" label={`Review${queue.length ? " · " + queue.length : ""}`} />
          <Tab id="pipeline" label="Pipeline" />
          <Tab id="goal" label="Campaign Goal" />
          <Tab id="brain" label="Model" />
          {dash?.pendingPayouts?.length > 0 && <Tab id="approvals" label={`Approvals · ${dash.pendingPayouts.length}`} />}
        </nav>
      </header>
      {flash && <div style={{ ...S.mono, padding: "10px 0", color: "oklch(0.45 0.1 150)" }}>{flash}</div>}

      {tab === "review" && (
        <section style={{ maxWidth: 720, margin: "32px auto 0" }}>
          <h2 style={{ ...S.serif, fontSize: 24 }}>Human-in-the-loop tiering</h2>
          {!next && <p style={S.serif}>Queue clear — the daily Modash pull refills it each morning, or import your Modash list below.</p>}
          {next && (
            <div style={{ marginTop: 12, padding: "28px 32px", background: "white", borderRadius: 16, boxShadow: "0 1px 2px oklch(0 0 0/.05), 0 8px 32px oklch(0 0 0/.06)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ fontSize: 22, fontWeight: 600 }}>@{next.handle}</div>
                <div style={S.mono}>FIT <b style={{ fontSize: 18 }}>{next.fitScore}</b> · SUGG. RATE ${next.suggestedRate}</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: "14px 20px", margin: "20px 0 24px", fontSize: 13 }}>
                {[["Followers", next.followerCount?.toLocaleString()], ["Engagement", (next.engagementRate != null ? (next.engagementRate * 100).toFixed(1) + "%" : "—")], ["Avg views", next.avgViews?.toLocaleString()], ["Fake %", Math.round(next.fakeFollowerPct ?? 0) + "%"], ["Niche", next.niche], ["Geo", next.geo], ["Aesthetic", (next.aestheticScore ?? "—") + "/100"], ["Email", next.email ? "✓" : "✗"]].map(([k, v]) => (
                  <div key={String(k)}><div style={{ ...S.mono, color: "oklch(0.55 0.01 90)" }}>{String(k).toUpperCase()}</div><div style={{ fontWeight: 500, marginTop: 2 }}>{v}</div></div>))}
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button style={{ ...S.btn, flex: 1, padding: 12, background: "oklch(0.25 0.02 90)", color: "white", border: "none", fontWeight: 600 }} onClick={() => decide(next, "tier_a")}>Tier A — paid review</button>
                <button style={{ ...S.btn, flex: 1, padding: 12, fontWeight: 600 }} onClick={() => decide(next, "tier_b")}>Tier B — gift + affiliate</button>
                <button style={{ ...S.btn, padding: "12px 18px", color: "oklch(0.5 0.15 25)" }} onClick={() => decide(next, "reject")}>Wrong for LBH</button>
              </div>
            </div>)}
          {queue.slice(1, 6).map((c) => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 4px", borderBottom: "1px solid oklch(0.92 0.005 90)", fontSize: 13 }}>
              <span>@{c.handle} <span style={{ color: "oklch(0.55 0.01 90)" }}>· {c.niche} · {((c.followerCount ?? 0) / 1000).toFixed(0)}k</span></span>
              <span style={S.mono}>{c.fitScore}</span>
            </div>))}

          <div style={{ marginTop: 28 }}>
            {!showImport && (
              <button style={S.btn} onClick={() => setShowImport(true)}>Import from Modash list</button>)}
            {showImport && (
              <div style={{ padding: "20px 24px", background: "white", borderRadius: 16, boxShadow: "0 1px 2px oklch(0 0 0/.05), 0 8px 32px oklch(0 0 0/.06)" }}>
                <div style={{ ...S.mono, marginBottom: 8, color: "oklch(0.55 0.01 90)" }}>PASTE TIKTOK HANDLES FROM YOUR MODASH LIST — one per line, commas, @handles, or profile URLs</div>
                <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={6}
                  placeholder={"@creator1\n@creator2\nhttps://www.tiktok.com/@creator3"}
                  style={{ width: "100%", boxSizing: "border-box", border: "1px solid oklch(0.85 0.01 90)", borderRadius: 8, padding: 10, fontSize: 13, fontFamily: "'Geist Mono',ui-monospace,monospace" }} />
                <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                  <button style={{ ...S.btn, background: "oklch(0.25 0.02 90)", color: "white", border: "none", fontWeight: 600, opacity: importing ? 0.6 : 1 }} disabled={importing} onClick={importHandles}>{importing ? "Importing…" : "Queue for review"}</button>
                  <button style={S.btn} onClick={() => setShowImport(false)}>Cancel</button>
                </div>
                <p style={{ fontSize: 12, color: "oklch(0.5 0.01 90)", marginTop: 8 }}>Each handle is enriched via Modash + Claude and lands in this queue ranked by fit. Duplicates are skipped automatically.</p>
              </div>)}
          </div>
        </section>)}

      {tab === "pipeline" && (
        <section style={{ marginTop: 32, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
          {STAGE_COLS.map((st) => (
            <div key={st}><div style={S.mono}>{st.toUpperCase()} · {counts[st] ?? 0}</div></div>))}
          <p style={{ gridColumn: "1/-1", fontSize: 13, color: "oklch(0.5 0.01 90)" }}>Cards advance automatically via Smartlead, Tally, and Shopify webhooks.</p>
        </section>)}

      {tab === "goal" && dash && (
        <section style={{ maxWidth: 640, margin: "40px auto 0" }}>
          {[["Organic / affiliate posts", dash.goal.organic], ["Tier A paid reviews", dash.goal.paid]].map(([label, g]: any) => (
            <div key={label} style={{ marginBottom: 36 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ ...S.serif, fontSize: 22 }}>{label}</span><span style={S.mono}>{g.current} / {g.target}</span>
              </div>
              <div style={{ height: 6, background: "oklch(0.9 0.008 90)", borderRadius: 3, marginTop: 10 }}>
                <div style={{ height: "100%", width: Math.min(100, g.current / g.target * 100) + "%", background: "oklch(0.35 0.03 90)", borderRadius: 3, transition: "width .6s cubic-bezier(.16,1,.3,1)" }} />
              </div>
            </div>))}
        </section>)}

      {tab === "brain" && (
        <section style={{ maxWidth: 560, margin: "40px auto 0" }}>
          <h2 style={{ ...S.serif, fontSize: 24 }}>What the model has learned</h2>
          <p style={{ fontSize: 13, color: "oklch(0.5 0.01 90)" }}>{dash?.model?.decisionCount ?? 0} decisions recorded.</p>
          {topWeights.map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid oklch(0.92 0.005 90)", fontSize: 14 }}>
              <span>{k.replace("n_", "niche: ").replace(/_/g, " ")}</span>
              <span style={{ ...S.mono, color: v > 0 ? "oklch(0.45 0.1 150)" : "oklch(0.5 0.15 25)" }}>{v > 0 ? "+" : ""}{v.toFixed(2)}</span>
            </div>))}
        </section>)}

      {tab === "approvals" && dash && (
        <section style={{ maxWidth: 560, margin: "40px auto 0" }}>
          <h2 style={{ ...S.serif, fontSize: 24 }}>Pending payout approvals</h2>
          {dash.pendingPayouts.map((p: any) => (
            <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid oklch(0.92 0.005 90)", fontSize: 14 }}>
              <span>{p.half} · ${p.amountUsd}</span>
              <button style={{ ...S.btn, fontWeight: 600 }} onClick={async () => {
                await fetch("/api/pulse/payout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payoutId: p.id, approve: true }) });
                load();
              }}>Approve</button>
            </div>))}
          <p style={{ fontSize: 12, color: "oklch(0.5 0.01 90)" }}>Approving records your sign-off and closes the stage — the transfer itself happens in your payment rail, never automatically.</p>
        </section>)}
    </div>);
}
