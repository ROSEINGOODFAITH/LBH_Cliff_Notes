import { Badge, type BadgeProps } from "@/components/ui/badge";
import { stageMeta, type StageTone } from "@/lib/lifecycle";
import { cn } from "@/lib/utils";

/**
 * The one place a creator stage is rendered as a pill. Colour comes from the
 * canonical stage tone (lib/lifecycle), so the vocabulary and treatment stay
 * identical across the overview, the /pulse belt, and the creator list.
 */
const TONE_VARIANT: Record<StageTone, BadgeProps["variant"]> = {
  neutral: "outline",
  attention: "warning",
  active: "secondary",
  done: "success",
  dead: "outline",
};

export function StageBadge({
  stage,
  className,
}: {
  stage: string | null | undefined;
  className?: string;
}) {
  const meta = stageMeta(stage);
  return (
    <Badge
      variant={TONE_VARIANT[meta.tone]}
      className={cn(meta.tone === "dead" && "text-muted-foreground", className)}
    >
      {meta.label}
    </Badge>
  );
}
