"use client";
import { useState } from "react";
import { AppNav } from "@/components/app-nav";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, fieldClass } from "@/components/ui/input";
import { RelationshipBadge } from "@/components/relationship-badge";
import { RELATIONSHIP_TIERS } from "@/lib/relationship";
import { CREATOR_STAGES, stageMeta } from "@/lib/lifecycle";
import { REVIEW_NEXT_ACTIONS } from "@/lib/pulse-flow";
import { cn } from "@/lib/utils";

/* Screenshot ingestion review — the safe path. An uploaded screenshot only ever
 * SUGGESTS field values; nothing is written until the operator confirms here.
 * The stage defaults to the earliest prospect stage ("Found") and can never be
 * "Replied" implicitly. */

type Field = { value: string | number | null; confidence: number };
type Profile = Record<string, Field>;
const FIELD_ORDER = ["handle", "platform", "displayName", "email", "followerCount", "bio", "profileUrl"] as const;
const LABELS: Record<string, string> = {
  handle: "Handle", platform: "Platform", displayName: "Display name",
  email: "Email", followerCount: "Followers", bio: "Bio", profileUrl: "Profile URL",
};

export default function ScreenshotPage() {
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(false);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState<Record<string, string>>({});
  const [conf, setConf] = useState<Record<string, number>>({});
  const [tier, setTier] = useState<string>("COLD");
  const [stage, setStage] = useState<string>("sourced");
  const [nextAction, setNextAction] = useState<string>("qualify");
  const [extracted, setExtracted] = useState(false);
  const [dupe, setDupe] = useState<{ id: string; handle: string; stage: string } | null>(null);
  const [saved, setSaved] = useState<{ creatorId: string; stage: string } | null>(null);

  const applyProfile = (p: Profile) => {
    const f: Record<string, string> = {};
    const c: Record<string, number> = {};
    for (const k of FIELD_ORDER) {
      f[k] = p[k]?.value == null ? "" : String(p[k].value);
      c[k] = p[k]?.confidence ?? 0;
    }
    setForm(f); setConf(c); setExtracted(true);
  };

  const onFile = async (file: File) => {
    setBusy(true); setMsg(""); setSaved(null); setDupe(null);
    const dataUrl: string = await new Promise((res) => {
      const rd = new FileReader(); rd.onload = () => res(String(rd.result ?? "")); rd.readAsDataURL(file);
    });
    const mediaType = file.type || "image/png";
    const r = await fetch("/api/pulse/screenshot", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: dataUrl, mediaType }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(j.error ?? "Extraction failed."); setBusy(false); return; }
    setDemo(Boolean(j.demo));
    if (j.message) setMsg(j.message);
    applyProfile(j.profile as Profile);
    setBusy(false);
  };

  const confirm = async (mode: "auto" | "update" | "create") => {
    setBusy(true); setMsg("");
    const body: Record<string, unknown> = {
      handle: form.handle, platform: form.platform || null, email: form.email || null,
      displayName: form.displayName || null,
      followerCount: form.followerCount ? Number(form.followerCount) : null,
      bio: form.bio || null, relationshipTier: tier, stage, nextAction, mode,
    };
    const r = await fetch("/api/pulse/screenshot/confirm", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg((j.errors ?? [j.error]).join(" ")); return; }
    if (j.duplicate) { setDupe({ id: j.existing.id, handle: j.existing.handle, stage: j.existing.stage }); setMsg(j.message); return; }
    setDupe(null);
    setSaved({ creatorId: j.creatorId, stage: j.stage });
    setMsg(j.created ? `Saved @${form.handle} at "${stageMeta(j.stage).label}".` : `Updated @${form.handle}.`);
  };

  const setField = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="min-h-screen">
      <AppNav active="/pulse/screenshot" />
      <main className="container max-w-2xl space-y-6 py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Import from screenshot</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Upload a TikTok/Instagram profile screenshot. We suggest the fields — you confirm before anything saves.
            Nothing is marked contacted or replied.
          </p>
        </div>

        {msg && <div role="status" className={cn("text-sm font-medium", saved ? "text-success" : dupe ? "text-warning" : "text-muted-foreground")}>{msg}</div>}

        <Card>
          <CardContent className="space-y-3 p-6">
            <input
              type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-testid="screenshot-file"
              className="block text-xs text-muted-foreground file:mr-3 file:rounded-ctrl file:border file:border-border file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:text-foreground hover:file:bg-accent"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
            />
            {demo && <p className="text-xs text-warning">Vision extraction isn&apos;t live here — fill the fields in manually from the screenshot, then review.</p>}
            {busy && <p className="text-sm text-muted-foreground">Working…</p>}
          </CardContent>
        </Card>

        {extracted && (
          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="space-y-3">
                {FIELD_ORDER.map((k) => {
                  const c = conf[k] ?? 0;
                  const missing = !form[k];
                  const low = !missing && c < 0.6;
                  return (
                    <div key={k}>
                      <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
                        {LABELS[k]}
                        {missing && <span className="text-destructive">missing</span>}
                        {low && <span className="text-warning">low confidence {Math.round(c * 100)}%</span>}
                        {!missing && !low && c > 0 && <span className="text-success">{Math.round(c * 100)}%</span>}
                      </label>
                      {k === "bio" ? (
                        <textarea value={form[k]} onChange={(e) => setField(k, e.target.value)} rows={2}
                          className={cn(fieldClass, "mt-1 h-auto w-full py-2", (missing || low) && "border-warning")} />
                      ) : (
                        <Input value={form[k]} onChange={(e) => setField(k, e.target.value)} data-testid={`field-${k}`}
                          className={cn("mt-1", (missing || low) && "border-warning")} />
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="space-y-3 border-t border-border/60 pt-4">
                <div>
                  <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
                    Relationship <RelationshipBadge tier={tier} />
                  </div>
                  <div className="flex gap-1">
                    {RELATIONSHIP_TIERS.map((t) => (
                      <Button key={t} size="sm" variant={tier === t ? "default" : "outline"} className="h-8 text-xs" onClick={() => setTier(t)}>{t}</Button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">Funnel stage (you choose — defaults to Found)</div>
                  <select value={stage} onChange={(e) => setStage(e.target.value)} data-testid="stage-select" className={cn(fieldClass, "w-full")}>
                    {CREATOR_STAGES.map((s) => <option key={s} value={s}>{stageMeta(s).label} ({s})</option>)}
                  </select>
                </div>

                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">Next action</div>
                  <select value={nextAction} onChange={(e) => setNextAction(e.target.value)} data-testid="next-action-select" className={cn(fieldClass, "w-full")}>
                    {REVIEW_NEXT_ACTIONS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                  </select>
                </div>
              </div>

              {dupe ? (
                <div className="space-y-2 rounded-cell border border-warning/30 bg-warning/10 p-3">
                  <p className="text-sm text-warning">@{dupe.handle} already exists at &quot;{stageMeta(dupe.stage).label}&quot;. Merging fills only empty fields — it won&apos;t overwrite their stage or relationship.</p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => confirm("update")} disabled={busy}>Update existing</Button>
                    <Button size="sm" variant="outline" onClick={() => setDupe(null)} disabled={busy}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 border-t border-border/60 pt-4">
                  <Button onClick={() => confirm("auto")} disabled={busy} data-testid="confirm-save">Save creator</Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
