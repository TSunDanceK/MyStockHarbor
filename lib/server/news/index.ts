// Which news provider is active, and the one call the read path makes.
//
// Step 1 of claude/news-adapter-spec-2026-09-13.md. The flag exists now so that
// steps 3-6 are adapter work behind a seam that is already load-bearing, and so
// that step 7 -- flipping the default to "free" -- is a one-line change to a
// line that has already shipped.
//
// THE DEFAULT IS "fmp" IN THIS STEP, which is the one place this file knowingly
// differs from the spec's snippet. The spec writes the end state, where free is
// the default; the spec's own build order puts that flip at step 7, after the
// adapters it would select actually exist. Defaulting to free now would point
// the site at an empty provider list.
import { fmpNewsProvider } from "./fmpProvider";
import type { NewsItem, NewsProvider } from "./types";

export type NewsProviderMode = "free" | "fmp";

/**
 * The free adapters, in the order they should be consulted.
 *
 * EMPTY UNTIL STEP 3. Google News (§1), the wires (§2) and SEC (§3) land one
 * step at a time, and each one appends here.
 */
const FREE_PROVIDERS: NewsProvider[] = [];

/**
 * NEWS_PROVIDER = "fmp" (default in step 1) | "free"
 *
 * Anything unrecognised reads as the default rather than throwing: a typo in an
 * environment variable should not be able to take the news feed down, and the
 * default is the provider that is known to work.
 */
export function newsProviderMode(): NewsProviderMode {
  return process.env.NEWS_PROVIDER === "free" ? "free" : "fmp";
}

/**
 * The active providers.
 *
 * WHY "free" CAN STILL RETURN FMP, and why that is not the flag being ignored:
 * between this step and step 3 there are no free adapters to return, and an
 * empty list would empty the news feed on every page with no error anywhere --
 * exactly the silent failure claude/silent-failure-traps.md is about. So the
 * unbuilt case says so on the way past and serves the working provider. Once
 * FREE_PROVIDERS has entries this branch stops being reachable, and it can go.
 */
export function activeNewsProviders(): NewsProvider[] {
  if (newsProviderMode() === "free") {
    if (FREE_PROVIDERS.length) return FREE_PROVIDERS;
    console.warn(
      '[news] NEWS_PROVIDER="free" but no free adapters are registered yet' +
        " (spec steps 3-5 are unbuilt) — serving FMP."
    );
  }

  return [fmpNewsProvider];
}

/**
 * One per-symbol window, from whichever providers are active.
 *
 * This is what lib/stock-news-data.ts hands the store as its `fetchWindow`, and
 * in step 1 it resolves to exactly one provider, so the array it returns is the
 * array that provider returned -- same items, same order, same length.
 *
 * NO try/catch HERE, on purpose. lib/server/newsStore.ts treats a throw from
 * fetchWindow as "upstream failed, serve what is stored" and deliberately does
 * NOT rewrite the record. Swallowing a failure into [] here would instead look
 * like a successful empty fetch, and the store would merge nothing, rewrite the
 * key and count a refresh. The adapters keep their own internal error handling;
 * this function stays transparent.
 *
 * Ordering across several providers is step 3/4's problem, not this step's: the
 * store dedupes and sorts what it is given, and there is one provider here.
 */
export async function fetchSymbolNewsWindow(
  symbol: string,
  companyName: string,
  sinceIso: string | null
): Promise<NewsItem[]> {
  const providers = activeNewsProviders();

  const windows = await Promise.all(
    providers.map((provider) => provider.fetchForSymbol(symbol, companyName, sinceIso))
  );

  return windows.flat();
}
