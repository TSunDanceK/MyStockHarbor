// STRONG EARNINGS GROWTH FROM THE FILINGS (Relay B, #553 CODE-B #94 B5, 2026-10-03).
//
// /stocks-with-strong-earnings-growth took its membership from FMP's
// /stable/earnings rows (warm-earnings -> msh:pickers:earnings:v1:*). With
// FMP_API_KEY gone those rows age out and the list empties. Under
// PICKERS_FUNDAMENTALS's SEC default (pickersSecFundamentals.
// pickersFundamentalsSource) membership now comes from the SEC fact sets, via
// the picker SEC hash the daily warm-pickers-sec job already writes. No new
// job, no new Redis read per page view: the facts ride in the existing row,
// and the picker BUILD (not the page) reads that hash once.
//
// ── WHAT THE OLD RULE MEASURED, AND WHAT CANNOT COME ACROSS ───────────────
// The FMP rule scored YoY EPS growth, YoY revenue growth, EPS-positive
// consistency over six reports and a "beat history" (epsActual vs
// epsEstimated). Estimates are not in any filing, so the beat half cannot be
// reproduced and is dropped rather than approximated.
//
// ── THE RULE NOW (filed figures only) ─────────────────────────────────────
//   period   the newest filed QUARTER; the FISCAL YEAR when the filer is
//            annual-only, has no quarters, or its newest year is newer than
//            its newest quarter (A's anchor rule in buildSecEarningsView), or
//            when the newest quarter is a Q4 with no EPS of its own (Q4 EPS is
//            null by design: the 10-K states the year's EPS, not Q4's)
//   compared the same fiscal period one year earlier, matched by A's
//            priorYearOf (by label, else by dates) -- never a nearest row
//   member   diluted EPS up at least SEC_GROWTH_MIN_EPS_YOY percent, both
//            periods profitable (each EPS at least PE_MIN_EPS: growth out of a
//            loss or from a cent is not a growth rate), AND revenue up more
//            than SEC_GROWTH_MIN_REVENUE_YOY percent
//   ranked   EPS growth 60%, revenue growth 40%
//
// ── A REFUSAL EXCLUDES; IT NEVER PASSES ───────────────────────────────────
// Not in dollars and not convertible, an ADS EPS unit that is unknown or that
// differs between the two periods, a debt ticker, a share-basis change, no
// year-ago period, a stale period, a missing FX rate for either period, an
// incomplete revenue line (A's revenueLineIncomplete) on either period, or a
// large non-operating item in the latest period (A's largeNonOperating: an
// EPS jump that is a one-off gain is not earnings growth) -- each one leaves
// the symbol OUT of the list, with its reason stored on the row.
//
// Growth is taken in the filer's REPORTING currency (A's
// storedInReportingCurrency), so an FX move is not growth. The stored EPS and
// revenue figures are for the ratio only and are never displayed.
import { periodLabel, valueOf, type StoredFactSet, type StoredPeriod } from "./secFactCodec";
import { storedInReportingCurrency } from "./secCurrency";
import { annualOnlyForm } from "./annualOnly";
import {
  largeNonOperating,
  priorYearOf,
  revenueLineIncomplete,
  type ViewCell,
} from "./secEarningsView";
import {
  PE_MIN_EPS,
  epsIsStale,
  epsUnitOf,
  type FilerFacts,
  type ValuationRefusal,
} from "./secValuation";

/** Diluted EPS must be up at least this much, percent, on the year-ago period. */
export const SEC_GROWTH_MIN_EPS_YOY = 15;
/** Revenue must be up MORE than this, percent, on the same year-ago period. */
export const SEC_GROWTH_MIN_REVENUE_YOY = 0;

export type SecGrowthRefusal =
  | "not-in-dollars"
  | "debt-security"
  | "ads-eps-unit"
  | "share-basis-changed"
  | "no-period"
  | "period-is-stale"
  | "no-year-ago-period"
  | "no-fx-rate"
  | "eps-missing"
  | "revenue-missing"
  | "revenue-line-incomplete"
  | "large-non-operating-item";

/**
 * What the row carries: the two periods' figures in the reporting currency,
 * or the reason there are none. JSON-safe, price-independent.
 */
export type SecGrowthFacts =
  | {
      ok: true;
      basis: "quarter" | "year";
      /** "Q2 FY2026" / "FY2025" (periodLabel), and the year-ago period's. */
      label: string;
      priorLabel: string;
      periodEnd: string;
      /** When the latest period was filed: the list's "release" date. */
      filed: string | null;
      eps: number;
      epsPrior: number;
      revenue: number;
      revenuePrior: number;
    }
  | { ok: false; why: SecGrowthRefusal };

const refuse = (why: SecGrowthRefusal): SecGrowthFacts => ({ ok: false, why });

/** The anchor period and the list its year-ago match is searched in. */
function anchorOf(set: StoredFactSet, filer: FilerFacts, today: string): { p: StoredPeriod; list: StoredPeriod[]; basis: "quarter" | "year" } | null {
  const q = set.quarters[0] ?? null;
  const y = set.years[0] ?? null;
  if (!q && !y) return null;
  // A's anchor rule (buildSecEarningsView): annual-only (A's annualOnlyForm, as
  // secValuation applies it), no quarters, or the year is newer.
  if (y && (annualOnlyForm(filer.annualForm, set, today) !== null || !q || y.e > q.e)) {
    return { p: y, list: set.years, basis: "year" };
  }
  // A Q4 carries no EPS of its own; the 10-K's fiscal year ending the same day does.
  if (q && valueOf(q, "epsDiluted") === null && y && y.e === q.e) {
    return { p: y, list: set.years, basis: "year" };
  }
  return { p: q!, list: set.quarters, basis: "quarter" };
}

/**
 * WRITE half. Pure. `refusals` are valuationInputs' for the same set and filer
 * (the row already computes them), so the ADS / debt / basis rules are A's.
 */
export function secGrowthFacts(
  set: StoredFactSet,
  today: string,
  filer: FilerFacts,
  refusals: ValuationRefusal[]
): SecGrowthFacts {
  const reporting = (set.cur ?? "USD").toUpperCase();
  if (reporting !== "USD" && !set.fx) return refuse("not-in-dollars");
  if (refusals.includes("ticker-is-a-debt-security")) return refuse("debt-security");
  if (refusals.includes("ads-ratio-makes-eps-incomparable")) return refuse("ads-eps-unit");
  if (refusals.includes("share-basis-changed")) return refuse("share-basis-changed");

  const anchor = anchorOf(set, filer, today);
  if (!anchor) return refuse("no-period");
  const { p, list, basis } = anchor;
  if (epsIsStale(p.e, today)) return refuse("period-is-stale");
  const prior = priorYearOf(list, p);
  if (!prior) return refuse("no-year-ago-period");

  // A CITED ADS RATIO: both periods' EPS must be in the SAME, known unit.
  const ads = filer.ads && Number.isFinite(filer.ads.ordinaryPerAds) && filer.ads.ordinaryPerAds > 0 ? filer.ads : null;
  if (ads) {
    const a = epsUnitOf(p, ads.ordinaryPerAds);
    const b = epsUnitOf(prior, ads.ordinaryPerAds);
    if (a === null || a !== b) return refuse("ads-eps-unit");
  }

  // Reporting currency, per period; no recorded rate is no comparison.
  const home = (x: StoredPeriod) => (set.fx ? storedInReportingCurrency(x, set.fx) : x);
  const now = home(p);
  const then = home(prior);
  if (!now || !then) return refuse("no-fx-rate");

  if (revenueLineIncomplete(now) || revenueLineIncomplete(then)) return refuse("revenue-line-incomplete");
  const eps = valueOf(now, "epsDiluted");
  const epsPrior = valueOf(then, "epsDiluted");
  if (eps === null || epsPrior === null) return refuse("eps-missing");
  const revenue = valueOf(now, "revenue");
  const revenuePrior = valueOf(then, "revenue");
  if (revenue === null || revenuePrior === null) return refuse("revenue-missing");

  // A's large-non-operating rule, on the latest period's own lines.
  const rows = ["revenue", "operatingIncome", "preTaxIncome", "nonOperatingIncomeExpense"].map(
    (key) => ({ key, val: valueOf(now, key) }) as unknown as ViewCell
  );
  if (largeNonOperating(rows)) return refuse("large-non-operating-item");

  return {
    ok: true,
    basis,
    label: periodLabel(p),
    priorLabel: periodLabel(prior),
    periodEnd: p.e,
    filed: p.f ?? null,
    eps,
    epsPrior,
    revenue,
    revenuePrior,
  };
}

export type SecGrowthCandidate = {
  score: number;
  note: string;
  tone: "green" | "yellow" | "orange";
  epsGrowthPct: number;
  revenueGrowthPct: number;
  releaseDate: string | null;
};

const lin = (v: number, min: number, max: number) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
const pct = (now: number, then: number) => Math.round(((now - then) / then) * 100 * 1e6) / 1e6;
const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

/**
 * READ half: the membership rule. Pure. Null = not on the list. `row` is a
 * picker SEC row (only the fields named here are read); `usd` is
 * moneyIsUsd(row.unit), passed in so this module does not import its caller.
 * A row written before this field existed has no `growth` key: not a member
 * (the list fills when the daily job next writes the row), never an FMP fallback.
 */
export function secStrongEarningsGrowth(
  row: { growth?: SecGrowthFacts | null; inputs: { refusals: ValuationRefusal[] } } | null | undefined,
  usd: boolean
): SecGrowthCandidate | null {
  const g = row?.growth;
  if (!row || !g || !g.ok || !usd) return null;
  // Belt and braces: A's refusals on the row exclude at read time too.
  const r = row.inputs.refusals;
  if (r.includes("ads-ratio-makes-eps-incomparable") || r.includes("ticker-is-a-debt-security") || r.includes("share-basis-changed")) {
    return null;
  }
  // Both periods profitable: growth from a loss or from a cent is not a rate.
  if (!(g.epsPrior >= PE_MIN_EPS) || !(g.eps >= PE_MIN_EPS)) return null;
  if (!(g.revenuePrior > 0)) return null;
  // ROUNDED BEFORE THE TEST: 1.15 over 1.00 is 14.999999999999991 in floating
  // point, and a filed +15.0% must meet "at least 15%" as the copy says.
  const epsGrowthPct = pct(g.eps, g.epsPrior);
  const revenueGrowthPct = pct(g.revenue, g.revenuePrior);
  if (!(epsGrowthPct >= SEC_GROWTH_MIN_EPS_YOY)) return null;
  if (!(revenueGrowthPct > SEC_GROWTH_MIN_REVENUE_YOY)) return null;

  const score = lin(epsGrowthPct, SEC_GROWTH_MIN_EPS_YOY, 100) * 0.6 + lin(revenueGrowthPct, SEC_GROWTH_MIN_REVENUE_YOY, 40) * 0.4;
  const tone = score >= 60 ? "green" : score >= 30 ? "yellow" : "orange";
  return {
    score,
    tone,
    note: `Diluted EPS ${signed(epsGrowthPct)}, revenue ${signed(revenueGrowthPct)}: ${g.label} vs ${g.priorLabel} (SEC filings).`,
    epsGrowthPct,
    revenueGrowthPct,
    releaseDate: g.filed,
  };
}

/**
 * THE PAGE'S WORDS FOR THE RULE ABOVE, built from the same constants so the
 * copy cannot drift from the thresholds (scripts/check-fmpoff-earnings-growth.mjs).
 * Dated 2026-10-03 (#553 CODE-B #94 B5): the old copy promised "beat history"
 * and "positive earnings consistency", which the filings cannot measure.
 */
export const SEC_GROWTH_COPY = {
  description:
    `Stocks whose latest filed quarter shows diluted EPS up at least ${SEC_GROWTH_MIN_EPS_YOY}% and revenue up on the same quarter a year earlier, ` +
    "ranked by that growth. Figures are as filed with the SEC.",
  explainerTitle: "How this earnings growth screen works",
  explainerBody:
    "This page lists companies whose most recent filed results show year-over-year growth. A stock qualifies when its diluted EPS for " +
    `the latest quarter is at least ${SEC_GROWTH_MIN_EPS_YOY}% above the same quarter a year earlier, with a profit in both quarters, ` +
    "and its revenue is also higher. Annual-only filers, and companies whose newest filing is the annual report, are compared fiscal " +
    "year against fiscal year. Stocks are left out when the filings can't support a like-for-like comparison: a different currency " +
    "we can't convert, depositary shares whose EPS unit is unclear, an incomplete revenue line, a large one-off non-operating item, " +
    "or no year-ago period on file. It reads filed figures only; it does not use analyst estimates, so it says nothing about beats or misses.",
  emptyText:
    "No stock currently meets this screen's filed-figures rule, or today's SEC filings data has not been processed yet. Check back later.",
  metaDescription:
    `Stocks whose latest SEC-filed quarter shows diluted EPS up ${SEC_GROWTH_MIN_EPS_YOY}%+ and revenue up year over year, ranked by that growth.`,
  sectionDescription:
    `Latest filed quarter (or fiscal year) vs a year earlier: diluted EPS up at least ${SEC_GROWTH_MIN_EPS_YOY}% and revenue up, from SEC filings.`,
} as const;
