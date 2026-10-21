// ONE PRICE, ONE LABEL, ON THE EARNINGS PAGE (audit r3 item 5).
//
// The page's title printed the last completed EOD close while the valuation
// card's market cap and P/E used the newer of that close and today's IEX
// trade, so the two could disagree by a few percent (CAVA −3.0%, GILD −2.3%,
// SO +2.0%, JNJ −1.7%) with nothing on screen to say why. Both now read the
// same price and describe it with the words below, so they cannot drift:
//
//   "Price: close, 20 Oct 2026"    the stored EOD close
//   "Price: last trade 14:05 ET"   today's session print (IEX, one venue)
//
// Pure, and free of server imports, so the card and the title share it.

export type PriceBasis = {
  /** "close": a completed day's close; "trade": a print during today's session. */
  kind: "close" | "trade";
  /** The ET trading day the price belongs to, YYYY-MM-DD. */
  date: string;
  /** "HH:MM" ET for a trade, where the source says; null otherwise. */
  time: string | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "20 Oct 2026" from YYYY-MM-DD. */
function readableDay(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** What the price is, without the "Price:" lead: "close, 20 Oct 2026" / "last trade 14:05 ET". */
export function priceBasisWords(b: PriceBasis): string {
  if (b.kind === "close") return `close, ${readableDay(b.date)}`;
  // A trade with no time the source states is dated rather than timed.
  return b.time ? `last trade ${b.time} ET` : `last trade, ${readableDay(b.date)}`;
}

/** The label itself: "Price: close, 20 Oct 2026" / "Price: last trade 14:05 ET". */
export function priceBasisLabel(b: PriceBasis): string {
  return `Price: ${priceBasisWords(b)}`;
}

/** The hedge printed beside the label: what a last trade is, and that either can lag. */
export const PRICE_BASIS_NOTE =
  "The page title and these figures use this same price. A last trade comes from a single exchange (IEX), so it can differ slightly from the consolidated price, and either may lag the market.";
