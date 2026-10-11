import { NextRequest, NextResponse } from "next/server";
import {
  getClientIp,
  isBypassedIp,
  getDailyPageViewCount,
} from "@/lib/server/dailyPageLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Affiliate IDs live here and ONLY get attached for requests that look like
// they came from a real person browsing the site. See hasRealPageView().
const affiliateIds: Record<string, string> = {
  tradingview: "164495",
};

// Plain, un-tagged destination for each partner. A request that hasn't
// earned the affiliate ID still lands exactly where the visitor expected --
// it just doesn't carry our tag.
const plainLinks: Record<string, string> = {
  tradingview: "https://www.tradingview.com/",
  trading212: "https://www.trading212.com/",
  etoro: "https://www.etoro.com/",
  interactivebrokers:
    "https://www.interactivebrokers.com/en/trading/trading-platforms.php",
  saxo: "https://www.home.saxo/",
  webull: "https://www.webull.com/",
  robinhood: "https://robinhood.com/us/en/",
};

/**
 * Has this requester actually rendered a page on this site today?
 *
 * The "site" counter is only ever incremented by the sendBeacon in
 * app/components/PageViewTracker.tsx, which fires on a genuinely
 * client-rendered navigation -- never on a Link prefetch, and never for a
 * client that doesn't execute JavaScript. A scraper hitting this endpoint
 * directly has no recorded view and so can never earn the tag.
 *
 * Deliberately fails OPEN: any doubt (Redis down, unknown IP, the owner's
 * bypassed IP) resolves to "yes, tag it". The cost of a false negative is a
 * lost commission on a real click; the cost of a false positive is only an
 * untagged visit that still reaches the partner. Never a 403, never a
 * broken link.
 */
async function hasRealPageView(request: NextRequest): Promise<boolean> {
  const ip = getClientIp(request.headers);

  // Unknown IP -> can't judge -> give the benefit of the doubt.
  if (!ip || ip === "unknown") return true;

  // The owner's own IPs are deliberately excluded from view recording in
  // /api/internal/track-view, so they'd otherwise always read as zero views
  // and quietly lose attribution on the owner's own clicks.
  if (isBypassedIp(ip)) return true;

  try {
    // "stock" is checked alongside "site" for two reasons: /stock/* pages
    // carry the majority of these links, and for the first day after this
    // shipped some visitors already had a "stock" bucket but not yet a
    // "site" one.
    const [siteViews, stockViews] = await Promise.all([
      getDailyPageViewCount("site", ip),
      getDailyPageViewCount("stock", ip),
    ]);

    return siteViews > 0 || stockViews > 0;
  } catch {
    // getDailyPageViewCount already swallows its own errors, but belt and
    // braces: a fault here must never cost a real visitor their click.
    return true;
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ platform: string }> }
) {
  const { platform } = await context.params;
  const key = platform.toLowerCase();

  const base = plainLinks[key] ?? "https://www.mystockharbor.com/platforms";
  const affiliateId = affiliateIds[key];

  const earned = affiliateId ? await hasRealPageView(request) : false;

  let target = base;

  if (key === "tradingview") {
    const rawSymbol = request.nextUrl.searchParams.get("symbol")?.trim();
    const params = new URLSearchParams();

    if (rawSymbol) {
      params.set("symbol", rawSymbol.toUpperCase());
    }
    if (earned && affiliateId) {
      params.set("aff_id", affiliateId);
    }

    const query = params.toString();

    target = rawSymbol
      ? `https://www.tradingview.com/chart/?${query}`
      : query
        ? `https://www.tradingview.com/?${query}`
        : base;
  } else if (earned && affiliateId) {
    const url = new URL(base);
    url.searchParams.set("aff_id", affiliateId);
    target = url.toString();
  }

  // Logged either way so the tagged/untagged split is measurable in Vercel
  // runtime logs without adding any new storage.
  console.log(
    `Affiliate click: ${key} (${earned ? "tagged" : "untagged-no-pageview"})`
  );

  return NextResponse.redirect(target, {
    status: 308,
    headers: {
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Cache-Control": "no-store",
    },
  });
}
