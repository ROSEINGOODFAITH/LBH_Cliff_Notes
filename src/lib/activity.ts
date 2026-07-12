import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { events, outreachEvents, decisions } from "@/db/schema";

/**
 * A single, source-agnostic audit entry for a creator. We do not invent an
 * activity model — the timeline is assembled from the auditable rows the schema
 * already records: the generic `events` log, PULSE `outreach_events`, and HITL
 * `decisions`. Each source contributes its real timestamp; unsupported detail is
 * simply omitted rather than faked.
 */
export interface ActivityItem {
  id: string;
  kind: "event" | "outreach" | "decision";
  /** Short machine label, e.g. "sent", "tier_a", "pushed". */
  type: string;
  /** Optional one-line human detail derived from the row. */
  detail: string | null;
  at: Date;
}

/** Merge every auditable row for a creator into one reverse-chronological feed. */
export async function getCreatorActivity(creatorId: string, limit = 50): Promise<ActivityItem[]> {
  const [evs, outs, decs] = await Promise.all([
    db.select().from(events).where(eq(events.creatorId, creatorId)).orderBy(desc(events.ts)).limit(limit),
    db
      .select()
      .from(outreachEvents)
      .where(eq(outreachEvents.creatorId, creatorId))
      .orderBy(desc(outreachEvents.occurredAt))
      .limit(limit),
    db
      .select()
      .from(decisions)
      .where(eq(decisions.creatorId, creatorId))
      .orderBy(desc(decisions.decidedAt))
      .limit(limit),
  ]);

  const items: ActivityItem[] = [
    ...evs.map((e) => ({
      id: `event-${e.id}`,
      kind: "event" as const,
      type: e.type,
      detail: null,
      at: e.ts,
    })),
    ...outs.map((o) => ({
      id: `outreach-${o.id}`,
      kind: "outreach" as const,
      type: o.type,
      detail: o.classification,
      at: o.occurredAt,
    })),
    ...decs.map((d) => ({
      id: `decision-${d.id}`,
      kind: "decision" as const,
      type: d.action,
      detail: null,
      at: d.decidedAt,
    })),
  ];

  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}
