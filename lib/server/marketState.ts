// In-process, READ-ONLY view of the discovery-universe state that
// app/api/market/route.ts maintains.
//
// Why this exists
// ---------------
// Every chart-pattern/screener builder (bullFlagsBuilder, playsBuilder,
// descendingTrianglesBuilder, pickersBuilder) opened with
//
//   fetch(`${origin}/api/market`)
//
// -- a serverless function requesting its OWN public URL. Their fetchJSON
// helper throws on any non-ok response, and when the builder's Redis cache is
// also cold the catch path returns status 500 with an `error`, which surfaces
// as "Failed to load chart plays" with an empty list.
//
// That self-request is the failure mode already documented twice in this repo:
// claude/pickers-firewall-selfblock-2026-07-17.md and
// claude/video-page-quote-selfblock-fix-2026-07-21.md. It carries no browser
// BotID header and no session cookie, so anything guarding the site can refuse
// it -- the Vercel firewall challenge on production, and on a preview
// deployment the Vercel SSO gate, which makes it fail 100% of the time. The
// page-level SSR read was moved in-process for exactly this reason (see the
// comment in app/plays/bull-flags/page.tsx); the builders' own market call was
// missed at the time.
//
// What this deliberately does NOT do
// ----------------------------------
// It does not run discovery, does not call FMP, and does not write. The route
// stays the single owner of that: it walks the master list, admits symbols,
// prunes and saves. This module only reads the state the route has already
// built and derives the same rankings from it, so there is no second writer to
// the key and no way for a page render to spend API budget.
//
// It also never throws. A builder that cannot read this should degrade to the
// symbols it gets from readDynamicUniverse() rather than 500 the whole page,
// which is the specific behaviour change that fixes the reported bug.

import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";

const redis = Redis.fromEnv(PAGE_READ_CACHE);

// Same key the route owns. Read-only here.
const REDIS_KEY = "msh:market:state";

// Slice sizes are copied from the route's payload build so the rankings a
// builder sees are identical to what the HTTP endpoint would have returned.
const TOP_TRADED_LIMIT = 30;
const TOP_MOVERS_LIMIT = 20;
const TOP_RANGES_LIMIT = 30;

type StoredQuote = {
  symbol?: string;
  price?: number | string;
  changesPercentage?: number | string;
  volume?: number | string;
};

type StoredRecord = { quote?: StoredQuote };

type StoredState = {
  dynamic?: Record<string, StoredRecord>;
};

export type MarketStateRow = {
  symbol: string;
  changePct: number | null;
  rangePct: number | null;
  last: number | null;
  volume: number | null;
};

// Structurally the subset of the /api/market payload the builders consume.
// Deliberately not the whole payload: the debug block, master-list sizes and
// discovery counters are diagnostics for the route's own endpoint.
export type MarketStateSnapshot = {
  updatedAt: string;
  topTraded: MarketStateRow[];
  topMovers: MarketStateRow[];
  topRanges: MarketStateRow[];
  dynamicUniverseSize: number;
  dynamicSymbols: string[];
};

function toNum(x: unknown): number | null {
  const n = typeof x === "string" ? Number(x) : typeof x === "number" ? x : NaN;
  return Number.isFinite(n) ? n : null;
}

function emptySnapshot(): MarketStateSnapshot {
  return {
    updatedAt: new Date().toISOString(),
    topTraded: [],
    topMovers: [],
    topRanges: [],
    dynamicUniverseSize: 0,
    dynamicSymbols: [],
  };
}

// Mirrors buildRowsFromQuotes in app/api/market/route.ts.
//
// rangePct is null for every row there and is kept null here on purpose. The
// stored quote carries no day high/low, so the route has never been able to
// compute it -- which means topRanges, filtered on `rangePct != null`, is
// always an empty array. Reproducing that faithfully keeps this a pure
// refactor; making topRanges suddenly non-empty would silently widen every
// builder's universe, which is a data change wearing a bug fix's clothes. If
// the range ranking is ever wanted, it needs dayHigh/dayLow persisted into the
// state first, and that belongs in the route.
function buildRows(quotes: StoredQuote[]): MarketStateRow[] {
  return quotes
    .map((q) => ({
      symbol: String(q?.symbol ?? "").trim().toUpperCase(),
      changePct: toNum(q?.changesPercentage),
      rangePct: null,
      last: toNum(q?.price),
      volume: toNum(q?.volume),
    }))
    .filter(
      (r) =>
        r.symbol &&
        (r.last != null ||
          r.changePct != null ||
          r.rangePct != null ||
          r.volume != null)
    );
}

export async function readMarketState(): Promise<MarketStateSnapshot> {
  let state: StoredState | null = null;

  try {
    state = await redis.get<StoredState>(REDIS_KEY);
  } catch {
    return emptySnapshot();
  }

  const dynamic =
    state && typeof state === "object" && state.dynamic && typeof state.dynamic === "object"
      ? state.dynamic
      : null;

  if (!dynamic) return emptySnapshot();

  const quotes: StoredQuote[] = [];
  for (const record of Object.values(dynamic)) {
    if (record && typeof record === "object" && record.quote) quotes.push(record.quote);
  }

  const rows = buildRows(quotes);

  const topTraded = rows
    .filter((r) => r.volume != null)
    .sort((a, b) => (b.volume as number) - (a.volume as number))
    .slice(0, TOP_TRADED_LIMIT);

  const topMovers = rows
    .filter((r) => r.changePct != null)
    .sort((a, b) => Math.abs(b.changePct as number) - Math.abs(a.changePct as number))
    .slice(0, TOP_MOVERS_LIMIT);

  const topRanges = rows
    .filter((r) => r.rangePct != null)
    .sort((a, b) => (b.rangePct as number) - (a.rangePct as number))
    .slice(0, TOP_RANGES_LIMIT);

  const dynamicSymbols = Object.keys(dynamic).sort();

  return {
    updatedAt: new Date().toISOString(),
    topTraded,
    topMovers,
    topRanges,
    dynamicUniverseSize: dynamicSymbols.length,
    dynamicSymbols,
  };
}
