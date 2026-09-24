// Is this stored news item from a provider that is active NOW?
//
// ADDED 2026-09-23 (Relay B, #553 COWORK #5): the owner's ruling is that no FMP
// data stays cached -- FMP's terms require cached data to be deleted, not left to
// age out. The per-symbol news records (msh:news:v1:<SYM>) were written by the
// FMP adapter until the 14 Sep flip, and the store keeps items up to its cap, so
// FMP-era articles were still inside the 45-day display window.
//
// THE RULE: on the free stack an item passes only if its `provider` is one of
// the active adapters. Every free adapter stamps `provider`; the FMP paths did
// not always, so an UNSTAMPED item is FMP-era and fails closed. Under the
// NEWS_PROVIDER=fmp rollback everything passes, exactly as before.
//
// The sector feed (lib/server/news/sectorWindow.ts, PR #558) applies the same
// rule to its own store; once both are on main that module can import this one.
//
// IMPORTS NOTHING (types only), so scripts/check-news-purge.mjs runs the real code.
import type { NewsItem } from "./types";

export function isFromActiveProvider(
  item: Pick<NewsItem, "provider">,
  activeIds: ReadonlySet<string>,
  mode: "free" | "fmp"
): boolean {
  if (mode === "fmp") return true;
  return typeof item.provider === "string" && activeIds.has(item.provider);
}
