"use server";

import { revalidatePath } from "next/cache";
import { requireTeamMember } from "@/lib/auth";
import { syncBrandMentions } from "@/lib/content";

export async function syncMentionsAction(
  _prev: { ok: boolean; message: string } | null,
): Promise<{ ok: boolean; message: string }> {
  await requireTeamMember();
  const res = await syncBrandMentions();
  revalidatePath("/content");
  revalidatePath("/");
  return { ok: res.ok, message: res.message };
}
