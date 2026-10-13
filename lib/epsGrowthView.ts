// THE "EPS GROWTH (YoY)" COLUMN AND ORDER ON /stocks-with-strong-earnings-growth
// (#553 COWORK #178, ruled in COWORK #186 ruling 1).
//
// Pure, no imports: the build orders the section with it and the client grid
// renders and sorts the column with it, so the two cannot disagree.
//
//   ranked     every member whose year-ago EPS is at least SMALL_BASE_PRIOR_EPS,
//              by EPS growth %, highest first
//   small base members whose year-ago EPS is under SMALL_BASE_PRIOR_EPS go
//              BELOW the ranked list, by the $ change, largest first: off a
//              few cents a % says little (+2,913% was a 7-cent base; TWLO's +4,671%
//              came off a base under 50 cents), so the
//              cell shows the change in dollars instead
//   no figure  rows with no growth figure (not members) go last, A-Z
//
// The membership rule is unchanged (pickersSecEarningsGrowth: +15% and
// revenue up; the stricter cut was not approved).

/**
 * Year-ago diluted EPS under this, in dollars, is a small base. $0.50 by the
 * owner's ruling (#553 COWORK #195, 2026-10-07; it was $0.10): on the live
 * build TWLO read +4,671%, BCE +3,672% and AFRM +3,587%, each off a year-ago
 * EPS above $0.10 but still too small for a % to say much. Display only: the
 * list's membership is unchanged.
 */
export const SMALL_BASE_PRIOR_EPS = 0.5;

export type EpsGrowthView = {
  /** EPS growth, percent, rounded as the membership rule rounds it. */
  pct: number;
  /** "Q2 FY2026" / "FY2025", and the year-ago period's. */
  label: string;
  priorLabel: string;
  basis: "quarter" | "year";
  /** Year-ago EPS under SMALL_BASE_PRIOR_EPS. */
  small: boolean;
  /** EPS change in dollars (reporting currency), for the small-base cell. */
  change: number;
};

export function epsGrowthView(g: { eps: number; epsPrior: number; label: string; priorLabel: string; basis: "quarter" | "year" }, pct: number): EpsGrowthView {
  return {
    pct,
    label: g.label,
    priorLabel: g.priorLabel,
    basis: g.basis,
    small: g.epsPrior < SMALL_BASE_PRIOR_EPS,
    change: Math.round((g.eps - g.epsPrior) * 100) / 100,
  };
}

/**
 * The page's order: ranked by %, then the small-base group by $ change, then
 * no figure, A-Z within each tie. Negative = a first.
 */
export function compareEpsGrowth(
  a: { symbol: string; epsGrowth?: EpsGrowthView | null },
  b: { symbol: string; epsGrowth?: EpsGrowthView | null }
): number {
  const ga = a.epsGrowth ?? null;
  const gb = b.epsGrowth ?? null;
  const tier = (g: EpsGrowthView | null) => (g === null ? 2 : g.small ? 1 : 0);
  return (
    tier(ga) - tier(gb) ||
    (ga && gb ? (ga.small ? gb.change - ga.change : gb.pct - ga.pct) : 0) ||
    a.symbol.localeCompare(b.symbol)
  );
}

const signedPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
const signedUsd = (v: number) => `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(2)}`;

/** What the cell shows. */
export function epsGrowthText(g: EpsGrowthView): string {
  return g.small ? signedUsd(g.change) : signedPct(g.pct);
}

/** The tap note: the periods compared, the basis, and why a small base shows dollars. */
export function epsGrowthTip(g: EpsGrowthView): string {
  const basis = g.basis === "year" ? "fiscal year against fiscal year" : "quarter against the same quarter a year earlier";
  const head = `Diluted EPS, ${g.label} vs ${g.priorLabel} (${basis}), from SEC filings.`;
  return g.small
    ? `${head} From a small base: the year-ago EPS was under $${SMALL_BASE_PRIOR_EPS.toFixed(2)}, so the change is shown in dollars rather than as a percentage, and these are listed after the ranked stocks.`
    : head;
}
