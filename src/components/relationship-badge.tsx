import { Badge, type BadgeProps } from "@/components/ui/badge";
import { relationshipMeta, type RelationshipTone } from "@/lib/relationship";
import { cn } from "@/lib/utils";

/**
 * The one place a creator's relationship tier (COLD/WARM/FAM) is rendered as a
 * pill. It is deliberately visually distinct from StageBadge — relationship
 * strength is a separate axis from the canonical lifecycle stage and the ring.
 */
const TONE_VARIANT: Record<RelationshipTone, BadgeProps["variant"]> = {
  neutral: "outline",
  active: "secondary",
  done: "success",
};

export function RelationshipBadge({
  tier,
  className,
}: {
  tier: string | null | undefined;
  className?: string;
}) {
  const meta = relationshipMeta(tier);
  if (!meta) return null;
  return (
    <Badge variant={TONE_VARIANT[meta.tone]} className={cn(className)} title={meta.description}>
      {meta.label}
    </Badge>
  );
}
