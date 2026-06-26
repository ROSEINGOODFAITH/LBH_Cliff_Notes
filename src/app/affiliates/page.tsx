import { requireTeamMember } from "@/lib/auth";
import { AppNav } from "@/components/app-nav";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { listAffiliatesWithPerf } from "@/lib/affiliates";
import { shopifyConfigured } from "@/lib/shopify";
import { formatUSD } from "@/lib/utils";
import { SyncOrdersButton, ActivateButton } from "./affiliate-forms";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, BadgeProps["variant"]> = {
  active: "success",
  pending: "warning",
  paused: "secondary",
  revoked: "destructive",
};

export default async function AffiliatesPage() {
  const team = await requireTeamMember();
  const affs = await listAffiliatesWithPerf();
  const shopifyOn = shopifyConfigured();

  return (
    <div className="min-h-screen">
      <AppNav active="/affiliates" email={team.email} />
      <main className="container space-y-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-sm font-semibold">Affiliates</h1>
            <p className="text-xs text-muted-foreground">
              Public signup form lives at{" "}
              <a href="/join" target="_blank" rel="noreferrer" className="underline underline-offset-2">
                /join
              </a>
              . Activate a creator to mint their unique Shopify code.
            </p>
          </div>
          <SyncOrdersButton disabled={!shopifyOn} />
        </div>

        {!shopifyOn && (
          <div className="rounded-md border border-border bg-secondary/40 px-4 py-2 text-xs text-muted-foreground">
            Shopify isn&apos;t configured — code activation &amp; order sync are disabled. Add{" "}
            <code>SHOPIFY_ADMIN_TOKEN</code> + <code>SHOPIFY_STORE_DOMAIN</code>.
          </div>
        )}

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="p-3 font-medium">Creator</th>
                    <th className="p-3 font-medium">Code</th>
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 font-medium">Comm.</th>
                    <th className="p-3 font-medium">Orders</th>
                    <th className="p-3 font-medium">Revenue</th>
                    <th className="p-3 font-medium">AOV</th>
                    <th className="p-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {affs.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-sm text-muted-foreground">
                        No affiliates yet. Share the <a href="/join" className="underline">/join</a> link.
                      </td>
                    </tr>
                  ) : (
                    affs.map((a) => (
                      <tr key={a.affiliate.id} className="border-b border-border/60 last:border-0">
                        <td className="p-3">
                          <div className="font-medium">@{a.handle}</div>
                          <div className="text-xs text-muted-foreground">{a.email ?? ""}</div>
                        </td>
                        <td className="p-3 font-mono text-xs">{a.affiliate.discountCode}</td>
                        <td className="p-3">
                          <Badge variant={STATUS_VARIANT[a.affiliate.status] ?? "outline"}>{a.affiliate.status}</Badge>
                        </td>
                        <td className="p-3 tabular-nums">{a.affiliate.commissionPct ?? "—"}%</td>
                        <td className="p-3 tabular-nums">{a.orders}</td>
                        <td className="p-3 tabular-nums">{formatUSD(a.revenueCents)}</td>
                        <td className="p-3 tabular-nums">{a.aovCents != null ? formatUSD(a.aovCents) : "—"}</td>
                        <td className="p-3 text-right">
                          {a.affiliate.status === "active" ? (
                            <span className="text-xs text-muted-foreground">live</span>
                          ) : (
                            <ActivateButton affiliateId={a.affiliate.id} disabled={!shopifyOn} />
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
