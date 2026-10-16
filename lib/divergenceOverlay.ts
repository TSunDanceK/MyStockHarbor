// WHICH INDICATOR PANEL A DIVERGENCE CARD DRAWS (#553).
//
// The bug: a Bullish RSI Divergence card drew a MACD panel whenever any other
// condition the stock happened to qualify for ("also qualifies" text in
// `entry.reasons`) mentioned MACD, because the card's text was searched for
// "macd" before "rsi". OLLI, UNH, ADSK, GIB and PSA showed MACD on that page.
//
// The rule, in the order it is applied:
//   1. A page that is ONE kind of divergence (bullish/bearish RSI divergence ->
//      rsi; bullish/bearish MACD divergence -> macd) decides from the page alone.
//   2. Otherwise, when the Screener sidebar's active conditions name ONE kind
//      (Bullish RSI Divergence ticked, and no MACD divergence), that decides,
//      wherever the visitor is (the Advanced Screener, a sector page, ...).
//   3. Only a page or a selection that MIXES both kinds decides per card, and
//      then only from the card's OWN divergence signal: its badge (the
//      timeframe and indicator the divergence was found on) and its divergence
//      flags. Never `reasons`, `note` or any "also qualifies" text.
//   4. Nothing says "divergence": null, and the caller carries on with its
//      other page rules.
import type { AnyFilterKey } from "@/lib/pickerFilters";

export type DivergenceIndicator = "rsi" | "macd";

const RSI_KEYS: readonly string[] = ["bullishRsiDivergence", "bearishRsiDivergence"];
const MACD_KEYS: readonly string[] = ["bullishMacdDivergence", "bearishMacdDivergence"];

/** The card's own divergence fields, and nothing else of it. */
export type DivergenceCard = {
  badge?: string;
  bullishRsiDivergence?: boolean;
  bearishRsiDivergence?: boolean;
  bullishMacdDivergence?: boolean;
  bearishMacdDivergence?: boolean;
};

/** The indicator a divergence page is about by its route, "both" for the combined page, null for a page that is not a divergence page. */
export function divergencePageKind(configHref: string): DivergenceIndicator | "both" | null {
  const href = configHref.toLowerCase();
  if (!href.includes("divergence")) return null;
  if (href.includes("rsi-divergence")) return "rsi";
  if (href.includes("macd-divergence")) return "macd";
  return "both";
}

/** Which divergence kinds the sidebar's ticked conditions name. */
export function divergenceKindsSelected(selectedFilters: readonly AnyFilterKey[]): { rsi: boolean; macd: boolean } {
  return {
    rsi: selectedFilters.some((key) => RSI_KEYS.includes(key)),
    macd: selectedFilters.some((key) => MACD_KEYS.includes(key)),
  };
}

/** The card's own indicator: its badge ("D · RSI(14)"), else its divergence flags. Both on one card is MACD, as the builder's badge says. */
export function ownDivergenceIndicator(card: DivergenceCard): DivergenceIndicator | null {
  const badge = (card.badge ?? "").toLowerCase();
  const badgeMacd = badge.includes("macd");
  const badgeRsi = badge.includes("rsi");
  if (badgeMacd !== badgeRsi) return badgeMacd ? "macd" : "rsi";
  const macd = !!(card.bullishMacdDivergence || card.bearishMacdDivergence);
  const rsi = !!(card.bullishRsiDivergence || card.bearishRsiDivergence);
  if (macd) return "macd";
  if (rsi) return "rsi";
  return null;
}

/** The indicator panel for a divergence view, or null when this is not one. */
export function divergenceOverlay(
  configHref: string,
  selectedFilters: readonly AnyFilterKey[],
  card: DivergenceCard
): DivergenceIndicator | null {
  const page = divergencePageKind(configHref);
  if (page === "rsi" || page === "macd") return page;

  const picked = divergenceKindsSelected(selectedFilters);
  if (picked.rsi !== picked.macd) return picked.rsi ? "rsi" : "macd";

  if (page === "both" || (picked.rsi && picked.macd)) return ownDivergenceIndicator(card);
  return null;
}
