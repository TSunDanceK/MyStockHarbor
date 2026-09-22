// The earnings page's SEC-backed cards, plus the one that renders a hidden one.
//
// Presentational and server-rendered: every decision about which number is
// which, and what is derived, is made in lib/server/secEarningsView.ts and
// asserted by scripts/check-sec-earnings-page.mjs. This file only draws.
import Link from "next/link";
import {
  CROSSING_NOTE, CROSSING_WORDS, SEC_ATTRIBUTION, conversionNote, epsBasisNote, epsStandardWord,
  isCrossing, periodWords, retiredSource,
  type Pct, type SecEarningsView, type ViewCell,
} from "@/lib/server/secEarningsView";
import {
  STALE_PRICE_WORDS, barValue, growthToneWord, marginToneWord, priceIsCurrent,
  stalePriceNote, toneBandNote, toneBg, toneColor,
  toneForGrowth, toneForMarginDelta, trendSummary, waterfallGate,
  TREND_MIN_PERIODS,
  type EarningsTone,
} from "@/lib/server/secPresentation";
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
 * ".00" on the end, and the compact forms (B/M) have their own precision.
 */
function money(v: number | null | undefined, compact = false, perShare = false): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (compact && abs >= 1e9) return `${v < 0 ? "-" : ""}$${(abs / 1e9).toFixed(2)}B`;
  if (compact && abs >= 1e6) return `${v < 0 ? "-" : ""}$${(abs / 1e6).toFixed(1)}M`;
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
const Q4_EPS_NOTE =
  "Q4 EPS is not filed as a separate period, and this page does not derive it, " +
  `so those cells read \u201c${NOT_REPORTED}\u201d.`;

/** The legend for the crossing wording, rendered wherever a table produces one. */
function CrossingNote({ rows }: { rows: { revenueYoY: Pct; epsYoY: Pct }[] }) {
  // ONLY WHEN THE TABLE ACTUALLY HAS ONE. A standing legend for wording that
  // never appears is noise on every other page; AAPL crosses zero in neither
  // table and should not carry the sentence.
  const present = rows.some((r) => isCrossing(r.revenueYoY) || isCrossing(r.epsYoY));
  if (!present) return null;
  return <p className="earningsDataNote">{CROSSING_NOTE}</p>;
}

/**
 * A LEVEL, unsigned. Margins are a share of revenue, not a change in one, and
 * rendering a 82.9% gross margin as "+82.9%" reads as growth of 82.9%.
 */
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
export function CellValue({ cell, compact = false, currency = true }: { cell: ViewCell; compact?: boolean; currency?: boolean }) {
  // NOT A DASH. A null here means the filer published no figure for this line,
  // and that is a fact about the filing worth stating. A filed ZERO still
  // renders as $0 — money() is only reached when there is a value.
  if (cell.val == null) {
    return <span style={{ color: "#94a3b8", fontWeight: 600 }}>{NOT_REPORTED}</span>;
  }
  return (
    <>
      {/* PER-SHARE PRECISION TRAVELS WITH THE CELL, not with the call site —
          EPS renders in four places and one of them is a loop over field keys
          that no one writes out by hand. See ViewCell.perShare. */}
      {currency
        ? money(cell.val, compact && !cell.perShare, cell.perShare)
        : cell.val.toLocaleString("en-US")}
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

function Metric({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="metricCard">
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
      {pending ? (
        <p className="earningsDataNote" style={{ marginTop: -4 }}>
          Results for the quarter ended <strong>{pending.periodEnd}</strong> were announced on{" "}
          <strong>{pending.announcedOn}</strong>. The SEC has not yet published the figures in its
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
      <div className="metricGrid">
        <Metric label="Revenue"><CellValue cell={s.revenue} compact /></Metric>
        {/* NO COMPARATOR MEANS NO FIGURE, AND THE CARD SAYS WHY. It used to
            take the fourth row back whatever that was, which on a half-yearly
            filer was a four-year-old quarter labelled "year over year". */}
        <Metric
          label="YoY revenue growth"
          sub={s.comparedWith ? `Compared with ${s.comparedWith}` : `Prior-year ${w.one} not on file`}
        >
          {pct(s.revenueYoY)}
        </Metric>
        <Metric label={`Diluted EPS (${epsStandardWord(view.accounting)})`}><CellValue cell={s.epsDiluted} /></Metric>
        <Metric
          label="YoY EPS growth"
          sub={s.comparedWith ? `Compared with ${s.comparedWith}` : `Prior-year ${w.one} not on file`}
        >
          {pct(s.epsYoY)}
        </Metric>
        <Metric label="Operating income"><CellValue cell={s.operatingIncome} compact /></Metric>
        <Metric label="Net income"><CellValue cell={s.netIncome} compact /></Metric>
      </div>
      <p className="earningsDataNote">{epsBasisNote(view.accounting)} Source: {SEC_ATTRIBUTION}.</p>
      {/* ON THE SNAPSHOT, WHICH IS THE CARD EVERY READER SEES. A conversion
          note further down the page is a note most readers never reach, and
          the figures it explains are the ones at the top. */}
      {view.currency ? <p className="earningsDataNote">{conversionNote(view.currency)}</p> : null}
      {/* PERIOD LABELS ARE THE FILER'S OWN FISCAL PERIOD, NOT THE CALENDAR. The
          probe set's year-ends are 31 Mar, 26 Sep, 3 Sep, 31 Oct and 31 Dec, so
          two companies' "2026" can be nine months apart. */}
      <p className="earningsDataNote">{w.labelled}</p>
      {/* THE SNAPSHOT TILES CARRY THE MARKER TOO, so they carry its legend. A
          tile reading "n/m" with the explanation only in a table further down
          is the same hover-only failure as the gap badge. */}
      <CrossingNote rows={[{ revenueYoY: s.revenueYoY, epsYoY: s.epsYoY }]} />
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
      <p className="earningsDataNote">
        {toneBandNote(crossings)}
        {crossings > 0
          ? ` ${crossings} ${crossings === 1 ? `${w.one} has` : `${w.many} have`} no bar for that reason.`
          : ""}
        {absent > 0
          ? ` ${absent} ${absent === 1 ? `${w.one} has` : `${w.many} have`} no bar because the period it would be compared with is not on file.`
          : ""}
      </p>
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
  const w = periodWords(view.tableBasis);
  const latest = view.margins[view.margins.length - 1];
  const base = view.growth[view.growth.length - 1]?.comparedWith ?? null;
  if (!latest || base === null) return null;
  const prior = view.margins.find((m) => m.label === base);
  if (!prior || latest.operating === null || prior.operating === null) return null;
  const pp = latest.operating - prior.operating;
  const tone = toneForMarginDelta(pp);
  return (
    <p className="earningsDataNote">
      Operating margin, <strong>{latest.label}</strong> against <strong>{base}</strong>:{" "}
      <strong>{`${pp >= 0 ? "+" : ""}${pp.toFixed(1)}pp`}</strong>{" "}
      ({latest.operating.toFixed(1)}% from {prior.operating.toFixed(1)}%).{" "}
      <ToneChip tone={tone} word={marginToneWord(tone)} />{" "}
      A move of half a percentage point or more is counted; anything smaller is
      called flat, because a margin that size moves on rounding alone from one{" "}
      {w.one} to the next.
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
        The periods this company has filed, newest last. Year-over-year growth compares each period
        with the <strong>same fiscal {w.one} one year earlier</strong>, named in the row; where that
        period is not on file the figure is blank rather than measured against something else.
        Margins are gross profit, operating income and net income as a share of that period&apos;s
        revenue. A row marked <strong>gap</strong> has no filing on file for the period immediately
        before it — these are the periods the company published, not a consecutive run of {w.many}.
        {/* VISIBLE, not hover-only — the same lesson as the gap badge. */}{" "}
        <strong>{Q4_EPS_NOTE}</strong>
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
                <td data-label="Revenue YoY">{pct(view.growth[i]?.revenueYoY)}</td>
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
                    pct(view.growth[i]?.epsYoY)
                  )}
                </td>
                <td data-label="Gross margin">{pctLevel(m.gross)}</td>
                <td data-label="Operating margin">{pctLevel(m.operating)}</td>
                <td data-label="Net margin">{pctLevel(m.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CrossingNote rows={view.growth} />
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
        Each fiscal year as filed, oldest first, with the year it is measured against named in the
        row. Year-over-year compares a fiscal year with the one before it; where that year is not on
        file the figure is blank rather than measured against something else. Margins are gross
        profit, operating income and net income as a share of that year&apos;s revenue.
        {sole ? (
          <>
            {" "}
            <strong>{view.symbol} files annually</strong>, so these are the only periods it
            publishes — there is no quarterly table below.
          </>
        ) : null}
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="historyTable">
          <thead>
            <tr>
              <th>Fiscal year</th><th>Compared with</th><th>Revenue</th><th>Revenue YoY</th>
              <th>Diluted EPS</th><th>EPS YoY</th>
              <th>Gross margin</th><th>Operating margin</th><th>Net margin</th>
            </tr>
          </thead>
          <tbody>
            {view.annual.map((r) => (
              <tr key={r.label}>
                <td data-label="Fiscal year">
                  {r.label}
                  {/* EVERY FIGURE NAMES ITS PERIOD END, not just its label —
                      two filers' "FY2025" can be nine months apart. */}
                  <span style={{ display: "block", fontSize: 11, color: "#94a3b8" }}>
                    ended {r.end}
                  </span>
                </td>
                <td data-label="Compared with">{r.comparedWith ?? "not on file"}</td>
                <td data-label="Revenue"><CellValue cell={r.revenue} compact /></td>
                <td data-label="Revenue YoY">{pct(r.revenueYoY)}</td>
                <td data-label="Diluted EPS"><CellValue cell={r.epsDiluted} /></td>
                <td data-label="EPS YoY">{pct(r.epsYoY)}</td>
                <td data-label="Gross margin">{pctLevel(r.gross)}</td>
                <td data-label="Operating margin">{pctLevel(r.operating)}</td>
                <td data-label="Net margin">{pctLevel(r.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CrossingNote rows={view.annual} />
      <p className="earningsDataNote">{epsBasisNote(view.accounting)} Source: {SEC_ATTRIBUTION}.</p>
    </section>
  );
}


/** Money, short. The cards elsewhere use the same shape via CellValue. */
const shortMoney = (n: number) => {
  const abs = Math.abs(n);
  const unit = abs >= 1e12 ? ["T", 1e12] : abs >= 1e9 ? ["B", 1e9] : abs >= 1e6 ? ["M", 1e6] : ["K", 1e3];
  return `${n < 0 ? "-" : ""}$${(abs / (unit[1] as number)).toFixed(abs / (unit[1] as number) >= 100 ? 0 : 1)}${unit[0]}`;
};

/**
 * The three cash figures as magnitudes against one scale.
 *
 * CAPEX IS FILED NEGATIVE AND IS SHOWN AS SPENDING, not as a negative bar
 * pointing the other way: on this card it is a quantity of cash leaving, and
 * its tone is red because that is what it is, not because the sign is minus.
 * Free cash flow keeps its sign, because a negative one is the finding.
 */
function CashQualityBars({ view }: { view: SecEarningsView }) {
  const c = view.cashQuality;
  const num = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const ocf = num(c.operatingCashFlow.val);
  const capex = num(c.capex.val);
  // A PLAIN NUMBER ON THIS ONE, not a ViewCell: free cash flow is derived here
  // rather than filed, so it has no cell of its own. See the view's shape.
  const fcf = num(c.freeCashFlow);
  if (ocf === null && capex === null && fcf === null) return null;
  return (
    <HBarList
      rows={[
        { label: "Operating cash flow", value: ocf, tone: ocf !== null && ocf >= 0 ? "good" : "weak",
          text: ocf === null ? NOT_REPORTED : shortMoney(ocf) },
        { label: c.capex.label, value: capex, tone: "weak",
          text: capex === null ? NOT_REPORTED : shortMoney(Math.abs(capex)),
          sub: capex === null ? undefined : "cash spent on productive assets" },
        { label: "Free cash flow", value: fcf, tone: fcf === null ? null : fcf >= 0 ? "good" : "weak",
          text: fcf === null ? NOT_REPORTED : shortMoney(fcf) },
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
  if (cash === null && debt === null && net === null) return null;
  return (
    <HBarList
      rows={[
        { label: "Cash & equivalents", value: cash, tone: "neutral",
          text: cash === null ? NOT_REPORTED : shortMoney(cash) },
        { label: "Total debt", value: debt, tone: "neutral",
          text: debt === null ? NOT_REPORTED : shortMoney(debt) },
        { label: "Net cash", value: net, tone: net === null ? null : net >= 0 ? "good" : "weak",
          text: net === null ? NOT_REPORTED : shortMoney(net),
          sub: net === null ? undefined : net >= 0 ? "more cash than debt" : "more debt than cash" },
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
      {/* ── THE MAGNITUDES, BEFORE THE ROWS THAT SPELL THEM OUT ─────────────
          The question this card asks — is the profit turning into cash — is a
          COMPARISON of three magnitudes, and three numbers in a column is the
          one shape that makes a comparison hard. The bars are scaled against
          the largest of them, so operating cash flow against capex is a length
          a reader can see rather than two figures they have to divide.
          The rows below still carry every figure as text; the bars are a
          second encoding, which is what makes them safe to ignore. */}
      <CashQualityBars view={view} />
      <div style={{ marginTop: 12 }}>
        <Row label="Operating cash flow"><CellValue cell={c.operatingCashFlow} compact /></Row>
        {/* THE LABEL COMES FROM THE CELL, not from this line. capex resolves
            from one concept per filer and the broader productive-assets one is
            a different measure, so the heading has to say which it is — see
            secEarningsView's capexConcept. Hardcoding "Capital expenditure"
            here put one heading over both and was a false equivalence on every
            filer that publishes only the broader concept. */}
        <Row label={c.capex.label}><CellValue cell={c.capex} compact /></Row>
        <Row label="Free cash flow" strong>
          <DerivedValue value={c.freeCashFlow} missing={c.freeCashFlowMissing} />
          {c.freeCashFlowDerived ? (
            <abbr
              title={`Derived: operating cash flow minus capital expenditure, both of which the filer reports year-to-date, so this ${w.one} is the difference between two cumulative figures.`}
              style={{ marginLeft: 5, fontSize: 11, fontWeight: 800, color: "#94a3b8", textDecoration: "none", cursor: "help" }}
            >derived</abbr>
          ) : null}
        </Row>
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
          three times too large and looks entirely plausible. */}
      <p className="earningsDataNote">
        {c.basis === "year" ? (
          <>
            Annual cash-flow figures as filed, for {c.period}. {NOT_REPORTED_NOTE} Source:{" "}
            {SEC_ATTRIBUTION}.
          </>
        ) : (
          <>
            Cash-flow figures are filed year-to-date, so every {w.one} except the first is the
            difference between two cumulative figures — those are marked <em>derived</em>.{" "}
            {NOT_REPORTED_NOTE} Source: {SEC_ATTRIBUTION}.
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
      {/* WHAT IT HOLDS AGAINST WHAT IT OWES, as lengths. The rows below carry
          every figure; these make the one comparison the card is named for
          visible without arithmetic. */}
      <BalanceSheetBars view={view} />
      <div style={{ marginTop: 12 }}>
        {/* THE LABEL FOLLOWS THE FIGURE. When the filer published only the
            restricted-inclusive total, this row IS that total, and calling it
            "Cash & equivalents" would overstate what the company can spend. */}
        <Row
          label={b.cashIncludesRestricted ? "Cash & equivalents (incl. restricted)" : "Cash & equivalents"}
          sub={b.cashIncludesRestricted
            ? "This filer reports cash only including restricted cash, which it cannot freely spend."
            : undefined}
        >
          <CellValue cell={b.cash} compact />
        </Row>
        <Row label="Short-term investments"><CellValue cell={b.shortTermInvestments} compact /></Row>
        <Row label="Total debt"><DerivedValue value={b.totalDebt} missing={b.totalDebtMissing} /></Row>
        <Row
          label="Net cash"
          strong
          sub={`Cash and short-term investments less total debt.${
            b.cashIncludesRestricted ? " The cash leg includes restricted cash — see above." : ""
          }`}
        >
          <DerivedValue value={b.netCash} missing={b.netCashMissing} />
        </Row>
        <Row label="Current ratio">
          {b.currentRatio !== null ? ratio(b.currentRatio) : (
            <span style={{ color: "#94a3b8", fontWeight: 600 }}>
              {b.currentRatioMissing ? cantCalculate(b.currentRatioMissing) : NOT_REPORTED}
            </span>
          )}
        </Row>
        <Row label="Total assets"><CellValue cell={b.totalAssets} compact /></Row>
        <Row label="Total liabilities"><CellValue cell={b.totalLiabilities} compact /></Row>
        <Row label="Shareholders&apos; equity" strong><CellValue cell={b.stockholdersEquity} compact /></Row>
      </div>
      <p className="earningsDataNote">
        Balance-sheet figures are a position at a date, not a period total, so none of them are
        derived. {NOT_REPORTED_NOTE} Source: {SEC_ATTRIBUTION}.
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
            <CellValue cell={c} compact currency={!c.label.includes("shares")} />
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
      <p className="earningsDataNote">{epsBasisNote(view.accounting)} Source: {SEC_ATTRIBUTION}.</p>
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
export function SecRecentPeriodsCard({ view }: { view: SecEarningsView }) {
  // tableBasis: this table IS the rows, so it follows what the rows are.
  if (view.tableBasis === "year") return null;
  const w = periodWords(view.tableBasis);
  return (
    <section className="card">
      <div className="eyebrow">Earnings history</div>
      <h2>Recent reported {w.many}</h2>
      <p>
        As filed with the SEC. Estimate and surprise columns are no longer shown —{" "}
        {retiredSource("quarter-estimate-columns").reason}
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="historyTable">
          <thead><tr><th>{w.One}</th><th>Period ending</th><th>Revenue</th><th>Diluted EPS ({epsStandardWord(view.accounting)})</th><th>Net income</th></tr></thead>
          <tbody>
            {view.recentPeriods.map((r) => (
              <tr key={r.end}>
                <td data-label={w.One}>{r.label}</td>
                <td data-label="Period ending">{r.end}</td>
                <td data-label="Revenue"><CellValue cell={r.revenue} compact /></td>
                <td data-label={`Diluted EPS (${epsStandardWord(view.accounting)})`}><CellValue cell={r.epsDiluted} /></td>
                <td data-label="Net income"><CellValue cell={r.netIncome} compact /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Q4 IS NEVER FILED AS A STANDALONE QUARTER, and a weighted-average share
          count is not additive, so EPS cannot be derived for it either. One row
          in four shows a dash where the filer published nothing. */}
      <p className="earningsDataNote">
        {Q4_EPS_NOTE} Source: {SEC_ATTRIBUTION}.
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
      <p>
        The middle value across the {w.many} on file — not an average, which one unusual{" "}
        {w.one} can dominate. Figures are the same ones in the table above.
      </p>
      <div className="trendGrid">
        {t.lines.map((l) => {
          // THE KIND, NOT THE LABEL'S SPELLING. trendSummary says which lines
          // are rates and which are levels; a /margin/i over the wording was a
          // second copy of that rule, one rename away from disagreeing.
          const word = l.kind === "level" ? marginToneWord(l.tone) : growthToneWord(l.tone);
          return (
            <div className="trendCell" key={l.label}>
              <span className="metricLabel">{l.label}</span>
              <span className="metricValue" style={{ color: toneColor(l.tone) }}>
                {/* NO SIGN ON A LEVEL. A margin of 32% is not "+32%". */}
                {l.value === null
                  ? "—"
                  : `${l.kind === "rate" && l.value >= 0 ? "+" : ""}${l.value.toFixed(1)}%`}
              </span>
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
      {t.exclusionNote ? <p className="earningsDataNote">{t.exclusionNote}</p> : null}
      <p className="earningsDataNote">{toneBandNote(t.crossings)} Source: {SEC_ATTRIBUTION}.</p>
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
  const figure = (f: ReturnType<typeof marketCap>, fmt: (n: number) => string) =>
    !current ? STALE_PRICE_WORDS : f === null ? NOT_REPORTED : f.ok ? fmt(f.val) : REFUSAL_WORDS[f.why];
  const isRefusal = (f: ReturnType<typeof marketCap>) => !current || (f !== null && !f.ok);
  return (
    <section className="card">
      <div className="eyebrow">Valuation</div>
      <h3>What the market is paying for these earnings</h3>
      <div className="metricGrid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <div>
          <span className="metricLabel">Market cap</span>
          <span className="metricValue" style={{ fontSize: isRefusal(cap) ? 14 : undefined }}>
            {figure(cap, shortMoney)}
          </span>
          {inputs.shares ? (
            <span className="metricSub">
              {(inputs.shares.val / 1e6).toFixed(1)}M shares, as stated on the cover page of the
              filing dated {inputs.shares.asOf}
            </span>
          ) : null}
        </div>
        <div>
          <span className="metricLabel">P/E ({epsStandardWord(view.accounting)}, trailing)</span>
          <span className="metricValue" style={{ fontSize: isRefusal(pe) ? 14 : undefined }}>
            {figure(pe, (n) => n.toFixed(1))}
          </span>
          {inputs.eps ? (
            <span className="metricSub">
              ${inputs.eps.val.toFixed(2)} diluted EPS over{" "}
              {inputs.eps.basis === "four-quarters"
                ? "the last four quarters"
                : "the latest full fiscal year"}
              , to {inputs.eps.periodEnd}
            </span>
          ) : null}
        </div>
      </div>
      <p className="earningsDataNote">
        {current
          ? `Price ${price.toFixed(2)}${priceAsOf ? ` at the close on ${priceAsOf}` : ""}.`
          : stalePriceNote(price, priceAsOf ?? "an unknown date")}{" "}
        Earnings are {view.accounting ? `${epsStandardWord(view.accounting)} as filed` : "as filed"}, never an adjusted figure. {epsBasisNote(view.accounting)} Source:{" "}
        {SEC_ATTRIBUTION}, with the share price from market data.
      </p>
      {view.currency ? (
        <p className="earningsDataNote">
          Earnings are converted from {view.currency.reporting}; the share price is already in US
          dollars, so both sides of these figures are dollars.
        </p>
      ) : null}
    </section>
  );
}
