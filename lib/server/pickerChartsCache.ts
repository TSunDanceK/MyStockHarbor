import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { recordRedisRead } from "./redisBandwidth";

// Off-payload storage for the pickers' per-symbol chart series.
//
// WHY THIS EXISTS -- the 10MB wall
// --------------------------------
// Upstash "MSH-Market-Cache" is Pay-As-You-Go, whose **Max Request Size is
// 10MB** (an alert fired on 2026-08-04 for a request breaching it). The pickers
// payload is the request that gets near it. Measured on 2026-08-06 with the
// universe at 260:
//
//   payloadChars        3,382,852  (3.38 MB)
//   signalRecordChars   3,060,650
//   avgChartChars          11,016  x 260 symbols = 2.86 MB
//
// So **~85% of the entire payload is chart series**, and the cost scales
// linearly with the universe. `JSON.stringify().length` understates the wire
// size by ~15% (the value is embedded as a JSON string inside the command
// array, so every `"` becomes `\"`), which puts today's write at ~3.9MB on the
// wire. Raising the universe cap from 260 to its 700 ceiling would put it at
// roughly 9.9MB -- i.e. *exactly* on the wall, where `writePickersCache` starts
// failing and every request silently falls back to a live FMP rebuild.
//
// Keeping the series in a separate hash, written and read in bounded chunks,
// means **no single Redis request approaches 10MB at any universe size**:
//
//   pickers payload SET   ~0.5MB   (was 3.9MB, and no longer grows with charts)
//   chart series HSET     ~0.5MB per chunk of CHUNK_SIZE symbols
//   chart series HMGET    ~0.5MB per chunk
//
// The read/write chunking is the point of this module, not an optimisation.
//
// SHAPE CONTRACT
// --------------
// `writePickersCache`/`readPickersCache` in pickersBuilder.ts are the only
// call sites: the payload is stripped of `chartPoints` on the way into Redis
// and has them re-attached on the way out. Every consumer therefore sees the
// exact same payload shape as before this module existed -- no component, page
// or API route needed changing. That is deliberate: it makes this change
// revertible in one commit and keeps the blast radius off the render paths.
//
// FOLLOW-UP (not done here): because the store is keyed per symbol, the
// re-attach could later be narrowed to just the symbols a given page actually
// draws. The screener's list view -- the default -- draws ZERO charts, and
// chart view draws at most CHART_PAGE_SIZE (21) at a time, yet the payload
// currently carries every series on every render. That is a large win, but it
// changes render paths, so it belongs in its own PR.

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

// THE 2026-08-06 MEASUREMENT, AS DATA RATHER THAN AS PROSE.
//
// The figure is in the header above and it was unreadable to anything but a
// person: readCodeOnly strips comments, so a check asserting against it was
// measuring a blank line. Same fix as EARNINGS_PEAK_SHARE_SOURCE -- a number the
// build has to agree with has to be something the build can see.
//
// It is the only LIVE byte figure this system has for a chart series, which
// makes it the cross-check that decides whether a reconstructed measurement is
// credible at all. scripts/check-redis-bandwidth.mjs rebuilds the series from
// buildPickerChartPoints' own field set and requires the result to land within
// 5% of this.
export const PICKER_CHARTS_MEASURED_AVG_CHARS = 11_016;
export const PICKER_CHARTS_MEASURED_AT = "2026-08-06";
export const PICKER_CHARTS_MEASURED_SOURCE =
  "/api/debug/pickers-size in production, universe 260: payloadChars 3,382,852, " +
  "signalRecordChars 3,060,650, avgChartChars 11,016";

const PICKER_CHARTS_KEY = "msh:picker-charts:v1";

// Must comfortably outlive PICKERS_REDIS_TTL_SECONDS (1h) so the series can
// never expire out from under a payload that is still being served.
const PICKER_CHARTS_TTL_SECONDS = 3 * 60 * 60;

// ~11KB per symbol measured, so 40 symbols is ~0.44MB per request -- an order
// of magnitude under the 10MB ceiling, with room for the series to grow.
const CHUNK_SIZE = 40;

// Structural mirror of pickersBuilder's local PickerChartPoint. Kept as an
// index-signature record rather than an import so this module stays free of a
// circular dependency on the 112KB builder; the series is opaque here -- we
// only ever store and return it verbatim.
export type StoredChartPoint = {
  date: string;
  close: number;
  [key: string]: unknown;
};

function cleanSymbol(value: string) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "");
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Write every symbol's series to the hash in bounded chunks.
 *
 * Chunks are written sequentially rather than in parallel: this runs once per
 * pickers rebuild (not per request), so wall-clock is irrelevant, and serial
 * writes keep the Upstash request rate flat rather than spiking.
 *
 * Fail-open by design, and per-chunk: one rejected chunk loses those symbols'
 * charts for this build (they render "Chart preview unavailable", exactly as an
 * un-warmed symbol does today) rather than failing the whole write. The caller
 * must not treat a false return as a reason to skip caching the payload.
 */
export async function writePickerChartsBulk(
  series: Map<string, StoredChartPoint[]>
): Promise<{ ok: boolean; written: number; chunks: number; failedChunks: number }> {
  if (!redis || !series.size) {
    return { ok: false, written: 0, chunks: 0, failedChunks: 0 };
  }

  const entries = Array.from(series.entries())
    .map(([symbol, points]) => [cleanSymbol(symbol), points] as const)
    .filter(([symbol, points]) => symbol && Array.isArray(points) && points.length);

  const groups = chunk(entries, CHUNK_SIZE);
  let written = 0;
  let failedChunks = 0;

  for (const group of groups) {
    const payload: Record<string, StoredChartPoint[]> = {};
    for (const [symbol, points] of group) payload[symbol] = points;

    try {
      await redis.hset(PICKER_CHARTS_KEY, payload);
      written += group.length;
    } catch (error) {
      failedChunks += 1;
      console.warn(
        `[picker-charts] chunk write failed (${group.length} symbols)`,
        error instanceof Error ? error.message : error
      );
    }
  }

  try {
    // Reset the safety expiry on every build so a stopped builder self-expires
    // rather than leaving a stale hash behind forever.
    await redis.expire(PICKER_CHARTS_KEY, PICKER_CHARTS_TTL_SECONDS);
  } catch {
    // fail open -- a missed expire just means the hash lives longer than needed
  }

  return { ok: failedChunks === 0, written, chunks: groups.length, failedChunks };
}

/**
 * Read the series for the given symbols, in bounded chunks. Any symbol with no
 * stored series is simply absent from the returned map -- callers already treat
 * a missing/empty series as "Chart preview unavailable" (MiniPickerCandleChart
 * renders that placeholder for anything under 4 valid points).
 *
 * Fail-open per chunk, for the same reason as the write path.
 */
export async function readPickerChartsBulk(
  symbols: string[]
): Promise<Map<string, StoredChartPoint[]>> {
  const out = new Map<string, StoredChartPoint[]>();
  if (!redis) return out;

  const fields = Array.from(new Set(symbols.map(cleanSymbol).filter(Boolean)));
  if (!fields.length) return out;

  // ~11 KB per symbol, and the whole universe is read on every picker page
  // regeneration that misses the in-process memo. Counted before the chunk loop
  // so a partial read still reports what it asked for -- the bandwidth is spent
  // on the request, not on the reply being usable.
  await recordRedisRead("picker-charts", fields.length);

  for (const group of chunk(fields, CHUNK_SIZE)) {
    try {
      // Upstash's hmget returns an object keyed by field name on some versions
      // and an array aligned to the requested fields on others. Handle both, or
      // the read silently returns nothing (this exact bug cost a debugging
      // session in pricePool.ts -- see readPricePoolBulk).
      const raw = (await redis.hmget(PICKER_CHARTS_KEY, ...group)) as unknown;
      const asArray = Array.isArray(raw) ? (raw as (StoredChartPoint[] | null)[]) : null;
      const asObj =
        !asArray && raw && typeof raw === "object"
          ? (raw as Record<string, StoredChartPoint[] | null>)
          : null;
      if (!asArray && !asObj) continue;

      group.forEach((symbol, i) => {
        const points = asArray ? asArray[i] : asObj ? asObj[symbol] : null;
        if (Array.isArray(points) && points.length) out.set(symbol, points);
      });
    } catch (error) {
      console.warn(
        `[picker-charts] chunk read failed (${group.length} symbols)`,
        error instanceof Error ? error.message : error
      );
    }
  }

  return out;
}

/** Diagnostics for /api/debug/pickers-size. Never throws. */
export async function statPickerCharts(): Promise<{
  symbols: number | null;
  ttlSeconds: number | null;
}> {
  if (!redis) return { symbols: null, ttlSeconds: null };
  try {
    const [symbols, ttlSeconds] = await Promise.all([
      redis.hlen(PICKER_CHARTS_KEY),
      redis.ttl(PICKER_CHARTS_KEY),
    ]);
    return {
      symbols: typeof symbols === "number" ? symbols : null,
      ttlSeconds: typeof ttlSeconds === "number" ? ttlSeconds : null,
    };
  } catch {
    return { symbols: null, ttlSeconds: null };
  }
}
