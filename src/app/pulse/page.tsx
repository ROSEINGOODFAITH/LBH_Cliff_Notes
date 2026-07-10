"use client";
import { useEffect, useMemo, useState } from "react";

/* PULSE — one screen: what needs you, what's moving, add more.
 * Mental model: a conveyor belt that stops at your desk twice —
 * once to ask "in or out?", once to ask "pay them?". */
const S: any = {
  page: { fontFamily: "'Geist','Helvetica Neue',sans-serif", background: "oklch(0.975 0.004 90)", color: "oklch(0.22 0.01 90)", minHeight: "100vh", padding: "0 clamp(16px,4vw,48px) 64px", letterSpacing: "-0.01em" },
  serif: { fontFamily: "'Instrument Serif',Georgia,serif", fontStyle: "italic", fontWeight: 400 },
  mono: { fontFamily: "'Geist Mono',ui-monospace,monospace", fontSize: 11, letterSpacing: "0.02em" },
  btn: { border: "1px solid oklch(0.85 0.01 90)", background: "white", borderRadius: 8, padding: "7px 14px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" },
  card: { padding: "28px 32px", background: "white", borderRadius: 16, boxShadow: "0 1px 2px oklch(0 0 0/.05), 0 8px 32px oklch(0 0 0/.06)" },
  muted: { color: "oklch(0.55 0.01 90)" },
};
const ACTIVE = { background: "oklch(0.25 0.02 90)", color: "white", border: "1px solid oklch(0.25 0.02 90)" };
const PRIMARY = { background: "oklch(0.25 0.02 90)", color: "white", border: "none", fontWeight: 600 };

const profileUrl = (c: any) => c?.primaryPlatform === "instagram"
  ? `https://www.instagram.com/${c.handle}`
  : `https://www.tiktok.com/@${c.handle}`;

/* The belt: plain-word stations over internal stages. */
const BELT = [
  { key: "sourced", label: "Found", auto: "We pull their profile and rank them for you — nothing to do here." },
  { key: "review", label: "Your call", auto: "Waiting on you — decide at the top of this page." },
  { key: "contacted", label: "Invited", auto: "Invite email sent. We watch for their reply." },
  { key: "replied", label: "Replied", auto: "They have the address form. When it comes back, shipping starts." },
  { key: "shipping", label: "Shipping", auto: "Order placed. We check tracking every hour and email them when it ships." },
  { key: "posted", label: "Posted", auto: "Post is live. Gifts finish here; paid reviews come to you for payment approval." },
  { key: "paid", label: "Done", auto: "Finished and counted toward the goal." },
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

  const load = async () => {
    const [q, d] = await Promise.all([
      fetch("/api/pulse/queue").then(r => r.json()),
      fetch("/api/pulse/dashboard").then(r => r.json()),
    ]);
    setQueue(q); setDash(d); setStationRows({}); setOpenStation(null);
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

  /* ---------- import parsing (handles list, Modash CSV, or name+email lines) ---------- */
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

  const cardStats = next ? [
    ["Followers", next.followerCount != null ? Number(next.followerCount).toLocaleString() : null],
    ["Engagement", next.engagementRate != null ? (next.engagementRate * 100).toFixed(1) + "%" : null],
    ["Avg views", next.avgViews != null ? Number(next.avgViews).toLocaleString() : null],
    ["Email", next.email],
  ].filter(([, v]) => v != null && v !== "") : [];

  const Bar = ({ label, g }: any) => (
    <div style={{ minWidth: 130 }}>
      <div style={{ ...S.mono, ...S.muted, display: "flex", justifyContent: "space-between" }}><span>{label}</span><span>{g.current}/{g.target}</span></div>
      <div style={{ height: 4, background: "oklch(0.9 0.008 90)", borderRadius: 2, marginTop: 4 }}>
        <div style={{ height: "100%", width: Math.min(100, g.current / g.target * 100) + "%", background: "oklch(0.35 0.03 90)", borderRadius: 2 }} />
      </div>
    </div>);

  return (
    <div style={S.page}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&display=swap" rel="stylesheet" />

      <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", padding: "28px 0 16px", borderBottom: "1px solid oklch(0.88 0.01 90)", flexWrap: "wrap", gap: 16 }}>
        <div>
          <div style={S.mono}>LBH CLIFF NOTES</div>
          <h1 style={{ ...S.serif, fontSize: "clamp(28px,4vw,40px)", margin: "2px 0 0" }}>PULSE</h1>
        </div>
        {dash && (
          <div style={{ display: "flex", gap: 20 }}>
            <Bar label="Gifted posts" g={dash.goal.organic} />
            <Bar label="Paid reviews" g={dash.goal.paid} />
          </div>)}
      </header>

      {dash?.health?.modashPaused && (
        <div style={{ margin: "16px 0 0", padding: "10px 16px", background: "oklch(0.95 0.02 85)", border: "1px solid oklch(0.85 0.04 85)", borderRadius: 10, fontSize: 13 }}>
          Profile data is paused — Modash hasn&apos;t switched on our access to their data yet, so new creators arrive without stats. CSV imports still bring full data.
        </div>)}

      {flash && <div style={{ ...S.mono, padding: "12px 0 0", color: flashKind === "err" ? "oklch(0.5 0.15 25)" : "oklch(0.45 0.1 150)" }}>{flash}</div>}

      {/* ------------------------------ needs you ------------------------------ */}
      <section style={{ maxWidth: 720, margin: "36px auto 0" }}>
        <p style={{ ...S.serif, fontSize: "clamp(20px,2.6vw,26px)", margin: 0 }}>{statusLine}</p>

        {payout && (
          <div style={{ ...S.card, marginTop: 20 }}>
            <div style={{ fontSize: 18, fontWeight: 600 }}>
              Pay <a href={profileUrl(payout)} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>@{payout.handle}</a> ${payout.amountUsd}
            </div>
            <p style={{ fontSize: 14, margin: "8px 0 0", ...S.muted }}>
              {payout.half === "signing" ? "First half — agreed when they said yes." : "Final half — their post is live."}
              {payout.half === "completion" && (payout.disclosureOk
                ? " #ad disclosure checked ✓."
                : <> <b>#ad disclosure not confirmed</b> — look before you approve.</>)}
              {payout.postUrl && <> <a href={payout.postUrl} target="_blank" rel="noreferrer">View the post →</a></>}
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button style={{ ...S.btn, ...PRIMARY, padding: "10px 18px" }} onClick={() => approvePayout(payout)}>Approve</button>
              <button style={S.btn} onClick={() => setSkippedPayouts(s => [...s, payout.id])}>Not yet</button>
            </div>
            <p style={{ fontSize: 12, ...S.muted, marginTop: 8 }}>Approving records your sign-off — money only moves when you send it in your payment app.</p>
          </div>)}

        {!payout && next && (
          <div style={{ ...S.card, marginTop: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
              <a href={profileUrl(next)} target="_blank" rel="noreferrer"
                style={{ fontSize: 22, fontWeight: 600, color: "inherit", textDecoration: "none", borderBottom: "2px solid oklch(0.78 0.02 90)" }}>
                @{next.handle} ↗
              </a>
              <span style={{ ...S.mono, ...S.muted }}>{(next.primaryPlatform ?? "tiktok").toUpperCase()}{next.displayName ? ` · ${next.displayName}` : ""}</span>
            </div>
            {cardStats.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: "14px 20px", margin: "18px 0 4px", fontSize: 13 }}>
                {cardStats.map(([k, v]) => (
                  <div key={String(k)}><div style={{ ...S.mono, ...S.muted }}>{String(k).toUpperCase()}</div><div style={{ fontWeight: 500, marginTop: 2, overflowWrap: "anywhere" }}>{v}</div></div>))}
              </div>
            ) : (
              <p style={{ fontSize: 13, ...S.muted, margin: "16px 0 4px" }}>No stats yet — open their profile above and judge the content.</p>
            )}
            {!next.email && (
              <div style={{ display: "flex", gap: 8, margin: "12px 0 0", alignItems: "center" }}>
                <input value={emailDraft} onChange={(e) => setEmailDraft(e.target.value)}
                  placeholder="their email (check the profile bio)"
                  style={{ flex: 1, border: "1px solid oklch(0.85 0.01 90)", borderRadius: 8, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" }} />
                <button style={S.btn} onClick={saveEmail}>Save</button>
              </div>)}
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button disabled={!next.email} style={{ ...S.btn, ...PRIMARY, flex: 1, padding: 12, opacity: next.email ? 1 : 0.4, cursor: next.email ? "pointer" : "not-allowed" }}
                onClick={() => decide(next, "tier_a")}>Pay for a review</button>
              <button disabled={!next.email} style={{ ...S.btn, flex: 1, padding: 12, opacity: next.email ? 1 : 0.4, cursor: next.email ? "pointer" : "not-allowed" }}
                onClick={() => decide(next, "tier_b")}>Send a gift</button>
              <button style={{ ...S.btn, padding: "12px 18px", color: "oklch(0.5 0.15 25)" }} onClick={() => decide(next, "reject")}>Pass</button>
            </div>
            {!next.email && (
              <p style={{ fontSize: 12, color: "oklch(0.5 0.12 25)", marginTop: 8 }}>
                No email — we can&apos;t invite them. Paste one above, or pass.
              </p>)}
            {next.email && <p style={{ fontSize: 12, ...S.muted, marginTop: 8 }}>Paid review: the rate is agreed after they accept — nothing is owed today.</p>}
            {queue.length > 1 && <p style={{ fontSize: 12, ...S.muted, marginTop: 12 }}>{queue.length - 1} more after this one.</p>}
          </div>)}

        {!payout && !next && dash && (
          <p style={{ fontSize: 14, ...S.muted, marginTop: 16 }}>New creators arrive each morning, or add some below.</p>)}
      </section>

      {/* ------------------------------ the belt ------------------------------ */}
      <section style={{ maxWidth: 860, margin: "48px auto 0" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {BELT.map((st, i) => (
            <div key={st.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button onClick={() => openBelt(st.key)}
                style={{ ...S.btn, ...(openStation === st.key ? ACTIVE : {}), padding: "8px 12px" }}>
                {st.label} <b style={{ marginLeft: 4 }}>{beltCount(st.key)}</b>
              </button>
              {i < BELT.length - 1 && <span style={{ ...S.muted, fontSize: 12 }}>→</span>}
            </div>))}
        </div>
        {openStation && (
          <div style={{ ...S.card, marginTop: 12, padding: "18px 24px" }}>
            <p style={{ fontSize: 13, ...S.muted, margin: "0 0 10px" }}>{BELT.find(b => b.key === openStation)?.auto}</p>
            {(stationRows[openStation] ?? []).length === 0
              ? <p style={{ fontSize: 13, ...S.muted, margin: 0 }}>No one here right now.</p>
              : (stationRows[openStation] ?? []).map((c: any) => (
                <div key={c.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid oklch(0.94 0.004 90)", fontSize: 13 }}>
                  <a href={profileUrl(c)} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>@{c.handle}</a>
                  <span style={{ ...S.mono, ...S.muted }}>
                    {c.postUrl ? "posted" : c.trackingNumber ? `tracking ${String(c.trackingNumber).slice(0, 14)}` : c.email ? "" : "no email"}
                  </span>
                </div>))}
          </div>)}
      </section>

      {/* ------------------------------ add creators ------------------------------ */}
      <section style={{ maxWidth: 720, margin: "40px auto 0" }}>
        {!showAdd && <button style={{ ...S.btn, padding: "10px 18px" }} onClick={() => setShowAdd(true)}>Add creators</button>}
        {showAdd && (
          <div style={{ ...S.card, padding: "20px 24px" }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <button style={{ ...S.btn, ...(importMode === "prospects" ? ACTIVE : {}) }} onClick={() => setImportMode("prospects")}>New people to consider</button>
              <button style={{ ...S.btn, ...(importMode === "contacts" ? ACTIVE : {}) }} onClick={() => setImportMode("contacts")}>People I&apos;m already talking to</button>
            </div>
            {importMode === "prospects" && (
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <button style={{ ...S.btn, ...(importPlatform === "tiktok" ? ACTIVE : {}) }} onClick={() => setImportPlatform("tiktok")}>TikTok</button>
                <button style={{ ...S.btn, ...(importPlatform === "instagram" ? ACTIVE : {}) }} onClick={() => setImportPlatform("instagram")}>Instagram</button>
              </div>)}
            {importMode === "contacts" && (
              <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
                <span style={{ fontSize: 13, ...S.muted }}>They&apos;ll get</span>
                <button style={{ ...S.btn, ...(contactTier === "B" ? ACTIVE : {}) }} onClick={() => setContactTier("B")}>a gift</button>
                <button style={{ ...S.btn, ...(contactTier === "A" ? ACTIVE : {}) }} onClick={() => setContactTier("A")}>a paid review</button>
              </div>)}
            <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={5}
              placeholder={importMode === "contacts"
                ? "Jane Doe, jane@example.com — one person per line"
                : "@handles, profile links, or your Modash CSV export — one per line"}
              style={{ width: "100%", boxSizing: "border-box", border: "1px solid oklch(0.85 0.01 90)", borderRadius: 8, padding: 10, fontSize: 13, fontFamily: "'Geist Mono',ui-monospace,monospace" }} />
            <input type="file" accept=".csv,.tsv,.txt" style={{ fontSize: 12, marginTop: 8, display: "block" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => setImportText(String(rd.result ?? "")); rd.readAsText(f); }} />
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button style={{ ...S.btn, ...PRIMARY, opacity: importing ? 0.6 : 1 }} disabled={importing} onClick={runImport}>
                {importing ? "Adding…" : "Add"}
              </button>
              <button style={S.btn} onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
            <p style={{ fontSize: 12, ...S.muted, marginTop: 8 }}>
              {importMode === "contacts"
                ? "They skip the cold invite. Once they fill in your address form, shipping takes over automatically."
                : "They join the belt at Found and reach “Your call” once ranked."}
            </p>
          </div>)}
      </section>

      {/* ------------------------------ how ranking works ------------------------------ */}
      <section style={{ maxWidth: 720, margin: "40px auto 0" }}>
        <button onClick={() => setShowRanking(v => !v)}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, ...S.muted, padding: 0, textDecoration: "underline", fontFamily: "inherit" }}>
          How ranking works
        </button>
        {showRanking && (
          <div style={{ marginTop: 10, fontSize: 13, ...S.muted }}>
            <p style={{ margin: "0 0 8px" }}>
              Creators are ranked by a simple score that learns from every call you make — {dash?.model?.decisionCount ?? 0} so far. Passing on someone teaches it just as much as saying yes.
            </p>
            {topWeights.filter(([k]) => FEATURE_NAMES[k]).map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid oklch(0.94 0.004 90)" }}>
                <span>{FEATURE_NAMES[k]}</span>
                <span style={{ ...S.mono, color: v > 0 ? "oklch(0.45 0.1 150)" : "oklch(0.5 0.15 25)" }}>{v > 0 ? "helps" : "hurts"}</span>
              </div>))}
          </div>)}
      </section>
    </div>);
}
