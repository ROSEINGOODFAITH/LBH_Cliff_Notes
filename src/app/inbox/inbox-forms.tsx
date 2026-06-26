"use client";

import { useActionState } from "react";
import { syncRepliesAction, followUpAction } from "../outreach/actions";
import type { ActionResult } from "@/lib/outreach";
import { Button } from "@/components/ui/button";

export function SyncNowButton({ disabled }: { disabled?: boolean }) {
  const [state, action, pending] = useActionState<{ ok: boolean; message: string } | null, FormData>(
    syncRepliesAction,
    null,
  );
  return (
    <form action={action} className="flex items-center gap-3">
      <Button type="submit" size="sm" disabled={pending || disabled} title={disabled ? "Add GMAIL_* to enable" : undefined}>
        {pending ? "Syncing…" : "Sync replies now"}
      </Button>
      {state && <span className={state.ok ? "text-xs text-success" : "text-xs text-destructive"}>{state.message}</span>}
    </form>
  );
}

export function FollowUpButton({
  creatorId,
  campaignId,
  disabled,
}: {
  creatorId: string;
  campaignId: string | null;
  disabled?: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(followUpAction, null);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="creatorId" value={creatorId} />
      <input type="hidden" name="campaignId" value={campaignId ?? ""} />
      <Button type="submit" size="sm" variant="outline" disabled={pending || disabled} title={disabled ? "Add ANTHROPIC_API_KEY to enable" : undefined}>
        {pending ? "Drafting…" : "Draft follow-up"}
      </Button>
      {state && !state.ok && <span className="text-xs text-destructive">{state.message}</span>}
      {state && state.ok && <span className="text-xs text-success">✓ ready on Outreach</span>}
    </form>
  );
}
