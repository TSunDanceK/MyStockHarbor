import { getPickersData } from "./pickersBuilder";
import { readDynamicUniverse } from "./dynamicUniverseCache";

// Single source of truth for "which symbols do the background warm jobs
// maintain data for" -- used by warm-price-pool, warm-stock-data and
// warm-fundamentals so the three can never drift apart.
//
// WHY A UNION, NOT A REPLACEMENT
// ------------------------------
// All three jobs previously took their work list from `payload.signalRecords`
// -- the symbols the last pickers build actually analyzed. That is the set the
// site DISPLAYS, so it must stay covered: drop a symbol from here and its
// price, PE, market cap and valuation columns go blank on a page that is
// currently rendering it.
//
// But it is not the set the site will display NEXT build. The dynamic universe
// is the rolling candidate pool, and a symbol that rotates into the scan having
// never been warmed arrives completely cold -- no price, no fundamentals, no
// extended data -- and stays that way until the next daily fundamentals run.
// That is precisely the failure mode that raising UNIVERSE_CAP and adding scan
// rotation would otherwise create.
//
// So it must be BOTH:
//   signalRecords      -> what is on screen now. Never drop these.
//   dynamic universe   -> what could be on screen next. Warm them in advance.
//
// Replacing rather than unioning would be an outright regression, and not an
// obvious one: PRESET_UNIVERSE's ~100 mega-caps are guaranteed slots in the
// pickers scan but are NOT necessarily members of the dynamic universe (that
// pool is fed by market discovery and search demand). Point the warm jobs at
// the dynamic universe alone and AAPL/MSFT/NVDA can silently lose their pooled
// price and PE while still being displayed on every screener page.
//
// COST
// ----
// The union is roughly 1.5-1.7x signalRecords alone (~260 -> ~400-450 today).
// Each job absorbs that differently:
//   * warm-price-pool  -- self-sizing. Its slice is ceil(universe/4), so full
//     price coverage stays at ~12 min regardless; only the per-run call count
//     rises (~89 -> ~113). Comfortably inside the 300/min guard.
//   * warm-stock-data  -- FIXED slice of 25/run, so full coverage time scales
//     linearly: ~1.7h -> ~3h. Acceptable for valuation/dividend/analyst data
//     that moves daily at most, but it is a real stretch, not free.
//   * warm-fundamentals -- daily, industry capped at 120 misses/run, so a newly
//     discovered symbol may wait a few days for its industry/sector. Already
//     true before this change; the larger pool extends the tail.

/**
 * Symbols the background jobs should keep warm: everything the last pickers
 * build analyzed, plus the whole rolling dynamic universe.
 *
 * Fail-open on the dynamic-universe read -- if it errors or returns nothing we
 * still return the displayed set, which is exactly the previous behaviour. The
 * jobs must never end up with an empty work list because a secondary read
 * failed.
 */
export async function getWarmTargetSymbols(base: string): Promise<{
  symbols: string[];
  displayed: number;
  universe: number;
}> {
  const payload = await getPickersData(base);
  const displayed = Array.from(
    new Set((payload.signalRecords ?? []).map((r) => r.symbol).filter(Boolean))
  );

  let universeSymbols: string[] = [];
  try {
    universeSymbols = (await readDynamicUniverse()).map((entry) => entry.symbol).filter(Boolean);
  } catch {
    // fail open -- fall back to displayed-only, i.e. the pre-change behaviour
  }

  const symbols = Array.from(new Set([...displayed, ...universeSymbols]));

  return { symbols, displayed: displayed.length, universe: universeSymbols.length };
}
