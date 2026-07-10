import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { creators } from "@/db/schema";
import { suggestedRateUsd } from "@/lib/model";

export async function GET() {
  const queue = await db.select().from(creators).where(eq(creators.stage, "review")).orderBy(desc(creators.fitScore)).limit(50);
  return NextResponse.json(queue.map((c) => ({ ...c, suggestedRate: suggestedRateUsd(c.avgViews) })));
}
