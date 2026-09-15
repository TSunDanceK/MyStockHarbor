// The preset universe: the ~100 largest US companies by market cap.
//
// SINGLE SOURCE OF TRUTH. This list previously existed as four byte-identical
// copies -- one each in pickersBuilder, playsBuilder, bullFlagsBuilder and
// descendingTrianglesBuilder -- with nothing keeping them in step. Adding or
// removing a name meant remembering to edit four files in three different
// directories, and any drift between them would have been silent: the pickers
// screener and the plays pages would simply have disagreed about which
// mega-caps are guaranteed a slot, with no error anywhere.
//
// Verified identical in CONTENT AND ORDER across all four before consolidating,
// so this change is behaviour-preserving by construction. Order matters and is
// preserved exactly: pickersBuilder fills guaranteed slots with
// `fillSlots(PRESET_UNIVERSE, PRESET_UNIVERSE.length)`, and the three plays
// builders spread it into a priority list that is then sliced to their cap --
// both are order-sensitive.
//
// NOT the same list as `lib/curatedSymbols.ts` (SEO/internal-linking only, and
// deliberately separate -- different job, different lifecycle) or
// `symbolSearch.ts`'s POPULAR_SYMBOLS (a search-ranking nudge). See
// claude/universe-architecture-audit-2026-08-06.md for the full map of every
// symbol list on the site and why these three stay distinct.

// TWO TICKER RENAMES, CORRECTED BY HAND 2026-09-11, because that is what the
// #404 rule routes a preset to rather than deleting it.
//
// warm-screener-fundamentals logged `presetNeedsHandEdit MMC, FI`: both had
// stopped receiving daily bars (MMC last bar 2026-02-09, ~152 trading days;
// FI last bar 2025-12-08, ~197). Neither was delisted, acquired or in any
// trouble -- both simply changed ticker, and FMP kept serving the retired
// symbol for about four weeks after each change before going quiet:
//
//   MMC -> MRSH   2026-01-14, NYSE, with the rebrand to Marsh
//   FI  -> FISV   2025-11-11, NYSE -> Nasdaq, reinstating the original ticker
//
// THIS IS THE CASE THE HAND-EDIT ALARM EXISTS FOR, and it is worth recording
// that it worked: both are live S&P 500 mega-caps, and an eviction path that
// treated "no new bars" as "delisted" would have silently removed two of them
// from the guaranteed slots. The alarm raised them instead and a human checked.
export const PRESET_UNIVERSE: string[] = [
  "AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","BRK.B","AVGO","LLY",
  "JPM","V","UNH","XOM","PG","MA","COST","HD","MRK","ABBV",
  "CRM","NFLX","ORCL","BAC","KO","PEP","ADBE","TMO","WMT","CSCO",
  "ACN","MCD","ABT","CVX","LIN","AMD","NKE","DHR","TXN","INTC",
  "QCOM","PM","IBM","NOW","SBUX","CAT","GE","AMAT","LOW","UBER",
  "PANW","PLTR","SHOP","MU","KLAC","LRCX","ANET","SNOW","CRWD","MELI",
  "ASML","APH","DE","PGR","VRTX","ADP","INTU","CMCSA","COP","AXP",
  "BKNG","AMGN","HON","ISRG","TJX","SYK","UNP","GILD","MDT","ADI",
  "CB","C","MO","GS","ETN","MRSH","TMUS","CI","SO","DUK",
  "ELV","SCHW","BLK","REGN","FISV","TT","PH","PYPL","CDNS","MAR",
  // ── ARM, ADDED 2026-09-15, AND APPENDED RATHER THAN RANKED ────────────────
  //
  // WHY IT IS HERE. ARM was in NEITHER this list nor the dynamic pool, so it
  // had no manifest entry, no CIK and no way to populate -- and its /earnings
  // page would have read "not loaded yet" indefinitely. It is the symbol the
  // whole earnings rebuild was audited against: every probe, every render
  // check and the fiscal-label fix all used it. Leaving the reference symbol
  // unreachable was an accident, not a decision.
  //
  // THE ALTERNATIVE WAS THE LAZY COLD PATH, and it is step 8 -- explicitly
  // DECIDED BUT NOT SCHEDULED (claude/cold-path-and-coverage-decisions), sitting
  // behind step 3, the population path, the verify sweep and the ticker gate.
  // Making the audited symbol depend on unbuilt work is the worse of the two.
  //
  // APPENDED, WHICH BREAKS THIS LIST'S ORDERING INVARIANT ON PURPOSE. The
  // header says "largest by market cap" and order is load-bearing: pickersBuilder
  // fills slots from it and the three plays builders slice a priority list built
  // from it. Inserting ARM at its real rank would shift ~40 names down one and
  // could push the last out of a slice at exactly 100. Appending changes nothing
  // for any existing name. So ARM's POSITION HERE IS NOT ITS MARKET-CAP RANK,
  // and a future re-sort should place it properly rather than assume it is
  // already right.
  //
  // COST: tier1CapFor() derives the fast price tier from this list's LENGTH, so
  // the tier grows by exactly one slot. check-price-tiers asserts a 50-400 band
  // rather than a pinned 100, and reads the length from the shipped list, so
  // both stay correct. Reversible in one line.
  "ARM",
];
