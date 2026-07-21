import { NextRequest, NextResponse } from "next/server";
import { isUnwantedBot } from "@/lib/botid-guard";
import {
  getClientIp,
  isBypassedIp,
  isVerifiedHumanToday,
  isBotFlaggedToday,
  markVerifiedHumanToday,
  markBotFlaggedToday,
} from "@/lib/server/dailyPageLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Gate for IPs that have already racked up the daily /stock/* real-view
// limit (see middleware.ts and app/verify/VerifyClient.tsx, which is the
// only caller -- this path is listed in instrumentation-client.ts so BotID
// attaches a signed header to that specific fetch).
//
// Runs Vercel BotID Deep Analysis, a paid check ($1/1000 calls) -- so this
// is deliberately short-circuited for any IP already known either way
// today: at most ONE Deep Analysis call per IP per (UTC) day, regardless of
// how many times /verify gets loaded. Expected volume: roughly one call per
// distinct IP that crosses the daily /stock/* limit, not one per request.
export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);

  if (isBypassedIp(ip)) {
    return NextResponse.json({ ok: true });
  }

  if (await isBotFlaggedToday("stock", ip)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  if (await isVerifiedHumanToday("stock", ip)) {
    return NextResponse.json({ ok: true });
  }

  let isBot = false;
  try {
    isBot = await isUnwantedBot("deepAnalysis");
  } catch {
    // Fail open -- a BotID/Deep Analysis hiccup should never trap a real
    // visitor behind this gate.
    isBot = false;
  }

  if (isBot) {
    await markBotFlaggedToday("stock", ip);
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  await markVerifiedHumanToday("stock", ip);
  return NextResponse.json({ ok: true });
}
