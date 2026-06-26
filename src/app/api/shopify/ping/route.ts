import { NextResponse } from "next/server";
import { getRecentOrders, ShopifyNotConfiguredError } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * P0 checkpoint: prove the Shopify Admin connection by reading a real order.
 * Protected by middleware (team-only). Returns a sanitized order summary.
 */
export async function GET() {
  try {
    const orders = await getRecentOrders(1);
    return NextResponse.json({
      ok: true,
      message:
        orders.length > 0
          ? "Shopify connection verified — read a live order."
          : "Connected to Shopify, but no orders exist yet.",
      orders,
    });
  } catch (e) {
    if (e instanceof ShopifyNotConfiguredError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
