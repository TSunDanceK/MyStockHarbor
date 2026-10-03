// PICKER FUNDAMENTALS FROM THE FILINGS (Relay B, #553 COWORK #5, 2026-09-23).
//
// The Valuation / Dividends / Financials tabs on the picker pages read FMP's
// ratios-ttm, income-statement, cash-flow-statement and dividends, cached per
// symbol by warm-stock-data. This moves eleven of those columns onto the SEC
// fact sets the site already stores, using the SHIPPED valuation functions in
// secValuation.ts -- the same ones the stock page uses -- rather than a second
// implementation that could disagree with it.
//
//   Market Cap      price × cover-page shares          secValuation.marketCap
//   PS Ratio        cap ÷ TTM revenue (guarded)        secValuation.valuationMultiples
//   PB Ratio        cap ÷ latest equity                secValuation.valuationMultiples
//   Ent. Value      cap + short + long debt − cash     the evEbitda inputs, all present
//   P/FCF           cap ÷ TTM (OCF − capex)            below
//   Revenue         TTM, refused by revenueLineIncomplete (imported, via multipleInputs)
//   Op. Income, Net Income, FCF    TTM                 secValuation.twelveMonthsOf
//   Div ($)         TTM declared per share             twelveMonthsOf
//   Div Yield       Div ($) ÷ price
//   Div Growth      TTM vs the prior TTM, else FY vs FY
//
//   P/E             price ÷ twelve months of diluted EPS  secValuation.peRatio
//   EPS             that twelve months, basis named       valuationInputs (post-#577)
//   Payout Ratio    DPS ÷ EPS from ONE period             samePeriodPayout, below
//
// P/E, EPS AND PAYOUT (#553 COWORK #18/#21) moved once A's TTM EPS fix (#577)
// landed. Their basis varies by ROW -- four quarters for a quarterly filer, the
// fiscal year for an annual-only one -- so every figure carries a label
// ("TTM to 30 Jun 2026", "FY2025") that the grid puts in the cell's tooltip.
// They are applied separately (applySecEarnings) because a row written before
// they existed has no `eps` key, and must leave the stored figures alone rather
// than clear them. Sector and industry move to A's resolver in their own PR.
//
// ── TWO HALVES, AND WHY ────────────────────────────────────────────────────
// A ratio against price has to be divided at READ time or it is frozen at the
// job's price (the grid's own comment on its derived ratios says the same). So:
//   WRITE (daily job):  buildSecPickerRow(set) -- price-INDEPENDENT inputs only,
//                       one JSON field per symbol in ONE hash.
//   READ  (page render): applySecPickerRow(row, price) -- the division, with the
//                       price the page already shows. One HMGET for the page.
// Both halves are pure and exported so scripts/check-pickers-sec.mjs runs them.
//
// ── A REFUSAL IS A DASH, NEVER A FALL BACK TO FMP ──────────────────────────
// When the filings cannot support a figure (an ADS filer's share count, an
// incomplete revenue line, a missing debt line), the cell shows "–". It does
// not quietly show FMP's number instead: a column whose rows come from two
// sources without saying which is the mixed-provenance failure this exit exists
// to end. Only a symbol with NO row at all (the job has not reached it) keeps
// the old values, and that is the pre-merge state rather than a steady one.
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { readFactSet } from "./secFactStore";
import { valueOf, type StoredFactSet, type StoredPeriod } from "./secFactCodec";
import { storedInReportingCurrency } from "./secCurrency";
import {
  marketCap,
  multipleInputs,
  peRatio,
  twelveMonthsOf,
  valuationInputs,
  valuationMultiples,
  type EpsBasis,
  type FilerFacts,
  type MultipleInputs,
  type ValuationFigure,
  type ValuationInputs,
  type ValuationRefusal,
} from "./secValuation";
import { isBankOrInsurer, type CellWhyCode, type CellWhyColumn } from "../pickerCellWhy";

export const PICKERS_SEC_KEY = "msh:pickers:sec-fundamentals:v1";
/**
 * A PREVIEW-ONLY COPY (#553 COWORK #60). A preview of this branch used to read
 * the production hash, which production's 05:35 job (main's code, no `eps`
 * fields) rewrote every morning -- so a seed from the branch vanished before
 * Cowork could look. Previews now read and write their own key; only an
 * explicit seed (write-pickers-sec-seed --preview) fills it. Production never
 * touches it, and it lapses on the same TTL.
 */
export const PICKERS_SEC_PREVIEW_KEY = "msh:pickers:sec-fundamentals:preview:v1";

/** The hash this deployment reads and writes: previews use their own copy. */
export function pickersSecKey(env: Record<string, string | undefined> = process.env): string {
  return env.VERCEL_ENV === "preview" ? PICKERS_SEC_PREVIEW_KEY : PICKERS_SEC_KEY;
}
/** Survives two missed daily runs; a row older than this is served as absent. */
export const PICKERS_SEC_TTL_SECONDS = 3 * 24 * 60 * 60;

/**
 * The rollback. PICKERS_FUNDAMENTALS=fmp restores the FMP columns exactly as
 * before (the FMP warm jobs keep running until this is verified -- the owner's
 * rule that FMP stays on until each replacement is). Anything else reads SEC.
 * An env read, so a change needs a production redeploy to take effect.
 */
export function pickersFundamentalsSource(): "sec" | "fmp" {
  return process.env.PICKERS_FUNDAMENTALS === "fmp" ? "fmp" : "sec";
}

/**
 * THE UNIT EVERY MONEY FIGURE IN A ROW IS IN (#553 COWORK #11, 2026-09-23).
 *
 * The #559 preview showed EC (Ecopetrol) revenue 123.86T and HMY 179.91B:
 * Colombian pesos and rand, filed on a 20-F, printed against a USD price. A
 * fact set records its reporting currency (`cur`, absent = USD) and, when
 * Relay A's FX module could convert it, how (`fx`, period-matched rates applied
 * at extraction -- lib/server/secCurrency.ts). So:
 *   USD                        figures as stored
 *   non-USD WITH fx            figures as stored (already USD, per period);
 *                              growth taken in the REPORTING currency, as A's
 *                              module requires, so an FX move is not growth
 *   non-USD WITHOUT fx         every money figure REFUSED ("–"), never shown raw
 * Market cap is price × share count -- no reporting-currency figure in it -- so
 * it is unaffected (the ADS/20-F share rule still applies to it separately).
 * The same rule as secEarningsView's "a set that is not in dollars does not
 * render".
 */
export type SecPickerUnit = { reporting: string; converted: boolean };

export function unitOf(set: Pick<StoredFactSet, "cur" | "fx">): SecPickerUnit {
  const reporting = (set.cur ?? "USD").toUpperCase();
  return { reporting, converted: reporting !== "USD" && Boolean(set.fx) };
}

/** Whether a set's stored money figures are in US dollars. */
export const moneyIsUsd = (u: SecPickerUnit) => u.reporting === "USD" || u.converted;

/** Everything price-independent that the eleven columns need. JSON-safe. */
export type SecPickerRow = {
  v: 1;
  unit: SecPickerUnit;
  /** When the job built it (ms). */
  at: number;
  inputs: Pick<ValuationInputs, "shares" | "refusals">;
  m: MultipleInputs;
  operatingIncome: number | null;
  netIncome: number | null;
  freeCashFlow: number | null;
  divPerShare: number | null;
  divGrowth: number | null;
  /**
   * Twelve months of diluted EPS as valuationInputs chose it, or null. OPTIONAL
   * ON PURPOSE: a row written before P/E moved has no key at all, and
   * applySecEarnings reads that as "leave the stored figures", not as a refusal.
   */
  eps?: EpsBasis | null;
  /** Payout from one period only, or null. Same optionality as `eps`. */
  payout?: PayoutBasis | null;
};

/** A payout ratio (PERCENT) whose dividend and EPS cover the same period. */
export type PayoutBasis = {
  val: number;
  basis: "four-quarters" | "fiscal-year";
  periodEnd: string;
  fiscalYear?: number | null;
};

/**
 * PAYOUT FROM ONE PERIOD, OR NOTHING (#553 COWORK #21).
 *
 * The census found 70 of 260 payers whose EPS is TTM to June while their
 * dividends-per-share are only on file for the fiscal year to December: the Q4
 * dividend sits inside the 10-K and is never filed as a quarter. Dividing one
 * by the other is a ratio of two different years. So:
 *   1. TTM DPS over TTM EPS, when both are four quarters ending the same day;
 *   2. else the newest fiscal year's DPS over THAT year's diluted EPS;
 *   3. else null ("–").
 * A loss (EPS <= 0) has no payout ratio, as it has no P/E.
 */
export function samePeriodPayout(set: StoredFactSet, eps: EpsBasis | null): PayoutBasis | null {
  if (eps && eps.basis === "four-quarters" && eps.val > 0) {
    const dps = twelveMonthsOf(set, ["dividendsDeclaredPerShare"]);
    if (dps && dps.basis === "four-quarters" && dps.periodEnd === eps.periodEnd) {
      return { val: (dps.vals.dividendsDeclaredPerShare / eps.val) * 100, basis: "four-quarters", periodEnd: eps.periodEnd };
    }
  }
  const y = set.years[0];
  if (!y) return null;
  const e = valueOf(y, "epsDiluted");
  const d = valueOf(y, "dividendsDeclaredPerShare");
  if (e === null || e <= 0 || d === null) return null;
  return { val: (d / e) * 100, basis: "fiscal-year", periodEnd: y.e, fiscalYear: y.fy ?? null };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "TTM to 30 Jun 2026" or "FY2025" -- what the cell's tooltip says, in the
 * stock page's words (stockProfile.peBasisLabel, which this module cannot
 * import: that file pulls JSON through the "@/" alias the relay's loader and
 * the checks do not resolve). A's "year-to-date" basis (#588: fiscal year +
 * year-to-date - the prior year-to-date) IS twelve trailing months, so it reads
 * TTM; a filer that states only basic EPS (BRK) says so.
 */
export function basisLabel(b: {
  basis: "four-quarters" | "fiscal-year" | "year-to-date";
  periodEnd: string;
  fiscalYear?: number | null;
  kind?: "basic";
}): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(b.periodEnd);
  const date = m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : b.periodEnd;
  const label = b.basis === "fiscal-year" ? (b.fiscalYear ? `FY${b.fiscalYear}` : `FY to ${date}`) : `TTM to ${date}`;
  return b.kind === "basic" ? `${label}, basic EPS` : label;
}

/** The columns a row can fill, as the picker entry names them. */
export type SecPickerFigures = {
  marketCap: number | null;
  psRatio: number | null;
  pbRatio: number | null;
  enterpriseValue: number | null;
  pfcfRatio: number | null;
  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  freeCashFlow: number | null;
  divPerShare: number | null;
  divYield: number | null;
  divGrowth: number | null;
};

/** The fields applySecPickerRow owns, in one place for the page and the check. */
export const SEC_PICKER_FIELDS: (keyof SecPickerFigures)[] = [
  "marketCap", "psRatio", "pbRatio", "enterpriseValue", "pfcfRatio", "revenue",
  "operatingIncome", "netIncome", "freeCashFlow", "divPerShare", "divYield", "divGrowth",
];

/**
 * A stored period in the filer's REPORTING currency, for growth. Identity for a
 * USD or unconverted set; for a converted one, A's storedInReportingCurrency
 * (null when no rate was recorded for that period -- then there is no growth).
 */
function home(set: StoredFactSet, p: StoredPeriod | undefined): StoredPeriod | null {
  if (!p) return null;
  return set.fx ? storedInReportingCurrency(p, set.fx) : p;
}

/** The four consecutive quarters `offset` back, summed, or null. secValuation's period rule. */
function fourQuartersFrom(set: StoredFactSet, key: string, offset: number): number | null {
  const four = set.quarters.slice(offset, offset + 4).map((q) => home(set, q));
  if (four.length < 4 || four.some((q) => q === null)) return null;
  const parts = four.map((q) => valueOf(q, key));
  if (parts.some((v) => v === null)) return null;
  return (parts as number[]).reduce((a, b) => a + b, 0);
}

/**
 * Dividend growth, percent: the newest TTM against the TTM before it, else the
 * newest fiscal year against the one before. Null when either side is missing
 * or the older one is not positive -- growth from nothing is not a percentage.
 */
function dividendGrowth(set: StoredFactSet): number | null {
  const now = fourQuartersFrom(set, "dividendsDeclaredPerShare", 0);
  const prior = fourQuartersFrom(set, "dividendsDeclaredPerShare", 4);
  if (now !== null && prior !== null && prior > 0) return ((now - prior) / prior) * 100;
  const a = valueOf(home(set, set.years[0]), "dividendsDeclaredPerShare");
  const b = valueOf(home(set, set.years[1]), "dividendsDeclaredPerShare");
  return a !== null && b !== null && b > 0 ? ((a - b) / b) * 100 : null;
}

/** WRITE half. Pure. */
export function buildSecPickerRow(
  set: StoredFactSet,
  today: string,
  filer: FilerFacts,
  nowMs: number
): SecPickerRow {
  const inputs = valuationInputs(set, today, filer);
  const unit = unitOf(set);
  if (!moneyIsUsd(unit)) {
    // NOT IN DOLLARS AND NOT CONVERTIBLE: nothing money-denominated leaves this
    // function. The share count stays (market cap is price × shares).
    return {
      v: 1,
      at: nowMs,
      unit,
      inputs: { shares: inputs.shares, refusals: inputs.refusals },
      m: { revenue: null, revenueIncomplete: false, ebitda: null, balanceSheet: null },
      operatingIncome: null,
      netIncome: null,
      freeCashFlow: null,
      divPerShare: null,
      divGrowth: null,
      // EPS is money per share: not in dollars, not written. Payout goes too --
      // the row carries nothing derived from a figure it refused.
      eps: null,
      payout: null,
    };
  }
  const oi = twelveMonthsOf(set, ["operatingIncome"]);
  const ni = twelveMonthsOf(set, ["netIncome"]);
  const cf = twelveMonthsOf(set, ["operatingCashFlow", "capex"]);
  const dps = twelveMonthsOf(set, ["dividendsDeclaredPerShare"]);
  return {
    v: 1,
    at: nowMs,
    unit,
    inputs: { shares: inputs.shares, refusals: inputs.refusals },
    m: multipleInputs(set),
    operatingIncome: oi ? oi.vals.operatingIncome : null,
    netIncome: ni ? ni.vals.netIncome : null,
    // capex is stored as the positive payment (PaymentsToAcquire...); abs() so a
    // filer that tags it negative cannot turn FCF into OCF + capex.
    freeCashFlow: cf ? cf.vals.operatingCashFlow - Math.abs(cf.vals.capex) : null,
    divPerShare: dps ? dps.vals.dividendsDeclaredPerShare : null,
    divGrowth: dividendGrowth(set),
    eps: inputs.eps,
    payout: samePeriodPayout(set, inputs.eps),
  };
}

const ok = (f: { ok: true; val: number } | { ok: false } | null): number | null =>
  f && f.ok ? f.val : null;

/** READ half. Pure. `price` is the price the page shows for the row. */
export function applySecPickerRow(row: SecPickerRow, price: number | null): SecPickerFigures {
  // BELT AND BRACES: a row whose money is not in dollars yields no money
  // figure here either, whatever its fields hold.
  const usd = moneyIsUsd(row.unit);
  const inputs: ValuationInputs = { shares: row.inputs.shares, eps: null, refusals: row.inputs.refusals };
  const cap = ok(marketCap(inputs, price));
  const mult = valuationMultiples(inputs, row.m, price);

  const bs = row.m.balanceSheet;
  const enterpriseValue =
    cap !== null && bs && bs.shortTermDebt !== null && bs.longTermDebt !== null && bs.cash !== null
      ? cap + bs.shortTermDebt + bs.longTermDebt - bs.cash
      : null;

  // P/FCF is refused on a non-positive FCF, like P/E on a loss: a negative
  // multiple sorts to the top of a cheapest-first column.
  const pfcfRatio = cap !== null && row.freeCashFlow !== null && row.freeCashFlow > 0 ? cap / row.freeCashFlow : null;

  // Revenue carries the SAME refusal as P/S: an incomplete revenue line is not
  // a revenue figure either (the shared guard, applied inside multipleInputs).
  const revenue = row.m.revenueIncomplete ? null : row.m.revenue?.vals.revenue ?? null;

  const divYield =
    row.divPerShare !== null && price !== null && Number.isFinite(price) && price > 0
      ? (row.divPerShare / price) * 100
      : null;

  const money = <T,>(v: T | null): T | null => (usd ? v : null);
  return {
    marketCap: cap,
    psRatio: money(ok(mult.ps)),
    pbRatio: money(ok(mult.pb)),
    enterpriseValue: money(enterpriseValue),
    pfcfRatio: money(pfcfRatio),
    revenue: money(revenue),
    operatingIncome: money(row.operatingIncome),
    netIncome: money(row.netIncome),
    freeCashFlow: money(row.freeCashFlow),
    divPerShare: money(row.divPerShare),
    divYield: money(divYield),
    divGrowth: money(row.divGrowth),
  };
}

/** P/E, EPS and Payout, the three that moved with #553 COWORK #21. */
export type SecEarningsFigures = {
  peRatio: number | null;
  epsTtm: number | null;
  payoutRatio: number | null;
  /** "TTM to 30 Jun 2026" / "FY2025" for the P/E and EPS cells, or null. */
  epsBasis: string | null;
  payoutBasis: string | null;
};

/**
 * WITHHELD, NOT LABELLED (#553 COWORK #60). samePeriodPayout never divides two
 * periods, but its fiscal-year fallback can sit in a row whose P/E and EPS are
 * TTM: two figures from different periods side by side. Cowork ruled that a
 * label isn't enough, so that payout shows "–" with this tooltip instead.
 * Read-time only: the stored row keeps it, so un-withholding is this one test.
 */
export const PAYOUT_PERIODS_DIFFER = "Not shown: the EPS and dividend periods differ";

export const SEC_EARNINGS_FIELDS: ("peRatio" | "epsTtm" | "payoutRatio")[] = ["peRatio", "epsTtm", "payoutRatio"];

/**
 * READ half for the three. NULL (not a figures object) for a row written
 * before they moved: the page then leaves the stored values, exactly as for a
 * symbol with no row. Pure.
 */
export function applySecEarnings(row: SecPickerRow, price: number | null): SecEarningsFigures | null {
  if (!("eps" in row)) return null;
  const usd = moneyIsUsd(row.unit);
  const eps = row.eps ?? null;
  const inputs: ValuationInputs = { shares: row.inputs.shares, eps, refusals: row.inputs.refusals };
  // ADS NAMES STAY "–" (COWORK #18): EPS per ordinary share beside a price per
  // depositary share is the same unit error the P/E refusal exists for, and a
  // payout beside them would be the only figure left standing in the row.
  const ads = row.inputs.refusals.includes("ads-ratio-makes-eps-incomparable");
  const pe = usd ? ok(peRatio(inputs, price)) : null;
  const epsTtm = usd && !ads && eps ? eps.val : null;
  const filed = usd && !ads && row.payout ? row.payout : null;
  const periodsDiffer = filed !== null && eps !== null && (filed.basis !== eps.basis || filed.periodEnd !== eps.periodEnd);
  const payout = periodsDiffer ? null : filed;
  return {
    peRatio: pe,
    epsTtm,
    payoutRatio: payout ? payout.val : null,
    epsBasis: eps && (pe !== null || epsTtm !== null) ? basisLabel(eps) : null,
    payoutBasis: payout ? basisLabel(payout) : periodsDiffer ? PAYOUT_PERIODS_DIFFER : null,
  };
}

/**
 * A's REFUSAL, AS THE GRID'S CODE (#553 COWORK #69). Every ValuationRefusal
 * has one: the Record type makes a new refusal a type error here until it is
 * given a code, and scripts/check-pickers-cell-why.mjs checks each code has
 * words in lib/pickerCellWhy.ts.
 */
export const WHY_FOR_REFUSAL: Record<ValuationRefusal, CellWhyCode> = {
  "no-cover-share-count": "noShr",
  "multi-class-share-count-is-ambiguous": "multi",
  "ads-ratio-makes-shares-incomparable": "adsS",
  "ads-ratio-makes-eps-incomparable": "adsE",
  "ticker-is-a-debt-security": "debt",
  "share-count-is-stale": "shOld",
  "no-twelve-month-eps": "noEps",
  "eps-period-is-stale": "epsOld",
  "share-basis-changed": "basis",
  "eps-is-zero-or-negative": "epsNeg",
  "eps-near-zero": "eps0",
  "no-twelve-month-revenue": "noRev",
  "revenue-line-incomplete": "revInc",
  "no-balance-sheet-equity": "noEq",
  "equity-tagged-only-incl-nci": "eqNci",
  "equity-is-zero-or-negative": "eqNeg",
  "equity-too-small-for-pb": "eqSmall",
  "enterprise-value-input-missing": "evIn",
  "ebitda-is-zero-or-negative": "ebitNeg",
};

/**
 * WHY EACH EMPTY CELL IS EMPTY (#553 COWORK #69). Pure. For every grid column
 * this row leaves empty -- the same `figures` and `earnings` the page applies
 * -- the code of the reason, taken from A's refusal where there is one. A
 * column with a figure gets no entry. `industry` is A's label for the row: a
 * bank or insurer's empty Ent. Value, P/S and P/FCF read "n/a", not "–".
 */
export function secPickerWhy(
  row: SecPickerRow,
  price: number | null,
  figures: SecPickerFigures,
  earnings: SecEarningsFigures | null,
  industry: string | null | undefined
): Partial<Record<CellWhyColumn, CellWhyCode>> {
  const out: Partial<Record<CellWhyColumn, CellWhyCode>> = {};
  const usd = moneyIsUsd(row.unit);
  const refusals = row.inputs.refusals;
  const priced = price !== null && Number.isFinite(price) && price > 0;
  const inputs: ValuationInputs = { shares: row.inputs.shares, eps: row.eps ?? null, refusals };
  const capFig = marketCap(inputs, price);
  const why = (f: ValuationFigure | null | undefined): CellWhyCode | null => (f && !f.ok ? WHY_FOR_REFUSAL[f.why] : null);
  // The cap's reason is every cap-based column's reason, as in valuationMultiples.
  const capWhy: CellWhyCode = refusals.includes("ticker-is-a-debt-security")
    ? "debt"
    : why(capFig) ?? (priced ? "noCap" : "noPx");
  const bank = isBankOrInsurer(industry);
  const set = (col: CellWhyColumn, v: number | null, code: () => CellWhyCode) => {
    if (v === null) out[col] = code();
  };
  const money = (code: () => CellWhyCode) => () => (usd ? code() : "fx");

  set("marketCap", figures.marketCap, () => capWhy);
  const mult = valuationMultiples(inputs, row.m, price);
  set("ps", figures.psRatio, () => (bank ? "naPs" : figures.marketCap === null ? capWhy : usd ? why(mult.ps) ?? "noRev" : "fx"));
  set("pb", figures.pbRatio, () => (figures.marketCap === null ? capWhy : usd ? why(mult.pb) ?? "noEq" : "fx"));
  set("ev", figures.enterpriseValue, () => (bank ? "naEv" : figures.marketCap === null ? capWhy : usd ? "evIn" : "fx"));
  set("pfcf", figures.pfcfRatio, () =>
    bank ? "naFcf" : figures.marketCap === null ? capWhy : !usd ? "fx" : row.freeCashFlow === null ? "noFcf" : row.freeCashFlow === 0 ? "fcf0" : "fcfNeg");
  set("revenue", figures.revenue, money(() => (row.m.revenueIncomplete ? "revInc" : "noRev")));
  set("opinc", figures.operatingIncome, money(() => "noOpi"));
  set("netinc", figures.netIncome, money(() => "noNi"));
  set("fcf", figures.freeCashFlow, money(() => "noFcf"));
  set("dps", figures.divPerShare, money(() => "noDiv"));
  set("dyield", figures.divYield, money(() => (row.divPerShare === null ? "noDiv" : "noPx")));
  set("dgrowth", figures.divGrowth, money(() => "noDg"));

  // P/E, EPS and Payout only where the page applies them (a row written before
  // they moved keeps its stored figures, and so has no reason to give).
  if (earnings) {
    const ads = refusals.includes("ads-ratio-makes-eps-incomparable");
    set("pe", earnings.peRatio, money(() => why(peRatio(inputs, price)) ?? (priced ? "noEps" : "noPx")));
    set("eps", earnings.epsTtm, money(() =>
      ads ? "adsE" : refusals.includes("eps-period-is-stale") ? "epsOld" : "noEps"));
    set("payout", earnings.payoutRatio, money(() =>
      ads ? "adsE" : earnings.payoutBasis === PAYOUT_PERIODS_DIFFER ? "payMix" : "noPay"));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────── I/O

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

// A ROW WITHOUT `unit` predates the currency rule (the preview seed of
// 2026-09-23) and may hold local-currency figures; it reads as absent, and the
// next job run rewrites it.
function isRow(v: unknown): v is SecPickerRow {
  const r = v as SecPickerRow;
  return Boolean(v && typeof v === "object" && r.v === 1 && r.m && r.unit && typeof r.unit.reporting === "string");
}

/**
 * The page's read: ONE HMGET for every symbol on the page. A missing or
 * malformed field is simply absent from the map; a Redis failure is an empty
 * map (the page then keeps its previous values, the pre-merge state).
 */
export async function readSecPickerRows(symbols: string[]): Promise<Map<string, SecPickerRow>> {
  const out = new Map<string, SecPickerRow>();
  const fields = [...new Set(symbols.filter(Boolean))];
  if (!redis || !fields.length) return out;
  try {
    const raw = (await redis.hmget(pickersSecKey(), ...fields)) as unknown;
    const get = (sym: string, i: number): unknown =>
      Array.isArray(raw) ? raw[i] : raw && typeof raw === "object" ? (raw as Record<string, unknown>)[sym] : null;
    const staleBefore = Date.now() - PICKERS_SEC_TTL_SECONDS * 1000;
    fields.forEach((sym, i) => {
      const row = get(sym, i);
      if (isRow(row) && row.at >= staleBefore) out.set(sym, row);
    });
  } catch {
    // Absent, not an error the reader sees.
  }
  return out;
}

export type WarmPickersSecResult = {
  ok: boolean;
  symbols: number;
  written: number;
  noFactSet: number;
  stoppedEarly: string | null;
  commands: number;
  /** Rows for symbols no longer targeted, removed after the write (COWORK #60). */
  pruned?: number;
  /** Why the prune was skipped, when it was. */
  pruneSkipped?: string | null;
};

/** Below this share of the hash's current rows, today's targets look like a bad read. */
export const PRUNE_MIN_TARGET_SHARE = 0.5;

/**
 * WHICH STORED ROWS TO DROP (#553 COWORK #60, CODE-B #51). Pure.
 *
 * THE BUG: the hash's TTL is refreshed whole every day, so a symbol that left
 * the targets kept its last row forever. TSM's was 38 h old on 26 Sep and still
 * carried refusals #618 had fixed -- a row nothing would ever rewrite.
 *
 * THE GUARD: if today's targets are empty, or fewer than half the rows already
 * stored, the targets read is suspect (a cold universe key, a failed fetch) and
 * pruning against it would wipe good rows. Skip, and say so; the rows carry
 * their own `at`, so keeping them one more day is the safe error.
 */
export function rowsToPrune(stored: string[], targets: string[]): { drop: string[]; skipped: string | null } {
  if (!targets.length) return { drop: [], skipped: "no targets" };
  if (targets.length < stored.length * PRUNE_MIN_TARGET_SHARE) {
    return { drop: [], skipped: `targets ${targets.length} < ${PRUNE_MIN_TARGET_SHARE * 100}% of ${stored.length} stored` };
  }
  const keep = new Set(targets);
  return { drop: stored.filter((f) => !keep.has(f)), skipped: null };
}

/**
 * The daily job's work. RUNAWAY GUARDS, stated as numbers:
 *   - at most MAX_SYMBOLS_PER_RUN symbols (the universe is ~850 today);
 *   - one GET per symbol (readFactSet) + one HSET per 100 symbols + one EXPIRE;
 *   - the FIRST Redis write error stops the run -- a failing store is not
 *     retried 850 times.
 *   - then 1 HKEYS + 1 HDEL to drop rows no longer targeted (rowsToPrune).
 * So a run costs about 850 + 9 + 1 + 2 ≈ 862 commands, and cannot exceed ~2,052.
 */
export const MAX_SYMBOLS_PER_RUN = 2_000;

export async function warmPickersSec(
  symbols: string[],
  // THE SAME FILER FACTS THE STOCK AND EARNINGS PAGES PASS (#553 COWORK #44):
  // the 20-F form and the cited ADS ratio from A's map (secAdsMap.adsRatioFor).
  // A callback, so this module stays free of JSON imports like secValuation.
  filerFor: (symbol: string) => FilerFacts,
  nowMs = Date.now(),
  key = pickersSecKey()
): Promise<WarmPickersSecResult> {
  const result: WarmPickersSecResult = {
    ok: true, symbols: 0, written: 0, noFactSet: 0, stoppedEarly: null, commands: 0,
  };
  if (!redis) return { ...result, ok: false, stoppedEarly: "no-redis" };

  const list = [...new Set(symbols.filter(Boolean))].slice(0, MAX_SYMBOLS_PER_RUN);
  result.symbols = list.length;
  const today = new Date(nowMs).toISOString().slice(0, 10);

  let batch: Record<string, SecPickerRow> = {};
  const flush = async () => {
    const n = Object.keys(batch).length;
    if (!n) return true;
    try {
      await redis.hset(key, batch);
      result.commands++;
      result.written += n;
      batch = {};
      return true;
    } catch (err) {
      result.ok = false;
      result.stoppedEarly = `redis-write-failed: ${String(err).slice(0, 120)}`;
      return false;
    }
  };

  for (const symbol of list) {
    const set = await readFactSet(symbol).catch(() => null);
    result.commands++;
    if (!set) {
      result.noFactSet++;
      continue;
    }
    batch[symbol] = buildSecPickerRow(set, today, filerFor(symbol), nowMs);
    if (Object.keys(batch).length >= 100 && !(await flush())) return result;
  }
  if (!(await flush())) return result;

  // Drop the rows of symbols no longer targeted: 1 HKEYS + 1 multi-key HDEL.
  try {
    const stored = ((await redis.hkeys(PICKERS_SEC_KEY)) ?? []).map(String);
    result.commands++;
    const { drop, skipped } = rowsToPrune(stored, list);
    result.pruneSkipped = skipped;
    if (skipped) console.warn(`[warm-pickers-sec] prune skipped: ${skipped}`);
    if (drop.length) {
      result.pruned = await redis.hdel(PICKERS_SEC_KEY, ...drop);
      result.commands++;
    } else {
      result.pruned = 0;
    }
  } catch (err) {
    // A failed prune leaves stale rows one more day; it is not a failed run.
    result.pruneSkipped = `redis error (${err instanceof Error ? err.name : "unknown"})`;
  }

  try {
    await redis.expire(key, PICKERS_SEC_TTL_SECONDS);
    result.commands++;
  } catch {
    // The rows carry their own `at`; a missed EXPIRE is not a correctness issue.
  }
  return result;
}
