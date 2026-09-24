// THE FOURTH DELISTING SIGNAL: SEC's own ticker file (Relay B, #553 COWORK #20).
//
// THE MISS. BK (renamed BNY), EQR (renamed VMRK), EA (delisted 2026-08-04, a
// Form 25-NSE) and WBS (delisted 2026-08-20) sat in the 700-symbol Pickers
// universe for weeks. The sweep in warm-screener-fundamentals has three signals
// and all three are FMP's:
//
//   ABSENCE       FMP's screener still listed them
//   FAIL STREAK   FMP's quote endpoint still answered for them
//   STALE BARS    63 trading days, and EA's last print is ~36 days old
//
// and the whole sweep skips when the screener read fails -- which is every day
// after FMP access ends on 14 October.
//
// THE SIGNAL. SEC's company_tickers_exchange file lists every ticker SEC maps to
// a registrant; a delisted or renamed ticker leaves it. It is already in Redis
// (sec-daily-index refreshes it weekly, secTickerMap validates it), so the
// check costs one GET a day and no network.
//
// MEASURED BEFORE IT ACTS (relay write-sec-delisting-census, 2026-09-24): of
// 760 universe symbols (Pickers 700, dynamic 697, preset 100, deduplicated),
// exactly four are absent from the live map -- BK, EA, EQR, WBS -- and nothing
// live is. The spelling helper is what keeps BRK.B / BRK-B from reading as
// absent.
//
// THREE GUARDS, because a wrong map would otherwise evict the universe:
//   1. Only the LIVE map (source "redis"). The committed file is a seed that
//      lags new listings, so a recent IPO is absent from it while alive.
//   2. Only a FRESH one (secTickerMap's own `stale`: over two refresh
//      intervals old).
//   3. A MASS ABSENCE IS THE MAP'S FAULT, NOT THE MARKET'S. validateTickerMap
//      accepts anything over 5,000 tickers with its sentinels, so a map
//      truncated to 6,000 would pass and name hundreds of live symbols. More
//      than SEC_UNLISTED_MAX (or 2% of the universe, whichever is larger) and
//      the pass refuses outright.
//
// RENAMES ARE FOLLOWED BY CIK (#553 COWORK #22). A ticker SEC no longer lists
// is looked up by its CIK; if SEC lists that CIK under exactly one other
// ticker, it is a rename: the successor takes the old ticker's universe score
// and the old one is evicted. A CIK SEC no longer lists at all is a delisting
// or merger, and is evicted as before. See planListingChanges.
//
// WHERE THE OLD CIK COMES FROM. A renamed ticker leaves SEC's file, and the
// committed copies follow it: BK was in neither registrants.json nor
// company-tickers.json by the time anyone looked. So the CIK is read, in
// order, from registrants.json, the committed ticker file, and then the sweep's
// own LAST-SEEN snapshot -- every listed universe ticker's CIK as SEC's live
// map gave it, written daily (one HSET). All three are SEC's data; none is an
// FMP value. A ticker with no known CIK is evicted and flagged, never guessed.
import { Redis } from "@upstash/redis";
import { lookupBySpelling, symbolSpellings } from "../symbolSpellings.mjs";
import type { ResolvedTickerMap, TickerEntry } from "./secTickerMap";
import { PAGE_READ_CACHE } from "./redisCacheMode";

export const SEC_UNLISTED_MAX = 10;
export const SEC_UNLISTED_MAX_SHARE = 0.02;

export type SecListingVerdict = {
  /** Why the pass did nothing, or null when it ran. */
  skipped: "map-not-live" | "map-stale" | "map-empty" | "universe-empty" | "map-suspect" | null;
  /** Universe symbols SEC no longer lists (empty when skipped). */
  unlisted: string[];
};

type MapView = Pick<ResolvedTickerMap, "map" | "source" | "stale">;

/** Pure. Which universe symbols the live SEC map no longer lists, or why it will not say. */
export function secUnlistedSymbols(universe: string[], live: MapView): SecListingVerdict {
  if (live.source !== "redis") return { skipped: "map-not-live", unlisted: [] };
  if (live.stale) return { skipped: "map-stale", unlisted: [] };
  if (!live.map.size) return { skipped: "map-empty", unlisted: [] };
  const symbols = [...new Set(universe.map((s) => String(s ?? "").trim().toUpperCase()).filter(Boolean))];
  if (!symbols.length) return { skipped: "universe-empty", unlisted: [] };
  const unlisted = symbols.filter((s) => !lookupBySpelling(live.map, s));
  const cap = Math.max(SEC_UNLISTED_MAX, Math.ceil(symbols.length * SEC_UNLISTED_MAX_SHARE));
  if (unlisted.length > cap) return { skipped: "map-suspect", unlisted: [] };
  return { skipped: null, unlisted };
}

// ─────────────────────────────────────────────────── renames by CIK (#22)

/** At most this many renames are carried out in one run; the rest wait. */
export const SEC_RENAMES_MAX = 10;

export type ListingChange =
  | { kind: "rename"; from: string; to: string; cik: string }
  | {
      kind: "evict";
      symbol: string;
      cik: string | null;
      why: "cik-gone" | "no-cik" | "ambiguous-successor" | "successor-in-universe";
      /** The successor(s) SEC lists for the CIK, when there were any. */
      listed?: string[];
    }
  | { kind: "deferred"; symbol: string; to: string; cik: string; why: "rename-cap" };

/** SEC's live map, turned around: CIK -> every ticker it lists for it. */
export function tickersByCik(map: Map<string, TickerEntry>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [ticker, entry] of map) {
    if (!entry?.cik) continue;
    const list = out.get(entry.cik);
    if (list) list.push(ticker);
    else out.set(entry.cik, [ticker]);
  }
  return out;
}

const PLAIN_TICKER = /^[A-Z]{1,5}$/;

/**
 * Pure. What to do with each ticker SEC no longer lists.
 *
 * THE MATCH IS BY CIK AND ONLY BY CIK. Names are never compared: "Bank of New
 * York Mellon" -> "BNY" and "Equity Residential" -> "Vivmark Residential" share
 * no useful words, while unrelated companies often do.
 *
 * THE SUCCESSOR MUST BE UNIQUE. A CIK can list several tickers (BNY and its
 * preferred BNY-PK; two share classes). Plain tickers are preferred over
 * suffixed ones; if that still leaves more or fewer than one, nothing is
 * guessed -- the old ticker is evicted and the case flagged.
 *
 * A SUCCESSOR ALREADY IN THE UNIVERSE is flagged, not merged: the old ticker
 * goes, and no score moves onto a name that already has its own.
 */
export function planListingChanges(
  unlisted: string[],
  ctx: {
    cikOf: (symbol: string) => string | null;
    byCik: Map<string, string[]>;
    universe: Iterable<string>;
    max?: number;
  }
): ListingChange[] {
  const max = ctx.max ?? SEC_RENAMES_MAX;
  const inUniverse = new Set<string>();
  for (const s of ctx.universe) for (const v of symbolSpellings(String(s).toUpperCase())) inUniverse.add(v);
  const out: ListingChange[] = [];
  let renames = 0;
  for (const symbol of unlisted) {
    const cik = ctx.cikOf(symbol);
    if (!cik) {
      out.push({ kind: "evict", symbol, cik: null, why: "no-cik" });
      continue;
    }
    const own = new Set(symbolSpellings(symbol));
    const listed = (ctx.byCik.get(cik) ?? []).filter((t) => !own.has(t));
    if (!listed.length) {
      out.push({ kind: "evict", symbol, cik, why: "cik-gone" });
      continue;
    }
    const plain = listed.filter((t) => PLAIN_TICKER.test(t));
    const candidates = plain.length ? plain : listed;
    if (candidates.length !== 1) {
      out.push({ kind: "evict", symbol, cik, why: "ambiguous-successor", listed });
      continue;
    }
    const to = candidates[0];
    if (symbolSpellings(to).some((v) => inUniverse.has(v))) {
      out.push({ kind: "evict", symbol, cik, why: "successor-in-universe", listed: [to] });
      continue;
    }
    if (renames >= max) {
      out.push({ kind: "deferred", symbol, to, cik, why: "rename-cap" });
      continue;
    }
    renames++;
    out.push({ kind: "rename", from: symbol, to, cik });
  }
  return out;
}

/** One line per change, for the run record, the log and the helper's issue. */
export function describeChange(c: ListingChange): string {
  if (c.kind === "rename") return `${c.from} -> ${c.to} (renamed; same CIK ${c.cik}; score carried)`;
  if (c.kind === "deferred") return `${c.symbol} -> ${c.to} (rename waits: over ${SEC_RENAMES_MAX} this run)`;
  const why = {
    "cik-gone": "delisted or merged: SEC lists no ticker for its CIK",
    "no-cik": "evicted; no CIK on file to follow -- check by hand",
    "ambiguous-successor": `evicted; its CIK lists ${c.listed?.join(", ")} -- no single successor, check by hand`,
    "successor-in-universe": `evicted; successor ${c.listed?.[0]} is already in the universe (score not merged)`,
  }[c.why];
  return `${c.symbol}: ${why}`;
}

// ───────────────────────────────────────────────────────────────── I/O

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

/** symbol -> CIK, as SEC's live map last listed it. Written daily by the sweep. */
export const LAST_SEEN_CIK_KEY = "msh:universe:sec-cik:v1";
/** The changes the sweep made, newest first, for the helper's issue. */
export const LISTING_CHANGES_KEY = "msh:universe:sec-changes:v1";
/** How long a change stays on the helper's issue. */
export const LISTING_CHANGES_DAYS = 14;

/** Record each listed universe ticker's CIK. ONE HSET; failure is logged, not thrown. */
export async function writeLastSeenCiks(pairs: Record<string, string>): Promise<boolean> {
  if (!redis || !Object.keys(pairs).length) return false;
  try {
    await redis.hset(LAST_SEEN_CIK_KEY, pairs);
    return true;
  } catch (err) {
    console.warn("[sec-listing] last-seen CIK write failed", err);
    return false;
  }
}

/** The last-seen CIKs for these symbols. ONE HMGET; absent on any failure. */
export async function readLastSeenCiks(symbols: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!redis || !symbols.length) return out;
  try {
    const raw = (await redis.hmget(LAST_SEEN_CIK_KEY, ...symbols)) as unknown;
    symbols.forEach((s, i) => {
      const v = Array.isArray(raw) ? raw[i] : raw && typeof raw === "object" ? (raw as Record<string, unknown>)[s] : null;
      if (v !== null && v !== undefined && /^\d{10}$/.test(String(v))) out.set(s, String(v));
    });
  } catch {
    // Absent: the planner evicts and flags "no-cik" rather than guessing.
  }
  return out;
}

export type StoredListingChange = { at: string; line: string };

/** Pure: prepend today's lines, keep LISTING_CHANGES_DAYS of history. */
export function mergeListingChanges(stored: unknown, lines: string[], nowMs: number): StoredListingChange[] {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const cutoff = new Date(nowMs - LISTING_CHANGES_DAYS * 86_400_000).toISOString().slice(0, 10);
  const prior = Array.isArray(stored)
    ? (stored as StoredListingChange[]).filter((c) => c && typeof c.at === "string" && typeof c.line === "string" && c.at >= cutoff)
    : [];
  return [...lines.map((line) => ({ at: today, line })), ...prior];
}

/** Append today's lines to the log the helper reads. 1 GET + 1 SET, only on a day with changes. */
export async function recordListingChanges(lines: string[], nowMs = Date.now()): Promise<void> {
  if (!redis || !lines.length) return;
  try {
    const stored = await redis.get(LISTING_CHANGES_KEY);
    await redis.set(LISTING_CHANGES_KEY, mergeListingChanges(stored, lines, nowMs));
  } catch (err) {
    console.warn("[sec-listing] change log write failed", err);
  }
}
