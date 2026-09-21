// WHAT CURRENCY A FILER REPORTS IN, AND TURNING ITS FIGURES INTO USD.
//
// Two jobs that have to stay in this order and in this file:
//
//   1. DECIDE the filer's ONE reporting currency, before any field is read.
//   2. CONVERT a finished extraction into USD, after every derivation the
//      extraction performs.
//
// ── WHY THE CURRENCY IS DECIDED ONCE, PER FILER, AND NOT PER FIELD ────────
//
// The unit guard in secExtract exists because "read whatever unit is there"
// puts a JPY series into a USD field, and a yen figure rendered with a dollar
// sign is the plausible-wrong-number failure this whole pipeline is built
// against. Admitting non-USD filers must not weaken that.
//
// So the guard is not relaxed — it is RETARGETED. One currency is chosen for
// the filer up front, and every field then reads that one unit and no other.
// A filer publishing both EUR and JPY lines still yields nothing from the JPY
// ones. The guard's shape is unchanged; only which single unit it admits moves.
//
// ── CONVERSION HAPPENS AFTER DIFFERENCING, AND THE TYPE ENFORCES IT ───────
//
// SEC filers publish year-to-date figures, so a Q3 quarter is YTD_Q3 - YTD_Q2.
// Converting first and differencing after computes
//
//     (YTD_Q3 x rate_3) - (YTD_Q2 x rate_2)
//
// where the correct figure is
//
//     (YTD_Q3 - YTD_Q2) x rate_Q3
//
// Those agree only when the rate never moved. When it did, the error is a
// perfectly ordinary-looking revenue number — no NaN, no exception, right
// order of magnitude — and it is WORST for the fields that matter most,
// because the cumulative figures being subtracted are the largest ones.
//
// This function takes an `ExtractResult`, which is what extractCompanyFacts
// RETURNS. Differencing happens inside that function. So conversion cannot run
// before differencing without someone moving code into a different file, which
// is the point: the ordering is a property of the module boundary rather than
// a comment asking people to be careful.
import type { CompanyFacts, ExtractResult, PeriodRecord } from "./secExtract";
import { SEC_FIELDS } from "./secFields";
import { averageOver, spotOn, type FxSeries } from "./fxRates";
// TYPE-ONLY, DELIBERATELY. This module is pure currency arithmetic and is
// lifted by checks that concatenate sources; a value import of the codec would
// drag the store's whole dependency tree into every one of them. Building a
// stored set lives in secFactBuild, which may depend on both.
import type { StoredFactSet, StoredPeriod } from "./secFactCodec";

/** Non-financial namespaces never carry the reporting currency. */
const MONEY_UNITS = new Set(["USD", "USD/shares"]);

/**
 * Which SEC_FIELD_KEYS positions hold MONEY, and which hold share counts.
 *
 * DERIVED FROM THE FIELD DEFINITIONS, never hand-listed. A share count
 * converted as if it were money is not a rounding error — it is a company with
 * 1.4x the shares it has, feeding straight into per-share arithmetic. The one
 * place that distinction is recorded is `field.unit`, so this reads it there
 * and moves automatically when a field is added.
 */
export const moneyFieldIndexes = (): Set<number> => {
  const out = new Set<number>();
  SEC_FIELDS.forEach((f, i) => { if (MONEY_UNITS.has(f.unit)) out.add(i); });
  return out;
};

/**
 * The unit keys a field should be read under, for a given reporting currency.
 *
 * `shares` IS NOT TOUCHED. A share count is a count, in every currency.
 */
export function unitKeysFor(unit: string, currency: string): string[] {
  if (unit === "shares") return ["shares"];
  if (unit === "USD/shares") {
    return currency === "USD"
      ? ["USD/shares", "USD/share"]
      : [`${currency}/shares`, `${currency}/share`];
  }
  return [currency];
}

/**
 * THE FILER'S ONE REPORTING CURRENCY, read from the payload.
 *
 * ── BY DISTINCT FIELDS COVERED, NOT BY ROW COUNT AND NOT BY "ANY USD WINS" ──
 *
 * The first rule here was "USD wins whenever it appears at all", chosen so no
 * symbol rendering today could be pulled onto a conversion path. MEASURED, it
 * was wrong for exactly the filers this work is for (relay 35496797255):
 *
 *   RYAAY   EUR 641 rows (91.2%)   USD 62 rows (8.8%)   -> decided USD
 *
 * Those 62 USD rows are a CONVENIENCE TRANSLATION — `ProfitLoss`,
 * `CashFlowsFromUsedInOperatingActivities` and six more cash-flow lines, six
 * years each — published alongside primary statements that are entirely in
 * euros. "Any USD wins" read them as proof of a dollar reporter and refused
 * all 641 euro rows, so RYAAY rendered nothing.
 *
 * A ROW-COUNT PLURALITY WOULD FIX RYAAY AND BREAK THE OTHER DIRECTION: a US
 * filer with extensive EUR segment disclosure could out-row its own primary
 * statements, and the page would then show segment data as headline figures —
 * not a wrong number exactly, but the wrong SERIES, which is worse for being
 * plausible.
 *
 * DISTINCT FIELDS COVERED separates the two cleanly, because it measures the
 * thing that actually distinguishes them: primary statements cover the whole
 * mapped set, a convenience translation covers a handful of lines. RYAAY's
 * euros cover most of the 43 money fields; its dollars cover about ten.
 *
 * USD WINS A TIE, which preserves the original guarantee where it matters: a
 * filer whose dollars cover as many fields as any other currency is read as a
 * dollar filer, so no symbol rendering today moves.
 *
 * NO MIXING IS POSSIBLE whichever way this goes, and that is what makes a
 * "winner" safe at all: the caller admits ONE unit and refuses every other, so
 * the loser's rows are not read rather than blended into the same column.
 */
export function reportingCurrency(facts: CompanyFacts): string | null {
  /** currency -> the set of FIELD KEYS it publishes at least one row for. */
  const fieldsPerCurrency = new Map<string, Set<string>>();
  for (const field of SEC_FIELDS) {
    if (!MONEY_UNITS.has(field.unit)) continue;
    const sources: { ns: string; chain: string[] }[] = [
      { ns: field.taxonomy, chain: field.chain },
    ];
    if (field.ifrsChain?.length) sources.push({ ns: "ifrs-full", chain: field.ifrsChain });
    for (const { ns, chain } of sources) {
      for (const tag of chain) {
        const units = facts.facts?.[ns]?.[tag]?.units;
        if (!units) continue;
        for (const [unit, rows] of Object.entries(units)) {
          if (!(rows?.length ?? 0)) continue;
          // The currency code, whether the unit is "EUR" or "EUR/shares".
          const code = unit.split("/")[0];
          if (!/^[A-Z]{3}$/.test(code)) continue;
          // THE FIELD, NOT THE TAG. One field's chain holds several tags, and
          // counting tags would let a currency published under three synonyms
          // of one line outscore a currency publishing three different lines.
          let seen = fieldsPerCurrency.get(code);
          if (!seen) fieldsPerCurrency.set(code, (seen = new Set()));
          seen.add(field.key);
        }
      }
    }
  }
  if (!fieldsPerCurrency.size) return null;
  // SORTED, SO THE ANSWER CANNOT DEPEND ON PAYLOAD ORDER. Map iteration is
  // insertion order, which here is "whichever currency SEC happened to list
  // first" — and a reporting currency that flips between two equal candidates
  // from one fetch to the next would flip `cur`, the conversion and the stored
  // figures with it.
  //
  // Most fields wins; USD takes any tie; a tie between two others is broken
  // alphabetically. The last rule is arbitrary and is there only to be STABLE.
  const ranked = [...fieldsPerCurrency.entries()].sort((a, b) => {
    if (b[1].size !== a[1].size) return b[1].size - a[1].size;
    if (a[0] === "USD") return -1;
    if (b[0] === "USD") return 1;
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });
  return ranked[0][0];
}

/** What a converted set records about how it was converted. */
export type FxConversion = {
  /** The currency the filer reports in. */
  from: string;
  /** Which adapter produced the rates. */
  source: string;
  /** Rates actually applied, by period end — the audit trail. */
  applied: { end: string; usdPerUnit: number; basis: "average" | "spot" }[];
  /** Periods dropped because no honest rate covered them. */
  refused: string[];
};

/**
 * THE REPORTING-CURRENCY VALUE BACK OUT OF A CONVERTED ONE.
 *
 * ── WHY GROWTH IS COMPUTED HERE AND NOT ON WHAT THE PAGE PRINTS ───────────
 *
 * Each period is converted at ITS OWN rate, which is correct for a figure and
 * wrong for a RATE OF CHANGE. Growth taken across two converted periods is
 *
 *     (v2 x r2) / (v1 x r1) - 1
 *
 * which is the company's growth COMPOUNDED WITH THE CURRENCY MOVE. For a filer
 * whose home currency fell 8% against the dollar, a flat year reads as an 8%
 * decline, and the page would be reporting an FX move as a business result
 * under a heading that says "growth".
 *
 * So growth, and anything built on it, is computed in the currency the filer
 * reports in. The rates are already recorded per period end, so the reporting
 * figure is recoverable exactly rather than needing a second copy of every
 * value stored beside the first.
 *
 * ── MARGINS ARE NOT AFFECTED, AND THAT IS WORTH STATING ───────────────────
 *
 * A margin is a ratio WITHIN one period, so both sides carry the same rate and
 * it cancels: (income x r) / (revenue x r) is income / revenue exactly. Margins
 * need no special handling, and a future change that "fixes" them would be
 * fixing nothing. Only CROSS-PERIOD ratios are exposed, which is why this
 * function exists for growth and not for margins.
 */
export function reportingRateFor(conversion: FxConversion, end: string): number | null {
  return conversion.applied.find((a) => a.end === end)?.usdPerUnit ?? null;
}

/**
 * A period's values back in the filer's own currency.
 *
 * Returns null when no rate was recorded for that end, rather than the
 * converted values unchanged — handing back USD figures labelled as reporting
 * currency is precisely the mislabelling this whole file guards against.
 */
export function inReportingCurrency(
  period: PeriodRecord,
  conversion: FxConversion
): PeriodRecord | null {
  const rate = reportingRateFor(conversion, period.end);
  if (rate === null || !(rate > 0)) return null;
  const money = moneyFieldIndexes();
  return {
    ...period,
    values: period.values.map((v, i) =>
      v === null || !money.has(i) || v.val === null ? v : { ...v, val: v.val / rate }
    ),
  };
}

/**
 * ONE PERIOD'S RATE: average across a duration, spot on an instant.
 *
 * The two are genuinely different questions and that is why they are two
 * selectors rather than one with a flag — see fxRates. A duration is earned
 * throughout its span; a balance sheet is a photograph of one day.
 */
function rateForPeriod(
  period: PeriodRecord,
  series: FxSeries
): { usdPerUnit: number; basis: "average" | "spot" } | null {
  if (period.start) {
    const avg = averageOver(series, period.start, period.end);
    return avg ? { usdPerUnit: avg.usdPerUnit, basis: "average" } : null;
  }
  const spot = spotOn(series, period.end);
  return spot ? { usdPerUnit: spot.usdPerUnit, basis: "spot" } : null;
}

/**
 * CONVERT A FINISHED EXTRACTION INTO USD.
 *
 * Takes the result of extractCompanyFacts — therefore everything in it has
 * already been differenced, resolved and windowed — and returns a new result
 * whose money values are USD. Share counts pass through untouched.
 *
 * A PERIOD WITH NO HONEST RATE IS DROPPED, not left in its own currency. A set
 * mixing converted and unconverted periods in one column would put a euro
 * figure and a dollar figure in the same table under one heading, which is
 * worse than a shorter table. The dropped ends are recorded so the page can
 * say the series is short rather than implying the filer did not report.
 */
export function convertExtractResult(
  result: ExtractResult,
  series: FxSeries
): { result: ExtractResult; conversion: FxConversion } {
  const money = moneyFieldIndexes();
  const applied: FxConversion["applied"] = [];
  const refused: string[] = [];

  const convertList = (periods: PeriodRecord[]): PeriodRecord[] => {
    const out: PeriodRecord[] = [];
    for (const p of periods) {
      const rate = rateForPeriod(p, series);
      if (!rate) { refused.push(p.end); continue; }
      applied.push({ end: p.end, usdPerUnit: rate.usdPerUnit, basis: rate.basis });
      out.push({
        ...p,
        values: p.values.map((v, i) => {
          if (v === null) return null;
          // NOT MONEY, NOT CONVERTED. A share count is a count.
          if (!money.has(i)) return v;
          // A NULL STAYS NULL. `val` is nullable — a period can carry a cell
          // whose value never resolved — and 0 * rate is a figure, not a gap.
          if (v.val === null) return v;
          return { ...v, val: v.val * rate.usdPerUnit };
        }),
      });
    }
    return out;
  };

  return {
    result: {
      ...result,
      quarters: convertList(result.quarters),
      years: convertList(result.years),
      instants: convertList(result.instants),
      // coverShares IS A SHARE COUNT and is deliberately not touched here.
    },
    conversion: {
      from: series.currency,
      source: series.source,
      applied,
      refused,
    },
  };
}

/**
 * A STORED period's values back in the filer's own currency.
 *
 * The same job as inReportingCurrency, one layer down: the view reads
 * StoredPeriod (positional `v`), not PeriodRecord. Two shapes, one rule, and
 * the rule is `moneyFieldIndexes` in both — so a field added to SEC_FIELDS
 * moves both at once rather than one of them.
 *
 * RETURNS THE PERIOD UNCHANGED FOR AN UNCONVERTED SET. A USD filer has no
 * conversion and its stored values already ARE reporting currency, so this is
 * the identity for every symbol rendering today.
 */
export function storedInReportingCurrency(
  period: StoredPeriod,
  fx: StoredFactSet["fx"] | undefined
): StoredPeriod | null {
  if (!fx) return period;
  const rate = fx.applied.find((a) => a.end === period.e)?.usdPerUnit ?? null;
  // NO RATE MEANS NO HONEST ANSWER. Returning the converted values would hand
  // back dollars labelled as the filer's currency, which is the mislabelling
  // this file exists to prevent — and growth computed on them would be the FX
  // move. The caller drops the comparison instead.
  if (rate === null || !(rate > 0)) return null;
  const money = moneyFieldIndexes();
  return { ...period, v: period.v.map((x, i) => (x === null || !money.has(i) ? x : x / rate)) };
}
