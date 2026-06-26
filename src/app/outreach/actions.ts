"use server";

import { revalidatePath } from "next/cache";
import { requireTeamMember } from "@/lib/auth";
import {
  createOrRegenerateDraft,
  approveAndSend,
  updateDraftBody,
  createCampaign,
  syncReplies,
  type ActionResult,
} from "@/lib/outreach";

type CampaignObjective = "gifting" | "affiliate" | "paid";

export async function generateDraftAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireTeamMember();
  const creatorId = String(fd.get("creatorId") ?? "");
  const campaignId = (fd.get("campaignId") as string) || null;
  if (!creatorId) return { ok: false, message: "Pick a creator first." };
  const res = await createOrRegenerateDraft(creatorId, campaignId || null);
  revalidatePath("/outreach");
  return res;
}

export async function sendDraftAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireTeamMember();
  const threadId = String(fd.get("threadId") ?? "");
  if (!threadId) return { ok: false, message: "Missing thread." };
  const res = await approveAndSend(threadId);
  revalidatePath("/outreach");
  revalidatePath("/inbox");
  return res;
}

export async function editDraftAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireTeamMember();
  const threadId = String(fd.get("threadId") ?? "");
  const body = String(fd.get("body") ?? "");
  if (!threadId || !body.trim()) return { ok: false, message: "Nothing to save." };
  const res = await updateDraftBody(threadId, body.trim());
  revalidatePath("/outreach");
  return res;
}

export async function createCampaignAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireTeamMember();
  const name = String(fd.get("name") ?? "").trim();
  const raw = String(fd.get("objective") ?? "gifting");
  const objective = (["gifting", "affiliate", "paid"].includes(raw) ? raw : "gifting") as CampaignObjective;
  const skus = String(fd.get("productSkus") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!name) return { ok: false, message: "Campaign name is required." };
  await createCampaign({ name, objective, productSkus: skus.length ? skus : undefined });
  revalidatePath("/outreach");
  return { ok: true, message: `Campaign "${name}" created.` };
}

export async function followUpAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireTeamMember();
  const creatorId = String(fd.get("creatorId") ?? "");
  const campaignId = (fd.get("campaignId") as string) || null;
  if (!creatorId) return { ok: false, message: "Missing creator." };
  const res = await createOrRegenerateDraft(creatorId, campaignId || null, true);
  revalidatePath("/inbox");
  revalidatePath("/outreach");
  return res.ok
    ? { ...res, message: `${res.message} Review & send it on the Outreach page.` }
    : res;
}

export async function syncRepliesAction(
  _prev: { ok: boolean; message: string } | null,
): Promise<{ ok: boolean; message: string }> {
  await requireTeamMember();
  const res = await syncReplies();
  revalidatePath("/inbox");
  return { ok: res.ok, message: res.message };
}
