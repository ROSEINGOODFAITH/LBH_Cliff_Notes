"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, fieldClass } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { StageBadge } from "@/components/stage-badge";
import {
  ACTION_TYPES,
  FLOW_ACTION_TYPES,
  validateFlow,
  moveStep,
  removeStep,
  relink,
  flowHasErrors,
  type FlowStep,
  type FlowActionType,
  type FlowIssue,
} from "@/lib/pulse-flow";
import { CREATOR_STAGES, stageMeta, type CreatorStage } from "@/lib/lifecycle";
import { RELATIONSHIP_TIERS, type RelationshipTier } from "@/lib/relationship";
import { TEMPLATE_KEYS, type TemplateKey } from "@/lib/pulse-templates";
import { cn } from "@/lib/utils";

/* PULSE action-flow builder (spec part A). An ordered, editable grid of the
 * actions the operator runs AROUND the canonical lifecycle. Reordering uses
 * explicit move up/down controls (never a drag canvas), and the flow is
 * validated live — a flow with errors cannot be saved. The Gmail sender
 * identity is shown up top; a wrong/unconnected account blocks live sends
 * (drafts/queueing still work). */

type GmailIdentity = {
  status: "connected" | "wrong_account" | "not_connected" | "demo";
  connectedEmail: string | null;
  expected: string;
  canSend: boolean;
  message: string;
};

type FlowRunView = {
  id: string;
  creatorId: string;
  stepKey: string;
  status: string;
  scheduledFor: string | null;
  lastRunAt: string | null;
  attempts: number;
  lastError: string | null;
  step: FlowStep | null;
};

const RUN_ACTIONS: Array<{ key: "approve" | "skip" | "retry" | "reschedule" | "cancel"; label: string }> = [
  { key: "approve", label: "Approve" },
  { key: "reschedule", label: "Reschedule" },
  { key: "retry", label: "Retry" },
  { key: "skip", label: "Skip" },
  { key: "cancel", label: "Cancel" },
];

function issueTone(sev: FlowIssue["severity"]): string {
  return sev === "error" ? "text-destructive" : "text-warning";
}

function identityTone(status: GmailIdentity["status"]): string {
  return status === "connected" ? "border-success/30 bg-success/10 text-success" : "border-warning/30 bg-warning/10 text-warning";
}

export default function FlowPage() {
  const [steps, setSteps] = useState<FlowStep[]>([]);
  const [identity, setIdentity] = useState<GmailIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [serverIssues, setServerIssues] = useState<FlowIssue[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/pulse/flow").catch(() => null);
    const j = r && r.ok ? await r.json().catch(() => null) : null;
    if (j) {
      setSteps(relink(j.steps as FlowStep[]));
      setIdentity(j.identity as GmailIdentity);
      setServerIssues((j.issues as FlowIssue[]) ?? []);
    } else {
      setMsg("Could not load the flow.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const issues = useMemo(() => validateFlow(steps), [steps]);
  const errorKeys = useMemo(
    () => new Set(issues.filter((i) => i.severity === "error" && i.stepKey).map((i) => i.stepKey as string)),
    [issues],
  );
  const hasErrors = flowHasErrors(steps);

  const update = (index: number, patch: Partial<FlowStep>) =>
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  const toggleTier = (index: number, tier: RelationshipTier) =>
    setSteps((prev) =>
      prev.map((s, i) => {
        if (i !== index) return s;
        const has = s.tiers.includes(tier);
        return { ...s, tiers: has ? s.tiers.filter((t) => t !== tier) : [...s.tiers, tier] };
      }),
    );

  const addStep = () =>
    setSteps((prev) => {
      let n = prev.length + 1;
      let key = `step-${n}`;
      const existing = new Set(prev.map((s) => s.key));
      while (existing.has(key)) key = `step-${++n}`;
      const fresh: FlowStep = {
        key,
        name: "New step",
        actionType: "qualify",
        stage: null,
        tiers: [...RELATIONSHIP_TIERS],
        templateKey: null,
        delayMinutes: null,
        approvalRequired: true,
        autoSendsExternal: false,
        enabled: true,
        nextStepKey: null,
      };
      return relink([...prev, fresh]);
    });

  const save = async () => {
    setSaving(true);
    setMsg("");
    const r = await fetch("/api/pulse/flow", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ steps: relink(steps) }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setSaving(false);
    if (!r || !r.ok) {
      setServerIssues((j.issues as FlowIssue[]) ?? []);
      setMsg(j.error ?? "Save failed.");
      return;
    }
    setSteps(relink(j.steps as FlowStep[]));
    setServerIssues((j.issues as FlowIssue[]) ?? []);
    setMsg("Flow saved.");
  };

  return (
    <div className="min-h-screen">
      <AppNav active="/pulse/flow" />
      <main className="container max-w-5xl space-y-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">Action flow</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              The ordered actions PULSE runs around the lifecycle. Reorder with the up/down controls. Nothing sends
              until a run is explicitly approved — editing this flow never advances a stage.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={saving}>
              Reset
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={saving || hasErrors} data-testid="save-flow">
              {saving ? "Saving…" : "Save flow"}
            </Button>
          </div>
        </div>

        {identity && (
          <div
            data-testid="gmail-identity"
            className={cn("rounded-cell border p-3 text-sm", identityTone(identity.status))}
          >
            <span className="font-medium">Sender: {identity.expected}</span> — {identity.message}
            {!identity.canSend && (
              <span className="ml-1 opacity-90">Live sending is blocked; drafts still queue for approval.</span>
            )}
          </div>
        )}

        {msg && (
          <div role="status" className={cn("text-sm font-medium", hasErrors ? "text-warning" : "text-success")}>
            {msg}
          </div>
        )}

        {(hasErrors || issues.length > 0) && (
          <Card>
            <CardContent className="space-y-1 p-4" data-testid="flow-issues">
              <div className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
                Validation ({issues.filter((i) => i.severity === "error").length} errors,{" "}
                {issues.filter((i) => i.severity === "warning").length} warnings)
              </div>
              {issues.map((i, n) => (
                <div key={`${i.code}-${i.stepKey}-${n}`} className={cn("text-sm", issueTone(i.severity))}>
                  {i.message}
                </div>
              ))}
              {serverIssues.length > 0 && issues.length === 0 && (
                <div className="text-sm text-muted-foreground">Last save reported no blocking issues.</div>
              )}
            </CardContent>
          </Card>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading flow…</p>
        ) : (
          <div className="space-y-3">
            {steps.map((s, i) => {
              const meta = ACTION_TYPES[s.actionType];
              const stepHasError = errorKeys.has(s.key);
              return (
                <Card
                  key={s.key}
                  data-testid={`flow-step-${s.key}`}
                  className={cn(!s.enabled && "opacity-60", stepHasError && "border-destructive/50")}
                >
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground">{i + 1}</span>
                        <div className="flex flex-col">
                          <span className="text-xs font-mono text-muted-foreground">{s.key}</span>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {s.stage && <StageBadge stage={s.stage} />}
                            {meta.sendsExternal && <Badge variant="outline">external</Badge>}
                            {meta.movesValue && <Badge variant="outline">value</Badge>}
                            {!s.enabled && <Badge variant="secondary">disabled</Badge>}
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 w-7 p-0"
                          disabled={i === 0}
                          aria-label="Move up"
                          data-testid={`move-up-${s.key}`}
                          onClick={() => setSteps((prev) => moveStep(prev, i, -1))}
                        >
                          ↑
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 w-7 p-0"
                          disabled={i === steps.length - 1}
                          aria-label="Move down"
                          data-testid={`move-down-${s.key}`}
                          onClick={() => setSteps((prev) => moveStep(prev, i, 1))}
                        >
                          ↓
                        </Button>
                        <Button
                          size="sm"
                          variant={s.enabled ? "outline" : "default"}
                          className="h-7 text-xs"
                          onClick={() => update(i, { enabled: !s.enabled })}
                        >
                          {s.enabled ? "Disable" : "Enable"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs text-destructive"
                          data-testid={`remove-${s.key}`}
                          onClick={() => setSteps((prev) => removeStep(prev, s.key))}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <label className="space-y-1">
                        <span className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">Name</span>
                        <Input value={s.name} onChange={(e) => update(i, { name: e.target.value })} />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">Action</span>
                        <select
                          value={s.actionType}
                          className={fieldClass}
                          data-testid={`action-${s.key}`}
                          onChange={(e) => update(i, { actionType: e.target.value as FlowActionType })}
                        >
                          {FLOW_ACTION_TYPES.map((a) => (
                            <option key={a} value={a}>
                              {ACTION_TYPES[a].label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">Stage (trigger)</span>
                        <select
                          value={s.stage ?? ""}
                          className={fieldClass}
                          onChange={(e) => update(i, { stage: (e.target.value || null) as CreatorStage | null })}
                        >
                          <option value="">— none —</option>
                          {CREATOR_STAGES.map((st) => (
                            <option key={st} value={st}>
                              {stageMeta(st).label} ({st})
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
                          Template {meta.needsTemplate && <span className="text-destructive">required</span>}
                        </span>
                        <select
                          value={s.templateKey ?? ""}
                          className={cn(fieldClass, meta.needsTemplate && !s.templateKey && "border-destructive")}
                          onChange={(e) => update(i, { templateKey: (e.target.value || null) as TemplateKey | null })}
                        >
                          <option value="">— none —</option>
                          {TEMPLATE_KEYS.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
                          Delay (min) {meta.needsDelay && <span className="text-destructive">required</span>}
                        </span>
                        <Input
                          type="number"
                          min={0}
                          value={s.delayMinutes ?? ""}
                          className={cn(meta.needsDelay && !(s.delayMinutes && s.delayMinutes > 0) && "border-destructive")}
                          onChange={(e) => update(i, { delayMinutes: e.target.value === "" ? null : Number(e.target.value) })}
                        />
                      </label>

                      <div className="space-y-1">
                        <span className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">Applies to tiers</span>
                        <div className="flex gap-1">
                          {RELATIONSHIP_TIERS.map((t) => (
                            <Button
                              key={t}
                              size="sm"
                              variant={s.tiers.includes(t) ? "default" : "outline"}
                              className="h-8 text-xs"
                              onClick={() => toggleTier(i, t)}
                            >
                              {t}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 border-t border-border/60 pt-3 text-sm">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={s.approvalRequired}
                          onChange={(e) => update(i, { approvalRequired: e.target.checked })}
                        />
                        <span>Requires approval</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={s.autoSendsExternal}
                          disabled={!meta.sendsExternal}
                          onChange={(e) => update(i, { autoSendsExternal: e.target.checked })}
                        />
                        <span className={cn(!meta.sendsExternal && "text-muted-foreground")}>Auto-sends external</span>
                      </label>
                      <span className="text-xs text-muted-foreground">
                        → {s.nextStepKey ? s.nextStepKey : "end of flow"}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            <Button variant="outline" size="sm" onClick={addStep} data-testid="add-step">
              + Add step
            </Button>
          </div>
        )}

        <RunInspector />
      </main>
    </div>
  );
}

/* Per-creator progress (spec A6): paste a creator id to see their seeded runs
 * and drive each one — approve / reschedule / retry / skip / cancel. Every
 * button hits /api/pulse/flow/run, which only transitions state and (for
 * scheduled work) enqueues the approval-gated scheduler; it never sends inline. */
function RunInspector() {
  const [creatorId, setCreatorId] = useState("");
  const [runs, setRuns] = useState<FlowRunView[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const loadRuns = async (id: string) => {
    if (!id) return;
    setBusy(true);
    setNote("");
    const r = await fetch(`/api/pulse/flow/run?creatorId=${encodeURIComponent(id)}`).catch(() => null);
    const j = r && r.ok ? await r.json().catch(() => null) : null;
    setRuns(j ? (j.runs as FlowRunView[]) : []);
    if (!j) setNote("Could not load runs.");
    setBusy(false);
  };

  const act = async (runId: string, action: string) => {
    setBusy(true);
    const r = await fetch("/api/pulse/flow/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId, action }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r || !r.ok) {
      setNote(j.error ?? "Action failed.");
      return;
    }
    await loadRuns(creatorId);
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">Per-creator progress</div>
        <div className="flex gap-2">
          <Input
            placeholder="Creator id"
            value={creatorId}
            onChange={(e) => setCreatorId(e.target.value)}
            data-testid="run-creator-id"
          />
          <Button size="sm" onClick={() => void loadRuns(creatorId)} disabled={busy || !creatorId}>
            Load
          </Button>
        </div>
        {note && <p className="text-sm text-warning">{note}</p>}
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No runs seeded for this creator yet.</p>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => (
              <div key={run.id} className="flex flex-wrap items-center justify-between gap-2 rounded-cell border border-border/60 p-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{run.step?.name ?? run.stepKey}</div>
                  <div className="text-xs text-muted-foreground">
                    {run.status}
                    {run.scheduledFor && ` · ${new Date(run.scheduledFor).toLocaleString("en-US")}`}
                    {run.attempts > 0 && ` · ${run.attempts} attempt(s)`}
                    {run.lastError && <span className="text-destructive"> · {run.lastError}</span>}
                  </div>
                </div>
                <div className="flex gap-1">
                  {RUN_ACTIONS.map((a) => (
                    <Button
                      key={a.key}
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={busy}
                      onClick={() => void act(run.id, a.key)}
                    >
                      {a.label}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
