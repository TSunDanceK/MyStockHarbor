import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";

import { SECTORS, type SectorDef } from "@/lib/sectors";
import { getSectorConstituents, getSectorIndex } from "./sectorUniverse";
import { readPricePoolBulk } from "./pricePool";
import { readCachedStockDataBulk } from "./stockDataCache";
import { getCachedDailyHistoryBulk } from "./historyCache";
import { getCachedDayItems, isDateInWindow, type EarningsListItem } from "./earningsCalendar";
import { getCompanyNameMap } from "./companyNames";

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
// OUR universe's largest names in a sector -- not the sector index itself. FMP
// Starter has no confirmed sector-performance endpoint in use anywhere in this
// repo (see the probes added to /api/debug/fmp-endpoints), so the pages label
// this as a constituent read rather than implying an index print.
// ---------------------------------------------------------------------------

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

const PERFORMANCE_KEY = "msh:sector-performance:v1";
const PERFORMANCE_TTL_SECONDS = 15 * 60;

const BREADTH_KEY_PREFIX = "msh:sector-breadth:v1:";
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

const EARNINGS_LOOKAHEAD_DAYS = 7;

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
};

export type SectorPerformanceTable = {
  rows: SectorPerformanceRow[];
  builtAt: number;
};

function weightedAverage(
  entries: Array<{ value: number | null; weight: number }>
): { value: number | null; count: number } {
  let sum = 0;
  let weight = 0;
  let count = 0;

  for (const entry of entries) {
    if (typeof entry.value !== "number" || !Number.isFinite(entry.value)) continue;
    const w = entry.weight > 0 ? entry.weight : 1;
    sum += entry.value * w;
    weight += w;
    count += 1;
  }

  if (!weight || !count) return { value: null, count: 0 };
  return { value: sum / weight, count };
}

async function buildSectorPerformance(): Promise<SectorPerformanceTable> {
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

  const now = Date.now();

  const rows: SectorPerformanceRow[] = SECTORS.map((sector) => {
    const symbols = bySector.get(sector.slug) ?? [];

    const dayEntries: Array<{ value: number | null; weight: number }> = [];
    const weekEntries: Array<{ value: number | null; weight: number }> = [];
    const monthEntries: Array<{ value: number | null; weight: number }> = [];
    const ytdEntries: Array<{ value: number | null; weight: number }> = [];

    for (const symbol of symbols) {
      const quote = pool.get(symbol) ?? null;
      const data = extended.get(symbol) ?? null;
      const weight =
        typeof quote?.marketCap === "number" && quote.marketCap > 0 ? quote.marketCap : 1;

      const fresh = quote && now - quote.ts <= MAX_QUOTE_AGE_MS;
      dayEntries.push({ value: fresh ? quote.changePct : null, weight });
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

/** All 11 sectors' performance, cached for 15 minutes. Never throws. */
export async function getSectorPerformanceTable(): Promise<SectorPerformanceTable> {
  if (redis) {
    try {
      const cached = await redis.get<SectorPerformanceTable>(PERFORMANCE_KEY);
      if (cached && Array.isArray(cached.rows) && cached.rows.length) return cached;
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
};

export async function getSectorMovers(slug: string): Promise<SectorMovers> {
  const empty: SectorMovers = { gainers: [], losers: [], sampled: 0 };

  try {
    const constituents = await getSectorConstituents(slug, MOVERS_SAMPLE);
    if (!constituents.length) return empty;

    const [pool, names] = await Promise.all([
      readPricePoolBulk(constituents).catch(() => new Map()),
      getCompanyNameMap().catch(() => new Map<string, string>()),
    ]);

    const now = Date.now();

    const rows: SectorMover[] = [];

    for (const symbol of constituents) {
      const quote = pool.get(symbol);
      if (!quote) continue;
      if (typeof quote.changePct !== "number" || !Number.isFinite(quote.changePct)) continue;
      // Mixing a 1-minute-old and a 25-minute-old % change in one ranking would
      // quietly misorder it, so stale rows are dropped rather than ranked.
      if (now - quote.ts > MAX_QUOTE_AGE_MS) continue;

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
    };
  } catch {
    return empty;
  }
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
        getCachedDayItems(date).catch(() => [] as EarningsListItem[])
      )
    );

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
          marketCap: item.marketCap ?? null,
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

  const histories = await getCachedDailyHistoryBulk(constituents);
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
