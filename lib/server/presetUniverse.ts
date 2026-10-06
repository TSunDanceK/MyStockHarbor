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
// ARM WAS ADDED HERE ON 2026-09-15 AND REMOVED THE SAME DAY. Worth one note,
// because the reasoning changed rather than the facts.
//
// It was added because it had no manifest entry, no CIK and therefore no
// earnings page at all, and the only alternative on the table -- the lazy cold
// path -- was step 8 and unscheduled. The cold path then moved ahead of step 8
// and shipped (lib/server/secColdFetch.ts), so an off-universe symbol now
// fetches its own data on first render. ARM needs no entry here to have a page,
// and it is not a top-100 US company by market cap, which is what this list is.
//
// The general point: a symbol does NOT need to be in this list to have a
// working page any more. Add names here because they belong in the guaranteed
// mega-cap slots, not to make a page work.
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
];
