import { NextRequest, NextResponse } from "next/server";
import { checkDailyPageLimit } from "@/lib/server/dailyPageLimit";

// Same IP already whitelisted in the Vercel Firewall's "Bypass rate limit
// for my IP" rule (owner's home connection, confirmed 2026-07-21). Add more
// -- e.g. a work or mobile IP -- via the RATE_LIMIT_BYPASS_IPS env var
// (comma-separated) in Vercel project settings, no code change needed.
const DEFAULT_BYPASS_IPS = ["80.192.159.167"];

const BYPASS_IPS = new Set([
  ...DEFAULT_BYPASS_IPS,
  ...(process.env.RATE_LIMIT_BYPASS_IPS ?? "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean),
]);

// Cumulative cap on /stock/* views per IP per (UTC) day -- a second,
// longer-window layer on top of the existing Vercel Firewall "Rate limit
// /stock category (10min)" rule (25 requests/10min, Challenge). That rule
// catches bursts; this one catches a slow, steady drip that never bursts
// hard enough to trip a 10-minute window but adds up over a day.
//
// 120 raw requests/day targets roughly 30 real page views/day. A clean,
// no-scroll pageview to /stock/[symbol] was measured (2026-07-21) at 1
// matching request, but real browsing sessions -- scrolling, moving between
// the on-page tabs -- were observed firing several more per view in the
// same test. 120 leaves real headroom above the theoretical 1:1 minimum
// rather than assuming best case; see claude/ project docs for the traced
// numbers this is based on.
const STOCK_DAILY_LIMIT = 120;

function getClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() ?? "unknown";
}

export async function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  const host = request.headers.get("host") ?? "";

  const isLocalhost =
    host.includes("localhost") || host.startsWith("127.0.0.1");

  // Vercel preview deployments run on *.vercel.app hosts, not
  // www.mystockharbor.com. Without this check, the host-redirect rule
  // below would bounce every preview URL straight to production,
  // making PR previews unusable.
  const isVercelPreview = process.env.VERCEL_ENV === "preview";

  if (isLocalhost || isVercelPreview) {
    return NextResponse.next();
  }

  const pathname = url.pathname;
  const search = url.search;

  // API routes are hit directly by server-to-server callers (Vercel Cron,
  // the GitHub Actions warm-up workflow, client-side fetch()) that either
  // don't follow redirects at all or have no need for canonical-host/SEO
  // redirection the way browser page navigations do. A 308 here silently
  // kills anything that doesn't follow redirects -- which is exactly what
  // was happening to the scheduled cron hits on /api/jobs/*. Skip the
  // host redirect entirely for API paths.
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const oldStocksMatch = pathname.match(/^\/stocks\/([^/?#]+)\/?$/i);

  if (oldStocksMatch) {
    const cleanSymbol = oldStocksMatch[1]
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9.-]/g, "");

    if (cleanSymbol) {
      return NextResponse.redirect(
        `https://www.mystockharbor.com/stock/${encodeURIComponent(cleanSymbol)}${search}`,
        308
      );
    }
  }

  if (host !== "www.mystockharbor.com") {
    return NextResponse.redirect(
      `https://www.mystockharbor.com${pathname}${search}`,
      308
    );
  }

  if (request.headers.get("x-forwarded-proto") === "http") {
    return NextResponse.redirect(
      `https://www.mystockharbor.com${pathname}${search}`,
      308
    );
  }

  if (pathname.startsWith("/stock/")) {
    const ip = getClientIp(request);

    if (!BYPASS_IPS.has(ip)) {
      const { allowed } = await checkDailyPageLimit(
        "stock",
        ip,
        STOCK_DAILY_LIMIT
      );

      if (!allowed) {
        return new NextResponse(
          "Too many requests. Please try again later.",
          {
            status: 429,
            headers: { "Retry-After": "3600" },
          }
        );
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.png|robots.txt|sitemap.xml).*)",
  ],
};
