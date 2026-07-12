import { FUNNEL_STEPS, type FunnelCounts } from "@/lib/lifecycle";
import { cn } from "@/lib/utils";

/**
 * The canonical pipeline funnel. Shape, order, and labels come solely from
 * `FUNNEL_STEPS` (lib/lifecycle); this component only renders. Bars are scaled
 * to the widest step (discovered) so the narrowing reads at a glance.
 */
export function Funnel({
  counts,
  className,
}: {
  counts: FunnelCounts | null;
  className?: string;
}) {
  const max = counts ? Math.max(1, ...FUNNEL_STEPS.map((s) => counts[s.key])) : 1;

  return (
    <div className={cn("space-y-2.5", className)} role="list" aria-label="Creator pipeline funnel">
      {FUNNEL_STEPS.map((step) => {
        const value = counts ? counts[step.key] : null;
        const pct = counts && value != null ? Math.round((value / max) * 100) : 0;
        return (
          <div key={step.key} role="listitem" className="flex items-center gap-3">
            <div className="w-20 shrink-0 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              {step.label}
            </div>
            <div className="relative h-7 flex-1 overflow-hidden rounded-ctrl bg-secondary/50">
              <div
                className="h-full rounded-ctrl bg-primary/25 transition-[width] duration-500"
                style={{ width: `${Math.max(pct, value ? 4 : 0)}%` }}
              />
              <span className="absolute inset-y-0 left-3 flex items-center text-xs font-semibold tnum text-foreground">
                {value != null ? value : "—"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
