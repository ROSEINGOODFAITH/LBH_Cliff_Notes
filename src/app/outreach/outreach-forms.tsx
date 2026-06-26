"use client";

import { useActionState } from "react";
import {
  generateDraftAction,
  sendDraftAction,
  editDraftAction,
  createCampaignAction,
} from "./actions";
import type { ActionResult } from "@/lib/outreach";
import { Button } from "@/components/ui/button";
import { Input, fieldClass } from "@/components/ui/input";

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <span className={state.ok ? "text-xs text-success" : "text-xs text-destructive"}>{state.message}</span>;
}

export function CreateCampaignForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createCampaignAction, null);
  return (
    <form action={action} className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Input name="name" placeholder="Campaign name *" required />
        <select name="objective" className={fieldClass} defaultValue="gifting">
          <option value="gifting">Gifting</option>
          <option value="affiliate">Affiliate</option>
          <option value="paid">Paid</option>
        </select>
      </div>
      <Input name="productSkus" placeholder="Product SKUs (comma separated, optional)" />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? "Creating…" : "Create campaign"}
        </Button>
        <Msg state={state} />
      </div>
    </form>
  );
}

export function GenerateForm({
  creators,
  campaigns,
  disabled,
}: {
  creators: { id: string; handle: string; email: string | null }[];
  campaigns: { id: string; name: string }[];
  disabled?: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(generateDraftAction, null);
  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select name="creatorId" className={`${fieldClass} min-w-[220px]`} defaultValue="" required>
          <option value="" disabled>
            Select creator…
          </option>
          {creators.map((c) => (
            <option key={c.id} value={c.id}>
              @{c.handle}
              {c.email ? "" : " (no email)"}
            </option>
          ))}
        </select>
        <select name="campaignId" className={`${fieldClass} min-w-[200px]`} defaultValue="">
          <option value="">No campaign</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" disabled={pending || disabled} title={disabled ? "Add ANTHROPIC_API_KEY to enable" : undefined}>
          {pending ? "Generating…" : "Generate draft"}
        </Button>
        <Msg state={state} />
      </div>
    </form>
  );
}

export function DraftCard({
  threadId,
  creatorId,
  campaignId,
  handle,
  email,
  subject,
  body,
  generateDisabled,
  sendDisabled,
}: {
  threadId: string;
  creatorId: string;
  campaignId: string | null;
  handle: string;
  email: string | null;
  subject: string | null;
  body: string;
  generateDisabled?: boolean;
  sendDisabled?: boolean;
}) {
  const [editState, editAction, editing] = useActionState<ActionResult | null, FormData>(editDraftAction, null);
  const [regenState, regenAction, regening] = useActionState<ActionResult | null, FormData>(generateDraftAction, null);
  const [sendState, sendAction, sending] = useActionState<ActionResult | null, FormData>(sendDraftAction, null);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-medium">@{handle}</div>
        <div className="text-xs text-muted-foreground">{email ?? "no email on file"}</div>
      </div>
      <div className="mb-2 text-xs text-muted-foreground">
        Subject: <span className="text-foreground">{subject ?? "—"}</span>
      </div>
      <form action={editAction} className="space-y-2">
        <input type="hidden" name="threadId" value={threadId} />
        <textarea name="body" defaultValue={body} rows={7} className={`${fieldClass} h-auto py-2 text-sm leading-relaxed`} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" variant="secondary" disabled={editing}>
            {editing ? "Saving…" : "Save edits"}
          </Button>
          <Msg state={editState} />
        </div>
      </form>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <form action={regenAction} className="inline">
          <input type="hidden" name="creatorId" value={creatorId} />
          <input type="hidden" name="campaignId" value={campaignId ?? ""} />
          <Button type="submit" size="sm" variant="outline" disabled={regening || generateDisabled}>
            {regening ? "Regenerating…" : "Regenerate"}
          </Button>
        </form>
        <form action={sendAction} className="inline">
          <input type="hidden" name="threadId" value={threadId} />
          <Button type="submit" size="sm" disabled={sending || sendDisabled || !email} title={!email ? "Creator has no email" : sendDisabled ? "Add GMAIL_* to enable" : "Approve & send"}>
            {sending ? "Sending…" : "Approve & send"}
          </Button>
        </form>
        <Msg state={regenState} />
        <Msg state={sendState} />
      </div>
    </div>
  );
}
