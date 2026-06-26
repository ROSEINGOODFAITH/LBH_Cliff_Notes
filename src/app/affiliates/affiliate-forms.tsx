"use client";

import { useActionState } from "react";
import { activateAffiliateAction, syncOrdersAction } from "./actions";
import { Button } from "@/components/ui/button";

export function SyncOrdersButton({ disabled }: { disabled?: boolean }) {
  const [state, action, pending] = useActionState<{ ok: boolean; message: string } | null, FormData>(
    syncOrdersAction,
    null,
  );
  return (
    <form action={action} className="flex items-center gap-3">
      <Button type="submit" size="sm" disabled={pending || disabled} title={disabled ? "Add Shopify env to enable" : undefined}>
        {pending ? "Syncing…" : "Sync attributed orders"}
      </Button>
      {state && <span className={state.ok ? "text-xs text-success" : "text-xs text-destructive"}>{state.message}</span>}
    </form>
  );
}

export function ActivateButton({ affiliateId, disabled }: { affiliateId: string; disabled?: boolean }) {
  const [state, action, pending] = useActionState<{ ok: boolean; message: string } | null, FormData>(
    activateAffiliateAction,
    null,
  );
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="affiliateId" value={affiliateId} />
      <Button type="submit" size="sm" disabled={pending || disabled} title={disabled ? "Add Shopify env to enable" : undefined}>
        {pending ? "Activating…" : "Activate code"}
      </Button>
      {state && !state.ok && <span className="text-xs text-destructive">{state.message}</span>}
    </form>
  );
}
