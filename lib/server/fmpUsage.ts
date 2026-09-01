// Byte accounting for FMP, alongside the per-minute CALL counter in
// historyCache.ts.
//
// WHY CALLS CANNOT STAND IN FOR BYTES. The plan carries two independent limits:
// 300 calls/minute, and a 30-day rolling bandwidth cap (FMP_BANDWIDTH_CAP_BYTES
// below -- 40 GB while the data boost is live). Only the first is
// measured anywhere. They are not proportional and not close to it -- from the
// live FMP dashboard, /stable/quote runs ~0.3 KB per call and
// /stable/news/stock ~66 KB, a ~200x spread. A job comfortably inside the call
// guard can therefore be the one eating the cap, and nothing in this codebase
// could see it. At 14.72 GB on 2026-08-22 -- 73.6% of the 20 GB the plan
// carried before the data boost -- the unmeasured limit is the one that is
// close.
//
// The prime suspect is historical-price-eod/full: ~200 MB for one pass over 755
// symbols at MAX_CACHED_HISTORY_DAYS. That is ARITHMETIC, NOT A MEASUREMENT,
// which is exactly why this file exists -- a plausible number reasoned out from
// constants is the thing that stops people looking, and this project has paid
// for that before (claude/traps/measuring-the-wrong-layer.md).
//
// SHAPE
//   msh:fmp-bytes:v1:<YYYYMMDD>   Redis HASH, one per UTC day, 31-day TTL
//     <endpoint>:wire       bytes as they arrived (Content-Length when given)
//     <endpoint>:decoded    bytes after decompression (the parsed body's length)
//     <endpoint>:calls      call count, so KB/call is derivable per endpoint
//
// A rolling 30-day total is the sum of the last 30 day-hashes. Day granularity
// rather than a single rolling counter because a single counter cannot tell you
// WHEN the spend happened, and "which job did this" is the question that
// actually gets asked.
//
// WIRE AND DECODED ARE BOTH RECORDED, DELIBERATELY. FMP bills bandwidth by a
// methodology this codebase cannot observe. If they meter compressed transfer,
// `wire` is the comparable figure; if they meter payload, `decoded` is. Picking
// one and asserting it matches the dashboard would be measuring one layer and
// claiming another -- so both are stored and the reconciliation against the
// dashboard is left to whoever has the dashboard open. Where Content-Length is
// absent (chunked responses), `wire` falls back to the decoded length and the
// `wireExact` counter records how often it was a real header, so a reader can
// tell a measured total from a partly-inferred one.
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

const FMP_BYTES_PREFIX = "msh:fmp-bytes:v1";
// One day beyond the 30-day rolling window, so the oldest day in a 30-day read
// is still present rather than half-expired while being summed.
const FMP_BYTES_TTL_SECONDS = 60 * 60 * 24 * 31;

// The 30-day rolling bandwidth allowance, in bytes.
//
// THIS NUMBER IS NOT DERIVABLE AND MUST TRACK THE PLAN BY HAND. FMP exposes no
// endpoint reporting the account's own allowance, so nothing here can read it;
// it is a fact about the billing plan, typed in, and it goes stale silently
// when the plan changes. Every percentage this file and /cache-health report is
// computed from it, so a stale value does not fail -- it lies with confidence.
// It already did: this read 20 GB for the whole time the data boost was live,
// and /cache-health reported 20.4% of the cap when the truth was 10.2%. That
// page is what decides when the boost comes off, so the error pointed the one
// decision it feeds in exactly the wrong direction.
//
// The terms below are PARSED by scripts/check-ipo-cadence.mjs and summed
// against the constant, so changing one without the other fails rather than
// ships. That is the whole mechanism: the number cannot be verified against
// FMP from here, but it can be held to agreeing with its own stated reason.
//
//   base plan   20 GB
//   data boost  20 GB   <- live. Delete this line when the boost is dropped.
export const FMP_BANDWIDTH_CAP_BYTES = 40 * 1024 * 1024 * 1024;

function dayKey(d: Date) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * The endpoint label a URL is bucketed under.
 *
 * MUST NEVER RETURN ANYTHING DERIVED FROM THE QUERY STRING. The API key lives
 * there, and these labels end up in Redis, in a debug response and in logs. The
 * whole query is dropped rather than filtered, so there is no allowlist to get
 * wrong later -- a bucket is a PATH.
 *
 * Symbol-bearing path segments are collapsed too: /stable/quote/AAPL and
 * /stable/quote/MSFT are the same endpoint for this purpose, and keeping them
 * apart would produce hundreds of buckets that answer no question.
 */
export function fmpEndpointLabel(url: string): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = String(url).split("?")[0];
  }
  path = path.replace(/^\/+|\/+$/g, "");
  // Drop the API version prefix ("stable", "api/v3", "api/v4") so the label is
  // the endpoint rather than the vintage.
  path = path.replace(/^(stable|api\/v\d+)\//, "");
  const segments = path.split("/").filter(Boolean);
  // Keep at most two segments, and drop any that look like a ticker or a date
  // rather than a route name.
  const kept: string[] = [];
  for (const seg of segments) {
    if (kept.length >= 2) break;
    if (/^[A-Z][A-Z0-9.\-]{0,9}$/.test(seg)) continue; // ticker
    if (/^\d{4}-\d{2}-\d{2}$/.test(seg)) continue; // date
    kept.push(seg.toLowerCase());
  }
  return kept.join("/") || "unknown";
}

// ---------------------------------------------------------------------------
// BUFFERING. The meter must not cost more than the thing it measures.
//
// The first version awaited a Redis pipeline per FMP response. warmFundamentals
// makes ~477 calls in a run that ALREADY spends its entire 90-second wait
// budget, so that is ~477 serial Redis round-trips added to the job whose
// coverage the whole exercise is trying to improve -- an instrument that
// changes the reading. Counts are now accumulated in memory and written once.
//
// KEYED BY DAY AT RECORD TIME, NOT FLUSH TIME. A buffer that spans midnight
// would otherwise land every sample in whichever day the flush happened to
// occur, silently moving spend between the day buckets the whole report is
// built on. The day is stamped when the response is seen.
//
// ON LEAKING BETWEEN INVOCATIONS: this buffer is module state, and a warm
// serverless instance is reused across invocations. Three things bound that.
// The jobs call flushFmpUsage() explicitly when they finish, so the normal case
// is an empty buffer between invocations. `after()` schedules a flush once the
// response is sent, for request paths that do not flush explicitly. And a hard
// cap flushes inline, so a long-running or crashed invocation can neither grow
// the buffer without limit nor sit on samples indefinitely.
//
// Residual, and acceptable: if an invocation dies between recording and
// flushing, those samples are written by whichever invocation flushes next.
// They are still real calls attributed to the right DAY, just late. Losing them
// would be worse, and double-counting is impossible because the buffer is
// cleared before the write is awaited.
type UsageCell = { calls: number; wire: number; decoded: number; wireExact: number };

// Keyed `${dayKey}|${endpoint}` so the bucket cannot drift across a flush.
const buffer = new Map<string, UsageCell>();
let flushScheduled = false;

// Flush inline once the buffer reaches either bound. Distinct endpoints are few
// (a couple of dozen), so in practice the call bound is the one that fires --
// it keeps a 477-call run to a handful of writes rather than one giant one, and
// caps how many samples an abandoned invocation can be holding.
const MAX_BUFFERED_KEYS = 200;
const MAX_BUFFERED_CALLS = 250;
let bufferedCalls = 0;

/**
 * Write everything buffered, in one pipeline, and clear.
 *
 * Called explicitly by the warm jobs when they finish; also scheduled via
 * `after()` and by the size cap. Safe to call when empty, and safe to call
 * concurrently -- the buffer is swapped out before the await, so two overlapping
 * flushes cannot write the same sample twice.
 */
export async function flushFmpUsage(): Promise<void> {
  if (!redis || buffer.size === 0) return;

  const pending = [...buffer.entries()];
  buffer.clear();
  bufferedCalls = 0;

  try {
    const p = redis.pipeline();
    const days = new Set<string>();
    for (const [composite, cell] of pending) {
      const sep = composite.indexOf("|");
      const day = composite.slice(0, sep);
      const endpoint = composite.slice(sep + 1);
      const key = `${FMP_BYTES_PREFIX}:${day}`;
      days.add(key);
      p.hincrby(key, `${endpoint}:calls`, cell.calls);
      p.hincrby(key, `${endpoint}:decoded`, cell.decoded);
      p.hincrby(key, `${endpoint}:wire`, cell.wire);
      // How many of the wire figures came from a real Content-Length. Without
      // this, a total that is largely inferred is indistinguishable from a
      // measured one -- the same shape as trusting a number whose provenance is
      // not recorded.
      if (cell.wireExact > 0) p.hincrby(key, `${endpoint}:wireExact`, cell.wireExact);
    }
    for (const key of days) p.expire(key, FMP_BYTES_TTL_SECONDS);
    await p.exec();
  } catch {
    // observer -- never throws into the caller. The samples are dropped rather
    // than retried: a retry queue for a diagnostic is more machinery than the
    // undercount it prevents is worth, and readFmpUsage already reports
    // daysMissing so a thin window is visible rather than assumed complete.
  }
}

/**
 * Record one FMP response. Buffered; see flushFmpUsage.
 *
 * FAILS OPEN AND SILENT. This is an observer; it must never be able to break a
 * call it is only watching. The cost of a dropped sample is an undercount in a
 * diagnostic, and that is strictly better than a warm job throwing because a
 * metrics write failed.
 *
 * Not async any more, and that is the point: the caller no longer awaits a
 * Redis round-trip per FMP response.
 */
export function recordFmpUsage(args: {
  url: string;
  decodedBytes: number;
  wireBytes?: number | null;
}): void {
  if (!redis) return;
  try {
    const endpoint = fmpEndpointLabel(args.url);
    const decoded = Number.isFinite(args.decodedBytes) && args.decodedBytes > 0 ? Math.round(args.decodedBytes) : 0;
    const hasWire = typeof args.wireBytes === "number" && Number.isFinite(args.wireBytes) && args.wireBytes > 0;
    const wire = hasWire ? Math.round(args.wireBytes as number) : decoded;

    const composite = `${dayKey(new Date())}|${endpoint}`;
    const cell = buffer.get(composite) ?? { calls: 0, wire: 0, decoded: 0, wireExact: 0 };
    cell.calls += 1;
    cell.wire += wire;
    cell.decoded += decoded;
    if (hasWire) cell.wireExact += 1;
    buffer.set(composite, cell);
    bufferedCalls += 1;

    if (buffer.size >= MAX_BUFFERED_KEYS || bufferedCalls >= MAX_BUFFERED_CALLS) {
      // Deliberately not awaited: the caller is mid-fetch-loop and the whole
      // point is to stop making it wait on Redis. Errors are swallowed inside
      // flushFmpUsage.
      void flushFmpUsage();
      return;
    }
    scheduleFlush();
  } catch {
    // observer -- never throws into the caller
  }
}

/**
 * Ask Next to flush once the current response is sent.
 *
 * `after()` only exists inside a request or render scope and throws outside one
 * -- warm jobs invoked by cron are inside a route handler, so it applies there,
 * but a module imported outside that scope is not. The throw is caught and the
 * size cap plus the jobs' explicit flushFmpUsage() cover that case, so this is
 * an optimisation rather than the mechanism.
 *
 * Registered at most once per flush cycle. Calling after() per response would
 * queue ~477 callbacks for one run, which is the cost this change removes.
 */
function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  void (async () => {
    try {
      const { after } = await import("next/server");
      after(async () => {
        flushScheduled = false;
        await flushFmpUsage();
      });
    } catch {
      // Not in a request scope, or after() unavailable. Reset so the next
      // record can try again; the size cap and the jobs' explicit flush are
      // what actually guarantee the write.
      flushScheduled = false;
    }
  })();
}

/**
 * Drop-in replacement for `fetch` on an FMP URL: same arguments, same Response,
 * plus a usage sample.
 *
 * DELIBERATELY NOT COMBINED WITH reserveFmpCallSlot(). That guard lives in
 * historyCache.ts, which would make this module and that one mutually
 * importing; more importantly, the guard is a *gate* that can wait or throw,
 * and this is an *observer* that must never do either. Keeping them separate
 * means adding the meter to a call site cannot change whether that call
 * happens. Call sites keep whatever guarding they already had.
 *
 * The body is measured off a `clone()`, so the caller's Response is untouched
 * and every existing `res.ok` / `res.json()` line keeps working. That costs one
 * extra decode of a payload that is at most a few hundred KB -- CPU, never
 * bandwidth, since the clone is served from the already-received buffer and
 * issues no second request. If that ever shows in lambda duration, the fix is
 * to measure Content-Length only and stop reading the clone; the counters are
 * shaped so that degrades to a partial `decoded` rather than a wrong `wire`.
 */
// Next's Data Cache refuses a single entry over 2 MB. It does not throw, and it
// does not report at the call site.
const NEXT_DATA_CACHE_MAX_BYTES = 2 * 1024 * 1024;

const oversizedCacheWarned = new Set<string>();

/**
 * `next: { revalidate: N }` on a response over 2 MB IS SILENTLY INERT.
 *
 * Next's Data Cache refuses the entry, the revalidate never takes effect, and
 * the only surviving layer is whatever module-level memo the caller happens to
 * have -- which dies with the Lambda. Nothing logs at the call site; the tell is
 * a runtime line somewhere else entirely.
 *
 * THE FAILURE LOOKS EXACTLY LIKE SUCCESS, which is why this exists. Two live
 * instances found by sweep on 2026-08-24:
 *
 *   - /stable/stock-list at 3.0 MB, refetched on every cold start, 166.9 MB
 *     across a window holding ~3 days of data.
 *   - /api/pickers at roughly 8 MB (measured 3.38 MB at a 260 universe on
 *     2026-08-06, growing linearly, now 700), whose call site carries a comment
 *     stating the exact dedupe that is not happening.
 *
 * Deduped per endpoint so a hot path does not fill the log with one fact.
 */
function warnIfTooBigToCache(url: string, init: RequestInit | undefined, bytes: number) {
  const wantsCache =
    typeof (init as { next?: { revalidate?: number | false } } | undefined)?.next?.revalidate ===
    "number";
  if (!wantsCache || bytes <= NEXT_DATA_CACHE_MAX_BYTES) return;

  const endpoint = fmpEndpointLabel(url);
  if (oversizedCacheWarned.has(endpoint)) return;
  oversizedCacheWarned.add(endpoint);

  console.warn(
    `[fmp] ${endpoint} returned ${(bytes / 1024 / 1024).toFixed(1)} MB with next.revalidate set. ` +
      `Next's Data Cache refuses entries over ${NEXT_DATA_CACHE_MAX_BYTES / 1024 / 1024} MB, so that ` +
      `revalidate is INERT and this call refetches on every cold start. Cache it somewhere that can ` +
      `hold it, or fetch less.`
  );
}

export async function fmpFetch(url: string, init?: RequestInit): Promise<Response> {
  // WHAT THIS COUNTS, PRECISELY: responses observed at this call site. That is
  // NOT the same as bytes on the wire, and the difference is not small.
  //
  // Every FMP call in this codebase passes `next: { revalidate: N }`, so Next
  // may serve the response from its Data Cache -- and within a render pass may
  // memoize it outright -- with no network request at all. This wrapper cannot
  // see that: `fetch` returns a Response either way, and the sample is recorded
  // either way. Where one symbol's news is fetched twice in a pass (fetchNews
  // and fetchEarningsNews both call fetchFmpStockNews with the same URL), the
  // meter counts two calls where at most one crossed the network.
  //
  // So the totals are an UPPER BOUND. That is the right side to err on for a
  // cap you must not breach, but it means a figure from this meter is not
  // evidence that a given number of bytes were actually paid for, and it should
  // not be quoted as one (claude/traps/measuring-the-wrong-layer.md).
  const res = await fetch(url, init);
  try {
    const header = Number(res.headers.get("content-length"));
    const wireBytes = Number.isFinite(header) && header > 0 ? header : null;
    const body = await res.clone().arrayBuffer();
    recordFmpUsage({ url, decodedBytes: body.byteLength, wireBytes });
    warnIfTooBigToCache(url, init, body.byteLength);
  } catch {
    // Never let measurement affect the call being measured.
  }
  return res;
}

export type FmpUsageEndpoint = {
  endpoint: string;
  calls: number;
  wireBytes: number;
  decodedBytes: number;
  wireExactCalls: number;
  /** Mean wire bytes per call -- the figure that makes the 200x spread visible. */
  bytesPerCall: number;
};

export type FmpUsageReport = {
  days: number;
  /** Day buckets that actually held data. See daysMissing. */
  daysWithData: number;
  /**
   * Day buckets that were empty. A LOW TOTAL WITH A HIGH daysMissing IS NOT
   * EVIDENCE OF LOW USAGE -- it is evidence the meter was not running yet.
   * Reported so a reader cannot mistake one for the other
   * (claude/traps/absence-needs-the-producer-to-have-run.md).
   */
  daysMissing: number;
  totalWireBytes: number;
  totalDecodedBytes: number;
  totalCalls: number;
  capBytes: number;
  pctOfCap: number | null;
  endpoints: FmpUsageEndpoint[];
};

/**
 * Rolling window totals, per endpoint, newest `days` UTC days inclusive.
 *
 * DO NOT "FIX" THE WINDOW. This is already the right shape and has been
 * reviewed as such (2026-08-22). It sums the last 30 UTC day-buckets ending
 * today, which is a genuine rolling 30-day total and matches how FMP bills the
 * bandwidth cap. Two plausible-looking "corrections" would both make it wrong:
 *
 *   * Anchoring to a calendar month. The cap is not monthly. A month-to-date
 *     figure reads LOW for the first three weeks of every month and would say
 *     the cap is comfortable on exactly the days it is not.
 *   * Making the window a single cumulative counter, or extending it past 30.
 *     FMP_BYTES_TTL_SECONDS is 31 days, so days 32+ do not exist to be summed;
 *     a longer window would silently report a partial total as a complete one.
 *     The `window` clamp to 31 is what stops that, and it is deliberate.
 *
 * The one real limitation is recorded elsewhere and is NOT in this function:
 * fmpFetch records a sample whenever a call site is reached, including when
 * Next serves the response from its Data Cache with no network request. So
 * these totals are call-site bytes, an UPPER BOUND on wire bytes, not a
 * measurement of them. See the note on fmpFetch.
 */
export async function readFmpUsage(days = 30): Promise<FmpUsageReport> {
  const window = Math.max(1, Math.min(31, Math.floor(days) || 30));
  const empty: FmpUsageReport = {
    days: window,
    daysWithData: 0,
    daysMissing: window,
    totalWireBytes: 0,
    totalDecodedBytes: 0,
    totalCalls: 0,
    capBytes: FMP_BANDWIDTH_CAP_BYTES,
    pctOfCap: null,
    endpoints: [],
  };
  if (!redis) return empty;

  const now = new Date();
  const keys: string[] = [];
  for (let i = 0; i < window; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    keys.push(`${FMP_BYTES_PREFIX}:${dayKey(d)}`);
  }

  let hashes: (Record<string, unknown> | null)[];
  try {
    const p = redis.pipeline();
    keys.forEach((k) => p.hgetall(k));
    hashes = (await p.exec()) as (Record<string, unknown> | null)[];
  } catch {
    return empty;
  }

  const acc = new Map<string, FmpUsageEndpoint>();
  let daysWithData = 0;

  for (const hash of hashes) {
    if (!hash || typeof hash !== "object" || !Object.keys(hash).length) continue;
    daysWithData++;
    for (const [field, raw] of Object.entries(hash)) {
      const idx = field.lastIndexOf(":");
      if (idx <= 0) continue;
      const endpoint = field.slice(0, idx);
      const metric = field.slice(idx + 1);
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;

      const row =
        acc.get(endpoint) ??
        { endpoint, calls: 0, wireBytes: 0, decodedBytes: 0, wireExactCalls: 0, bytesPerCall: 0 };
      if (metric === "calls") row.calls += value;
      else if (metric === "wire") row.wireBytes += value;
      else if (metric === "decoded") row.decodedBytes += value;
      else if (metric === "wireExact") row.wireExactCalls += value;
      acc.set(endpoint, row);
    }
  }

  const endpoints = [...acc.values()]
    .map((r) => ({ ...r, bytesPerCall: r.calls > 0 ? Math.round(r.wireBytes / r.calls) : 0 }))
    // Biggest consumer first: the whole point is to name what is eating the cap.
    .sort((a, b) => b.wireBytes - a.wireBytes);

  const totalWireBytes = endpoints.reduce((n, r) => n + r.wireBytes, 0);

  return {
    days: window,
    daysWithData,
    daysMissing: window - daysWithData,
    totalWireBytes,
    totalDecodedBytes: endpoints.reduce((n, r) => n + r.decodedBytes, 0),
    totalCalls: endpoints.reduce((n, r) => n + r.calls, 0),
    capBytes: FMP_BANDWIDTH_CAP_BYTES,
    pctOfCap: totalWireBytes > 0 ? Number(((totalWireBytes / FMP_BANDWIDTH_CAP_BYTES) * 100).toFixed(2)) : 0,
    endpoints,
  };
}
