// app/api/plays/route.ts
//
// Core scan/build logic lives in lib/server/playsBuilder.ts (shared with
// app/plays/page.tsx's in-process SSR read via getPlaysData(), see that
// module's header comment). This route stays the public HTTP entry point:
// it still runs the isUnwantedBot() guard before returning any data.
//
// force=1 gating (2026-07-20): force=1 used to bypass the memo/Redis
// cache unconditionally for anyone, triggering a full rescan on every
// request -- a public, unauthenticated way to force the most expensive
// path on every hit. Now it requires &key=<EARNINGS_BACKFILL_KEY> (the
// same owner-only secret already used by
// app/api/earnings-calendar/backfill-date/route.ts, reused here rather
// than adding a second secret) plus the same Redis-backed per-IP lockout
// (3 failed attempts / 10 min) as that route. An unauthorized force=1
// does NOT 403 the whole request -- it silently falls back to the normal
// cached response, since force isn't required to use this endpoint at
// all; only the expensive bypass needs gating.
// maxDuration IS SET BECAUSE THE BUILDER NOW WAITS, and this is the only entry
// point that can reach that wait: app/plays/*/page.tsx calls the builder with
// `cacheOnly: true`, so an ISR regeneration never builds and never waits. This
// route is `force-dynamic` and is fetched by the page on mount, so it is where
// a cold-cache build actually happens.
//
// This route set no maxDuration, so it ran on whatever the platform default
// happens to be. Per app/api/jobs/warm-earnings/route.ts, on Vercel that
// default is NOT a fixed number: 300s for a Pro team with Fluid compute enabled
// and 15s for a Pro team without it, nothing in this repo records which this
// project is, and the Fluid setting is a dashboard toggle that can change
// WITHOUT A COMMIT. Inheriting it is the wrong basis for a path that now waits
// up to PLAYS_MAX_WAIT_MS (12s) before it even starts building -- under a 15s
// default that is 80% of the budget spent waiting. warm-earnings set this
// explicitly for exactly this reason; so does this route.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isUnwantedBot } from "@/lib/botid-guard";
import {
  getClientIp,
  checkBackfillLockout,
  recordBackfillFailure,
  clearBackfillFailures,
  checkBackfillKey,
} from "@/lib/server/backfillAuth";
import { getPlaysData } from "../../../lib/server/playsBuilder";

function originFromReq(req: NextRequest) {
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest) {
  if (await isUnwantedBot()) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const origin = originFromReq(req);
  const forceRequested = req.nextUrl.searchParams.get("force") === "1";
  const debugSymbol = req.nextUrl.searchParams.get("debugSymbol");

  let forceRefresh = false;

  if (forceRequested) {
    const ip = getClientIp(req);
    const lockout = await checkBackfillLockout(ip);

    if (lockout.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${lockout.retryAfterSeconds}s.` },
        { status: 429, headers: { "Retry-After": String(lockout.retryAfterSeconds) } }
      );
    }

    const key = req.nextUrl.searchParams.get("key") ?? "";

    if (checkBackfillKey(key)) {
      await clearBackfillFailures(ip);
      forceRefresh = true;
    } else {
      await recordBackfillFailure(ip);
      // Falls through with forceRefresh left false -- serves the normal
      // cached response instead of denying the request outright.
    }
  }

  const { data, headers, status } = await getPlaysData(origin, {
    forceRefresh,
    debugSymbol,
  });

  return NextResponse.json(data, { status: status ?? 200, headers });
}
