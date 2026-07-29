import { NextResponse } from "next/server";
import { getClientIp, isBypassedIp } from "@/lib/server/dailyPageLimit";
import { blockOffender, TRAP_BLOCK_DAYS } from "@/lib/server/trapBlock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Honeypot trap.
 *
 * app/layout.tsx renders a real <a href> to this exact path on every page,
 * styled + aria-hidden so no sighted visitor, screen-reader user, or
 * keyboard-tab user can ever land here through normal use -- see that
 * file's comment for the hiding technique, and for why it's a plain <a>
 * rather than next/link's <Link>. Link's viewport-prefetch would otherwise
 * fire this route from real visitors' own browsers just by scrolling the
 * link into view, self-inflicting the exact block this exists to apply to
 * bots -- see claude/list-link-prefetch-disable-2026-07-21.md for the prior
 * incident that exact pattern caused elsewhere on this site.
 *
 * Nothing a rendered browser does ever reaches this path. A request only
 * arrives when something parsed the raw HTML -- or crawled every anchor tag
 * regardless of visibility -- and fetched it. Real visitors don't do that,
 * and neither do most compliant crawlers (see the allowlist below for the
 * ones that might, e.g. an unusually literal AI crawler).
 *
 * On a hit: block the requester's IP and JA4 fingerprint for
 * TRAP_BLOCK_DAYS (lib/server/trapBlock.ts, default 2 days), site-wide --
 * checked in middleware.ts on every subsequent request. Responds 404, not
 * 403, so the response itself doesn't tip off anything sophisticated enough
 * to notice the difference and adapt.
 *
 * This blocks LIVE on merge -- there is no separate log-only/enforce
 * staging step like the quote-token gate (claude/quote-page-token-rollout-
 * 2026-07-29.md) has. That staging existed there because enforcement could
 * plausibly catch real visitors (an expired token, an unwired call site).
 * Here the link is unreachable through any real user flow by construction,
 * so the graduated rollout doesn't add much -- the residual risk is narrower
 * (the allowlist below being incomplete, or the hiding technique failing
 * for a specific crawler) and is mitigated directly rather than staged.
 */

function logSafe(value: string | null | undefined, max = 120): string {
  if (!value) return "none";
  const cleaned = value.replace(/[\r\n\t]+/g, " ").trim();
  if (!cleaned) return "none";
  return cleaned.length > max ? `${cleaned.slice(0, max)}...` : cleaned;
}

// Crawlers whose entire business model depends on being let through --
// Google/Bing indexing, Meta's link-preview fetcher (the single largest
// source of legitimate traffic on this site today), Apple's, DuckDuckGo's.
// None of these SHOULD ever reach this route (the link is invisible to
// anything that respects CSS/ARIA), so a hit from one of these is treated
// as "the hiding technique needs a second look", not as a bot to block --
// getting this allowlist wrong in the blocking direction risks silently
// killing social-preview rendering or search visibility for two days at a
// time, which is a far worse outcome than under-blocking a scraper.
const KNOWN_GOOD_UA_MARKERS = [
  "googlebot",
  "bingbot",
  "adsbot-google",
  "mediapartners-google",
  "meta-externalagent",
  "facebookexternalhit",
  "applebot",
  "duckduckbot",
  "bingpreview",
];

function isKnownGoodBot(userAgent: string): boolean {
  const lower = userAgent.toLowerCase();
  return KNOWN_GOOD_UA_MARKERS.some((marker) => lower.includes(marker));
}

export async function GET(req: Request) {
  const ip = getClientIp(req.headers);
  const userAgent = req.headers.get("user-agent") || "";
  const ja4 = req.headers.get("x-vercel-ja4-digest");
  const country = req.headers.get("x-vercel-ip-country");
  const referer = req.headers.get("referer");

  // Never block the owner's own bypassed IPs, in case of a browser
  // extension, accessibility tool, or manual view-source click -- same
  // bypass list already used for the daily page-view gate.
  if (isBypassedIp(ip)) {
    return new NextResponse(null, { status: 404 });
  }

  if (isKnownGoodBot(userAgent)) {
    console.warn(
      `[trap] hit by allowlisted UA -- NOT blocking, check the hidden-link ` +
        `markup in app/layout.tsx ip=${logSafe(ip)} ua="${logSafe(userAgent, 160)}"`
    );
    return new NextResponse(null, { status: 404 });
  }

  await blockOffender(ip, ja4);

  console.warn(
    `[trap] blocked ip=${logSafe(ip)} ja4=${logSafe(ja4, 64)} ` +
      `country=${logSafe(country, 8)} ref=${logSafe(referer, 100)} ` +
      `ua="${logSafe(userAgent, 160)}" days=${TRAP_BLOCK_DAYS}`
  );

  return new NextResponse(null, { status: 404 });
}
