/**
 * ── BLOCKS ON /stock/[symbol] THAT ARE HIDDEN, NOT REMOVED ────────────────
 *
 * The owner's standing rule, in the same shape as RETIRED_SOURCES in
 * lib/server/secEarningsView.ts and HIDDEN_PROFILE_ROWS in
 * app/components/CompanyProfile.tsx. Deleting a block loses the record of WHY,
 * and the next person to look at a gap in the page re-adds it, wires it to
 * whatever is nearest, and ships an empty one.
 *
 * NOT IN lib/server. StockSymbolPageClient.tsx is a "use client" module, so
 * anything it imports is bundled for the browser and must not reach for a
 * server-only module. This file has no imports at all, which is what lets the
 * client component and a check script read the same registry.
 *
 * WHAT A HIDDEN BLOCK RENDERS: nothing. Not a dashed placeholder, not a
 * sentence explaining the absence. That reversal was already made on the
 * earnings page (see the docblock on HiddenCard in
 * app/stock/[symbol]/earnings/SecEarningsCards.tsx): a page carrying apology
 * cards about analyst consensus reads as broken rather than honest, and a
 * reader who never had the feature is not owed a notice of its removal.
 *
 * THE ATTRIBUTION GOES WITH THE BLOCK. Each entry names the "provided by
 * Financial Modeling Prep" line that lived inside it, because
 * claude/fmp-provider-attribution-inventory-2026-09-12.md §4-§7 is explicitly
 * about the failure of hiding a block and leaving its source note behind: an
 * explanation rendered for data that is not there.
 */

/**
 * Every guardable block on this page, hidden or not.
 *
 * ── WHY A UNION AND NOT A STRING ──────────────────────────────────────────
 * The first draft had `isRetiredBlock(id: string)` throw on an unknown id, to
 * catch the typo that matters: guard a section with "analyst-rating" —
 * singular — and it renders exactly as before while every reader of this file
 * believes it is hidden. A throw does catch that, but only at render, and it
 * buys the catch by making the registry unable to express the normal case:
 * deleting an entry to bring a block BACK would throw instead of un-hiding it.
 *
 * A union does both jobs and neither costs anything at runtime. A misspelled
 * id fails `tsc`, so it cannot ship; and RETIRED_BLOCKS stays a plain list
 * whose membership is the only thing deciding what renders, so removing an
 * entry restores the block and nothing else has to change.
 */
export type StockBlockId = "analyst-ratings" | "valuation-multiples";

export type RetiredBlock = {
  id: StockBlockId;
  /** The heading a reader used to see. */
  label: string;
  /** What used to supply it. */
  source: string;
  /** When it stopped rendering. */
  retiredOn: string;
  /** Why, in one sentence. */
  reason: string;
  /**
   * The attribution string that lived inside the block and went dark with it.
   * Null where the block carried none.
   */
  attribution: string | null;
};

export const RETIRED_BLOCKS: RetiredBlock[] = [
  {
    id: "analyst-ratings",
    label: "Analyst consensus, price targets and rating breakdown",
    // Corrected 2026-09-23 (#552 COWORK #1): the route called price-target-consensus,
    // not price-target-summary. The route itself is deleted (it was still publicly
    // reachable and metered); un-retiring this block needs a new source anyway.
    source: "FMP /stable/price-target-consensus + /grades-consensus, via /api/stock-analyst-rating (route deleted 2026-09-23)",
    retiredOn: "2026-09-21",
    reason:
      "Analyst ratings and price targets are a vendor consensus, not a filed figure. " +
      "The SEC publishes nothing equivalent and no free source covers them, so the " +
      "block has no successor to move to.",
    attribution:
      "Analyst ratings and price targets are provided by Financial Modeling Prep when available.",
  },
  // `valuation-multiples` is deliberately ABSENT from this list and present in
  // StockBlockId. The P/E, P/S, P/B and EV/EBITDA grid still renders: its
  // figures are ratios over filed fundamentals and a live price, both of which
  // survive the FMP exit, so it is a source swap rather than a hide (see
  // lib/server/secValuation.ts, which already rebuilds these off SEC facts for
  // the earnings page). Naming it in the union and not here is what lets the
  // guard below say "this one is not hidden" as a fact rather than a silence.
];

const RETIRED_BLOCK_IDS = new Set<StockBlockId>(RETIRED_BLOCKS.map((b) => b.id));

/**
 * Whether this block is registered as hidden. The call sites read
 * `isRetiredBlock("analyst-ratings") ? null : (<section>…</section>)`, so the
 * JSX stays in the file — hidden, not removed — and the registry alone decides
 * whether a reader sees it.
 */
export const isRetiredBlock = (id: StockBlockId): boolean => RETIRED_BLOCK_IDS.has(id);

/** The registry entry, for a check or a probe that needs the reason text. */
export const retiredBlock = (id: StockBlockId): RetiredBlock | null =>
  RETIRED_BLOCKS.find((b) => b.id === id) ?? null;
