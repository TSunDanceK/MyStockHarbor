// THE MARKET STATE FROM THE NIGHTLY BARS (#553 COWORK #173 proposal, approved
// for build in COWORK #186/#190).
//
// msh:market:state is FMP-derived and frozen: its only writer, /api/market,
// answers 410 behind the Tiingo gate. readMarketState still feeds the
// pickers, plays, bull-flag and descending-triangle builders (their
// dynamicSymbols, top traded and top movers, and the "market" refresh of the
// dynamic universe) and warmTargets' movers. Left alone, those names age out
// after the dynamic universe's 14 days.
//
// This key replaces it from the tiingo-eod night, which already holds every
// symbol's bars in memory: +1 SET a night, no read added per render (the
// readers already GET the old key; they GET this one instead, falling back to
// the old one only while this one is absent).
//
// ── THE RANKINGS ─────────────────────────────────────────────────────────
//   eligible    a close of at least MIN_PRICE and a dollar volume of at least
//               MIN_DOLLAR_VOLUME on the session (penny names and thin
//               listings were never what "most traded" meant)
//   topTraded   by DOLLAR volume, not share count: by shares, a $2 stock
//               out-trades a $200 one with a tenth of the money behind it
//   topMovers   by |1-day %| against the prior close
//   topRanges   empty, as it always was (readMarketState explains why:
//               widening every builder's universe is a data change, not part
//               of a source swap)
//   dynamic     the top DYNAMIC_TRADED by dollar volume plus the top
//               DYNAMIC_MOVERS by |1-day %|, deduplicated
// Pure core (buildMarketDynamic); the write never fails the night.
import { toDashed } from "../symbolSpellings.mjs";
import type { EodBar } from "./marketData/types";
import type { MarketStateRow, MarketStateSnapshot } from "./marketState";

export const MARKET_DYNAMIC_KEY = "msh:market:dynamic:v1";
/** A week past the next night: a skipped night leaves yesterday's ranking. */
export const MARKET_DYNAMIC_TTL_SECONDS = 8 * 24 * 60 * 60;
/** Older than this, readers fall back to the old key (a stalled job must not freeze the universe twice). */
export const MARKET_DYNAMIC_MAX_AGE_DAYS = 5;

export const MIN_PRICE = 3;
export const MIN_DOLLAR_VOLUME = 20e6;
export const TOP_TRADED_LIMIT = 30;
export const TOP_MOVERS_LIMIT = 20;
export const DYNAMIC_TRADED = 300;
export const DYNAMIC_MOVERS = 100;

export type MarketDynamicValue = {
  v: 1;
  /** The session the bars end on (YYYY-MM-DD). */
  asOf: string;
  at: string;
  topTraded: MarketStateRow[];
  topMovers: MarketStateRow[];
  dynamicSymbols: string[];
};

type Ranked = MarketStateRow & { dollarVolume: number };

/** Pure. The night's rankings from closed daily bars (oldest first) per symbol. */
export function buildMarketDynamic(bars: ReadonlyMap<string, readonly EodBar[]>, asOf: string, at: string): MarketDynamicValue {
  const rows: Ranked[] = [];
  for (const [field, b] of bars) {
    const n = b.length;
    if (n < 2) continue;
    const last = b[n - 1];
    // Only a bar on the session itself: a symbol whose newest bar is older did not trade it.
    if (last[0] !== asOf) continue;
    const close = last[4];
    const prev = b[n - 2][4];
    const volume = last[5];
    if (!(close >= MIN_PRICE) || !(prev > 0) || !(volume > 0)) continue;
    const dollarVolume = close * volume;
    if (!(dollarVolume >= MIN_DOLLAR_VOLUME)) continue;
    rows.push({
      symbol: toDashed(String(field).trim().toUpperCase()),
      changePct: Math.round(((close - prev) / prev) * 100 * 1e4) / 1e4,
      rangePct: null,
      last: close,
      volume,
      dollarVolume,
    });
  }
  const byTraded = [...rows].sort((a, b) => b.dollarVolume - a.dollarVolume || a.symbol.localeCompare(b.symbol));
  const byMove = [...rows].sort((a, b) => Math.abs(b.changePct as number) - Math.abs(a.changePct as number) || a.symbol.localeCompare(b.symbol));
  const strip = ({ dollarVolume: _d, ...r }: Ranked): MarketStateRow => { void _d; return r; };
  const dynamic = new Set<string>();
  for (const r of byTraded.slice(0, DYNAMIC_TRADED)) dynamic.add(r.symbol);
  for (const r of byMove.slice(0, DYNAMIC_MOVERS)) dynamic.add(r.symbol);
  return {
    v: 1,
    asOf,
    at,
    topTraded: byTraded.slice(0, TOP_TRADED_LIMIT).map(strip),
    topMovers: byMove.slice(0, TOP_MOVERS_LIMIT).map(strip),
    dynamicSymbols: [...dynamic].sort(),
  };
}

/** Pure. The readers' snapshot from the stored value, or null when it is absent, malformed or stale. */
export function snapshotFromDynamic(value: unknown, nowMs: number): MarketStateSnapshot | null {
  const v = value as MarketDynamicValue | null;
  if (!v || typeof v !== "object" || v.v !== 1 || !Array.isArray(v.dynamicSymbols) || !v.dynamicSymbols.length) return null;
  const asOfMs = Date.parse(`${v.asOf}T00:00:00Z`);
  if (!Number.isFinite(asOfMs) || nowMs - asOfMs > MARKET_DYNAMIC_MAX_AGE_DAYS * 86_400_000) return null;
  return {
    updatedAt: typeof v.at === "string" ? v.at : new Date(nowMs).toISOString(),
    topTraded: Array.isArray(v.topTraded) ? v.topTraded : [],
    topMovers: Array.isArray(v.topMovers) ? v.topMovers : [],
    topRanges: [],
    dynamicUniverseSize: v.dynamicSymbols.length,
    dynamicSymbols: v.dynamicSymbols,
  };
}

type SetClient = { set: (key: string, value: string, opts: { ex: number }) => Promise<unknown> };

/** THE NIGHTLY STEP (tiingo-eod, a complete night only). +1 SET. Never throws. */
export async function writeMarketDynamic(
  r: SetClient,
  bars: ReadonlyMap<string, EodBar[]>,
  asOf: string,
  nowMs: number
): Promise<{ ok: true; dynamic: number; traded: number; movers: number } | { ok: false; error: string }> {
  try {
    const value = buildMarketDynamic(bars, asOf, new Date(nowMs).toISOString());
    if (!value.dynamicSymbols.length) return { ok: false, error: "no eligible symbols on the session" };
    await r.set(MARKET_DYNAMIC_KEY, JSON.stringify(value), { ex: MARKET_DYNAMIC_TTL_SECONDS });
    return { ok: true, dynamic: value.dynamicSymbols.length, traded: value.topTraded.length, movers: value.topMovers.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
