import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Public routes — everything else requires a signed-in user.
 *  - /sign-in        Clerk sign-in
 *  - /join           public affiliate signup (P3)
 *  - /api/health     unauthenticated health check
 *  - /api/webhooks   Shopify / Inngest webhooks (verified by signature, P3+)
 */
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/join(.*)",
  "/api/health",
  "/api/webhooks(.*)",
  "/api/inngest(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return NextResponse.next();
  await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next internals and static files, run on everything else
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|png|gif|svg|ico|webp|woff2?|ttf|map)).*)",
    "/(api|trpc)(.*)",
  ],
};
