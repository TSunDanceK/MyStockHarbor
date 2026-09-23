// The sector news window on the free stack, as pure functions.
//
// ADDED 2026-09-23 (#553 COWORK #1). lib/sector-news-data.ts called FMP's
// stock-news endpoint for a sector's constituents directly, outside
// NEWS_PROVIDER, so the step-7 flip never reached /sector/[slug]/news. Spec §4
// defines the replacement: "the union of the sector's constituent per-symbol
// stores, deduped". sector-news-data.ts does the I/O (one MGET of the stores,
// the shared wire poll); everything that decides WHAT is shown lives here, and
// IMPORTS NOTHING, so scripts/check-sector-news-off-fmp.mjs runs the real code.
import type { NewsItem } from "./types";

/**
 * The tickers an item is attributed to: `fmpSymbols` on FMP items, `tickers`
 * on every free adapter's items. Reading only the first blanks the ticker pills
 * and mention counts after the flip -- the sector page's own primarySymbol
 * already learned this (app/sector/[slug]/news/page.tsx).
 */
export function attributedSymbols(item: NewsItem): string[] {
  return [...(item.fmpSymbols ?? []), ...(item.tickers ?? [])];
}

/**
 * Whether an item came from a provider that is active NOW.
 *
 * THE FILTER THAT KEEPS FMP ARTICLES OFF THE PAGE after the switch. The sector
 * store (msh:sector-news:v1:<slug>) and older per-symbol records still hold
 * items fetched from FMP; the store keeps them until newer items push them past
 * its cap. Every free adapter stamps `provider`, and the old sector fetch never
 * did, so on the free stack an unstamped item is FMP-era and fails closed.
 * Under the NEWS_PROVIDER=fmp rollback everything passes, exactly as before.
 */
export function isFromActiveProvider(
  item: NewsItem,
  activeIds: ReadonlySet<string>,
  mode: "free" | "fmp"
): boolean {
  if (mode === "fmp") return true;
  return typeof item.provider === "string" && activeIds.has(item.provider);
}

/**
 * The free window: each constituent's stored items (active providers only,
 * attributed to that constituent) plus wire items tagged with a constituent.
 *
 * A constituent with no stored record contributes nothing: its record is
 * written when its own news page is first viewed (the lazy-population rule of
 * the stored-dataset design), so a thin sector can show fewer cards than it
 * did on FMP. Merging, dedup and the cap happen in the caller and the store.
 */
export function composeFreeSectorPools(
  symbols: string[],
  stored: ReadonlyMap<string, NewsItem[]>,
  wire: NewsItem[],
  activeIds: ReadonlySet<string>
): NewsItem[][] {
  const constituentSet = new Set(symbols.map((s) => s.toUpperCase()));
  const pools: NewsItem[][] = [];

  for (const [symbol, items] of stored) {
    if (!constituentSet.has(symbol)) continue;
    pools.push(
      items
        .filter((item) => isFromActiveProvider(item, activeIds, "free"))
        // The record is this constituent's by construction; say so, so the
        // pill and the mention count can find it on an item whose adapter
        // attributed nothing.
        .map((item) =>
          attributedSymbols(item).includes(symbol)
            ? item
            : { ...item, tickers: [...(item.tickers ?? []), symbol] }
        )
    );
  }

  pools.push(
    wire.filter(
      (item) =>
        isFromActiveProvider(item, activeIds, "free") &&
        (item.tickers ?? []).some((t) => constituentSet.has(t))
    )
  );
  return pools;
}
