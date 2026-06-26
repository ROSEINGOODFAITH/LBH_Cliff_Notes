"use client";

import { useActionState } from "react";
import { joinAction } from "./actions";
import type { SignupResult } from "@/lib/affiliates";
import { Button } from "@/components/ui/button";
import { Input, fieldClass } from "@/components/ui/input";

export function JoinForm() {
  const [state, action, pending] = useActionState<SignupResult | null, FormData>(joinAction, null);

  if (state?.ok) {
    return (
      <div className="rounded-cell bg-card bento p-6 text-center">
        <div className="text-sm">{state.message}</div>
        {state.code && (
          <div className="mt-3 inline-block rounded-md bg-secondary px-3 py-1 font-mono text-sm">{state.code}</div>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-cell bg-card bento p-6">
      <Input name="handle" placeholder="@yourhandle *" required />
      <select name="platform" className={fieldClass} defaultValue="">
        <option value="">Primary platform…</option>
        <option value="instagram">Instagram</option>
        <option value="tiktok">TikTok</option>
        <option value="youtube">YouTube</option>
      </select>
      <Input name="displayName" placeholder="Your name" />
      <Input name="email" type="email" placeholder="Email" />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Submitting…" : "Join the program"}
      </Button>
      {state && !state.ok && <p className="text-center text-xs text-destructive">{state.message}</p>}
    </form>
  );
}
