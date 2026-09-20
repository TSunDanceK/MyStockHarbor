// TURNING A FILER'S HOME CURRENCY INTO USD — the rates, and only the rates.
//
// This module answers one question: "what was one unit of CCY worth in USD, on
// this date or across this span?" It does not know what a fact set is, does not
// touch Redis, and converts nothing. The conversion itself lives beside the
// extraction that produces the figures, because WHERE it happens is a
// correctness rule (after differencing) and belongs next to the differencing.
//
// ── EVERY SOURCE IS NORMALISED TO USD-PER-ONE-UNIT, HERE, ONCE ─────────────
//
// This is the whole reason the adapter exists, and it is not tidiness. MEASURED
// on a runner (relay 35494551985), the two H.10 series this page needs point in
// OPPOSITE DIRECTIONS:
//
//   DEXUSEU  2026-09-11 = 1.1604   US DOLLARS per ONE EURO      -> multiply
//   DEXCAUS  2026-09-11 = 1.3864   CANADIAN DOLLARS per ONE USD -> divide
//
// A single `rate` field with a single multiply is right for RYAAY and wrong for
// CNI by a factor of 1.92 — and 1.92x a revenue figure is a plausible number,
// not an error. Nothing downstream ever sees a raw quote: an adapter returns
// USD per one unit or it returns nothing, so a call site has no direction left
// to get wrong.
//
// The fallback inverts differently again. ECB quotes everything against the
// EURO, never the dollar, so CAD->USD from ECB is a CROSS of two series
// (USD/EUR ÷ CAD/EUR) rather than a lookup — measured 2026-09-18,
// 1.146 / 1.6056 = 0.7138. That is why the fallback cannot be swapped in
// field-for-field and why normalisation cannot live at the call site.
//
// ── REFUSE, NEVER GUESS ────────────────────────────────────────────────────
//
// Every selector below returns null rather than an approximation. That is the
// same choice the unit guard in secExtract already makes: a non-USD reporter
// yields NULL rather than a euro figure rendered with a dollar sign. A missing
// rate must produce a missing figure, because the alternative is a number on a
// finance page that nobody can trace.

/** USD per ONE unit of the currency, on one day. Never a raw upstream quote. */
export type FxObservation = { date: string; usdPerUnit: number };

/**
 * A daily series, newest-last, already normalised.
 *
 * An ARRAY sorted by date rather than a map, because both selectors below need
 * ORDER — the spot rule walks backwards from a date and the average walks a
 * span — and a map would have them sorting keys on every call.
 */
export type FxSeries = {
  currency: string;
  /** Which adapter produced it, carried so a stored conversion can name it. */
  source: string;
  observations: FxObservation[];
};

/**
 * A rate source, behind one interface so primary and fallback are swappable.
 *
 * `fetchSeries` RETURNS NORMALISED OBSERVATIONS. An adapter that returned its
 * upstream's own quote direction would push the DEXUSEU/DEXCAUS problem back
 * out to every caller, which is the failure this interface exists to prevent.
 */
export type FxSource = {
  id: string;
  /** Currencies this source can serve. Asked before it is called. */
  supports(currency: string): boolean;
  fetchSeries(currency: string, fromISO: string, toISO: string): Promise<FxObservation[]>;
};

// ── the non-trading-day rule ───────────────────────────────────────────────

/**
 * How far back a spot lookup may walk to find an observation.
 *
 * MEASURED, NOT PICKED: both FRED series omit weekends entirely (2024-06-30, a
 * Sunday, returned NO ROW AT ALL rather than a placeholder — relay 35494551985),
 * and ECB does the same. So a balance-sheet date landing on a weekend needs at
 * most two days of walk-back; a weekend plus a long public holiday needs four.
 * Seven covers every real calendar gap and still refuses a series that has
 * simply stopped being published, which is the case that must NOT silently
 * resolve to a stale rate.
 */
export const FX_SPOT_BACKFILL_DAYS = 7;

/**
 * The fraction of a span's days that must carry an observation for an average
 * to be honest.
 *
 * A MEAN OVER HALF A QUARTER IS NOT A QUARTER'S MEAN, and it looks exactly like
 * one. Business days are ~5/7 of calendar days, so a fully-covered span sits
 * near 0.71 and this bar sits just under it — high enough that a series with a
 * real hole refuses, low enough that a holiday-heavy quarter still passes.
 */
export const FX_AVERAGE_MIN_COVERAGE = 0.6;

const DAY = 86400000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * THE RATE ON A BALANCE-SHEET DATE — spot, walking BACKWARD when the market
 * was shut.
 *
 * ── BACKWARD, NEVER FORWARD, AND THIS IS THE RULE THAT KEEPS HISTORY STILL ──
 * Forward-filling would take the NEXT published rate after the balance-sheet
 * date. For a period that ended last Friday, "the next rate" does not exist
 * yet, so the figure would render one way today and a different way on Monday —
 * a historical number that moves. Walking backward uses only rates that already
 * existed on the date in question, so the answer is fixed the moment the date
 * passes and can never be revised by the passage of time.
 *
 * It is also the honest reading: a balance sheet dated 30 June is denominated
 * at what a unit was worth on 30 June, and the last actual trade before that is
 * the closest thing published.
 */
export function spotOn(series: FxSeries, dateISO: string): FxObservation | null {
  const target = Date.parse(dateISO);
  if (!Number.isFinite(target)) return null;
  // The newest observation at or before the target. Scanned from the end
  // because the series is date-ordered and the answer is almost always near it.
  let best: FxObservation | null = null;
  for (const o of series.observations) {
    if (o.date > dateISO) break;
    best = o;
  }
  if (!best) return null;
  const gap = (target - Date.parse(best.date)) / DAY;
  // A GAP WIDER THAN THE RULE IS A REFUSAL, not a stale rate. A series that
  // stopped publishing would otherwise convert every period after it at the
  // last rate it ever had, silently and forever.
  if (gap > FX_SPOT_BACKFILL_DAYS) return null;
  return best;
}

/**
 * THE RATE ACROSS A DURATION — the mean of every observation inside it.
 *
 * ── WHY AN AVERAGE AND NOT THE CLOSING SPOT ────────────────────────────────
 * An income-statement line is earned throughout a period, not at its last
 * instant. Converting a full year of revenue at 31 December's rate prices
 * twelve months of trading at one day's exchange rate, and in a year where the
 * currency moved 10% that is a 10% error in the headline figure. The balance
 * sheet is the opposite case — it IS a single instant — which is why the two
 * selectors are separate functions rather than one with a flag.
 *
 * INCLUSIVE OF BOTH ENDS, and unweighted. A trading-volume weighting would be
 * more accurate and is not available: nothing here knows when in the period the
 * revenue was earned, and inventing a weighting would be a guess dressed as
 * precision.
 */
export function averageOver(
  series: FxSeries,
  startISO: string,
  endISO: string
): { usdPerUnit: number; observations: number; coverage: number } | null {
  const start = Date.parse(startISO);
  const end = Date.parse(endISO);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const inSpan = series.observations.filter((o) => o.date >= startISO && o.date <= endISO);
  if (!inSpan.length) return null;
  const days = Math.round((end - start) / DAY) + 1;
  const coverage = inSpan.length / days;
  // NOT ENOUGH OF THE PERIOD IS COVERED. Returning the mean of what happened to
  // be there would answer a different question than the one asked, in the same
  // units and to the same number of decimal places.
  if (coverage < FX_AVERAGE_MIN_COVERAGE) return null;
  const sum = inSpan.reduce((a, o) => a + o.usdPerUnit, 0);
  return { usdPerUnit: sum / inSpan.length, observations: inSpan.length, coverage };
}

// ── the sources ────────────────────────────────────────────────────────────

/**
 * FRED's clean-CSV endpoint for the H.10 series — the PRIMARY.
 *
 * H.10 is the source the brief names. The raw federalreserve.gov release pages
 * serve HTML, and the Data Download Program needs an opaque per-package
 * `series=` hash; fredgraph.csv publishes the same H.10 series as CSV with a
 * stable, readable id, so this is H.10's data by its documented machine route.
 *
 * MEASURED (relay 35494551985): both series returned `application/csv`, 2008
 * daily observations from 2019-01-02 to 2026-09-11, and zero "." placeholders
 * across that range.
 */
const FRED_SERIES: Record<string, { id: string; quote: "usd-per-unit" | "unit-per-usd" }> = {
  // DEXUSEU is U.S. DOLLARS to one EURO — already the direction everything
  // downstream wants.
  EUR: { id: "DEXUSEU", quote: "usd-per-unit" },
  GBP: { id: "DEXUSUK", quote: "usd-per-unit" },
  // DEXCAUS is CANADIAN DOLLARS to one U.S. DOLLAR — the other way round, and
  // the reason `quote` exists as a field rather than a comment.
  CAD: { id: "DEXCAUS", quote: "unit-per-usd" },
  JPY: { id: "DEXJPUS", quote: "unit-per-usd" },
  CHF: { id: "DEXSZUS", quote: "unit-per-usd" },
  BRL: { id: "DEXBZUS", quote: "unit-per-usd" },
};

/**
 * A 200 CARRYING HTML IS NOT DATA.
 *
 * The same rule fetchCompanyFacts applies, and the one that would have caught
 * the federalreserve.gov probes as junk rather than as an empty series: every
 * one of them returned HTTP 200 with the Fed's site chrome in the body. Parsing
 * that as a rate file yields zero observations and looks like a quiet day.
 */
function csvRowsOrNull(body: string): string[][] | null {
  const text = body.trim();
  if (!text || /^<!DOCTYPE|^<html/i.test(text)) return null;
  const lines = text.split("\n");
  if (!/^[A-Za-z_]+,[A-Za-z0-9_]+/.test(lines[0] ?? "")) return null;
  return lines.slice(1).map((l) => l.split(","));
}

export function fredSource(fetchImpl: typeof fetch = fetch): FxSource {
  return {
    id: "fred-h10",
    supports: (currency) => currency in FRED_SERIES,
    async fetchSeries(currency, fromISO, toISO) {
      const spec = FRED_SERIES[currency];
      if (!spec) return [];
      const url =
        `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${spec.id}` +
        `&cosd=${fromISO}&coed=${toISO}`;
      const res = await fetchImpl(url, { headers: { Accept: "text/csv" } });
      if (!res.ok) throw new Error(`FRED ${spec.id}: HTTP ${res.status}`);
      const rows = csvRowsOrNull(await res.text());
      if (!rows) throw new Error(`FRED ${spec.id}: response was not CSV`);
      return normalise(rows, spec.quote);
    },
  };
}

/**
 * Rows to normalised observations, dropping what cannot be a rate.
 *
 * FRED writes "." for a day inside the series' range with no observation. It
 * parses to NaN, which Number.isFinite rejects — but a guard written as
 * `Number(x) || 0` would turn it into ZERO, and a conversion rate of zero makes
 * every figure on the page zero without raising anything. Hence an explicit
 * finite-and-positive test rather than a truthiness check.
 */
function normalise(rows: string[][], quote: "usd-per-unit" | "unit-per-usd"): FxObservation[] {
  const out: FxObservation[] = [];
  for (const [rawDate, rawVal] of rows) {
    const date = (rawDate ?? "").trim();
    const val = Number((rawVal ?? "").trim());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!Number.isFinite(val) || val <= 0) continue;
    out.push({ date, usdPerUnit: quote === "usd-per-unit" ? val : 1 / val });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

/**
 * The ECB reference rates — the FALLBACK.
 *
 * EVERYTHING IS QUOTED AGAINST THE EURO, so only EUR is a direct lookup and
 * every other currency is a CROSS: USD-per-CCY = (USD per EUR) ÷ (CCY per EUR).
 * Measured 2026-09-18, CAD: 1.146 / 1.6056 = 0.7138 USD per CAD.
 *
 * That is two fetches where FRED needs one, and it is why this is the fallback
 * rather than a peer: a cross compounds both series' gaps, so a day missing
 * from either side is a day with no rate at all.
 */
export function ecbSource(fetchImpl: typeof fetch = fetch): FxSource {
  const series = async (ccy: string, fromISO: string, toISO: string) => {
    const url =
      `https://data-api.ecb.europa.eu/service/data/EXR/D.${ccy}.EUR.SP00.A` +
      `?startPeriod=${fromISO}&endPeriod=${toISO}&format=csvdata`;
    const res = await fetchImpl(url, { headers: { Accept: "text/csv" } });
    if (!res.ok) throw new Error(`ECB ${ccy}: HTTP ${res.status}`);
    const text = (await res.text()).trim();
    if (!text || /^<!DOCTYPE|^<html/i.test(text)) throw new Error(`ECB ${ccy}: response was not CSV`);
    const lines = text.split("\n");
    const header = (lines[0] ?? "").split(",");
    const tIdx = header.indexOf("TIME_PERIOD");
    const vIdx = header.indexOf("OBS_VALUE");
    // BY COLUMN NAME, NOT BY POSITION. The ECB payload carries ~18 columns and
    // has gained some before; a positional read is the shifted-array failure
    // secFactCodec's `cell()` exists to prevent, one file over.
    if (tIdx < 0 || vIdx < 0) throw new Error(`ECB ${ccy}: no TIME_PERIOD/OBS_VALUE columns`);
    const out = new Map<string, number>();
    for (const line of lines.slice(1)) {
      const cells = line.split(",");
      const date = (cells[tIdx] ?? "").trim();
      const val = Number((cells[vIdx] ?? "").trim());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (!Number.isFinite(val) || val <= 0) continue;
      out.set(date, val);
    }
    return out;
  };

  return {
    id: "ecb-reference",
    // Anything ECB publishes against the euro. EUR itself is the trivial case.
    supports: () => true,
    async fetchSeries(currency, fromISO, toISO) {
      const usdPerEur = await series("USD", fromISO, toISO);
      if (currency === "EUR") {
        return [...usdPerEur].map(([date, v]) => ({ date, usdPerUnit: v }))
          .sort((a, b) => (a.date < b.date ? -1 : 1));
      }
      const ccyPerEur = await series(currency, fromISO, toISO);
      const out: FxObservation[] = [];
      for (const [date, usd] of usdPerEur) {
        const ccy = ccyPerEur.get(date);
        // BOTH SIDES OR NEITHER. A cross needs the same day on both legs; using
        // the nearest available day on one leg would mix two dates' rates into
        // one number that belongs to neither.
        if (ccy === undefined || !(ccy > 0)) continue;
        out.push({ date, usdPerUnit: usd / ccy });
      }
      out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      return out;
    },
  };
}

/**
 * Primary, then fallback, and SAY WHICH ANSWERED.
 *
 * The source id travels with the series so a stored conversion can record what
 * produced it. Two sources that disagree by a fraction of a percent are normal;
 * a figure that cannot say which one it used is not auditable at all.
 */
export async function loadSeries(
  currency: string,
  fromISO: string,
  toISO: string,
  sources: FxSource[]
): Promise<FxSeries | null> {
  const failures: string[] = [];
  for (const source of sources) {
    if (!source.supports(currency)) continue;
    try {
      const observations = await source.fetchSeries(currency, fromISO, toISO);
      if (observations.length) return { currency, source: source.id, observations };
      failures.push(`${source.id}: empty`);
    } catch (err) {
      // TRIED AND FAILED IS NOT THE SAME AS NOT TRIED, and the fallback only
      // means anything if the primary's failure does not abort the lookup.
      failures.push(`${source.id}: ${(err as Error)?.message ?? err}`);
    }
  }
  if (failures.length) console.warn(`[fx] no series for ${currency} — ${failures.join("; ")}`);
  return null;
}

/** The default chain: H.10 via FRED, then the ECB reference rates. */
export const defaultSources = (): FxSource[] => [fredSource(), ecbSource()];

/** ISO date `days` before `dateISO`, for sizing a fetch window. */
export const isoDaysBefore = (dateISO: string, days: number) =>
  iso(Date.parse(dateISO) - days * DAY);
