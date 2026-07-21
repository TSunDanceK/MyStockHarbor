import { NextResponse } from "next/server";
import { isUnwantedBot } from "@/lib/botid-guard";
import { searchSymbols } from "@/lib/server/symbolSearch";

export const runtime = "nodejs";
export const revalidate = 86400;

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400",
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim().toUpperCase();
  const type = (searchParams.get("type") || "").trim().toLowerCase();

  if (await isUnwantedBot()) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  // Search/rank logic lives in lib/server/symbolSearch.ts so it can also be
  // called in-process (no HTTP self-fetch, no BotID header needed) by
  // server-rendered callers like lib/insightSnapshots.ts. See that module's
  // doc comment for the full reasoning.
  const results = await searchSymbols(q, type);

  return NextResponse.json({ results }, { headers: CACHE_HEADERS });
}
