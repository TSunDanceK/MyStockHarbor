// How many bullish conditions a stock meets. ONE implementation.
//
// Three byte-identical copies of getBuySignalCount shipped -- in
// PickerResultPage.tsx, PickersClient.tsx and DashboardTicker.tsx. Identical
// today, so no live bug; add a tenth condition to one and the dashboard ticker
// and the picker page silently disagree about the same stock on the same day
// (claude/traps/two-validators-for-one-value.md).
//
// THE RULES THEMSELVES ARE NOT TOUCHED. Which conditions count, and the
// aboveMA200 gate, are a product question parked with the owner. This is a
// deduplication and nothing else -- the arithmetic below is the picker page's
// existing implementation, moved.
//
// STRUCTURAL INPUT, not an imported SignalRecord. The three call sites carry
// three different record types (the picker page's full SignalRecord, the
// dashboard's SignalRecordLite), and importing any one of them here would drag a
// server-side type into a client bundle and couple the three files to each
// other. Every field is optional because the lite record genuinely omits some,
// and an absent flag is false for counting purposes -- the same reading the
// three copies already gave it.
export type BuySignalFlags = {
  aboveMA200?: boolean;
  oversold?: boolean;
  buyTheDip?: boolean;
  breakout?: boolean;
  volumeSpike?: boolean;
  atrSpike?: boolean;
  aboveMA50?: boolean;
  bullishRsiDivergence?: boolean;
  bullishMacdDivergence?: boolean;
};

/**
 * Bullish conditions met, 0-9.
 *
 * Gated on aboveMA200: a stock below its 200-day scores 0 regardless of what
 * else it meets. That gate is why a page can show "0 of 9" for a stock that
 * visibly satisfies several conditions, and it is deliberate in the original --
 * preserved here exactly, not reasoned about.
 */
export function getBuySignalCount(record: BuySignalFlags): number {
  if (!record.aboveMA200) return 0;
  let count = 0;
  if (record.oversold) count += 1;
  if (record.buyTheDip) count += 1;
  if (record.breakout) count += 1;
  if (record.volumeSpike) count += 1;
  if (record.atrSpike) count += 1;
  if (record.aboveMA50) count += 1;
  if (record.aboveMA200) count += 1;
  if (record.bullishRsiDivergence) count += 1;
  if (record.bullishMacdDivergence) count += 1;
  return count;
}

// ---------------------------------------------------------------------------
// getSellSignalCount is NOT here, and that is a finding rather than an omission.
//
// The three copies are NOT identical. DashboardTicker.tsx opens with
//
//     if (!r.belowMA200) return 0;
//
// and PickerResultPage.tsx and PickersClient.tsx do not. So a stock that is
// overbought and below its MA50 but NOT below its MA200 scores 2 on the picker
// pages and 0 on the dashboard ticker -- today, on live data, for the same stock
// at the same moment.
//
// Collapsing them would mean picking a winner, and that is a change to the rules
// rather than a deduplication. The rules are parked with the owner, so the sell
// counter stays as three copies until that decision is made -- deliberately, and
// recorded here so the asymmetry with the buy counter is not read as an
// oversight.
//
// Worth noting for whoever decides: the dashboard's version mirrors the buy
// counter's aboveMA200 gate exactly. That reads like the intended shape, with
// the other two having been written without it -- but "reads like" is not
// evidence, and the two behaviours have been live side by side long enough that
// either could be the one people expect.
