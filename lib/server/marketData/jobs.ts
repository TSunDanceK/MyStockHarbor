// THE TWO TIINGO JOBS, AND THE ONLY IMPORTER OF THE ADAPTER
// (#553 COWORK #55 §2, #56, #57; scripts/check-tiingo-callers.mjs).
//
// Both run from cron routes wrapped in the job guard (kill switch, daily
// breaker, per-run command budget, stop on a Redis error). Both write under
// msh:tiingo: only; no page reads those keys until a surface is switched.
//
// ── QUOTES EVERY 15 MINUTES ──────────────────────────────────────────────────
// The IEX batch: ~9 requests for ~844 tickers, then ONE HSET of the whole pool
// and one revalidateTag('prices'). Acts only inside the buffered market window
// (marketHours.ts); outside it the run returns at once, spending nothing but
// the guard's own bookkeeping.
//
//   THE FRESHNESS KNOB is QUOTE_CADENCE_MINUTES, with the cron line in
//   vercel.json and jobRuns.ts beside it (check-tiingo-step1 keeps the three in
//   step). 15 minutes since 2026-09-29 (#656); hourly before.
//
// ── NIGHTLY EOD ──────────────────────────────────────────────────────────────
// A FULL RE-PULL, NOT A TAIL MERGE (COWORK #56 asks which, and why):
//   * It never reads stored history back, so 0 Upstash history reads a night.
//     A tail merge must GET each symbol's ~43 KB before appending to it.
//   * Adjusted prices are right after every split and dividend with no
//     detection logic. A tail merge must notice divCash/splitFactor and then
//     re-pull that symbol anyway, and a missed one is silently wrong forever.
//   * The bars are all in memory at the end, which is where #57 §4 wants the
//     Pickers daily computation to run.
//   * Cost: ~845 requests a night (0.35% of the daily cap) and ~5 GB a month
//     of Tiingo bandwidth (0.5% of 1 TB).
// The bulk file is fetched first, but ONLY as the gate that tonight's date has
// landed; its rows are not stored. If it has not landed, the run stops and the
// 02:45 retry tries again. A night already complete is skipped (1 GET).
import { inflateRawSync } from "node:zlib";
import { revalidateTag } from "next/cache";
import { Redis } from "@upstash/redis";
import { PRICE_POOL_KEY } from "../pricePool";
import { isActiveMarketWindow } from "../marketHours";
import { lastSessionDate } from "../lastSession";
import {
  EOD_TAG,
  PRICES_TAG,
  TIINGO_EOD_LAST_KEY,
  TIINGO_EOD_META_KEY,
  TIINGO_EOD_TTL_SECONDS,
  TIINGO_QUOTES_KEY,
  TIINGO_QUOTES_META_FIELD,
  TIINGO_QUOTES_TTL_SECONDS,
  TIINGO_UNIVERSE_KEY,
  TIINGO_REQUESTED_KEY,
  TIINGO_SUPPORTED_KEY,
  TIINGO_SUPPORTED_MARKER,
  TIINGO_SUPPORTED_TTL_SECONDS,
  TIINGO_COLD_NODATA_KEY,
  tiingoEodKey,
} from "./keys";
import { eodLastRow } from "./eodLast";
import { EOD_WINDOW_BARS, EOD_MIN_BARS, eodStartDate } from "./eodWindow";
import { parseTiingoUniverse } from "../tiingoUniverse";
import {
  TiingoHttpError,
  TiingoRefused,
  fetchEodHistory,
  fetchEodLanded,
  fetchIexQuotes,
  fetchSupportedTickers,
  reserveTiingoRequests,
  tiingoCallRefusal,
} from "./tiingo";
import type { EodBar, StoredEod } from "./types";
import type { SupportedTickerRow } from "./tiingo";
import { isDebtListing, retickeredOut } from "./universe";
import { isPriceExcluded } from "../../priceExcluded.mjs";
import { loadTickerMap } from "../secTickerMap";
import { readLastSeenCiks } from "../secListing";
import { lookupBySpelling, toDashed } from "../../symbolSpellings.mjs";
import { pctOfRequestLimit } from "../chunkByBytes";

/**
 * THE FRESHNESS KNOB. Keep vercel.json's tiingo-quotes cron and jobRuns.ts in step.
 * 15 since 2026-09-28 (#553 COWORK #60, pre-approved on a clean Monday): hourly
 * measured 9 requests and 7 Redis commands per active run, so 33 active runs a
 * day are ~297 requests (0.1% of the daily cap) and ~231 commands.
 */
export const QUOTE_CADENCE_MINUTES = 15;

// The stored window (EOD_WINDOW_BARS / _DAYS, EOD_MIN_BARS, eodStartDate) lives
// in eodWindow.ts, shared with the stock-page cold fill; re-exported here.
export { EOD_WINDOW_BARS, EOD_WINDOW_DAYS, EOD_MIN_BARS, eodStartDate } from "./eodWindow";
/** A night is "landed" when at least this share of the universe has tonight's date in the bulk file. */
export const EOD_LANDED_SHARE = 0.9;
const EOD_CONCURRENCY = 8;
/** Requests reserved per limiter round trip (4 commands each). */
const EOD_RESERVE_BLOCK = 100;
/**
 * SETs per pipeline. Billed per command either way; this bounds the body size.
 * 25, not 50, since 2026-10-01 (#553 COWORK #82): at 1,400 bars the largest
 * stored row measured 81,492 B, so 50 rows came to ~4.2 MB with escaping, 83%
 * of REQUEST_BYTE_BUDGET. 25 keeps one request near 2.1 MB (check-redis-write-sites).
 */
const EOD_WRITE_CHUNK = 25;
const EOD_BUDGET_MS = 240_000;

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? Redis.fromEnv() : null;

function mustRedis(): Redis {
  if (!redis) throw new Error("no redis");
  return redis;
}

/**
 * The universe: msh:tiingo:universe:v1 (step 5, #553 COWORK #98 ruling 2: the
 * symbols-only list warm-price-pool writes with no FMP call), or, while that
 * key is absent, the price pool's fields (dashed) as before. Either way, less
 * debt listings (CCZ and the other exchange-traded notes, #553 COWORK #60 --
 * see universe.ts), the dated PRICE_EXCLUDED list (lib/priceExcluded.ts,
 * COWORK #61) and any ticker SEC has moved to another (retickeredOut, COWORK
 * #70). 1 GET, plus 1 HKEYS only when the key is absent, plus 1 HMGET of
 * last-seen CIKs when some symbol is missing from SEC's live map.
 */
async function universe(): Promise<{ symbols: string[]; retickered: string[]; retickerGuard: string; universeSource: string }> {
  const stored = parseTiingoUniverse(await mustRedis().get<unknown>(TIINGO_UNIVERSE_KEY));
  const keys = stored ? stored.symbols : await mustRedis().hkeys(PRICE_POOL_KEY);
  const universeSource = stored ? "tiingo-universe" : "pool-hkeys";
  // THE COLD-FILLED SYMBOLS (#553 COWORK #121 §4): kept fresh while people view
  // them, capped at 1,000 and dropped after 30 days unviewed (coldFill.ts).
  // 1 ZRANGE; an unreadable set just leaves them out of this run.
  const requestedRaw = await mustRedis().zrange<string[]>(TIINGO_REQUESTED_KEY, 0, -1).catch(() => [] as string[]);
  const requested = Array.isArray(requestedRaw) ? requestedRaw : [];
  const pool = [...new Set([...keys, ...requested].map((k) => String(k).trim().toUpperCase()).filter(Boolean))]
    .filter((s) => !isDebtListing(s) && !isPriceExcluded(s))
    .sort();
  const live = loadTickerMap();
  const unlisted = live.present ? pool.filter((s) => !lookupBySpelling(live.map, s)) : [];
  const lastSeen = unlisted.length ? await readLastSeenCiks(unlisted) : new Map<string, string>();
  const r = retickeredOut(pool, live, lastSeen);
  if (r.dropped.length) console.warn(`[tiingo] retickered, not sent: ${r.dropped.map((d) => `${d.symbol}->${d.listed.join("/")}`).join(" ")}`);
  return { symbols: r.keep, retickered: r.dropped.map((d) => d.symbol), retickerGuard: r.guard, universeSource };
}

function refusalResult(err: unknown) {
  if (err instanceof TiingoRefused) return { ok: false, refused: err.reason };
  if (err instanceof TiingoHttpError) return { ok: false, httpStatus: err.status };
  return null;
}

// ── quotes (every QUOTE_CADENCE_MINUTES) ─────────────────────────────────────

export async function runTiingoQuotes(nowMs = Date.now()) {
  if (!isActiveMarketWindow(new Date(nowMs))) return { ok: true, skipped: "outside-market-window" };
  const refusal = tiingoCallRefusal();
  if (refusal) return { ok: true, skipped: `tiingo: ${refusal}` };
  const { symbols, retickered, retickerGuard, universeSource } = await universe();
  if (!symbols.length) return { ok: false, error: "empty universe", universeSource };
  let fetched;
  try {
    fetched = await fetchIexQuotes(symbols, nowMs);
  } catch (err) {
    const r = refusalResult(err);
    if (r) return { ...r, universe: symbols.length };
    throw err;
  }
  const fields: Record<string, string> = {};
  for (const [sym, q] of fetched.quotes) fields[sym] = JSON.stringify(q);
  if (!Object.keys(fields).length) return { ok: false, universe: symbols.length, requests: fetched.requests, quotes: 0 };
  fields[TIINGO_QUOTES_META_FIELD] = JSON.stringify({ at: nowMs, n: fetched.quotes.size });
  const p = mustRedis().pipeline();
  p.hset(TIINGO_QUOTES_KEY, fields);
  p.expire(TIINGO_QUOTES_KEY, TIINGO_QUOTES_TTL_SECONDS);
  await p.exec();
  revalidateTag(PRICES_TAG, "max");
  return {
    ok: true,
    universe: symbols.length,
    quotes: fetched.quotes.size,
    missing: symbols.length - fetched.quotes.size,
    requests: fetched.requests,
    bytesDownloaded: fetched.bytes,
    bytesWritten: Object.entries(fields).reduce((n, [k, v]) => n + k.length + v.length, 0),
    retickered,
    retickerGuard,
    universeSource,
  };
}

// ── nightly ─────────────────────────────────────────────────────────────────

/** Tonight's date has landed for enough of the universe. Exported for the checks. */
export function eodLanded(counts: Map<string, number>, expected: string, universeSize: number): boolean {
  return (counts.get(expected) ?? 0) >= Math.ceil(universeSize * EOD_LANDED_SHARE);
}

/**
 * Nightly EOD. `onBars` receives every symbol's fresh bars in memory -- the
 * hook #57 §4 moves the Pickers daily computation onto (wired in step 2 by the
 * EOD route). Called on a COMPLETE night only: a partial night's build would
 * mix tonight's bars with the Data Cache's, and the 02:45 retry re-runs it.
 */
export async function runTiingoEod(
  nowMs = Date.now(),
  onBars?: (bars: Map<string, EodBar[]>) => Promise<void> | void
) {
  const refusal = tiingoCallRefusal();
  if (refusal) return { ok: true, skipped: `tiingo: ${refusal}` };
  const started = Date.now();
  const expected = lastSessionDate(nowMs);
  const r = mustRedis();

  const meta = await r.get<{ asOf?: string } | string>(TIINGO_EOD_META_KEY);
  const metaAsOf = typeof meta === "string" ? (JSON.parse(meta) as { asOf?: string }).asOf : meta?.asOf;
  if (metaAsOf === expected) return { ok: true, skipped: "already-complete", asOf: expected, ...(await backfillEod(nowMs, started)) };

  const { symbols, retickered, retickerGuard, universeSource } = await universe();
  if (!symbols.length) return { ok: false, error: "empty universe", universeSource };

  let bytesDownloaded = 0;
  let requests = 0;
  try {
    const landed = await fetchEodLanded(nowMs);
    requests++;
    bytesDownloaded += landed.bytes;
    if (!eodLanded(landed.counts, expected, symbols.length)) {
      return { ok: false, notLanded: expected, rowsForExpected: landed.counts.get(expected) ?? 0, universe: symbols.length };
    }
  } catch (err) {
    const res = refusalResult(err);
    if (res) return { ...res, stage: "bulk gate" };
    throw err;
  }

  const start = eodStartDate(nowMs);
  const bars = new Map<string, EodBar[]>();
  const failed = new Map<string, number>();
  let reserved = 0;
  let stoppedBy: string | null = null;
  let reserving: Promise<void> | null = null;
  const shortOrEmpty: string[] = [];
  const dropKeys: string[] = [];
  let next = 0;
  const worker = async () => {
    while (!stoppedBy && next < symbols.length) {
      if (Date.now() - started > EOD_BUDGET_MS) { stoppedBy = "time budget"; return; }
      // One reservation at a time: workers that find the block spent wait on
      // the same round trip instead of each reserving another 100.
      while (reserved <= requests && !stoppedBy) {
        reserving ??= reserveTiingoRequests(EOD_RESERVE_BLOCK, nowMs).then(
          () => { reserved += EOD_RESERVE_BLOCK; },
          (err) => { stoppedBy = err instanceof TiingoRefused ? err.reason : "limiter error"; }
        ).finally(() => { reserving = null; });
        await reserving;
      }
      if (stoppedBy || next >= symbols.length) return;
      const sym = symbols[next++];
      requests++;
      try {
        const got = await fetchEodHistory(sym, start);
        bytesDownloaded += got.bytes;
        if (got.bars.length >= EOD_MIN_BARS) bars.set(sym, got.bars.slice(-EOD_WINDOW_BARS));
        else {
          const why = got.bars.length ? "short" : "empty";
          failed.set(why, (failed.get(why) ?? 0) + 1);
          if (shortOrEmpty.length < 20) shortOrEmpty.push(sym);
          dropKeys.push(tiingoEodKey(sym));
        }
      } catch (err) {
        const key = err instanceof TiingoHttpError ? String(err.status) : "error";
        failed.set(key, (failed.get(key) ?? 0) + 1);
        if (err instanceof TiingoHttpError && err.status === 429) stoppedBy = "HTTP 429";
      }
    }
  };
  await Promise.all(Array.from({ length: EOD_CONCURRENCY }, worker));

  // Write. Symbols that failed keep last night's value until its TTL lapses.
  let bytesWritten = 0;
  // THE LARGEST REQUEST, LOGGED EVERY RUN (#553 COWORK #83): this pipeline is
  // the only multi-MB request the census found, so it must not be the one whose
  // size is invisible. Measured as the body the client sends.
  let largestWriteRequestBytes = 0;
  const entries = [...bars.entries()];
  for (let i = 0; i < entries.length; i += EOD_WRITE_CHUNK) {
    const p = r.pipeline();
    const cmds: Array<[string, string, string, string, number]> = [];
    for (const [sym, b] of entries.slice(i, i + EOD_WRITE_CHUNK)) {
      const value: StoredEod = { asOf: b[b.length - 1][0], fetchedAt: nowMs, basis: "split", bars: b };
      const json = JSON.stringify(value);
      bytesWritten += json.length;
      cmds.push(["set", tiingoEodKey(sym), json, "ex", TIINGO_EOD_TTL_SECONDS]);
      p.set(tiingoEodKey(sym), json, { ex: TIINGO_EOD_TTL_SECONDS });
    }
    largestWriteRequestBytes = Math.max(largestWriteRequestBytes, pipelineRequestBytes(cmds));
    await p.exec();
  }
  if (entries.length) {
    console.log(
      `[tiingo-eod] largest write request ${largestWriteRequestBytes} bytes (${pctOfRequestLimit(largestWriteRequestBytes)} of the 10MB limit), ${Math.ceil(entries.length / EOD_WRITE_CHUNK)} requests`
    );
  }
  // A short or empty answer removes last night's value too: stale is not
  // better than absent when the absent case falls back to FMP. 1 DEL (one
  // command, however many keys).
  if (dropKeys.length) await r.del(...dropKeys);
  const complete = !stoppedBy && bars.size >= Math.ceil(symbols.length * EOD_LANDED_SHARE);
  const summary = {
    asOf: expected,
    at: nowMs,
    universe: symbols.length,
    written: bars.size,
    failed: Object.fromEntries(failed),
    shortOrEmpty,
    retickered,
    retickerGuard,
    universeSource,
  };
  // THE NEWEST BAR PER SYMBOL, ONE HASH (step 5, #553 COWORK #98): what every
  // pool reader and the sector pages read instead of 1,400-bar histories (see
  // eodLast.ts). A complete night only, written whole: DEL + HSET + EXPIRE, 3
  // commands in one request of ~150 B a symbol (~0.45 MB at 3,000). A symbol
  // that failed tonight drops out until tomorrow; its reader keeps the IEX row
  // and IEX's prevClose, or FMP's row.
  let eodLastRows = 0;
  if (complete) {
    const fields: Record<string, string> = {};
    for (const [sym, b] of bars) {
      const row = eodLastRow(b);
      if (row) fields[sym] = JSON.stringify(row);
    }
    eodLastRows = Object.keys(fields).length;
    if (eodLastRows) {
      const p = r.pipeline();
      p.del(TIINGO_EOD_LAST_KEY);
      p.hset(TIINGO_EOD_LAST_KEY, fields);
      p.expire(TIINGO_EOD_LAST_KEY, TIINGO_EOD_TTL_SECONDS);
      await p.exec();
    }
  }
  // Only a complete night stamps the meta key, so the 02:45 retry re-runs a partial one.
  if (complete) await r.set(TIINGO_EOD_META_KEY, JSON.stringify(summary), { ex: TIINGO_EOD_TTL_SECONDS });
  if (bars.size) revalidateTag(EOD_TAG, "max");
  if (onBars && complete && bars.size) await onBars(bars);
  return {
    ok: complete,
    ...summary,
    stoppedBy,
    requests,
    bytesDownloaded,
    bytesWritten,
    largestWriteRequestBytes,
    eodLastRows,
    ms: Date.now() - started,
  };
}

// ── backfill (a complete night, a wider universe) ───────────────────────────
// #553 COWORK #124. The universe grew (5b, ~760 -> ~2,600) AFTER the night was
// marked complete, so the run answered "already-complete" and the new symbols
// waited for the next night. Now an already-complete run fetches the universe
// symbols with NO entry in eod-last (the newest-bar hash every pool reader
// uses), up to EOD_BACKFILL_PER_RUN, and adds them to it. A manual run repeats
// until `backfilled` is 0; the 02:45 retry does the same each night.
//
// Same per-symbol path and the same shared limiter as the night itself.
// Symbols Tiingo answers short or empty for stay missing (they are not stored
// as histories) and are retried by later runs: `backfillNoData` counts them.
//
// Commands: HKEYS eod-last (1) + the universe's own reads; per 100 symbols, 4
// for the limiter, 4 SET pipelines of 25 (100) and 1 HSET.

/** Symbols one backfill run fetches at most: ~32 s at the 2 Oct rate, 1,000 Tiingo requests. */
export const EOD_BACKFILL_PER_RUN = 1_000;

async function backfillEod(nowMs: number, started: number) {
  const r = mustRedis();
  const { symbols } = await universe();
  const have = new Set(((await r.hkeys(TIINGO_EOD_LAST_KEY)) ?? []).map(String));
  const missing = symbols.filter((s) => !have.has(s));
  const todo = missing.slice(0, EOD_BACKFILL_PER_RUN);
  if (!todo.length) return { backfilled: 0, backfillMissing: 0 };
  const start = eodStartDate(nowMs);
  const bars = new Map<string, EodBar[]>();
  let noData = 0;
  let failed = 0;
  let stoppedBy: string | null = null;
  try {
    await reserveTiingoRequests(todo.length, nowMs);
  } catch (err) {
    return { backfilled: 0, backfillMissing: missing.length, backfillStoppedBy: err instanceof TiingoRefused ? err.reason : "limiter error" };
  }
  let next = 0;
  const worker = async () => {
    while (!stoppedBy && next < todo.length) {
      if (Date.now() - started > EOD_BUDGET_MS) { stoppedBy = "time budget"; return; }
      const sym = todo[next++];
      try {
        const got = await fetchEodHistory(sym, start);
        if (got.bars.length >= EOD_MIN_BARS) bars.set(sym, got.bars.slice(-EOD_WINDOW_BARS));
        else noData++;
      } catch (err) {
        failed++;
        if (err instanceof TiingoHttpError && err.status === 429) stoppedBy = "HTTP 429";
      }
    }
  };
  await Promise.all(Array.from({ length: EOD_CONCURRENCY }, worker));
  const entries = [...bars.entries()];
  for (let i = 0; i < entries.length; i += EOD_WRITE_CHUNK) {
    const p = r.pipeline();
    const fields: Record<string, string> = {};
    for (const [sym, b] of entries.slice(i, i + EOD_WRITE_CHUNK)) {
      const value: StoredEod = { asOf: b[b.length - 1][0], fetchedAt: nowMs, basis: "split", bars: b };
      p.set(tiingoEodKey(sym), JSON.stringify(value), { ex: TIINGO_EOD_TTL_SECONDS });
      const row = eodLastRow(b);
      if (row) fields[sym] = JSON.stringify(row);
    }
    // Added to the night's summary hash, so a pool reader sees the symbol now
    // and the next backfill run does not fetch it again. HSET keeps the
    // hash's TTL from the night that wrote it.
    if (Object.keys(fields).length) p.hset(TIINGO_EOD_LAST_KEY, fields);
    await p.exec();
  }
  if (entries.length) revalidateTag(EOD_TAG, "max");
  return {
    backfilled: entries.length,
    backfillMissing: missing.length - entries.length,
    backfillNoData: noData,
    backfillFailed: failed,
    backfillStoppedBy: stoppedBy,
  };
}

/** The body @upstash/redis sends for a pipeline: the JSON array of its commands. Pure; exported for the checks. */
export function pipelineRequestBytes(cmds: ReadonlyArray<ReadonlyArray<string | number>>): number {
  return Buffer.byteLength(JSON.stringify(cmds), "utf8");
}

/** A job result as a run-record summary: scalars kept, anything nested as JSON. */
export function runSummary(result: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(result)) {
    out[k] = v === null || v === undefined ? null : typeof v === "object" ? JSON.stringify(v) : (v as string | number | boolean);
  }
  return out;
}

// ── supported tickers (daily) ───────────────────────────────────────────────
// THE COLD FILL'S ADMISSION LIST (#553 COWORK #121 §2): only a ticker Tiingo
// carries may cost a cold-fill call, so random strings never do. Tiingo's own
// daily file, filtered to what a US stock page can show: USD-priced stocks and
// ETFs still trading (an endDate within SUPPORTED_RECENT_DAYS).

/** A ticker whose endDate is older than this is treated as no longer trading. */
export const SUPPORTED_RECENT_DAYS = 14;
/** Fewer rows than this after the filter is a bad file, not a list: keep yesterday's. */
export const SUPPORTED_MIN_ROWS = 5_000;
const SUPPORTED_SADD_CHUNK = 5_000;

/** Pure: the symbols to keep, in our dashed upper-case spelling. Exported for the checks. */
export function supportedSymbols(rows: SupportedTickerRow[], nowMs: number): string[] {
  const since = new Date(nowMs - SUPPORTED_RECENT_DAYS * 86_400_000).toISOString().slice(0, 10);
  const out = new Set<string>();
  for (const r of rows) {
    if (r.priceCurrency !== "USD") continue;
    if (r.assetType !== "Stock" && r.assetType !== "ETF") continue;
    if (!r.endDate || r.endDate < since) continue;
    const sym = r.ticker.trim().toUpperCase();
    if (/^[A-Z0-9][A-Z0-9.-]{0,9}$/.test(sym)) out.add(toDashed(sym));
  }
  return [...out].sort();
}

/**
 * Replace msh:tiingo:supported:v1 whole: build a temp set, then RENAME over the
 * live one (so a reader never sees half a list), EXPIRE, and clear the no-data
 * set (a symbol Tiingo answered empty for gets one more try a day). 1 Tiingo
 * request; Redis: DEL + ceil(n/5,000) SADD + 1 SADD marker + RENAME + EXPIRE +
 * DEL, ~12 commands a run at ~30,000 symbols.
 */
export async function runTiingoSupported(nowMs = Date.now()) {
  const refusal = tiingoCallRefusal();
  if (refusal) return { ok: true, skipped: `tiingo: ${refusal}` };
  let fetched;
  try {
    fetched = await fetchSupportedTickers((b) => inflateRawSync(b), nowMs);
  } catch (err) {
    const r = refusalResult(err);
    if (r) return r;
    throw err;
  }
  const symbols = supportedSymbols(fetched.rows, nowMs);
  if (symbols.length < SUPPORTED_MIN_ROWS) {
    return { ok: false, error: "too few supported symbols; kept the stored list", rows: fetched.rows.length, kept: symbols.length };
  }
  const r = mustRedis();
  const tmp = `${TIINGO_SUPPORTED_KEY}:building`;
  await r.del(tmp);
  for (let i = 0; i < symbols.length; i += SUPPORTED_SADD_CHUNK) {
    const chunk = symbols.slice(i, i + SUPPORTED_SADD_CHUNK);
    await r.sadd(tmp, chunk[0], ...chunk.slice(1));
  }
  await r.sadd(tmp, TIINGO_SUPPORTED_MARKER);
  await r.rename(tmp, TIINGO_SUPPORTED_KEY);
  await r.expire(TIINGO_SUPPORTED_KEY, TIINGO_SUPPORTED_TTL_SECONDS);
  await r.del(TIINGO_COLD_NODATA_KEY);
  return { ok: true, rows: fetched.rows.length, symbols: symbols.length, bytesDownloaded: fetched.bytes };
}
