import { NextRequest, NextResponse } from "next/server";
import {
  getClientIp,
  isBypassedIp,
  recordDailyPageView,
} from "@/lib/server/dailyPageLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only a fixed, known set of categories can be tracked -- never let the
// client body dictate an arbitrary Redis key.
const ALLOWED_CATEGORIES = new Set(["stock"]);

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
