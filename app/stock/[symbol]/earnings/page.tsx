import type { Metadata } from "next";
import { fmpFetch } from "@/lib/server/fmpUsage";
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
import { resolveFactSetForRender } from "@/lib/server/secColdFetch";
import { notFound } from "next/navigation";
import { buildSecEarningsView, periodWords } from "@/lib/server/secEarningsView";
// ONLY WHAT THIS FILE RENDERS. The tone words, the band note, the trend
// median and the waterfall gate are imported by SecEarningsCards.tsx, which is
// where they are drawn; re-importing them here would just be a second name for
// the same rule.
import { toneBg, toneColor } from "@/lib/server/secPresentation";
// THE SCORER, WHICH USED TO BE 340 LINES OF THIS FILE. It moved out whole so
// the sidebar snapshot card could call the SAME function rather than grow a
// second one over the same view — see the header of secEarningsScore.ts.
import {
  SCORE_BANDS, SCORE_COMPONENTS, scoreBandNote, scoreFromSec,
} from "@/lib/server/secEarningsScore";
import { valuationInputs } from "@/lib/server/secValuation";
import {
  HiddenCard, SecSnapshotCard, SecGrowthMarginsCard, SecAnnualCard, SecCashQualityCard,
  SecBalanceSheetCard, SecIncomeStatementCard, SecRecentPeriodsCard,
  SecTrendSummaryCard, SecValuationCard,
  SecPendingCard, SecNoXbrlCard, SecNoQuartersCard,
} from "./SecEarningsCards";
import { getRelatedSymbols } from "@/lib/curatedSymbols";
import RelatedStocks from "@/app/components/RelatedStocks";
import { readReportDates } from "@/lib/server/secReportDatesStore";
import { reactionPeriodLabels } from "@/lib/server/secFactStore";
import { NO_PRICE_HISTORY_NOTE, TIMING_WORDING, reactionBarLabels, type ReportTiming } from "@/lib/server/secReportDates";

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
 */
type NextReportView =
  | { source: "sec"; kind: "date"; date: string; timing: ReportTiming | null; clamped: boolean; fromEvents: number }
  | { source: "sec"; kind: "month"; month: string; fromEvents: number }
  // ── "NOTHING" IS AN OUTCOME, NOT AN ABSENCE ─────────────────────────────
  // The gate refuses a specific date for half the filers it sees, and on AAP
  // the card simply did not render — the same blank a symbol with no SEC data
  // at all gets. A reader cannot tell "we looked, and its history is too
  // irregular to promise a date" from "we never looked", so the refusal is
  // rendered rather than left as a gap.
  | { source: "sec"; kind: "none" }
  | { source: "fmp"; date: string; time: string | null }
  | null;

type EarningsReactionPoint = {
  label: string;
  reactionPct: number | null;
  volumeMultiple: number | null;
  drift5Pct: number | null;
  drift20Pct: number | null;
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



function formatPercent(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
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

function computeEarningsReactionDetail(row: FmpEarningsRow, points: Point[]): { reactionPct: number | null; volumeMultiple: number | null; drift5Pct: number | null; drift20Pct: number | null; reason: "uncovered" | null } {
  const empty = { reactionPct: null, volumeMultiple: null, drift5Pct: null, drift20Pct: null, reason: null as "uncovered" | null };
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

  return { reactionPct, volumeMultiple, drift5Pct, drift20Pct, reason: null };
}


/** "2026-11" -> "November 2026". Rendered, so it must not say "2026-11". */
function monthName(ym: string) {
  const [y, m] = ym.split("-");
  const idx = Number(m) - 1;
  const names = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  return names[idx] ? `${names[idx]} ${y}` : ym;
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
  const secDates = await readReportDates(symbol);
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
      : fetchFmpJson<unknown[]>(`/earnings?symbol=${encodeURIComponent(symbol)}`),
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
  // THE ESTIMATE IS NOT A FORECAST and the card says so. It is the filer's own
  // habit — the same quarter a year ago, measured from the matched period end —
  // and it is only offered as a specific DATE where that habit is regular
  // enough to have earned one. Where it is not, the card offers the month or
  // says nothing at all, which is the honest end of the same scale.
  const nextReport: NextReportView = secDates && secDates.next.kind === "date"
    ? {
        source: "sec", kind: "date",
        date: secDates.next.date,
        timing: secDates.next.timing,
        clamped: secDates.next.clamped,
        fromEvents: secDates.next.fromEvents,
      }
    : secDates && secDates.next.kind === "month"
      ? { source: "sec", kind: "month", month: secDates.next.month, fromEvents: secDates.next.fromEvents }
      : next?.date
        ? { source: "fmp", date: next.date, time: next.time ?? null }
        : secEvents.length
          ? { source: "sec", kind: "none" }
          : null;

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
  const valuation = cold.status === "ready" ? valuationInputs(cold.set) : { shares: null, eps: null, refusals: [] };
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


// Nominal width (in "user units") for the chart SVGs below. Choosing a
// realistic pixel-scale number here -- rather than an abstract 0-100 -- and
// then letting the SVG scale uniformly (width: 100%, height: auto, no
// preserveAspectRatio="none") keeps x and y scaled by very nearly the same
// factor. That's what keeps circles round and strokes a consistent thin
// line instead of the squashed-ellipse / stretched-line look you get from
// forcing a near-square viewBox to fill a wide card non-uniformly.
const CHART_VIEW_W = 640;

function ChartFrame({ height, labels, scaleTop, scaleMid, scaleBottom, children }: { height: number; labels: string[]; scaleTop?: string; scaleMid?: string; scaleBottom?: string; children: import("react").ReactNode; }) {
  const hasScale = scaleTop != null || scaleMid != null || scaleBottom != null;
  return (
    <div>
      <div className="chartRow">
        <div className="chartPlot">{children}</div>
        {hasScale && (
          <div className="chartScale">
            {scaleTop != null && <span className="scaleTop">{scaleTop}</span>}
            {scaleMid != null && <span className="scaleMid">{scaleMid}</span>}
            {scaleBottom != null && <span className="scaleBottom">{scaleBottom}</span>}
          </div>
        )}
      </div>
      {/* Mirrors the row above (same flex structure + spacer) so the quarter
          labels line up under the actual bars/dots instead of being centered
          across the full card width while the plot itself is narrower by the
          Y-axis scale column. */}
      <div className="chartRow">
        <div className="chartCategories">
          {labels.map((l, i) => <span key={`${l}-${i}`}>{l}</span>)}
        </div>
        {hasScale && <div className="chartScaleSpacer" aria-hidden="true" />}
      </div>
    </div>
  );
}



type LineSeries = { name: string; color: string; values: (number | null)[] };

function MultiLineChart({ labels, series, height = 168, formatValue = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%` }: { labels: string[]; series: LineSeries[]; height?: number; formatValue?: (v: number) => string; }) {
  const allValues = series.flatMap((s) => s.values).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const maxAbs = allValues.length ? Math.max(...allValues.map((v) => Math.abs(v)), 0.5) : 1;
  const zeroY = height / 2;
  const usable = zeroY - 10;
  const groupW = CHART_VIEW_W / Math.max(labels.length, 1);

  function yFor(v: number) {
    return zeroY - (v / maxAbs) * usable;
  }

  function pathFor(values: (number | null)[]) {
    let d = "";
    let started = false;
    values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) { started = false; return; }
      const x = i * groupW + groupW / 2;
      const y = yFor(v);
      d += `${started ? "L" : "M"}${x},${y} `;
      started = true;
    });
    return d.trim();
  }

  return (
    <ChartFrame
      height={height}
      labels={labels}
      scaleTop={allValues.length ? formatValue(maxAbs) : undefined}
      scaleMid={allValues.length ? formatValue(0) : undefined}
      scaleBottom={allValues.length ? formatValue(-maxAbs) : undefined}
    >
      <svg viewBox={`0 0 ${CHART_VIEW_W} ${height}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Trend chart">
        <line x1="0" y1={zeroY} x2={CHART_VIEW_W} y2={zeroY} stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
        {series.map((s) => (
          <g key={s.name}>
            <path d={pathFor(s.values)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {s.values.map((v, i) => (v != null && Number.isFinite(v) ? <circle key={i} cx={i * groupW + groupW / 2} cy={yFor(v)} r="3.5" fill={s.color} /> : null))}
          </g>
        ))}
      </svg>
    </ChartFrame>
  );
}

function SeriesLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="chartLegend">
      {items.map((item) => (
        <span key={item.label}><i style={{ background: item.color }} /> {item.label}</span>
      ))}
    </div>
  );
}

type SingleBarPoint = { label: string; value: number | null };

function SingleValueBarChart({ data, height = 168, formatValue = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%` }: { data: SingleBarPoint[]; height?: number; formatValue?: (v: number) => string; }) {
  const values = data.map((d) => d.value).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const maxAbs = values.length ? Math.max(...values.map((v) => Math.abs(v)), 0.5) : 1;
  const zeroY = height / 2;
  const usable = zeroY - 10;
  const groupW = CHART_VIEW_W / Math.max(data.length, 1);

  return (
    <ChartFrame
      height={height}
      labels={data.map((d) => d.label)}
      scaleTop={values.length ? formatValue(maxAbs) : undefined}
      scaleMid={values.length ? formatValue(0) : undefined}
      scaleBottom={values.length ? formatValue(-maxAbs) : undefined}
    >
      <svg viewBox={`0 0 ${CHART_VIEW_W} ${height}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Price reaction chart">
        <line x1="0" y1={zeroY} x2={CHART_VIEW_W} y2={zeroY} stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
        {data.map((d, i) => {
          const cx = i * groupW + groupW / 2;
          const barW = Math.min(groupW * 0.42, 38);
          const h = d.value != null ? (Math.abs(d.value) / maxAbs) * usable : 0;
          const up = (d.value ?? 0) >= 0;
          const color = d.value == null ? "rgba(148,163,184,0.35)" : up ? "#22c55e" : "#ef4444";
          return d.value != null ? (
            <rect key={`${d.label}-${i}`} x={cx - barW / 2} y={up ? zeroY - h : zeroY} width={barW} height={Math.max(h, 2)} fill={color} rx="3" />
          ) : null;
        })}
      </svg>
    </ChartFrame>
  );
}

async function fetchQuoteForMeta(symbol: string): Promise<{ price: number | null; date: string | null }> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return { price: null, date: null };
  try {
    const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;
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
      index: true,
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

  // THE CIK GATE, AS A 404. A symbol SEC has never heard of gets no page at
  // all: nothing was fetched for it and nothing was queued. This is what bounds
  // an endpoint anyone can hit -- the set of strings that can trigger work is
  // the ~10,400 registrants in the committed ticker file, not any string.
  if (data.cold.status === "no-cik") notFound();

  const nextReport = data.nextReport;
  const score = data.score;
  const secView = data.secView;

  const reactionData: SingleBarPoint[] = data.priceReactionQuarters.map((q) => ({ label: q.label, value: q.reactionPct }));
  const hasAnyReaction = reactionData.some((d) => d.value != null);
  const driftLabels = data.priceReactionQuarters.map((q) => q.label);
  const driftSeries: LineSeries[] = [
    { name: "Day of reaction", color: "#60a5fa", values: data.priceReactionQuarters.map((q) => q.reactionPct) },
    { name: "+5 trading days", color: "#facc15", values: data.priceReactionQuarters.map((q) => q.drift5Pct) },
    { name: "+20 trading days", color: "#22c55e", values: data.priceReactionQuarters.map((q) => q.drift20Pct) },
  ];
  const hasAnyDrift = driftSeries.some((s) => s.values.some((v) => v != null));
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
        .scoreNeedle { position: absolute; top: -5px; left: calc(${score.score}% - 9px); width: 18px; height: 24px; border-radius: 999px; background: #f8fafc; border: 3px solid ${toneColor(score.tone)}; box-shadow: 0 8px 20px rgba(0,0,0,0.32); }
        .scoreLabels { display: flex; justify-content: space-between; margin-top: 9px; color: rgba(226,232,240,0.70); font-size: 11px; font-weight: 950; text-transform: uppercase; letter-spacing: 0.07em; }
        .contentGrid { margin-top: 22px; display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.85fr); gap: 22px; align-items: start; }
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
        .chartCategories span { flex: 1 1 0; text-align: center; font-size: 11px; font-weight: 800; color: rgba(203,213,225,0.68); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 1px; }
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
        .chartBlockTitle { font-size: 13px; font-weight: 900; color: rgba(226,232,240,0.85); margin-bottom: 4px; }
        .yearGrid { margin-top: 14px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
        .yearBadge { display: flex; justify-content: space-between; gap: 10px; align-items: center; border-radius: 13px; padding: 10px 12px; font-size: 13px; font-weight: 950; border: 1px solid rgba(255,255,255,0.10); }
        .historyTable { width: 100%; border-collapse: separate; border-spacing: 0 10px; margin-top: 14px; }
        .historyTable th { text-align: left; color: rgba(203,213,225,0.68); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; padding: 0 10px; }
        .historyTable td { background: rgba(255,255,255,0.035); border-top: 1px solid rgba(255,255,255,0.07); border-bottom: 1px solid rgba(255,255,255,0.07); padding: 12px 10px; font-size: 13px; }
        .historyTable td:first-child { border-left: 1px solid rgba(255,255,255,0.07); border-radius: 12px 0 0 12px; font-weight: 900; }
        .historyTable td:last-child { border-right: 1px solid rgba(255,255,255,0.07); border-radius: 0 12px 12px 0; }
        .sideColumn { position: sticky; top: 18px; display: grid; gap: 16px; }
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
        }
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
              <EarningsSymbolPicker currentSymbol={clean} />
            </div>
            <aside className="scoreCard">
              <div className="scoreTop">
                <div className="smallLabel">Earnings score</div>
                <div className="scorePill">{score.label}</div>
              </div>
              {/* No number and no needle when there is nothing to score. The
                  pill already says "Unavailable" and the explanation says why,
                  but a 48px "50/100" over a Weak-Mixed-Strong gradient with the
                  needle at dead centre is the visually dominant half of this
                  card -- it reads as a real neutral reading, and the honest
                  part is the easiest to miss. Verified rendering exactly that
                  way before this change. */}
              {score.available ? (
                <>
                  <div className="scoreNumberRow">
                    <div className="scoreNumber">{score.score}/100</div>
                    <EarningsScoreWatermark />
                  </div>
                  <div className="scoreBar" aria-hidden="true"><div className="scoreNeedle" /></div>
                  {/* THE AXIS IS LABELLED FROM THE BAND TABLE. It read
                      Weak / Mixed / Strong beside a pill that can only ever say
                      Weak / Mixed / Good, so KGC's 100/100 "Good" looked as
                      though it had missed a higher band that does not exist. */}
                  <div className="scoreLabels">
                    {/* SCORE_BANDS is ordered high-to-low (the lookup wants that);
                        the axis reads low-to-high left to right. */}
                    {[...SCORE_BANDS].reverse().map((b) => <span key={b.tone}>{b.label}</span>)}
                  </div>
                  {/* AND THE THRESHOLDS ARE VISIBLE. 100/100 above an unlabelled
                      gauge tells a reader nothing about what 100 had to clear. */}
                  <p className="earningsDataNote" style={{ marginTop: 8 }}>{scoreBandNote()}</p>
                </>
              ) : null}
              <p style={{ marginTop: 16 }}>{score.explanation}</p>
              {/* WHICH KIND OF PERIOD THE SCORE READ — point 5 of the scope.
                  Every term of this score is measured over the anchor period,
                  and a reader comparing an annual filer's score with a 10-Q
                  filer's has to be told they are not the same measurement. */}
              {score.available && score.basis === "year" ? (
                <p className="earningsDataNote" style={{ marginTop: 10 }}>
                  <strong>{clean} files annually</strong>, so this score is built on its fiscal
                  years — growth is year against prior year, and there are no quarterly figures
                  behind it.
                </p>
              ) : null}
              {/* WHAT THE SCORE COULD NOT SEE, ON THE SCORE ITSELF.
                  /stock/AZN/earnings rendered GOOD 100/100 above a Quality of
                  Earnings card whose every field was "—". The number is only
                  readable next to its own gaps, so they sit here rather than
                  being inferable from a card further down the page. */}
              {score.available && score.unavailable.length ? (
                <p className="earningsDataNote" style={{ marginTop: 10 }}>
                  Not measured, because {clean}&apos;s filings do not carry it:{" "}
                  {score.unavailable.join("; ")}.
                </p>
              ) : null}
            </aside>
          </section>

          <section className="contentGrid">
            <div style={{ display: "grid", gap: 18 }}>
              {/* EVERY FINANCIAL CARD BELOW READS THE SEC FACT SET. When the
                  symbol has none yet, one honest card says so rather than six
                  cards of dashes. */}
              {nextReport ? (
                <section className="card">
                  <div className="eyebrow">Next report</div>
                  <h3>Next expected earnings date</h3>
                  {nextReport.source === "fmp" ? (
                    <p style={{ marginBottom: 0 }}>
                      <strong>{nextReport.date}</strong>{nextReport.time ? ` (${nextReport.time === "bmo" ? "before market open" : nextReport.time === "amc" ? "after market close" : nextReport.time})` : ""}.
                      {" "}This one comes from the earnings calendar — {clean}&apos;s own filing
                      history has not been read yet.
                    </p>
                  ) : nextReport.kind === "date" ? (
                    <p style={{ marginBottom: 0 }}>
                      <strong>{nextReport.date}</strong>
                      {nextReport.timing ? `, ${TIMING_WORDING[nextReport.timing].replace("Results filed", "results filed")} if it follows its usual pattern` : ""}.
                      {" "}Estimated from {clean}&apos;s own past reporting pattern — the gap between
                      the end of its financial quarter and the 8-K it files with the results,
                      over its last {nextReport.fromEvents} reports. It is not a company
                      announcement and the company is free to break the pattern.
                      {nextReport.clamped
                        ? " Pulled back to the SEC's filing deadline for this period, which the pattern would have run past."
                        : ""}
                    </p>
                  ) : nextReport.kind === "none" ? (
                    <p style={{ marginBottom: 0 }}>
                      Not enough regular reporting history to estimate the next report date.
                      {" "}{clean}&apos;s past results filings are spread too widely, or too few
                      of them are on file, for a date or even a month to mean anything here.
                    </p>
                  ) : (
                    <p style={{ marginBottom: 0 }}>
                      Expected in <strong>{monthName(nextReport.month)}</strong>.
                      {" "}{clean} has reported within the same month each year but not on a
                      settled day of it, so no specific date is offered here. Based on its last{" "}
                      {nextReport.fromEvents} reports.
                    </p>
                  )}
                </section>
              ) : null}

              {/* THREE OUTCOMES, NOT TWO. "no readable XBRL" is a successful
                  fetch of nothing usable -- an IFRS filer, or a company with no
                  filed year yet -- and it must NEVER render as pending, because
                  the cron would re-read it daily and get the same nothing.
                  The 404 case never reaches here; see the guard above. */}
              {data.cold.status === "no-xbrl" ? (
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

              <section className="card">
                <div className="eyebrow">Price reaction</div>
                <h2>How has {clean} actually traded around its last reports?</h2>
                <p>This shows the stock&apos;s closing-price move around each report: for results filed with the SEC before market open, it&apos;s the move from the prior close into the filing-day close; for results filed after market close, it&apos;s the move from the filing-day close into the next day&apos;s close. When exact timing isn&apos;t available, it spans the day before the report to the day after.</p>
                {latestReaction && (latestReaction.reactionPct != null || latestReaction.volumeMultiple != null) && (
                  <p><strong>Most recent reaction ({latestReaction.label}):</strong> {formatPercent(latestReaction.reactionPct)}{latestReaction.volumeMultiple != null ? ` on ${latestReaction.volumeMultiple.toFixed(1)}x average volume` : ""}.</p>
                )}
                {hasAnyReaction ? (
                  <>
                    <div className="chartBlock">
                      <SingleValueBarChart data={reactionData} />
                    </div>
                    <SeriesLegend items={[{ label: "Rose after report", color: "#22c55e" }, { label: "Fell after report", color: "#ef4444" }]} />
                    <p className="earningsDataNote">This reflects the stock&apos;s actual price move, which can be driven by broader market moves as well as the earnings report itself &mdash; it isn&apos;t a clean read of earnings reaction alone.</p>
                    {/* PROVENANCE ON THE CARD, because the two sources measure
                        different sessions. A filing timestamp is when the
                        document reached EDGAR; a calendar date is a third
                        party's record of the announcement. Which one keyed
                        these bars changes what they mean. */}
                    <p className="earningsDataNote">
                      {data.datesFromSec
                        ? `Each bar is keyed to the date ${clean} filed its results with the SEC, and to the session that filing landed in: a filing after the close is measured against the next day's close.`
                        : `Each bar is keyed to an earnings-calendar date, not to ${clean}'s own filings — its filing history has not been read yet.`}
                    </p>
                    {/* ── A MISSING BAR IS EXPLAINED, NOT LEFT TO INFERENCE ──
                        A gap in this chart reads as "the market shrugged" or
                        "they did not file". Neither is true: the price series
                        simply starts later than the report. Naming the periods
                        is the point — "some are missing" is not checkable by a
                        reader looking at the chart. */}
                    {uncoveredLabels.length > 0 && (
                      <p className="earningsDataNote">
                        <strong>{uncoveredLabels.join(", ")}</strong>{" "}
                        {uncoveredLabels.length === 1 ? "has" : "have"} no bar above. {NO_PRICE_HISTORY_NOTE}
                      </p>
                    )}
                  </>
                ) : (
                  <p>Not enough price history is available yet to chart the reaction around earnings.</p>
                )}
                {hasAnyDrift && (
                  <>
                    <div className="chartBlock">
                      <div className="chartBlockTitle">Did the move hold? Price vs. pre-earnings close, over time</div>
                      <MultiLineChart labels={driftLabels} series={driftSeries} />
                      <SeriesLegend items={[{ label: "Day of reaction", color: "#60a5fa" }, { label: "+5 trading days", color: "#facc15" }, { label: "+20 trading days", color: "#22c55e" }]} />
                    </div>
                    <p className="earningsDataNote">This tracks the stock from just before each report through the following weeks, to show whether the initial reaction stuck, faded, or reversed. The most recent quarters may not have a full 20 trading days of data yet.</p>
                  </>
                )}
              </section>

              {secView ? <SecRecentPeriodsCard view={secView} /> : null}
            </div>

            <aside className="sideColumn">
              <section className="card">
                <div className="eyebrow">What it means</div>
                <h3>Investor read</h3>
                <p>{score.explanation}</p>
                {/* The generic bullets describe what the score reads WHEN it
                    can. A component that did not run must not be described
                    here as if it had -- the cash bullet is the one that read
                    as a claim on AZN, where the cash chain is empty. */}
                <ul className="bulletList">
                  <li>Year-over-year growth separates one-{periodWords(secView?.basis ?? "quarter").one} noise from a real earnings trend.</li>
                  <li>Margins show whether the company is keeping more of each pound of revenue.</li>
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
