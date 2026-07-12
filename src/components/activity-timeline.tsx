import { Mail, GitBranch, Activity } from "lucide-react";
import type { ActivityItem } from "@/lib/activity";

/**
 * Reverse-chronological audit feed for a creator. Renders only what the audit
 * sources actually recorded (see lib/activity.ts) — no synthetic entries. Empty
 * state is a first-class case: a fresh creator legitimately has no history yet.
 */
const KIND_ICON = {
  event: Activity,
  outreach: Mail,
  decision: GitBranch,
} as const;

function fmt(at: Date): string {
  return new Date(at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ActivityTimeline({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return <div className="text-sm text-muted-foreground">No activity recorded yet.</div>;
  }
  return (
    <ol className="space-y-3" aria-label="Creator activity timeline">
      {items.map((item) => {
        const Icon = KIND_ICON[item.kind];
        return (
          <li key={item.id} className="flex items-start gap-3">
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary/60">
              <Icon className="size-3.5 text-muted-foreground" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{item.type}</span>
                <time className="shrink-0 text-xs tnum text-muted-foreground">{fmt(item.at)}</time>
              </div>
              {item.detail && <div className="text-xs text-muted-foreground">{item.detail}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
