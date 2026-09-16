// THE COLD PATH: an earnings page for a symbol outside the universe fetches its
// own data, synchronously, on first render.
//
// WHY NOT A QUEUE. Enqueue-and-drain gives the FIRST VISITOR a pending state,
// and a page with no data is the thing being ruled out. A queue is the fallback
// here, never the primary: it catches the timeout case and nothing else.
//
// WHY THIS IS AFFORDABLE, AND IT IS NOT OBVIOUS. The earnings page inherits
// `revalidate = 3600` from app/stock/[symbol]/layout.tsx, so the fetch below is
// paid ONCE PER SYMBOL PER REVALIDATION WINDOW -- not once per visitor. A
// thousand people opening /stock/XYZ/earnings in the same hour cost
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
//   3. THE RATE BUDGET, on COLD FETCHES rather than on requests, and it never
//      403s anyone. A request cap 403'd a real user on /insights/videos and
//      that is on record (claude/traps/a-visible-failure-is-not-a-harmless-one
//      .md). Everything served from cache stays free; only the act of
//      triggering an external fetch is counted, and being over budget degrades
//      to queued-and-pending rather than to an error. It is site-wide rather
//      than per-IP, which was not the intent -- see the caveat below.
//   4. THE TIMEOUT. On expiry: enqueue, render the pending state, return.
//      NEVER hang the render. The 71-second news render is the precedent.
// ── THE CAVEAT WAS MEASURED, AND IT WAS REAL (2026-09-15) ───────────────────
//
// The first version of this file called `headers()` for a per-IP budget and
// passed `cache: "no-store"` to the companyfacts fetch, on the reasoning that
// both were confined to the cold path so a warm render never reached them.
// That reasoning was wrong, and the measurement said so in one request:
//
//   /stock/ALSN/earnings   HTTP 500  348ms     (off-universe, cold)
//   /stock/RYAAY/earnings  HTTP 500  254ms     (off-universe, cold)
//   /stock/AAPL/earnings   HTTP 200  418ms     (warm, unaffected)
//   /stock/ZZQQXX/earnings HTTP 404  474ms     (CIK gate, unaffected)
//
// with Vercel runtime logs naming it exactly:
//
//   Error: Page changed from static to dynamic at runtime
//     /stock/ALSN/earnings, reason: no-store fetch
//     https://data.sec.gov/api/xbrl/companyfacts/CIK0001411207.json
//   ⨯ Error: Failed to load static file for page: /500 ENOENT
//
// A dynamic API inside an ISR render does not make THAT RENDER dynamic -- it
// makes the route's own static/dynamic contract inconsistent, which Next 16
// treats as fatal, and this deployment has no /500 artefact to fall back to.
// So the cold render did not degrade; it 500'd, and it 500'd for every visitor
// to every off-universe symbol. There is no conditional dynamism to have here.
//
// WHAT THAT FORCED, BOTH OF IT:
//
//   a. The fetch carries `next: { revalidate }` instead of `cache: "no-store"`.
//      Dropping the no-store hint is the same mechanism redisCacheMode.ts
//      already documents and proved on the 32 screener pages. See fetchAndStore
//      for why the data cache is immaterial either way.
//   b. THE BUDGET IS NO LONGER PER-IP, and that is a real loss, stated plainly
//      rather than quietly swapped. `headers()` is the only way to learn a
//      client's address inside a render and it is unconditionally a dynamic
//      API, so per-IP capping and ISR are mutually exclusive on this route.
//      Guard 3 is now a SITE-WIDE rate bucket; see claimColdFetch for what it
//      does and does not buy, and for the middleware alternative that would
//      restore per-IP at the cost of a Redis command on every earnings request.
//
// The old catch-and-continue is why this was invisible in the code: the
// DynamicServerError from `headers()` landed in claimColdFetch's fail-open
// `catch`, the one from the fetch landed in the outer catch and logged
// "-- queued", and both read as a handled timeout while Next failed the route
// underneath. A swallowed DynamicServerError is not a handled error.
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { loadTickerMap } from "./secTickerMap";
import { lookupBySpelling } from "../symbolSpellings.mjs";
import { extractCompanyFacts, unreadableReason, type CompanyFacts } from "./secExtract";
import { encodeFactSet, type StoredFactSet } from "./secFactCodec";
import { secChainsHash } from "./secFields";
import { readFactSet, writeFactSet } from "./secFactStore";
import { recordColdCik } from "./secColdCik";

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
 * MEASURED TWICE, and the second number is the honest one. On a runner, fetch +
 * parse + extract + encode ran p50 153ms, p90 327ms, max 549ms over 40 symbols
 * (relay 34959833821). In a real cold render on a lambda the whole page took
 * 817ms-2.0s (relay 34965223921), the 2.0s being a cold start -- so the headroom
 * here is ~2.5x the worst observed, NOT the ~15x the p90 alone suggested.
 *
 * Still the right side of the line, because expiry is a queued pending page
 * rather than an error, and the tail that can genuinely exceed 5s is the 6.4MB
 * end of the wire distribution on a bad connection -- exactly what the queue
 * fallback is for. But 15x was the wrong number to have quoted.
 */
export const SEC_COLD_TIMEOUT_MS = 5_000;

/**
 * Cold FETCHES site-wide per minute. Cache hits are not counted; see guard 3.
 *
 * 20/min against a measured mean of 165ms and a p90 of 327ms is ~6 seconds of
 * work per minute, and it is an order of magnitude under SEC's own published
 * fair-access ceiling of 10 requests/second. It is a RATE bound, not a volume
 * bound: guards 1 and 2 already cap the total at ~10,400 fetches ever, because
 * a fetched symbol is written to Redis and never fetched again. What this stops
 * is one actor walking that list in a burst.
 */
export const SEC_COLD_FETCHES_PER_MINUTE = 20;

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

const RATE_PREFIX = "msh:sec:cold-rate:v1";

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
  /**
   * Fetched successfully, nothing this page can read — and WHOSE limit that is.
   *
   * `why` is the distinction the first version of this card got wrong: it told
   * every such reader that the COMPANY does not file the data, which is false
   * for a foreign private issuer whose statements are in the payload under a
   * namespace these fields do not read. See SecNoXbrlCard.
   *
   * "unknown" is for a set stored before the taxonomy census existed. It takes
   * the site-limit wording, because asserting a filer publishes nothing on the
   * strength of an absent field is the same error wearing a different hat.
   */
  | {
      status: "no-xbrl";
      reason: string;
      why: "unread-taxonomy" | "currency" | "unread-detail" | "none" | "unknown";
      /** Named on "unread-taxonomy"; the currencies on "currency". */
      taxonomies: string[];
    }
  /** Timed out, refused by a guard, or failed. Queued where possible. */
  | { status: "pending"; reason: string };

/**
 * The minimum populated fields in a SINGLE period for a page to be worth
 * rendering. See hasUsableData for why "not empty" was the wrong bar.
 */
export const MIN_PERIOD_FIELDS = 6;

/**
 * Is there enough here to render, rather than merely something.
 *
 * ── "NOT EMPTY" WAS THE WRONG BAR, AND THE IFRS WORK IS WHAT SHOWED IT ─────
 * This used to return true for any set with one period. After the ifrs-full
 * chains landed, all ten formerly-empty filers passed that test -- and five of
 * them did so on ONE OR TWO populated fields out of 46, which renders a table
 * of dashes with a number in it. Measured (relay 34971118882), best populated
 * period:
 *
 *   AZN 24   KGC 24   OTLY 23   MT 22   BEPH 16      <- a real page
 *   MFC  2   NWG  2   RYAAY 2   VIV  2   AEG  1      <- a page of dashes
 *
 * The gap between 16 and 2 is what makes a threshold defensible rather than
 * arbitrary: anything from 3 to 15 separates the two populations identically,
 * and 6 sits inside it with room on both sides.
 *
 * AND THE THIN FIVE ARE NOT A TAGGING PROBLEM. Every one reports in a home
 * currency -- AEG EUR, NWG GBP, MFC CAD, RYAAY EUR, VIV BRL -- and the unit
 * guard in rowsForField refuses a non-USD figure deliberately, because a euro
 * number under a dollar sign is the plausible-wrong-number failure. So they get
 * a card that says the page reads USD only, which is true and specific, rather
 * than a sparse table that looks like a bug.
 */
export function hasUsableData(set: StoredFactSet): boolean {
  for (const list of [set.quarters, set.years, set.instants]) {
    for (const p of list) {
      let filled = 0;
      for (const v of p.v) if (v !== null) filled++;
      if (filled >= MIN_PERIOD_FIELDS) return true;
    }
  }
  return false;
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

/**
 * A DynamicServerError is NOT a handled error, and swallowing one is exactly how
 * the 500 above stayed invisible: it read as a timeout in the logs
 * ("-- queued") while Next failed the route underneath.
 *
 * So it is rethrown rather than turned into a pending page. That still fails the
 * request, but it fails it LOUDLY and with the offending API named, which is the
 * difference between one measurement finding it and nobody finding it. Matched
 * on the message rather than by importing Next's internal error class, which is
 * not part of its public surface.
 */
function rethrowIfDynamic(err: unknown): void {
  const msg = String((err as Error)?.message ?? "");
  if (/Dynamic server usage|couldn't be rendered statically/.test(msg)) throw err;
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
 * The minute bucket's key, so the writer and any reader cannot disagree.
 *
 * EXPORTED FOR THAT REASON ALONE. secHealth reads this bucket to show the cap
 * is live, and a hand-typed prefix there would read as a permanent zero — the
 * same shape as the census that reported 759 of 759 symbols unpopulated off a
 * retyped key.
 */
export const coldRateKey = (d = new Date()) =>
  `${RATE_PREFIX}:${d.toISOString().slice(0, 16)}`;

/**
 * Days the exhaustion counter is kept. A fortnight answers "is this regular?"
 * and "did the migration week distort it?" without keeping a year of keys.
 */
export const SEC_COLD_EXHAUSTION_TTL_S = 14 * 86400;

/** UTC day key for the exhaustion counter, so the page and the writer agree. */
export const coldExhaustionKey = (d = new Date()) =>
  `msh:sec:cold-exhausted:v1:${d.toISOString().slice(0, 10)}`;

/** One INCR, best effort, only ever called when the budget is already spent. */
async function bumpExhaustion(): Promise<void> {
  if (!redis) return;
  try {
    const key = coldExhaustionKey();
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, SEC_COLD_EXHAUSTION_TTL_S);
  } catch {
    // Counting a refusal must never turn it into a throw.
  }
}

/**
 * The cold-FETCH budget. Fails OPEN, like every other Redis guard here.
 *
 * COUNTS FETCHES, NOT REQUESTS, and that distinction survives the change below:
 * a visitor reading twenty cached pages spends nothing, and only the act of
 * triggering an external fetch is budgeted. Over budget is not an error either
 * -- the symbol is queued and the page renders pending, which is the same
 * degradation a timeout gets.
 *
 * ── SITE-WIDE, NOT PER-IP, AND THAT IS A LOSS ──────────────────────────────
 *
 * The brief asked for per-IP. Per-IP needs the client's address, the only way
 * to learn it inside a render is `headers()`, and `headers()` is
 * unconditionally a dynamic API -- which on this ISR route is not a degradation
 * but a 500, measured (see the caveat at the top of this file). Per-IP capping
 * and ISR cannot both hold here.
 *
 * WHAT IS LOST HERE: a single actor can spend the whole site's minute. The
 * bucket bounds total external work, which is the cost that matters, but it
 * does not isolate one client from another.
 *
 * ── AND THE PER-IP BOUND IS REAL, IT IS JUST NOT IN THIS FILE ──────────────
 *
 * It is enforced at the edge, before a request reaches any of this code:
 *
 *   VERCEL FIREWALL: /stock — 25 requests / 600s per IP — Challenge
 *
 * That is the answer to "what stops one address spending the site's minute",
 * and it is a better answer than middleware would have been: it costs zero
 * Redis commands, it runs before the lambda, and it cannot be defeated by a
 * bug in this file. A burst from one address is challenged at 25 requests in
 * ten minutes, so it cannot reach 20 cold fetches in one minute at all.
 *
 * ── SO THERE IS DELIBERATELY NO PER-IP LOGIC IN THIS CODEBASE ─────────────
 *
 * The middleware version -- one EXISTS on the fact-set key per earnings
 * REQUEST, on a Redis billed by command count -- was considered and REFUSED,
 * not deferred. Adding per-IP counting here would duplicate a rule the edge
 * already enforces, at a per-request cost, in the one place where reading the
 * client address (`headers()`) turns this ISR route into a 500.
 *
 * TWO THINGS MUST STAY TRUE and scripts/check-sec-rate-limits.mjs asserts both:
 * the site-wide bucket below still exists and still refuses past its cap, and
 * the firewall line above still matches the one in
 * claude/sec-rate-limits-2026-09-16.md. A rule that lives outside the repo is a
 * rule that silently stops being true, so the repo keeps a copy and the copy is
 * checked against itself.
 */
async function claimColdFetch(symbol: string): Promise<boolean> {
  if (!redis) return true;
  try {
    // Minute-resolution bucket: slice(0, 16) is YYYY-MM-DDTHH:MM.
    const key = coldRateKey();
    const n = await redis.incr(key);
    // 120s, not 60: a bucket created at :59 would otherwise expire a second
    // later and hand the next second a fresh allowance.
    if (n === 1) await redis.expire(key, 120);
    if (n > SEC_COLD_FETCHES_PER_MINUTE) {
      // THE EVIDENCE THAT WOULD JUSTIFY THE MIDDLEWARE VERSION, and the reason
      // it is not built today. Per-IP isolation costs a Redis EXISTS on every
      // earnings request forever, on a meter already under cost pressure, to
      // defend against an actor who can at worst spend one minute's budget and
      // is self-healed 60 seconds later. That trade is bad against a
      // hypothetical and might be good against a pattern.
      //
      // So this line IS the decision procedure: if it appears regularly in
      // production, there is a pattern and the middleware version has a case.
      // If it never appears, the isolation was never needed. One log line
      // beats an argument either way.
      console.warn(
        `[sec-cold] rate budget exhausted: ${n} cold fetches this minute ` +
          `(cap ${SEC_COLD_FETCHES_PER_MINUTE}) — ${symbol} queued instead`
      );
      // ── AND COUNTED, BECAUSE A LOG LINE IS NOT A MEASUREMENT ─────────────
      //
      // The paragraph above says this line IS the decision procedure for
      // whether per-IP isolation ever has a case: "if it appears regularly in
      // production, there is a pattern". Nobody greps a week of Vercel logs to
      // answer that. One INCR on a DAY key, on the exhausted path ONLY, makes
      // it a number the cache-health page can show — so the normal case still
      // costs exactly the one INCR above and nothing else.
      await bumpExhaustion();
      return false;
    }
    return true;
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

/** Matches `revalidate` in app/stock/[symbol]/layout.tsx. See fetchAndStore. */
export const SEC_COLD_FETCH_REVALIDATE = 3600;

async function fetchAndStore(symbol: string, cik: string): Promise<StoredFactSet> {
  const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
    headers: { "User-Agent": SEC_UA, "Accept-Encoding": "gzip, deflate" },
    // NOT `cache: "no-store"`. That hint opts the whole route out of static
    // rendering, and on this route that is a 500 rather than a slow page --
    // measured, see the caveat at the top of this file.
    //
    // AND THE DATA CACHE IS IMMATERIAL EITHER WAY, which is why matching the
    // route's own window is enough rather than a value that needs tuning:
    //   - a symbol reached here is written to Redis by the line below, so guard
    //     2 means the NEXT render never reaches this fetch at all. The real
    //     cache is the store, and it has no expiry.
    //   - the measured body is 3.0MB p50 / 6.4MB max, over Vercel's 2MB Data
    //     Cache entry limit, so it is offered and declined rather than stored.
    //     CONFIRMED IN PRODUCTION LOGS, not predicted: "Failed to set Next.js
    //     data cache for .../CIK0000723603.json, items over 2MB can not be
    //     cached (4345527 bytes)". One such line per symbol for the life of the
    //     site -- a warning about a response that was used anyway, not an error.
    // A value BELOW the route's 3600 would be the harmful choice: Next takes
    // the minimum of a segment's revalidate and its fetches', so it would
    // shorten every stock page's window, not just this one's.
    next: { revalidate: SEC_COLD_FETCH_REVALIDATE },
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
  // THE MANIFEST IS THE ONLY PLACE THAT DOES NOT KNOW THIS CIK. We cannot have
  // reached here without one — cikForSymbol is the first gate in
  // resolveFactSetForRender — and `populationQueues` filters on `e.cik`, so an
  // entry without one is in NO cron queue. Recorded to a small side channel
  // rather than written into the 417 KB manifest from a render. See secColdCik.
  await recordColdCik(symbol, cik);
  return set;
}

/**
 * What an empty extraction MEANS, from the stored taxonomy census.
 *
 * `tx` absent is UNKNOWN, not "none". Sets written before the census existed
 * have no `tx`, and reading its absence as "this filer published nothing" would
 * reintroduce the false claim in a place no one would look for it.
 */
function emptyResult(
  symbol: string,
  tx: string[] | undefined,
  cu: string[] | undefined
): ColdResult {
  if (!tx) {
    return {
      status: "no-xbrl",
      reason: "stored before the taxonomy census existed",
      why: "unknown",
      taxonomies: [],
    };
  }
  const r = unreadableReason(tx, cu ?? []);
  switch (r.kind) {
    case "unread-taxonomy":
      return {
        status: "no-xbrl",
        reason: `filed under ${r.taxonomies.join(", ")}, which these fields do not read`,
        why: "unread-taxonomy",
        taxonomies: r.taxonomies,
      };
    case "currency":
      return {
        status: "no-xbrl",
        reason: `reports in ${r.currencies.join(", ")}; these fields read USD only`,
        why: "currency",
        taxonomies: r.currencies,
      };
    case "unread-detail":
      return {
        status: "no-xbrl",
        reason: "a readable taxonomy is present but no field this page reads resolved",
        why: "unread-detail",
        taxonomies: [],
      };
    default:
      return {
        status: "no-xbrl",
        reason: "no financial taxonomy in the payload",
        why: "none",
        taxonomies: [],
      };
  }
}

/**
 * One re-fetch of a symbol whose stored set is empty under an older chain set.
 *
 * Returns null on ANY failure, so the caller falls back to the stored answer
 * rather than to a pending page: the symbol already has a real, if empty,
 * reading, and downgrading it to "being fetched" on a slow network would be the
 * permanent-pending failure again. Budgeted and timed out exactly like a cold
 * fetch, because that is what it is.
 */
async function retryEmpty(symbol: string, cik: string): Promise<ColdResult | null> {
  if (!(await claimColdFetch(symbol))) return null;
  try {
    const set = await withTimeout(
      fetchAndStore(symbol, cik),
      SEC_COLD_TIMEOUT_MS,
      `[sec-cold] ${symbol} empty-set retry`
    );
    console.warn(
      `[sec-cold] ${symbol}: empty set re-read under chains ${secChainsHash()} — ` +
        `${hasUsableData(set) ? "now has data" : "still empty"}`
    );
    return hasUsableData(set) ? { status: "ready", set, cold: true } : emptyResult(symbol, set.tx, set.cu);
  } catch (err) {
    rethrowIfDynamic(err);
    return null;
  }
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
    // ── A POPULATED SET IS RETURNED AS IT STANDS. THE CRON OWNS REFRESHING ──
    //
    // A refresh-on-view was built here and REMOVED, and the reason is worth
    // keeping because the idea will come back. It scheduled the re-read in
    // `after()`, which works, and then called `revalidatePath` to flush the
    // page it had just corrected — and production refused that call:
    //
    //   Dynamic server usage: Route /stock/[symbol]/earnings couldn't be
    //   rendered statically because it used `revalidatePath`
    //
    // `revalidatePath` is not permitted from a page RENDER's after(); the cron
    // gets away with it because it calls from a route handler. Without the
    // flush the corrected set sat behind the ISR window for up to an hour, so
    // the mechanism delivered nothing on the view that paid for it. Worse, the
    // trigger could only fire on a render: the reload twenty seconds later was
    // served from the ISR cache, so the one visitor who triggered a refresh was
    // also the only one who could, and they saw the old figures anyway.
    //
    // Moving the trigger to a route handler would work and was declined: with
    // the CIK recorded on cold writes (secColdCik) every stored symbol is in a
    // cron queue, the daily index lands nightly, and the cron revalidates the
    // sets that CHANGED from a route handler where the call is permitted. A
    // visitor-driven trigger cannot beat that by more than about a day, which
    // does not justify a public endpoint that causes writes.
    if (hasUsableData(stored)) return { status: "ready", set: stored, cold: false };
    // ── AN EMPTY SET FROM AN OLDER CHAIN SET IS WORTH ONE RETRY ─────────────
    //
    // secFieldsHash gates on field ORDER and MEMBERSHIP, deliberately: a
    // corrected tag chain does not invalidate stored VALUES. But it does
    // invalidate stored NOTHING. Every IFRS filer has an empty set written
    // before ifrs-full was read, and without this they stay empty forever --
    // the page would keep saying it cannot read them while the chains that can
    // sit right there.
    //
    // Scoped to EMPTY sets only, so it is not a mass re-populate: a set with
    // values is never re-fetched by this, and a set that re-fetches to nothing
    // again stores the current hash and stops retrying.
    if (SEC_UA && stored.c !== secChainsHash()) {
      const retried = await retryEmpty(clean, cik);
      if (retried) return retried;
    }
    return emptyResult(clean, stored.tx, stored.cu);
  }

  if (!SEC_UA) {
    // SEC's fair-access policy requires a declared, contactable agent. Fetching
    // without one risks a block on the whole account, so this refuses rather
    // than fetching anonymously -- and says so, rather than 404ing a real
    // company over a configuration problem.
    return { status: "pending", reason: "SEC_USER_AGENT is not configured" };
  }

  // 3. THE RATE BUDGET.
  if (!(await claimColdFetch(clean))) {
    await enqueue(clean);
    return { status: "pending", reason: "the cold-fetch budget for this minute is spent" };
  }

  // 4. THE TIMEOUT.
  try {
    const set = await withTimeout(
      fetchAndStore(clean, cik),
      SEC_COLD_TIMEOUT_MS,
      `[sec-cold] ${clean}`
    );
    return hasUsableData(set) ? { status: "ready", set, cold: true } : emptyResult(clean, set.tx, set.cu);
  } catch (err) {
    rethrowIfDynamic(err);
    const reason = String((err as Error)?.message ?? err);
    const queued = await enqueue(clean);
    console.warn(`[sec-cold] ${clean}: ${reason}${queued ? " — queued" : " — queue full"}`);
    return { status: "pending", reason };
  }
}
