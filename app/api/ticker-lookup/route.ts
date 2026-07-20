// app/api/ticker-lookup/route.ts
//
// On-demand ticker search across picker categories that live outside the
// single pickersBuilder.ts payload (plays / bull-flags / descending
// triangles), for the "does this symbol show up in any of our pickers"
// search box on the single-category picker pages (see
// app/components/ScreenerNav.tsx's TickerSearchBox).
//
// This route ONLY fires when a user actually submits a search -- it is not
// called on normal page loads, and it never triggers a rebuild: every
// builder below is called through its existing in-process getXData()
// function with forceRefresh left at its default (false), so a search only
// ever reads whatever is already sitting in that builder's memo/Redis
// cache. See claude/pickers-firewall-selfblock-2026-07-17.md for why these
// are called in-process rather than via fetch() to the public /api/*
// routes (a server-to-server self-fetch has no browser BotID header and
// gets misclassified as a bot).
//
// Deliberately excludes /api/benchmarks -- benchmarksBuilder.ts's payload
// is index/benchmark data (SPX, sector ETFs, etc.), not per-stock picker
// results, so it isn't a meaningful match for "which pickers is TICKER on."
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isUnwantedBot } from "@/lib/botid-guard";
import { getPickersData } from "@/lib/server/pickersBuilder";
import { getPlaysData } from "@/lib/server/playsBuilder";
import { getBullFlagsData } from "@/lib/server/bullFlagsBuilder";
import { getDescendingTrianglesData } from "@/lib/server/descendingTrianglesBuilder";

type LookupSection = { title?: string; items?: Array<{ symbol?: string; tone?: string }> };
type LookupPayload = { sections?: LookupSection[] };

type LookupMatch = { source: string; title: string; tone?: string; href: string };

const SOURCES: Array<{
  source: string;
  href: string;
  load: (origin: string) => Promise<unknown>;
}> = [
  { source: "pickers", href: "/pickers", load: (origin) => getPickersData(origin) },
  { source: "plays", href: "/plays", load: (origin) => getPlaysData(origin).then((r) => r.data) },
  { source: "bullFlags", href: "/plays/bull-flags", load: (origin) => getBullFlagsData(origin).then((r) => r.data) },
  {
    source: "descendingTriangles",
    href: "/plays/descending-triangles",
    load: (origin) => getDescendingTrianglesData(origin).then((r) => r.data),
  },
];

function originFromReq(req: NextRequest) {
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return `${proto}://${host}`;
}

function cleanSymbol(value: unknown) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

export async function GET(req: NextRequest) {
  if (await isUnwantedBot()) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const symbol = cleanSymbol(req.nextUrl.searchParams.get("symbol"));
  if (!symbol) {
    return NextResponse.json({ symbol: "", matches: [] });
  }

  const origin = originFromReq(req);

  const results = await Promise.allSettled(SOURCES.map((entry) => entry.load(origin)));

  const matches: LookupMatch[] = [];
  results.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    const { source, href } = SOURCES[index];
    const payload = result.value as LookupPayload;
    const sections = Array.isArray(payload?.sections) ? payload.sections : [];
    for (const section of sections) {
      const items = Array.isArray(section.items) ? section.items : [];
      const hit = items.find((item) => cleanSymbol(item.symbol) === symbol);
      if (hit) {
        matches.push({ source, title: section.title ?? source, tone: hit.tone, href: `${href}?symbol=${encodeURIComponent(symbol)}` });
      }
    }
  });

  return NextResponse.json(
    { symbol, matches },
    { headers: { "Cache-Control": "private, max-age=30" } }
  );
}
