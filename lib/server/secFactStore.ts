// The stored fact set: one key per symbol, one GET per page render.
//
// ONE BLOB, NOT PER-FIELD KEYS. The precedent is already in the tree at
// historyCache.ts:150 -- "700 GETs is 700 billed commands, where 18 chunked
// MGETs are 18." Upstash bills per command, so a page that reads 46 fields as 46
// keys costs 46 commands for what one SET wrote. See sec-pipeline-spec §2.
//
// POSITIONAL VALUES, GATED BY A HASH. Storing {revenue: 1, costOfRevenue: 2, ...}
// per period spends the field names 13 times over (8 quarters + 5 years).
// Measured: named 19.7 KB against positional 10.2 KB, 48% smaller, and it halves
// the growth of the append-only annual series. The cost is that a reader whose
// field ORDER differs from the writer's decodes 46 values shifted by one --
// silently, and plausibly. So the writer stores secFieldsHash() and a reader
// whose own hash differs treats the record as UNREADABLE and refetches. An order
// change becomes a cache miss instead of a wrong number.
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { SEC_FACTS_PREFIX } from "./secManifest";
import { SEC_FIELD_KEYS, secFieldsHash } from "./secFields";
import type { CoverShares, ExtractResult, PeriodRecord } from "./secExtract";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

/** One period as stored. Arrays are positional over SEC_FIELD_KEYS. */
export type StoredPeriod = {
  e: string;                       // end
  s: string | null;                // start
  fp: string | null;
  fy: number | null;
  a: string | null;                // accession
  f: string | null;                // filed
  /** Values, positional. null = not filed. */
  v: (number | null)[];
  /**
   * Derivation codes, positional, ONE CHARACTER EACH, joined into one string.
   * "F" as-filed · "D" differenced · "C" computed · "A" ambiguous · "-" absent.
   *
   * A STRING, NOT AN ARRAY: 46 one-character array entries cost ~230 bytes of
   * JSON per period against 46. The page needs this on every cell it renders --
   * the owner's rule is that a derived figure is LABELLED as derived, so it
   * cannot be dropped to save the bytes, only stored cheaply.
   */
  d: string;
};

export type StoredFactSet = {
  /** Schema/field-order gate. A reader whose hash differs must refetch. */
  h: string;
  symbol: string;
  cik: string | null;
  entityName: string | null;
  /** When the extraction ran, ms. */
  at: number;
  quarters: StoredPeriod[];
  years: StoredPeriod[];
  instants: StoredPeriod[];
  cover: CoverShares | null;
  /** Content hash of the values only — the restatement tripwire (spec §3 L2). */
  contentHash: string;
  notes: string[];
};

const CODE: Record<string, string> = {
  "as-filed": "F", differenced: "D", computed: "C", ambiguous: "A",
};
export const DERIVATION_OF: Record<string, "as-filed" | "differenced" | "computed" | "ambiguous" | null> = {
  F: "as-filed", D: "differenced", C: "computed", A: "ambiguous", "-": null,
};

function encodePeriod(p: PeriodRecord): StoredPeriod {
  return {
    e: p.end, s: p.start, fp: p.fp, fy: p.fy, a: p.accession, f: p.filed,
    v: p.values.map((c) => c?.val ?? null),
    d: p.values.map((c) => (c ? CODE[c.derived] ?? "-" : "-")).join(""),
  };
}

/** FNV-1a over every stored value, in order. The Layer 2 tripwire. */
export function contentHashOf(set: Omit<StoredFactSet, "contentHash">): string {
  let h = 0x811c9dc5;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  for (const list of [set.quarters, set.years, set.instants]) {
    for (const p of list) {
      feed(p.e);
      feed(p.a ?? "");
      // THE VALUES, NOT THE PROVENANCE ALONE. A restatement that changes a
      // number without changing the accession is exactly the case Layer 1
      // cannot see, and hashing only the accession would miss it.
      for (const v of p.v) feed(v === null ? "~" : String(v));
      feed(p.d);
    }
  }
  feed(String(set.cover?.val ?? "~"));
  return h.toString(16).padStart(8, "0");
}

export function encodeFactSet(result: ExtractResult): StoredFactSet {
  const base = {
    h: secFieldsHash(),
    symbol: result.symbol,
    cik: result.cik === null ? null : String(result.cik).padStart(10, "0"),
    entityName: result.entityName,
    at: Date.now(),
    quarters: result.quarters.map(encodePeriod),
    years: result.years.map(encodePeriod),
    instants: result.instants.map(encodePeriod),
    cover: result.coverShares,
    notes: result.notes,
  };
  return { ...base, contentHash: contentHashOf(base) };
}

export const factKey = (symbol: string) => `${SEC_FACTS_PREFIX}:${symbol.toUpperCase()}`;

/**
 * Read one symbol's fact set, or null.
 *
 * `null` covers three different situations and the caller must not care which:
 * never populated, evicted, or written by a build whose field order differs.
 * All three mean "this page has no SEC data to render", and the page's job is to
 * say so rather than to render zeroes.
 */
export async function readFactSet(symbol: string): Promise<StoredFactSet | null> {
  if (!redis) return null;
  try {
    const raw = await redis.get<StoredFactSet>(factKey(symbol));
    if (!raw || typeof raw !== "object") return null;
    // THE GATE. Not a warning, not a best-effort decode: a mismatch means the
    // positional arrays mean something else, and reading them anyway is the
    // silent-wrong-number failure this whole design is built against.
    if (raw.h !== secFieldsHash()) {
      console.warn(
        `[sec-facts] ${symbol}: stored fieldsHash ${raw.h} != ${secFieldsHash()} — treating as a miss`
      );
      return null;
    }
    if (!Array.isArray(raw.quarters)) return null;
    return raw;
  } catch (err) {
    console.error("[sec-facts] read failed", symbol, err);
    return null;
  }
}

/**
 * Write one symbol's fact set.
 *
 * NO TTL. The SEC brief's rule is "never expire, never evict" for live symbols:
 * a filing is a permanent fact and re-fetching one costs ~150 KB of wire with no
 * conditional check available (sec-reread-no-cheap-check, 23 of 23). Deletion is
 * symbolEviction's job -- SEC_FACTS_PREFIX is registered in PER_SYMBOL_KEYS, so
 * a delisted symbol's fact set goes with the rest of its state.
 */
export async function writeFactSet(set: StoredFactSet): Promise<boolean> {
  if (!redis) return false;
  try {
    await redis.set(factKey(set.symbol), set);
    return true;
  } catch (err) {
    console.error("[sec-facts] write failed", set.symbol, err);
    return false;
  }
}

// ── reading a stored set, by field name rather than by position ─────────────

const INDEX_OF = new Map(SEC_FIELD_KEYS.map((k, i) => [k, i]));

/** One cell: the value and how it came to be. */
export type Cell = {
  val: number | null;
  derived: "as-filed" | "differenced" | "computed" | "ambiguous" | null;
};

/**
 * THE ONLY WAY THE PAGE READS A STORED VALUE.
 *
 * Positional decoding by hand at each call site is how a shifted array becomes
 * 46 wrong numbers, so there is one function and it looks the index up by name.
 */
export function cell(period: StoredPeriod | null | undefined, key: string): Cell {
  const i = INDEX_OF.get(key);
  if (!period || i === undefined) return { val: null, derived: null };
  return { val: period.v[i] ?? null, derived: DERIVATION_OF[period.d[i] ?? "-"] ?? null };
}

/** Convenience for the common case where only the number is wanted. */
export const valueOf = (period: StoredPeriod | null | undefined, key: string) =>
  cell(period, key).val;

/**
 * A trailing-twelve-month sum over the newest four quarters.
 *
 * ALL FOUR OR NULL. Three quarters summed and presented as a year understates
 * by a quarter and looks entirely plausible doing it -- and after D1b, Q4 EPS
 * and Q4 share counts are legitimately null, so the three-quarter case is now
 * the COMMON one rather than an edge. Returning a number there would put a
 * visibly wrong EPS on the page four times a year.
 */
export function ttm(quarters: StoredPeriod[], key: string): number | null {
  const four = quarters.slice(0, 4);
  if (four.length < 4) return null;
  const vals = four.map((q) => valueOf(q, key));
  if (vals.some((v) => v === null)) return null;
  return (vals as number[]).reduce((a, b) => a + b, 0);
}

/**
 * The filer's own label for a period: "Q3 FY2026", not "Q3 2026".
 *
 * FISCAL, NOT CALENDAR, and the FY prefix is not decoration. The five probe
 * symbols' year-ends are 31 Mar, 26 Sep, 3 Sep, 31 Oct and 31 Dec, so two
 * companies' "2026" can be nine months apart. Falls back to the end date rather
 * than inventing a quarter number.
 */
export function periodLabel(p: StoredPeriod | null | undefined): string {
  if (!p) return "—";
  if (p.fp && p.fy) return `${p.fp === "FY" ? "FY" : p.fp} FY${p.fy}`;
  return p.e;
}
