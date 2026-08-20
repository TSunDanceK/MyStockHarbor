import { NextRequest, NextResponse } from "next/server";
import {
  getClientIp,
  isBypassedIp,
  getDailyPageViewCount,
  isVerifiedHumanToday,
  isBotFlaggedToday,
} from "@/lib/server/dailyPageLimit";
import { isTrapBlocked } from "@/lib/server/trapBlock";
import { isKnownGoodBot } from "@/lib/server/knownGoodBots";

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

  // Honeypot trap block -- checked first, before anything else below
  // (including the /api/ early-return that follows), so a requester who
  // tripped the trap (app/api/internal/feed-index/route.ts) is denied on
  // every path for the block's duration, not just the ones the daily-view
  // gate already covers. See lib/server/trapBlock.ts.
  const trapCheckIp = getClientIp(request.headers);
  if (!isBypassedIp(trapCheckIp)) {
    const ja4 = request.headers.get("x-vercel-ja4-digest");
    if (await isTrapBlocked(trapCheckIp, ja4)) {
      return new NextResponse("Access denied", { status: 403 });
    }
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

  // Legacy "open the chart for this symbol" links point at the HOMEPAGE --
  // `/?symbol=NVDA&tf=D#chart`. That's the shape buildDashboardHref still emits
  // in playsBuilder, bullFlagsBuilder, descendingTrianglesBuilder and
  // pickersBuilder.
  //
  // On desktop it happened to work, because `/` renders the dashboard. On a
  // phone HomePageRouter renders the mobile landing page instead, which ignores
  // ?symbol entirely -- so "Open full chart" on the three chart-plays pages
  // (/plays, /plays/bull-flags, /plays/descending-triangles) dropped the
  // visitor on the home page. The picker pages never showed the bug because
  // PickerResultPage's chartHrefFor already rewrites these links to /dashboard
  // before rendering them; the three plays clients' own toChartHref only
  // appends "#chart" and passes the rest through untouched.
  //
  // Fixing it here rather than in each builder covers three cases at once:
  // payloads already sitting in the Redis cache carrying the old href, any
  // bookmarked or indexed legacy URL, and any future caller that forgets. The
  // fragment survives the redirect -- browsers re-apply it when the target
  // carries none -- so "#chart" still lands on the chart.
  if (pathname === "/" && url.searchParams.has("symbol")) {
    return NextResponse.redirect(
      `https://www.mystockharbor.com/dashboard${search}`,
      308
    );
  }

  // /custom-screener has been retired: the All Stocks screener
  // (/stock-screener) runs the identical full-universe + checkbox-filter
  // engine and additionally shows results immediately with the sortable data
  // tabs, so it fully supersedes it. 308-redirect the old URL (preserving any
  // ?symbol=) so bookmarks and inbound links land on the better page rather
  // than a dead route.
  if (pathname === "/custom-screener") {
    return NextResponse.redirect(
      `https://www.mystockharbor.com/stock-screener${search}`,
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
    // .trim() everything: pasting the secret into Vercel's env-var field on a
    // phone very easily grabs a trailing space or newline off a copied code
    // block, which would silently break the exact-match below (stored
    // "ps_xxx\n" never equals the clean "ps_xxx" from the URL). Trimming both
    // sides makes that copy artifact harmless.
    const previewKey = (process.env.POPULAR_SEARCHES_PREVIEW_KEY || "").trim();
    const allowIps = (process.env.POPULAR_SEARCHES_ALLOW_IPS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const ip = getClientIp(request.headers);
    const cookieVal = (request.cookies.get("msh_ps_preview")?.value || "").trim();
    const queryKey = (url.searchParams.get("preview") || "").trim();

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
    // Never gate a known-good crawler. /stock/* is 483 of the ~765 URLs in
    // the sitemap, so this branch covers the majority of the indexable site;
    // a crawler bounced to /verify here would take most of the site out of
    // Google's index with no visible symptom on the live domain.
    //
    // In practice this should never have fired: the counter this gate reads
    // is only ever incremented by a client beacon to
    // /api/internal/track-view, and /api/ is disallowed in robots.txt, so
    // Googlebot's renderer should skip it. But "should" is doing real work
    // in that sentence -- it depends on the renderer honouring robots.txt
    // for a subresource fetch, on the beacon never moving off /api/, and on
    // no future change feeding this counter server-side. The honeypot trap
    // route already carries exactly this allowlist
    // (app/api/internal/feed-index/route.ts); this gate was simply missed.
    // Cheap check, severe downside if the assumption ever breaks.
    // Found in the 2026-08-15 Search Console audit.
    if (isKnownGoodBot(request.headers.get("user-agent"))) {
      return NextResponse.next();
    }

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
