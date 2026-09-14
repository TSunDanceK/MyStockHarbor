// Which news provider is active, and the one call the read path makes.
//
// Step 7 of claude/news-adapter-spec-2026-09-13.md: THE DEFAULT IS NOW "free".
// Steps 1-6b built the adapters behind this seam; this is the step that points
// the site at them.
//
// ── ROLLBACK IS AN ENVIRONMENT VARIABLE, NOT A REVERT ──────────────────────
// NEWS_PROVIDER="fmp" still selects the FMP adapter, and that is a hard
// requirement rather than a courtesy: it is the flick-back. Re-adding the
// variable in Vercel Production restores the old feed with no revert commit and
// no code change, which is why the FMP adapter stays in the tree, compiling and
// exercised — §9's "do not delete or gut the FMP adapter".
//
// BE PRECISE ABOUT WHAT THAT COSTS. This is an env read, so the new value does
// not reach the running deployment until a PRODUCTION REDEPLOY (~2 min, same
// commit). Earlier wording here, on /cache-health and in the spec claimed "no
// deploy"; that was wrong, and wrong in the worst place — the sentence someone
// reads while deciding whether the rollback is fast enough to reach for.
//
// THE SHIP SEQUENCE THIS DEFAULT ASSUMES, so the merge itself moves nothing:
//   1. NEWS_PROVIDER=fmp set in Vercel Production BEFORE this merges.
//   2. Merge. The default is free, Production is pinned to fmp — no change.
//      Preview has no such pin, which is where the free stack gets exercised.
//   3. Remove the Production variable. THAT is the flip.
//   4. Re-add it to roll back.
//
// ── THE ONE VISIBLE CONTENT CHANGE ─────────────────────────────────────────
// FREE_FEED_MAX_AGE_DAYS (below) engages with this default and
// narrows the feed window from 90 days to 45. Deliberate: Google News backfills
// thin names with ancient articles — CYRX came back with 56 items spread over
// 3,453 days — so the old window let a 2016 headline sit on a 2026 page. The
// cost is visibly fewer cards on quiet symbols, and fewer honest cards is the
// intended trade.
//
// ── WHAT BECOMES LOAD-BEARING HERE ─────────────────────────────────────────
// data/static-profile.json. Until this step the cached FMP value always
// answered first for sector and industry; there is no free source carrying
// FMP's taxonomy, so from here the snapshot is the floor and a symbol outside
// it resolves to null — no bucket, the generated card, and absent from sector
// pages. lib/server/staticProfile.ts logs every one of those misses.
import { beginTiming } from "../timing";
import { fmpNewsProvider } from "./fmpProvider";
import { gnewsProvider } from "./gnewsProvider";
import { wireProvider } from "./wireProvider";
import { secProvider } from "./secProvider";
import type { NewsItem, NewsProvider } from "./types";

export type NewsProviderMode = "free" | "fmp";

/**
 * The free adapters, in the order they should be consulted.
 *
 * Google News (§1) is the per-symbol primary and landed in step 3; the wires
 * (§2) landed in step 4 and SEC (§3) appends in step 5.
 *
 * ORDER IS NOT PRIORITY. fetchSymbolNewsWindow concatenates every active
 * provider and hands the lot to the store, which sorts by date and dedupes. The
 * wires are a SUPPLEMENT, not a second primary: one real poll resolved 2 of 40
 * wire items to a universe symbol, so on most symbols they contribute nothing
 * and on a few they contribute the release itself.
 *
 * THIS IS NOW THE DEFAULT LIST. Step 7 flipped it; before that this array was
 * built but unreached on the live site.
 */
const FREE_PROVIDERS: NewsProvider[] = [gnewsProvider, wireProvider, secProvider];

/**
 * NEWS_PROVIDER = "free" (default since step 7) | "fmp"
 *
 * THE TEST IS FOR "fmp", NOT FOR "free", and the asymmetry is the point. The
 * variable exists now only to opt OUT of the default, so the one spelling that
 * has to work exactly is the rollback one. Anything else — a typo, an empty
 * string, unset — reads as free, which is the path the site is built on.
 *
 * Unrecognised values still do not throw, for the same reason as before: a typo
 * in an environment variable should not be able to take the news feed down.
 */
export function newsProviderMode(): NewsProviderMode {
  return process.env.NEWS_PROVIDER === "fmp" ? "fmp" : "free";
}

/**
 * How far back the FEED will walk to fill its slots. Separate from the SCORE's
 * window on purpose, and much longer: a headline from six weeks ago is still
 * worth reading and is not evidence of what the tone is right now.
 *
 * 90 days is a floor, not a target. Past a quarter a card claiming to be part of
 * the current picture is from a different one, and a short feed on a thin ticker
 * is the honest outcome.
 */
export const NEWS_FEED_MAX_AGE_DAYS = 90;
/**
 * The same window for the free stack, and it is shorter for a measured reason.
 *
 * Google News backfills thin-coverage names with whatever the index still holds
 * -- CYRX returned 55 items spanning 3,453 days, one from 2017 -- so a 90-day
 * feed window that is honest against FMP's latest-N window is not honest against
 * a search index. 45 days at display; the store still holds 120 so the earnings
 * pin can reach back.
 *
 * GATED ON THE ACTIVE PROVIDER rather than applied to everything, so the fmp
 * rollback restores the 90-day window along with the feed. Step 7 moved both
 * constants here from lib/stock-news-data.ts: the window is a property of the
 * provider, and a reader asking "what changed at the flip" should find it in
 * the file that does the flipping rather than 1,100 lines into another one.
 */
export const FREE_FEED_MAX_AGE_DAYS = 45;

/** The feed window the ACTIVE provider gets. One place, both callers. */
export function feedMaxAgeDays(): number {
  return newsProviderMode() === "free" ? FREE_FEED_MAX_AGE_DAYS : NEWS_FEED_MAX_AGE_DAYS;
}

/**
 * The active providers.
 *
 * THE EMPTY-LIST GUARD IS KEPT, AND STEP 7 MADE IT MATTER MORE RATHER THAN
 * LESS. Step 1's note said this branch could go once FREE_PROVIDERS had
 * entries. That was written when "free" was opt-in and an empty list could only
 * affect someone who had asked for it. Free is now the default, so an empty
 * list would empty the news feed on EVERY page, with no error anywhere —
 * exactly the silent failure claude/silent-failure-traps.md is about. It costs
 * one comparison and it fails loudly instead. Unreachable as the list stands;
 * kept because the day it becomes reachable is the day it is needed.
 */
export function activeNewsProviders(): NewsProvider[] {
  if (newsProviderMode() === "free") {
    if (FREE_PROVIDERS.length) return FREE_PROVIDERS;
    console.warn(
      '[news] NEWS_PROVIDER="free" but FREE_PROVIDERS is empty — something failed' +
        " to register. Serving FMP so the feed is not silently blank."
    );
  }

  return [fmpNewsProvider];
}

/**
 * How long one adapter gets before the render gives up on it.
 *
 * ── MEASURED, AND THE MEASUREMENT WAS ALARMING ─────────────────────────────
 * One cold render of /stock/AMD/news on the preview, with MSH_TIMING on:
 *
 *   [timing] news adapter sec   AMD      70ms
 *   [timing] news adapter gnews AMD     573ms
 *   [timing] news adapter wire  AMD   70630ms   <-- seventy seconds
 *   [timing] news fanOut        AMD   70634ms
 *   [timing] page stockNews     AMD   71133ms
 *
 * The page took SEVENTY-ONE SECONDS and the wire adapter was 99.3% of it. The
 * same 70s appears on /api/internal-news, so the dashboard strip pays it too.
 *
 * It is not the wires being slow. From a GitHub runner both feeds answer in
 * 12-330ms. From Vercel they hang — the same shape as Stooq and Nasdaq
 * refusing this site's IPs (claude/stooq-inaccessible-sec-viable-2026-09-12.md),
 * and the reason source viability here is measured from inside a function
 * rather than from a laptop.
 *
 * 5 SECONDS, CHOSEN FROM THE NUMBERS RATHER THAN GUESSED. The slowest healthy
 * leg ever measured is Google News at 573ms in-render and 720ms cold from a
 * runner; 5s is roughly 7x that, so a legitimately slow source still lands.
 * Anything that has not answered by then is not slow, it is not answering.
 *
 * ── WHAT A TIMEOUT COSTS, STATED SO IT IS NOT DISCOVERED LATER ─────────────
 * The content a crawler indexes can vary between renders when a source is
 * slow. That is acceptable for a news page — the content varies anyway — and it
 * is strictly better than the alternative, which is a 71-second render that
 * times out at the platform and indexes nothing at all.
 *
 * PARTIAL RESULTS ARE STILL STORED. A timed-out leg rejects, allSettled keeps
 * the rest, and a successful Google News fetch is never discarded because the
 * wires hung. Only an all-adapters failure throws, and the store then serves
 * what it holds.
 */
export const ADAPTER_TIMEOUT_MS = 5_000;

/** Rejects if `work` has not settled within `ms`. */
function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // unref() so a pending timer cannot hold a serverless invocation open past
    // the response -- the race is settled either way by then.
    const timer = setTimeout(() => {
      reject(new Error(`${label} exceeded ${ms}ms`));
    }, ms);
    (timer as unknown as { unref?: () => void }).unref?.();

    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); }
    );
  });
}

/**
 * One per-symbol window, from whichever providers are active.
 *
 * This is what lib/stock-news-data.ts hands the store as its `fetchWindow`. It
 * now resolves to THREE providers by default (Google News, the wires, SEC) and
 * to one under the fmp rollback, and it simply concatenates them.
 *
 * NO try/catch HERE, on purpose. lib/server/newsStore.ts treats a throw from
 * fetchWindow as "upstream failed, serve what is stored" and deliberately does
 * NOT rewrite the record. Swallowing a failure into [] here would instead look
 * like a successful empty fetch, and the store would merge nothing, rewrite the
 * key and count a refresh. The adapters keep their own internal error handling;
 * this function stays transparent.
 *
 * ORDERING IS NOT DECIDED HERE and deliberately so: lib/server/newsStore.ts
 * sorts by date and collapses repeats by title similarity, so the concatenation
 * order below has no effect on what a reader sees. Sorting here would be a
 * second ranking nobody reads.
 */
export async function fetchSymbolNewsWindow(
  symbol: string,
  companyName: string,
  sinceIso: string | null
): Promise<NewsItem[]> {
  const providers = activeNewsProviders();

  // ── allSettled, AND THE ALL-FAILED CASE STILL THROWS ──────────────────────
  // Promise.all lost two good windows to one bad one: a single adapter
  // rejecting discarded whatever the other two had already returned, and the
  // store then saw a throw and served stale. Google News succeeding is not a
  // reason to lose Google News because SEC was down.
  //
  // BUT A NAIVE allSettled BREAKS THE CONTRACT ABOVE, and that is the trap.
  // Returning [] when every adapter failed would look to newsStore.ts like a
  // SUCCESSFUL EMPTY FETCH: it would merge nothing, rewrite the key, count a
  // refresh, and a populated store would decay toward empty on repeated
  // upstream failure. "No news exists" and "nobody answered" are different
  // facts and only one of them may be written down.
  //
  // So: some succeeded -> return what arrived. NONE succeeded -> throw, exactly
  // as Promise.all did, and the store keeps what it holds.
  // ── TIMED PER ADAPTER AND FOR THE FAN-OUT AS A WHOLE ──────────────────────
  // Off unless MSH_TIMING=1, in which case each helper is a boolean check and a
  // pass-through (lib/server/timing.ts). Per-adapter AND total, because the
  // question "does the page wait for the slowest source or the sum" cannot be
  // answered by either number alone.
  const endFanOut = beginTiming("news", `fanOut ${symbol}`);
  const settled = await Promise.allSettled(
    providers.map(async (provider) => {
      const endLeg = beginTiming("news", `adapter ${provider.id} ${symbol}`);
      try {
        return await withTimeout(
          provider.fetchForSymbol(symbol, companyName, sinceIso),
          ADAPTER_TIMEOUT_MS,
          `[news] adapter ${provider.id} for ${symbol}`
        );
      } finally {
        endLeg();
      }
    })
  );
  endFanOut();

  const fulfilled = settled.filter(
    (result): result is PromiseFulfilledResult<NewsItem[]> => result.status === "fulfilled"
  );

  if (!fulfilled.length) {
    const reasons = settled
      .map((result, i) => `${providers[i]?.id ?? i}: ${String((result as PromiseRejectedResult).reason)}`)
      .join("; ");
    // The message is the whole diagnosis: newsStore catches this and serves
    // stored items, so without it an all-down upstream is invisible.
    throw new Error(`[news] every adapter failed for ${symbol} — ${reasons}`);
  }

  if (fulfilled.length < settled.length) {
    const failed = settled
      .map((result, i) => (result.status === "rejected" ? providers[i]?.id ?? String(i) : null))
      .filter(Boolean);
    console.warn(
      `[news] ${symbol}: ${failed.join(", ")} failed, serving ${fulfilled.length} of ${settled.length} adapters`
    );
  }

  return fulfilled.flatMap((result) => result.value);
}
