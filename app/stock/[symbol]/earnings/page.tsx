import type { Metadata } from "next";
import { fmpFetch } from "@/lib/server/fmpUsage";
import { toDashed } from "@/lib/symbolSpellings.mjs";
import Link from "next/link";
import EarningsSymbolPicker from "./EarningsSymbolPicker";
import { getDailyBars, getDailyHistory } from "@/lib/server/historyCache";
import { getLatestEarningsData } from "@/lib/latest-earnings-data";
import {
  computeIndicatorSeed,
  type Point,
} from "@/lib/indicators";
import ShareButton from "@/app/components/ShareButton";
import TickerLogo from "@/app/components/TickerLogo";
import { WatermarkVisibilityProvider, HideWatermarksBar, EarningsScoreWatermark } from "@/app/components/WatermarkVisibility";
import { cikForSymbol, resolveFactSetForRender } from "@/lib/server/secColdFetch";
import { buildSecEarningsView, epsBasisNote, periodWords } from "@/lib/server/secEarningsView";
// ONLY WHAT THIS FILE RENDERS. The tone words, the band note, the trend
// median and the waterfall gate are imported by SecEarningsCards.tsx, which is
// where they are drawn; re-importing them here would just be a second name for
// the same rule.
import {
  toneBg, toneColor,
  type EarningsTone as PresentationTone,
} from "@/lib/server/secPresentation";
// THE SCORER, WHICH USED TO BE 340 LINES OF THIS FILE. It moved out whole so
// the sidebar snapshot card could call the SAME function rather than grow a
// second one over the same view — see the header of secEarningsScore.ts.
//
// coverageOf comes with it: the partial-coverage range needs the per-component
// weights, and it is the SAME function the sidebar card calls, so the two
// surfaces cannot report different coverage for one stock.
import {
  SCORE_COMPONENTS, coverageOf, scoreFromSec,
} from "@/lib/server/secEarningsScore";
import { valuationInputs } from "@/lib/server/secValuation";
import {
  HiddenCard, SecSnapshotCard, SecGrowthMarginsCard, SecAnnualCard, SecCashQualityCard,
  SecBalanceSheetCard, SecIncomeStatementCard, SecRecentPeriodsCard,
  SecTrendSummaryCard, SecValuationCard,
  SecPendingCard, SecNoXbrlCard, SecNoQuartersCard, SecNotIssuerEquityCard,
  SecNoRegistrantCard, SecScoreCard,
} from "./SecEarningsCards";
import { getRelatedSymbols } from "@/lib/curatedSymbols";
import RelatedStocks from "@/app/components/RelatedStocks";
import { readReportDatesChecked } from "@/lib/server/secReportDatesStore";
import { outlookForEarningsCard } from "@/lib/server/symbolOutlook";
import NextReportCard from "./NextReportCard";
import { reactionPeriodLabels } from "@/lib/server/secFactStore";
import { NO_PRICE_HISTORY_NOTE, reactionBarLabels } from "@/lib/server/secReportDates";
import { PriceReactionCard, type DriftQuarter, type SingleBarPoint } from "./ReactionCharts";

// No segment config here on purpose -- it cascades from
// app/stock/[symbol]/layout.tsx (`revalidate = 900`), so the overview, /news
// and /earnings share one cache policy and cannot drift apart. This page used
// to carry `dynamic = "force-dynamic"`, which meant every request and every
// crawl paid a full serverless render (~575 in 24h) of what is, between
// reports, the same HTML.

type Props = {
  params: Promise<{ symbol: string }>;
};

/**
 * ── WHERE THE DATES ON THIS PAGE COME FROM ────────────────────────────────
 *
 * Preferred: the company's own 8-K Item 2.02 filings (6-K for a foreign
 * private issuer), read from `submissions` by the sec-facts cron and stored
 * per symbol. FMP's /earnings calendar is the fallback, for symbols the cron
 * has not reached yet.
 *
 * THE TWO ARE NOT INTERCHANGEABLE AND THE PAGE SAYS WHICH IT USED. A filing
 * timestamp is when the document reached EDGAR, which is at or after the press
 * release; a calendar date is a third party's record of the announcement. The
 * wording differs accordingly — see TIMING_WORDING, which describes the FILING
 * and never claims a release time nobody here observed.
 *
 * THE NEXT REPORT CARRIES NO DATE FROM EITHER SOURCE. Past announcements are
 * filed facts; the next one is an estimate, and it renders as the 30-day band
 * (see NextReportCard and lib/server/symbolOutlook.ts).
 */

type EarningsReactionPoint = {
  label: string;
  reactionPct: number | null;
  volumeMultiple: number | null;
  drift5Pct: number | null;
  drift20Pct: number | null;
  /** Fewer than 5 / 20 trading days have passed since the reaction session. */
  drift5Pending: boolean;
  drift20Pending: boolean;
  /**
   * WHY there are no figures, when there are none. Null means the figures are
   * present, or absent for an ordinary reason the card already explains.
   *
   * "uncovered" is the one case worth naming: the price series does not reach
   * back to this report. See NO_PRICE_HISTORY_NOTE.
   */
  reason: "uncovered" | null;
};

const FMP_BASE = "https://financialmodelingprep.com/stable";

function cleanSymbol(value: string) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "")
    .trim();
}

type FmpEarningsRow = {
  symbol?: string;
  date?: string;
  fiscalLabel?: string;
  fiscalYear?: string;
  periodEndDate?: string;
  epsActual?: number | null;
  epsEstimated?: number | null;
  revenueActual?: number | null;
  revenueEstimated?: number | null;
  lastUpdated?: string;
  time?: string;
};

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}





/**
 * How far past a report date the next trading session may be.
 *
 * See the fallback inside computeEarningsReactionDetail: a weekend plus a long
 * holiday, and no further. It is the same shape as FX_SPOT_BACKFILL_DAYS in
 * fxRates and for the same reason — a gap wider than the rule means the series
 * does not cover the date, not that the nearest value will do.
 */
const REACTION_SESSION_GAP_DAYS = 7;

function computeEarningsReactionDetail(row: FmpEarningsRow, points: Point[]): { reactionPct: number | null; volumeMultiple: number | null; drift5Pct: number | null; drift20Pct: number | null; drift5Pending: boolean; drift20Pending: boolean; reason: "uncovered" | null } {
  const empty = { reactionPct: null, volumeMultiple: null, drift5Pct: null, drift20Pct: null, drift5Pending: false, drift20Pending: false, reason: null as "uncovered" | null };
  /** The series does not reach this report — a fact about the bars, not the filing. */
  const uncovered = { ...empty, reason: "uncovered" as const };
  if (!row.date || !points.length) return empty;
  const dates = points.map((p) => p.date);
  let idx = dates.indexOf(row.date);
  if (idx === -1) {
    // ── THE NEXT SESSION, BUT ONLY IF IT IS ACTUALLY THE NEXT SESSION ──────
    //
    // A report lands on a weekend or a holiday and the reaction happens at the
    // next open, so falling forward is right — for a gap of DAYS.
    //
    // UNBOUNDED, IT SILENTLY ATTRIBUTES ANY OLD REPORT TO THE FIRST BAR HELD.
    // MEASURED (relay 35498747512): CNI's cached bars begin 2021-09-21 and it
    // has reports from 2009-07-20, 2009-10-20, 2020-01-28 and 2021-01-26 — all
    // four predate the series, all four fell through to index 0, and all four
    // rendered the IDENTICAL figures (react -0.3, vol 0.85, d5 0.6, d20 7.8).
    // Four different reports, one real bar, four plausible wrong numbers on a
    // live page. Nothing about the output said so; only the repetition did,
    // and the labels differ so the repetition is not obvious either.
    //
    // 7 DAYS covers a weekend plus a long public holiday, which is the whole
    // of the case this fallback exists for. Beyond that the series simply does
    // not cover the report, and the honest answer is no answer.
    const next = dates.findIndex((d) => d >= String(row.date));
    const gapDays =
      next === -1 ? Infinity : (Date.parse(dates[next]) - Date.parse(String(row.date))) / 86400000;
    idx = next !== -1 && gapDays <= REACTION_SESSION_GAP_DAYS ? next : -1;
    if (idx === -1) return uncovered;
  }
  if (idx === -1) return empty;
  const time = (row.time || "").toLowerCase();
  let baseIdx: number;
  let reactIdx: number;
  if (time === "bmo") { baseIdx = idx - 1; reactIdx = idx; }
  else if (time === "amc") { baseIdx = idx; reactIdx = idx + 1; }
  else { baseIdx = idx - 1; reactIdx = idx + 1; }

  // A REPORT AT THE VERY EDGE OF THE SERIES HAS NO PRIOR CLOSE. This was
  // already the outcome — points[-1] is undefined and every figure fell to
  // null — but by accident rather than by decision, so it is stated.
  if (baseIdx < 0) return uncovered;

  const base = points[baseIdx]?.close;
  const react = points[reactIdx]?.close;
  const reactionPct = typeof base === "number" && typeof react === "number" && Number.isFinite(base) && Number.isFinite(react) && base !== 0
    ? ((react - base) / Math.abs(base)) * 100
    : null;

  const reactionVolume = points[reactIdx]?.volume;
  let volumeMultiple: number | null = null;
  if (typeof reactionVolume === "number" && Number.isFinite(reactionVolume) && reactionVolume > 0) {
    const lookback = 20;
    const windowStart = Math.max(0, baseIdx - lookback + 1);
    const window = points.slice(windowStart, baseIdx + 1)
      .map((p) => p.volume)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
    if (window.length) {
      const avgVolume = window.reduce((a, b) => a + b, 0) / window.length;
      if (avgVolume > 0) volumeMultiple = reactionVolume / avgVolume;
    }
  }

  let drift5Pct: number | null = null;
  let drift20Pct: number | null = null;
  if (typeof base === "number" && Number.isFinite(base) && base !== 0) {
    const close5 = points[reactIdx + 4]?.close;
    const close20 = points[reactIdx + 19]?.close;
    if (typeof close5 === "number" && Number.isFinite(close5)) drift5Pct = ((close5 - base) / Math.abs(base)) * 100;
    if (typeof close20 === "number" && Number.isFinite(close20)) drift20Pct = ((close20 - base) / Math.abs(base)) * 100;
  }

  // NOT YET, AS OPPOSED TO NOT THERE. The series simply ends before the
  // horizon: the chart draws a "not yet" marker rather than a bar or a gap.
  const drift5Pending = drift5Pct === null && reactionPct !== null && reactIdx + 4 > points.length - 1;
  const drift20Pending = drift20Pct === null && reactionPct !== null && reactIdx + 19 > points.length - 1;
  return { reactionPct, volumeMultiple, drift5Pct, drift20Pct, drift5Pending, drift20Pending, reason: null };
}


// Calls the shared lib/latest-earnings-data.ts function IN-PROCESS instead of
// self-fetching this deployment's own /api/stock-earnings/[symbol] route over
// HTTP. That route is BotID-protected (instrumentation-client.ts), and BotID
// only validates a signed header a real browser attaches client-side -- a
// server-to-server self-fetch never carries one, so it always reads as an
// unverified bot and 403s itself. This function used `cache: "no-store"`, so
// every single request hit that self-block with zero caching cushion; the
// failure was masked because the caller falls back to a locally-computed
// score (scoreEarnings()) whenever this returns null, so the page never
// visibly broke -- it just silently used the wrong (non-canonical) score on
// every load. Same self-block failure mode as
// claude/pickers-firewall-selfblock-2026-07-17.md and
// claude/stock-page-earnings-selfblock-2026-07-21.md.






async function fetchFmpJson<T>(path: string): Promise<T | null> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return null;
  const url = `${FMP_BASE}${path}${path.includes("?") ? "&" : "?"}apikey=${apiKey}`;
  try {
    const response = await fmpFetch(url, { next: { revalidate: 60 * 60 * 6 } });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch { return null; }
}


async function getEarningsData(symbol: string) {
  // ── WHAT THIS PAGE READS, AND FROM WHERE ──────────────────────────────────
  //
  // EVERY FINANCIAL NUMBER COMES FROM THE STORED SEC FACT SET. One Redis GET,
  // written by /api/jobs/sec-facts from data.sec.gov's companyfacts. Revenue,
  // EPS, margins, cash flow, the balance sheet and the P&L all come from there.
  //
  // TWO FMP CALLS REMAIN, AND BOTH ARE PRICE-DERIVED, WHICH THIS PASS DOES NOT
  // TOUCH. /earnings supplies the ANNOUNCEMENT date and its before-open /
  // after-close timing, which SEC filings do not carry -- a filing date is not
  // an announcement date, and the price-reaction card needs the session the
  // market actually reacted in. getDailyHistory supplies the bars. Market cap,
  // P/E and the reaction card are still on FMP; the bars have not moved.
  // THIS IS NOT A COMPLETE MIGRATION AND MUST NOT BE DESCRIBED AS ONE.
  // ── ONE GET BEFORE THE REST, AND IT DECIDES WHETHER FMP IS CALLED AT ALL ──
  //
  // Serial on purpose. The record says whether this symbol's announcement dates
  // are known from its own filings; if they are, the /earnings call below has
  // nothing left to supply and is skipped entirely. Putting it in the group
  // below would save a round trip and keep paying FMP for an answer already in
  // Redis, which is the call this step exists to remove.
  // CHECKED, so an unreadable store is not mistaken for "no record": the
  // next-report card says "cannot be shown right now" for the first and names
  // the missing record for the second. Everything else here wants only `rec`.
  const secRead = await readReportDatesChecked(symbol);
  const secDates = secRead.ok ? secRead.rec : null;
  const secEvents = (secDates?.events ?? []).filter((e) => e.periodEnd);
  /**
   * THE EIGHT REPORTS THE REACTION CHART WALKS — ONE LIST, TWO READERS.
   *
   * `barRows` builds the chart from these, and the bar-fetch window below is
   * sized to cover them. Those were two separate `secEvents.slice(0, 8)` calls,
   * which is the shape where one gains a condition and the other does not:
   * widening the chart to ten reports without widening the window would fetch
   * a range that stops short of the two oldest, and the only symptom would be
   * two cards quietly missing their drift figures.
   */
  const REACTION_REPORTS = 8;
  const barEvents = secEvents.slice(0, REACTION_REPORTS);

  // ── HOW MANY BARS THIS RENDER ACTUALLY NEEDS ─────────────────────────────
  //
  // computeEarningsReactionDetail reaches 20 trading days BACK from each report
  // (the volume-average lookback) and 20 FORWARD (drift20), so the window is
  // +/-20 trading days around the oldest and newest of the eight reports.
  // 45 CALENDAR days covers that with room for holidays and long weekends —
  // and the buffer is deliberately generous because a window one day too
  // narrow does not error, it drops drift20 to null and the card simply shows
  // fewer numbers.
  //
  // ONLY ON THE SEC-DATES PATH, and that is the whole reason it costs nothing:
  // `secDates` is already read serially above, so when the filings supply the
  // announcement dates the window is known BEFORE this fetch starts. On the
  // FMP fallback the dates arrive in the same round trip that would have to
  // carry them, so bounding would mean a second sequential read — worse than
  // the thing it saves. That path keeps the full series.
  const BAR_WINDOW_DAYS = 45;
  const shiftIso = (iso: string, days: number) =>
    new Date(Date.parse(iso) + days * 86400000).toISOString().slice(0, 10);
  const barWindow = (() => {
    const dates = barEvents.map((e) => e.announcedOn).filter(Boolean).sort();
    if (!dates.length) return null;
    return {
      from: shiftIso(dates[0], -BAR_WINDOW_DAYS),
      to: shiftIso(dates[dates.length - 1], BAR_WINDOW_DAYS),
    };
  })();

  const [cold, dailyHistory, latestBars, earningsJson] = await Promise.all([
    resolveFactSetForRender(symbol),
    // THE ~110 KB MEASUREMENT THAT ASKED FOR A BOUNDED RANGE now lives on
    // getDailyBars in lib/server/historyCache.ts, with the thing it justifies —
    // including what a range does NOT save, which is the Redis read itself:
    // bars are one value per symbol, so the GET returns every bar whatever
    // range is asked for. What it saves is everything downstream of it.
    barWindow
      ? getDailyBars(symbol, barWindow.from, barWindow.to, { caller: "stock-earnings" })
          .catch(() => [] as Point[])
      : getDailyHistory(symbol, { caller: "stock-earnings" }).catch(() => [] as Point[]),
    // ── THE WHOLE SERIES, FOR ITS LAST BAR AND NOTHING ELSE ─────────────────
    //
    // The valuation card needs the MOST RECENT close. The window above is
    // sized around report dates, which is right for the reaction chart and
    // wrong for this: a filer that has not reported recently has a window that
    // stops months short of today. MEASURED ON THE PREVIEW — RYAAY priced at
    // 50.40 as of 2025-05-15 against a live 53.51, CNI at 106.22 as of
    // 2026-03-16 against 118.95. ABEV looked fine only because its report
    // cycle happens to be current, which is why one symbol passing proves
    // nothing about the others.
    //
    // THIS COSTS NOTHING. getDailyBars is a view over getDailyHistory, and
    // getDailyHistory dedupes by symbol while a read is in flight — both
    // entries of this Promise.all start in the same tick, so the second finds
    // the first's promise already registered and awaits it. One read, two
    // shapes of answer.
    getDailyHistory(symbol, { caller: "stock-earnings-valuation" }).catch(() => [] as Point[]),
    // SKIPPED WHEN THE FILINGS ALREADY ANSWER IT. Not "fetched and ignored":
    // an ignored fetch still costs the request, and the daily FMP limit is the
    // thing the owner has said not to spend.
    secEvents.length
      ? Promise.resolve(null)
      : fetchFmpJson<unknown[]>(`/earnings?symbol=${encodeURIComponent(toDashed(symbol))}`),
  ]);
  const secView = cold.status === "ready" ? buildSecEarningsView(cold.set) : null;

  // DATES AND TIMING ONLY. epsActual/revenueActual are deliberately not read
  // off these rows any more, even though they are present: two sources for one
  // number is the divergence this repo keeps finding
  // (claude/traps/two-validators-for-one-value.md), and the SEC figure is the
  // one the page states its source as.
  const earningsRows: FmpEarningsRow[] = Array.isArray(earningsJson)
    ? earningsJson
        .map((item) => {
          const row = item as Record<string, unknown>;
          return {
            symbol,
            date: typeof row.date === "string" ? row.date : "",
            epsActual: asNumber(row.epsActual),
            revenueActual: asNumber(row.revenueActual),
            time: typeof row.time === "string" ? row.time.toLowerCase() : undefined,
          } as FmpEarningsRow;
        })
        .filter((row) => Boolean(row.date))
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    : [];

  const completedRows = earningsRows.filter(
    (row) => row.epsActual != null || row.revenueActual != null
  );
  const latest = completedRows[0] ?? null;

  const todayIso = new Date().toISOString().slice(0, 10);
  const startOfTodayUtcMs = new Date(`${todayIso}T00:00:00Z`).getTime();
  const next = earningsRows
    .filter((row) => {
      if (!row.date) return false;
      const dt = new Date(`${row.date}T00:00:00Z`);
      return dt.getTime() >= startOfTodayUtcMs && row.epsActual == null && row.revenueActual == null;
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] ?? null;

  // ── THE REACTION CARD, KEYED TO THE FILING DATES ─────────────────────────
  //
  // TWO THINGS CHANGE WHEN THE SEC RECORD EXISTS, and both were wrong before:
  //
  //  1. THE LABEL COMES FROM THE MATCHED PERIOD END, not from the announcement
  //     date. A quarter that ended 30 June and was announced 30 July was
  //     labelled "Q3" — the calendar quarter of the announcement — so every
  //     bar on this chart named the quarter after the one it measured.
  //  2. THE SESSION COMES FROM THE FILING TIMESTAMP in Eastern time. A release
  //     after the close is digested by the NEXT day's close; before the open
  //     and during the session are both digested by the same day's close. That
  //     is exactly the two-way split `time` already encodes, so the existing,
  //     tested reaction arithmetic is reused rather than reimplemented:
  //     after-close maps to "amc", everything else to "bmo".
  // ── ONE VOCABULARY FOR THE WHOLE PAGE ────────────────────────────────────
  //
  // THE DEFECT: the bars were labelled by the CALENDAR quarter of a date, while
  // every other card on the page uses the filer's own fiscal label. AAPL's
  // latest bar read "Q2 26" under a snapshot calling the same filing Q3 FY2026;
  // ABT's read "Q1 26" against a newest quarter of Q2; AAP showed "Q4 23"
  // twice, and a "Q3 26" for a quarter that had not ended.
  //
  // So the label comes from the SAME stored period the rest of the page reads,
  // looked up by the matched period end. A bar whose period is unknown gets no
  // fiscal claim at all.
  // ── BUILT BY THE SHIPPED FUNCTION, NOT INLINE HERE ─────────────────────
  // The first version merged quarters and years into one map with years last,
  // so on a filer whose 10-Qs carry twelve-month comparatives every quarter
  // end was overwritten by an annual entry. See reactionPeriodLabels.
  const storedLabels = cold.status === "ready"
    ? reactionPeriodLabels(cold.set)
    : new Map<string, string>();

  const barRows: { periodEnd: string | null; announcedOn: string; row: FmpEarningsRow }[] =
    secEvents.length
      ? barEvents.slice().reverse().map((e) => ({
          periodEnd: e.periodEnd,
          announcedOn: e.announcedOn,
          row: { symbol, date: e.announcedOn, time: e.timing === "after-close" ? "amc" : "bmo" },
        }))
      : completedRows
          .slice(0, 8)
          .reverse()
          .filter((row): row is FmpEarningsRow & { date: string } => Boolean(row.date))
          .map((row) => ({ periodEnd: null, announcedOn: row.date, row }));

  const barLabels = reactionBarLabels(barRows, (end) => storedLabels.get(end));
  const reactionRows = barRows.map((b, i) => ({ label: barLabels[i], row: b.row }));

  const priceReactionQuarters: EarningsReactionPoint[] = reactionRows.map(({ label, row }) => ({
    label,
    ...computeEarningsReactionDetail(row, dailyHistory as Point[]),
  }));

  // ── THE NEXT REPORT ──────────────────────────────────────────────────────
  //
  // THE 30-DAY BAND, NEVER A DAY (owner decision, 2026-09-23). This used to
  // print estimateNextReport's date or month, or FMP's calendar date when the
  // filer's own record had not been read. It is now the /earnings-calendar
  // search's answer, from the same function (lib/server/symbolOutlook.ts).
  //
  // FMP's entry decides only whether the card renders: with no SEC record
  // behind it the card says so ("no-record") rather than printing the date.
  // outlookForEarningsCard is handed a boolean, not the date, on purpose.
  const nextReport = outlookForEarningsCard(
    symbol.trim().toUpperCase(), secRead, Boolean(next?.date), todayIso,
  );

  const score = scoreFromSec(secView, symbol.trim().toUpperCase(), cold);

  // ── THE VALUATION LEGS ───────────────────────────────────────────────────
  //
  // The SEC half comes from the stored set and refuses on its own terms (see
  // secValuation). The price half is the LAST BAR THIS RENDER ALREADY HOLDS —
  // no extra fetch, and no quote endpoint, because the bars are the series the
  // rest of this page is built on and a second price source would be a second
  // number for one fact.
  //
  // THE LAST BAR OF THE WHOLE SERIES, never of the reaction window — see the
  // fetch above for the measurement. The card still prints the date it closed
  // on, because a close is not a live quote, and refuses outright past
  // VALUATION_PRICE_MAX_AGE_DAYS: a market cap is a claim about today, and one
  // built on a year-old close is confidently wrong with nothing on screen to
  // say so.
  const valuation = cold.status === "ready" ? valuationInputs(cold.set, todayIso) : { shares: null, eps: null, refusals: [] };
  const lastBar = (latestBars as Point[]).at(-1) ?? null;
  const latestClose = typeof lastBar?.close === "number" && Number.isFinite(lastBar.close) ? lastBar.close : null;
  const latestCloseOn = lastBar?.date ?? null;

  return {
    earningsRows, completedRows, latest, next, nextReport,
    priceReactionQuarters, score, secView, cold,
    valuation, latestClose, latestCloseOn,
    /**
     * THE DATE THIS RENDER RAN, read once here rather than inside a component.
     * A card that called Date.now() itself would be untestable and would also
     * differ between the server render and any later hydration.
     */
    renderedOn: new Date().toISOString().slice(0, 10),
    /** SYMBOLS-level provenance, rendered on the card rather than assumed. */
    datesFromSec: secEvents.length > 0,
    /**
     * A quarter announced whose figures SEC has not published yet. Read from
     * the stored record, computed by the cron — the page does not derive it,
     * because deriving it needs the submissions feed and the page has no
     * business fetching EDGAR on a render.
     */
    pendingResults: secDates?.pending ?? null,
  };
}


// CONVERTS FOR THE SAME REASON /stock/[symbol]/news's fetchQuoteForMeta does:
// the route parameter arrives as the reader typed it, "BRK.B", and FMP files
// Berkshire's B class as BRK-B.
//
// WHAT THIS DOES NOT CHANGE, so nobody verifies the wrong thing: the <title>
// price. generateMetadata prints seed.lastClose, which is the newest bar of
// getDailyHistory (already dashed via buildFmpSymbol). The price returned here
// lands in seed.price and the title never reads it.
async function fetchQuoteForMeta(symbol: string): Promise<{ price: number | null; date: string | null }> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return { price: null, date: null };
  try {
    const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(toDashed(symbol))}&apikey=${encodeURIComponent(apiKey)}`;
    const res = await fmpFetch(url, { next: { revalidate: 900 }, headers: { accept: "application/json" } });
    if (!res.ok) return { price: null, date: null };
    const json = await res.json();
    const row = Array.isArray(json) ? json[0] : json;
    const price = typeof row?.price === "number" && Number.isFinite(row.price) ? (row.price as number) : null;
    return { price, date: new Date().toISOString().slice(0, 10) };
  } catch { return { price: null, date: null }; }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const clean = cleanSymbol(symbol);
  const [rawHistory, { price, date }] = await Promise.all([getDailyHistory(clean, { caller: "stock-earnings-meta" }).catch(() => []), fetchQuoteForMeta(clean)]);
  const points: Point[] = (rawHistory as Point[]).filter((p) => p.date && Number.isFinite(p.close));
  const seed = computeIndicatorSeed(points, "", price, date);
  const priceStr = seed.lastClose != null ? ` — Price $${seed.lastClose.toFixed(2)}` : "";
  const title = `${clean} Earnings, EPS & Revenue${priceStr} | MyStockHarbor`;
  // NO LONGER "EPS surprise, revenue surprise" -- the page stopped showing
  // either when FMP's analyst consensus left on 2026-09-15, and a description
  // promising them in search results is a promise the page cannot keep.
  //
  // ── AND NO TREND LABEL ───────────────────────────────────────────────────
  // It used to interpolate `seed.trend` as a BARE LABEL mid-sentence, so the
  // description read "...cash flow and balance sheet, Uptrend, with
  // year-over-year context..." on AAPL and "...balance sheet, Range / Mixed,
  // with..." on KGC. Two problems, and the second is the reason it is removed
  // rather than reworded:
  //
  //   1. It is a price-chart reading in an EARNINGS description — this page is
  //      built on filed figures and says nothing about moving averages.
  //   2. It changes with the price, so the same page advertises itself
  //      differently on different crawls, from data that is not on it.
  //
  // The /stock/[symbol] page states the trend too, and that is NOT this bug:
  // it uses buildSeoDescription, which writes it as a sentence ("AAPL is in an
  // uptrend") on the page whose subject IS the trend.
  const description = `Review ${clean} stock earnings as filed with the SEC: GAAP EPS, revenue, margins, cash flow and balance sheet, with year-over-year context and a simple earnings score.`;
  return {
    title, description,
    robots: {
      // NOINDEX WHEN THERE ARE NO FILINGS TO SHOW, the same rule and the same
      // reason as /stock/[symbol]: this route is enumerated, the no-registrant
      // state is now a 200 rather than a 404, and a 200 that can be indexed as
      // thin content is the cost of having stopped 404-ing. `follow` stays
      // true — the card links to a real stock page, and there is no reason to
      // strand a crawler that has arrived here.
      //
      // cikForSymbol is the CHEAP gate by design: the committed file, no
      // network and no Redis (see its docblock), so generateMetadata can ask
      // it without adding a round trip.
      index: cikForSymbol(clean) !== null,
      follow: true,
    },
    alternates: { canonical: `https://www.mystockharbor.com/stock/${clean}/earnings` },
    openGraph: { title: `${clean} Earnings & Earnings Score | MyStockHarbor`, description, url: `https://www.mystockharbor.com/stock/${clean}/earnings`, siteName: "MyStockHarbor", type: "article", images: [{ url: "https://www.mystockharbor.com/og-image-v2.png", width: 1200, height: 630, alt: "MyStockHarbor earnings dashboard" }] },
    twitter: { card: "summary_large_image", title: `${clean} Earnings & Earnings Score | MyStockHarbor`, description, images: ["https://www.mystockharbor.com/og-image-v2.png"] },
  };
}

export default async function StockEarningsPage({ params }: Props) {
  const { symbol } = await params;
  const clean = cleanSymbol(symbol);
  const data = await getEarningsData(clean);

  // THE CIK GATE IS NO LONGER A 404 — see SecNoRegistrantCard.
  //
  // WHAT THE 404 GOT RIGHT AND KEPT: nothing is fetched or queued for a symbol
  // with no CIK. The work bound is `cikForSymbol` returning null BEFORE any
  // network or Redis call, and that is unchanged. Rendering a static card costs
  // nothing and triggers nothing, so the bound never depended on the 404.
  //
  // WHAT IT GOT WRONG: /stock/MSTY renders while /stock/MSTY/earnings 404s, for
  // a symbol the site serves. And this route is enumerated — the sibling page's
  // own note records ~1,519 distinct request paths in the runtime logs — so the
  // house answer already exists one directory up: 200 with an honest state,
  // marked noindex, rather than a 404 on a real symbol or a 5xx that throttles
  // crawl rate site-wide. This follows it.
  const noRegistrant = data.cold.status === "no-cik";

  const nextReport = data.nextReport;
  const score = data.score;
  // HOW MUCH OF THE SCORE RAN. Shared with the sidebar card — see coverageOf.
  const coverage = coverageOf(score);
  const secView = data.secView;

  const reactionData: SingleBarPoint[] = data.priceReactionQuarters.map((q) => ({ label: q.label, value: q.reactionPct }));
  const driftQuarters: DriftQuarter[] = data.priceReactionQuarters.map((q) => ({
    label: q.label, reactionPct: q.reactionPct, drift5Pct: q.drift5Pct, drift20Pct: q.drift20Pct,
    drift5Pending: q.drift5Pending, drift20Pending: q.drift20Pending,
  }));
  // NAMED, NOT COUNTED. The reader is looking at labelled bars; a count tells
  // them a number is missing without telling them which.
  const uncoveredLabels = data.priceReactionQuarters
    .filter((q) => q.reason === "uncovered")
    .map((q) => q.label);
  const latestReaction = [...data.priceReactionQuarters].reverse().find((q) => q.reactionPct != null) ?? null;

  // Curated, deterministic set of OTHER stock symbols for the "Explore More
  // Stocks" internal-linking module (see lib/curatedSymbols.ts and
  // app/components/RelatedStocks.tsx).
  const relatedSymbols = getRelatedSymbols(clean);

  const pageJsonLd = {
    "@context": "https://schema.org", "@type": "WebPage",
    name: `${clean} Stock Earnings`,
    url: `https://www.mystockharbor.com/stock/${clean}/earnings`,
    description: `${clean} stock earnings from SEC filings: GAAP EPS, revenue, margins, cash flow and balance sheet.`,
    breadcrumb: { "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://www.mystockharbor.com/" },
      { "@type": "ListItem", position: 2, name: clean, item: `https://www.mystockharbor.com/stock/${clean}` },
      { "@type": "ListItem", position: 3, name: "Earnings", item: `https://www.mystockharbor.com/stock/${clean}/earnings` },
    ]},
  };

  return (
    <WatermarkVisibilityProvider>
      <main className="earningsPage">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(pageJsonLd) }} />

        <style>{`
        .earningsPage { min-height: 100vh; background: radial-gradient(circle at top left, rgba(59,130,246,0.12), transparent 28%), radial-gradient(circle at top right, rgba(34,197,94,0.09), transparent 26%), #06080d; color: #f1f5f9; font-family: system-ui, Arial; }
        .earningsWrap { max-width: 1240px; margin: 0 auto; padding: 24px 18px 52px; }
        .topLinks { display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
        .topLinks a, .earningsSearchRow button, .actionLink { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 10px 14px; border-radius: 12px; border: 1px solid rgba(59,130,246,0.32); background: rgba(59,130,246,0.10); color: #dbeafe; text-decoration: none; font-weight: 900; font-size: 13px; cursor: pointer; }
        .topLinks a.green, .actionLink.green { border-color: rgba(34,197,94,0.32); background: rgba(34,197,94,0.10); color: #dcfce7; }
        .hero { border: 1px solid rgba(255,255,255,0.08); border-radius: 28px; padding: 24px; background: linear-gradient(135deg, rgba(15,23,42,0.96), rgba(6,10,18,0.98)); box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 18px 38px rgba(0,0,0,0.24); display: grid; grid-template-columns: minmax(0, 1fr) 410px; gap: 24px; align-items: stretch; }
        .heroTopBar { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        .eyebrow, .smallLabel { font-size: 12px; font-weight: 950; text-transform: uppercase; letter-spacing: 0.08em; color: #93c5fd; }
        .hero h1 { margin: 12px 0 0; font-size: 46px; line-height: 1.04; letter-spacing: -0.055em; }
        .hero p { margin: 12px 0 0; color: rgba(226,232,240,0.80); line-height: 1.7; font-size: 16px; max-width: 760px; }
        .scoreCard { border: 1px solid ${toneColor(score.tone)}55; border-radius: 22px; padding: 18px; background: linear-gradient(135deg, ${toneBg(score.tone)}, rgba(255,255,255,0.026)); box-shadow: inset 0 1px 0 rgba(255,255,255,0.045); }
        .scoreTop { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
        .scorePill { display: inline-flex; align-items: center; justify-content: center; border: 1px solid ${toneColor(score.tone)}66; background: ${toneBg(score.tone)}; color: ${toneColor(score.tone)}; border-radius: 999px; padding: 8px 11px; font-weight: 950; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
        .scoreNumberRow { margin-top: 14px; display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        .scoreNumber { font-size: 48px; line-height: 1; font-weight: 950; letter-spacing: -0.06em; }
        .scoreWatermark { font-size: 15px; font-weight: 850; letter-spacing: 0.02em; color: rgba(255,255,255,0.24); }
        .scoreBar { position: relative; margin-top: 18px; height: 14px; border-radius: 999px; background: linear-gradient(90deg, #ef4444, #facc15, #22c55e); overflow: hidden; }
        /* A PARTIAL SCORE READS AS INK, NOT AS A VERDICT — see the card. */
        .scorePillPartial { background: rgba(148,163,184,0.14); border-color: rgba(148,163,184,0.38); color: #cbd5e1; letter-spacing: 0.01em; }
        .scoreNumberPartial { color: rgba(226,232,240,0.62); }
        /* The span the score could actually have landed in, under the needle. */
        .scoreReach { position: absolute; top: 0; bottom: 0; background: rgba(2,6,23,0.55); border-left: 1px solid rgba(226,232,240,0.45); border-right: 1px solid rgba(226,232,240,0.45); }
        .scoreReachNote { color: rgba(226,232,240,0.78); }
        .scoreNeedle { position: absolute; top: -5px; left: calc(${score.score}% - 9px); width: 18px; height: 24px; border-radius: 999px; background: #f8fafc; border: 3px solid ${toneColor(score.tone)}; box-shadow: 0 8px 20px rgba(0,0,0,0.32); }
        .scoreLabels { display: flex; justify-content: space-between; margin-top: 9px; color: rgba(226,232,240,0.70); font-size: 11px; font-weight: 950; text-transform: uppercase; letter-spacing: 0.07em; }
        .metricCard { padding: 12px 14px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.07); background: rgba(255,255,255,0.02); }
        .trendTag { font-size: 0.55em; font-weight: 800; letter-spacing: 0.02em; text-transform: uppercase; opacity: 0.75; margin-right: 2px; }
        .trendLatest { display: block; margin-top: 4px; font-size: 15px; font-weight: 900; letter-spacing: -0.02em; }
        .trendLatest .trendTag { font-size: 10px; }
        .cellShort { text-decoration: none; cursor: help; border-bottom: 1px dotted rgba(148,163,184,0.55); white-space: nowrap; }
        .crossTip { text-decoration: none; cursor: help; border-bottom: 1px dotted rgba(148,163,184,0.6); }
        .hero p.heroNote { margin-top: 10px; font-size: 12px; line-height: 1.5; color: rgba(148,163,184,0.85); }
        .infoTip { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px; margin-left: 6px; border-radius: 999px; border: 1px solid rgba(226,232,240,0.45); color: rgba(226,232,240,0.85); font-size: 10px; font-weight: 900; font-style: normal; text-transform: none; letter-spacing: 0; cursor: help; vertical-align: 1px; }
        .infoTip:focus { outline: 2px solid #93c5fd; outline-offset: 2px; }
        .infoTipText { display: none; position: absolute; right: -6px; bottom: calc(100% + 8px); z-index: 5; width: min(260px, 72vw); padding: 9px 11px; border-radius: 10px; border: 1px solid rgba(148,163,184,0.35); background: #0f172a; color: #e2e8f0; font-size: 12px; font-weight: 600; line-height: 1.5; text-align: left; box-shadow: 0 10px 24px rgba(0,0,0,0.35); }
        .infoTip:hover .infoTipText, .infoTip:focus .infoTipText { display: block; }
        .contentGrid { margin-top: 22px; display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.85fr); gap: 22px; align-items: start; }
        /* ── THE COLUMNS MUST BE ALLOWED TO BE NARROWER THAN THEIR CONTENT ───
           A grid ITEM defaults to 'min-width: auto', which resolves to its
           content's MIN-CONTENT width. 'minmax(0, …)' above bounds the TRACK
           and does nothing for the item inside it, so the item grows past its
           own column and, because '.card' is deliberately 'overflow: visible'
           for the metric tooltips, paints straight over the sticky aside.

           THAT IS THE ABVX BUG, and the chain is specific: a card holds a
           'div[overflow-x: auto]' wrapping a seven-column table. The wrapper
           can only scroll if something forces it narrower than the table, and
           nothing did — the auto min-width propagated the table's min-content
           all the way up to the grid item. Measured on the rendered cards, the
           longest unbreakable text token on this page is 14 characters, so the
           overflow was never text; it was always the tables.

           WHY IT SHOWS ON ABVX AND NOT OBVIOUSLY ON AAPL: the table's
           min-content width is its content. A row of "Not reported" is far
           wider than a row of "$2.03", so a filer whose cells are mostly
           refusals has the widest tables on the site. The bug is not
           ABVX-specific; its VISIBILITY is.

           'min-width: 0' restores the intended behaviour: the item shrinks to
           its track, the wrapper is forced narrower than its table, and the
           'overflow-x: auto' that was always there finally engages and gives
           the table a scrollbar instead of the aside. It is a no-op wherever
           nothing overflows. */
        .contentGrid > * { min-width: 0; }
        .hero > * { min-width: 0; }
        .metricGrid > * { min-width: 0; }
        /* ── AND THE CARDS THEMSELVES, WHICH IS WHERE THE FIRST FIX STOPPED ──
           Guarding only the two .contentGrid children was not enough and the
           preview still overlapped. MEASURED in Chromium against this page's
           real stylesheet and real rendered cards: the main column's own box
           sized correctly to its track at 26..786, and a .card INSIDE it
           reached 815 — 7px past the aside's left edge at 808.

           The column is a nested grid, so its cards are grid items too and
           carry their own 'min-width: auto'. Fixing the outer item moved the
           overflow down one level rather than removing it; the chain has to be
           unbroken from the track to the scroll wrapper or the wrapper is
           never forced narrow enough for its 'overflow-x: auto' to engage.

           Same measurement with this rule: scrollWidth 789 -> 760, equal to
           clientWidth, so the column no longer overflows at all; the widest
           card edge lands exactly on the column edge at 786; painted content
           stops 22px short of the aside, which is the grid gap. */
        .card, .scoreCard { min-width: 0; }
        .card { border: 1px solid rgba(255,255,255,0.08); border-radius: 22px; padding: 18px; background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.022)); box-shadow: inset 0 1px 0 rgba(255,255,255,0.035); overflow: visible; }
        .card h2, .card h3 { margin: 8px 0 0; letter-spacing: -0.035em; line-height: 1.15; }
        .card h2 { font-size: 26px; } .card h3 { font-size: 22px; }
        .card p { color: rgba(226,232,240,0.82); line-height: 1.7; }
        .metricGrid { margin-top: 16px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; overflow: visible; }
        .metricLabelWrap { position: relative; display: inline-flex; align-items: center; gap: 7px; max-width: 100%; overflow: visible; }
        .metricLabel { font-size: 11px; font-weight: 950; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(203,213,225,0.72); }
        .metricHelp { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 17px; height: 17px; border-radius: 999px; border: 1px solid rgba(147,197,253,0.30); background: #1e293b; color: #dbeafe; font-size: 11px; font-weight: 950; line-height: 1; cursor: help; z-index: 20; flex: 0 0 auto; }
        .metricHelpBubble { position: absolute; left: 50%; bottom: calc(100% + 10px); transform: translateX(-50%); width: 260px; max-width: min(260px, 72vw); padding: 11px 12px; border-radius: 13px; border: 1px solid rgba(147,197,253,0.22); background: #020617; color: #e5e7eb; box-shadow: 0 18px 44px rgba(0,0,0,0.55); font-size: 12px; font-weight: 750; letter-spacing: 0; line-height: 1.55; text-transform: none; text-align: left; opacity: 0; visibility: hidden; pointer-events: none; white-space: normal; z-index: 9999; }
        .metricHelpBubble::after { content: ""; position: absolute; left: 50%; top: 100%; transform: translateX(-50%); border-width: 7px; border-style: solid; border-color: #020617 transparent transparent transparent; }
        .metricHelp:hover .metricHelpBubble, .metricHelp:focus .metricHelpBubble, .metricHelp:focus-visible .metricHelpBubble { opacity: 1; visibility: visible; }
        .metricValue { margin-top: 8px; font-size: 24px; font-weight: 950; letter-spacing: -0.035em; }
        .earningsDataNote { margin: 10px 0 0; color: rgba(148,163,184,0.78); font-size: 12px; line-height: 1.45; }
        .metricSub { margin-top: 8px; font-size: 12px; line-height: 1.5; color: rgba(226,232,240,0.66); }
        .trendDots { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 14px; }
        .trendDot { text-align: center; min-width: 52px; }
        .trendDot span { display: inline-flex; width: 18px; height: 18px; border-radius: 999px; box-shadow: 0 0 0 6px rgba(255,255,255,0.04); }
        .trendDot strong { display: block; margin-top: 9px; font-size: 11px; color: rgba(241,245,249,0.86); }
        .chartLegend { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 14px; font-size: 11px; font-weight: 800; color: rgba(226,232,240,0.72); }
        .chartLegend span { display: inline-flex; align-items: center; gap: 6px; }
        .chartLegend i { display: inline-block; width: 9px; height: 9px; border-radius: 3px; }
        .chartRow { display: flex; align-items: stretch; gap: 8px; }
        .chartPlot { flex: 1 1 auto; min-width: 0; }
        .chartScale { position: relative; width: 66px; flex: 0 0 auto; border-left: 1px solid rgba(255,255,255,0.08); }
        .chartScale span { position: absolute; right: 4px; left: 4px; font-size: 11px; font-weight: 800; color: rgba(203,213,225,0.62); white-space: nowrap; text-align: right; overflow: visible; }
        .chartScale .scaleTop { top: 0; }
        .chartScale .scaleMid { top: 50%; transform: translateY(-50%); }
        .chartScale .scaleBottom { bottom: 0; }
        .chartScaleSpacer { width: 66px; flex: 0 0 auto; }
        .chartCategories { display: flex; flex: 1 1 auto; min-width: 0; margin-top: 6px; }
        .chartCategories .catShort { display: none; }
        .chartCategories > span { flex: 1 1 0; text-align: center; font-size: 11px; font-weight: 800; color: rgba(203,213,225,0.68); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 1px; }
        /* ── THE NEW MARKS ──────────────────────────────────────────────────
           Thin bars, 4px rounded data-ends anchored to the baseline, a 2px
           surface gap between adjacent fills, and recessive tracks. Text stays
           in the page's ink tokens — never the series colour — so a value is
           readable whether or not its mark's hue reaches the reader. */
        .toneChip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; border: 1px solid; font-size: 11px; font-weight: 900; letter-spacing: 0.02em; white-space: nowrap; }
        .toneChip i { display: inline-block; width: 7px; height: 7px; border-radius: 999px; flex: 0 0 auto; }

        .hbarList { margin-top: 14px; display: grid; gap: 12px; }
        .hbarRow { display: grid; gap: 6px; }
        .hbarHead { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
        .hbarLabel { font-size: 12px; font-weight: 850; color: rgba(203,213,225,0.80); }
        .hbarValue { font-size: 14px; font-weight: 950; color: #f1f5f9; letter-spacing: -0.02em; white-space: nowrap; }
        .hbarSub { font-size: 11px; color: rgba(148,163,184,0.72); }
        .hbarTrack { height: 8px; border-radius: 999px; background: rgba(255,255,255,0.05); overflow: hidden; }
        .hbarFill { display: block; height: 100%; border-radius: 999px; }

        .gmChart { margin-top: 10px; display: flex; align-items: stretch; gap: 2px; height: 148px; }
        .gmCol { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; }
        .gmPlot { position: relative; flex: 1 1 auto; }
        .gmPlot::before { content: ""; position: absolute; left: 0; right: 0; top: 50%; border-top: 1px dashed rgba(255,255,255,0.12); }
        .gmBar { position: absolute; left: 10%; right: 10%; border-radius: 4px; min-height: 2px; }
        .gmUp { bottom: 50%; }
        .gmDown { top: 50%; }
        .gmNone { position: absolute; left: 30%; right: 30%; top: calc(50% - 1px); height: 2px; border-radius: 999px; background: rgba(148,163,184,0.35); }
        .gmTick { margin-top: 7px; font-size: 10px; font-weight: 800; color: rgba(148,163,184,0.72); text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        .waterfall { margin-top: 12px; display: grid; gap: 8px; }
        .wfRow { display: grid; grid-template-columns: minmax(96px, 22%) 1fr minmax(64px, auto); align-items: center; gap: 10px; }
        .wfLabel { font-size: 12px; font-weight: 850; color: rgba(203,213,225,0.80); }
        .wfTrack { height: 12px; border-radius: 4px; background: rgba(255,255,255,0.04); overflow: hidden; }
        .wfBar { display: block; height: 100%; border-radius: 4px; min-width: 2px; }
        .wfValue { font-size: 12px; font-weight: 900; color: #e2e8f0; text-align: right; white-space: nowrap; }
        .wfTotal .wfLabel, .wfTotal .wfValue { color: #dbeafe; }
        .wfTotal { border-top: 1px solid rgba(255,255,255,0.10); padding-top: 8px; }

        .trendGrid { margin-top: 14px; display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; }
        .trendCell { display: grid; gap: 4px; align-content: start; }
        .trendChipRow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
        .trendCount { font-size: 11px; color: rgba(148,163,184,0.75); }
        @media (max-width: 520px) { .gmChart { height: 120px; } .wfRow { grid-template-columns: minmax(74px, 30%) 1fr minmax(56px, auto); } }
        .chartBlock { margin-top: 14px; }
        .chartBlock + .chartBlock { margin-top: 26px; }
        .chartBlockSub { font-size: 12px; color: rgba(148,163,184,0.85); margin-bottom: 8px; }
        .chartBlockTitle { font-size: 13px; font-weight: 900; color: rgba(226,232,240,0.85); margin-bottom: 4px; }
        .yearGrid { margin-top: 14px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
        .yearBadge { display: flex; justify-content: space-between; gap: 10px; align-items: center; border-radius: 13px; padding: 10px 12px; font-size: 13px; font-weight: 950; border: 1px solid rgba(255,255,255,0.10); }
        .historyTable { width: 100%; border-collapse: separate; border-spacing: 0 10px; margin-top: 14px; }
        .historyTable th { text-align: left; color: rgba(203,213,225,0.68); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; padding: 0 10px; }
        .historyTable td { background: rgba(255,255,255,0.035); border-top: 1px solid rgba(255,255,255,0.07); border-bottom: 1px solid rgba(255,255,255,0.07); padding: 12px 10px; font-size: 13px; }
        .historyTable td:first-child { border-left: 1px solid rgba(255,255,255,0.07); border-radius: 12px 0 0 12px; font-weight: 900; }
        .historyTable td:last-child { border-right: 1px solid rgba(255,255,255,0.07); border-radius: 0 12px 12px 0; }
        /* THE FIVE-YEAR TABLE, TIGHTER. Eight columns in a 571px main column
           (1024px, beside the side column) overflowed at the shared padding;
           these fit it without forcing nowrap on anything. */
        .annualTable th { padding: 0 6px; letter-spacing: 0.04em; font-size: 10.5px; }
        .annualTable td { padding: 11px 6px; font-size: 12.5px; }
        /* THE COLUMN A CROSSING LANDS IN gets room for its longest phrase
           ("Loss both periods"), so the headers wrap before it does. */
        .annualTable .colCross { min-width: 112px; }
        /* A NARROW MAIN COLUMN (about 570px at 1024, beside the side column):
           tighter still, so all eight columns and the crossing phrase fit. */
        .annualBox { container-type: inline-size; }
        @container (max-width: 640px) {
          .annualTable th { padding: 0 3px; font-size: 10px; letter-spacing: 0.02em; }
          .annualTable td { padding: 10px 3px; font-size: 12px; }
          .annualTable .colCross { min-width: 108px; }
        }
        .sideColumn { position: sticky; top: 18px; display: grid; gap: 16px; min-width: 0; }
        .bulletList { margin: 14px 0 0; padding: 0; list-style: none; display: grid; gap: 12px; }
        .bulletList li { display: grid; grid-template-columns: 12px minmax(0, 1fr); gap: 10px; color: rgba(226,232,240,0.84); line-height: 1.65; }
        .bulletList li::before { content: ""; width: 9px; height: 9px; border-radius: 999px; margin-top: 8px; background: #22c55e; box-shadow: 0 0 0 4px rgba(34,197,94,0.10); }
        .estimateGrid { margin-top: 16px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        .estimateGridStacked { grid-template-columns: 1fr; }
        @media (max-width: 980px) { .hero, .contentGrid { grid-template-columns: 1fr; } .sideColumn { position: static; } .metricGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 720px) {
          .earningsPage, .earningsPage * { box-sizing: border-box; }
          .earningsWrap { width: 100%; padding: 14px 10px 38px; overflow-x: hidden; }
          .topLinks { display: grid; grid-template-columns: 1fr; justify-content: stretch; gap: 8px; margin-bottom: 12px; }
          .topLinks a, .actionLink { width: 100%; min-height: 44px; padding: 10px 12px; text-align: center; }
          .hero { padding: 16px; border-radius: 20px; gap: 18px; }
          .hero h1 { margin-top: 10px; font-size: clamp(29px, 9vw, 36px); line-height: 1.08; letter-spacing: -0.045em; }
          .hero p { font-size: 14px; line-height: 1.65; }
          .scoreCard, .card { width: 100%; min-width: 0; border-radius: 18px; padding: 15px; }
          .scoreTop { align-items: flex-start; }
          .scoreNumberRow { margin-top: 18px; }
          .scoreNumber { font-size: 42px; }
          .scoreNeedle { left: calc(${score.score}% - 8px); width: 16px; height: 22px; }
          .contentGrid { gap: 16px; }
          .card h2 { font-size: 23px; } .card h3 { font-size: 20px; }
          .card p, .bulletList li { font-size: 14px; line-height: 1.6; }
          .yearGrid, .earningsSearchRow, .estimateGrid { grid-template-columns: 1fr; }
          .metricGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
          .metricCard { padding: 10px !important; border-radius: 14px !important; }
          .metricValue { font-size: 18px; word-break: break-word; }
          .metricLabel { font-size: 9.5px; }
          .metricSub { font-size: 10.5px; margin-top: 5px; }
          .metricHelp { width: 14px; height: 14px; font-size: 9px; }
          .metricHelpBubble { position: fixed; left: 12px; right: 12px; bottom: auto; top: 92px; transform: none; width: auto; max-width: none; }
          .metricHelpBubble::after { display: none; }
          .trendDots { gap: 12px; justify-content: flex-start; }
          .trendDot { min-width: 48px; }
          .chartScale { width: 58px; }
          .chartScaleSpacer { width: 58px; }
          .chartScale span { font-size: 10px; left: 2px; right: 2px; }
          .chartCategories span { font-size: 9.5px; }
          .chartCategories .catLong { display: none; }
          .chartCategories .catShort { display: inline; white-space: nowrap; line-height: 1.25; }
          .historyTable { display: block; width: 100%; border-spacing: 0; margin-top: 12px; }
          .historyTable thead { display: none; }
          .historyTable tbody, .historyTable tr, .historyTable td { display: block; width: 100%; }
          .historyTable tr { margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; background: rgba(255,255,255,0.035); overflow: hidden; }
          .historyTable td { display: flex; align-items: center; justify-content: space-between; gap: 14px; border: none; border-bottom: 1px solid rgba(255,255,255,0.07); border-radius: 0; background: transparent; padding: 11px 12px; font-size: 13px; text-align: right; }
          .historyTable td:first-child, .historyTable td:last-child { border-radius: 0; border-left: none; border-right: none; }
          .historyTable td:last-child { border-bottom: none; }
          .historyTable td::before { content: ""; flex: 0 0 auto; color: rgba(203,213,225,0.70); font-size: 11px; font-weight: 950; letter-spacing: 0.08em; text-transform: uppercase; text-align: left; }
          /* READ FROM THE CELL, NOT FROM ITS POSITION. These used to be seven
             nth-child rules naming the estimate columns that were retired on
             2026-09-15. There are now two tables on this page with different
             column sets, and a positional rule cannot serve both: it would
             silently relabel one of them. Each <td> carries its own
             data-label. */
          .historyTable td::before { content: attr(data-label); }
          /* THE FY LABEL IS THE CARD'S HEADER on the five-year table, not a
             "Fiscal year" row (owner review of #523). */
          .annualTable td.rowHead { justify-content: flex-start; font-size: 15px; font-weight: 950; background: rgba(255,255,255,0.03); }
          .annualTable td.rowHead::before { content: none; }
          .annualTable .colCross { min-width: 0; }
        }
        @media (max-width: 374px) { .snapshotGrid { grid-template-columns: 1fr !important; } }
        @media (max-width: 380px) { .earningsWrap { padding-left: 8px; padding-right: 8px; } .hero, .scoreCard, .card { padding: 13px; } .scoreNumber { font-size: 38px; } }
      `}</style>

        <div className="earningsWrap">
          <section className="hero">
            <div className="heroTopBar">
              <div className="eyebrow">Earnings desk</div>
              <ShareButton
                url={`https://www.mystockharbor.com/stock/${clean}/earnings`}
                title={`${clean} Earnings & Earnings Score | MyStockHarbor`}
                text={`${clean} earnings — GAAP EPS, revenue & earnings score 📊 MyStockHarbor`}
              />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "12px 0 0" }}>
                <TickerLogo symbol={clean} size={34} radius={8} />
                <h1 style={{ margin: 0 }}>{clean} Stock Earnings, EPS & Revenue Breakdown</h1>
              </div>
              {/* THE LEDE TAKES THE PERIOD FROM THE VIEW. It said "latest reported
                  quarter" on KGC, whose latest reported period is a fiscal
                  year. `secView` can be null (nothing read in yet), and the
                  quarterly wording is right for that: the page is about a
                  quarter until a filer's own filings say otherwise. */}
              <p>Review {clean}&apos;s latest reported {periodWords(secView?.basis ?? "quarter").one} as filed with the SEC — GAAP EPS, revenue, margins, cash flow and the balance sheet, with year-over-year context and a simple earnings score.</p>
              {/* THE EPS-BASIS NOTE, ONCE, AT THE TOP. It was printed under the
                  snapshot, the five-year table, the valuation card and the
                  income statement — the same two sentences four times on
                  AVAV. It applies to every EPS on the page, so it sits where
                  the page introduces them; each card keeps a one-line source. */}
              {secView ? <p className="earningsDataNote heroNote">{epsBasisNote(secView.accounting)}</p> : null}
              <EarningsSymbolPicker currentSymbol={clean} />
            </div>
            <SecScoreCard
              symbol={clean}
              score={score}
              coverage={coverage}
              watermark={<EarningsScoreWatermark />}
            />
          </section>

          <section className="contentGrid">
            <div style={{ display: "grid", gap: 18 }}>
              {/* EVERY FINANCIAL CARD BELOW READS THE SEC FACT SET. When the
                  symbol has none yet, one honest card says so rather than six
                  cards of dashes. */}
              {nextReport ? <NextReportCard outlook={nextReport} /> : null}

              {/* THREE OUTCOMES, NOT TWO. "no readable XBRL" is a successful
                  fetch of nothing usable -- an IFRS filer, or a company with no
                  filed year yet -- and it must NEVER render as pending, because
                  the cron would re-read it daily and get the same nothing.
                  The 404 case never reaches here; see the guard above. */}
              {/* NOT THE SECURITY THESE FILINGS DESCRIBE — first, because it is
                  the only branch that must not fall through to the pending
                  card. "Pending" promises figures that are never coming, and
                  the figures it would eventually show belong to another
                  company. See lib/server/securityKind.ts. */}
              {/* NO CIK AT ALL — FIRST, because every branch below assumes a
                  registrant was found. This is the state that used to be a
                  bare 404 on a symbol whose stock page renders fine. */}
              {noRegistrant ? (
                <SecNoRegistrantCard symbol={clean} />
              ) :
               data.cold.status === "not-issuer-equity" ? (
                <SecNotIssuerEquityCard
                  symbol={clean}
                  reason={data.cold.reason}
                  siblings={data.cold.siblings}
                />
              ) :
               data.cold.status === "no-xbrl" ? (
                <SecNoXbrlCard
                  symbol={clean}
                  reason={data.cold.why}
                  taxonomies={data.cold.taxonomies}
                />
              ) :
               /* READ IN, WITH DATA, BUT NO QUARTERS *AND* NO YEARS — the
                  only case left with nothing to render. An annual-only filer
                  now builds a real view off its years (see
                  buildSecEarningsView), so this no longer catches KGC. */
               !secView && data.cold.status === "ready" ? (
                <SecNoQuartersCard
                  symbol={clean}
                  years={data.cold.set.years.length}
                  instants={data.cold.set.instants.length}
                />
              ) :
               !secView ? <SecPendingCard symbol={clean} /> : (
                <>
                  <SecSnapshotCard view={secView} pending={data.pendingResults} />
                  {/* HIDDEN, NOT REMOVED — the owner's standing rule. These two
                      were the FMP estimate cards: "EPS surprise" and "Revenue
                      surprise", both against FMP's epsEstimated /
                      revenueEstimated, which left the site on 2026-09-15 with
                      the rest of the FMP licence. Analyst consensus is not in
                      SEC filings and no free source covers it.
                      Deleting these loses the record of why the layout has a
                      gap, and the next person re-adds the column and wires it
                      to whatever is nearest. The registry entry is in
                      lib/server/secEarningsView.ts RETIRED_SOURCES. */}
                  <HiddenCard id="eps-estimate" />
                  <HiddenCard id="revenue-estimate" />
                  {/* THE QUARTERLY TABLE IS QUARTERLY. An annual-only filer has
                      no quarters to tabulate, so it gets the annual card as its
                      SOLE growth table rather than an empty quarterly one. */}
                  {/* GATED ON tableBasis, NOT basis. AZN's anchor is a fiscal
                      year (its FY2025 ends after its newest quarter) and it
                      still has twelve quarters to tabulate. */}
                  {secView.tableBasis === "year" ? null : <SecGrowthMarginsCard view={secView} />}
                  {/* ON EVERY STOCK, not only annual filers: five fiscal years
                      is the longer view a quarterly table cannot give. Same
                      component, same rows, `sole` only changes the wording. */}
                  <SecAnnualCard view={secView} sole={secView.tableBasis === "year"} />
                  {/* AFTER THE TABLES IT SUMMARISES. The card states a median
                      over the rows above, so it has to follow them: a summary
                      above its own source reads as a separate claim. */}
                  <SecTrendSummaryCard view={secView} />
                  <SecValuationCard
                    view={secView}
                    inputs={data.valuation}
                    price={data.latestClose}
                    priceAsOf={data.latestCloseOn}
                    today={data.renderedOn}
                  />
                  <SecCashQualityCard view={secView} />
                  <SecBalanceSheetCard view={secView} />
                  {/* HIDDEN, NOT REMOVED. Revenue by product and by region, from
                      FMP /revenue-product-segmentation and
                      /revenue-geographic-segmentation, retired 2026-09-15.
                      Segment revenue is filed on an XBRL segment axis and
                      companyfacts publishes the DEFAULT CONTEXT ONLY, so the
                      breakdown is not in it — this is not a chain gap that a
                      better tag would close. The source is unresolved and the
                      entry in RETIRED_SOURCES says so. */}
                  <HiddenCard id="revenue-by-segment" />
                </>
              )}

              <PriceReactionCard
                symbol={clean}
                latest={latestReaction ? { label: latestReaction.label, reactionPct: latestReaction.reactionPct, volumeMultiple: latestReaction.volumeMultiple } : null}
                reaction={reactionData}
                drift={driftQuarters}
                datesFromSec={data.datesFromSec}
                uncoveredLabels={uncoveredLabels}
                noPriceHistoryNote={NO_PRICE_HISTORY_NOTE}
              />

              {secView ? <SecRecentPeriodsCard view={secView} /> : null}
            </div>

            <aside className="sideColumn">
              <section className="card">
                <div className="eyebrow">What it means</div>
                <h3>Investor read</h3>
                {/* NO score.explanation HERE. The score card at the top prints
                    that exact paragraph, so this card repeated it word for word
                    a screen further down (TSLA, ABBV, AVAV). The bullets are
                    what this card adds; the narrative has one home. */}
                {/* The generic bullets describe what the score reads WHEN it
                    can. A component that did not run must not be described
                    here as if it had -- the cash bullet is the one that read
                    as a claim on AZN, where the cash chain is empty. */}
                <ul className="bulletList">
                  <li>Year-over-year growth separates one-{periodWords(secView?.basis ?? "quarter").one} noise from a real earnings trend.</li>
                  {/* "UNIT", NOT A CURRENCY. This said "pound" on every US
                      filer's page; the figures are dollars, or a converted
                      home currency, and the point holds in any of them. */}
                  <li>Margins show whether the company is keeping more of each unit of revenue.</li>
                  {score.available && score.unavailable.includes(SCORE_COMPONENTS.cashConversion) ? (
                    <li>
                      Cash flow against net income would show whether reported profit is turning into
                      cash — {clean}&apos;s filings do not carry a cash-flow statement this page can
                      read, so it is not part of the score above.
                    </li>
                  ) : (
                    <li>Cash flow against net income shows whether reported profit is turning into cash.</li>
                  )}
                </ul>
              </section>

              {/* HIDDEN, NOT REMOVED. This was "Analyst estimates for the next
                  report" and the forward full-year consensus card, both from
                  FMP /analyst-estimates, retired 2026-09-15. Forward consensus
                  is not in SEC filings at all — company guidance appears in 8-K
                  exhibits as prose, not as structured data. */}
              <HiddenCard id="forward-consensus" stacked />

              {secView ? <SecIncomeStatementCard view={secView} /> : null}

              <section className="card">
                <div className="eyebrow">Why it matters</div>
                <h3>Earnings can reset the stock narrative</h3>
                <p>Earnings matter because they test whether the company story is being supported by actual revenue, profit and cash generation.</p>
              </section>

              <section className="card">
                <div className="eyebrow">Learn</div>
                <h3>New to reading earnings?</h3>
                <p>Understand EPS, margins, cash flow and the three financial statements behind every earnings report — in plain English.</p>
                <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                  <Link className="actionLink green" href="/learn/how-to-read-financial-data">How to Read Financial Data &rarr;</Link>
                </div>
              </section>

              <section className="card">
                <div className="eyebrow">Next step</div>
                <h3>Connect earnings with price action</h3>
                <p>Use this page for the earnings read, then compare it with the stock page and latest news.</p>
                <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                  <Link className="actionLink" href={`/stock/${encodeURIComponent(clean)}`}>Open {clean} stock page &rarr;</Link>
                  <Link className="actionLink green" href={`/stock/${encodeURIComponent(clean)}/news`}>Read {clean} news &rarr;</Link>
                  <Link className="actionLink" href="/pickers">Open stock pickers &rarr;</Link>
                </div>
              </section>
            </aside>
          </section>

          <HideWatermarksBar />
        </div>

        {/* -- Explore More Stocks -- server-rendered internal-linking
               module, same pattern as app/stock/[symbol]/page.tsx (see
               lib/curatedSymbols.ts + app/components/RelatedStocks.tsx). -- */}
        <RelatedStocks currentSymbol={clean} symbols={relatedSymbols} />
      </main>
    </WatermarkVisibilityProvider>
  );
}
