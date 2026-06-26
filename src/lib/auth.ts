import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { brandConfig } from "@/lib/brand";

/**
 * Single-team auth. Clerk handles identity; the team allowlist in brand.config
 * decides who actually gets in. (Also set Clerk Dashboard → Restrictions →
 * Allowlist for defense-in-depth so strangers can't even create an account.)
 */
export interface TeamUser {
  userId: string;
  email: string | null;
  allowed: boolean;
}

export async function getTeamUser(): Promise<TeamUser | null> {
  const user = await currentUser();
  if (!user) return null;
  const email = user.primaryEmailAddress?.emailAddress?.toLowerCase() ?? null;
  const allowlist = brandConfig.teamEmails.map((e) => e.toLowerCase());
  return { userId: user.id, email, allowed: Boolean(email && allowlist.includes(email)) };
}

/** Use at the top of any protected page/server action. */
export async function requireTeamMember(): Promise<TeamUser> {
  const t = await getTeamUser();
  if (!t) redirect("/sign-in");
  if (!t.allowed) redirect("/not-authorized");
  return t;
}
