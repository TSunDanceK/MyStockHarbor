"use client";

// THE "GROWTH & MARGINS" PICTURE (#563 COWORK #26/#27): three small charts on one
// time axis — sales, profit or loss, and gross margin as a % of sales —
// with a Quarters / Years toggle and one detail panel for the column under the
// pointer, finger or keyboard focus.
//
// PRESENTATION ONLY. Every figure arrives formatted from lib/growthVisuals.ts,
// which reads A's view; this file draws bars from those numbers and nothing else.
//
// ONE MEASURE PER CHART, SAME COLUMNS. The three grids share one column count
// and one order (oldest left), so a period sits in the same column in all three
// and a tap highlights it in all three at once.
//
// COLOUR IS NEVER ALONE (COWORK #26 rules). Profit and loss are also told apart
// by side of the zero line, a +/− sign and the words "profit"/"loss"; the ghost
// bar is named in the legend and the detail panel.
//
// SCALE WITHOUT A TAP (COWORK #36 ask 1): the newest sales bar and the newest
// gross-margin dot carry their values, and the margin chart has faint 0% / 50% /
// 100% guide lines, so the picture reads before anyone touches it.
//
// MARGINS IN %, STANDARD TERMS (owner ruling, #563 COWORK #55): "Gross margin",
// "Operating margin", "Net margin", never cents-per-dollar wording.
//
// ON A PHONE, THE MARGIN IS A LINE OVER THE SALES CHART (owner ruling, #563
// COWORK #58): at or below PHONE_MAX_PX the separate margin chart is hidden and
// the same purple dots, joined by a line, are drawn over the sales bars against
// a % scale on the sales chart's right-hand side. A period with no margin breaks
// the line; its panel says why. Desktop keeps the three charts as they were,
// and the profit-or-loss chart stays its own chart on every screen.
//
// THE PANEL FOLLOWS THE TAP ON A PHONE (#56 item 3): a tapped period scrolls the
// detail panel into view, so the change is seen without hunting for it.
import { useRef, useState, type ReactNode } from "react";
import type { GrowthVisualsData, GvMargin, GvMarginKind, GvPeriod, GvSeries } from "@/lib/growthVisuals";
import { ReasonedValue } from "@/app/components/EstimatedValue";

const C = {
  sales: "#3987e5",
  lastYear: "#184f95",
  profit: "#0ca30c",
  loss: "#d03b3b",
  margin: "#9085e9",
  ink: "#e2e8f0",
  muted: "#94a3b8",
  rule: "rgba(148,163,184,0.35)",
  active: "rgba(255,255,255,0.06)",
};

/** The phone breakpoint: the margin line over the sales chart at or below this width. */
export const PHONE_MAX_PX = 480;
const PHONE = `(max-width: ${PHONE_MAX_PX}px)`;

const PLOT_H = 120;
/** Each side of a period's slot left empty by its bars: 16% + 16% leaves the bars 68% (#563 COWORK #60). */
export const BAR_INSET_PCT = 16;
const MARGIN_H = 72;
/** Room above the tallest sales bar for the newest bar's value label. */
const SALES_HEADROOM = 0.84;
/** The gross-margin chart's guide lines, in % of sales. */
const PCT_GUIDES = [0, 50, 100] as const;

/**
 * "derived", BEFORE THE FIGURE, ITS NOTE ON TAP (#552 COWORK #124/#125): an
 * <abbr title> opened nothing on a tap, and after the figure it broke the
 * column's right edge.
 */
function DerivedTag({ note }: { note: string | null }) {
  if (!note) return null;
  return <ReasonedValue text="derived" reason={note} style={{ marginRight: 4, fontSize: 11, fontWeight: 800, color: C.muted }} />;
}

/** One chart: a title, the plot as a grid of columns, and the shared axis labels. */
function Chart({
  title, legend, note, periods, active, setActive, height, render, behind, over, overlay, onTap,
}: {
  title: string;
  legend: ReactNode;
  /** One line under the title: why the margin chart shows operating margin (#563 COWORK #71). */
  note?: ReactNode;
  periods: GvPeriod[];
  active: number;
  setActive: (i: number) => void;
  height: number;
  render: (p: GvPeriod, i: number) => ReactNode;
  /** Drawn across the whole plot, under the columns (guide lines). */
  behind?: ReactNode;
  /**
   * Per column, ON TOP of the column buttons and outside them (#563 COWORK #52):
   * a tag whose note opens on tap can't sit inside a <button>, so it sits here.
   * The layer lets taps through to the columns except on what it draws.
   */
  over?: (p: GvPeriod, i: number) => ReactNode;
  /** Drawn across the whole plot, over the columns and under `over`; taps pass through. */
  overlay?: ReactNode;
  /** A click or tap on a column (after setActive): the panel scrolls into view on a phone. */
  onTap?: () => void;
}) {
  return (
    <div className="gvChart">
      <div className="gvChartHead">
        <span className="gvChartTitle">{title}</span>
        <span className="gvLegend">{legend}</span>
      </div>
      {note ? <p className="gvChartNote">{note}</p> : null}
      <div className="gvGrid" style={{ gridTemplateColumns: `repeat(${periods.length}, minmax(0, 1fr))`, height }}>
        {behind ? <span className="gvBehind" aria-hidden="true">{behind}</span> : null}
        {periods.map((p, i) => (
          <button
            type="button"
            key={p.label}
            className="gvCol"
            aria-pressed={i === active}
            aria-label={`${p.label}: show this period's figures`}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onClick={() => { setActive(i); onTap?.(); }}
            style={{ height, background: i === active ? C.active : "transparent" }}
          >
            {render(p, i)}
          </button>
        ))}
        {overlay ? <span className="gvOverlay" aria-hidden="true">{overlay}</span> : null}
        {over ? (
          <span className="gvOver" style={{ gridTemplateColumns: `repeat(${periods.length}, minmax(0, 1fr))` }}>
            {periods.map((p, i) => <span key={p.label} className="gvOverCol">{over(p, i)}</span>)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** A's derived note for this period's sales or profit, if either is derived. */
const derivedOf = (p: GvPeriod) => p.sales?.derivedNote ?? p.profit?.derivedNote ?? null;

function Axis({ periods, active }: { periods: GvPeriod[]; active: number }) {
  return (
    <div className="gvGrid gvAxis" style={{ gridTemplateColumns: `repeat(${periods.length}, minmax(0, 1fr))` }}>
      {periods.map((p, i) => (
        // EVERY OTHER LABEL CAN DROP ON A PHONE, counted from the NEWEST so the
        // latest period always keeps its label (COWORK #27, 400 px).
        <span key={p.label} className={`gvTick${(periods.length - 1 - i) % 2 ? " gvTickAlt" : ""}`}
          style={{ color: i === active ? C.ink : C.muted, fontWeight: i === active ? 800 : 600 }}>
          {p.short}
          {/* THE DERIVED MARK STAYS (COWORK #26 rules): the sentence is on the
              mark itself and in the footnote, never an asterisk alone. */}
          {derivedOf(p) ? <ReasonedValue text="*" reason={derivedOf(p)} /> : null}
        </span>
      ))}
    </div>
  );
}

type ChartProps = { s: GvSeries; active: number; setActive: (i: number) => void; onTap?: () => void };

/**
 * THE MARGIN THE CHART DRAWS for a period (#563 COWORK #71): its gross margin,
 * or its operating margin when the whole series falls back to operating; none
 * when the series has neither. ONE MEASURE PER SERIES, never mixed.
 */
export function marginPct(p: GvPeriod, kind: GvMarginKind): number | null {
  return kind === "gross" ? p.grossPct : kind === "operating" ? p.opPct : null;
}
export const MARGIN_NAME: Record<Exclude<GvMarginKind, "none">, string> = { gross: "Gross margin", operating: "Operating margin" };

/** The phone's margin line: one segment per run of periods with a margin; a period without one breaks it. */
export function marginSegments(periods: GvPeriod[], kind: GvMarginKind = "gross"): string[] {
  const runs: string[] = [];
  let run: string[] = [];
  periods.forEach((p, i) => {
    const v = marginPct(p, kind);
    if (v === null) { if (run.length) runs.push(run.join(" ")); run = []; return; }
    run.push(`${run.length ? "L" : "M"}${i + 0.5} ${100 - Math.min(v, 100)}`);
  });
  if (run.length) runs.push(run.join(" "));
  return runs;
}

/**
 * THE LINE JOINING THE MARGIN DOTS (#563 COWORK #58 on phones, #60 on every
 * screen): the dots' own purple, thin and a little lighter than the dots, so
 * the dots stay the figures and the line only shows the trend. A period with
 * no margin breaks it (marginSegments); its panel says why.
 */
export const MARGIN_LINE = { width: 1.5, opacity: 0.7 } as const;
function MarginLine({ periods, kind, className }: { periods: GvPeriod[]; kind: GvMarginKind; className: string }) {
  return (
    <svg className={`${className} gvMarginLine`} viewBox={`0 0 ${periods.length} 100`} preserveAspectRatio="none" aria-hidden="true">
      {marginSegments(periods, kind).map((d) => (
        <path key={d} d={d} fill="none" stroke={C.margin} strokeWidth={MARGIN_LINE.width} strokeOpacity={MARGIN_LINE.opacity} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

function SalesChart({ s, active, setActive, onTap, notReported }: ChartProps & { notReported: string }) {
  const max = Math.max(1, ...s.periods.flatMap((p) => [p.sales?.val ?? 0, p.lastYear?.val ?? 0])) / SALES_HEADROOM;
  const newest = s.periods.length - 1;
  const anyGhost = s.periods.some((p) => p.lastYear);
  // THE SERIES' ONE MARGIN (#563 COWORK #71): gross, operating for the whole
  // series, or none (then no line, no dots, no scale on the phone).
  const kind = s.margin.kind;
  const lastMargin = s.periods.map((p) => marginPct(p, kind) !== null).lastIndexOf(true);
  return (
    <Chart
      title={`Sales per ${s.one}`}
      legend={<>
        <i style={{ background: C.sales }} />This {s.one}
        {anyGhost ? <><i style={{ background: C.lastYear }} />Same {s.one} a year earlier</> : null}
        {/* PHONE ONLY: the margin line's legend entry names its scale (right, %). */}
        {kind !== "none" ? <span className="gvPhoneOnly"><i style={{ background: C.margin, borderRadius: 999 }} />{MARGIN_NAME[kind]} % (right scale)</span> : null}
      </>}
      note={kind === "operating" ? <span className="gvPhoneOnly">{s.margin.note}</span> : null}
      periods={s.periods} active={active} setActive={setActive} onTap={onTap} height={PLOT_H}
      behind={kind === "none" ? null :
        // PHONE ONLY: the % scale, on the right-hand side, outside the bars.
        <span className="gvPhoneOnly gvRightScale" style={{ color: C.margin }}>
          {PCT_GUIDES.map((c) => <span key={c} style={{ bottom: `${c}%` }}>{c}%</span>)}
        </span>
      }
      overlay={kind === "none" ? null : <MarginLine periods={s.periods} kind={kind} className="gvPhoneOnly" />}
      over={(p, i) => { const v = marginPct(p, kind); return v === null ? null : (
        <span className="gvPhoneOnly">
          <span className="gvDot" style={{ bottom: `calc(${Math.min(v, 100)}% - 5px)`, background: C.margin }} />
          {i === lastMargin ? (
            <span className="gvVal gvPill" style={{ bottom: `calc(${Math.min(v, 100)}% + 7px)`, color: C.ink }}>{v}%</span>
          ) : null}
        </span>
      ); }}
      render={(p, i) => (
        <>
          <span className="gvBars">
            {p.lastYear ? <span className="gvBar" style={{ height: `${(p.lastYear.val / max) * 100}%`, background: C.lastYear }} /> : <span className="gvBar" />}
            {p.sales
              ? <span className="gvBar" style={{ height: `${(Math.max(p.sales.val, 0) / max) * 100}%`, background: C.sales }} />
              : <span className="gvBar gvNone" title={notReported} />}
          </span>
          {i === newest && p.sales ? (
            <span className="gvVal" style={{ bottom: `calc(${(Math.max(p.sales.val, 0) / max) * 100}% + 2px)` }}>{p.sales.text}</span>
          ) : null}
        </>
      )}
    />
  );
}

function ProfitChart({ s, active, setActive, onTap }: ChartProps) {
  const vals = s.periods.map((p) => p.profit?.val ?? 0);
  const up = Math.max(0, ...vals);
  const down = Math.max(0, ...vals.map((v) => -v));
  // 18% HEADROOM above the tallest profit bar, so the one-off tag sits inside
  // the plot instead of on the legend above it.
  const span = (up + down || 1) / 0.82;
  const zero = 18 + (up / span) * 100; // % from the top where the zero line sits
  return (
    <Chart
      title={`Profit or loss per ${s.one}`}
      legend={<>
        <i style={{ background: C.profit }} />Profit (+), above the line
        <i style={{ background: C.loss }} />Loss (−), below
      </>}
      periods={s.periods} active={active} setActive={setActive} onTap={onTap} height={PLOT_H}
      render={(p) => {
        const v = p.profit?.val ?? null;
        return (
          <span className="gvPl">
            <span className="gvZero" style={{ top: `${zero}%`, background: C.rule }} />
            {v === null ? null : v >= 0 ? (
              <span className="gvPlBar" style={{ bottom: `${100 - zero}%`, height: `${(v / span) * 100}%`, background: C.profit, borderRadius: "4px 4px 0 0" }} />
            ) : (
              <span className="gvPlBar" style={{ top: `${zero}%`, height: `${(-v / span) * 100}%`, background: C.loss, borderRadius: "0 0 4px 4px" }} />
            )}
          </span>
        );
      }}
      over={(p, i) => {
        if (!p.oneOff) return null;
        const v = p.profit?.val ?? null;
        // The note opens on tap, keyboard and hover: A's ReasonedValue (#563 COWORK #51/#52).
        // THE OUTER COLUMNS' TAGS HUG THEIR OUTER EDGE: centred, the newest
        // column's tag overran a 360 px screen by a pixel (#563 COWORK #56 rule).
        const edge = i === 0 ? " gvOneOffStart" : i === s.periods.length - 1 ? " gvOneOffEnd" : "";
        return (
          <span className={`gvOneOff${edge}`} style={{ top: v !== null && v >= 0 ? `calc(${zero - (v / span) * 100}% - 16px)` : `calc(${zero}% - 16px)` }}>
            <ReasonedValue text="one-off" reason={p.oneOff} />
          </span>
        );
      }}
    />
  );
}

function MarginChart({ s, active, setActive, onTap }: ChartProps) {
  const newest = s.periods.length - 1;
  const kind = s.margin.kind === "operating" ? "operating" : "gross";
  return (
    <Chart
      title={`${MARGIN_NAME[kind]} per ${s.one}`}
      legend={<><i style={{ background: C.margin, borderRadius: 999 }} />{MARGIN_NAME[kind]} (% of sales)</>}
      note={kind === "operating" ? s.margin.note : null}
      periods={s.periods} active={active} setActive={setActive} onTap={onTap} height={MARGIN_H}
      behind={<>
        {PCT_GUIDES.map((c) => (
          <span key={c} className="gvPctGuide" style={{ bottom: `${c}%`, background: C.rule }}>
            {/* The top guide's label hangs below its line, inside the plot. */}
            <span className="gvPctLabel" style={c === 100 ? { color: C.muted, top: 2 } : { color: C.muted, bottom: 2 }}>{c}%</span>
          </span>
        ))}
        {/* UNDER the columns, so the dots (drawn in them) sit on top of it. */}
        <MarginLine periods={s.periods} kind={kind} className="gvDeskLine" />
      </>}
      render={(p, i) => {
        const v = marginPct(p, kind);
        if (v === null) return <span className="gvDotWrap" />;
        const at = Math.min(v, 100);
        return (
          <span className="gvDotWrap">
            <span className="gvDot" style={{ bottom: `calc(${at}% - 5px)`, background: C.margin }} />
            {i === newest ? (
              // Above the dot, or below it when the dot is near the top of the plot.
              <span className="gvVal" style={at > 75 ? { top: `calc(${100 - at}% + 7px)` } : { bottom: `calc(${at}% + 7px)` }}>
                {v}%
              </span>
            ) : null}
          </span>
        );
      }}
    />
  );
}

function Detail({ p, one, notReported, showProfit, margin }: { p: GvPeriod; one: string; notReported: string; showProfit: boolean; margin: GvMargin }) {
  const nr = <span style={{ color: C.muted }}>{notReported}</span>;
  return (
    <div className="gvDetail" aria-live="polite">
      <div className="gvDetailHead">{p.label}</div>
      <dl>
        <dt>Sales</dt>
        <dd>
          {p.sales ? <><DerivedTag note={p.sales.derivedNote} /><strong>{p.sales.text}</strong></> : nr}
          {p.lastYear ? <> · {p.lastYear.label}: <DerivedTag note={p.lastYear.derivedNote} />{p.lastYear.text}</> : null}
          {p.growth ? <> · {p.growth} on a year earlier</> : null}
        </dd>
        {/* NO PROFIT ROW while the chart is off: an unmarked profit figure here
            would be the same trap as an unmarked bar (COWORK #36 blocker). */}
        {showProfit ? (
          <>
            <dt>Profit or loss</dt>
            <dd>
              {p.profit
                ? <><DerivedTag note={p.profit.derivedNote} /><strong>{p.profit.val >= 0 ? "Profit +" : "Loss −"}{p.profit.text.replace(/^-/, "")}</strong></>
                : p.profitUnchecked ? <span className="gvNote">{p.profitUnchecked}</span> : nr}
              {p.oneOff ? <div className="gvNote">{p.oneOff}</div> : null}
            </dd>
          </>
        ) : null}
        <dt>Gross margin</dt>
        <dd>
          {p.grossText !== null
            ? <strong>{p.grossText}</strong>
            // NOT IN THE FILINGS AT ALL (#563 COWORK #71): said as the filer's, not as a gap of ours.
            : margin.grossAbsent ? <span style={{ color: C.muted }}>{margin.grossAbsent}</span>
              : p.grossNote ? <span style={{ color: C.muted }}>{p.grossNote}</span> : nr}
        </dd>
        {/* A margin beyond ±100% reads as a multiple ("operating costs were about
            2.9× sales"); within, a percentage. Both under the standard term.
            When the chart draws operating margin, a period without a dot says why. */}
        {p.operating ? <><dt>Operating margin</dt><dd>{p.operating}</dd></>
          : margin.kind === "operating" && p.opNote ? <><dt>Operating margin</dt><dd><span style={{ color: C.muted }}>{p.opNote}</span></dd></> : null}
        {p.net ? <><dt>Net margin</dt><dd>{p.net}</dd></> : null}
      </dl>
      <div className="gvHint">Tap or hover another {one} to see its figures.</div>
    </div>
  );
}

export default function GrowthVisuals({ data, notReported }: { data: GrowthVisualsData; notReported: string }) {
  const modes = (["quarters", "years"] as const).filter((m) => data[m]?.periods.length);
  const [mode, setMode] = useState<"quarters" | "years">(modes[0] ?? "quarters");
  const s = data[mode];
  const [active, setActive] = useState<number>(Math.max(0, (s?.periods.length ?? 1) - 1));
  const detailRef = useRef<HTMLDivElement>(null);
  if (!s || !s.periods.length) return null;
  // ON A PHONE, A TAP BRINGS THE PANEL INTO VIEW (#563 COWORK #56 item 3);
  // "nearest" does nothing when it is already on screen. Desktop never scrolls.
  const tapped = () => {
    if (typeof window === "undefined" || !window.matchMedia?.(PHONE).matches) return;
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };
  const at = Math.min(active, s.periods.length - 1);
  const pick = (m: "quarters" | "years") => {
    setMode(m);
    setActive(Math.max(0, (data[m]?.periods.length ?? 1) - 1));
  };
  return (
    <div className="gvRoot">
      {s.summary ? <p className="gvSummary">{s.summary}</p> : null}
      {modes.length > 1 ? (
        <div className="gvToggle" role="group" aria-label="Period">
          {modes.map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => pick(m)}>
              {m === "quarters" ? "Quarters" : "Years"}
            </button>
          ))}
        </div>
      ) : null}
      <div className="gvSalesWrap">
        <SalesChart s={s} active={at} setActive={setActive} onTap={tapped} notReported={notReported} />
        <Axis periods={s.periods} active={at} />
      </div>
      {s.profitMissing ? (
        <p className="gvMissing">{s.profitMissing}</p>
      ) : (
        <>
          <ProfitChart s={s} active={at} setActive={setActive} onTap={tapped} />
          <Axis periods={s.periods} active={at} />
        </>
      )}
      {/* DESKTOP ONLY (#563 COWORK #58): on a phone the margin is the line over the sales chart.
          No margin at all (#563 COWORK #71): no empty grid, the reason instead, on every screen. */}
      {s.margin.kind === "none" ? (
        <p className="gvMissing gvNoMargin">{s.margin.note}</p>
      ) : (
        <div className="gvDesktopOnly">
          <MarginChart s={s} active={at} setActive={setActive} onTap={tapped} />
          <Axis periods={s.periods} active={at} />
        </div>
      )}
      {/* The "*" footnote and the gross-margin sentence are under the card's
          "About these figures" (#56 item 2), server-rendered with the card. */}
      <div ref={detailRef}>
        <Detail p={s.periods[at]} one={s.one} notReported={notReported} showProfit={!s.profitMissing} margin={s.margin} />
      </div>
      <style>{`
        .gvRoot { display: grid; gap: 6px; margin: 4px 0 12px; }
        .gvSummary { margin: 0 0 4px; font-weight: 700; color: ${C.ink}; }
        .gvToggle { display: inline-flex; gap: 0; justify-self: start; border: 1px solid ${C.rule}; border-radius: 999px; overflow: hidden; }
        .gvToggle button { background: transparent; color: ${C.muted}; border: 0; padding: 6px 14px; font-weight: 700; cursor: pointer; font: inherit; font-size: 13px; }
        .gvToggle button[aria-pressed="true"] { background: rgba(57,135,229,0.18); color: ${C.ink}; }
        .gvChart { margin-top: 10px; }
        .gvChartHead { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; margin-bottom: 4px; font-size: 13px; }
        .gvChartTitle { font-weight: 800; color: ${C.ink}; }
        .gvLegend { color: ${C.muted}; display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; font-size: 12px; }
        .gvLegend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
        .gvGrid { display: grid; gap: 2px; position: relative; }
        .gvBehind { position: absolute; inset: 0; pointer-events: none; }
        .gvPctGuide { position: absolute; left: 0; right: 0; height: 1px; opacity: 0.7; }
        .gvPctLabel { position: absolute; left: 0; font-size: 9px; font-weight: 700; line-height: 1; }
        .gvVal { position: absolute; left: -8px; right: -8px; text-align: center; font-size: 11px; font-weight: 800; color: ${C.ink}; white-space: nowrap; pointer-events: none; }
        .gvCol { position: relative; display: block; padding: 0; border: 0; border-radius: 6px; cursor: pointer; font: inherit; color: inherit; }
        .gvCol:focus-visible { outline: 2px solid ${C.sales}; outline-offset: 1px; }
        /* WIDER BARS, SMALLER GAPS (#563 COWORK #60): the pair fills about two
           thirds of its period's slot at every width, and the profit bar matches it. */
        .gvBars { position: absolute; inset: 0 ${BAR_INSET_PCT}% 0; display: flex; align-items: flex-end; justify-content: center; gap: 2px; }
        .gvBar { flex: 1 1 0; border-radius: 4px 4px 0 0; min-height: 0; }
        .gvNone { height: 2px; border-top: 2px dashed ${C.muted}; }
        .gvPl, .gvDotWrap { position: absolute; inset: 0; }
        .gvZero { position: absolute; left: 0; right: 0; height: 1px; }
        .gvPlBar { position: absolute; left: ${BAR_INSET_PCT}%; right: ${BAR_INSET_PCT}%; }
        .gvOverlay { position: absolute; inset: 0; pointer-events: none; z-index: 1; }
        .gvMarginLine { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
        .gvOver { position: absolute; inset: 0; display: grid; gap: 2px; pointer-events: none; z-index: 2; }
        .gvOverCol { position: relative; }
        .gvOneOffStart { left: 0 !important; transform: none !important; }
        .gvOneOffEnd { left: auto !important; right: 0; transform: none !important; }
        .gvOneOff { position: absolute; left: 50%; transform: translateX(-50%); font-size: 10px; font-weight: 800; color: ${C.ink}; white-space: nowrap; pointer-events: auto; z-index: 2; background: rgba(11,18,32,0.85); border-radius: 4px; padding: 0 3px; }
        .gvPill { left: 50%; right: auto; transform: translateX(-50%); background: rgba(11,18,32,0.85); border-radius: 4px; padding: 0 3px; }
        .gvPhoneOnly { display: none; }
        .gvRightScale { position: absolute; top: 0; bottom: 0; left: calc(100% + 4px); width: 30px; font-size: 9px; font-weight: 700; }
        .gvRightScale span { position: absolute; left: 0; transform: translateY(50%); line-height: 1; }
        .gvDot { position: absolute; left: calc(50% - 5px); width: 10px; height: 10px; border-radius: 999px; box-shadow: 0 0 0 2px #0b1220; }
        .gvAxis { margin-top: 2px; }
        .gvTick { text-align: center; font-size: 11px; white-space: nowrap; overflow: hidden; }
        .gvMissing { margin: 10px 0 0; font-size: 13px; color: ${C.muted}; }
        .gvDetail { margin-top: 10px; border: 1px solid ${C.rule}; border-radius: 12px; padding: 10px 12px; font-size: 14px; }
        .gvDetailHead { font-weight: 900; margin-bottom: 6px; }
        .gvDetail dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0; }
        .gvDetail dt { color: ${C.muted}; font-weight: 700; }
        .gvDetail dd { margin: 0; }
        .gvChartNote { margin: 0 0 6px; font-size: 12px; color: ${C.muted}; }
        .gvNote { font-size: 12px; color: ${C.muted}; margin-top: 2px; }
        .gvHint { margin-top: 6px; font-size: 12px; color: ${C.muted}; }
        @media ${PHONE} {
          .gvPhoneOnly { display: inline; }
          svg.gvPhoneOnly, .gvPhoneOnly.gvRightScale { display: block; }
          .gvDesktopOnly { display: none; }
          .gvSalesWrap .gvGrid { margin-right: 32px; }
          .gvTickAlt { visibility: hidden; }
          /* Every other label is hidden here, so a shown one may spill into its
             empty neighbour's slot rather than be clipped to "Q4 '2" (#60). */
          .gvTick { overflow: visible; }
          .gvDetail dl { grid-template-columns: 1fr; gap: 0 0; }
          .gvDetail dd { margin-bottom: 6px; }
        }
      `}</style>
    </div>
  );
}

/** A's full table, collapsed (COWORK #26 §5). A wraps its existing table in this. */
export function SeeAllTheNumbers({ children }: { children: ReactNode }) {
  return (
    <details className="gvAll">
      <summary style={{ cursor: "pointer", fontWeight: 800, margin: "8px 0" }}>See all the numbers</summary>
      {children}
    </details>
  );
}
