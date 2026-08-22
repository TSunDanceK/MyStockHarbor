// Byte accounting for FMP, alongside the per-minute CALL counter in
// historyCache.ts.
//
// WHY CALLS CANNOT STAND IN FOR BYTES. The plan carries two independent limits:
// 300 calls/minute, and a 30-day rolling 20 GB bandwidth cap. Only the first is
// measured anywhere. They are not proportional and not close to it -- from the
// live FMP dashboard, /stable/quote runs ~0.3 KB per call and
// /stable/news/stock ~66 KB, a ~200x spread. A job comfortably inside the call
// guard can therefore be the one eating the cap, and nothing in this codebase
// could see it. At 14.72 GB of 20 GB (73.6%) on 2026-08-22, the unmeasured
// limit is the one that is close.
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

export const FMP_BANDWIDTH_CAP_BYTES = 20 * 1024 * 1024 * 1024; // 20 GB, plan limit

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

/**
 * Record one FMP response.
 *
 * FAILS OPEN AND SILENT. This is an observer; it must never be able to break a
 * call it is only watching. The cost of a dropped sample is an undercount in a
 * diagnostic, and that is strictly better than a warm job throwing because a
 * metrics write failed.
 */
export async function recordFmpUsage(args: {
  url: string;
  decodedBytes: number;
  wireBytes?: number | null;
}): Promise<void> {
  if (!redis) return;
  const endpoint = fmpEndpointLabel(args.url);
  const decoded = Number.isFinite(args.decodedBytes) && args.decodedBytes > 0 ? Math.round(args.decodedBytes) : 0;
  const hasWire = typeof args.wireBytes === "number" && Number.isFinite(args.wireBytes) && args.wireBytes > 0;
  const wire = hasWire ? Math.round(args.wireBytes as number) : decoded;

  const key = `${FMP_BYTES_PREFIX}:${dayKey(new Date())}`;
  try {
    const p = redis.pipeline();
    p.hincrby(key, `${endpoint}:calls`, 1);
    p.hincrby(key, `${endpoint}:decoded`, decoded);
    p.hincrby(key, `${endpoint}:wire`, wire);
    // How many of the wire figures came from a real Content-Length. Without
    // this, a total that is largely inferred is indistinguishable from a
    // measured one -- the same shape as trusting a number whose provenance is
    // not recorded.
    if (hasWire) p.hincrby(key, `${endpoint}:wireExact`, 1);
    p.expire(key, FMP_BYTES_TTL_SECONDS);
    await p.exec();
  } catch {
    // observer -- never throws into the caller
  }
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
export async function fmpFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  try {
    const header = Number(res.headers.get("content-length"));
    const wireBytes = Number.isFinite(header) && header > 0 ? header : null;
    const body = await res.clone().arrayBuffer();
    await recordFmpUsage({ url, decodedBytes: body.byteLength, wireBytes });
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

/** Rolling window totals, per endpoint, newest `days` UTC days inclusive. */
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
