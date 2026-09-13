// symbol -> CIK, from SEC's own ticker file, committed as a static asset.
//
// WHY A COMMITTED FILE RATHER THAN A FETCH. The endpoint works -- measured
// 2026-09-13 from iad1: 200, 798 KB, 10,426 tickers, all five probe symbols
// resolved (the earlier 403 was the undeclared-agent block, not a host block).
// It is committed anyway for two reasons the brief names: it removes a runtime
// dependency from the seed path, and it is what lets an unknown ticker 404
// BEFORE any network call, which is what bounds cold-fetch exposure at 10,426
// requests ever rather than at whatever a scraper asks for.
//
// THE FILE IS NOT IN THE TREE YET AND THIS MODULE SAYS SO RATHER THAN GUESSING.
// The agent sandbox is refused www.sec.gov with 403 CONNECT, so this session
// could not download it, and inventing 10,426 ticker->CIK pairs would be the
// worst possible failure here: every one would look plausible and route
// companyfacts requests at the wrong company. Run
// `node scripts/fetch-company-tickers.mjs` from anywhere with network access
// and commit the result.
//
// Absence is reported, never defaulted: `present:false` with `count:0` means
// the manifest seeds with null CIKs and the daily index matches nothing, and
// every caller surfaces that as its own outcome instead of as "no filings".

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";

export const TICKER_FILE = "data/sec/company-tickers.json";
export const TICKER_URL = "https://www.sec.gov/files/company_tickers_exchange.json";
// v2: the stored VALUE SHAPE changed with the move to the exchange file -- a v1
// blob would deserialise into a map of strings where the code now expects
// objects, and every `.cik` read would be undefined. Cheap to bump, silent to
// get wrong.
export const TICKER_REDIS_KEY = "msh:sec:tickers:v2";

/**
 * A COMMITTED FILE GOES STALE, AND STALENESS HERE IS NOT ABSENCE.
 *
 * The dangerous failure is REASSIGNMENT: a delisted ticker later given to a
 * different company. A stale map then routes companyfacts at the wrong company
 * under a symbol that still looks perfectly valid -- silent, per-symbol, and
 * indistinguishable from correct output. Absence is loud; reassignment is not.
 *
 * So the committed file is the SEED AND FALLBACK, and the live map is refreshed
 * on a schedule into Redis. The probe measured the endpoint at 200 / 798 KB /
 * 10,426 tickers from Vercel with a declared User-Agent, so the fetch works in
 * production even though the agent sandbox is refused it.
 */
const REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

export type TickerMap = {
  present: boolean;
  count: number;
  map: Map<string, TickerEntry>;
  source: string;
  error: string | null;
  /** Which layout the file was in. Reported, never inferred by the caller. */
  shape: TickerFileShape | null;
  /** How many entries carry an exchange. Zero on the legacy file. */
  withExchange: number;
};

/** What the map carries per symbol. `exchange` is null when the source file
 *  does not supply one -- see parseTickerFile's two shapes. */
export type TickerEntry = { cik: string; exchange: string | null };

/** Legacy shape: an object of objects, no exchange column. */
type LegacyRow = { cik_str?: number | string; ticker?: string; title?: string };

/** Current shape: column names plus row arrays. */
type ExchangeFile = { fields?: string[]; data?: unknown[][] };

export type TickerFileShape = "fields+data" | "legacy-object";

let cached: TickerMap | null = null;

/** Ten digits, zero-padded -- the spelling every SEC URL wants. */
export function padCik(value: number | string): string {
  return String(value).replace(/\D/g, "").padStart(10, "0");
}

export function parseTickerFile(text: string): { map: Map<string, TickerEntry>; shape: TickerFileShape } {
  const parsed = JSON.parse(text) as ExchangeFile | Record<string, LegacyRow>;
  const map = new Map<string, TickerEntry>();

  // ── Current shape: company_tickers_exchange.json ──────────────────────────
  //   { "fields": ["cik","name","ticker","exchange"],
  //     "data": [[1045810,"NVIDIA CORP","NVDA","Nasdaq"], ...] }
  //
  // THE COLUMNS ARE READ BY NAME FROM `fields`, NOT BY POSITION. A positional
  // read is one column insertion away from filing every exchange under `name`,
  // and it would look entirely plausible doing it.
  const asExchange = parsed as ExchangeFile;
  if (Array.isArray(asExchange.fields) && Array.isArray(asExchange.data)) {
    const idx = (name: string) => asExchange.fields!.findIndex((f) => String(f).toLowerCase() === name);
    const iCik = idx("cik");
    const iTicker = idx("ticker");
    const iExchange = idx("exchange");
    if (iCik === -1 || iTicker === -1) {
      throw new Error(`fields+data file is missing a required column (fields: ${asExchange.fields!.join(",")})`);
    }
    for (const row of asExchange.data!) {
      if (!Array.isArray(row)) continue;
      const ticker = String(row[iTicker] ?? "").trim().toUpperCase();
      if (!ticker || row[iCik] === undefined || row[iCik] === null) continue;
      // FIRST WINS, as on the legacy file: dual-class names appear as separate
      // rows sharing one CIK, so order cannot change the answer.
      if (map.has(ticker)) continue;
      const rawExchange = iExchange === -1 ? null : row[iExchange];
      const exchange = rawExchange === null || rawExchange === undefined || String(rawExchange).trim() === ""
        ? null
        : String(rawExchange).trim();
      map.set(ticker, { cik: padCik(row[iCik] as number | string), exchange });
    }
    return { map, shape: "fields+data" };
  }

  // ── Legacy shape: company_tickers.json, an object of objects, no exchange ──
  //
  // STILL READ, and deliberately. The committed fallback is whichever file was
  // last supplied, and a hard swap would have left the pipeline unable to read
  // the copy that is actually in the tree -- broken from the moment the URL
  // changed until a human replaced a 798 KB file by hand. It is reported as
  // legacy with `withExchange: 0` rather than quietly presented as equivalent.
  let sawRow = false;
  for (const row of Object.values(parsed as Record<string, LegacyRow>)) {
    if (!row || typeof row !== "object") continue;
    sawRow = true;
    if (!row.ticker || row.cik_str === undefined) continue;
    const ticker = String(row.ticker).trim().toUpperCase();
    if (!ticker || map.has(ticker)) continue;
    map.set(ticker, { cik: padCik(row.cik_str), exchange: null });
  }
  if (!sawRow) throw new Error("not a ticker file: neither fields+data nor an object of ticker rows");
  return { map, shape: "legacy-object" };
}

/**
 * VALIDATED BEFORE IT IS EVER ADOPTED, and this is the first line of defence
 * against mass invalidation rather than a nicety. A truncated or error-page
 * response parsed leniently would present as "9,000 symbols changed CIK", and
 * the invalidation logic would then discard 9,000 fact sets on the strength of
 * a bad HTTP response. Rejecting the payload is far cheaper than surviving it.
 *
 * Measured 2026-09-13: 10,426 tickers.
 */
export const MIN_EXPECTED_TICKERS = 5000;
const SENTINEL_TICKERS = ["AAPL", "MU", "PLAB"];

export function validateTickerMap(map: Map<string, TickerEntry>): { ok: boolean; reason: string | null } {
  if (map.size < MIN_EXPECTED_TICKERS) {
    return { ok: false, reason: `only ${map.size} tickers (expected >= ${MIN_EXPECTED_TICKERS}; measured 10,426 on 2026-09-13)` };
  }
  const missing = SENTINEL_TICKERS.filter((t) => !map.has(t));
  if (missing.length) return { ok: false, reason: `sentinel ticker(s) absent: ${missing.join(", ")} -- this is not the ticker file` };
  const badCik = [...map.entries()].find(([, e]) => !/^\d{10}$/.test(e.cik));
  if (badCik) return { ok: false, reason: `malformed CIK for ${badCik[0]}: ${JSON.stringify(badCik[1].cik)}` };
  return { ok: true, reason: null };
}

/** Stable hash of the mapping itself, so a real change is detectable without validators. */
export function hashTickerMap(map: Map<string, TickerEntry>): string {
  const rows = [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  // Exchange is IN the hash: a company moving NYSE -> Nasdaq changes nothing
  // about its CIK, and a hash that ignored it would report the file unchanged
  // on the one refresh where the exchange column did something.
  return crypto
    .createHash("sha256")
    .update(rows.map(([t, e]) => `${t}:${e.cik}:${e.exchange ?? ""}`).join("\n"))
    .digest("hex");
}

export function loadTickerMap(force = false): TickerMap {
  if (cached && !force) return cached;
  const file = path.join(process.cwd(), TICKER_FILE);
  try {
    const text = fs.readFileSync(file, "utf8");
    const { map, shape } = parseTickerFile(text);
    const withExchange = [...map.values()].filter((e) => e.exchange).length;
    // THE COMMITTED FILE IS VALIDATED TOO, not just the refresh.
    //
    // It arrived with a stray "#" at byte 0 -- an upload artifact -- which made
    // JSON.parse throw, so this branch reported present:false and the gap was
    // loud. But a file that PARSED while being truncated or wrong would have
    // been adopted silently, because validation only guarded the network path.
    // The fallback deserves the same scepticism as the fetch: it is the copy
    // that answers when the fetch fails, which is exactly when nobody is
    // looking.
    //
    // NOT tolerated by stripping junk before the first "{". A lenient parse
    // that reads a corrupted file as data is the trap this whole pipeline is
    // built to avoid -- the failure has to stay loud.
    const valid = validateTickerMap(map);
    if (!valid.ok) {
      cached = { present: false, count: map.size, map: new Map(), source: TICKER_FILE, error: `rejected: ${valid.reason}`, shape, withExchange: 0 };
      return cached;
    }
    cached = { present: true, count: map.size, map, source: TICKER_FILE, error: null, shape, withExchange };
  } catch (err) {
    cached = {
      present: false,
      count: 0,
      map: new Map(),
      source: TICKER_FILE,
      error: (err as Error)?.message ?? String(err),
      shape: null,
      withExchange: 0,
    };
  }
  return cached;
}

// ── The live map: Redis, refreshed weekly, committed file as the fallback ────

export type StoredTickerMap = {
  version: 1;
  fetchedAt: number;
  /** SEC's own Last-Modified, kept so we learn how often the file ACTUALLY changes. */
  lastModified: string | null;
  etag: string | null;
  contentHash: string;
  /** When the mapping last genuinely differed, as opposed to merely being re-fetched. */
  lastChangedAt: number;
  count: number;
  shape: TickerFileShape;
  withExchange: number;
  map: Record<string, TickerEntry>;
};

export type ResolvedTickerMap = {
  map: Map<string, TickerEntry>;
  shape: TickerFileShape | null;
  withExchange: number;
  count: number;
  /** Which copy actually answered. Never inferred by the caller. */
  source: "redis" | "committed-file" | "none";
  fetchedAt: number | null;
  lastModified: string | null;
  lastChangedAt: number | null;
  stale: boolean;
  refreshDue: boolean;
};

export async function readStoredTickerMap(): Promise<StoredTickerMap | null> {
  if (!redis) return null;
  try {
    const raw = await redis.get<StoredTickerMap>(TICKER_REDIS_KEY);
    return raw && typeof raw === "object" && raw.map ? raw : null;
  } catch (err) {
    // A read failure is NOT an empty map. Returning one would fall through to
    // the committed file, which is the right outcome -- but it must be reported
    // as a failure rather than as "Redis had nothing".
    console.error("[sec-tickers] read failed", err);
    return null;
  }
}

/**
 * The map the pipeline should use right now: Redis if it has one, the committed
 * file otherwise. `source` says which, always -- a caller that cannot tell them
 * apart cannot tell a fresh map from a year-old commit.
 */
export async function resolveTickerMap(now = Date.now()): Promise<ResolvedTickerMap> {
  const stored = await readStoredTickerMap();
  if (stored) {
    const age = now - stored.fetchedAt;
    return {
      map: new Map(Object.entries(stored.map)),
      count: stored.count,
      shape: stored.shape ?? null,
      withExchange: stored.withExchange ?? 0,
      source: "redis",
      fetchedAt: stored.fetchedAt,
      lastModified: stored.lastModified,
      lastChangedAt: stored.lastChangedAt,
      stale: age > REFRESH_INTERVAL_MS * 2,
      refreshDue: age >= REFRESH_INTERVAL_MS,
    };
  }
  const file = loadTickerMap();
  return {
    map: file.map,
    count: file.count,
    shape: file.shape,
    withExchange: file.withExchange,
    source: file.present ? "committed-file" : "none",
    fetchedAt: null,
    lastModified: null,
    lastChangedAt: null,
    stale: true,
    // With nothing in Redis a refresh is always due, including when the
    // committed file is missing -- that is the case a refresh would FIX.
    refreshDue: true,
  };
}

export type RefreshResult = {
  attempted: boolean;
  ok: boolean;
  status: number | null;
  ms: number;
  bytes: number;
  /** 304 means SEC says it has not changed -- which is itself the answer to "how often?". */
  notModified: boolean;
  conditionalSent: boolean;
  count: number | null;
  shape: TickerFileShape | null;
  withExchange: number | null;
  lastModified: string | null;
  previousLastModified: string | null;
  contentChanged: boolean;
  daysSincePreviousFetch: number | null;
  daysSincePreviousChange: number | null;
  rejected: string | null;
  error: string | null;
};

/**
 * Fetch the live map and store it, if it validates.
 *
 * CONDITIONAL WHEN WE CAN. companyfacts offers no validators (§3.7), but this is
 * a different path on a different host and it may. If SEC answers 304 there is
 * nothing to compare and nothing can have been reassigned, which is both a
 * saving and a measurement -- `notModified` accumulating week after week is the
 * evidence that weekly is more often than necessary.
 */
export async function refreshTickerMap(
  ua: string,
  opts: { force?: boolean; timeoutMs?: number; now?: number } = {}
): Promise<RefreshResult> {
  const now = opts.now ?? Date.now();
  const timeoutMs = opts.timeoutMs ?? 30000;
  const previous = await readStoredTickerMap();
  const base: RefreshResult = {
    attempted: true,
    ok: false,
    status: null,
    ms: 0,
    bytes: 0,
    notModified: false,
    conditionalSent: false,
    count: null,
    shape: null,
    withExchange: null,
    lastModified: null,
    previousLastModified: previous?.lastModified ?? null,
    contentChanged: false,
    daysSincePreviousFetch: previous ? Math.round((now - previous.fetchedAt) / 86400000) : null,
    daysSincePreviousChange: previous ? Math.round((now - previous.lastChangedAt) / 86400000) : null,
    rejected: null,
    error: null,
  };

  const headers: Record<string, string> = {
    "user-agent": ua,
    "accept-encoding": "gzip, deflate",
    accept: "application/json,*/*",
  };
  if (previous?.lastModified && !opts.force) {
    headers["if-modified-since"] = previous.lastModified;
    base.conditionalSent = true;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(TICKER_URL, { signal: controller.signal, cache: "no-store", headers });
    const body = res.status === 304 ? "" : await res.text();
    base.status = res.status;
    base.ms = Date.now() - started;
    base.bytes = body.length;
    base.lastModified = res.headers.get("last-modified") ?? previous?.lastModified ?? null;

    if (res.status === 304) {
      base.ok = true;
      base.notModified = true;
      base.count = previous?.count ?? null;
      base.shape = previous?.shape ?? null;
      base.withExchange = previous?.withExchange ?? null;
      // The stored copy is still correct; only its fetchedAt is bumped, so the
      // weekly cadence does not re-ask tomorrow.
      if (previous && redis) {
        try {
          await redis.set(TICKER_REDIS_KEY, { ...previous, fetchedAt: now });
        } catch (err) {
          base.error = `304 but the fetchedAt bump failed: ${(err as Error)?.message}`;
        }
      }
      return base;
    }

    if (res.status !== 200) {
      base.error = `HTTP ${res.status}`;
      return base;
    }

    let map: Map<string, TickerEntry>;
    let shape: TickerFileShape;
    try {
      ({ map, shape } = parseTickerFile(body));
    } catch (err) {
      base.rejected = `200 but the body is not the ticker JSON: ${(err as Error)?.message}`;
      return base;
    }

    const valid = validateTickerMap(map);
    if (!valid.ok) {
      // NOT ADOPTED. A short payload here would read downstream as thousands of
      // symbols changing CIK at once, and the invalidation would discard their
      // fact sets. The old map stays in place and the next run tries again.
      base.rejected = valid.reason;
      return base;
    }

    const contentHash = hashTickerMap(map);
    base.count = map.size;
    base.shape = shape;
    base.withExchange = [...map.values()].filter((e) => e.exchange).length;
    base.contentChanged = !previous || previous.contentHash !== contentHash;
    base.ok = true;

    if (redis) {
      const stored: StoredTickerMap = {
        version: 1,
        fetchedAt: now,
        lastModified: base.lastModified,
        etag: res.headers.get("etag"),
        contentHash,
        lastChangedAt: base.contentChanged ? now : (previous?.lastChangedAt ?? now),
        count: map.size,
        shape,
        withExchange: [...map.values()].filter((e) => e.exchange).length,
        map: Object.fromEntries(map),
      };
      try {
        await redis.set(TICKER_REDIS_KEY, stored);
      } catch (err) {
        base.ok = false;
        base.error = `fetched and validated, but the store failed: ${(err as Error)?.message}`;
      }
    }
    return base;
  } catch (err) {
    const e = err as Error;
    base.ms = Date.now() - started;
    base.error = e?.name === "AbortError" ? `timeout after ${timeoutMs / 1000}s` : `${e?.name}: ${e?.message}`;
    return base;
  } finally {
    clearTimeout(timer);
  }
}
