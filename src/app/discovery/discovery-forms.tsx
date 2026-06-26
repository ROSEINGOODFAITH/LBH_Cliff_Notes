"use client";

import { useActionState } from "react";
import {
  runCompetitorDiscovery,
  approveCandidate,
  dismissCandidate,
  type DiscoveryResult,
} from "./actions";
import { Button } from "@/components/ui/button";
import { Input, fieldClass } from "@/components/ui/input";

export function RunDiscoveryForm({
  disabled,
  defaultCompetitors,
}: {
  disabled?: boolean;
  defaultCompetitors?: string;
}) {
  const [state, action, pending] = useActionState<DiscoveryResult | null, FormData>(
    runCompetitorDiscovery,
    null,
  );
  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select name="platform" className={`${fieldClass} max-w-[160px]`} defaultValue="instagram">
          <option value="instagram">Instagram</option>
          <option value="tiktok">TikTok</option>
          <option value="youtube">YouTube</option>
        </select>
        <Input
          name="competitors"
          placeholder={defaultCompetitors || "Competitor handles (comma separated)"}
          className="min-w-[280px] flex-1"
        />
        <Button
          type="submit"
          size="sm"
          disabled={pending || disabled}
          title={disabled ? "Add MODASH_API_KEY to enable" : undefined}
        >
          {pending ? "Scanning…" : "Run discovery"}
        </Button>
      </div>
      {state && (
        <p className={state.ok ? "text-xs text-success" : "text-xs text-destructive"}>{state.message}</p>
      )}
    </form>
  );
}

export function ApproveButton({ candidateId }: { candidateId: string }) {
  const [state, action, pending] = useActionState<DiscoveryResult | null, FormData>(approveCandidate, null);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="candidateId" value={candidateId} />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Approve"}
      </Button>
      {state && !state.ok && <span className="ml-2 text-xs text-destructive">{state.message}</span>}
    </form>
  );
}

export function DismissButton({ candidateId }: { candidateId: string }) {
  return (
    <form action={dismissCandidate} className="inline">
      <input type="hidden" name="candidateId" value={candidateId} />
      <Button type="submit" size="sm" variant="ghost">
        Dismiss
      </Button>
    </form>
  );
}
