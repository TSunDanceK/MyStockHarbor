// Pure helpers for the stored news dataset in newsStore.ts.
//
// SEPARATED FOR TESTABILITY, exactly as historyMerge.ts was split out of
// historyCache.ts in #375. This file imports nothing, reads no env and takes
// time only through arguments, so scripts/check-news-merge.mjs can exercise the
// real module rather than a copy of its logic. newsStore.ts cannot be imported
// without Redis and Next in scope; this can.
//
// It also deliberately does NOT dedup. The similarity dedup from #343
// (dedupeNews in lib/stock-news-data.ts) is already the one implementation of
// that rule and is shared by three modules; reimplementing it here to make it
// testable would create a second copy that can disagree with the first, which
// is a worse failure than the one testability was buying. The caller applies it
// between merge and cap.

/** The fields the merge actually reasons about. Structurally satisfied by NewsItem. */
export type NewsMergeItem = {
  title: string;
  link: string;
  pubDate: string | null;
};

/**
 * How far back before the newest stored article to ask FMP for.
 *
 * NOT PADDING. Fetching strictly from the newest stored timestamp loses any
 * article the source back-dates -- publishes now, stamps earlier -- and that
 * loss is silent and permanent, because the next refresh's window starts later
 * still and never looks at that span again. Six hours is the spec's figure.
 */
export const NEWS_OVERLAP_HOURS = 6;

/**
 * How many articles the store keeps.
 *
 * DEEPER THAN WE DISPLAY, on purpose. The page composes 5 + 10 = 15 AFTER
 * dedup, so a store of exactly 15 comes up short the moment dedup drops three.
 */
export const NEWS_STORE_CAP = 40;

/** The earnings pin's backstop. Replacement is the primary rule; this is the timer. */
export const EARNINGS_PIN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function timeOf(item: NewsMergeItem): number {
  const ms = Date.parse(item.pubDate ?? "");
  return Number.isFinite(ms) ? ms : 0;
}

/** Newest first. Undated articles sort last rather than being dropped. */
export function sortNewestFirst<T extends NewsMergeItem>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => timeOf(b) - timeOf(a));
}

/**
 * The `from=` value for an incremental fetch, or null when there is nothing
 * stored to anchor to (a cold start, which asks for no `from` at all).
 *
 * Returned as a date, not a timestamp: the endpoint takes YYYY-MM-DD, so an
 * overlap that crosses midnight has to widen to the previous day rather than
 * silently truncate to today and lose the span it exists to cover.
 */
export function incrementalFrom(
  newestStoredPubDate: string | null | undefined,
  overlapHours = NEWS_OVERLAP_HOURS
): string | null {
  const ms = Date.parse(newestStoredPubDate ?? "");
  if (!Number.isFinite(ms)) return null;
  return new Date(ms - overlapHours * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Merge a freshly fetched window into what is stored, keyed by link.
 *
 * THE FETCHED COPY WINS on a shared link -- it is the more recent read of the
 * same article, and a source that corrects a headline or backfills a summary
 * should not be overridden by our older copy of it.
 */
export function mergeNewsItems<T extends NewsMergeItem>(
  stored: readonly T[],
  fetched: readonly T[]
): T[] {
  const byLink = new Map<string, T>();

  for (const item of stored) {
    const link = item.link?.trim();
    if (link) byLink.set(link, item);
  }
  for (const item of fetched) {
    const link = item.link?.trim();
    if (link) byLink.set(link, item);
  }

  return sortNewestFirst(Array.from(byLink.values()));
}

/**
 * The article the earnings pin should hold, or null if none qualifies.
 *
 * "Until replaced by a newer qualifying article, or 7 days, whichever comes
 * first": the newest qualifying article IS the pin, so replacement happens by
 * simply re-selecting. The age check is the backstop for the case where nothing
 * newer has qualified in a week -- at which point the pin has stopped being
 * news and holding it would misrepresent a stale article as current coverage.
 */
export function selectEarningsPin<T extends NewsMergeItem>(
  items: readonly T[],
  isQualifying: (item: T) => boolean,
  nowMs: number
): T | null {
  let best: T | null = null;
  let bestMs = -Infinity;

  for (const item of items) {
    if (!isQualifying(item)) continue;
    const ms = timeOf(item);
    // An undated article cannot be aged out, so it cannot be trusted to expire
    // and is not eligible to be pinned.
    if (!ms) continue;
    if (ms > bestMs) {
      best = item;
      bestMs = ms;
    }
  }

  if (!best) return null;
  return nowMs - bestMs <= EARNINGS_PIN_MAX_AGE_MS ? best : null;
}

/**
 * Keep the newest `cap` articles, except that the pin always survives.
 *
 * THE PIN IS WHY THIS IS NOT JUST A SLICE. Persistence is the entire point of
 * the pin -- today an earnings article vanishes the moment it leaves FMP's
 * latest-N window regardless of relevance -- so an eviction that can drop it
 * reintroduces exactly the bug the pin exists to fix. When the pin has aged out
 * of the newest `cap`, it displaces the oldest ordinary article rather than
 * extending the store past its cap.
 */
export function capNews<T extends NewsMergeItem>(
  items: readonly T[],
  pin: T | null,
  cap = NEWS_STORE_CAP
): T[] {
  const ordered = sortNewestFirst(items);
  if (ordered.length <= cap) return ordered;

  const kept = ordered.slice(0, cap);
  if (!pin) return kept;

  const pinLink = pin.link?.trim();
  if (!pinLink || kept.some((item) => item.link?.trim() === pinLink)) return kept;

  kept[kept.length - 1] = pin;
  return sortNewestFirst(kept);
}

/** How many of `merged` were not already in `stored`. Zero is healthy on a quiet hour. */
export function countAdded<T extends NewsMergeItem>(
  stored: readonly T[],
  merged: readonly T[]
): number {
  const before = new Set(stored.map((item) => item.link?.trim()).filter(Boolean));
  let added = 0;
  for (const item of merged) {
    const link = item.link?.trim();
    if (link && !before.has(link)) added += 1;
  }
  return added;
}
