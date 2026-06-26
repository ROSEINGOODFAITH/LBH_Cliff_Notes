"use server";

import { revalidatePath } from "next/cache";
import { requireTeamMember } from "@/lib/auth";
import { activateAffiliate, syncAttributedOrders } from "@/lib/affiliates";

export async function activateAffiliateAction(
  _prev: { ok: boolean; message: string } | null,
  fd: FormData,
): Promise<{ ok: boolean; message: string }> {
  await requireTeamMember();
  const id = String(fd.get("affiliateId") ?? "");
  if (!id) return { ok: false, message: "Missing affiliate." };
  const res = await activateAffiliate(id);
  revalidatePath("/affiliates");
  return res;
}

export async function syncOrdersAction(
  _prev: { ok: boolean; message: string } | null,
): Promise<{ ok: boolean; message: string }> {
  await requireTeamMember();
  const res = await syncAttributedOrders();
  revalidatePath("/affiliates");
  revalidatePath("/");
  return { ok: res.ok, message: res.message };
}
