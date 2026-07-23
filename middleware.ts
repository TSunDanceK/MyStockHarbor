import { NextRequest, NextResponse } from "next/server";
import {
  getClientIp,
  isBypassedIp,
  getDailyPageViewCount,
  isVerifiedHumanToday,
  isBotFlaggedToday,
} from "@/lib/server/dailyPageLimit";

// Cumulative cap on /stock/* views per IP per (UTC) day -- a second,
// longer-window layer on top of the existing Vercel Firewall "Rate limit
// /stock category (10min)" rule (25 requests/10min, Challenge). That rule
// catches bursts; this one catches a slow, steady drip that never bursts
// hard enough to trip a 10-minute window but adds up over a day.
//
// This checks (never increments) a counter that only real, client-rendered
// page views feed -- see lib/server/dailyPageLimit.ts and
// app/components/PageViewTracker.tsx.
//
// Crossing this limit does NOT hard-block: it sends the request through an
// invisible BotID Deep Analysis check (/verify) once per IP per day. A real
// visitor passes silently and is forwarded straight on to the page they
// asked for; only a confirmed bot actually gets denied. See
// claude/stock-daily-rate-limit-2026-07-21.md for the full reasoning.
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

  // "Coming Soon" gate for the not-yet-public /popular-searches page. Only an
  // allow-listed IP (POPULAR_SEARCHES_ALLOW_IPS, comma-separated) or a valid
  // preview cookie sees the real page; everyone else gets the Coming Soon
  // placeholder the page itself renders when the x-msh-ps-preview header isn't
  // "1". Visiting `?preview=<POPULAR_SEARCHES_PREVIEW_KEY>` once drops the
  // cookie so the owner can view from any device/IP (dynamic IPs, phones).
  // With neither env var set, the page stays Coming Soon for everyone -- the
  // safe default.
  if (pathname === "/popular-searches") {
    const previewKey = process.env.POPULAR_SEARCHES_PREVIEW_KEY || "";
    const allowIps = (process.env.POPULAR_SEARCHES_ALLOW_IPS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const ip = getClientIp(request.headers);
    const cookieVal = request.cookies.get("msh_ps_preview")?.value || "";
    const queryKey = url.searchParams.get("preview") || "";

    let unlocked = false;
    let setCookie = false;

    if (previewKey && queryKey && queryKey === previewKey) {
      unlocked = true;
      setCookie = true; // first visit via the secret link -> remember it
    } else if (previewKey && cookieVal && cookieVal === previewKey) {
      unlocked = true;
    } else if (allowIps.length > 0 && allowIps.includes(ip)) {
      unlocked = true;
    }

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-msh-ps-preview", unlocked ? "1" : "0");

    const gated = NextResponse.next({ request: { headers: requestHeaders } });
    if (setCookie) {
      gated.cookies.set("msh_ps_preview", previewKey, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 180, // ~6 months
      });
    }
    return gated;
  }

  if (pathname.startsWith("/stock/")) {
    const ip = getClientIp(request.headers);

    if (!isBypassedIp(ip)) {
      // Already confirmed a bot today -- deny immediately, no re-check
      // (and no repeat Deep Analysis charge).
      if (await isBotFlaggedToday("stock", ip)) {
        return new NextResponse("Access denied", { status: 403 });
      }

      const count = await getDailyPageViewCount("stock", ip);

      if (count >= STOCK_DAILY_LIMIT) {
        // Already verified human today -- let them straight through.
        const verified = await isVerifiedHumanToday("stock", ip);

        if (!verified) {
          const nextPath = `${pathname}${search}`;
          return NextResponse.redirect(
            new URL(`/verify?next=${encodeURIComponent(nextPath)}`, request.url),
            307
          );
        }
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
