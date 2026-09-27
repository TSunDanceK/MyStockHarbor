// THE TWO TIINGO JOBS, AND THE ONLY IMPORTER OF THE ADAPTER
// (#553 COWORK #55 §2, #56, #57; scripts/check-tiingo-callers.mjs).
//
// Both run from cron routes wrapped in the job guard (kill switch, daily
// breaker, per-run command budget, stop on a Redis error). Both write under
// msh:tiingo: only; no page reads those keys until a surface is switched.
//
// ── HOURLY QUOTES ────────────────────────────────────────────────────────────
// The IEX batch: ~9 requests for ~844 tickers, then ONE HSET of the whole pool
// and one revalidateTag('prices'). Acts only inside the buffered market window
// (marketHours.ts); outside it the run returns at once, spending nothing but
// the guard's own bookkeeping.
//
//   THE FRESHNESS KNOB is QUOTE_CADENCE_MINUTES, with the cron line in
//   vercel.json and jobRuns.ts beside it (check-tiingo-step1 keeps the three in
//   step). Hourly now; the PR body prices 15 minutes.
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
import { revalidateTag } from "next/cache";
import { Redis } from "@upstash/redis";
import { PRICE_POOL_KEY } from "../pricePool";
import { isActiveMarketWindow } from "../marketHours";
import { lastSessionDate } from "../lastSession";
import {
  EOD_TAG,
  PRICES_TAG,
  TIINGO_EOD_META_KEY,
  TIINGO_EOD_TTL_SECONDS,
  TIINGO_QUOTES_KEY,
  TIINGO_QUOTES_META_FIELD,
  TIINGO_QUOTES_TTL_SECONDS,
  tiingoEodKey,
} from "./keys";
import {
  TiingoHttpError,
  TiingoRefused,
  fetchEodHistory,
  fetchEodLanded,
  fetchIexQuotes,
  reserveTiingoRequests,
  tiingoCallRefusal,
} from "./tiingo";
import type { EodBar, StoredEod } from "./types";

/** THE FRESHNESS KNOB. Keep vercel.json's tiingo-quotes cron and jobRuns.ts in step. */
export const QUOTE_CADENCE_MINUTES = 60;

/** The window we keep, as today's FMP history does (MAX_CACHED_HISTORY_DAYS). */
export const EOD_WINDOW_DAYS = 1400;
/**
 * Fewer bars than this is not a history, and is not stored (mirrors
 * historyCache's MIN_QUALIFIED_POINTS). Measured on the first night
 * (2026-09-26, CODE-B #50): Tiingo answered BK with 5 rows since 2022 and the
 * job stored them as BK's history, which a chart or MA200 would have read as
 * the whole record. A short answer now deletes the key instead, so a reader
 * falls back to FMP rather than to a truncated series.
 */
export const EOD_MIN_BARS = 30;
/** A night is "landed" when at least this share of the universe has tonight's date in the bulk file. */
export const EOD_LANDED_SHARE = 0.9;
const EOD_CONCURRENCY = 8;
/** Requests reserved per limiter round trip (4 commands each). */
const EOD_RESERVE_BLOCK = 100;
/** SETs per pipeline. Billed per command either way; this bounds the body size. */
const EOD_WRITE_CHUNK = 50;
const EOD_BUDGET_MS = 240_000;

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? Redis.fromEnv() : null;

function mustRedis(): Redis {
  if (!redis) throw new Error("no redis");
  return redis;
}

/** The universe: the price pool's fields (dashed). 1 HKEYS. */
async function universe(): Promise<string[]> {
  const keys = await mustRedis().hkeys(PRICE_POOL_KEY);
  return [...new Set(keys.map((k) => String(k).trim().toUpperCase()).filter(Boolean))].sort();
}

function refusalResult(err: unknown) {
  if (err instanceof TiingoRefused) return { ok: false, refused: err.reason };
  if (err instanceof TiingoHttpError) return { ok: false, httpStatus: err.status };
  return null;
}

// ── hourly ──────────────────────────────────────────────────────────────────

export async function runTiingoQuotes(nowMs = Date.now()) {
  if (!isActiveMarketWindow(new Date(nowMs))) return { ok: true, skipped: "outside-market-window" };
  const refusal = tiingoCallRefusal();
  if (refusal) return { ok: true, skipped: `tiingo: ${refusal}` };
  const symbols = await universe();
  if (!symbols.length) return { ok: false, error: "empty universe" };
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
  };
}

// ── nightly ─────────────────────────────────────────────────────────────────

export function eodStartDate(nowMs: number): string {
  return new Date(nowMs - EOD_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
}

/** Tonight's date has landed for enough of the universe. Exported for the checks. */
export function eodLanded(counts: Map<string, number>, expected: string, universeSize: number): boolean {
  return (counts.get(expected) ?? 0) >= Math.ceil(universeSize * EOD_LANDED_SHARE);
}

/**
 * Nightly EOD. `onBars` receives every symbol's fresh bars in memory -- the
 * hook #57 §4 moves the Pickers daily computation onto (not wired in step 1).
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
  if (metaAsOf === expected) return { ok: true, skipped: "already-complete", asOf: expected };

  const symbols = await universe();
  if (!symbols.length) return { ok: false, error: "empty universe" };

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
        if (got.bars.length >= EOD_MIN_BARS) bars.set(sym, got.bars);
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
  const entries = [...bars.entries()];
  for (let i = 0; i < entries.length; i += EOD_WRITE_CHUNK) {
    const p = r.pipeline();
    for (const [sym, b] of entries.slice(i, i + EOD_WRITE_CHUNK)) {
      const value: StoredEod = { asOf: b[b.length - 1][0], fetchedAt: nowMs, bars: b };
      const json = JSON.stringify(value);
      bytesWritten += json.length;
      p.set(tiingoEodKey(sym), json, { ex: TIINGO_EOD_TTL_SECONDS });
    }
    await p.exec();
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
  };
  // Only a complete night stamps the meta key, so the 02:45 retry re-runs a partial one.
  if (complete) await r.set(TIINGO_EOD_META_KEY, JSON.stringify(summary), { ex: TIINGO_EOD_TTL_SECONDS });
  if (bars.size) revalidateTag(EOD_TAG, "max");
  if (onBars && bars.size) await onBars(bars);
  return {
    ok: complete,
    ...summary,
    stoppedBy,
    requests,
    bytesDownloaded,
    bytesWritten,
    ms: Date.now() - started,
  };
}

/** A job result as a run-record summary: scalars kept, anything nested as JSON. */
export function runSummary(result: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(result)) {
    out[k] = v === null || v === undefined ? null : typeof v === "object" ? JSON.stringify(v) : (v as string | number | boolean);
  }
  return out;
}
