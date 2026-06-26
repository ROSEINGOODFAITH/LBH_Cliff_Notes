/**
 * SINGLE-TENANT brand configuration for LBH CLIFF NOTES.
 *
 * This is the ONLY place brand identity lives. There are no tenant tables and no
 * per-org scoping anywhere in the app — everything reads from this object.
 *
 * EDIT-ME fields are placeholders/sensible defaults. Update them and redeploy;
 * nothing else needs to change.
 */

export const brandConfig = {
  brandName: "Laurel Bath House",
  brandDomain: "laurelbathhouse.com",

  /**
   * Shopify *.myshopify.com handle. Confirmed live store: www.laurelbathhouse.com
   * EDIT-ME: paste your exact myshopify handle (Shopify admin → Settings → Domains).
   * Falls back to the SHOPIFY_STORE_DOMAIN env var at runtime.
   */
  shopifyStoreDomain:
    process.env.SHOPIFY_STORE_DOMAIN ?? "laurel-bath-house.myshopify.com",

  /**
   * Competitor brands mined for creators in Module A (Modash brand-mention /
   * lookalike lookups). EDIT-ME: replace with your real competitive set.
   */
  competitorBrands: [
    "Vacation",
    "Dedcool",
    "Nécessaire",
    "Snif",
    "Phlur",
  ] as string[],

  /** Niches used in discovery filters. EDIT-ME as needed. */
  targetNiches: [
    "fragrance",
    "clean beauty",
    "body care",
    "skincare",
    "lifestyle",
    "wellness",
  ] as string[],

  /**
   * Team allowlist for single-team auth. Only these emails may sign in.
   * EDIT-ME: add the rest of your team.
   */
  teamEmails: ["david@un8brands.com"] as string[],

  /**
   * Domain that 1:1 creator outreach is sent from (Gmail send-as / alias).
   * EDIT-ME.
   */
  sendingDomain: "outreach.laurelbathhouse.com",

  /**
   * Brand-voice brief used to seed AI outreach generation in P2. Refine over time.
   */
  brandVoice: {
    tone: "warm, elevated, sensorial, unfussy",
    avoid: ["hype", "emoji-as-personality", "fake urgency", "mass-blast tone"],
    notes:
      "Laurel Bath House is a DTC fragrance + body-care brand. Outreach is 1:1, " +
      "personal, and references the creator's actual content. Never templated-sounding.",
  },
} as const;

export type BrandConfig = typeof brandConfig;
export default brandConfig;
