import { NextRequest, NextResponse } from "next/server";
import { desc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { creators } from "@/db/schema";

/** Who's at a belt station. Plain-word station keys map onto internal stages. */
const STATIONS: Record<string, string[]> = {
  sourced: ["sourced"],
  review: ["review"],
  contacted: ["contacted"],
  replied: ["replied"],
  shipping: ["onboarded", "shipped"],
  posted: ["posted"],
  paid: ["paid"],
};

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("station") ?? "";
  const stages = STATIONS[key];
  if (!stages) return NextResponse.json({ error: "unknown station" }, { status: 400 });
  const rows = await db.select({
    id: creators.id,
    handle: creators.handle,
    displayName: creators.displayName,
    primaryPlatform: creators.primaryPlatform,
    stage: creators.stage,
    email: creators.email,
    trackingNumber: creators.trackingNumber,
    postUrl: creators.postUrl,
    updatedAt: creators.updatedAt,
  }).from(creators)
    .where(inArray(creators.stage, stages as any))
    .orderBy(desc(creators.updatedAt))
    .limit(100);
  return NextResponse.json({ creators: rows });
}
