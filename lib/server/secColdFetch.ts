// THE COLD PATH: an earnings page for a symbol outside the universe fetches its
// own data, synchronously, on first render.
//
// WHY NOT A QUEUE. Enqueue-and-drain gives the FIRST VISITOR a pending state,
// and a page with no data is the thing being ruled out. A queue is the fallback
// here, never the primary: it catches the timeout case and nothing else.
//
// WHY THIS IS AFFORDABLE, AND IT IS NOT OBVIOUS. The earnings page inherits
// `revalidate = 900` from app/stock/[symbol]/layout.tsx, so the fetch below is
// paid ONCE PER SYMBOL PER REVALIDATION WINDOW -- not once per visitor. A
// thousand people opening /stock/XYZ/earnings in the same fifteen minutes cost
// one companyfacts request between them. Remove the ISR config and this becomes
// one external fetch per request, which is a different and much worse thing.
//
// FOUR GUARDS, IN THIS ORDER, AND THE FIRST IS THE ONE THAT BOUNDS THE ENDPOINT:
//
//   1. THE CIK GATE. No CIK in the committed ticker file -> 404. Nothing
//      fetched, nothing enqueued, nothing written. This is what makes an
//      endpoint anyone can hit safe: the set of symbols that can trigger work
//      is the ~10,400 real registrants SEC publishes, not any string.
//   2. THE STORE. A symbol already populated never fetches.
//   3. THE PER-IP CAP, on COLD FETCHES rather than on requests. A request cap
//      403'd a real user on /insights/videos and that is on record
//      (claude/traps/a-visible-failure-is-not-a-harmless-one.md). Everything
//      served from cache stays free; only the act of triggering an external
//      fetch is counted.
//   4. THE TIMEOUT. On expiry: enqueue, render the pending state, return.
//      NEVER hang the render. The 71-second news render is the precedent.
// ── A CAVEAT THAT MUST BE MEASURED, NOT ASSUMED ─────────────────────────────
//
// `headers()` marks a render DYNAMIC. It is called only on the cold path, after
// the store check, so a warm render never reaches it -- which should mean the
// route keeps its ISR behaviour for every symbol that already has data, and
// only the one-off cold render is uncached.
//
// SHOULD. That is a claim about how Next treats a conditionally-dynamic ISR
// route, and this project's own history says a route silently going dynamic is
// invisible (claude/picker-pages-isr-2026-08-20.md: 32 screener pages stayed
// dynamic after force-dynamic was removed, because one no-store hint remained,
// and nothing in the build said so).
//
// SO IT IS VERIFIED FROM THE BUILD'S ROUTE TABLE rather than reasoned about: if
// /stock/[symbol]/earnings shows as `f` rather than a revalidating entry, this
// approach is wrong and the per-IP cap has to move to middleware. That check is
// recorded in claude/earnings-page-on-sec-2026-09-15.md alongside the measured
// cold-render time.
import { headers } from "next/headers";
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { loadTickerMap } from "./secTickerMap";
import { lookupBySpelling } from "../symbolSpellings.mjs";
import { extractCompanyFacts, type CompanyFacts } from "./secExtract";
import { encodeFactSet, type StoredFactSet } from "./secFactCodec";
import { readFactSet, writeFactSet } from "./secFactStore";

// PAGE_READ_CACHE IS NOT OPTIONAL HERE, AND check-page-read-cache CAUGHT ITS
// ABSENCE. @upstash/redis sends `cache: "no-store"` by default, and one such
// hint opts the whole route out of static rendering -- which would have made
// /stock/[symbol]/earnings dynamic on EVERY request.
//
// That is not a tidy-up. The entire affordability argument for this file is
// "the fetch is paid once per revalidation window rather than once per
// visitor", and a route forced dynamic pays it per visitor. The guard that
// makes the design work was one missing argument away from being absent, with
// no error anywhere: the build would have stayed green and the route table
// would have shown a quiet `ƒ`.
//
// retry 1 for the same reason as dailyPageLimit: the SDK's five attempts with
// backoff cannot finish inside a render budget, so they would only spend
// Upstash quota answering a question already abandoned.
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv({ ...PAGE_READ_CACHE, retry: { retries: 1, backoff: () => 50 } })
    : null;

/**
 * 5 seconds, the same figure as news' ADAPTER_TIMEOUT_MS and for the same
 * reason: it is many times the measured cost, so a legitimately slow response
 * still lands, and anything past it is not slow but absent.
 *
 * MEASURED: fetch + parse + extract + encode ran p50 153ms, p90 327ms, max
 * 549ms over 40 symbols (relay run 34959833821). 5s is ~15x p90. The tail that
 * can genuinely exceed it is the 6.4MB end of the wire distribution on a bad
 * connection, and that case is exactly what the queue fallback is for.
 */
export const SEC_COLD_TIMEOUT_MS = 5_000;

/** Cold FETCHES per IP per hour. Cache hits are not counted; see guard 3. */
export const SEC_COLD_FETCHES_PER_IP_HOUR = 12;

/**
 * The pending queue, drained by /api/jobs/sec-facts.
 *
 * A ZSET SCORED BY TIME, AND CAPPED. An unbounded queue fed by an endpoint
 * anyone can hit is a way to make the cron do someone else's work forever --
 * the same priority-inversion argument that gave the drain its own allowance.
 * Past the cap, a timeout still renders the pending state; it just does not
 * lengthen the queue.
 */
export const SEC_COLD_QUEUE_KEY = "msh:sec:cold-queue:v1";
export const SEC_COLD_QUEUE_MAX = 500;

const IP_PREFIX = "msh:sec:cold-ip:v1";

/**
 * What the page got, and what it should therefore say.
 *
 * THREE OUTCOMES, NOT TWO, and the third is the one that would otherwise be
 * wrong forever. A symbol can have a CIK, fetch cleanly, and still yield
 * nothing usable: IFRS filers publish under `ifrs-full`, which these field
 * definitions do not read, and recent IPOs and some 20-F filers have no XBRL
 * history yet. Measured at 10 of 40 sampled symbols
 * (claude/earnings-page-on-sec-2026-09-15.md §11).
 *
 * That case must NEVER render as pending, because it will never stop being
 * pending -- the cron would re-fetch it daily and get the same nothing.
 */
export type ColdResult =
  /** No CIK in the committed ticker file. The page 404s. */
  | { status: "no-cik" }
  /** Usable data, from the store or from this render's own fetch. */
  | { status: "ready"; set: StoredFactSet; cold: boolean }
  /** Fetched successfully; the filer publishes no XBRL this page can read. */
  | { status: "no-xbrl"; reason: string }
  /** Timed out, refused by a guard, or failed. Queued where possible. */
  | { status: "pending"; reason: string };

/** A fact set with no periods at all is a successful fetch of nothing usable. */
export function hasUsableData(set: StoredFactSet): boolean {
  return set.quarters.length > 0 || set.instants.length > 0 || set.years.length > 0;
}

/**
 * THE CIK GATE, from the COMMITTED file rather than the live one.
 *
 * Deliberately not a network call: this runs on every cold render, and a gate
 * that itself depends on an external fetch is a gate that opens when that fetch
 * is slow. The committed file is validated on load (secTickerMap.loadTickerMap)
 * and carries ~10,400 registrants, which is the bound.
 *
 * Through the spelling helper, so BRK.B reaches BRK-B -- the same defect that
 * left it with no CIK in the manifest.
 */
export function cikForSymbol(symbol: string): string | null {
  const { present, map } = loadTickerMap();
  if (!present) return null;
  return lookupBySpelling(map, symbol)?.value?.cik ?? null;
}

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // unref() so a pending timer cannot hold a serverless invocation open past
    // the response -- the race is settled either way by then.
    const timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
    (timer as unknown as { unref?: () => void }).unref?.();
    work.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e: unknown) => { clearTimeout(timer); reject(e); }
    );
  });
}

/**
 * Per-IP cold-FETCH budget. Fails OPEN, like every other Redis guard here.
 *
 * COUNTS FETCHES, NOT REQUESTS. The distinction is the whole point: a visitor
 * reading twenty cached pages spends nothing, and only the act of triggering an
 * external fetch is budgeted. Returns true when the fetch may proceed.
 */
async function claimColdFetch(): Promise<boolean> {
  if (!redis) return true;
  try {
    const h = await headers();
    const ip =
      (h.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
      h.get("x-real-ip") ||
      "unknown";
    const key = `${IP_PREFIX}:${new Date().toISOString().slice(0, 13)}:${ip}`;
    const n = await redis.incr(key);
    // 2h, not 1h: a bucket created at :59 would otherwise expire a minute later
    // and hand the same IP a fresh allowance immediately.
    if (n === 1) await redis.expire(key, 7200);
    return n <= SEC_COLD_FETCHES_PER_IP_HOUR;
  } catch {
    return true;
  }
}

/** Add to the drain queue, unless it is already at its cap. */
async function enqueue(symbol: string): Promise<boolean> {
  if (!redis) return false;
  try {
    const size = await redis.zcard(SEC_COLD_QUEUE_KEY);
    if (size >= SEC_COLD_QUEUE_MAX) return false;
    await redis.zadd(SEC_COLD_QUEUE_KEY, { score: Date.now(), member: symbol.toUpperCase() });
    return true;
  } catch {
    return false;
  }
}

/** The queue's head, oldest first, for the cron. */
export async function readColdQueue(limit: number): Promise<string[]> {
  if (!redis) return [];
  try {
    return (await redis.zrange<string[]>(SEC_COLD_QUEUE_KEY, 0, limit - 1)) ?? [];
  } catch {
    return [];
  }
}

/** Remove what the cron has dealt with — whether it populated or not. */
export async function clearColdQueue(symbols: string[]): Promise<number> {
  if (!redis || symbols.length === 0) return 0;
  try {
    return await redis.zrem(SEC_COLD_QUEUE_KEY, ...symbols.map((s) => s.toUpperCase()));
  } catch {
    return 0;
  }
}

const SEC_UA = process.env.SEC_USER_AGENT || "";

async function fetchAndStore(symbol: string, cik: string): Promise<StoredFactSet> {
  const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
    headers: { "User-Agent": SEC_UA, "Accept-Encoding": "gzip, deflate" },
    // NO Next CACHE ON THE FETCH ITSELF. The page's own ISR window is the cache;
    // layering a second one would hold a multi-megabyte body in the data cache
    // per symbol for a different lifetime than the HTML it produced.
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  // A 200 carrying HTML is not data. Same strictness that caught Stooq.
  if (!ct.includes("json")) throw new Error(`expected JSON, got ${ct}`);
  const set = encodeFactSet(extractCompanyFacts(symbol, (await res.json()) as CompanyFacts));
  // STORED EVEN WHEN EMPTY. An IFRS filer's empty set is a real answer and
  // caching it is what stops every visitor re-fetching 3MB to learn the same
  // nothing. hasUsableData() tells the two apart at read time.
  await writeFactSet(set);
  return set;
}

/**
 * Resolve one symbol's fact set for a render, fetching it if this is the first
 * time anyone has asked.
 *
 * Never throws: every failure path returns a status the page can render.
 */
export async function resolveFactSetForRender(symbol: string): Promise<ColdResult> {
  const clean = symbol.trim().toUpperCase();

  // 1. THE CIK GATE, FIRST AND CHEAPEST. No network, no Redis, no write.
  const cik = cikForSymbol(clean);
  if (!cik) return { status: "no-cik" };

  // 2. THE STORE.
  const stored = await readFactSet(clean);
  if (stored) {
    return hasUsableData(stored)
      ? { status: "ready", set: stored, cold: false }
      : { status: "no-xbrl", reason: "stored fact set is empty" };
  }

  if (!SEC_UA) {
    // SEC's fair-access policy requires a declared, contactable agent. Fetching
    // without one risks a block on the whole account, so this refuses rather
    // than fetching anonymously -- and says so, rather than 404ing a real
    // company over a configuration problem.
    return { status: "pending", reason: "SEC_USER_AGENT is not configured" };
  }

  // 3. THE PER-IP CAP.
  if (!(await claimColdFetch())) {
    await enqueue(clean);
    return { status: "pending", reason: "cold-fetch budget for this client is spent" };
  }

  // 4. THE TIMEOUT.
  try {
    const set = await withTimeout(
      fetchAndStore(clean, cik),
      SEC_COLD_TIMEOUT_MS,
      `[sec-cold] ${clean}`
    );
    return hasUsableData(set)
      ? { status: "ready", set, cold: true }
      : { status: "no-xbrl", reason: "the filer publishes no XBRL these fields read" };
  } catch (err) {
    const reason = String((err as Error)?.message ?? err);
    const queued = await enqueue(clean);
    console.warn(`[sec-cold] ${clean}: ${reason}${queued ? " — queued" : " — queue full"}`);
    return { status: "pending", reason };
  }
}
