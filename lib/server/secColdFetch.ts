// THE COLD PATH: a symbol with a CIK but no stored fact set.
//
// ── 2026-09-23 (#535 COWORK #13): THE RENDER NO LONGER FETCHES ─────────────
// resolveFactSetForRender reads the store and nothing else. It used to fetch
// companyfacts on a cold render, and that was reachable by any crawler that can
// request a URL. The fetch moved to fillColdSymbol, called ONLY by the
// human-gated server action (app/stock/[symbol]/coldFillAction.ts: quote
// token, per-IP and daily limits, BotID deep analysis, a per-symbol lock). A
// crawler gets "not yet read", `noindex`, and the scheduled jobs' data.
//
// The history below describes the old render-time fetch. It is kept because
// its measurements (the ISR 500, the per-IP trade-off) still bind: the fill
// must never move back into a render.
//
// WHY NOT A QUEUE (original design). Enqueue-and-drain gives the FIRST VISITOR
// a pending state. The gated fill keeps that property for a person — a ~5 s
// wait on the page — without letting a bot trigger it.
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
import { canWriteSecState, noteSecWriteBlocked, secCounterPrefix } from "./secWriteGate";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { loadTickerMap } from "./secTickerMap";
import { lookupBySpelling } from "../symbolSpellings.mjs";
import { companyFactsAbsent, unreadableReason, type CompanyFacts } from "./secExtract";
import { extractForSymbol } from "./secExtractFor";
import { type StoredFactSet } from "./secFactCodec";
import { toStoredSet } from "./secFactBuild";
import { needsReread } from "./secStaleness";
import { admitSymbolForExtraction } from "./securityKind";
import { factSetExists, factSetPresence, readFactSet, writeFactSet } from "./secFactStore";
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
  | { status: "pending"; reason: string }
  /**
   * This ticker is not the security the issuer's statements describe.
   *
   * A CIK identifies a FILER, not a security, so MER-PK resolves to Bank of
   * America's CIK and every field on this page would be Bank of America's.
   * NOT a 404 and not "pending": the ticker genuinely trades and nothing is
   * going to arrive later. See lib/server/securityKind.ts.
   */
  | {
      status: "not-issuer-equity";
      reason: "derivative-of-issuer" | "unverifiable";
      /** Other tickers on the same CIK, so the page can point somewhere real. */
      siblings: string[];
      cik: string;
    };

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
  `${secCounterPrefix(RATE_PREFIX)}:${d.toISOString().slice(0, 16)}`;

/**
 * Days the exhaustion counter is kept. A fortnight answers "is this regular?"
 * and "did the migration week distort it?" without keeping a year of keys.
 */
export const SEC_COLD_EXHAUSTION_TTL_S = 14 * 86400;

/** UTC day key for the exhaustion counter, so the page and the writer agree. */
export const coldExhaustionKey = (d = new Date()) =>
  `${secCounterPrefix("msh:sec:cold-exhausted:v1")}:${d.toISOString().slice(0, 10)}`;

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
 * It is enforced at the edge, before a request reaches any of this code, by TWO
 * rules whose ORDER is part of the rule — the bypass is evaluated first, and a
 * bypass sitting below a challenge does nothing:
 *
 *   VERCEL FIREWALL BYPASS: Google & Bing crawlers — AS 15169,8075 AND user-agent matches /[Gg]ooglebot|[Bb]ingbot|Mediapartners-Google|AdsBot-Google|Google-InspectionTool/ — Bypass, ABOVE the rate limit
 *   VERCEL FIREWALL: /stock — 25 requests / 600s per IP — Challenge
 *
 * The second is the answer to "what stops one address spending the site's
 * minute", and it is a better answer than middleware would have been: it costs
 * zero Redis commands, it runs before the lambda, and it cannot be defeated by
 * a bug in this file. A burst from one address is challenged at 25 requests in
 * ten minutes, so it cannot reach 20 cold fetches in one minute at all.
 *
 * ── AND THE FIRST IS WHY THAT DOES NOT COST US THE INDEX ──────────────────
 *
 * /stock/* is 483 of the ~765 sitemap URLs. A crawler challenged at 25 requests
 * per ten minutes drains most of the index with NO visible symptom on the live
 * domain. middleware.ts carries the same reasoning for its own isKnownGoodBot
 * allowlist, and it cannot help here: the firewall runs BEFORE the lambda, so
 * the challenge is already served by the time middleware could allow anything.
 *
 * BOTH CONDITIONS ARE REQUIRED AND NEITHER WOULD DO ALONE. AS 15169 and AS 8075
 * are the whole of GCP and the whole of Azure, so ASN alone would exempt every
 * scraper anyone runs on either cloud. A user-agent alone is a claim anyone can
 * make — `curl -A Googlebot` would walk past the limit. Together they are
 * verified-crawler identification in the same sense as Google's reverse-DNS
 * check: that user-agent, from that network.
 *
 * AND THOSE ASNs ARE DELIBERATELY NOT ON THE DATACENTER BLOCK LIST. Blocking
 * them outright instead would break link previews (Slack, Discord, WhatsApp,
 * iMessage, X all fetch Open Graph tags from cloud IPs), the ads crawlers named
 * in the bypass above, and the assistant fetchers that largely run on Azure.
 * See claude/sec-rate-limits-2026-09-16.md.
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
 * BOTH firewall lines above still match the ones in
 * claude/sec-rate-limits-2026-09-16.md, field for field — including the
 * bypass's recorded ORDER, which is the one property that can be wrong while
 * every other field is right, and whose failure is silent. A rule that lives
 * outside the repo is a rule that silently stops being true, so the repo keeps
 * a copy and the copy is checked against itself.
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
  // NOTHING TO DRAIN FOR. The cron that reads this queue runs on production,
  // and a preview asking it to fetch a symbol is a preview writing production
  // state at one remove.
  if (!canWriteSecState()) { noteSecWriteBlocked("coldQueue.enqueue"); return false; }
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
  if (!canWriteSecState()) { noteSecWriteBlocked("clearColdQueue"); return 0; }
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
  // A 404 IS "SEC HAS NO COMPANY FACTS FOR THIS CIK" — stored as the empty
  // answer it is (see companyFactsAbsent), the same rule as the cron's fetch.
  const absent = companyFactsAbsent(res.status);
  if (!absent && !res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  // A 200 carrying HTML is not data. Same strictness that caught Stooq.
  if (!absent && !ct.includes("json")) throw new Error(`expected JSON, got ${ct}`);
  const facts: CompanyFacts = absent ? { cik: Number(cik), facts: {} } : ((await res.json()) as CompanyFacts);
  // SAME CONVERSION RULE AS THE CRON, from the same function. A second copy
  // here is the shape where one path gains a condition and the other does not.
  const set = await toStoredSet(extractForSymbol(symbol, facts));
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
 * "Not yet read": a symbol with a CIK, admitted, and no stored set.
 *
 * The render says so and does nothing else — no SEC call, no queue entry. The
 * figures arrive by one of two routes, neither of which a crawler can drive:
 * a human-gated fill from the page (coldFillAction → fillColdSymbol), or the
 * scheduled jobs. See the header of lib/server/secColdFill.ts.
 */
export const NOT_YET_READ = "not yet read";

/**
 * Resolve one symbol's fact set for a render. READ-ONLY: never calls SEC and
 * never queues work (#535 COWORK #10 constraints 1 and 2, COWORK #13).
 *
 * Never throws: every failure path returns a status the page can render.
 */
export async function resolveFactSetForRender(symbol: string): Promise<ColdResult> {
  const clean = symbol.trim().toUpperCase();

  // 1. THE CIK GATE, FIRST AND CHEAPEST. No network, no Redis, no write.
  const cik = cikForSymbol(clean);
  if (!cik) return { status: "no-cik" };

  // 1b. THE SECURITY-KIND GATE, IMMEDIATELY AFTER IT AND FOR THE SAME REASONS.
  //
  // A CIK resolving is not the same as this TICKER being the security those
  // filings describe. MER-PK resolves to Bank of America's CIK 0000070858
  // along with sixteen other securities, so every figure below would be Bank
  // of America's, rendered under a preferred's ticker. Complete, plausible and
  // entirely wrong -- which is worse than empty, because nothing on screen
  // says so.
  //
  // BEFORE THE STORE READ, not after. A stored set for one of these symbols
  // already exists (extraction has been running without this gate), so gating
  // on the read would hand back the very data this exists to withhold.
  // Synchronous and committed-file-only, like the CIK gate above.
  const kind = admitSymbolForExtraction(clean, cik);
  if (!kind.admit) {
    return {
      status: "not-issuer-equity",
      reason: kind.reason,
      siblings: kind.siblings,
      cik: kind.cik,
    };
  }

  // 2. THE STORE, AND NOTHING AFTER IT.
  //
  // ── THE RENDER NO LONGER FETCHES (2026-09-23, #535 COWORK #13) ──────────
  // It used to fetch companyfacts here on a cold render, rate-bucketed and
  // timed out, and re-fetch an empty set stored under an older chain set. Both
  // were reachable by anything that can request a URL: a crawler walking
  // /stock/<ticker> spent the site's SEC budget and queued work for the cron.
  // Both moved to fillColdSymbol, which only a human-gated server action calls.
  // A render reads the store and reports what it found.
  const stored = await readFactSet(clean);
  if (stored) {
    if (hasUsableData(stored)) return { status: "ready", set: stored, cold: false };
    return emptyResult(clean, stored.tx, stored.cu);
  }
  return { status: "pending", reason: NOT_YET_READ };
}

/** What a cold fill did. Carries no figures: the page re-renders from the store. */
export type ColdFillOutcome =
  /** A usable set is stored (now, or already). */
  | "filled"
  /** Read, and SEC has nothing this page can use; remembered for a day. */
  | "no-data"
  /** Timed out or failed; the symbol is queued for the scheduled job. */
  | "queued"
  /** The site-wide minute budget is spent; queued instead. */
  | "busy"
  /** Not a symbol this path serves (no CIK, not the issuer's equity). */
  | "not-eligible"
  /** A preview deployment, or no User-Agent configured: nothing may be fetched. */
  | "unavailable";

/**
 * How long "SEC has nothing usable for this CIK" is remembered, so a repeat
 * visitor does not refetch 3 MB to learn the same nothing.
 */
export const COLD_NONE_TTL_S = 24 * 3600;
export const coldNoneKey = (symbol: string) =>
  `${secCounterPrefix("msh:sec:cold-none:v1")}:${symbol.toUpperCase()}`;

/**
 * Fill one cold symbol. CALLED ONLY FROM THE HUMAN-GATED SERVER ACTION
 * (app/stock/[symbol]/coldFillAction.ts), after its token, per-IP, daily and
 * BotID gates. Never from a render.
 *
 * The four guards of the old render path, in the same order: CIK, store,
 * site-wide budget, timeout. The CIK gate still bounds what can trigger work to
 * the ~10,400 registrants in the committed ticker file.
 */
export async function fillColdSymbol(symbol: string): Promise<ColdFillOutcome> {
  const clean = symbol.trim().toUpperCase();
  const cik = cikForSymbol(clean);
  if (!cik) return "not-eligible";
  if (!admitSymbolForExtraction(clean, cik).admit) return "not-eligible";
  if (!SEC_UA || !canWriteSecState()) return "unavailable";

  const stored = await readFactSet(clean);
  if (stored && hasUsableData(stored)) return "filled";
  // ── AN EMPTY SET FROM AN OLDER CHAIN SET IS WORTH ONE RETRY ─────────────
  // secFieldsHash gates on field ORDER and MEMBERSHIP, deliberately: a
  // corrected tag chain does not invalidate stored VALUES. But it does
  // invalidate stored NOTHING — every IFRS filer had an empty set written
  // before ifrs-full was read. needsReread is the one staleness rule (see
  // secStaleness); a set it does not flag is a real, current "nothing".
  if (stored && !needsReread(stored)) return "no-data";

  if (redis) {
    try {
      if (await redis.exists(coldNoneKey(clean))) return "no-data";
    } catch {
      // A failed negative-cache read costs one fetch, not correctness.
    }
  }

  if (!(await claimColdFetch(clean))) {
    await enqueue(clean);
    return "busy";
  }

  try {
    const set = await withTimeout(fetchAndStore(clean, cik), SEC_COLD_TIMEOUT_MS, `[sec-cold] ${clean}`);
    if (hasUsableData(set)) return "filled";
    if (redis) {
      try {
        await redis.set(coldNoneKey(clean), 1, { ex: COLD_NONE_TTL_S });
      } catch {
        // Best effort, as above.
      }
    }
    return "no-data";
  } catch (err) {
    const reason = String((err as Error)?.message ?? err);
    const queued = await enqueue(clean);
    console.warn(`[sec-cold] ${clean}: ${reason}${queued ? " — queued" : " — queue full"}`);
    return "queued";
  }
}

/**
 * A cold symbol still waiting for its first read: a CIK, admitted, and nothing
 * stored. The pages carry `noindex` exactly while this is true (#535 COWORK
 * #13), so a thin "not yet read" page is never indexed. Redis unable to answer
 * reads as "not waiting": metadata must not flip a real page to noindex on a
 * blip.
 */
export async function awaitingSecRead(symbol: string): Promise<boolean> {
  const clean = symbol.trim().toUpperCase();
  const cik = cikForSymbol(clean);
  if (!cik || !admitSymbolForExtraction(clean, cik).admit) return false;
  return (await factSetExists(clean)) === false;
}

/**
 * What the sitemap needs about its stock symbols (#535 COWORK #21), in one
 * pipelined read: which render "not yet read" and `noindex` right now (the
 * same rule as awaitingSecRead), and when each one's figures last changed.
 * Null when Redis cannot answer: the caller keeps its list as it was.
 */
export async function sitemapSecState(
  symbols: string[],
): Promise<{ awaiting: Set<string>; changedAt: Map<string, number> } | null> {
  const clean = symbols.map((s) => s.trim().toUpperCase());
  const presence = await factSetPresence(clean);
  if (!presence) return null;
  const awaiting = new Set(clean.filter((s) => {
    const cik = cikForSymbol(s);
    return Boolean(cik && admitSymbolForExtraction(s, cik).admit) && presence.exists.get(s) === false;
  }));
  return { awaiting, changedAt: presence.changedAt };
}
