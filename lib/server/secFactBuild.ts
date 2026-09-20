// EXTRACTION TO STORED SET, CONVERTING WHEN THE FILER IS NOT A USD REPORTER.
//
// ── WHY THIS IS ITS OWN MODULE AND NOT A FUNCTION IN secCurrency ──────────
// secCurrency is pure arithmetic over field definitions and rates, and several
// checks lift it by concatenating sources. This function needs encodeFactSet
// and the rate LOADERS, which pull in the codec and the network adapters, and
// putting it there made two existing checks fail to resolve a module they had
// never needed. The split keeps the arithmetic liftable and the orchestration
// where its dependencies are allowed.
import type { ExtractResult } from "./secExtract";
import { convertExtractResult } from "./secCurrency";
import {
  FX_SPOT_BACKFILL_DAYS,
  defaultSources,
  isoDaysBefore,
  loadSeries,
  type FxSeries,
  type FxSource,
} from "./fxRates";
import { encodeFactSet, type StoredFactSet } from "./secFactCodec";

/**
 * The date span a filer's periods need rates for.
 *
 * Earliest START (a duration needs every day of it, not just its end) through
 * latest END. Instants have no start, so their end serves as both.
 */
function spanOf(result: ExtractResult): { from: string; to: string } | null {
  const ends: string[] = [];
  const starts: string[] = [];
  for (const list of [result.quarters, result.years, result.instants]) {
    for (const p of list) {
      if (p.end) ends.push(p.end);
      starts.push(p.start ?? p.end);
    }
  }
  if (!ends.length) return null;
  return { from: starts.sort()[0], to: ends.sort()[ends.length - 1] };
}

/**
 * A non-USD extraction with its PERIODS REMOVED, keeping `reportingCurrency`.
 *
 * ── WHY THE VALUES ARE DROPPED RATHER THAN STORED IN THEIR OWN CURRENCY ───
 * A set whose money values are euros, stored where every reader expects
 * dollars, is one careless renderer away from printing euros under a dollar
 * sign — and nothing about the output would look wrong. That renderer need not
 * even exist yet: the store is shared across deployments, so a set written by
 * one branch is read by another that has never heard of `cur`.
 *
 * Emptying the periods makes the mistake unavailable instead of merely
 * discouraged. The result is exactly what these filers produce today — an
 * empty set the page reports as unreadable — with `cur` now recording WHY,
 * which is strictly more than they carry now.
 *
 * NOT AN ERROR, DELIBERATELY. Throwing would leave the symbol needing reverify
 * and re-fetched every day forever for a currency the sources do not carry.
 */
function withoutPeriods(result: ExtractResult): ExtractResult {
  return { ...result, quarters: [], years: [], instants: [] };
}

/**
 * EXTRACTION TO STORED SET, CONVERTING WHEN THE FILER IS NOT A USD REPORTER.
 *
 * ── ONE HOME, BECAUSE THERE ARE TWO CALLERS ──────────────────────────────
 * The cron writes sets and so does the cold path, and they already diverge in
 * what they record (a cold write leaves contentHash null and no manifest
 * entry). A conversion rule copied into both is the shape where one gains a
 * condition and the other does not — the same reasoning that pulled
 * `needsReread` out into secStaleness. So the rule lives here and both call it.
 *
 * ── A FILER WE CANNOT GET RATES FOR IS STORED EMPTY, AND LABELLED ────────
 * See withoutPeriods: the periods are dropped and `cur` is kept, so the page
 * behaves exactly as it does for these filers today while now recording WHY.
 */
export async function toStoredSet(
  extracted: ExtractResult,
  sources: FxSource[] = defaultSources(),
  /**
   * Series already loaded this run, keyed by currency.
   *
   * A run touching twelve euro filers would otherwise pull the same six-year
   * series twelve times. A `null` entry is a REMEMBERED FAILURE and must be
   * distinguished from a missing one, which is why this is checked with
   * `undefined` rather than truthiness.
   */
  seriesCache?: Map<string, FxSeries | null>
): Promise<StoredFactSet> {
  const currency = extracted.reportingCurrency;
  if (currency === "USD") return encodeFactSet(extracted);

  const span = spanOf(extracted);
  // No periods at all, so there is nothing to convert and nothing to mislabel.
  if (!span) return encodeFactSet(extracted);

  let series = seriesCache?.get(currency);
  if (series === undefined) {
    // THE FETCH REACHES BACK PAST THE EARLIEST PERIOD, because a balance-sheet
    // date on a Monday holiday needs the previous week's observation and a
    // window that starts exactly at the earliest date has nothing behind it.
    series = await loadSeries(
      currency,
      isoDaysBefore(span.from, FX_SPOT_BACKFILL_DAYS + 7),
      span.to,
      sources
    );
    seriesCache?.set(currency, series);
  }
  if (!series) return encodeFactSet(withoutPeriods(extracted));

  const { result, conversion } = convertExtractResult(extracted, series);
  return encodeFactSet(result, { conversion, reported: extracted });
}

