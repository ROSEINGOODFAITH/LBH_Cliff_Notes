"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RelationshipBadge } from "@/components/relationship-badge";
import { RELATIONSHIP_TIERS, type RelationshipTier } from "@/lib/relationship";
import { cn } from "@/lib/utils";

/**
 * Edit a creator's relationship tier independently of the lifecycle stage. Posts
 * only to /api/pulse/relationship, which writes `relationshipTier` and nothing
 * else — changing the tier never moves the stage.
 */
export function RelationshipEditor({
  creatorId,
  initialTier,
}: {
  creatorId: string;
  initialTier: string | null;
}) {
  const [tier, setTier] = useState<RelationshipTier | null>(
    initialTier && (RELATIONSHIP_TIERS as string[]).includes(initialTier) ? (initialTier as RelationshipTier) : null,
  );
  const [saving, setSaving] = useState(false);

  const set = async (next: RelationshipTier | null) => {
    if (saving) return;
    setSaving(true);
    const prev = tier;
    setTier(next); // optimistic
    const r = await fetch("/api/pulse/relationship", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creatorId, relationshipTier: next }),
    }).catch(() => null);
    if (!r || !r.ok) setTier(prev); // revert on failure
    setSaving(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="relationship-editor">
      <span className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">Relationship</span>
      {tier ? <RelationshipBadge tier={tier} /> : <span className="text-sm text-muted-foreground">—</span>}
      <div className="flex gap-1">
        {RELATIONSHIP_TIERS.map((t) => (
          <Button
            key={t}
            size="sm"
            variant={tier === t ? "default" : "outline"}
            className={cn("h-7 px-2 text-xs")}
            disabled={saving}
            onClick={() => set(tier === t ? null : t)}
          >
            {t}
          </Button>
        ))}
      </div>
    </div>
  );
}
