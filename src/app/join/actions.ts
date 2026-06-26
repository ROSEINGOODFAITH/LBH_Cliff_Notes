"use server";

import { createAffiliateFromSignup, type SignupResult } from "@/lib/affiliates";
import type { Platform } from "@/lib/creators";

// PUBLIC action — intentionally no auth. Anti-abuse is minimal by design (it only
// creates a pending lead + reserved code; nothing is created in Shopify until a
// team member activates it on /affiliates).
export async function joinAction(_prev: SignupResult | null, fd: FormData): Promise<SignupResult> {
  const handle = String(fd.get("handle") ?? "");
  const email = String(fd.get("email") ?? "").trim() || null;
  const displayName = String(fd.get("displayName") ?? "").trim() || null;
  const platformRaw = String(fd.get("platform") ?? "");
  const platform = (["instagram", "tiktok", "youtube"].includes(platformRaw) ? platformRaw : null) as Platform | null;
  if (!handle.trim()) return { ok: false, message: "Please enter your social handle." };
  return createAffiliateFromSignup({ handle, email, displayName, platform });
}
