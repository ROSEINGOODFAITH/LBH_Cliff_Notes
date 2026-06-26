import { cn } from "@/lib/utils";

// Explicit span maps so Tailwind's JIT keeps these classes.
const COL: Record<number, string> = {
  1: "col-span-1",
  2: "col-span-2",
};
const LG: Record<number, string> = {
  2: "lg:col-span-2",
  3: "lg:col-span-3",
  4: "lg:col-span-4",
  5: "lg:col-span-5",
  6: "lg:col-span-6",
  7: "lg:col-span-7",
  8: "lg:col-span-8",
  12: "lg:col-span-12",
};

export function BentoGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-4 lg:grid-cols-12 lg:gap-5", className)}>{children}</div>;
}

export function BentoCell({
  span = 3,
  mobile = 2,
  className,
  children,
}: {
  span?: number;
  mobile?: 1 | 2;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("bento bento-hover rounded-cell bg-card p-6", COL[mobile], LG[span], className)}>
      {children}
    </div>
  );
}

export function StatTile({
  label,
  value,
  sub,
  span = 3,
  mobile = 1,
  accent = false,
}: {
  label: string;
  value: string;
  sub?: string;
  span?: number;
  mobile?: 1 | 2;
  accent?: boolean;
}) {
  return (
    <div className={cn("bento bento-hover rounded-cell bg-card p-5", COL[mobile], LG[span])}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-2 text-3xl font-semibold tnum tracking-[-0.02em]",
          accent ? "text-primary" : "text-foreground",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
