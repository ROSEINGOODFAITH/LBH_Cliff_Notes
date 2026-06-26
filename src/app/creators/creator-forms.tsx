"use client";

import { useActionState } from "react";
import {
  addCreatorManual,
  importCreatorsCsv,
  seedFromShopify,
  enrichCreator,
  type ActionResult,
} from "./actions";
import { Button } from "@/components/ui/button";
import { Input, fieldClass } from "@/components/ui/input";

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <p className={state.ok ? "text-xs text-success" : "text-xs text-destructive"}>{state.message}</p>;
}

export function AddCreatorForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(addCreatorManual, null);
  return (
    <form action={action} className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Input name="handle" placeholder="@handle *" required />
        <select name="platform" className={fieldClass} defaultValue="">
          <option value="">Platform…</option>
          <option value="instagram">Instagram</option>
          <option value="tiktok">TikTok</option>
          <option value="youtube">YouTube</option>
        </select>
        <Input name="displayName" placeholder="Display name" />
        <Input name="email" type="email" placeholder="Email" />
        <Input name="followerCount" placeholder="Followers" inputMode="numeric" />
        <Input name="niche" placeholder="Niches (comma separated)" />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add creator"}
        </Button>
        <Msg state={state} />
      </div>
    </form>
  );
}

export function CsvImportForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(importCreatorsCsv, null);
  return (
    <form action={action} className="space-y-2">
      <textarea
        name="csv"
        rows={5}
        className={`${fieldClass} h-auto py-2 font-mono text-xs`}
        placeholder={"handle,platform,displayName,email,followers,niche\nashleyx,instagram,Ashley X,ashley@mail.com,42000,clean beauty"}
      />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? "Importing…" : "Import CSV"}
        </Button>
        <Msg state={state} />
      </div>
    </form>
  );
}

export function ShopifySeedForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(seedFromShopify, null);
  return (
    <form action={action} className="space-y-2">
      <Input name="tag" placeholder="Shopify customer tag (default: creator)" />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? "Importing…" : "Seed from Shopify"}
        </Button>
        <Msg state={state} />
      </div>
    </form>
  );
}

export function EnrichButton({ creatorId, disabled }: { creatorId: string; disabled?: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(enrichCreator, null);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="creatorId" value={creatorId} />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={pending || disabled}
        title={disabled ? "Add MODASH_API_KEY to enable" : "Enrich via Modash"}
      >
        {pending ? "Enriching…" : "Enrich"}
      </Button>
      {state && !state.ok && <span className="text-xs text-destructive">{state.message}</span>}
      {state && state.ok && <span className="text-xs text-success">✓</span>}
    </form>
  );
}
