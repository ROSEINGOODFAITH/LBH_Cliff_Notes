import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/creators", label: "Creators" },
  { href: "/discovery", label: "Discovery" },
  { href: "/outreach", label: "Outreach" },
  { href: "/inbox", label: "Inbox" },
  { href: "/affiliates", label: "Affiliates" },
  { href: "/content", label: "Content" },
];

export function AppNav({ active, email }: { active: string; email?: string | null }) {
  return (
    <header className="frost sticky top-0 z-20 border-b border-border">
      <div className="container flex h-14 items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="text-sm font-semibold tracking-tight">LBH Cliff Notes</span>
          <nav className="flex items-center gap-1">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-sm transition-colors",
                  active === l.href
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {email && <span className="hidden text-xs text-muted-foreground md:inline">{email}</span>}
          <UserButton />
        </div>
      </div>
    </header>
  );
}
