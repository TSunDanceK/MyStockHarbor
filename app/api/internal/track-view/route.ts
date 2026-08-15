import { NextRequest, NextResponse } from "next/server";
import {
  getClientIp,
  isBypassedIp,
  recordDailyPageView,
} from "@/lib/server/dailyPageLimit";
import { isKnownGoodBot } from "@/lib/server/knownGoodBots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only a fixed, known set of categories can be tracked -- never let the
// client body dictate an arbitrary Redis key.
//
// "stock"  -- mounted by app/stock/[symbol]/layout.tsx, feeds the daily
//             /stock/* cap in middleware.ts.
// "site"   -- mounted by the root app/layout.tsx, so it fires on every real
//             page view anywhere on the site. Read (never incremented) by
//             app/api/go/[platform]/route.ts to decide whether a request for
//             an affiliate redirect came from something that had actually
//             rendered a page in a browser first.
const ALLOWED_CATEGORIES = new Set(["stock", "site"]);

// Beacon endpoint: called once per real, client-rendered page view (see
// app/components/PageViewTracker.tsx and lib/server/dailyPageLimit.ts for
// why this is the only thing that increments the daily view counter).
// Deliberately does as little work as possible and always responds fast --
// this fires on every real pageview in the tracked categories, so it needs
// to be cheap and it must never throw a visible error back to the client.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const category = typeof body?.category === "string" ? body.category : "";

    // Belt-and-braces with the allowlist added to middleware.ts's /stock/*
    // gate: stop a crawler's IP accumulating toward the daily cap at the
    // source, rather than only exempting it at the point of enforcement.
    // Googlebot executes JavaScript, so PageViewTracker's beacon can in
    // principle fire from the renderer; robots.txt disallows /api/ and
    // should prevent it, but a counter that silently mis-attributes crawler
    // traffic to a "real page view" is worth closing off directly.
    // (2026-08-15 Search Console audit.)
    if (isKnownGoodBot(request.headers.get("user-agent"))) {
      return new NextResponse(null, { status: 204 });
    }

    if (ALLOWED_CATEGORIES.has(category)) {
      const ip = getClientIp(request.headers);
      if (!isBypassedIp(ip)) {
        await recordDailyPageView(category, ip);
      }
    }
  } catch {
    // Never surface an error for a fire-and-forget beacon.
  }

  return new NextResponse(null, { status: 204 });
}
