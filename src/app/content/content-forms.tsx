"use client";

import { useActionState } from "react";
import { syncMentionsAction } from "./actions";
import { Button } from "@/components/ui/button";

export function SyncMentionsButton({ disabled }: { disabled?: boolean }) {
  const [state, action, pending] = useActionState<{ ok: boolean; message: string } | null, FormData>(
    syncMentionsAction,
    null,
  );
  return (
    <form action={action} className="flex items-center gap-3">
      <Button type="submit" size="sm" disabled={pending || disabled} title={disabled ? "Add MODASH_API_KEY to enable" : undefined}>
        {pending ? "Scanning…" : "Sync brand mentions"}
      </Button>
      {state && <span className={state.ok ? "text-xs text-success" : "text-xs text-destructive"}>{state.message}</span>}
    </form>
  );
}
