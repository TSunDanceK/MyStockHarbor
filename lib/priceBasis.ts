// THE VALUATION CARD'S PRICE, LABELLED (audit r3 item 5).
//
// The card's market cap and P/E use the newer of the last EOD close and
// today's session IEX print, while the page title prints the last completed
// close (owner ruling: stable for crawlers, no hourly title churn). Intraday
// the two differ by a few percent (CAVA −3.0%, GILD −2.3%, SO +2.0%, JNJ
// −1.7%), so the card says which price it used:
//
//   "Price: close, 20 Oct 2026"    the stored EOD close
//   "Price: last trade 14:05 ET"   today's session print (IEX, one venue)
//
// Pure, and free of server imports. Its private names are prefixed: the render
// harness lifts this file into one unit with the view's modules
// (scripts/lib/render-cards.mjs).

export type PriceBasis = {
  /** "close": a completed day's close; "trade": a print during today's session. */
  kind: "close" | "trade";
  /** The ET trading day the price belongs to, YYYY-MM-DD. */
  date: string;
  /** "HH:MM" ET for a trade, where the source says; null otherwise. */
  time: string | null;
};

export const BASIS_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "20 Oct 2026" from YYYY-MM-DD. */
function basisDay(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${BASIS_MONTHS[Number(m) - 1]} ${y}`;
}

/** What the price is, without the "Price:" lead: "close, 20 Oct 2026" / "last trade 14:05 ET". */
export function priceBasisWords(b: PriceBasis): string {
  if (b.kind === "close") return `close, ${basisDay(b.date)}`;
  // A trade with no time the source states is dated rather than timed.
  return b.time ? `last trade ${b.time} ET` : `last trade, ${basisDay(b.date)}`;
}

/** The label itself: "Price: close, 20 Oct 2026" / "Price: last trade 14:05 ET". */
export function priceBasisLabel(b: PriceBasis): string {
  return `Price: ${priceBasisWords(b)}`;
}

/** The hedge printed beside the label: what a last trade is, and that either can lag. */
export const PRICE_BASIS_NOTE =
  "Market cap and P/E use this price. A last trade comes from a single exchange (IEX), so it can differ slightly from the consolidated price, and either may lag the market. The page title shows the last completed close.";
