// The earnings page's SEC-backed cards, plus the one that renders a hidden one.
//
// Presentational and server-rendered: every decision about which number is
// which, and what is derived, is made in lib/server/secEarningsView.ts and
// asserted by scripts/check-sec-earnings-page.mjs. This file only draws.
import Link from "next/link";
import {
  CROSSING_NOTE, CROSSING_WORDS, EMPTY_REASONS, SEC_ATTRIBUTION, conversionNote, epsStandardWord,
  filingCreditText, filingNoticeText, isCrossing, periodWords, retiredSource,
  type Pct, type SecEarningsView, type ViewCell,
} from "@/lib/server/secEarningsView";
import {
  STALE_PRICE_WORDS, barValue, growthToneWord, marginToneWord, priceIsCurrent,
  GROWTH_BAND_PCT, MARGIN_BAND_PP, fiscalYearEndNote, stalePriceNote, toneBg, toneColor, toneTint,
  toneForGrowth, toneForMarginDelta, trendSummary, waterfallGate,
  TREND_MIN_PERIODS, coverageIsInformative, partialScoreLabel, partialScoreNote, scaledAmount,
  type EarningsTone, type ScoreCoverage,
} from "@/lib/server/secPresentation";
import { SCORE_BANDS, scoreBandNote, toneLabel, type SecEarningsScore } from "@/lib/server/secEarningsScore";
import {
  REFUSAL_WORDS, marketCap, peRatio, type ValuationInputs,
} from "@/lib/server/secValuation";

/**
 * ── WHAT AN EMPTY CELL MEANS, IN WORDS ────────────────────────────────────
 *
 * A bare "—" is the page shrugging. It carries three completely different
 * meanings on the same card — the company filed nothing, we could not compute
 * something from what it filed, or the figure is genuinely zero — and a reader
 * cannot tell which, so every blank looks like a fault in the site.
 *
 *   NOT_REPORTED     the filer published no figure for this line. Not zero.
 *   cantCalculate()  a DERIVED figure whose input is missing, and it says
 *                    WHICH input, because "can't calculate" alone is the same
 *                    shrug with more words.
 *
 * A FILED ZERO IS STILL A ZERO and renders as $0 — "No debt" is a claim, and
 * it is only true when the filing actually says nil.
 */
const NOT_REPORTED = "Not reported";

/**
 * A TONE, SHOWN AS COLOUR AND AS A WORD — never as colour alone.
 *
 * ── WHY THE WORD IS NOT OPTIONAL ──────────────────────────────────────────
 * The two colours carrying the verdict here are red and green, which is the
 * common colour-vision deficiency. A chip that is only green says nothing to
 * that reader, and nothing at all in print or forced-colors mode. The colour
 * is the fast path for everyone else; the word is the claim.
 *
 * A NULL TONE IS A REAL STATE and gets the muted ink, not a hue: n/m and
 * "not on file" are the page declining to judge, and a yellow chip there would
 * read as "flat", which is a measurement nobody took.
 */
export function ToneChip({ tone, word }: { tone: EarningsTone | null; word: string }) {
  return (
    <span
      className="toneChip"
      style={{ color: toneColor(tone), background: toneBg(tone), borderColor: toneColor(tone) }}
    >
      <i style={{ background: toneColor(tone) }} aria-hidden="true" />
      {word}
    </span>
  );
}

/**
 * ONE HORIZONTAL BAR, SCALED AGAINST THE BIGGEST FIGURE IN ITS OWN LIST.
 *
 * ── WHY A SHARED MAXIMUM AND NOT A PER-ROW ONE ───────────────────────────
 * These lists compare magnitudes — operating cash flow against capex, cash
 * against debt — and that comparison only exists if every bar is drawn to the
 * same scale. A per-row bar normalised to itself is a row of identical full-
 * width bars carrying no information at all while looking like a chart.
 *
 * ABSOLUTE VALUE FOR THE LENGTH, SIGN FOR THE SIDE. Capex is filed negative
 * and free cash flow can be; a length cannot be negative, so the magnitude is
 * the width and the direction is the colour and the printed figure.
 *
 * A NULL DRAWS NOTHING. Not a zero-width bar — see barValue in
 * secPresentation: a mark on the axis reads as a measured zero.
 */
function HBar({ value, max, tone }: { value: number | null; max: number; tone: EarningsTone | null }) {
  if (value === null || !Number.isFinite(value) || max <= 0) {
    return <div className="hbarTrack" aria-hidden="true" />;
  }
  const pct = Math.max(0, Math.min(100, (Math.abs(value) / max) * 100));
  return (
    <div className="hbarTrack" aria-hidden="true">
      <span className="hbarFill" style={{ width: `${pct}%`, background: toneColor(tone) }} />
    </div>
  );
}

/**
 * A LIST OF LABELLED MAGNITUDES, each with its bar.
 *
 * The rows carry their own figures as text — the bar is a second encoding of a
 * number the reader can already read, which is what makes it safe to drop for
 * anyone the colour does not reach.
 */
function HBarList({ rows }: { rows: { label: string; value: number | null; tone: EarningsTone | null; text: React.ReactNode; sub?: string }[] }) {
  const max = Math.max(0, ...rows.map((r) => (r.value === null || !Number.isFinite(r.value) ? 0 : Math.abs(r.value))));
  return (
    <div className="hbarList">
      {rows.map((r) => (
        <div className="hbarRow" key={r.label}>
          <div className="hbarHead">
            <span className="hbarLabel">{r.label}</span>
            <span className="hbarValue">{r.text}</span>
          </div>
          <HBar value={r.value} max={max} tone={r.tone} />
          {r.sub ? <span className="hbarSub">{r.sub}</span> : null}
        </div>
      ))}
    </div>
  );
}

/**
 * THE P&L WATERFALL — drawn only where the lines reconcile.
 *
 * The gate is waterfallGate in secPresentation, which reads the SAME
 * `incomeStatementComplete` flag the card's wording turns on. This component
 * never decides; it is handed steps that already sum to the total or it is not
 * rendered at all. See the gate's docblock for why a chart that visibly fails
 * to sum is worse than no chart.
 *
 * EACH STEP IS DRAWN FROM WHERE THE LAST ONE ENDED, which is the whole of a
 * waterfall: the offset carries the running total and the bar carries the
 * change. The final bar is anchored at zero because it is a LEVEL, not a step.
 */
function Waterfall({
  steps, total, totalLabel, format,
}: {
  steps: { key: string; label: string; delta: number }[];
  total: number;
  totalLabel: string;
  format: (n: number) => string;
}) {
  // A PLAIN LOOP, NOT A map() OVER A MUTATED CLOSURE. The running total has to
  // be carried from one step to the next — that is what a waterfall is — and
  // `let running` reassigned inside a `.map` callback is exactly the shape the
  // React compiler rejects (react-hooks/immutability), because a callback that
  // outlives the render would then read a moving value. The loop says the same
  // thing with the accumulator where it belongs.
  const points: { key: string; label: string; delta: number; from: number; to: number }[] = [];
  for (const s of steps) {
    const from = points.length ? points[points.length - 1].to : 0;
    points.push({ ...s, from, to: from + s.delta });
  }
  const span = Math.max(...points.map((p) => Math.max(p.from, p.to)), total, 0);
  if (!(span > 0)) return null;
  const pc = (n: number) => `${(Math.abs(n) / span) * 100}%`;
  return (
    <div className="waterfall">
      {points.map((p) => (
        <div className="wfRow" key={p.key}>
          <span className="wfLabel">{p.label}</span>
          <div className="wfTrack">
            <span
              className="wfBar"
              style={{
                marginLeft: pc(Math.min(p.from, p.to)),
                width: pc(p.delta),
                background: p.delta >= 0 ? toneColor("good") : toneColor("weak"),
              }}
            />
          </div>
          <span className="wfValue">{format(p.delta)}</span>
        </div>
      ))}
      <div className="wfRow wfTotal">
        <span className="wfLabel">{totalLabel}</span>
        <div className="wfTrack">
          <span className="wfBar" style={{ width: pc(total), background: "rgba(147,197,253,0.85)" }} />
        </div>
        <span className="wfValue">{format(total)}</span>
      </div>
    </div>
  );
}

/** The footnote that explains it, carried by every card that can show one. */
const NOT_REPORTED_NOTE =
  "\u201cNot reported\u201d means the company\u2019s SEC filing has no figure for that line. " +
  "It may be zero, or included under another heading.";

/**
 * SHORT LABELS FOR NARROW TABLE CELLS, with the full reason as the tooltip.
 *
 * "Not captured from this filing" wrapped to three lines in the five-year
 * table's revenue column on AVAV (owner review, round 2). Tables print the
 * short form; the snapshot tiles, which have room, keep the full sentence.
 */
const EMPTY_SHORT: Record<string, string> = {
  [EMPTY_REASONS.notCaptured]: "Not captured",
  [EMPTY_REASONS.epsPerClass]: "Per share class",
  [EMPTY_REASONS.epsPerUnit]: "Per unit",
  [EMPTY_REASONS.noRevenueLine]: "No revenue line",
  [NOT_REPORTED]: NOT_REPORTED,
};
const EMPTY_FULL: Record<string, string> = {
  [EMPTY_REASONS.notCaptured]: `${EMPTY_REASONS.notCaptured}: the figure may be filed under a concept this page does not read yet.`,
  [EMPTY_REASONS.epsPerClass]: `${EMPTY_REASONS.epsPerClass}: the company files a separate EPS for each class of its shares, so there is no single figure to show here.`,
  [EMPTY_REASONS.epsPerUnit]: `${EMPTY_REASONS.epsPerUnit}: the partnership files its earnings per unit rather than per share.`,
  [EMPTY_REASONS.noRevenueLine]: `${EMPTY_REASONS.noRevenueLine}: the company publishes no revenue figure this page reads.`,
  [NOT_REPORTED]: "The company\u2019s SEC filing has no figure for that line. It may be zero, or included under another heading.",
};

/**
 * WHAT A BLANK EPS CELL SAYS for this filer (#535 COWORK #11). A filer whose
 * filing carries EPS per share class or per unit gets that reason, everywhere
 * EPS renders; a Q4 row keeps its own "not filed on its own" story, which is
 * true of every filer; everyone else keeps NOT_REPORTED as before.
 */
const epsEmpty = (view: SecEarningsView, label: string) =>
  view.epsReason && !/^Q4 /.test(label) ? view.epsReason : NOT_REPORTED;

/** A derived figure that cannot be computed, naming the input that is missing. */
const cantCalculate = (missing: string) => `Can't calculate — ${missing} not reported`;

/**
 * A DOLLAR FIGURE. `perShare` fixes it at two decimals.
 *
 * maximumFractionDigits alone DROPS A TRAILING ZERO, so a filed EPS of 4.30
 * rendered "$4.3" and 4.50 rendered "$4.5" — TSLA FY2023 and AZN FY2024, both
 * found on production. Money is written to the cent; "$4.3" reads as a
 * different, sloppier number than the filing contains.
 *
 * Only per-share values are pinned. A revenue of $416,161,000,000 does not want
 * ".00" on the end, and the compact form has its own precision: scaledAmount,
 * the page's one rule for large amounts (B from $1B, otherwise M at one
 * decimal, decided per row — see its docblock in secPresentation).
 */
function money(v: number | null | undefined, compact = false, perShare = false): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (compact) return scaledAmount(v);
  const digits = perShare
    ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { maximumFractionDigits: 2 };
  return `${v < 0 ? "-" : ""}$${abs.toLocaleString("en-US", digits)}`;
}
/**
 * A CHANGE, signed. The "+" says "up on the base", so it belongs only on a
 * figure that HAS a base.
 *
 * THREE OUTCOMES, NOT TWO. "—" is "not on file"; `n/m` is "on file and the
 * percentage would mislead" — see Pct in secEarningsView. They must not
 * collapse into one marker: a reader who sees a dash goes looking for the
 * missing filing, and the filing is there.
 */
const pct = (v: Pct | undefined, digits = 1) => {
  // A CROSSING IS A SENTENCE, NOT A NUMBER. "Turned profitable" is what
  // happened; a percentage against a negative base is not.
  if (v != null && isCrossing(v)) return CROSSING_WORDS[v];
  return v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
};

/**
 * WHY A Q4 EPS CELL IS BLANK, in one sentence used by all three places.
 *
 * ── THE OLD WORDING WAS FALSE FOR HALF-YEARLY FILERS ──────────────────────
 * It read "companies file nine-month and full-year figures, and this page does
 * not derive the difference" — which describes a US 10-Q filer's calendar and
 * nobody else's. AZN files half-yearly under 20-F/6-K: there is no nine-month
 * figure to difference, so the sentence explained a mechanism that does not
 * exist for the filer whose page it was on.
 *
 * The replacement states the FACT (Q4 is not filed as a period of its own) and
 * this page's RULE (it does not derive one), neither of which depends on the
 * filer's reporting frequency.
 */
//
// ── AND IT QUOTES THE CONSTANT RATHER THAN SPELLING THE WORDS AGAIN ────────
// The note said cells read "not filed" while the snapshot and the income
// statement rendered NOT_REPORTED — two words for one state, on one page, for
// one filer. ABVX showed both: "not filed" in the growth table's EPS column
// and "Not reported" against Diluted EPS three cards up.
//
// NOT_REPORTED wins because it is the page's established term, used by every
// other empty cell, and its own docblock already defines it ("the filer
// published no figure for this line. Not zero."). Interpolating it here, and
// rendering it in the Q4 cell below, means the note cannot describe a word the
// page does not show.
/** The one-line version the growth card's intro carries. */
const Q4_EPS_SHORT = `Q4 EPS isn\u2019t filed separately, so it reads ${NOT_REPORTED}.`;

const Q4_EPS_NOTE =
  "Q4 EPS is not filed as a separate period, and this page does not derive it, " +
  `so those cells read \u201c${NOT_REPORTED}\u201d.`;

/**
 * A growth figure as rendered — and a CROSSING CARRIES ITS OWN EXPLANATION.
 *
 * The sentence explaining "Loss both periods" is printed once per page (see
 * crossingNoteHome); every cell that shows one of the words also carries it
 * on the element, so a reader who meets the word far from the footnote is
 * one hover or one tap away from why there is no percentage.
 */
function PctCell({ v }: { v: Pct | undefined }) {
  if (v != null && isCrossing(v)) {
    return (
      <abbr className="crossTip" title={CROSSING_NOTE} tabIndex={0}>
        {CROSSING_WORDS[v]}
      </abbr>
    );
  }
  return <>{pct(v)}</>;
}

/**
 * WHICH CARD PRINTS THE CROSSING FOOTNOTE — exactly one per page.
 *
 * It was printed under the snapshot, the growth table AND the five-year table
 * on AVAV, the same paragraph three times. It now goes on the FIRST card, in
 * page order, whose figures actually contain a crossing, and nowhere if none
 * do. Decided from the view alone, so each card can ask without the page
 * wiring a flag through.
 */
export function crossingNoteHome(view: SecEarningsView): "snapshot" | "growth" | "annual" | null {
  const has = (rows: { revenueYoY: Pct | undefined; epsYoY: Pct | undefined }[]) =>
    rows.some((r) => (r.revenueYoY != null && isCrossing(r.revenueYoY)) || (r.epsYoY != null && isCrossing(r.epsYoY)));
  if (has([view.snapshot])) return "snapshot";
  if (view.tableBasis !== "year" && has(view.growth)) return "growth";
  if (has(view.annual)) return "annual";
  return null;
}

/**
 * WHAT A BLANK REVENUE CELL SAYS — the reason, never a bare "Not reported".
 *
 * "Not reported" is a claim about the company. Where no revenue concept in our
 * chains is published at all (the extraction-time marker, view.untagged) the
 * company has no revenue line; otherwise the figure is simply not in that
 * filing as we read it ("Not captured from this filing"). Same words as the sidebar card.
 */
const revenueEmpty = (view: SecEarningsView) =>
  (view.untagged ?? []).includes("revenue") ? EMPTY_REASONS.noRevenueLine : EMPTY_REASONS.notCaptured;

/** The sign of a level, as a tone: profit green, loss red, nothing grey. */
const signTone = (v: number | null | undefined): EarningsTone | null =>
  v == null || !Number.isFinite(v) ? null : v > 0 ? "good" : v < 0 ? "weak" : "neutral";

/**
 * A LEVEL, unsigned. Margins are a share of revenue, not a change in one, and
 * rendering a 82.9% gross margin as "+82.9%" reads as growth of 82.9%.
 */
/**
 * A MARGIN REFUSED BY NAME (secEarningsView.revenueLineIncomplete): the short
 * form in the narrow table cell, the full reason as its tooltip — the same
 * pattern as EMPTY_SHORT.
 */
function NotMeaningful() {
  return (
    <abbr className="cellShort" title={EMPTY_REASONS.revenueIncomplete} tabIndex={0}
      style={{ textDecoration: "none", cursor: "help", color: "#94a3b8" }}>
      Not meaningful
    </abbr>
  );
}

const pctLevel = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(digits)}%`;
const ratio = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : v.toFixed(2);

/**
 * The marker on a figure the filer did not publish for that period.
 *
 * NOT A FOOTNOTE SYMBOL ALONE. A bare asterisk tells a reader something is
 * different without saying what, so the sentence is on the element itself.
 */
export function DerivedMark({ cell }: { cell: ViewCell }) {
  if (!cell.derivedNote) return null;
  return (
    <abbr
      title={cell.derivedNote}
      style={{ marginLeft: 5, fontSize: 11, fontWeight: 800, color: "#94a3b8", textDecoration: "none", cursor: "help" }}
    >
      derived
    </abbr>
  );
}

/** A cell's value, with its derived mark. `—` when the filer did not publish it. */
export function CellValue(
  { cell, compact = false, currency = true, empty = NOT_REPORTED, short = false, emptyTitle }:
  {
    cell: ViewCell; compact?: boolean; currency?: boolean; empty?: string;
    /** A narrow table column: print the short label, the full reason on hover/tap. */
    short?: boolean;
    /** The full reason for `short`, when it says more than `empty` (Q4 EPS). */
    emptyTitle?: string;
  }
) {
  // NOT A DASH. A null here means the filer published no figure for this line,
  // and that is a fact about the filing worth stating. A filed ZERO still
  // renders ("$0.0M") — money() is only reached when there is a value. `empty`
  // lets a caller that KNOWS the reason say it (see revenueEmpty).
  if (cell.val == null) {
    if (short) {
      return (
        <abbr className="cellShort" title={emptyTitle ?? EMPTY_FULL[empty] ?? empty} tabIndex={0}
          style={{ color: "#94a3b8", fontWeight: 600 }}>
          {EMPTY_SHORT[empty] ?? empty}
        </abbr>
      );
    }
    return <span style={{ color: "#94a3b8", fontWeight: 600 }}>{empty}</span>;
  }
  return (
    <>
      {/* PER-SHARE PRECISION TRAVELS WITH THE CELL, not with the call site —
          EPS renders in four places and one of them is a loop over field keys
          that no one writes out by hand. See ViewCell.perShare. */}
      {currency
        ? money(cell.val, compact && !cell.perShare, cell.perShare)
        // A SHARE COUNT TAKES THE SAME SCALE, WITHOUT THE $: "49.8M", not
        // "49,822,595" — nine digits in a column of 1dp M figures.
        : compact ? scaledAmount(cell.val, false) : cell.val.toLocaleString("en-US")}
      <DerivedMark cell={cell} />
    </>
  );
}

/** A derived dollar figure: the value, or which input stopped it. */
export function DerivedValue(
  { value, missing, compact = true }: { value: number | null; missing: string | null; compact?: boolean }
) {
  if (value !== null) return <>{money(value, compact)}</>;
  return (
    <span style={{ color: "#94a3b8", fontWeight: 600 }}>
      {missing ? cantCalculate(missing) : NOT_REPORTED}
    </span>
  );
}

/**
 * A card whose source went away.
 *
 * THE OWNER'S RULE: hidden, not removed, with the reason visible and the
 * registry entry naming what went and when. Never a blank space and never a
 * zero -- "EPS surprise: 0.00" reads as "came in exactly in line", which is a
 * claim, and a false one.
 */
/**
 * ── A HIDDEN SOURCE RENDERS NOTHING. THE REGISTRY STAYS. ──────────────────
 *
 * This used to render a dashed "Not shown" card carrying the reason. The rule
 * has been reversed deliberately by the owner: the five retired sources render
 * NOTHING AT ALL, because a page carrying five apology cards about analyst
 * estimates reads as a broken page rather than an honest one, and no free
 * source for any of them exists to restore.
 *
 * WHAT IS NOT REVERSED: the registry. RETIRED_SOURCES still names every one,
 * what supplied it, when it went and why, and `retiredSource()` still THROWS on
 * an unknown id. That is the part that stops the next person re-adding a column
 * and wiring it to whatever is nearest — the reason lives in the source, where
 * someone about to restore the column will read it, instead of on the page,
 * where a reader who never had the feature is told about its absence.
 *
 * `id` is still required and still validated, so hiding a card without
 * registering it is still impossible.
 */
export function HiddenCard({ id }: { id: string; stacked?: boolean }) {
  // Validated for its throw, then discarded. Calling it is the point.
  retiredSource(id);
  return null;
}

/**
 * A snapshot tile. `tone` is a FAINT background, never the text colour: the
 * figure keeps the page's ink so contrast is what it was, and the tint is the
 * glance. Undefined is "no claim at all" (revenue, a level with no direction);
 * null is the grey of a state that is not a number — missing, or a crossing.
 */
function Metric(
  { label, children, sub, tone }:
  { label: string; children: React.ReactNode; sub?: React.ReactNode; tone?: EarningsTone | null }
) {
  return (
    <div className="metricCard" style={tone === undefined ? undefined : { background: toneTint(tone) }}>
      <div className="metricLabel">{label}</div>
      <div className="metricValue">{children}</div>
      {sub ? <div className="metricSub">{sub}</div> : null}
    </div>
  );
}

export function SecSnapshotCard({
  view,
  pending = null,
}: {
  view: SecEarningsView;
  /**
   * A quarter the filer has ANNOUNCED whose figures SEC's data feed does not
   * carry yet. Null is the normal state and renders nothing.
   */
  pending?: { periodEnd: string; announcedOn: string } | null;
}) {
  const s = view.snapshot;
  // EVERY PERIOD NOUN ON THIS CARD COMES FROM HERE. See SecEarningsView.basis.
  const w = periodWords(view.basis);
  // ── ONE EXPLANATION FOR A LAGGING FEED, NOT TWO ─────────────────────────
  // The announced-but-not-filed note (`pending`, from the report-date record)
  // is about the window BEFORE the 10-Q. Once the filing exists, the filing's
  // own notice (or the period read from it) is the truer statement, and the
  // record's cadence-snapped date can be a week off (KO: 26 Jun vs 3 Jul). So
  // `pending` shows only when neither filing line does, and never for a period
  // the card already shows (within the 10 days a 52/53-week end moves).
  const pendingShown =
    pending && !view.filedNotInFeed && !view.latestFromFiling &&
    Date.parse(pending.periodEnd) - Date.parse(view.latestEnd) > 10 * 86400000
      ? pending
      : null;
  return (
    <section className="card">
      <div className="eyebrow">{w.latest}</div>
      <h2>{view.symbol} latest earnings snapshot</h2>
      <p>
        Most recent {w.one} filed: <strong>{view.latestLabel}</strong> (period ending{" "}
        <strong>{view.latestEnd}</strong>)
        {view.latestFiled ? <>, filed <strong>{view.latestFiled}</strong></> : null}.
      </p>
      {/* ── WHY THIS PAGE IS A QUARTER BEHIND, WHEN IT IS ──────────────────
          ABT announced its June quarter on 16 July 2026 and filed the 10-Q on
          28 July. Seven weeks later SEC's companyfacts carried no frame ending
          30 June at all — measured, every tag, no filter — so this card read
          "Most recent quarter filed: Q1 FY2026" and was correct. A reader who
          knows ABT reported in July reads that as broken.

          HEDGED, AND ABOUT THE FEED RATHER THAN THE COMPANY. What is known is
          that an Item 2.02 8-K was filed and that the figures are not in the
          data feed yet. No estimate, no third-party number, nothing about what
          the results were. */}
      {view.latestFromFiling ? (
        <p className="earningsDataNote" style={{ marginTop: -4 }}>{filingCreditText(view.latestFromFiling)}</p>
      ) : null}
      {view.filedNotInFeed ? (
        <p className="earningsDataNote" style={{ marginTop: -4 }}>{filingNoticeText(view.filedNotInFeed)}</p>
      ) : null}
      {pendingShown ? (
        <p className="earningsDataNote" style={{ marginTop: -4 }}>
          Results for the quarter ended <strong>{pendingShown.periodEnd}</strong> were announced on{" "}
          <strong>{pendingShown.announcedOn}</strong>. The SEC has not yet published the figures in its
          data feed, so this page still shows the previous quarter.
        </p>
      ) : null}
      {/* THE ACCESSION IS A DATABASE KEY, NOT A FACT ABOUT THE COMPANY. It read
          as "under accession 0000320193-26-000081" in the middle of a sentence
          a reader was meant to understand. It still identifies the filing, so
          it carries the link rather than the prose. */}
      {view.latestAccession ? (
        <p style={{ marginTop: -4 }}>
          <a
            href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(view.symbol)}&type=10-&dateb=&owner=include&count=10`}
            style={{ color: "#93c5fd", fontWeight: 800 }}
          >
            View this filing on SEC EDGAR
          </a>
        </p>
      ) : null}
      {/* SIX TILES, 3×2 (2 columns on a phone). The tint is the direction at
          a glance and follows the page's own bands: growth by GROWTH_BAND_PCT,
          the three profit lines by sign, revenue untinted because a level has
          no direction, and grey wherever there is no number to judge. */}
      <div className="metricGrid snapshotGrid">
        <Metric label="Revenue" tone={s.revenue.val == null ? null : undefined}>
          <CellValue cell={s.revenue} compact empty={revenueEmpty(view)} />
        </Metric>
        {/* NO COMPARATOR MEANS NO FIGURE, AND THE CARD SAYS WHY. It used to
            take the fourth row back whatever that was, which on a half-yearly
            filer was a four-year-old quarter labelled "year over year". */}
        <Metric
          label="YoY revenue growth"
          tone={toneForGrowth(s.revenueYoY)}
          sub={s.comparedWith ? `Compared with ${s.comparedWith}` : `Prior-year ${w.one} not on file`}
        >
          <PctCell v={s.revenueYoY} />
        </Metric>
        <Metric label={`Diluted EPS (${epsStandardWord(view.accounting)})`} tone={signTone(s.epsDiluted.val)}>
          <CellValue cell={s.epsDiluted} empty={epsEmpty(view, view.latestLabel)} />
        </Metric>
        <Metric
          label="YoY EPS growth"
          tone={toneForGrowth(s.epsYoY)}
          sub={s.comparedWith ? `Compared with ${s.comparedWith}` : `Prior-year ${w.one} not on file`}
        >
          <PctCell v={s.epsYoY} />
        </Metric>
        <Metric label="Operating income" tone={signTone(s.operatingIncome.val)}>
          <CellValue cell={s.operatingIncome} compact />
        </Metric>
        <Metric label="Net income" tone={signTone(s.netIncome.val)}>
          <CellValue cell={s.netIncome} compact />
        </Metric>
      </div>
      {/* ON THE SNAPSHOT, WHICH IS THE CARD EVERY READER SEES. A conversion
          note further down the page is a note most readers never reach, and
          the figures it explains are the ones at the top. */}
      {view.currency ? <p className="earningsDataNote">{conversionNote(view.currency)}</p> : null}
      {/* PERIOD LABELS ARE THE FILER'S OWN FISCAL PERIOD, NOT THE CALENDAR. The
          probe set's year-ends are 31 Mar, 26 Sep, 3 Sep, 31 Oct and 31 Dec, so
          two companies' "2026" can be nine months apart. */}
      <p className="earningsDataNote">{w.labelled}</p>
      {crossingNoteHome(view) === "snapshot" ? <p className="earningsDataNote">{CROSSING_NOTE}</p> : null}
      {/* THE GAAP/IFRS NOTE IS STATED ONCE, IN THE HERO — see EpsBasisLine. */}
      <p className="earningsDataNote">Source: {SEC_ATTRIBUTION}.</p>
    </section>
  );
}


/**
 * GROWTH AND MARGINS AS A PICTURE, over the same periods the table walks.
 *
 * ── WHY IT IS BUILT FROM view.growth AND view.margins, BY INDEX ──────────
 * Those two lists are derived together in buildSecEarningsView precisely so
 * they can be read by index — the docblock there says so. Rebuilding either
 * here would be a second derivation of the same rows, and the first thing it
 * would get wrong is which margin belongs to which period.
 *
 * NO BAR FOR AN n/m. barValue returns null for a crossing, and a null is not
 * drawn — see its docblock: a zero-height bar sits on the axis and reads as
 * "no change".
 */
/** The chart's footnote. Exported for the check, which asserts its clauses. */
export function chartFootnote(blankBars: boolean, one: string, crossings: boolean): string {
  const bands = `Growing/declining: beyond ±${GROWTH_BAND_PCT}%. Margin moves: beyond ±${MARGIN_BAND_PP}pp.`;
  if (!blankBars) return bands;
  return `${bands} Blank bars: ${crossings ? `no year-earlier ${one} on file, or a crossing between profit and loss` : `no year-earlier ${one} on file`}.`;
}

function GrowthMarginsChart({ view }: { view: SecEarningsView }) {
  const w = periodWords(view.tableBasis);
  const rows = view.margins.map((m, i) => ({
    label: m.label,
    revenue: barValue(view.growth[i]?.revenueYoY ?? null),
    operating: m.operating,
  }));
  const revenues = rows.map((r) => r.revenue).filter((v): v is number => v !== null);
  if (revenues.length < 2) return null;
  // TWO REASONS A BAR IS MISSING, COUNTED SEPARATELY. barValue returns null
  // for both a crossing and an absence, and the sentence under the chart has
  // to name the one that actually happened — "no bar because the comparison
  // crossed" is a false explanation for a period the filer never filed.
  const crossings = view.growth.filter((g) => isCrossing(g.revenueYoY)).length;
  const absent = rows.filter((r) => r.revenue === null).length - crossings;
  // ── ALREADY OLDEST FIRST — DO NOT REVERSE IT ─────────────────────────────
  // buildSecEarningsView reverses `margins` and `growth` on the way out (see
  // the `.reverse()` on both), so view.margins[0] is the OLDEST period and the
  // table's own intro says "newest last". A `[...rows].reverse()` here was
  // therefore drawing the chart newest-first under a heading that said oldest
  // first — the same data sloping the opposite direction, which is precisely
  // the failure the ordering rule exists to stop, committed by the rule.
  const ordered = rows;
  const span = Math.max(...revenues.map((v) => Math.abs(v)), 1);
  return (
    <div className="chartBlock">
      <div className="chartBlockTitle">Revenue growth by {w.one}, oldest first</div>
      <div className="gmChart">
        {ordered.map((r) => {
          const tone = toneForGrowth(r.revenue);
          const h = r.revenue === null ? 0 : (Math.abs(r.revenue) / span) * 100;
          return (
            <div className="gmCol" key={r.label}>
              <div className="gmPlot">
                {r.revenue === null ? (
                  <span className="gmNone" title="Not measured" />
                ) : (
                  <span
                    className={r.revenue >= 0 ? "gmBar gmUp" : "gmBar gmDown"}
                    style={{ height: `${h / 2}%`, background: toneColor(tone) }}
                  />
                )}
              </div>
              <span className="gmTick">{r.label}</span>
            </div>
          );
        })}
      </div>
      <div className="chartLegend">
        <span><i style={{ background: toneColor("good") }} />Growing</span>
        <span><i style={{ background: toneColor("neutral") }} />Flat</span>
        <span><i style={{ background: toneColor("weak") }} />Declining</span>
        {/* THE FOURTH SWATCH ONLY WHERE A FOURTH STATE EXISTS — the same rule
            as the n/m legend above it. A grey "Not measured" key on a filer
            whose every period is measured sends the reader hunting for a mark
            that is not on the chart. */}
        {crossings + absent > 0
          ? <span><i style={{ background: toneColor(null) }} />Not measured</span>
          : null}
      </div>
      {/* ONE LINE OF THRESHOLDS, NOT A PARAGRAPH. The bands are the same
          GROWTH_BAND_PCT and MARGIN_BAND_PP every tint on the page uses, and
          the blank-bar clause appears only where a bar is blank. A crossing
          is a blank bar too, and says so in its own table cell. */}
      <p className="earningsDataNote">{chartFootnote(crossings + absent > 0, w.one, crossings > 0)}</p>
    </div>
  );
}

/**
 * DID THE MARGIN ACTUALLY MOVE? — the newest period against its own comparator.
 *
 * ── WHY THE BASE IS FOUND BY LABEL AND NOT BY INDEX ──────────────────────
 * `growth[0].comparedWith` is the view's OWN answer to "which period is this
 * measured against", and it is already on the page in the table's own column.
 * Walking back four rows instead would be a SECOND rule for the same question,
 * and the first filer it disagrees with is the one with a hole in its run —
 * exactly the AZN shape the table already carries a `gap` badge for. Looking
 * the label up in `margins` is a join, not a derivation: if the comparator is
 * not itself on file, there is no base and the line is not drawn.
 *
 * A PERCENTAGE-POINT DIFFERENCE, NOT A PERCENTAGE CHANGE. 6% to 7% is +1.0pp
 * and also +16.7%, and the second is true but useless here; the word "pp" is
 * on the figure so the two cannot be read for each other. MARGIN_BAND_PP is
 * ±0.5pp — a tenth of the growth band — because a margin that moves half a
 * point is a real move and revenue that moves half a percent is noise.
 */
function MarginDelta({ view }: { view: SecEarningsView }) {
  const latest = view.margins[view.margins.length - 1];
  const base = view.growth[view.growth.length - 1]?.comparedWith ?? null;
  if (!latest || base === null) return null;
  const prior = view.margins.find((m) => m.label === base);
  if (!prior || latest.operating === null || prior.operating === null) return null;
  const pp = latest.operating - prior.operating;
  const tone = toneForMarginDelta(pp);
  // ONE LINE: the two margins, the move, the word. The sentence that followed
  // it explaining the half-point band now lives once, in the chart footnote.
  return (
    <p className="earningsDataNote">
      Operating margin vs <strong>{base}</strong>:{" "}
      <strong>{latest.operating.toFixed(1)}%</strong> from {prior.operating.toFixed(1)}%{" "}
      (<strong>{`${pp >= 0 ? "+" : ""}${pp.toFixed(1)}pp`}</strong>){" "}
      <ToneChip tone={tone} word={marginToneWord(tone)} />
    </p>
  );
}

export function SecGrowthMarginsCard({ view }: { view: SecEarningsView }) {
  // TABLE NOUNS COME FROM tableBasis. This card describes the TABLE, not the
  // latest period, and the two differ when a filer's newest annual period ends
  // after its newest quarter.
  const w = periodWords(view.tableBasis);
  return (
    <section className="card">
      <div className="eyebrow">Growth &amp; margins</div>
      <h2>Is growth accelerating, and are margins holding up?</h2>
      {/* "PERIODS ON FILE", NOT "QUARTERS". These are the periods the filer
          published, in order — not a contiguous run. AZN's eight rows carry a
          three-quarter hole and the table presented them as consecutive. */}
      {/* ── THE GAP EXPLANATION IS VISIBLE TEXT, NOT AN abbr TITLE ────────────
          It lived only in the badge's `title`, which is hover-only: on a phone
          there is nothing to hover, so most of the audience saw an unexplained
          "gap" and no way to find out what it meant. This paragraph already
          carries two other clarifications, so it is where the third belongs.
          The badge stays as a per-row marker — it now points at an explanation
          the reader can actually read. */}
      <p>
        Each {w.one} as filed, compared with the same fiscal {w.one} a year earlier.
        {/* ONLY WHERE THERE IS A Q4 ROW WITHOUT EPS. Visible, not hover-only —
            the same lesson as the gap badge. */}
        {view.margins.some((m, i) => /^Q4 /.test(m.label) && view.growth[i]?.epsYoY == null)
          ? <> {Q4_EPS_SHORT}</>
          : null}
        {/* THE GAP SENTENCE ONLY WHEN A ROW IS MARKED gap. It explains a
            badge, and on a filer with no gap it explained nothing. */}
        {view.margins.some((m) => m.gapAfter) ? (
          <>
            {" "}A row marked <strong>gap</strong> has no filing on file for the period immediately
            before it — these are the periods the company published, not a consecutive run of {w.many}.
          </>
        ) : null}
      </p>
      {/* ── THE CHART IS KEYED TO tableBasis, LIKE THE NOUNS ABOVE ───────────
          Same list, same order, same basis. A chart headed "by quarter" over a
          table of fiscal years is the defect the noun rule already exists to
          stop, one element further down the card — and a reader trusts a
          picture faster than a column header. */}
      <GrowthMarginsChart view={view} />
      <MarginDelta view={view} />
      <div style={{ overflowX: "auto" }}>
        <table className="historyTable">
          <thead>
            <tr><th>Period</th><th>Compared with</th><th>Revenue YoY</th><th>EPS YoY</th><th>Gross margin</th><th>Operating margin</th><th>Net margin</th></tr>
          </thead>
          <tbody>
            {view.margins.map((m, i) => (
              <tr key={m.label}>
                {/* data-label, not a position: the page's narrow-screen rule
                    reads attr(data-label), because two tables here have
                    different columns and an nth-child rule would relabel one. */}
                <td data-label="Period">
                  {m.label}
                  {/* The gap is marked on the row ABOVE it in reading order,
                      because `margins` is reversed to oldest-first for display
                      while gapAfter was computed newest-first. */}
                  {m.gapAfter ? (
                    <abbr
                      title="No filing on file for the period immediately before this one — these rows are the periods the company published, not a consecutive run."
                      style={{ marginLeft: 5, fontSize: 11, fontWeight: 800, color: "#94a3b8", textDecoration: "none", cursor: "help" }}
                    >gap</abbr>
                  ) : null}
                </td>
                {/* THE BASE, DISCLOSED PER ROW. The snapshot card named its
                    comparator and this table did not, so the same wrong base
                    was visible in one place and silent in the other. */}
                <td data-label="Compared with">{view.growth[i]?.comparedWith ?? "not on file"}</td>
                <td data-label="Revenue YoY"><PctCell v={view.growth[i]?.revenueYoY} /></td>
                {/* A BLANK Q4 EPS IS NOT A GAP IN THE DATA. Q4 is never filed
                    as a standalone three-month frame, and this page refuses to
                    invent one (no 4·FY − 3·9M, no ratio against another
                    period's share count). A bare "—" reads as missing; the
                    reason is one hover and one footnote away instead. */}
                <td data-label="EPS YoY">
                  {view.growth[i]?.epsYoY == null && /^Q4 /.test(m.label) ? (
                    <abbr title={Q4_EPS_NOTE} style={{ textDecoration: "none", cursor: "help", color: "#94a3b8" }}>
                      {NOT_REPORTED}
                    </abbr>
                  ) : (
                    <PctCell v={view.growth[i]?.epsYoY} />
                  )}
                </td>
                <td data-label="Gross margin">{m.marginsRefused ? <NotMeaningful /> : pctLevel(m.gross)}</td>
                <td data-label="Operating margin">{m.marginsRefused ? <NotMeaningful /> : pctLevel(m.operating)}</td>
                <td data-label="Net margin">{m.marginsRefused ? <NotMeaningful /> : pctLevel(m.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {crossingNoteHome(view) === "growth" ? <p className="earningsDataNote">{CROSSING_NOTE}</p> : null}
      <p className="earningsDataNote">Source: {SEC_ATTRIBUTION}.</p>
    </section>
  );
}

/**
 * FIVE FISCAL YEARS — ONE COMPONENT, TWO PLACES.
 *
 * (i) every stock gets this card, quarterly filer or not, and (ii) for an
 * annual-only filer like KGC it is the ONLY growth table, because that filer
 * has no quarters to tabulate.
 *
 * ONE COMPONENT RATHER THAN TWO, deliberately. Two would be two places for the
 * label, the comparator and the null handling to drift apart, and the whole
 * point of `view.annual` is that both read the same rows built by the same
 * builder from the same helpers.
 *
 * YoY IS FY AGAINST FY-1 BY LABEL — priorYearOf on the years array, which
 * works unchanged because annual periods carry `fp: "FY"` and a real `fy`.
 * Never an array offset, and "not on file" where the prior year is absent.
 * No gap badge: a gap is a quarterly idea (see gapAfter in secEarningsView).
 */
export function SecAnnualCard({ view, sole = false }: { view: SecEarningsView; sole?: boolean }) {
  // ── NOTHING LEFT TO COMPARE, SAID IN ONE LINE ─────────────────────────────
  //
  // A row renders only if its prior year is on file, so a filer with a single
  // stored year — a recent spin-off or IPO — has no rows at all. An empty table
  // with headers is worse than a sentence: it reads as a fault in the site
  // rather than as a fact about the company.
  if (!view.annual.length) {
    return (
      <section className="card">
        <div className="eyebrow">Five-year history</div>
        <h2>{view.symbol} by fiscal year</h2>
        <p style={{ marginBottom: 0 }}>
          Not enough filed years to compare. Year-over-year needs two fiscal years on file, and{" "}
          <strong>{view.symbol}</strong> has fewer — a recent listing or spin-off has no earlier
          year to measure against yet.
        </p>
        <p className="earningsDataNote">Source: {SEC_ATTRIBUTION}.</p>
      </section>
    );
  }
  return (
    <section className="card">
      <div className="eyebrow">Five-year history</div>
      <h2>
        {view.symbol} by fiscal year
        {sole ? "" : " — the longer view"}
      </h2>
      <p>
        Each fiscal year as filed, compared with the year before.
        {fiscalYearEndNote(view.annual.map((r) => r.end)) ? <> {fiscalYearEndNote(view.annual.map((r) => r.end))}</> : null}
        {sole ? (
          <>
            {" "}
            <strong>{view.symbol} files annually</strong>, so these are the only periods it
            publishes — there is no quarterly table below.
          </>
        ) : null}
      </p>
      <div className="annualBox" style={{ overflowX: "auto" }}>
        <table className="historyTable annualTable">
          <thead>
            <tr>
              <th>Fiscal year</th><th>Revenue</th><th>Revenue YoY</th>
              <th>Diluted EPS</th><th className="colCross">EPS YoY</th>
              <th>Gross margin</th><th>Operating margin</th><th>Net margin</th>
            </tr>
          </thead>
          <tbody>
            {view.annual.map((r) => (
              <tr key={r.label}>
                <td data-label="Fiscal year" className="rowHead">
                  {/* THE PERIOD END ON THE LABEL, AS A TOOLTIP. It was a second
                      line under every label; the intro now says it once
                      (fiscalYearEndNote) and the exact date is one hover or
                      tap away — two filers' "FY2025" can be nine months apart. */}
                  <abbr className="cellShort" title={`Ended ${r.end}`} tabIndex={0}>{r.label}</abbr>
                </td>
                {/* NO "COMPARED WITH" COLUMN. The intro says each year is
                    compared with the year before, so the column only repeated
                    the previous row's label and pushed the last column off a
                    768px card (owner review of #523). The quarterly table keeps
                    it, where a gap row makes the comparator informative. */}
                <td data-label="Revenue"><CellValue cell={r.revenue} compact short empty={revenueEmpty(view)} /></td>
                <td data-label="Revenue YoY"><PctCell v={r.revenueYoY} /></td>
                <td data-label="Diluted EPS"><CellValue cell={r.epsDiluted} short empty={epsEmpty(view, r.label)} /></td>
                <td data-label="EPS YoY" className="colCross"><PctCell v={r.epsYoY} /></td>
                <td data-label="Gross margin">{r.marginsRefused ? <NotMeaningful /> : pctLevel(r.gross)}</td>
                <td data-label="Operating margin">{r.marginsRefused ? <NotMeaningful /> : pctLevel(r.operating)}</td>
                <td data-label="Net margin">{r.marginsRefused ? <NotMeaningful /> : pctLevel(r.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {crossingNoteHome(view) === "annual" ? <p className="earningsDataNote">{CROSSING_NOTE}</p> : null}
      <p className="earningsDataNote">Source: {SEC_ATTRIBUTION}.</p>
    </section>
  );
}


/**
 * Money, short — THE SAME RULE AS THE TABLES, not a second one. This had its
 * own: whole millions past 100 and one decimal on B, so AVAV's waterfall said
 * "$480M" over a table saying "$480.5M" and TSLA's bars said "$4.7B" for a
 * "$4.70B" row. One figure, one spelling on the page.
 */
const shortMoney = (n: number) => scaledAmount(n);

/**
 * The three cash figures as magnitudes against one scale.
 *
 * CAPEX IS FILED NEGATIVE AND IS SHOWN AS SPENDING, not as a negative bar
 * pointing the other way: on this card it is a quantity of cash leaving, and
 * its tone is red because that is what it is, not because the sign is minus.
 * Free cash flow keeps its sign, because a negative one is the finding.
 *
 * ── THE BARS ARE THE ONLY PLACE THESE THREE APPEAR ───────────────────────
 * They used to be followed by three rows repeating the same figures (AVAV:
 * "$13.5M, $44.0M, -$30.5M" twice, one under the other). The rows are gone, so
 * each bar's text now carries everything its row did: the derived mark, and
 * the reason when a figure cannot be calculated. And the list always renders
 * — with no rows below it, returning null on three empty figures would drop
 * the "Not reported" words along with the bars.
 */
function CashQualityBars({ view }: { view: SecEarningsView }) {
  const c = view.cashQuality;
  const w = periodWords(view.basis);
  const num = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const ocf = num(c.operatingCashFlow.val);
  const capex = num(c.capex.val);
  // A PLAIN NUMBER ON THIS ONE, not a ViewCell: free cash flow is derived here
  // rather than filed, so it has no cell of its own. See the view's shape.
  const fcf = num(c.freeCashFlow);
  return (
    <HBarList
      rows={[
        { label: "Operating cash flow", value: ocf, tone: ocf !== null && ocf >= 0 ? "good" : "weak",
          text: <CellValue cell={c.operatingCashFlow} compact /> },
        // THE LABEL COMES FROM THE CELL — capex resolves from one concept per
        // filer and the broader productive-assets one is a different measure.
        { label: c.capex.label, value: capex, tone: "weak",
          text: capex === null
            ? <CellValue cell={c.capex} compact />
            : <>{shortMoney(Math.abs(capex))}<DerivedMark cell={c.capex} /></>,
          sub: capex === null ? undefined : "cash spent on productive assets" },
        { label: "Free cash flow", value: fcf, tone: fcf === null ? null : fcf >= 0 ? "good" : "weak",
          text: (
            <>
              <DerivedValue value={c.freeCashFlow} missing={c.freeCashFlowMissing} />
              {c.freeCashFlowDerived ? (
                <abbr
                  title={`Derived: operating cash flow minus capital expenditure, both of which the filer reports year-to-date, so this ${w.one} is the difference between two cumulative figures.`}
                  style={{ marginLeft: 5, fontSize: 11, fontWeight: 800, color: "#94a3b8", textDecoration: "none", cursor: "help" }}
                >derived</abbr>
              ) : null}
            </>
          ) },
      ]}
    />
  );
}

/**
 * The balance sheet as magnitudes: what the company holds against what it owes.
 *
 * NET CASH IS THE ONE THAT CARRIES A VERDICT, and it is the only one toned by
 * sign. Cash and debt are quantities — a large debt is not automatically bad
 * and a large cash pile is not automatically good — so they are drawn in the
 * page's neutral ink rather than being scored.
 *
 * THE ONLY PLACE THESE THREE APPEAR, as on the cash card: the rows that
 * repeated them at a second precision ("$278M" here, "$278.4M" below) are
 * gone, so the bars carry the rows' labels, notes and can't-calculate reasons.
 */
function BalanceSheetBars({ view }: { view: SecEarningsView }) {
  // NULLABLE: a filer with no balance sheet on file has none of this, and the
  // card above already says so in words.
  const b = view.balance;
  if (!b) return null;
  const num = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const cash = num(b.cash?.val);
  // totalDebt and netCash are DERIVED sums, so they are plain numbers; only
  // `cash` is a filed cell.
  const debt = num(b.totalDebt);
  const net = num(b.netCash);
  const direction = net === null ? "" : net >= 0 ? "More cash than debt. " : "More debt than cash. ";
  return (
    <HBarList
      rows={[
        // THE LABEL FOLLOWS THE FIGURE. When the filer published only the
        // restricted-inclusive total, this IS that total, and calling it "Cash
        // & equivalents" would overstate what the company can spend.
        { label: b.cashIncludesRestricted ? "Cash & equivalents (incl. restricted)" : "Cash & equivalents",
          value: cash, tone: "neutral",
          text: <CellValue cell={b.cash} compact />,
          sub: b.cashIncludesRestricted
            ? "This filer reports cash only including restricted cash, which it cannot freely spend."
            : undefined },
        { label: "Total debt", value: debt, tone: "neutral",
          text: <DerivedValue value={b.totalDebt} missing={b.totalDebtMissing} /> },
        { label: "Net cash", value: net, tone: net === null ? null : net >= 0 ? "good" : "weak",
          text: <DerivedValue value={b.netCash} missing={b.netCashMissing} />,
          sub: `${direction}Cash and short-term investments less total debt.${
            b.cashIncludesRestricted ? " The cash leg includes restricted cash." : ""
          }` },
      ]}
    />
  );
}

export function SecCashQualityCard({ view }: { view: SecEarningsView }) {
  const c = view.cashQuality;
  const w = periodWords(view.basis);
  // ── THE FALLBACK PARAGRAPH IS ABOUT A MISMATCH, so it needs one to exist ──
  //
  // It says "{symbol} does not publish a quarterly cash-flow statement … every
  // figure here is the full year {period}, not {latestLabel}". That is exactly
  // right for AZN, whose anchor is a quarter and whose cash flow is only filed
  // on 6- and 12-month frames. On KGC it rendered as "is the full year FY2025,
  // not FY2025" — the two labels are the same period, because the anchor IS
  // the year — and it implied the rest of the page was quarterly when nothing
  // about KGC is. The condition is the MISMATCH, not the cash basis alone.
  const cashIsOtherPeriod = view.basis === "quarter" && c.basis === "year";
  return (
    <section className="card">
      <div className="eyebrow">Quality of earnings</div>
      {/* THE HEADING NAMES THE CARD'S OWN PERIOD, not the page's latest
          quarter. They differ whenever the filer publishes a cash-flow
          statement only on 6- and 12-month frames: every figure below then
          comes from the latest FULL YEAR, and a heading that still said
          "Q2 FY2025" over annual numbers would be the mixed-period claim this
          card is built to avoid. */}
      <h3>Is the profit turning into cash? — {c.period}</h3>
      {cashIsOtherPeriod ? (
        <p style={{ marginTop: 8, marginBottom: 0 }}>
          <strong>{view.symbol} does not publish a quarterly cash-flow statement.</strong> Its
          filings carry cash flow only over six- and twelve-month periods, so every figure on this
          card — including the net income it is compared against — is the full year {c.period},
          not {view.latestLabel}.
        </p>
      ) : null}
      {/* ── THE MAGNITUDES, EACH WITH ITS FIGURE ─────────────────────────────
          The question this card asks — is the profit turning into cash — is a
          COMPARISON of three magnitudes, and three numbers in a column is the
          one shape that makes a comparison hard. The bars are scaled against
          the largest of them, so operating cash flow against capex is a length
          a reader can see rather than two figures they have to divide.
          Every bar prints its figure as text beside its label, so the bar
          itself is a second encoding and still safe to ignore. */}
      <CashQualityBars view={view} />
      <div style={{ marginTop: 12 }}>
        {/* OPERATING CASH FLOW, CAPEX AND FREE CASH FLOW ARE THE BARS ABOVE —
            the rows that repeated them are gone (see CashQualityBars). What
            follows is only what the bars do not show. */}
        <Row label={c.basis === "year" ? "Net income (same period)" : "Net income"}>
          <CellValue cell={c.netIncome} compact />
        </Row>
        {/* BOTH LEGS ARE THE SAME PERIOD. Annual operating cash flow against a
            quarterly net income reads as roughly 4x cash conversion and would
            score STRONG for an arithmetic reason alone. cashFrom in
            secEarningsView selects one period for the whole card. */}
        <Row
          label="Cash flow less net income"
          sub={`Positive means cash is running ahead of reported profit. Both figures are ${c.period}.`}
        >
          <DerivedValue value={c.accruals} missing={c.accrualsMissing} />
        </Row>
        <Row label="Share-based compensation"><CellValue cell={c.shareBasedCompensation} compact /></Row>
      </div>
      {/* TRAP 1, AND IT IS WHY EVERY CASH LINE HERE CAN CARRY A DERIVED MARK.
          US filers report cash flow YEAR-TO-DATE: Q1 covers three months, Q2
          six, Q3 nine, the 10-K twelve. Read straight, a Q3 figure is roughly
          three times too large and looks entirely plausible.
          ── ONE LINE, THE ONE THAT EXPLAINS A MARK ON THIS CARD ──────────────
          This ran to three sentences under a card that is already mostly
          sentences (owner review, TSLA/AVAV). The year-to-date sentence stays
          because it is why a figure here says "derived"; the Not-reported
          sentence is carried by the income statement and balance sheet. */}
      <p className="earningsDataNote">
        {c.basis === "year" ? (
          <>Annual cash-flow figures as filed, for {c.period}. Source: {SEC_ATTRIBUTION}.</>
        ) : (
          <>
            Cash-flow figures are filed year-to-date, so every {w.one} except the first is the
            difference between two cumulative figures — those are marked <em>derived</em>.{" "}
            Source: {SEC_ATTRIBUTION}.
          </>
        )}
      </p>
    </section>
  );
}

/**
 * A QUARTER. Past this the balance-sheet date is far enough from the income
 * statement's period end that presenting them together without a word is
 * misleading, so the card says one.
 */
const BALANCE_SHEET_SPREAD_DAYS = 95;

/**
 * FOUR LINES WHOSE ABSENCE IS ABOUT THE TAGS, NOT THE COMPANY.
 *
 * Every 10-Q carries equity and liabilities, and a filer whose pre-tax income
 * differs from its operating income has non-operating lines. "Not reported"
 * would be a claim about the company that is false; each gets the words that
 * are true of it. NOT_REPORTED itself is unchanged — it is shared with lines
 * (Q4 EPS) where it is the right claim.
 *
 * - Liabilities and equity: "Not found in the filing's tagged data" — only
 *   where the concept really is absent from the filing (AVAV total
 *   liabilities: no liabilities total tagged at all).
 * - Interest expense and other income: "Not captured from this filing", the
 *   site's existing words (EMPTY_REASONS.notCaptured). The filer may tag
 *   these under concepts this page does not read — AVAV tags
 *   InterestIncomeExpenseNonoperatingNet (+$4.1M) and
 *   OtherNonoperatingIncomeExpense (-$0.6M), outside our chains — so "not
 *   found in the tagged data" would be untrue there (#535 COWORK #1, 2026-09-23).
 */
const NOT_IN_TAGGED_DATA = "Not found in the filing\u2019s tagged data";
const TAG_GAP_LINES = new Set(["interestExpense", "nonOperatingIncomeExpense"]);
const EPS_LINES = new Set(["epsBasic", "epsDiluted"]);

export function SecBalanceSheetCard({ view }: { view: SecEarningsView }) {
  const b = view.balance;
  if (!b) return null;
  const spread = view.balanceSheetSpreadDays;
  const apart = spread !== null && Math.abs(spread) > BALANCE_SHEET_SPREAD_DAYS;
  return (
    <section className="card">
      <div className="eyebrow">Balance sheet</div>
      <h3>Financial position as at {b.asOf}</h3>
      {/* THREE PERIODS, ONE LEDE. The page's opening line says "latest reported
          quarter" while the income statement, the cash-flow statement and this
          balance sheet can each be a different period — every one correctly
          labelled, which is not the same as clear. Said only when the dates are
          genuinely far apart; on a normal 10-Q filer they coincide and a
          standing disclaimer would be noise. */}
      {apart ? (
        <p style={{ marginTop: 8, marginBottom: 0 }}>
          This is a <strong>different date</strong> from the income statement above, which covers{" "}
          {view.latestLabel} ending {view.latestEnd}. A balance sheet is a position on one day and a
          filer&apos;s most recent one is not always the end of its most recent reported period —
          these are {Math.abs(spread!)} days apart.
        </p>
      ) : null}
      {/* WHAT IT HOLDS AGAINST WHAT IT OWES, as lengths, each with its figure
          as text; these make the one comparison the card is named for visible
          without arithmetic. */}
      <BalanceSheetBars view={view} />
      <div style={{ marginTop: 12 }}>
        {/* CASH, TOTAL DEBT AND NET CASH ARE THE BARS ABOVE, at the page's one
            precision — the rows that repeated them are gone (see
            BalanceSheetBars). */}
        <Row label="Short-term investments"><CellValue cell={b.shortTermInvestments} compact /></Row>
        <Row label="Current ratio">
          {b.currentRatio !== null ? ratio(b.currentRatio) : (
            <span style={{ color: "#94a3b8", fontWeight: 600 }}>
              {b.currentRatioMissing ? cantCalculate(b.currentRatioMissing) : NOT_REPORTED}
            </span>
          )}
        </Row>
        <Row label="Total assets"><CellValue cell={b.totalAssets} compact /></Row>
        <Row label="Total liabilities"><CellValue cell={b.totalLiabilities} compact empty={NOT_IN_TAGGED_DATA} /></Row>
        {/* THE LABEL FOLLOWS THE FIGURE, as the cash row does: a filer that
            tags only total equity shows that total under its own name. */}
        <Row
          label={b.equityIncludesNci ? "Total equity (incl. noncontrolling interests)" : "Shareholders' equity"}
          strong
          sub={b.equityIncludesNci
            ? "This filer tags equity only including any noncontrolling interests, not the parent\u2019s share alone."
            : undefined}
        >
          <CellValue cell={b.stockholdersEquity} compact empty={NOT_IN_TAGGED_DATA} />
        </Row>
      </div>
      {/* ONE LINE. "A position at a date, so none of them are derived" explained
          the ABSENCE of a mark, which no reader goes looking for; the sentence
          kept is the one that explains words on this card — AVAV shows "Not
          reported" against total liabilities and equity. */}
      <p className="earningsDataNote">
        {NOT_REPORTED_NOTE} Source: {SEC_ATTRIBUTION}.
      </p>
    </section>
  );
}


/**
 * The latest period's P&L as a waterfall, or nothing.
 *
 * This component makes NO decision about whether the arithmetic closes — that
 * is waterfallGate's job, and it reads the flag the card's own note reads. All
 * that happens here is drawing.
 */
function PlWaterfall({ view }: { view: SecEarningsView }) {
  const gate = waterfallGate(view);
  if (!gate.ok) return null;
  const w = periodWords(view.basis);
  return (
    <div className="chartBlock">
      <div className="chartBlockTitle">From revenue to operating income — {view.latestLabel}</div>
      <Waterfall
        steps={gate.steps}
        total={gate.total}
        totalLabel="Operating income"
        format={(n) => shortMoney(n)}
      />
      <p className="earningsDataNote">
        Each bar starts where the one above it ended, so the drop from revenue to operating income
        is the sum of the costs between them. Shown only where the filed expense lines actually
        reach the filed operating income for this {w.one}; where they do not, the table below says
        so instead.
      </p>
    </div>
  );
}

export function SecIncomeStatementCard({ view }: { view: SecEarningsView }) {
  const w = periodWords(view.basis);
  return (
    <section className="card">
      <div className="eyebrow">Income statement</div>
      <h3>Full profit &amp; loss — {view.latestLabel}</h3>
      {/* ── THE WATERFALL, ONLY WHERE THE LINES RECONCILE ──────────────────
          waterfallGate reads view.incomeStatementComplete — the SAME flag the
          note below turns on — so the chart and the wording cannot disagree on
          screen. On the ~16% of quarters where the breakdown misses operating
          income (measured: ARM, MU, by 1-7%), no chart is drawn and the table
          below carries its existing "partial" explanation instead. A waterfall
          asserts that its bars sum to its total; drawing one that does not is
          worse than drawing nothing. */}
      <PlWaterfall view={view} />
      <div style={{ marginTop: 12 }}>
        {view.incomeStatement.map((c) => (
          <Row key={c.label} label={c.label}>
            <CellValue
              cell={c}
              compact
             
              currency={!c.label.includes("shares")}
              empty={c.key === "revenue" ? revenueEmpty(view) : EPS_LINES.has(c.key) ? epsEmpty(view, view.latestLabel) : TAG_GAP_LINES.has(c.key) ? EMPTY_REASONS.notCaptured : NOT_REPORTED}
            />
          </Row>
        ))}
      </div>
      {/* MEASURED TO FAIL ON 5 OF 32 PROBE QUARTERS (ARM, MU), always because the
          filer expenses something these lines have no slot for -- restructuring,
          impairments, amortisation of intangibles. Operating income is taken as
          filed and is right; it is the BREAKDOWN that is partial, and the card
          must not imply otherwise. */}
      <p className="earningsDataNote">{NOT_REPORTED_NOTE}</p>
      {!view.incomeStatementComplete ? (
        <p className="earningsDataNote">
          The expense lines above do not add up to operating income for this {w.one}: this company
          reports costs that these categories do not cover. Operating income is as filed.
        </p>
      ) : null}
      <p className="earningsDataNote">Source: {SEC_ATTRIBUTION}.</p>
    </section>
  );
}

/**
 * THE EARNINGS-HISTORY TABLE, AND IT DOES NOT RENDER ON AN ANNUAL ANCHOR.
 *
 * ── WHY A GUARD AND NOT JUST RENAMED HEADINGS ────────────────────────────
 * On /stock/KGC/earnings this card rendered as "Recent reported quarters",
 * with a QUARTER column and a footnote about the standalone fourth quarter,
 * over five fiscal-year rows — directly below a five-year card whose own text
 * said "there is no quarterly table below". The page contradicted itself about
 * whether the table existed.
 *
 * Renaming the headings would have fixed the words and left the duplication:
 * for an annual-only filer this table's rows ARE the five-year card's rows,
 * same periods, same source, fewer columns. So on a year anchor it renders
 * nothing and the five-year card is the history.
 */
/**
 * A Q4 row whose Diluted EPS cell renders NOT_REPORTED. CellValue prints the
 * empty word exactly when `val` is null, so this is that test plus the Q4
 * label — one function, read by the cell's hover text AND by the footnote.
 */
const q4EpsNotReported = (r: SecEarningsView["recentPeriods"][number]) =>
  /^Q4 /.test(r.label) && r.epsDiluted.val == null;

export function SecRecentPeriodsCard({ view }: { view: SecEarningsView }) {
  // tableBasis: this table IS the rows, so it follows what the rows are.
  if (view.tableBasis === "year") return null;
  const w = periodWords(view.tableBasis);
  return (
    <section className="card">
      <div className="eyebrow">Earnings history</div>
      <h2>Recent reported {w.many}</h2>
      {/* JUST THE SOURCE. This went on to quote the retired column's reason,
          "Same source as the estimate cards above" — and those cards no longer
          render, so the sentence pointed at nothing. The retired columns are
          hidden the way every other retired source is: a HiddenCard, which
          renders nothing and keeps the id validated against RETIRED_SOURCES. */}
      <p>As filed with the SEC.</p>
      <HiddenCard id="quarter-estimate-columns" />
      <div style={{ overflowX: "auto" }}>
        <table className="historyTable">
          <thead><tr><th>{w.One}</th><th>Period ending</th><th>Revenue</th><th>Diluted EPS ({epsStandardWord(view.accounting)})</th><th>Net income</th></tr></thead>
          <tbody>
            {view.recentPeriods.map((r) => (
              <tr key={r.end}>
                <td data-label={w.One}>{r.label}</td>
                <td data-label="Period ending">{r.end}</td>
                <td data-label="Revenue"><CellValue cell={r.revenue} compact short empty={revenueEmpty(view)} /></td>
                <td data-label={`Diluted EPS (${epsStandardWord(view.accounting)})`}>
                  <CellValue cell={r.epsDiluted} short empty={epsEmpty(view, r.label)} emptyTitle={q4EpsNotReported(r) ? Q4_EPS_NOTE : undefined} />
                </td>
                <td data-label="Net income"><CellValue cell={r.netIncome} compact short /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Q4 IS NEVER FILED AS A STANDALONE QUARTER, and a weighted-average share
          count is not additive, so EPS cannot be derived for it either. One row
          in four shows a dash where the filer published nothing.
          ── BUT ONLY WHEN A Q4 CELL ACTUALLY SAYS SO ────────────────────────
          ABBV's Q4 EPS cells all carry figures, and this note still told the
          reader "those cells read Not reported" under a table where none did.
          It is gated on q4EpsNotReported, the same test the cell uses, so the
          note and the cells cannot disagree. */}
      <p className="earningsDataNote">
        {view.recentPeriods.some(q4EpsNotReported) ? <>{Q4_EPS_NOTE} </> : null}Source: {SEC_ATTRIBUTION}.
      </p>
    </section>
  );
}

function Row({ label, children, sub, strong }: { label: string; children: React.ReactNode; sub?: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: "1px solid rgba(148,163,184,0.14)" }}>
      <div style={{ fontSize: 13.5, fontWeight: strong ? 800 : 600, color: strong ? undefined : "#cbd5e1" }}>
        {label}
        {sub ? <div style={{ fontSize: 11.5, fontWeight: 500, color: "#94a3b8" }}>{sub}</div> : null}
      </div>
      <div style={{ fontSize: 13.5, fontWeight: strong ? 800 : 700, whiteSpace: "nowrap" }}>{children}</div>
    </div>
  );
}

/**
 * PENDING — and it must be genuinely temporary.
 *
 * Reached only when a cold fetch timed out, was refused by the per-IP budget, or
 * failed. The symbol IS queued, so this state ends. It is NOT the state for a
 * filer whose data cannot be read at all — see SecNoXbrlCard, and the comment
 * there for why conflating them puts a permanent "coming soon" on a page.
 */
export function SecPendingCard({ symbol }: { symbol: string }) {
  return (
    <section className="card">
      <div className="eyebrow">Loading financials</div>
      <h2>{symbol} financials are being fetched</h2>
      <p style={{ marginBottom: 0 }}>
        This page is built from {SEC_ATTRIBUTION}. {symbol}&apos;s filings are being read now —
        refresh in a moment, or check back shortly.
      </p>
    </section>
  );
}

/**
 * NO READABLE DATA — and the card must say WHOSE limit it is.
 *
 * ── THE COPY THAT SHIPPED WAS A FALSE STATEMENT ABOUT REAL COMPANIES ───────
 * It read "{symbol} does not file the financial data this page is built from".
 * For a foreign private issuer that is simply untrue. companyfacts namespaces
 * facts BY TAXONOMY, so Ryanair's complete IFRS statements were in the payload
 * the whole time, under `ifrs-full`, which these field definitions did not
 * read. The page was describing its own gap as a fact about Ryanair -- on a
 * quarter of stock pages, since 49 of the 55 periodic filers in the measured
 * window were 6-K filers and HSBC, AZN, GSK, NVS, BIDU, SAN, LYG, VALE, ZTO and
 * ABEV are all in the universe.
 *
 * ── SO THERE ARE TWO CARDS' WORTH OF TRUTH HERE, AND ONE PROP DECIDES ──────
 *   "unread-taxonomy"  the payload HAS financial facts, in a namespace this
 *                      page does not read yet. A gap in the SITE. Named, so a
 *                      reader can see it is a coverage limit and not a verdict
 *                      on the company.
 *   "none"             no financial namespace at all -- a dei-only payload.
 *                      THE ONLY case that may be worded as a fact about the
 *                      filer, and it is the wording the original card used for
 *                      everyone.
 *
 * `unreadableReason()` in secExtract decides from the stored taxonomy census
 * rather than from a list of filers anyone maintains. A set stored before that
 * census existed has no `tx`, which reads as UNKNOWN -- and unknown takes the
 * site-limit wording, because claiming a company files nothing on the strength
 * of a field that is absent is the same error in a new place.
 */
/**
 * READ IN, WITH DATA, AND NO QUARTERS — the second permanent-pending case.
 *
 * `buildSecEarningsView` returns null when the stored set has no quarterly
 * periods, and the page's fallback for a null view was SecPendingCard. So a
 * filer whose set is populated and passes every usability bar still got
 * "financials are being fetched — check back shortly", forever, because the
 * cron would re-read it daily and find the same absence of quarters.
 *
 * It is the same defect the no-xbrl card was created to fix, in the branch
 * nobody looked at: the review found the score card's version of it on RYAAY
 * and this one sits one condition further along. KGC is the measured example —
 * 5 years and 8 instants stored, 24 populated fields in its best period, zero
 * quarters — and it is a whole class, not one filer: an annual-only foreign
 * private issuer files 20-F and nothing quarterly.
 */
export function SecNoQuartersCard({
  symbol,
  years,
  instants,
}: {
  symbol: string;
  years: number;
  instants: number;
}) {
  return (
    <section className="card">
      <div className="eyebrow">Annual filer</div>
      <h2>{symbol} does not file quarterly results</h2>
      <p>
        This page is built around the most recent reported <strong>quarter</strong>, and{" "}
        {symbol} files annually — {years === 1 ? "one annual period" : `${years} annual periods`}
        {instants ? ` and ${instants} balance-sheet dates` : ""} are on file, with no quarterly
        period among them. Its figures have been read from {SEC_ATTRIBUTION}; there is simply no
        quarter to show.
      </p>
      <p style={{ marginBottom: 0 }}>
        Its annual filings are available on{" "}
        <a href="https://www.sec.gov/edgar/search/" style={{ color: "#93c5fd", fontWeight: 800 }}>
          SEC EDGAR
        </a>
        .
      </p>
    </section>
  );
}

/**
 * THIS TICKER IS NOT THE SECURITY THE FILINGS DESCRIBE.
 *
 * NOT a 404 and not "pending". MER-PK genuinely trades, so a 404 is its own
 * wrong answer, and nothing is going to arrive later, so the pending card --
 * which is where this case landed before this component existed -- promises
 * data that will never come.
 *
 * WHAT THE READER NEEDS IS THE SIBLING. Someone on /stock/MER-PK/earnings
 * wants Bank of America's numbers; they just asked with the wrong ticker. The
 * card says so and links there, rather than stopping at a refusal.
 */
/**
 * A TICKER THE SEC REGISTRANT DIRECTORY DOES NOT LIST.
 *
 * ── WHY THIS IS NOT "PENDING" AND SHOULD NOT HAVE BEEN A 404 ─────────────
 * /stock/MSTY/earnings returned a bare 404 while /stock/MSTY rendered fine.
 * The route called notFound() on cold.status === "no-cik", which is set when
 * cikForSymbol finds no row for the ticker in the committed registrant file.
 *
 * TWO DIFFERENT THINGS LAND HERE, and the copy must not guess between them.
 * Measured through the SHIPPED gate (cikForSymbol -> lookupBySpelling) over
 * the committed file:
 *
 *   MSTY, TSLY, NVDY, CONY, JEPI   funds. A fund that trades as a series of a
 *                                  trust files under the trust, so the ticker
 *                                  is never a registrant. Structural: no later
 *                                  read changes it. SPY and QQQ ARE listed —
 *                                  they are their own registrants — so "ETF"
 *                                  is not the predictor.
 *   BK, EA, EQR, WBS               operating companies that SHOULD resolve and
 *                                  do not. The committed snapshot is missing
 *                                  them; refreshing it is the fix, and it is a
 *                                  separate change.
 *
 * SO THE CARD NAMES BOTH AND CLAIMS NEITHER. An earlier draft said "the usual
 * reason is that the ticker is a fund or ETF share class", which is true of
 * MSTY and false of BK — and a page that tells a Bank of New York Mellon
 * visitor it is probably a fund is worse than the 404 it replaced.
 *
 * BRK.B IS NOT IN THIS SET, though a naive lookup says it is: the file spells
 * it BRK-B and lookupBySpelling bridges that. Checking membership directly
 * instead of through the shipped gate is what made it look broken.
 */
export function SecNoRegistrantCard({ symbol }: { symbol: string }) {
  return (
    <section className="card">
      <div className="eyebrow">Earnings</div>
      <h2>No SEC company filings on file for {symbol}</h2>
      <p>
        {symbol} does not appear in the SEC company-ticker directory this page reads, so there
        are no filings for it to show.
      </p>
      <p>There are two reasons a ticker is missing from it, and this page cannot tell which applies:</p>
      {/* ── ONE ELEMENT PER BULLET, NOT LOOSE TEXT AROUND A <strong> ─────────
          `.bulletList li` is a two-column grid — `12px minmax(0, 1fr)` — with
          `::before` as the dot in column one and the content in column two.
          That works for the plain-text bullets elsewhere on this page because
          a single text run is ONE anonymous grid item.

          A bullet with a <strong> in the middle is not one item: the <strong>
          is a grid item of its own, and each text run around it becomes an
          anonymous one. They then flow across the two tracks, so every other
          fragment lands in the 12px column and wraps a word per line — which
          is what "fund / or / ETF / share / class" stacked vertically was.

          Wrapping each bullet in a single span restores the two-item shape the
          CSS is written for. Deliberately NOT a change to `.bulletList`: that
          rule is shared with bullets that render correctly today, and widening
          it to fix this card would put every one of them at risk. */}
      <ul className="bulletList">
        <li>
          <span>
            It is a <strong>fund or ETF share class</strong>. A fund that trades as a series of a
            trust files under the trust&apos;s name rather than the ticker&apos;s, so the ticker
            never appears as a registrant and no filings will arrive later. Funds that are their
            own registrants do appear, and their pages work normally.
          </span>
        </li>
        <li>
          <span>
            It is a company the <strong>directory snapshot has not picked up</strong>. In that
            case the filings exist and this page will show them once the directory is refreshed.
          </span>
        </li>
      </ul>
      <p>
        Either way, price history and market data for {symbol} are on{" "}
        <a href={`/stock/${symbol}`}>its stock page</a>.
      </p>
    </section>
  );
}

export function SecNotIssuerEquityCard({
  symbol,
  reason,
  siblings,
}: {
  symbol: string;
  reason: "derivative-of-issuer" | "unverifiable";
  siblings: string[];
}) {
  // The likeliest parent is the shortest sibling with no class/series suffix:
  // BAC among BAC-PB, BML-PG, MER-PK. A heuristic for a LINK, never for the
  // refusal itself -- getting it wrong costs a pointer, not a wrong figure,
  // which is why it is allowed to be a heuristic at all.
  const parent = siblings
    .filter((s) => !/[-.]/.test(s))
    .sort((a, b) => a.length - b.length)[0];

  return (
    <section className="card">
      <div className="eyebrow">Not this security</div>
      <h2>{symbol} does not file its own financial statements</h2>
      {reason === "derivative-of-issuer" ? (
        <p>
          {symbol} is debt, preferred stock or a warrant. It is registered with {SEC_ATTRIBUTION}{" "}
          under the same filer as {parent ? <strong>{parent}</strong> : "another company"}, and the
          financial statements filed there describe that company — its revenue, its earnings, its
          cash flow — not this security. They are not shown here, because showing them under this
          ticker would read as {symbol}&apos;s own results.
        </p>
      ) : (
        <p>
          {symbol} shares a filer with other securities, and which security it is could not be
          established from the exchange listing. The statements on that filer describe the company,
          not necessarily this ticker, so they are not shown here rather than shown under a ticker
          they may not belong to.
        </p>
      )}
      {parent ? (
        <p style={{ marginBottom: 0 }}>
          For the company&apos;s own results, see{" "}
          <Link href={`/stock/${parent}/earnings`}>{parent}</Link>.
        </p>
      ) : null}
    </section>
  );
}

export function SecNoXbrlCard({
  symbol,
  reason,
  taxonomies = [],
}: {
  symbol: string;
  reason: "unread-taxonomy" | "currency" | "unread-detail" | "none" | "unknown";
  /** The namespaces on "unread-taxonomy"; the currency codes on "currency". */
  taxonomies?: string[];
}) {
  const named = taxonomies.length ? taxonomies.join(", ") : "a taxonomy";
  // ── THE CURRENCY CASE, AND IT IS THE COMMON ONE ────────────────────────────
  // Measured after the ifrs-full chains landed: the filers that still do not
  // render are not a tagging gap, they are AEG in EUR, NWG in GBP, MFC in CAD,
  // RYAAY in EUR, VIV in BRL. rowsForField refuses a non-USD figure on purpose
  // -- a euro number under a dollar sign is the plausible wrong number this
  // whole pipeline is built against -- so the honest card names the currency
  // rather than implying the filing is unreadable.
  if (reason === "currency") {
    return (
      <section className="card">
        <div className="eyebrow">Not supported yet</div>
        <h2>
          {symbol} reports in {named}
        </h2>
        <p>
          {symbol} files complete financial statements with {SEC_ATTRIBUTION}, denominated
          in {named}. This page reads US-dollar figures only, and shows nothing rather than
          printing a {named} figure with a dollar sign on it.
        </p>
        <p style={{ marginBottom: 0 }}>
          Its filings are available now on{" "}
          <a href="https://www.sec.gov/edgar/search/" style={{ color: "#93c5fd", fontWeight: 800 }}>
            SEC EDGAR
          </a>
          .
        </p>
      </section>
    );
  }
  if (reason === "none") {
    return (
      <section className="card">
        <div className="eyebrow">Not available for this company</div>
        <h2>{symbol} has not filed XBRL financial statements</h2>
        <p>
          This page reads structured XBRL financial statements from {SEC_ATTRIBUTION}.{" "}
          {symbol}&apos;s filings carry cover-page data only — no tagged income statement,
          cash-flow statement or balance sheet — most often because it has not filed a full
          financial year yet.
        </p>
        <p style={{ marginBottom: 0 }}>
          Its filings are still public on{" "}
          <a href="https://www.sec.gov/edgar/search/" style={{ color: "#93c5fd", fontWeight: 800 }}>
            SEC EDGAR
          </a>
          .
        </p>
      </section>
    );
  }
  return (
    <section className="card">
      <div className="eyebrow">Not supported yet</div>
      <h2>This page does not read {symbol}&apos;s filings yet</h2>
      <p>
        {symbol} files its financial statements with {SEC_ATTRIBUTION}
        {reason === "unread-taxonomy" ? (
          <>
            {" "}
            under the <strong>{named}</strong> taxonomy
          </>
        ) : null}
        , which this page does not read yet. The data exists — the gap is here, not in{" "}
        {symbol}&apos;s reporting.
      </p>
      <p style={{ marginBottom: 0 }}>
        Its filings are available now on{" "}
        <a href="https://www.sec.gov/edgar/search/" style={{ color: "#93c5fd", fontWeight: 800 }}>
          SEC EDGAR
        </a>
        .
      </p>
    </section>
  );
}


/**
 * THE RUN OF PERIODS, IN ONE CARD — what a typical one looks like.
 *
 * ── WHY THIS IS A MEDIAN AND SAYS SO ─────────────────────────────────────
 * trendSummary takes the median rather than the mean, and excludes every
 * period whose comparison crosses between profit and loss. Both choices change
 * the number, so the card states them: a reader who assumes "average" and
 * recomputes from the table will get a different figure, and the honest
 * response to that is to say which statistic this is rather than to hope
 * nobody checks.
 *
 * THE COUNTS ARE PART OF THE FIGURE, not a footnote. "Typical quarter: +8%"
 * over eight rows means something different from the same figure over three,
 * and the card shows the denominator either way.
 */
const fmtTrend = (kind: "rate" | "level", v: number) =>
  `${kind === "rate" && v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

export function SecTrendSummaryCard({ view }: { view: SecEarningsView }) {
  const t = trendSummary(view);
  const w = periodWords(t.basis);
  // NOTHING TO SUMMARISE IS NOT AN EMPTY CARD. A filer with too few comparable
  // periods gets no card at all rather than a grid of "Not measured", which
  // would read as a fault in the page.
  if (!t.lines.some((l) => l.value !== null)) return null;
  return (
    <section className="card">
      <div className="eyebrow">Trend</div>
      <h3>What does a typical {w.one} look like?</h3>
      <p>Middle value across the {w.many} on file.</p>
      <div className="trendGrid">
        {t.lines.map((l) => {
          // THE KIND, NOT THE LABEL'S SPELLING. trendSummary says which lines
          // are rates and which are levels; a /margin/i over the wording was a
          // second copy of that rule, one rename away from disagreeing.
          const word = l.kind === "level" ? marginToneWord(l.tone) : growthToneWord(l.tone);
          return (
            <div className="trendCell" key={l.label}>
              <span className="metricLabel">{l.label}</span>
              {/* TYPICAL · LATEST, when both are figures. The median alone can
                  sit a long way from now (AVAV: +133.3% typical, +5.7% latest),
                  so the newest period is printed beside it in smaller type, by
                  the same colour rule. NO SIGN ON A LEVEL: 32% is not "+32%". */}
              <span className="metricValue" style={{ color: toneColor(l.tone) }}>
                {l.value === null ? "—" : (
                  <>
                    <span className="trendTag">Typical </span>
                    {fmtTrend(l.kind, l.value)}
                  </>
                )}
              </span>
              {l.value !== null && l.latest !== null ? (
                <span className="trendLatest" style={{ color: toneColor(l.latestTone) }}>
                  <span className="trendTag">Latest </span>{fmtTrend(l.kind, l.latest)}
                </span>
              ) : null}
              <div className="trendChipRow">
                {/* A LEVEL GETS NO VERDICT CHIP. trendSummary leaves the
                    operating-margin line untoned on purpose: whether 6% is good
                    depends on the industry and this page has no comparison. */}
                {l.tone === null && l.value !== null ? null : <ToneChip tone={l.tone} word={word} />}
                <span className="trendCount">
                  {l.value === null
                    ? `needs ${TREND_MIN_PERIODS}, has ${l.counted}`
                    : `${l.counted} of ${l.counted + l.skipped} ${l.counted + l.skipped === 1 ? w.one : w.many}`}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {/* NO EXCLUSION PARAGRAPH AND NO SECOND COPY OF THE BANDS. Each line's
          "N of M" already says how many periods it counted, the thresholds
          are in the growth chart's footnote, and the crossing sentence is
          printed once per page. */}
      {t.skewNote ? <p className="earningsDataNote">{t.skewNote}</p> : null}
      <p className="earningsDataNote">Source: {SEC_ATTRIBUTION}.</p>
    </section>
  );
}

/**
 * MARKET CAP AND P/E, BUILT FROM THE FILINGS AND ONE PRICE.
 *
 * ── EVERY ABSENCE HERE IS NAMED ──────────────────────────────────────────
 * "P/E: —" invites the reader to conclude the company has no earnings, which
 * is a claim about the company. The true claim is almost always about the
 * filing — a share count the filer publishes per class without saying which,
 * or a year that is not yet four quarters. secValuation returns WHY, and this
 * card prints it.
 *
 * THE TWO AS-OF DATES ARE BOTH SHOWN, because they differ and the difference
 * matters: the share count is as of the cover page, weeks after the period
 * end, and the price is today's close.
 */
export function SecValuationCard({
  view, inputs, price, priceAsOf, today,
}: {
  view: SecEarningsView;
  inputs: ValuationInputs;
  price: number | null;
  priceAsOf: string | null;
  /** The render date, passed in rather than read from the clock — see priceIsCurrent. */
  today: string;
}) {
  // ── A STALE CLOSE IS NOT A PRICE ─────────────────────────────────────────
  // Every other figure on this page is a filed fact frozen at its period end.
  // These two are assertions about today's market, so an old close does not
  // make them slightly out of date, it makes them wrong — and nothing on
  // screen would say so. Past the bound the card shows the close it has and
  // declines to value the company with it.
  const current = priceIsCurrent(priceAsOf, today);
  const usable = current ? price : null;
  const cap = marketCap(inputs, usable);
  const pe = peRatio(inputs, usable);
  // NO PRICE IS NOT A FILING REFUSAL. Both figures need one, and saying the
  // cover page is at fault for a bars outage would misname the gap.
  if (price === null) return null;
  // ── TWO STAT TILES, THE SNAPSHOT'S STYLE ─────────────────────────────────
  // The value is a figure or a SHORT state; the caption carries the inputs or
  // the reason. The long refusal sentences used to sit in the value slot at
  // 14px, and the price, the GAAP note and the source ran on underneath as one
  // paragraph — the layout the owner flagged as broken on AVAV.
  const sentence = (t: string) => `${t[0].toUpperCase()}${t.slice(1)}.`;
  const capValue = !current ? STALE_PRICE_WORDS : cap === null ? NOT_REPORTED : cap.ok ? shortMoney(cap.val) : "Not available";
  const capSub = !current
    ? stalePriceNote(price, priceAsOf ?? "an unknown date")
    : cap !== null && !cap.ok
      ? sentence(REFUSAL_WORDS[cap.why])
      : inputs.shares
        ? `${scaledAmount(inputs.shares.val, false)} shares × $${price.toFixed(2)} close${priceAsOf ? `, ${priceAsOf}` : ""}`
        : null;
  const peValue = !current ? STALE_PRICE_WORDS
    : pe === null ? NOT_REPORTED
      : pe.ok ? pe.val.toFixed(1)
        : pe.why === "eps-is-zero-or-negative" ? "Not meaningful" : "Not available";
  const epsSpan = inputs.eps?.basis === "four-quarters"
    ? "the last four quarters"
    : `the latest fiscal year, to ${inputs.eps?.periodEnd}`;
  const peSub = !current ? null
    : pe !== null && !pe.ok
      ? pe.why === "eps-is-zero-or-negative"
        ? `${inputs.eps && inputs.eps.val < 0 ? "Loss" : "No earnings"} over ${epsSpan}`
        : sentence(REFUSAL_WORDS[pe.why])
      : inputs.eps
        ? `$${price.toFixed(2)} ÷ $${inputs.eps.val.toFixed(2)} diluted EPS over ${epsSpan}`
        : null;
  return (
    <section className="card">
      <div className="eyebrow">Valuation</div>
      <h3>What the market is paying for these earnings</h3>
      <div className="metricGrid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <Metric label="Market cap" sub={capSub}>{capValue}</Metric>
        <Metric label={`P/E (${epsStandardWord(view.accounting)}, trailing)`} sub={peSub}>{peValue}</Metric>
      </div>
      {view.currency ? (
        <p className="earningsDataNote">
          Earnings are converted from {view.currency.reporting}; the share price is already in US
          dollars, so both sides of these figures are dollars.
        </p>
      ) : null}
      <p className="earningsDataNote">Source: {SEC_ATTRIBUTION}; share price from market data.</p>
    </section>
  );
}

/**
 * THE SCORE CARD, moved out of page.tsx so the render harness can draw it
 * beside the cards it sits above. The watermark is a client component, so the
 * page passes it in as a slot rather than this file importing it.
 */
export function SecScoreCard({
  symbol, score, coverage, watermark = null,
}: {
  symbol: string;
  score: SecEarningsScore;
  coverage: ScoreCoverage | null;
  watermark?: React.ReactNode;
}) {
  return (
    <aside className="scoreCard">
      {/* ── HOW MUCH OF THIS SCORE WAS ACTUALLY MEASURED ──────────────
          ABVX rendered 48/100 MIXED laid out exactly like AAPL's while
          three of five components never ran. Those three carry 52 of
          the 58 points the score can move by, so it could only land
          between 34 and 66 — inside the MIXED band either way. It
          could not have read Weak or Good for any company. The
          arithmetic is right and unchanged; what was missing is that
          the reader was never told the range had collapsed. */}
      <div className="scoreTop">
        <div className="smallLabel">Earnings score</div>
        <div className={coverage?.partial ? "scorePill scorePillPartial" : "scorePill"}>
          {coverage?.partial ? partialScoreLabel(coverage) : score.label}
        </div>
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
            {/* A PARTIAL SCORE LOSES ITS VERDICT COLOUR. The hue is
                the fastest-read part of this card and it asserts a
                reading; on a score the missing inputs decided, the
                number is ink, not a verdict. */}
            <div className={coverage?.partial ? "scoreNumber scoreNumberPartial" : "scoreNumber"}>
              {score.score}/100
            </div>
            {watermark}
          </div>
          <div className="scoreBar" aria-hidden="true">
            {/* THE REACHABLE RANGE, DRAWN — ONLY WHEN IT IS A RANGE. A
                shaded span across the whole bar (AVAV: 0 to 100) says
                nothing and looks like a highlight, so it is drawn only
                when it is narrower than the scale. */}
            {coverage && coverageIsInformative(coverage) ? (
              <div
                className="scoreReach"
                style={{ left: `${coverage.low}%`, width: `${Math.max(coverage.high - coverage.low, 1)}%` }}
              />
            ) : null}
            <div className="scoreNeedle" />
          </div>
          {/* THE AXIS IS LABELLED FROM THE BAND TABLE, and the thresholds
              sit behind the info mark beside it rather than in a paragraph
              under it. A tooltip that only hovers is invisible on a phone, so
              the mark is focusable and the text shows on focus as well —
              tapping it is enough. */}
          <div className="scoreLabels">
            {/* SCORE_BANDS is ordered high-to-low (the lookup wants that);
                the axis reads low-to-high left to right. */}
            {[...SCORE_BANDS].reverse().map((b, i, all) => (
              <span key={b.tone}>
                {b.label}
                {i === all.length - 1 ? <InfoTip text={scoreBandNote()} /> : null}
              </span>
            ))}
          </div>
          {coverage?.partial ? (
            <p className="earningsDataNote scoreReachNote" style={{ marginTop: 8 }}>
              {partialScoreNote(coverage, score.unavailableWhy, coverage.pinned ? toneLabel("neutral") : null)}
            </p>
          ) : null}
        </>
      ) : null}
      <p style={{ marginTop: 14 }}>{score.explanation}</p>
      {/* WHICH KIND OF PERIOD THE SCORE READ — point 5 of the scope.
          Every term of this score is measured over the anchor period,
          and a reader comparing an annual filer's score with a 10-Q
          filer's has to be told they are not the same measurement. */}
      {score.available && score.basis === "year" ? (
        <p className="earningsDataNote" style={{ marginTop: 10 }}>
          <strong>{symbol} files annually</strong>, so this score is built on its fiscal
          years — growth is year against prior year, and there are no quarterly figures
          behind it.
        </p>
      ) : null}
    </aside>
  );
}

/**
 * AN "i" THAT EXPLAINS ITSELF ON HOVER *AND* ON TAP.
 *
 * A bare `title=` is hover-only, and this page has already paid for that
 * lesson once (the gap badge). The mark is focusable, so a tap focuses it, and
 * the page's CSS shows the text on :hover and :focus alike. The text is also
 * the accessible name, so a screen reader gets it without either.
 */
export function InfoTip({ text }: { text: string }) {
  return (
    <span className="infoTip" tabIndex={0} role="note" aria-label={text}>
      <span aria-hidden="true">i</span>
      <span className="infoTipText" aria-hidden="true">{text}</span>
    </span>
  );
}
