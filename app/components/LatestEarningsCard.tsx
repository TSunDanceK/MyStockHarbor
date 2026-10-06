import Link from "next/link";
import ColdFill from "@/app/stock/[symbol]/ColdFill";
import { ReasonedValue } from "@/app/components/EstimatedValue";
import { GROWTH_COLORS, GROWTH_MARGIN_LINE } from "@/lib/growthPalette";
import { VS_TINT, epsVsYearAgo, marginVsYearAgo, partialLine, type VsTone } from "@/lib/snapshotVsYearAgo";
import type { CSSProperties } from "react";

import type {
  SecEarningsSnapshot, SnapshotAnnualChart, SnapshotAnnualYear, SnapshotFigure, SnapshotNextReport, SnapshotPct,
} from "@/lib/server/secEarningsSnapshot";

// ── Shared "Earnings snapshot" card ──────────────────────────────────────────
// Rendered in the sidebar of /stock/[symbol] and /stock/[symbol]/news.
// Presentational only — no client hooks — so it renders inside server
// components (SSR HTML, good for indexing) and inside client components alike.
//
// ── ON SEC FILINGS SINCE 2026-09-21 ──────────────────────────────────────────
// This used to take `LatestEarningsData` from lib/latest-earnings-data.ts:
// FMP's stable/earnings rows plus an income statement, with an estimate and a
// surprise beside every actual. It now takes `SecEarningsSnapshot`, built in
// lib/server/secEarningsSnapshot.ts from the same stored fact sets and the same
// scorer that power /stock/[symbol]/earnings. What went and why is recorded in
// RETIRED_SNAPSHOT_FIELDS there — hidden, not removed, per the owner's rule.
//
// TYPE-ONLY IMPORT, AND IT HAS TO STAY THAT WAY. This module is pulled into
// StockSymbolPageClient.tsx, which is "use client", so it ships to the browser.
// `import type` erases at compile time; a value import from lib/server would
// drag secEarningsView → secCurrency → fxRates → Redis into the client bundle
// and fail the build. Everything below formats numbers and strings the server
// already resolved.

export type { SecEarningsSnapshot };

// ── Formatters ───────────────────────────────────────────────────────────────

/**
 * Money, with per-share figures held to two decimals.
 *
 * THE TRAILING ZERO IS NOT OPTIONAL. `maximumFractionDigits: 2` renders a filed
 * EPS of 4.30 as "$4.3" and 4.50 as "$4.5" — found on TSLA FY2023 and AZN
 * FY2024, and the reason ViewCell carries `perShare` at all (see its docblock
 * in lib/server/secEarningsView.ts). A price-like figure printed to one decimal
 * reads as a different number, and "$4.3" is not how anyone writes money.
 */
function formatFigure(f: SnapshotFigure) {
  const v = f.value;
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  if (f.perShare) return `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000_000_000) return `${sign}$${(abs / 1_000_000_000_000).toFixed(2)}T`;
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

/**
 * A CHANGE, which is why it carries its sign. Growth only.
 *
 * The leading "+" is the whole difference between this and formatLevel below,
 * and putting it on the wrong one is not cosmetic: "+50.1%" under the label
 * "Gross margin" reads as a margin that ROSE by fifty points, which would be
 * extraordinary, rather than a margin that IS fifty percent, which is ordinary
 * for Apple. The old card used this formatter for both and shipped the first
 * reading on every stock on the site.
 */
function formatGrowth(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

/**
 * A LEVEL. No sign on a positive — a margin of 50% is not "+50%". A loss-maker's
 * margin keeps its minus sign (a true minus, "−") and is drawn in red (#552
 * COWORK #144); one that rounds to zero carries no sign at all.
 */
function formatLevel(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const s = Math.abs(value).toFixed(digits);
  return `${value < 0 && Number(s) !== 0 ? "−" : ""}${s}%`;
}
/** A margin below zero, as printed: one that rounds to 0.0% is not a loss on the page. */
const isLoss = (value: number | null | undefined, digits = 1) =>
  typeof value === "number" && Number.isFinite(value) && value < 0 && Number(Math.abs(value).toFixed(digits)) !== 0;
const LOSS_TEXT = "#ef4444";

function formatPlainDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/**
 * A growth figure as text, INCLUDING the case that is not a number.
 *
 * A crossing ("turned profitable", "swung to a loss") is the view refusing to
 * divide across a sign change, and it must not collapse to "—": an absence
 * reads as "we don't know", where the truth is "we know exactly what happened
 * and a percentage would misdescribe it". See SnapshotPct.
 */
function growthText(p: SnapshotPct): string | null {
  if (p.kind === "pct") return formatGrowth(p.value);
  if (p.kind === "crossing") return p.words;
  return null;
}

/** A year-ago direction as the tile's tone: none for "no claim". */
const toneOf = (t: VsTone): ToneKey | undefined => (t === null ? undefined : t);

/** Sign tone for a growth figure. A crossing gets none — it is not a magnitude. */
function growthTone(p: SnapshotPct): ToneKey | undefined {
  if (p.kind !== "pct") return undefined;
  if (p.value > 0) return "good";
  if (p.value < 0) return "weak";
  return "neutral";
}

/**
 * The next report, as the finished sentence the server composed.
 *
 * NO FORMATTING HAPPENS HERE, and that is the point. This used to format
 * estimateNextReport's day ("22 Oct 2026") or print its month; the owner's
 * 2026-09-23 ruling is that the 30-day band is the only forward claim on the
 * site, so the headline and hedge come from lib/server/symbolOutlook.ts — the
 * same words the /earnings-calendar search and the earnings page's card use.
 */
function nextReportText(n: SnapshotNextReport): string {
  return n.value || n.headline || "—";
}

// ── Tone ─────────────────────────────────────────────────────────────────────

/**
 * ONE VOCABULARY FOR THE VERDICT, keyed the way the scorer keys it.
 *
 * These were "green" | "yellow" | "red" — the paint, used as the name of the
 * judgement. That is how a page ends up with a pill reading "Good" above a
 * gauge labelled "Strong" (see the SCORE_BANDS docblock in
 * lib/server/secEarningsScore.ts): two vocabularies for one scale, and no
 * compiler able to tell they have drifted. The card now speaks the scorer's
 * own words and paints them locally.
 *
 * THE PAINT IS LOCAL ON PURPOSE and is not a second copy of toneColor(). Those
 * are the gauge's solid accents; these are a card's gradients, borders and pill
 * fills, and they are alpha variants of the SAME rgb triples — 34,197,94 /
 * 250,204,21 / 239,68,68. A card cannot import secPresentation anyway (it is
 * server-only, see the note at the top), so what keeps them together is that
 * neither side owns a colour the other does not.
 */
type ToneKey = "good" | "neutral" | "weak";

const TONE_RGB: Record<ToneKey, string> = {
  good: "34,197,94",
  neutral: "250,204,21",
  weak: "239,68,68",
};

const TONE_TEXT: Record<ToneKey, string> = {
  good: "#86efac",
  neutral: "#fde68a",
  weak: "#fca5a5",
};

// ── Retired parts of the tile (#552 COWORK #134, 2026-10-03) ─────────────────
// Hidden, not removed, per the owner's rule. See the comments where each renders.

/** The "Next earnings" cell and the two-cell date row it sat in. */
const SHOW_NEXT_REPORT_IN_TILE = false;
/** The Revenue, Net income and Net margin tiles, now shown by the annual chart. */
const SHOW_CHARTED_METRIC_TILES = false;

// ── Card ─────────────────────────────────────────────────────────────────────

export default function LatestEarningsCard({
  snapshot,
  symbol,
  pageToken = "",
}: {
  snapshot: SecEarningsSnapshot;
  symbol: string;
  /** The page's signed token; the human-gated cold fill requires it. */
  pageToken?: string;
}) {
  const tone = snapshot.tone;
  // A PARTIAL SCORE CARRIES NO VERDICT COLOUR — the full report's rule, applied
  // here from the same coverageOf. The card and the pill both go grey, as they
  // do when the score did not run at all, because in both cases the hue would
  // be a claim the filings did not support.
  const verdict = snapshot.available && !snapshot.partial;
  // The tiles against the year-ago quarter (#563 COWORK #123). `yearAgo` may be absent on an older payload.
  const ya = snapshot.yearAgo ?? null;
  const perShare = (v: number) => formatFigure({ value: v, perShare: true, derivedNote: null, emptyReason: null });
  const epsVs = epsVsYearAgo(snapshot.eps.value, ya ? ya.eps : null, perShare);
  const grossVs = marginVsYearAgo(snapshot.margins.gross, ya ? ya.gross : null, ya?.label);
  const opVs = marginVsYearAgo(snapshot.margins.operating, ya ? ya.operating : null, ya?.label);
  return (
    <section className="snapshotMetricsWrap" style={earningsCardStyle(tone, verdict)}>
      <div style={sectionEyebrowStyle}>Latest earnings</div>
      <div
        style={{
          marginTop: 8,
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <h2 style={{ ...sectionTitleSmallStyle, margin: 0 }}>Earnings snapshot</h2>
        <div style={earningsTonePillStyle(tone, verdict)}>{snapshot.toneLabel}</div>
      </div>
      {/* THE LATEST REPORT, IN SMALL PRINT BY THE TITLE (#552 COWORK #134). It
          was the left half of a two-cell date row; that row is retired below.
          WHICH EVENT THE DATE IS stays said: an 8-K Item 2.02 announcement and
          a 10-Q acceptance are different days, often several apart. */}
      {snapshot.available && snapshot.reportedOn ? (
        <div style={earningsMiniSubStyle} data-fine-print="" data-snapshot-reported="">
          Latest report {formatPlainDate(snapshot.reportedOn)}
          {snapshot.reportedVia === "announcement"
            ? ` · ${snapshot.reportedTimingNote ?? "Announced by the company"}`
            : snapshot.reportedVia === "filing"
              ? " · Filed with the SEC"
              : ""}
        </div>
      ) : null}
      {/* THE PARTIAL-SCORE PARAGRAPH BEHIND A TAP (#563 COWORK #123): the chart comes
          first; one muted line ("1 input not measured: tap for why") opens the
          same sentence at reading size. The badge above still says "Partial". */}
      {snapshot.partialNote ? (
        <details data-snapshot-partial="" style={earningsHowStyle}>
          <summary style={partialSummaryStyle}>{partialLine(snapshot.toneLabel)}</summary>
          <div style={earningsHowBodyStyle}>{snapshot.partialNote}</div>
        </details>
      ) : null}
      {/* THE ANNUAL-ONLY LAYOUT (#535 COWORK #15): one short, true note, and the
          score says what it is based on. */}
      {snapshot.annualNote ? (
        <div style={earningsFootnoteStyle}>{snapshot.annualNote} The score is based on full fiscal years.</div>
      ) : null}

      {!snapshot.available ? (
        // THE REASON, NOT A GRID OF EM DASHES. `unavailableReason` is the same
        // sentence /stock/[symbol]/earnings prints for the same symbol, which
        // is the point of taking it from the scorer rather than writing a
        // second one here: a reader who clicks through gets the same answer.
        snapshot.awaitingRead ? (
          // NOT YET READ: a person gets the gated fill; a crawler, the note.
          <ColdFill symbol={symbol} token={pageToken} headline="" bare textStyle={bodyCopyStyle} />
        ) : (
          <p style={bodyCopyStyle}>{snapshot.unavailableReason}</p>
        )
      ) : (
        <>
          {/* ── RETIRED 2026-10-03 (#552 COWORK #134): THE DATE ROW, AND WITH IT
              "NEXT EARNINGS". Hidden, not removed. The owner ruled the
              estimated window confusing in this tile; the latest report date
              moved into small print by the title above, and the earnings
              page's own next-report card is unchanged. The payload still
              carries `nextReport`. Flip SHOW_NEXT_REPORT_IN_TILE to restore. */}
          {SHOW_NEXT_REPORT_IN_TILE ? (
          <div style={earningsDateRowStyle}>
            <div>
              <div style={earningsMiniLabelStyle}>Latest report</div>
              <div style={earningsMiniValueStyle}>{formatPlainDate(snapshot.reportedOn)}</div>
              {/* WHICH EVENT THAT DATE IS. An 8-K Item 2.02 announcement and a
                  10-Q acceptance are different days, often several apart, and
                  printing either as a bare "latest report" invites a reader to
                  compare one symbol's announcement against another's filing. */}
              <div style={earningsMiniSubStyle} data-fine-print="">
                {snapshot.reportedVia === "announcement"
                  ? snapshot.reportedTimingNote ?? "Announced by the company"
                  : snapshot.reportedVia === "filing"
                    ? "Filed with the SEC"
                    : ""}
              </div>
            </div>
            <div>
              <div style={earningsMiniLabelStyle}>Next earnings</div>
              {/* A SHORT VALUE ("Est. April") IN THE VALUE STYLE; a sentence in the sentence style. */}
              <div style={snapshot.nextReport.value ? earningsMiniValueStyle : earningsMiniSentenceStyle}>{nextReportText(snapshot.nextReport)}</div>
              {/* NOT A FORECAST, AND THE CARD SAYS SO. The hedge (or, for a
                  refusal, its named reason) is the search's own line. Null
                  only for the filed-fact "due" answer and the outage one,
                  which are not estimates. */}
              {snapshot.nextReport.hedge ? (
                <div style={earningsMiniSubStyle} data-fine-print="">{snapshot.nextReport.hedge}</div>
              ) : null}
            </div>
          </div>
          ) : null}

          {/* THE SMALL ANNUAL CHART IN THE FREED SPACE (#552 COWORK #134). */}
          {snapshot.annualChart ? <AnnualChart chart={snapshot.annualChart} /> : null}

          {/* THE PERIOD THESE FIGURES ARE FOR. The old card had no period line
              at all: every figure was captioned "Actual EPS" with nothing
              saying which quarter, so a stale fact set rendered identically to
              a current one. */}
          <div style={periodLineStyle} data-fine-print="">
            {snapshot.periodLabel}
            {snapshot.periodEnd ? ` · period ending ${formatPlainDate(snapshot.periodEnd)}` : ""}
          </div>
          {/* WHERE THE NEWEST PERIOD CAME FROM, OR WHY IT IS NOT HERE. Both are
              filed facts about SEC's data feed, not about the company; the
              words are built once in secEarningsView so this tile and the
              earnings card cannot say different things. */}
          {snapshot.filingCredit ? (
            <div style={earningsMiniSubStyle} data-fine-print="">{snapshot.filingCredit}</div>
          ) : null}
          {snapshot.filingNotice ? (
            <div style={earningsMiniSubStyle} data-fine-print="">{snapshot.filingNotice}</div>
          ) : null}

          {/* THREE TILES ON ONE ROW, OR EPS ON ITS OWN ROW WHEN THE TILE IS
              NARROW (a phone, or the news page's column): a container query on
              the tile's own width, so "Operating margin" never breaks mid-word. */}
          <style>{SNAPSHOT_GRID_CSS}</style>
          <div className="snapshotMetrics" style={earningsMetricGridStyle}>
            {/* A BLANK TILE SAYS WHY, in the meta slot where growth would sit.
                The reason is the payload's (emptyReason / marginReasons) —
                the card never guesses one. */}
            {/* COLOURED AGAINST THE SAME PERIOD A YEAR EARLIER (#563 COWORK #123):
                higher green, lower red; two losses, narrowed green and widened
                red, and the line says so. The figures are the snapshot's own
                (yearAgo); lib/snapshotVsYearAgo.ts holds the rules. */}
            <EarningsMetric
              label={snapshot.basis === "year" ? "EPS (diluted, FY)" : "EPS (diluted)"}
              value={formatFigure(snapshot.eps)}
              meta={snapshot.eps.emptyReason ?? epsVs.words ?? growthText(snapshot.epsYoY)}
              tone={snapshot.eps.emptyReason ? undefined : toneOf(epsVs.tone)}
              note={
                // THE FULL YEAR, LABELLED AS THE FULL YEAR. Only ever set under
                // a blank derived-Q4 tile; never presented as the quarter's.
                snapshot.epsFullYear
                  ? `${snapshot.epsFullYear.label}: ${formatFigure({ value: snapshot.epsFullYear.value, perShare: true, derivedNote: null, emptyReason: null })}`
                  : snapshot.eps.derivedNote
              }
            />
            {/* ── RETIRED 2026-10-03 (#552 COWORK #134): REVENUE, NET INCOME AND
                NET MARGIN TILES. Hidden, not removed: the annual chart above
                now shows all three. Flip SHOW_CHARTED_METRIC_TILES to restore. */}
            {SHOW_CHARTED_METRIC_TILES ? (
              <>
                <EarningsMetric
                  label="Revenue"
                  value={formatFigure(snapshot.revenue)}
                  meta={snapshot.revenue.emptyReason ?? growthText(snapshot.revenueYoY)}
                  tone={snapshot.revenue.emptyReason ? undefined : growthTone(snapshot.revenueYoY)}
                  note={snapshot.revenue.derivedNote}
                />
                <EarningsMetric
                  label="Net income"
                  value={formatFigure(snapshot.netIncome)}
                  meta={snapshot.netIncome.emptyReason}
                  note={snapshot.netIncome.derivedNote}
                />
              </>
            ) : null}
            {/* Up or down by at least 0.5 pt against the year-ago quarter: green or red; between, uncoloured. */}
            <EarningsMetric label="Gross margin" value={formatLevel(snapshot.margins.gross)} loss={isLoss(snapshot.margins.gross)} meta={snapshot.marginReasons.gross ?? grossVs.words} tone={snapshot.marginReasons.gross ? undefined : toneOf(grossVs.tone)} />
            <EarningsMetric label="Operating margin" value={formatLevel(snapshot.margins.operating)} loss={isLoss(snapshot.margins.operating)} meta={snapshot.marginReasons.operating ?? opVs.words} tone={snapshot.marginReasons.operating ? undefined : toneOf(opVs.tone)} />
            {SHOW_CHARTED_METRIC_TILES ? (
              <EarningsMetric label="Net margin" value={formatLevel(snapshot.margins.net)} loss={isLoss(snapshot.margins.net)} meta={snapshot.marginReasons.net} />
            ) : null}
          </div>

          {/* WHAT THE PERCENTAGES ARE MEASURED AGAINST. A "+12.4%" with no
              comparison period is not checkable, and the comparison is not
              always the obvious one — a filer with a gap in its filings is
              compared against the nearest prior-year period on file, which may
              not be four quarters back. */}
          {/* Only when a growth figure actually prints: on a card whose two
              growth slots both carry an empty reason, the sentence describes
              a comparison nothing on screen makes. */}
          {/* EPS ONLY since #552 COWORK #134: the revenue tile is retired, so
              its growth figure no longer prints here. */}
          {snapshot.comparedWith && snapshot.epsYoY.kind !== "none" ? (
            <div style={earningsFootnoteStyle}>
              Growth is measured against {snapshot.comparedWith}.
            </div>
          ) : null}
          {snapshot.currencyNote ? (
            <div style={earningsFootnoteStyle}>{snapshot.currencyNote}</div>
          ) : null}

          <Link
            href={`/stock/${encodeURIComponent(symbol)}/earnings`}
            style={fullReportLinkStyle}
          >
            See full report →
          </Link>
        </>
      )}
      {/* BEHIND A TAP, NOT FINE PRINT (#552 COWORK #157 §2, the owner's standing
          rule): the sentence explains the figures, so it opens at reading size. */}
      {snapshot.sourceNote ? (
        <details data-snapshot-source="" style={earningsHowStyle}>
          <summary style={earningsHowSummaryStyle}>About these figures</summary>
          <div style={earningsHowBodyStyle}>{snapshot.sourceNote}</div>
        </details>
      ) : null}
    </section>
  );
}

// ── The small annual chart (#552 COWORK #134) ────────────────────────────────
// Modelled on a TradingView income-statement mini-chart and kept as simple as
// it can be: four fiscal years, Revenue and Net income as bars on the $ scale,
// Net margin % as a purple line with dots on its own scale. No toggle, no
// hover: each year's label opens its figures on a tap (ReasonedValue), and the
// newest margin dot carries its value.
//
// SERVER-RENDERED SVG, NO HOOKS, so the tile still renders inside the news
// page's server component. The colours are the earnings page's Growth &
// margins palette (lib/growthPalette.ts), not a copy.
//
// THE TWO SCALES SHARE ONE ZERO LINE. Each is stretched below zero by the same
// fraction, so a loss bar and a negative margin both sit under the same line.
//
// THE FULL WIDTH FOR THE BARS (#563 COWORK #123): the plot runs to the card's
// inner edges and the scale labels sit inside it, small and muted: the $ scale
// on the left, the margin % on the right, in LANES NO MARK REACHES: the top of
// each scale above the plot, a negative scale's bottom under it (the $ floor is
// the worst year's own figure, #126), and "$0" / "0%" on the zero line at the
// very edges, where the years' slots stop short (CHART_EDGE). The newest margin
// is in the legend, not floating on the plot.
// scripts/snapshot-chart-measure.mjs holds it to no label on a label, bar or dot.

const CHART_W = 320;
const CHART_H = 150;
const CHART_PAD_L = 2;
const CHART_PAD_R = 2;
const CHART_PAD_T = 22;
/** Room under the plot for a negative scale's bottom label; a little otherwise. */
const CHART_PAD_B_NEG = 22;
const CHART_PAD_B = 4;
/** The years' slots stop this short of each edge, so the $0 / 0% labels there never meet a bar (#126). */
const CHART_EDGE = 6;
/** The least gap between a raised margin top's label and the "0%" label on the zero line (#127). */
const CHART_LABEL_GAP = 22;

function moneyTick(v: number): string {
  if (v === 0) return "$0";
  return formatFigure({ value: v, perShare: false, derivedNote: null, emptyReason: null });
}

/** The year's figures in one sentence, for its tap note. Reasons stand in for absent figures. */
function yearNote(y: SnapshotAnnualYear): string {
  const parts = [
    `Revenue ${y.revenueText ?? `not drawn (${y.revenueGap?.note ?? "not on file"})`}`,
    `Net income ${y.netIncomeText ?? `not drawn (${y.profitGap?.note ?? "not on file"})`}`,
    `Net margin ${y.netMargin !== null ? formatLevel(y.netMargin) : "not computed"}`,
  ];
  const extra = [y.oneOff, ...y.derivedNotes].filter(Boolean).join(" ");
  return `${y.label}: ${parts.join(" · ")}.${extra ? ` ${extra}` : ""}`;
}

function AnnualChart({ chart }: { chart: SnapshotAnnualChart }) {
  if (chart.reason) {
    return <p style={chartReasonStyle} data-snapshot-chart-reason="">{chart.reason}</p>;
  }
  const C = GROWTH_COLORS;
  const years = chart.years;
  const n = years.length;
  const plotW = CHART_W - CHART_PAD_L - CHART_PAD_R;

  // The $ scale: revenue and net income together. The % scale: net margin.
  const money = years.flatMap((y) => [y.revenue, y.netIncome]).filter((v): v is number => v !== null);
  const margins = years.map((y) => y.netMargin).filter((v): v is number => v !== null);
  const moneyMax = Math.max(0, ...money);
  const moneyMin = Math.min(0, ...money);
  const pctMax = Math.max(0, ...margins);
  const pctMin = Math.min(0, ...margins);
  // How far below zero the plot reaches, as a fraction of its top, shared so the
  // zero lines coincide. THE $ FLOOR IS THE DATA'S (#563 COWORK #126): with a
  // loss on the $ scale the plot ends exactly at the worst year's figure, and the
  // margin scale makes room for its own low point by reaching higher (pTop),
  // never by stretching the $ floor past the data (INTC read −$175B for a worst
  // year of −$18.8B). Without a $ loss, the margin's low point sets the floor.
  const moneyBelow = moneyMax > 0 ? -moneyMin / moneyMax : moneyMin < 0 ? 1 : 0;
  const pctBelow = pctMax > 0 ? -pctMin / pctMax : pctMin < 0 ? 1 : 0;
  const below = moneyMin < 0 ? moneyBelow : pctBelow;
  const mTop = moneyMax > 0 ? moneyMax : Math.max(1, -moneyMin);
  const pTop0 = pctMax > 0 ? pctMax : Math.max(1, -pctMin);
  const pTop = below > 0 && pctMin < 0 ? Math.max(pTop0, -pctMin / below) : pTop0;
  const mBottom = -below * mTop;
  const pBottom = -below * pTop;
  const padB = below > 0 ? CHART_PAD_B_NEG : CHART_PAD_B;
  const plotH = CHART_H - CHART_PAD_T - padB;
  const yMoney = (v: number) => CHART_PAD_T + ((mTop - v) / (mTop - mBottom)) * plotH;
  const yPct = (v: number) => CHART_PAD_T + ((pTop - v) / (pTop - pBottom)) * plotH;
  const zeroY = yMoney(0);

  const slot = (plotW - 2 * CHART_EDGE) / n;
  const barW = slot * 0.24;
  const xOf = (i: number) => CHART_PAD_L + CHART_EDGE + slot * i + slot / 2;

  const dots = years
    .map((y, i) => (y.netMargin === null ? null : { x: xOf(i), y: yPct(y.netMargin), v: y.netMargin, i }))
    .filter((d): d is { x: number; y: number; v: number; i: number } => d !== null);
  // A missing margin breaks the line, as on the earnings page.
  const segments: string[] = [];
  let run: string[] = [];
  years.forEach((y, i) => {
    if (y.netMargin === null) { if (run.length > 1) segments.push(run.join(" ")); run = []; return; }
    run.push(`${run.length ? "L" : "M"}${xOf(i).toFixed(1)},${yPct(y.netMargin).toFixed(1)}`);
  });
  if (run.length > 1) segments.push(run.join(" "));
  const last = dots.at(-1);

  // A scale label INSIDE the plot: at the left (the $ scale) or right (the margin %) edge, `dy` from its line.
  const tick = (y: number, text: string, side: "l" | "r", dy: number) => (
    <text
      data-scale={side}
      x={side === "l" ? CHART_PAD_L : CHART_W - CHART_PAD_R}
      y={y + dy}
      textAnchor={side === "l" ? "start" : "end"}
      fontSize="0.75rem"
      fill={C.muted}
    >
      {text}
    </text>
  );
  const plotBottom = CHART_PAD_T + plotH;
  // A raised margin top's label sits above its own line, lifted only as far as
  // it takes to clear the "0%" label when the two lines are close.
  const pctTopY = pTop > pctMax ? Math.min(yPct(pctMax), zeroY - CHART_LABEL_GAP) : CHART_PAD_T;
  const leftPct = ((CHART_PAD_L + CHART_EDGE) / CHART_W) * 100;
  const rightPct = ((CHART_PAD_R + CHART_EDGE) / CHART_W) * 100;

  return (
    <div style={{ marginTop: 14 }} data-snapshot-chart="">
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} width="100%" role="img" aria-label="Revenue, net income and net margin for the last fiscal years" style={{ display: "block", overflow: "visible" }}>
        <line x1={CHART_PAD_L} x2={CHART_W - CHART_PAD_R} y1={zeroY} y2={zeroY} stroke={C.rule} strokeWidth={1} />
        <line x1={CHART_PAD_L} x2={CHART_W - CHART_PAD_R} y1={CHART_PAD_T} y2={CHART_PAD_T} stroke={C.rule} strokeWidth={0.5} strokeDasharray="2 3" />
        {mBottom < 0 ? <line x1={CHART_PAD_L} x2={CHART_W - CHART_PAD_R} y1={plotBottom} y2={plotBottom} stroke={C.rule} strokeWidth={0.5} strokeDasharray="2 3" /> : null}
        {moneyMax > 0 ? tick(yMoney(moneyMax), moneyTick(moneyMax), "l", -9) : null}
        {/* The $0 / 0% line, labelled at the edges, where no bar stands (#126). */}
        {tick(zeroY, "$0", "l", -3)}
        {tick(zeroY, "0%", "r", -3)}
        {/* A scale's bottom only where that scale has a negative: the other may reach down for it. */}
        {mBottom < 0 && moneyMin < 0 ? tick(plotBottom, moneyTick(mBottom), "l", 18) : null}
        {/* THE MARGIN TOP IS THE DATA'S (#563 COWORK #127): the highest margin
            plotted, at its own height, never the raised plot top (INTC read 119%). */}
        {pctMax > 0 && pTop > pctMax ? <line data-margin-top="" x1={CHART_PAD_L} x2={CHART_W - CHART_PAD_R} y1={yPct(pctMax)} y2={yPct(pctMax)} stroke={C.rule} strokeWidth={0.5} strokeDasharray="2 3" /> : null}
        {pctMax > 0 ? tick(pctTopY, `${Math.round(pctMax)}%`, "r", pTop > pctMax ? -3 : -9) : null}
        {pBottom < 0 && pctMin < 0 ? tick(plotBottom, `${Math.round(pBottom)}%`, "r", 18) : null}
        {years.map((y, i) => {
          const x = xOf(i);
          const bar = (v: number, dx: number, fill: string, kind: string) => {
            const top = Math.min(yMoney(v), zeroY);
            const h = Math.max(1, Math.abs(yMoney(v) - zeroY));
            return <rect key={kind} data-bar={kind} x={x + dx} y={top} width={barW} height={h} rx={1.5} fill={fill} />;
          };
          return (
            <g key={y.label}>
              {y.revenue !== null ? bar(y.revenue, -barW - 1, C.sales, "revenue") : null}
              {y.netIncome !== null ? bar(y.netIncome, 1, y.netIncome < 0 ? C.loss : C.profit, y.netIncome < 0 ? "loss" : "profit") : null}
            </g>
          );
        })}
        {segments.map((d) => (
          <path key={d} d={d} fill="none" stroke={C.margin} strokeWidth={GROWTH_MARGIN_LINE.width} strokeOpacity={GROWTH_MARGIN_LINE.opacity} />
        ))}
        {dots.map((d) => <circle key={d.i} data-margin-dot="" cx={d.x} cy={d.y} r={3} fill={C.margin} />)}
      </svg>
      {/* THE YEAR LABELS, IN HTML SO EACH OPENS ITS FIGURES ON A TAP. Laid
          over the plot's own columns: the same side padding, as a % of width. */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, marginLeft: `${leftPct}%`, marginRight: `${rightPct}%` }}>
        {years.map((y) => {
          const gap = y.revenueGap ?? y.profitGap;
          return (
            <div key={y.label} style={chartYearStyle} data-snapshot-year={y.label}>
              <ReasonedValue text={y.short} reason={yearNote(y)} />
              {gap ? <div style={chartGapStyle}>{gap.words}</div> : null}
              {y.oneOff && !gap ? <div style={chartGapStyle}>Includes a one-off</div> : null}
            </div>
          );
        })}
      </div>
      <div style={chartLegendStyle} data-snapshot-legend="">
        <span><i style={{ ...legendSwatchStyle, background: C.sales }} />Revenue</span>
        <span><i style={{ ...legendSwatchStyle, background: C.profit }} />Net income</span>
        {/* THE NEWEST MARGIN, HERE AND NOT ON THE PLOT (#563 COWORK #123): it collided with the scale labels. */}
        <span><i style={{ ...legendSwatchStyle, background: C.margin, borderRadius: 999 }} />Net margin %{last ? <> · {years[last.i].short} <b data-margin-latest="" style={{ color: isLoss(last.v) ? LOSS_TEXT : C.margin }}>{formatLevel(last.v)}</b></> : null}</span>
      </div>
    </div>
  );
}

function EarningsMetric({
  label,
  value,
  meta,
  tone,
  note,
  loss = false,
}: {
  label: string;
  value: string;
  meta?: string | null;
  tone?: ToneKey;
  note?: string | null;
  /** A loss-maker's margin: its minus sign, in red (#552 COWORK #144). */
  loss?: boolean;
}) {
  return (
    <div style={earningsMetricStyle(tone)}>
      <div style={earningsMiniLabelStyle}>{label}</div>
      <div data-loss={loss ? "" : undefined} style={loss ? { ...earningsMetricValueStyle, color: LOSS_TEXT } : earningsMetricValueStyle}>{value}</div>
      {meta && meta !== "—" ? <div style={earningsMetricMetaStyle(tone)}>{meta}</div> : null}
      {/* HOW THE NUMBER WAS ARRIVED AT, where it was not simply filed. A
          differenced quarterly cash figure or a computed margin is not the
          same claim as an as-filed one, and the full report marks them, so
          the sidebar does too rather than presenting all four alike. */}
      {note ? <div style={earningsMetricNoteStyle}>{note}</div> : null}
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const sectionEyebrowStyle: CSSProperties = { fontSize: "var(--fs-label)", fontWeight: 950, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(147,197,253,0.82)" };
const sectionTitleSmallStyle: CSSProperties = { margin: "8px 0 0 0", fontSize: "1.375rem", lineHeight: 1.12, letterSpacing: "-0.03em" };
const bodyCopyStyle: CSSProperties = { margin: "14px 0 0 0", fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)", color: "rgba(241,245,249,0.82)" };

/**
 * The card's own frame.
 *
 * TAKES `available` FOR THE SAME REASON THE PILL DOES. The first version keyed
 * only on `tone`, and the scorer's refusal branch returns "neutral" because
 * its type needs a tone — so a stock the site cannot score drew an amber card
 * with a grey pill on it. The pill said "Unavailable" and everything around it
 * said "Mixed". Colour on a finance page is a claim, and half a claim is worse
 * than none: a reader scanning for the amber-bordered cards finds the ones
 * with no data among them.
 */
function earningsCardStyle(tone: ToneKey, verdict: boolean): CSSProperties {
  const rgb = verdict ? TONE_RGB[tone] : "148,163,184";
  return {
    border: `1px solid rgba(${rgb},0.25)`,
    borderRadius: 20,
    padding: 18,
    background: `linear-gradient(135deg, rgba(${rgb},0.09), rgba(255,255,255,0.022))`,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
  };
}

/**
 * The pill.
 *
 * AN UNAVAILABLE VERDICT IS NOT A NEUTRAL ONE. `tone` is "neutral" on the
 * scorer's unavailable branch because its shape requires a tone, and painting
 * that pill the same amber as a genuine Mixed reading would present "we could
 * not measure this" as "we measured it and it was middling". It renders grey.
 *
 * `verdict` IS "available AND not partial". A partial score is the same shape of
 * problem one step removed: ABVX's reach was 34 to 66, wholly inside MIXED, so
 * an amber pill reported the missing inputs, not the company.
 */
function earningsTonePillStyle(tone: ToneKey, verdict: boolean): CSSProperties {
  const rgb = verdict ? TONE_RGB[tone] : "148,163,184";
  const color = verdict ? TONE_TEXT[tone] : "rgba(226,232,240,0.78)";
  return { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "7px 10px", borderRadius: 999, border: `1px solid rgba(${rgb},0.34)`, background: `rgba(${rgb},0.12)`, color, fontSize: "var(--fs-label)", fontWeight: 950, textTransform: "uppercase", letterSpacing: "0.06em" };
}

const earningsDateRowStyle: CSSProperties = { marginTop: 14, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 };
// THREE TILES SINCE #552 COWORK #134 (EPS, Gross margin, Operating margin).
// The columns come from SNAPSHOT_GRID_CSS: one row of three where the tile is
// wide enough, else EPS across the top and the two margins under it.
const earningsMetricGridStyle: CSSProperties = { marginTop: 12, display: "grid", gap: 8 };
/** The width (px) of the tile's content below which the three tiles stop sharing a row. */
export const SNAPSHOT_GRID_ONE_ROW_MIN_PX = 300;
const SNAPSHOT_GRID_CSS =
  `.snapshotMetricsWrap{container-type:inline-size}` +
  `.snapshotMetrics{grid-template-columns:repeat(2,minmax(0,1fr))}` +
  `.snapshotMetrics>:first-child{grid-column:1/-1}` +
  `@container (min-width:${SNAPSHOT_GRID_ONE_ROW_MIN_PX}px){.snapshotMetrics{grid-template-columns:repeat(3,minmax(0,1fr))}.snapshotMetrics>:first-child{grid-column:auto}}`;

/**
 * A tile. Green or red carries the earnings page snapshot's faint tint (#563 COWORK #123, VS_TINT) over the
 * tile's own dark ground, so the two snapshots read alike; the figure keeps its ink.
 */
function earningsMetricStyle(tone?: ToneKey): CSSProperties {
  const border = tone ? `rgba(${TONE_RGB[tone]},0.23)` : "rgba(255,255,255,0.08)";
  const tint = tone === "good" || tone === "weak" ? VS_TINT[tone] : null;
  return { border: `1px solid ${border}`, borderRadius: 14, padding: 10, background: tint ? `linear-gradient(${tint}, ${tint}), rgba(2,6,23,0.30)` : "rgba(2,6,23,0.30)", minWidth: 0 };
}

const earningsMiniLabelStyle: CSSProperties = { fontSize: "var(--fs-label)", fontWeight: 950, letterSpacing: "0.09em", textTransform: "uppercase", color: "rgba(203,213,225,0.72)" };
const earningsMiniValueStyle: CSSProperties = { marginTop: 5, fontSize: "0.875rem", fontWeight: 900, color: "#f8fafc" };
/** A sentence, not a date, so it wraps and sits a notch lighter than a value. */
const earningsMiniSentenceStyle: CSSProperties = { marginTop: 5, fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)", fontWeight: 800, color: "#f8fafc" };
const earningsMiniSubStyle: CSSProperties = { marginTop: 3, fontSize: "var(--fs-fine)", lineHeight: 1.5, color: "rgba(203,213,225,0.58)" };
const earningsMetricValueStyle: CSSProperties = { marginTop: 6, fontSize: "1.125rem", lineHeight: 1.08, fontWeight: 950, letterSpacing: "-0.035em", color: "#f8fafc" };
const earningsMetricNoteStyle: CSSProperties = { marginTop: 4, fontSize: "var(--fs-label)", lineHeight: 1.4, color: "rgba(203,213,225,0.55)" };
const periodLineStyle: CSSProperties = { marginTop: 14, fontSize: "var(--fs-fine)", fontWeight: 800, letterSpacing: "0.01em", color: "rgba(226,232,240,0.72)" };
const earningsFootnoteStyle: CSSProperties = { marginTop: 10, fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)", color: "rgba(203,213,225,0.62)" };

function earningsMetricMetaStyle(tone?: ToneKey): CSSProperties {
  return { marginTop: 5, fontSize: "var(--fs-label)", fontWeight: 850, color: tone ? TONE_TEXT[tone] : "rgba(226,232,240,0.70)" };
}

const fullReportLinkStyle: CSSProperties = {
  marginTop: 14,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 46,
  borderRadius: 14,
  border: "1px solid rgba(59,130,246,0.32)",
  background: "linear-gradient(135deg, rgba(59,130,246,0.14), rgba(15,23,42,0.30))",
  color: "#dbeafe",
  textDecoration: "none",
  fontSize: "var(--fs-label)",
  fontWeight: 950,
  letterSpacing: "0.02em",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.035)",
};

const chartReasonStyle: CSSProperties = { marginTop: 14, fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)", color: "rgba(203,213,225,0.70)" };
const chartYearStyle: CSSProperties = { textAlign: "center", fontSize: "var(--fs-fine)", fontWeight: 800, color: "rgba(226,232,240,0.80)", minWidth: 0 };
const chartGapStyle: CSSProperties = { marginTop: 2, fontSize: "var(--fs-fine)", lineHeight: 1.25, color: "rgba(203,213,225,0.58)" };
const chartLegendStyle: CSSProperties = { marginTop: 8, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "4px 12px", fontSize: "var(--fs-label)", color: "rgba(203,213,225,0.72)" };
const legendSwatchStyle: CSSProperties = { display: "inline-block", width: 9, height: 9, borderRadius: 2, marginRight: 5, verticalAlign: "-1px" };

const earningsHowStyle: CSSProperties = { marginTop: 12 };
/** The one muted line standing in for the partial-score paragraph; a tap opens it. */
const partialSummaryStyle: CSSProperties = { cursor: "pointer", fontSize: "var(--fs-label)", fontWeight: 700, color: "rgba(203,213,225,0.72)" };
const earningsHowSummaryStyle: CSSProperties = { cursor: "pointer", fontSize: "var(--fs-label)", fontWeight: 700, color: "rgba(147,197,253,0.85)" };
const earningsHowBodyStyle: CSSProperties = { marginTop: 6, fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)", color: "rgba(226,232,240,0.85)" };
