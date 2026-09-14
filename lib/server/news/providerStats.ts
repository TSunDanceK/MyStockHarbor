// Which adapters actually CONTRIBUTED today, as opposed to which are registered.
//
// ── WHY THIS IS ITS OWN FILE ───────────────────────────────────────────────
// Split out of newsStore.ts for the same reason newsMerge.ts and filingChurn.ts
// were: newsStore imports Redis and next/server, so nothing in it can be loaded
// and RUN by a harness. The first version of this logic lived there and its
// assertions were greps — which duly passed against code that collapsed all
// three states into one, because the strings they grepped for were still
// present in the type declaration above the bug. Three mutations survived. An
// assertion that can only read the source can only ever check spelling.
//
// This file imports nothing, so scripts/check-news-store.mjs executes the real
// function against all three inputs instead.
//
// ── THE THREE ZEROES, AND WHY COLLAPSING ANY TWO IS A LIE ──────────────────
// /cache-health read "gnews + wire + sec" for two days while GlobeNewswire was
// being tarpitted and returning nothing whatsoever. That line was not wrong —
// all three ARE registered — it just could not tell a working adapter from a
// silent one, and the silent one threw nothing, logged nothing, and never
// settled (claude/wire-egress-verdict-2026-09-14.md). A count is the only thing
// that can tell them apart.
//
// But a count has three ways of being zero and only ONE of them is an alarm:
//
//   unavailable   Redis is absent. Nothing was counted, so nothing is known.
//   idle          Redis answered; no refresh has run today. Nothing to count.
//   ok + 0        The adapter WAS asked today and brought back nothing.
//
// Only the third is a fault. Render the first two as zero and the panel cries
// wolf every morning before the first refresh and in every environment without
// credentials — and a warning that is usually wrong is a warning nobody reads,
// which would retire the one true alarm this exists to raise.

/** Stats-hash field prefix. Namespaced so a provider named `itemsAdded` cannot collide. */
export const PROVIDER_STAT_PREFIX = "provider:";

export type NewsProviderStats =
  | { status: "unavailable" }
  | { status: "idle" }
  | { status: "ok"; counts: Record<string, number> };

/**
 * The raw stats hash -> one of the three states above.
 *
 * Pure and total: null in, "unavailable" out; no provider fields, "idle" out.
 * `found` counts FIELDS, not their values, because an adapter sitting at zero is
 * precisely the signal worth keeping — treating a hash of all-zeroes as "idle"
 * would hide the only case that matters.
 */
export function classifyProviderStats(
  stats: Record<string, number> | null | undefined
): NewsProviderStats {
  if (!stats) return { status: "unavailable" };

  const counts: Record<string, number> = {};
  let found = 0;
  for (const [field, value] of Object.entries(stats)) {
    if (!field.startsWith(PROVIDER_STAT_PREFIX)) continue;
    counts[field.slice(PROVIDER_STAT_PREFIX.length)] = Number(value) || 0;
    found += 1;
  }

  return found ? { status: "ok", counts } : { status: "idle" };
}
