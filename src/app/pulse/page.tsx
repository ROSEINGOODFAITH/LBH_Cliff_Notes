"use client";
import { useEffect, useMemo, useState } from "react";

/* PULSE module UI — port of approved pulse-cliffnotes.jsx, wired to API routes. */
const S: any = {
  page: { fontFamily: "'Geist','Helvetica Neue',sans-serif", background: "oklch(0.975 0.004 90)", color: "oklch(0.22 0.01 90)", minHeight: "100vh", padding: "0 clamp(16px,4vw,48px) 64px", letterSpacing: "-0.01em" },
  serif: { fontFamily: "'Instrument Serif',Georgia,serif", fontStyle: "italic", fontWeight: 400 },
  mono: { fontFamily: "'Geist Mono',ui-monospace,monospace", fontSize: 11, letterSpacing: "0.02em" },
  btn: { border: "1px solid oklch(0.85 0.01 90)", background: "white", borderRadius: 8, padding: "7px 14px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" },
};
const ACTIVE = { background: "oklch(0.25 0.02 90)", color: "white", border: "1px solid oklch(0.25 0.02 90)" };
const STAGE_COLS = ["sourced", "review", "contacted", "replied", "onboarded", "shipped", "posted", "paid"];
const profileUrl = (c: any) => c?.primaryPlatform === "instagram"
  ? `https://www.instagram.com/${c.handle}`
  : `https://www.tiktok.com/@${c.handle}`;

export default function PulsePage() {
  const [queue, setQueue] = useState<any[]>([]);
  const [dash, setDash] = useState<any>(null);
  const [tab, setTab] = useState("review");
  const [flash, setFlash] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMode, setImportMode] = useState<"prospects" | "contacts">("prospects");
  const [importPlatform, setImportPlatform] = useState<"tiktok" | "instagram">("tiktok");
  const [contactTier, setContactTier] = useState<"B" | "A">("B");
  const [emailDraft, setEmailDraft] = useState("");

  const load = async () => {
    const [q, d] = await Promise.all([fetch("/api/pulse/queue").then(r => r.json()), fetch("/api/pulse/dashboard").then(r => r.json())]);
    setQueue(q); setDash(d);
  };
  useEffect(() => { load(); }, []);

  const next = queue[0];
  useEffect(() => { setEmailDraft(""); }, [next?.id]);

  const decide = async (c: any, action: string) => {
    setQueue(q => q.filter(x => x.id !== c.id)); // optimistic
    setFlash(action === "reject" ? `✕ ${c.handle} — model updated` : `✓ ${c.handle} → outreach queue`);
    setTimeout(() => setFlash(""), 2000);
    await fetch("/api/pulse/decision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creatorId: c.id, action }) });
    load();
  };

  const saveEmail = async () => {
    if (!next || !emailDraft.trim()) return;
    const r = await fetch("/api/pulse/creator", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creatorId: next.id, email: emailDraft.trim() }) });
    const j = await r.json().catch(() => ({}));
    setFlash(r.ok ? `✓ email saved for @${next.handle} — Tier A/B unlocked` : `✕ ${j.error ?? "couldn't save email"}`);
    setTimeout(() => setFlash(""), 4000);
    if (r.ok) { setEmailDraft(""); load(); }
  };

  // Accepts a plain handle list OR a pasted/uploaded Modash CSV export
  // (headers fuzzy-matched; 12.5K/1.2M/3.4% values parsed).
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
      return {
        handle: iH >= 0 ? c[iH] : c[0],
        followerCount: iF >= 0 ? toNum(c[iF]) : null,
        engagementRate: er,
        avgViews: iV >= 0 ? toNum(c[iV]) : null,
        fakeFollowerPct: iFake >= 0 ? toNum(c[iFake]) : (cred != null && cred <= 1 ? (1 - cred) * 100 : null),
        geo: iG >= 0 ? (c[iG] || null) : null,
        email: iM >= 0 ? (c[iM] || null) : null,
      };
    }).filter(r => r.handle);
  };

  // "Name, email" / "Name <email>" / bare email lines, or a CSV with name/email/handle columns.
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

  const importHandles = async () => {
    const rows = importMode === "contacts"
      ? parseContacts(importText).map(r => ({ ...r, tier: contactTier }))
      : parseImport(importText).map(r => ({ ...r, platform: importPlatform }));
    if (!rows.length || importing) return;
    setImporting(true);
    try {
      const r = await fetch("/api/pulse/source", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: importMode, rows }) });
      const j = await r.json();
      setFlash(r.ok
        ? (importMode === "contacts"
          ? `✓ ${j.queued} added to the pipeline at "replied" · ${j.duplicates} already known${j.invalid ? ` · ${j.invalid} invalid` : ""}`
          : `✓ ${j.queued} queued for enrichment${j.requeued ? ` · ${j.requeued} retried` : ""} · ${j.duplicates} already known${j.invalid ? ` · ${j.invalid} invalid` : ""}`)
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

  const Tab = ({ id, label }: any) => (
    <button onClick={() => setTab(id)} style={{ ...S.btn, background: tab === id ? "oklch(0.25 0.02 90)" : "white", color: tab === id ? "white" : "inherit" }}>{label}</button>);

  const cardStats = next ? [
    ["Followers", next.followerCount != null ? Number(next.followerCount).toLocaleString() : null],
    ["Engagement", next.engagementRate != null ? (next.engagementRate * 100).toFixed(1) + "%" : null],
    ["Avg views", next.avgViews != null ? Number(next.avgViews).toLocaleString() : null],
    ["Fake %", next.fakeFollowerPct != null ? Math.round(next.fakeFollowerPct) + "%" : null],
    ["Niche", next.niche],
    ["Geo", next.geo],
    ["Aesthetic", next.aestheticScore != null ? next.aestheticScore + "/100" : null],
    ["Email", next.email],
  ].filter(([, v]) => v != null && v !== "") : [];

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
          {!next && <p style={S.serif}>Queue clear — the daily Modash pull refills it each morning, or import below.</p>}
          {next && (
            <div style={{ marginTop: 12, padding: "28px 32px", background: "white", borderRadius: 16, boxShadow: "0 1px 2px oklch(0 0 0/.05), 0 8px 32px oklch(0 0 0/.06)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
                <a href={profileUrl(next)} target="_blank" rel="noreferrer"
                  style={{ fontSize: 22, fontWeight: 600, color: "inherit", textDecoration: "none", borderBottom: "2px solid oklch(0.78 0.02 90)" }}>
                  @{next.handle} ↗
                </a>
                <div style={S.mono}>FIT <b style={{ fontSize: 18 }}>{next.fitScore}</b> · SUGG. RATE ${next.suggestedRate}</div>
              </div>
              <div style={{ ...S.mono, marginTop: 6, color: "oklch(0.55 0.01 90)" }}>
                {(next.primaryPlatform ?? "tiktok").toUpperCase()}{next.displayName ? ` · ${next.displayName}` : ""}
              </div>
              {cardStats.length > 0 ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: "14px 20px", margin: "20px 0 8px", fontSize: 13 }}>
                  {cardStats.map(([k, v]) => (
                    <div key={String(k)}><div style={{ ...S.mono, color: "oklch(0.55 0.01 90)" }}>{String(k).toUpperCase()}</div><div style={{ fontWeight: 500, marginTop: 2, overflowWrap: "anywhere" }}>{v}</div></div>))}
                </div>
              ) : (
                <p style={{ fontSize: 13, color: "oklch(0.5 0.01 90)", margin: "18px 0 8px" }}>
                  No enrichment data yet — judge from the profile link above. Stats fill in via Modash enrichment or a CSV import.
                </p>
              )}
              {!next.email && (
                <div style={{ display: "flex", gap: 8, margin: "12px 0 4px", alignItems: "center" }}>
                  <input value={emailDraft} onChange={(e) => setEmailDraft(e.target.value)}
                    placeholder="found their email? paste it here to enable outreach"
                    style={{ flex: 1, border: "1px solid oklch(0.85 0.01 90)", borderRadius: 8, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" }} />
                  <button style={S.btn} onClick={saveEmail}>Save email</button>
                </div>
              )}
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <button disabled={!next.email} title={next.email ? undefined : "No email — outreach is email-based"}
                  style={{ ...S.btn, flex: 1, padding: 12, background: "oklch(0.25 0.02 90)", color: "white", border: "none", fontWeight: 600, opacity: next.email ? 1 : 0.4, cursor: next.email ? "pointer" : "not-allowed" }}
                  onClick={() => decide(next, "tier_a")}>Tier A — paid review</button>
                <button disabled={!next.email} title={next.email ? undefined : "No email — outreach is email-based"}
                  style={{ ...S.btn, flex: 1, padding: 12, fontWeight: 600, opacity: next.email ? 1 : 0.4, cursor: next.email ? "pointer" : "not-allowed" }}
                  onClick={() => decide(next, "tier_b")}>Tier B — gift + affiliate</button>
                <button style={{ ...S.btn, padding: "12px 18px", color: "oklch(0.5 0.15 25)" }} onClick={() => decide(next, "reject")}>Wrong for LBH</button>
              </div>
              {!next.email && (
                <p style={{ fontSize: 12, color: "oklch(0.5 0.12 25)", marginTop: 8 }}>
                  Tier A/B disabled — no email on file, so outreach couldn&apos;t reach them. Check their profile bio for one and paste it above, or reject.
                </p>
              )}
            </div>)}
          {queue.slice(1, 6).map((c) => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 4px", borderBottom: "1px solid oklch(0.92 0.005 90)", fontSize: 13 }}>
              <span>
                <a href={profileUrl(c)} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>@{c.handle}</a>{" "}
                <span style={{ color: "oklch(0.55 0.01 90)" }}>
                  {[c.niche, c.followerCount != null ? ((c.followerCount ?? 0) / 1000).toFixed(0) + "k" : null, c.email ? "email ✓" : "no email"].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span style={S.mono}>{c.fitScore}</span>
            </div>))}

          <div style={{ marginTop: 28 }}>
            {!showImport && (
              <button style={S.btn} onClick={() => setShowImport(true)}>Import creators</button>)}
            {showImport && (
              <div style={{ padding: "20px 24px", background: "white", borderRadius: 16, boxShadow: "0 1px 2px oklch(0 0 0/.05), 0 8px 32px oklch(0 0 0/.06)" }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                  <button style={{ ...S.btn, ...(importMode === "prospects" ? ACTIVE : {}) }} onClick={() => setImportMode("prospects")}>New prospects → review</button>
                  <button style={{ ...S.btn, ...(importMode === "contacts" ? ACTIVE : {}) }} onClick={() => setImportMode("contacts")}>Already in contact → pipeline</button>
                </div>
                {importMode === "prospects" ? (
                  <>
                    <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                      <button style={{ ...S.btn, ...(importPlatform === "tiktok" ? ACTIVE : {}) }} onClick={() => setImportPlatform("tiktok")}>TikTok</button>
                      <button style={{ ...S.btn, ...(importPlatform === "instagram" ? ACTIVE : {}) }} onClick={() => setImportPlatform("instagram")}>Instagram</button>
                    </div>
                    <div style={{ ...S.mono, marginBottom: 8, color: "oklch(0.55 0.01 90)" }}>
                      PASTE {importPlatform === "instagram" ? "INSTAGRAM" : "TIKTOK"} HANDLES — OR YOUR MODASH LIST CSV EXPORT (STATS + EMAILS COME ALONG, NO API NEEDED)
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
                      <span style={{ ...S.mono, color: "oklch(0.55 0.01 90)" }}>DEFAULT TIER</span>
                      <button style={{ ...S.btn, ...(contactTier === "B" ? ACTIVE : {}) }} onClick={() => setContactTier("B")}>B — gift + affiliate</button>
                      <button style={{ ...S.btn, ...(contactTier === "A" ? ACTIVE : {}) }} onClick={() => setContactTier("A")}>A — paid review</button>
                    </div>
                    <div style={{ ...S.mono, marginBottom: 8, color: "oklch(0.55 0.01 90)" }}>
                      PASTE PEOPLE YOU ALREADY EMAIL — &quot;NAME, EMAIL&quot; PER LINE, &quot;NAME &lt;EMAIL&gt;&quot;, OR A CSV WITH NAME / EMAIL / HANDLE COLUMNS
                    </div>
                  </>
                )}
                <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={6}
                  placeholder={importMode === "contacts"
                    ? "Jane Doe, jane@example.com\nMark Smith <mark@example.com>\nsam@example.com"
                    : "@creator1\n@creator2\nhttps://www.tiktok.com/@creator3\n\n…or paste/upload the CSV export of your Modash list"}
                  style={{ width: "100%", boxSizing: "border-box", border: "1px solid oklch(0.85 0.01 90)", borderRadius: 8, padding: 10, fontSize: 13, fontFamily: "'Geist Mono',ui-monospace,monospace" }} />
                <input type="file" accept=".csv,.tsv,.txt" style={{ fontSize: 12, marginTop: 8, display: "block" }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => setImportText(String(rd.result ?? "")); rd.readAsText(f); }} />
                <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                  <button style={{ ...S.btn, background: "oklch(0.25 0.02 90)", color: "white", border: "none", fontWeight: 600, opacity: importing ? 0.6 : 1 }} disabled={importing} onClick={importHandles}>
                    {importing ? "Importing…" : importMode === "contacts" ? "Add to pipeline" : "Queue for review"}
                  </button>
                  <button style={S.btn} onClick={() => setShowImport(false)}>Cancel</button>
                </div>
                <p style={{ fontSize: 12, color: "oklch(0.5 0.01 90)", marginTop: 8 }}>
                  {importMode === "contacts"
                    ? "They enter the pipeline at “replied” and skip cold outreach — you send them the Tally link yourself; their form submission matches by email or handle."
                    : "Each handle is enriched via Modash + Claude and lands in this queue ranked by fit. Duplicates are skipped automatically."}
                </p>
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
