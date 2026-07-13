"use client";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { PreviewRow, FieldTarget, ChangeField, RowOutcome } from "@/lib/csv-import";

/* CSV creator import — the safe path. Upload → auto-map → preview (dry run) →
 * resolve conflicts → confirm. Nothing is written until Confirm; enrichment only
 * fills empty fields; the CSV Status column is never mapped to a lifecycle stage;
 * importing never sends email, moves a stage, gifts, or starts a flow. */

export interface BatchSummary {
  id: string;
  filename: string;
  operator: string | null;
  createdAt: string;
  totalRows: number;
  enriched: number;
  created: number;
  skipped: number;
  conflict: number;
  error: number;
  unchanged: number;
}

interface PreviewResponse {
  ok: boolean;
  error?: string;
  fileHash: string;
  headers: string[];
  mapping: Record<string, FieldTarget>;
  summary: Record<RowOutcome | "total" | "duplicatesInFile", number>;
  rows: PreviewRow[];
  reportCsv: string | null;
}

const OUTCOME_STYLE: Record<RowOutcome, { label: string; cls: string }> = {
  enriched: { label: "Enrich", cls: "text-success" },
  created: { label: "Create", cls: "text-success" },
  unchanged: { label: "No change", cls: "text-muted-foreground" },
  skipped: { label: "Skip", cls: "text-muted-foreground" },
  conflict: { label: "Conflict", cls: "text-warning" },
  error: { label: "Error", cls: "text-destructive" },
};

/* Manual mapping: a small set of targets an operator can assign to any header.
 * Auto-detected targets we don't expose for editing (platform URLs, audience
 * splits) are preserved verbatim and shown as a read-only "(auto)" option. */
const TARGET_OPTIONS: { token: string; label: string; build: (header: string) => FieldTarget }[] = [
  { token: "ignore", label: "Ignore", build: () => ({ kind: "ignore" }) },
  { token: "metadata", label: "Keep as metadata", build: (h) => ({ kind: "metadata", key: h }) },
  { token: "handle", label: "Handle", build: () => ({ kind: "core", field: "handle" }) },
  { token: "platform", label: "Platform", build: () => ({ kind: "core", field: "primaryPlatform" }) },
  { token: "accountUrl", label: "Account URL", build: () => ({ kind: "identity", field: "accountUrl" }) },
  { token: "displayName", label: "Display name", build: () => ({ kind: "core", field: "displayName" }) },
  { token: "email", label: "Email (primary)", build: () => ({ kind: "core", field: "email" }) },
  { token: "emailCandidate", label: "Email (candidate)", build: () => ({ kind: "emailCandidate" }) },
  { token: "followers", label: "Followers", build: () => ({ kind: "core", field: "followerCount" }) },
  { token: "er", label: "Engagement rate", build: () => ({ kind: "core", field: "engagementRate" }) },
  { token: "geo", label: "Country / geo", build: () => ({ kind: "core", field: "geo" }) },
  { token: "notes", label: "Notes", build: () => ({ kind: "core", field: "notes" }) },
  { token: "tags", label: "Labels / tags", build: () => ({ kind: "core", field: "nicheTags" }) },
];

function targetToken(t: FieldTarget): string {
  switch (t.kind) {
    case "core":
      return ({ handle: "handle", primaryPlatform: "platform", displayName: "displayName", email: "email", followerCount: "followers", engagementRate: "er", geo: "geo", notes: "notes", nicheTags: "tags" } as Record<string, string>)[t.field] ?? "metadata";
    case "identity":
      return "accountUrl";
    case "emailCandidate":
      return "emailCandidate";
    case "metadata":
      return "metadata";
    case "ignore":
      return "ignore";
    default:
      return "auto";
  }
}

function autoLabel(t: FieldTarget): string {
  if (t.kind === "platformUrl") return `Profile URL (${t.platform})`;
  if (t.kind === "audienceAge") return `Audience age ${t.bucket}`;
  if (t.kind === "audienceGender") return `Audience ${t.bucket}`;
  if (t.kind === "audienceCountry") return `Audience country #${t.rank}`;
  return "Auto";
}

function fmt(v: unknown): string {
  if (v == null || v === "") return "—";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function ImportWorkflow({ history, operator }: { history: BatchSummary[]; operator: string | null }) {
  const [filename, setFilename] = useState("");
  const [csvText, setCsvText] = useState("");
  const [mapping, setMapping] = useState<Record<string, FieldTarget>>({});
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [summary, setSummary] = useState<PreviewResponse["summary"] | null>(null);
  const [reportCsv, setReportCsv] = useState<string | null>(null);
  const [createNew, setCreateNew] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, ChangeField[]>>({});
  const [showMapping, setShowMapping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [result, setResult] = useState<{ replay: boolean; summary: BatchSummary | null } | null>(null);

  const runPreview = async (over: {
    text?: string;
    map?: Record<string, FieldTarget>;
    create?: boolean;
    ov?: Record<string, ChangeField[]>;
  } = {}) => {
    const text = over.text ?? csvText;
    if (!text.trim()) return;
    setBusy(true);
    setMsg("");
    setResult(null);
    const r = await fetch("/api/pulse/import/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        csvText: text,
        mapping: over.map ?? (Object.keys(mapping).length ? mapping : undefined),
        createNew: over.create ?? createNew,
        overrides: over.ov ?? overrides,
      }),
    });
    const j: PreviewResponse = await r.json().catch(() => ({}) as PreviewResponse);
    setBusy(false);
    if (!r.ok || !j.ok) {
      setMsg(j.error ?? "Preview failed.");
      return;
    }
    setHeaders(j.headers);
    setMapping(j.mapping);
    setRows(j.rows);
    setSummary(j.summary);
    setReportCsv(j.reportCsv);
  };

  const onFile = async (file: File) => {
    const text = await file.text();
    setFilename(file.name);
    setCsvText(text);
    setOverrides({});
    setResult(null);
    await runPreview({ text, map: undefined });
  };

  const setHeaderTarget = (header: string, token: string) => {
    const opt = TARGET_OPTIONS.find((o) => o.token === token);
    if (!opt) return;
    const next = { ...mapping, [header]: opt.build(header) };
    setMapping(next);
    runPreview({ map: next });
  };

  const toggleOverride = (rowHash: string, field: ChangeField) => {
    const cur = overrides[rowHash] ?? [];
    const next = cur.includes(field) ? cur.filter((f) => f !== field) : [...cur, field];
    const all = { ...overrides, [rowHash]: next };
    setOverrides(all);
    runPreview({ ov: all });
  };

  const setCreate = (v: boolean) => {
    setCreateNew(v);
    runPreview({ create: v });
  };

  const confirm = async () => {
    setBusy(true);
    setMsg("");
    const r = await fetch("/api/pulse/import/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvText, filename, operator, mapping, createNew, overrides }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || !j.ok) {
      setMsg(j.error ?? "Import failed.");
      return;
    }
    setResult({
      replay: Boolean(j.replay),
      summary: j.summary
        ? { ...(j.summary as Omit<BatchSummary, "id" | "filename" | "operator" | "createdAt">), id: j.batchId, filename, operator, createdAt: new Date().toISOString() }
        : null,
    });
    setMsg(j.replay ? j.message ?? "Already imported — nothing changed." : "Import applied.");
  };

  const downloadReport = () => {
    if (!reportCsv) return;
    const blob = new Blob([reportCsv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `import-review-${filename || "report"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const conflictCount = summary?.conflict ?? 0;

  return (
    <main className="container max-w-5xl space-y-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Import creators from CSV</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Upload a creator export. We match rows to existing creators and preview every change — nothing is
          written until you confirm. Enrichment only fills empty fields; import never emails, changes a stage,
          gifts, or starts a flow.
        </p>
      </div>

      {msg && (
        <div role="status" className={cn("text-sm font-medium", result && !result.replay ? "text-success" : "text-muted-foreground")}>
          {msg}
        </div>
      )}

      {/* Upload */}
      <Card>
        <CardContent className="space-y-3 p-6">
          <input
            type="file"
            accept=".csv,text/csv"
            data-testid="import-file"
            className="block text-xs text-muted-foreground file:mr-3 file:rounded-ctrl file:border file:border-border file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:text-foreground hover:file:bg-accent"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
          {filename && <p className="text-xs text-muted-foreground">{filename}{busy ? " — working…" : ""}</p>}
        </CardContent>
      </Card>

      {summary && (
        <>
          {/* Summary bar */}
          <Card>
            <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-6 text-sm">
              <span className="font-medium">{summary.total} rows</span>
              <span className="text-success">{summary.enriched} enrich</span>
              <span className="text-success">{summary.created} create</span>
              <span className="text-warning">{summary.conflict} conflict</span>
              <span className="text-muted-foreground">{summary.skipped} skip</span>
              <span className="text-muted-foreground">{summary.unchanged} unchanged</span>
              <span className="text-destructive">{summary.error} error</span>
              {summary.duplicatesInFile > 0 && (
                <span className="text-muted-foreground">({summary.duplicatesInFile} dup in file)</span>
              )}
            </CardContent>
          </Card>

          {/* Options */}
          <Card>
            <CardContent className="space-y-3 p-6">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={createNew} onChange={(e) => setCreate(e.target.checked)} data-testid="create-new" />
                Create new creators for unmatched rows (stage <span className="font-mono">sourced</span>, no tier)
              </label>
              <button className="text-xs text-muted-foreground underline" onClick={() => setShowMapping((s) => !s)}>
                {showMapping ? "Hide" : "Show"} column mapping
              </button>
              {showMapping && (
                <div className="max-h-72 overflow-auto rounded-cell border border-border/60">
                  <table className="w-full text-xs">
                    <tbody>
                      {headers.map((h) => {
                        const t = mapping[h];
                        const token = t ? targetToken(t) : "metadata";
                        const isAuto = token === "auto";
                        return (
                          <tr key={h} className="border-b border-border/40">
                            <td className="px-3 py-1.5 font-mono">{h}</td>
                            <td className="px-3 py-1.5">
                              <select
                                value={token}
                                onChange={(e) => setHeaderTarget(h, e.target.value)}
                                className={cn(fieldClass, "h-7 w-full py-0 text-xs")}
                              >
                                {isAuto && <option value="auto">{t ? autoLabel(t) : "Auto"} (auto)</option>}
                                {TARGET_OPTIONS.map((o) => (
                                  <option key={o.token} value={o.token}>{o.label}</option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Preview table */}
          <Card>
            <CardContent className="p-0">
              <div className="max-h-[32rem] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-secondary text-left text-xs uppercase tracking-[0.06em] text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Creator</th>
                      <th className="px-3 py-2">Action</th>
                      <th className="px-3 py-2">Match</th>
                      <th className="px-3 py-2">Changes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const style = OUTCOME_STYLE[r.outcome];
                      return (
                        <tr key={r.rowHash} className="border-b border-border/40 align-top">
                          <td className="px-3 py-2 text-xs text-muted-foreground">{r.index + 1}</td>
                          <td className="px-3 py-2">
                            <div className="font-medium">{r.handle ? `@${r.handle}` : r.emails[0] ?? "—"}</div>
                            {r.platform && <div className="text-xs text-muted-foreground">{r.platform}</div>}
                          </td>
                          <td className="px-3 py-2">
                            <span className={cn("text-xs font-semibold uppercase tracking-wide", style.cls)}>{style.label}</span>
                            <div className="mt-0.5 text-xs text-muted-foreground">{r.detail}</div>
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {r.matchReason ?? "—"}
                            {r.matchConfidence != null && <div>{Math.round(r.matchConfidence * 100)}%</div>}
                          </td>
                          <td className="px-3 py-2">
                            {r.changes.length === 0 ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              <ul className="space-y-1">
                                {r.changes.map((c) => {
                                  const needsOverride = c.conflict && r.conflicts.includes(c.field);
                                  return (
                                    <li key={c.field} className="text-xs">
                                      <span className="font-medium">{c.field}</span>{" "}
                                      <span className="text-muted-foreground">{fmt(c.from)}</span>
                                      <span className="text-muted-foreground"> → </span>
                                      <span className={c.conflict ? "text-warning" : "text-success"}>{fmt(c.to)}</span>
                                      {c.conflict && (
                                        <label className="ml-2 inline-flex items-center gap-1 text-warning">
                                          <input
                                            type="checkbox"
                                            checked={!needsOverride}
                                            onChange={() => toggleOverride(r.rowHash, c.field)}
                                          />
                                          override
                                        </label>
                                      )}
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={confirm} disabled={busy || Boolean(result && !result.replay)} data-testid="confirm-import">
              {conflictCount > 0 ? `Apply (skips ${conflictCount} unresolved conflict${conflictCount > 1 ? "s" : ""})` : "Apply import"}
            </Button>
            {reportCsv && (
              <Button variant="outline" onClick={downloadReport}>Download review report</Button>
            )}
          </div>

          {result?.summary && (
            <Card>
              <CardContent className="space-y-1 p-6 text-sm">
                <p className="font-medium">{result.replay ? "Replay — no changes applied." : "Import complete."}</p>
                <p className="text-muted-foreground">
                  {result.summary.enriched} enriched · {result.summary.created} created · {result.summary.skipped} skipped ·{" "}
                  {result.summary.conflict} conflict · {result.summary.unchanged} unchanged · {result.summary.error} error
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium uppercase tracking-[0.06em] text-muted-foreground">Import history</h2>
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-[0.06em] text-muted-foreground">
                  <tr className="border-b border-border/60">
                    <th className="px-3 py-2">File</th>
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">Rows</th>
                    <th className="px-3 py-2">Enriched</th>
                    <th className="px-3 py-2">Created</th>
                    <th className="px-3 py-2">Skipped</th>
                    <th className="px-3 py-2">Conflict</th>
                    <th className="px-3 py-2">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((b) => (
                    <tr key={b.id} className="border-b border-border/40">
                      <td className="px-3 py-2">{b.filename}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(b.createdAt).toLocaleString()}</td>
                      <td className="px-3 py-2">{b.totalRows}</td>
                      <td className="px-3 py-2 text-success">{b.enriched}</td>
                      <td className="px-3 py-2 text-success">{b.created}</td>
                      <td className="px-3 py-2 text-muted-foreground">{b.skipped}</td>
                      <td className="px-3 py-2 text-warning">{b.conflict}</td>
                      <td className="px-3 py-2 text-destructive">{b.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}
    </main>
  );
}
