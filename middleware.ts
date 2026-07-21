import { NextRequest, NextResponse } from "next/server";
import {
  getClientIp,
  isBypassedIp,
  getDailyPageViewCount,
} from "@/lib/server/dailyPageLimit";

// Cumulative cap on /stock/* views per IP per (UTC) day -- a second,
// longer-window layer on top of the existing Vercel Firewall "Rate limit
// /stock category (10min)" rule (25 requests/10min, Challenge). That rule
// catches bursts; this one catches a slow, steady drip that never bursts
// hard enough to trip a 10-minute window but adds up over a day.
//
// This checks (never increments) a counter that only real, client-rendered
// page views feed -- see lib/server/dailyPageLimit.ts and
// app/components/PageViewTracker.tsx. 40/day is a small buffer above the
// owner's original ~30 real-views/day target, now that the counter reflects
// genuine visits rather than raw requests (which Link prefetching inflated
// well beyond 1:1 -- see claude/stock-daily-rate-limit-2026-07-21.md).
const STOCK_DAILY_LIMIT = 40;

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
    const ip = getClientIp(request.headers);

    if (!isBypassedIp(ip)) {
      const count = await getDailyPageViewCount("stock", ip);

      if (count >= STOCK_DAILY_LIMIT) {
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
