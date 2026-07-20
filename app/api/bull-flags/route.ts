// app/api/bull-flags/route.ts
//
// Core scan/build logic lives in lib/server/bullFlagsBuilder.ts (shared
// with app/plays/bull-flags/page.tsx's in-process SSR read via
// getBullFlagsData(), see that module's header comment). This route stays
// the public HTTP entry point: it still runs the isUnwantedBot() guard
// before returning any data.
//
// force=1 gating (2026-07-20): force=1 used to bypass the memo/Redis
// cache unconditionally for anyone, triggering a full ~700-symbol rescan
// on every request -- a public, unauthenticated way to force the most
// expensive path on every hit. Now it requires &key=<EARNINGS_BACKFILL_KEY>
// (the same owner-only secret already used by
// app/api/earnings-calendar/backfill-date/route.ts, reused here rather
// than adding a second secret) plus the same Redis-backed per-IP lockout
// (3 failed attempts / 10 min) as that route. An unauthorized force=1
// does NOT 403 the whole request -- it silently falls back to the normal
// cached response, since force isn't required to use this endpoint at
// all; only the expensive bypass needs gating.
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
import { getBullFlagsData } from "../../../lib/server/bullFlagsBuilder";

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

  const { data, headers, status } = await getBullFlagsData(origin, {
    forceRefresh,
    debugSymbol,
  });

  return NextResponse.json(data, { status: status ?? 200, headers });
}
