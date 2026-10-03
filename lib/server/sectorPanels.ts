import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";

import { SECTORS, type SectorDef } from "@/lib/sectors";
import { getSectorConstituents, getSectorIndex } from "./sectorUniverse";
import { readPricePoolBulk } from "./pricePool";
import { readCachedStockDataBulk } from "./stockDataCache";
import { getCachedDailyHistoryBulk } from "./historyCache";
import { getCachedDayItems, isDateInWindow, overlayLivePoolPrices, type EarningsListItem } from "./earningsCalendar";
import { getCompanyNameMap } from "./companyNames";
import { dayWindow as dayWindowAt, type DayBasis } from "./lastSession";
import { priceProviderFor } from "./marketData/provider";
import { readTiingoEodLast } from "./marketData/read";
import { readSecTiingoCaps } from "./tiingoPool";
import type { PricePoolRow } from "./pricePool";
import { eodBreadth, eodDayMove, lastCloseRows, type EodLast } from "./marketData/eodLast";

// ---------------------------------------------------------------------------
// The four sector panels, all built from caches the site already fills.
//
// EVERY READ HERE IS REDIS-ONLY. Nothing in this file can spend an FMP call:
//   * readPricePoolBulk           -- 1D % change, one HMGET
//   * readCachedStockDataBulk     -- perf1w / perf1m / perfYtd, one mget
//   * getCachedDailyHistoryBulk   -- closes for the breadth card, cache-only
//   * getCachedDayItems           -- materialised earnings-calendar days
//
// STALENESS IS HANDLED, NOT IGNORED. Price-pool rows each carry their own `ts`
// (the warm cron refreshes the universe on a rolling ~12-15 min rotation), so a
// naive ranking can mix a one-minute-old % change with a fifteen-minute-old
// one. Anything user-visible here filters to rows inside MAX_QUOTE_AGE_MS so a
// mover list is at least internally consistent.
//
// WHAT THIS IS NOT. The performance figures are a constituent-weighted read of
// OUR universe's largest names in a sector -- not the sector index itself. The
// pages label it as a constituent read rather than implying an index print.
//
// FMP'S OWN SECTOR ENDPOINTS ARE AVAILABLE ON THIS PLAN. Measured 2026-08-22
// via /api/debug/fmp-endpoints: `sector-performance-snapshot` returns all 11
// sectors in ONE call, and `historical-sector-performance` works too. The
// earlier note here said no such endpoint was confirmed; that is now known to be
// wrong and is corrected rather than deleted, because "we checked and it is
// unavailable" and "nobody ever checked" are different claims and only one of
// them was ever true.
//
// DO NOT SWAP ONE FOR THE OTHER WITHOUT DECIDING THAT DELIBERATELY. FMP's
// `averageChange` is EQUAL-WEIGHTED and split per exchange. This file computes a
// CAP-WEIGHTED read over the top PERFORMANCE_SAMPLE names of our universe. Same
// name, same units, different metric -- so replacing one with the other changes
// every number on the page while nothing errors, and the shift reads as a data
// bug rather than as the definition change it actually is
// (claude/traps/measuring-the-wrong-layer.md).
//
// That is not an argument against adopting it. One call for 11 sectors is a real
// saving over PERFORMANCE_SAMPLE * 11 price-pool reads, and FMP's figure is
// arguably the more defensible number to publish. It is an argument for making
// the switch as an explicit decision with the label updated to match, never as a
// quiet substitution.
// ---------------------------------------------------------------------------

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

// v2: rows carry dayBasis/sessionDate. A v1 row read by v2 code would render
// with no basis, i.e. with the wrong label.
// v3 (step 5, #553 COWORK #98): the basis can be "last-close" (Tiingo EOD), so
// a v2 table must not be served under the new labels. Computed figures only
// (weighted averages), so no raw Tiingo value sits in it.
export const PERFORMANCE_KEY = "msh:sector-performance:v3";
const PERFORMANCE_TTL_SECONDS = 15 * 60;

// v2 (step 5): on Tiingo the flags come from the stored Tiingo bars; a cached
// FMP-history count must not stand in for them for three hours.
const BREADTH_KEY_PREFIX = "msh:sector-breadth:v2:";
const BREADTH_TTL_SECONDS = 3 * 60 * 60;

/** Names per sector used to compute performance. Top of the cap ladder. */
const PERFORMANCE_SAMPLE = 25;
/** Names per sector used for the breadth card (full history each -- keep small). */
const BREADTH_SAMPLE = 20;
/** Movers are drawn from the whole constituent list. */
const MOVERS_SAMPLE = 60;
const MOVERS_SHOWN = 4;

/** Price-pool rows older than this are excluded from user-visible rankings. */
const MAX_QUOTE_AGE_MS = 30 * 60 * 1000;

/** Which quotes may speak for a 1D move now (see lib/server/lastSession.ts). */
const dayWindow = (nowMs: number) => dayWindowAt(nowMs, MAX_QUOTE_AGE_MS);

const EARNINGS_LOOKAHEAD_DAYS = 7;

// --- Tiingo EOD (step 5, #553 COWORK #98 rulings 4 and 5) -------------------
//
// On PRICE_PROVIDER_POOL=tiingo the day move, the movers, week/month/YTD and
// breadth all come from ONE Data Cache blob, readTiingoEodLast(): each
// symbol's newest stored EOD bar and the figures the nightly job computed from
// its stored bars (marketData/eodLast.ts). EOD only, all day, labelled "Last
// close · <date>"; IEX in session is a later step. No per-symbol history read,
// no FMP /stock-price-change, no FMP history. A miss (no blob yet) keeps the
// FMP path below, unchanged.

function poolOnTiingo(): boolean {
  return priceProviderFor("POOL") === "tiingo";
}

async function eodLastOrNull(): Promise<Record<string, EodLast> | null> {
  if (!poolOnTiingo()) return null;
  const eod = await readTiingoEodLast().catch(() => null);
  return eod && Object.keys(eod).length ? eod : null;
}


// --- Performance ------------------------------------------------------------

export type SectorPerformanceRow = {
  slug: string;
  name: string;
  /** Market-cap-weighted % move across the sampled constituents. */
  day: number | null;
  week: number | null;
  month: number | null;
  ytd: number | null;
  /** How many names actually contributed to `day`. */
  sampled: number;
  /** 1 = best 1D performer of the 11. Null when day is null. */
  rank: number | null;
  /** "live" in the regular session; outside it, the last session's move. */
  dayBasis: DayBasis;
  /** Eastern date (yyyy-mm-dd) of the session `day` describes when not live. */
  sessionDate: string | null;
};

export type { DayBasis } from "./lastSession";
export { sessionDateLabel } from "./lastSession";

export type SectorPerformanceTable = {
  rows: SectorPerformanceRow[];
  builtAt: number;
};

/**
 * CAP-WEIGHTED OVER THE CONSTITUENTS THAT HAVE A CAP (#553 CODE-B #94 B8).
 *
 * `weight` is a market cap or null. A constituent with a value but no cap is
 * COUNTED (it was sampled) and carries NO weight -- the old code gave it 1
 * against caps in the billions, which is the same answer stated honestly. A
 * sector where no valued constituent has a cap falls back to EQUAL weight.
 * Pure; exported for scripts/check-fmpoff-sec-cap.mjs.
 */
export function weightedAverage(
  entries: Array<{ value: number | null; weight: number | null }>
): { value: number | null; count: number } {
  const valued = entries.filter(
    (e): e is { value: number; weight: number | null } => typeof e.value === "number" && Number.isFinite(e.value)
  );
  if (!valued.length) return { value: null, count: 0 };
  const capped = valued.filter((e) => typeof e.weight === "number" && Number.isFinite(e.weight) && e.weight > 0);
  const basis = capped.length ? capped : valued.map((e) => ({ value: e.value, weight: 1 }));
  let sum = 0;
  let weight = 0;
  for (const e of basis) {
    sum += e.value * (e.weight as number);
    weight += e.weight as number;
  }
  return { value: weight ? sum / weight : null, count: valued.length };
}

/**
 * A pool row's cap AS A WEIGHT, on one basis: on the POOL gate only a Tiingo
 * row's (SEC x Tiingo, tiingoPool.ts); a row the overlay left on FMP carries a
 * frozen FMP cap and is not weighed. Off the gate every row is FMP's.
 */
export function poolCapWeight(row: Pick<PricePoolRow, "marketCap" | "source"> | null | undefined, onTiingo: boolean): number | null {
  if (!row) return null;
  if (onTiingo && row.source !== "tiingo") return null;
  return typeof row.marketCap === "number" && row.marketCap > 0 ? row.marketCap : null;
}

async function buildSectorPerformance(): Promise<SectorPerformanceTable> {
  const eod = await eodLastOrNull();
  if (eod) {
    const built = await buildSectorPerformanceFromEod(eod);
    if (built) return built;
  }

  const index = await getSectorIndex();

  const bySector = new Map<string, string[]>();
  const allSymbols: string[] = [];

  for (const sector of SECTORS) {
    const symbols = (index.bySlug[sector.slug] ?? []).slice(0, PERFORMANCE_SAMPLE);
    bySector.set(sector.slug, symbols);
    allSymbols.push(...symbols);
  }

  const [pool, extended] = await Promise.all([
    readPricePoolBulk(allSymbols).catch(() => new Map()),
    readCachedStockDataBulk(allSymbols).catch(() => new Map()),
  ]);
  const onTiingo = poolOnTiingo();

  const now = Date.now();
  const dayRule = dayWindow(now);

  const rows: SectorPerformanceRow[] = SECTORS.map((sector) => {
    const symbols = bySector.get(sector.slug) ?? [];

    const dayEntries: Array<{ value: number | null; weight: number | null }> = [];
    const weekEntries: Array<{ value: number | null; weight: number | null }> = [];
    const monthEntries: Array<{ value: number | null; weight: number | null }> = [];
    const ytdEntries: Array<{ value: number | null; weight: number | null }> = [];

    for (const symbol of symbols) {
      const quote = pool.get(symbol) ?? null;
      const data = extended.get(symbol) ?? null;
      const weight = poolCapWeight(quote, onTiingo);

      const counts = quote && dayRule.counts(quote.ts);
      dayEntries.push({ value: counts ? quote.changePct : null, weight });
      weekEntries.push({ value: data?.perf1w ?? null, weight });
      monthEntries.push({ value: data?.perf1m ?? null, weight });
      ytdEntries.push({ value: data?.perfYtd ?? null, weight });
    }

    const day = weightedAverage(dayEntries);

    return {
      slug: sector.slug,
      name: sector.name,
      day: day.value,
      week: weightedAverage(weekEntries).value,
      month: weightedAverage(monthEntries).value,
      ytd: weightedAverage(ytdEntries).value,
      sampled: day.count,
      rank: null,
      dayBasis: dayRule.basis,
      sessionDate: dayRule.sessionDate,
    };
  });

  const ranked = [...rows]
    .filter((row) => typeof row.day === "number")
    .sort((a, b) => (b.day ?? 0) - (a.day ?? 0));

  ranked.forEach((row, i) => {
    const target = rows.find((candidate) => candidate.slug === row.slug);
    if (target) target.rank = i + 1;
  });

  return { rows, builtAt: Date.now() };
}

/**
 * "Sector today" on Tiingo: the stored EOD move, week/month/YTD from the same
 * stored bars, cap-weighted on SEC cover shares x the Tiingo price (B8: the
 * pool overlay's own cap, never the frozen FMP one; weightedAverage says how a
 * constituent without one is handled). Null when no constituent has a bar.
 * Reads: the sector index, and the EOD, Tiingo pool and SEC cap blobs from the
 * Data Cache (1 HGETALL per miss each). No Redis read of its own: the pool
 * HMGET it used for weights is gone.
 */
async function buildSectorPerformanceFromEod(eod: Record<string, EodLast>): Promise<SectorPerformanceTable | null> {
  const index = await getSectorIndex();
  const bySector = new Map<string, string[]>();
  const allSymbols: string[] = [];
  for (const sector of SECTORS) {
    const symbols = (index.bySlug[sector.slug] ?? []).slice(0, PERFORMANCE_SAMPLE);
    bySector.set(sector.slug, symbols);
    allSymbols.push(...symbols);
  }
  const { date, rows: fresh } = lastCloseRows(allSymbols, eod);
  if (!date) return null;
  const caps = await readSecTiingoCaps(allSymbols, Date.now()).catch(() => new Map<string, number | null>());

  const rows: SectorPerformanceRow[] = SECTORS.map((sector) => {
    const entries = (pick: (r: EodLast) => number | null) =>
      (bySector.get(sector.slug) ?? []).map((symbol) => {
        const r = fresh.get(symbol);
        return { value: r ? pick(r) : null, weight: caps.get(symbol) ?? null };
      });
    const day = weightedAverage(entries(eodDayMove));
    return {
      slug: sector.slug,
      name: sector.name,
      day: day.value,
      week: weightedAverage(entries((r) => r.w)).value,
      month: weightedAverage(entries((r) => r.m)).value,
      ytd: weightedAverage(entries((r) => r.y)).value,
      sampled: day.count,
      rank: null,
      dayBasis: "last-close",
      sessionDate: date,
    };
  });

  const ranked = [...rows].filter((row) => typeof row.day === "number").sort((a, b) => (b.day ?? 0) - (a.day ?? 0));
  ranked.forEach((row, i) => {
    row.rank = i + 1;
  });
  return { rows, builtAt: Date.now() };
}

/** All 11 sectors' performance, cached for 15 minutes. Never throws. */
export async function getSectorPerformanceTable(): Promise<SectorPerformanceTable> {
  if (redis) {
    try {
      const cached = await redis.get<SectorPerformanceTable>(PERFORMANCE_KEY);
      // A table built on the other provider (the 15 minutes after an env flip)
      // is rebuilt rather than served under the wrong label.
      const basisMatches = !cached?.rows?.length || (cached.rows[0].dayBasis === "last-close") === poolOnTiingo();
      if (cached && Array.isArray(cached.rows) && cached.rows.length && basisMatches) return cached;
    } catch {
      // rebuild
    }
  }

  let built: SectorPerformanceTable;

  try {
    built = await buildSectorPerformance();
  } catch {
    return { rows: [], builtAt: Date.now() };
  }

  if (redis && built.rows.some((row) => typeof row.day === "number")) {
    try {
      await redis.set(PERFORMANCE_KEY, built, { ex: PERFORMANCE_TTL_SECONDS });
    } catch {
      // best-effort
    }
  }

  return built;
}

export async function getSectorPerformanceRow(
  slug: string
): Promise<SectorPerformanceRow | null> {
  const table = await getSectorPerformanceTable();
  return table.rows.find((row) => row.slug === slug) ?? null;
}

// --- Movers -----------------------------------------------------------------

export type SectorMover = {
  symbol: string;
  name: string | null;
  price: number | null;
  changePct: number;
};

export type SectorMovers = {
  gainers: SectorMover[];
  losers: SectorMover[];
  /** Constituents with a quote fresh enough to rank. */
  sampled: number;
  /** Same rule and label as the performance row (see dayWindow). */
  dayBasis: DayBasis;
  sessionDate: string | null;
};

export async function getSectorMovers(slug: string): Promise<SectorMovers> {
  const dayRule = dayWindow(Date.now());
  const empty: SectorMovers = { gainers: [], losers: [], sampled: 0, dayBasis: dayRule.basis, sessionDate: dayRule.sessionDate };

  try {
    const constituents = await getSectorConstituents(slug, MOVERS_SAMPLE);
    if (!constituents.length) return empty;

    const eod = await eodLastOrNull();
    if (eod) {
      const fromEod = await sectorMoversFromEod(constituents, eod);
      if (fromEod) return fromEod;
    }

    const [pool, names] = await Promise.all([
      readPricePoolBulk(constituents).catch(() => new Map()),
      getCompanyNameMap().catch(() => new Map<string, string>()),
    ]);

    const rows: SectorMover[] = [];

    for (const symbol of constituents) {
      const quote = pool.get(symbol);
      if (!quote) continue;
      if (typeof quote.changePct !== "number" || !Number.isFinite(quote.changePct)) continue;
      // Mixing a 1-minute-old and a 25-minute-old % change in one ranking would
      // quietly misorder it, so stale rows are dropped rather than ranked.
      // Outside the session, "fresh" means from the last session (dayWindow).
      if (!dayRule.counts(quote.ts)) continue;

      rows.push({
        symbol,
        name: names.get(symbol) ?? null,
        price: quote.price,
        changePct: quote.changePct,
      });
    }

    if (!rows.length) return empty;

    const sorted = [...rows].sort((a, b) => b.changePct - a.changePct);

    return {
      gainers: sorted.filter((row) => row.changePct > 0).slice(0, MOVERS_SHOWN),
      losers: sorted
        .filter((row) => row.changePct < 0)
        .slice(-MOVERS_SHOWN)
        .reverse(),
      sampled: rows.length,
      dayBasis: dayRule.basis,
      sessionDate: dayRule.sessionDate,
    };
  } catch {
    return empty;
  }
}

/** Movers on Tiingo: the stored EOD move, one session, labelled "Last close · <date>". */
async function sectorMoversFromEod(constituents: string[], eod: Record<string, EodLast>): Promise<SectorMovers | null> {
  const { date, rows: fresh } = lastCloseRows(constituents, eod);
  if (!date) return null;
  const names = await getCompanyNameMap().catch(() => new Map<string, string>());
  const rows: SectorMover[] = [];
  for (const symbol of constituents) {
    const r = fresh.get(symbol);
    const move = eodDayMove(r);
    if (!r || move == null) continue;
    rows.push({ symbol, name: names.get(symbol) ?? null, price: r.c, changePct: move });
  }
  const sorted = [...rows].sort((a, b) => b.changePct - a.changePct);
  return {
    gainers: sorted.filter((row) => row.changePct > 0).slice(0, MOVERS_SHOWN),
    losers: sorted.filter((row) => row.changePct < 0).slice(-MOVERS_SHOWN).reverse(),
    sampled: rows.length,
    dayBasis: "last-close",
    sessionDate: date,
  };
}

// --- Earnings this week -----------------------------------------------------

export type SectorEarningsEntry = {
  symbol: string;
  company: string;
  date: string;
  epsEstimated: number | null;
  marketCap: number | null;
};

function addDays(date: Date, days: number) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days)
  );
}

function toDateStr(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * Constituents of this sector reporting in the next 7 days.
 *
 * Scoped to constituents ON PURPOSE. The earnings calendar covers global
 * reporters, far wider than the warmed universe, and most of those symbols have
 * no cached sector at all -- filtering the whole calendar by sector would
 * silently drop everything unclassified and present the remainder as complete.
 * Restricting it to names we can actually attribute to the sector makes the
 * page's claim ("notable names reporting") true rather than approximately true.
 */
export async function getSectorEarningsThisWeek(
  slug: string
): Promise<SectorEarningsEntry[]> {
  try {
    const constituents = await getSectorConstituents(slug);
    if (!constituents.length) return [];

    const constituentSet = new Set(constituents);
    const today = new Date();
    const base = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
    );

    const dates: string[] = [];
    for (let i = 0; i < EARNINGS_LOOKAHEAD_DAYS; i++) {
      const date = toDateStr(addDays(base, i));
      if (isDateInWindow(date)) dates.push(date);
    }

    if (!dates.length) return [];

    const days = await Promise.all(
      dates.map((date) =>
        getCachedDayItems(date, { livePrices: false }).catch(() => [] as EarningsListItem[])
      )
    );
    // THE CAPS, LIVE, IN ONE POOL READ for every date (the stored rows carry
    // none for pool-priced names, #552 COWORK #113): only the order uses them.
    // ONLY THE SECTOR'S OWN NAMES (#552 COWORK #115): a full window is ~4,200
    // rows, and the overlay would read the pool for every one of them.
    const mine = days.flat().filter((it) => constituentSet.has(String(it.symbol ?? "").toUpperCase()));
    const live = await overlayLivePoolPrices(mine).catch(() => mine);
    const capOf = new Map(live.map((it) => [String(it.symbol ?? "").toUpperCase(), it.marketCap]));

    const out: SectorEarningsEntry[] = [];
    const seen = new Set<string>();

    days.forEach((items, i) => {
      for (const item of items) {
        const symbol = String(item.symbol ?? "").toUpperCase();
        if (!constituentSet.has(symbol) || seen.has(symbol)) continue;
        seen.add(symbol);
        out.push({
          symbol,
          company: item.company || symbol,
          date: item.date || dates[i],
          epsEstimated: item.epsEstimated ?? null,
          marketCap: capOf.get(symbol) ?? item.marketCap ?? null,
        });
      }
    });

    return out.sort((a, b) => a.date.localeCompare(b.date) || (b.marketCap ?? 0) - (a.marketCap ?? 0));
  } catch {
    return [];
  }
}

// --- Breadth ----------------------------------------------------------------

export type SectorBreadth = {
  /** Names with enough cached history to judge. */
  sampled: number;
  above50: number;
  above200: number;
  builtAt: number;
};

function simpleMovingAverage(values: number[], window: number): number | null {
  if (values.length < window) return null;
  const slice = values.slice(-window);
  const sum = slice.reduce((acc, value) => acc + value, 0);
  return sum / window;
}

async function buildSectorBreadth(slug: string): Promise<SectorBreadth> {
  const constituents = await getSectorConstituents(slug, BREADTH_SAMPLE);
  const empty: SectorBreadth = { sampled: 0, above50: 0, above200: 0, builtAt: Date.now() };
  if (!constituents.length) return empty;

  // Tiingo: the MA50/MA200 flags the nightly job computed from the stored bars.
  const eod = await eodLastOrNull();
  if (eod) {
    const fromEod = eodBreadth(constituents, eod);
    if (fromEod.sampled > 0) return { ...fromEod, builtAt: Date.now() };
  }

  const histories = await getCachedDailyHistoryBulk(constituents, "sector-panels");
  if (!histories.size) return empty;

  let sampled = 0;
  let above50 = 0;
  let above200 = 0;

  for (const symbol of constituents) {
    const points = histories.get(symbol);
    if (!points || points.length < 200) continue;

    const closes = points.map((point) => point.close).filter((close) => Number.isFinite(close));
    if (closes.length < 200) continue;

    const last = closes[closes.length - 1];
    const ma50 = simpleMovingAverage(closes, 50);
    const ma200 = simpleMovingAverage(closes, 200);
    if (ma50 == null || ma200 == null) continue;

    sampled += 1;
    if (last > ma50) above50 += 1;
    if (last > ma200) above200 += 1;
  }

  return { sampled, above50, above200, builtAt: Date.now() };
}

/**
 * Share of the sector's largest names trading above their 50- and 200-day
 * moving averages. Cached for 3 hours because it is the one panel that reads
 * full price histories -- cheap in Redis terms, but not something to repeat on
 * every render.
 */
export async function getSectorBreadth(slug: string): Promise<SectorBreadth | null> {
  const key = `${BREADTH_KEY_PREFIX}${slug}`;

  if (redis) {
    try {
      const cached = await redis.get<SectorBreadth>(key);
      if (cached && typeof cached.sampled === "number") return cached;
    } catch {
      // rebuild
    }
  }

  let built: SectorBreadth;

  try {
    built = await buildSectorBreadth(slug);
  } catch {
    return null;
  }

  if (redis && built.sampled > 0) {
    try {
      await redis.set(key, built, { ex: BREADTH_TTL_SECONDS });
    } catch {
      // best-effort
    }
  }

  return built.sampled > 0 ? built : null;
}

export function sectorFromSlug(slug: string): SectorDef | undefined {
  return SECTORS.find((sector) => sector.slug === slug);
}
