"use client";

// THE "GROWTH & MARGINS" PICTURE (#563 COWORK #26/#27): three small charts on one
// time axis — sales, profit or loss, and gross margin as cents kept of each $1 —
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
import { useState, type ReactNode } from "react";
import type { GrowthVisualsData, GvPeriod, GvSeries } from "@/lib/growthVisuals";

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

const PLOT_H = 120;
const MARGIN_H = 72;

function DerivedTag({ note }: { note: string | null }) {
  if (!note) return null;
  return (
    <abbr title={note} style={{ marginLeft: 4, fontSize: 11, fontWeight: 800, color: C.muted, textDecoration: "none", cursor: "help" }}>
      derived
    </abbr>
  );
}

/** One chart: a title, the plot as a grid of columns, and the shared axis labels. */
function Chart({
  title, legend, periods, active, setActive, height, render,
}: {
  title: string;
  legend: ReactNode;
  periods: GvPeriod[];
  active: number;
  setActive: (i: number) => void;
  height: number;
  render: (p: GvPeriod, i: number) => ReactNode;
}) {
  return (
    <div className="gvChart">
      <div className="gvChartHead">
        <span className="gvChartTitle">{title}</span>
        <span className="gvLegend">{legend}</span>
      </div>
      <div className="gvGrid" style={{ gridTemplateColumns: `repeat(${periods.length}, minmax(0, 1fr))` }}>
        {periods.map((p, i) => (
          <button
            type="button"
            key={p.label}
            className="gvCol"
            aria-pressed={i === active}
            aria-label={`${p.label}: show this period's figures`}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onClick={() => setActive(i)}
            style={{ height, background: i === active ? C.active : "transparent" }}
          >
            {render(p, i)}
          </button>
        ))}
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
          {derivedOf(p) ? <abbr title={derivedOf(p)!} style={{ textDecoration: "none", cursor: "help" }}>*</abbr> : null}
        </span>
      ))}
    </div>
  );
}

function SalesChart({ s, active, setActive, notReported }: { s: GvSeries; active: number; setActive: (i: number) => void; notReported: string }) {
  const max = Math.max(1, ...s.periods.flatMap((p) => [p.sales?.val ?? 0, p.lastYear?.val ?? 0]));
  const anyGhost = s.periods.some((p) => p.lastYear);
  return (
    <Chart
      title={`Sales per ${s.one}`}
      legend={<>
        <i style={{ background: C.sales }} />This {s.one}
        {anyGhost ? <><i style={{ background: C.lastYear }} />Same {s.one} a year earlier</> : null}
      </>}
      periods={s.periods} active={active} setActive={setActive} height={PLOT_H}
      render={(p) => (
        <span className="gvBars">
          {p.lastYear ? <span className="gvBar" style={{ height: `${(p.lastYear.val / max) * 100}%`, background: C.lastYear }} /> : <span className="gvBar" />}
          {p.sales
            ? <span className="gvBar" style={{ height: `${(Math.max(p.sales.val, 0) / max) * 100}%`, background: C.sales }} />
            : <span className="gvBar gvNone" title={notReported} />}
        </span>
      )}
    />
  );
}

function ProfitChart({ s, active, setActive }: { s: GvSeries; active: number; setActive: (i: number) => void }) {
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
      periods={s.periods} active={active} setActive={setActive} height={PLOT_H}
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
            {p.oneOff ? (
              <abbr className="gvOneOff" title={p.oneOff} style={{ top: v !== null && v >= 0 ? `calc(${zero - (v / span) * 100}% - 16px)` : `calc(${zero}% - 16px)` }}>
                one-off
              </abbr>
            ) : null}
          </span>
        );
      }}
    />
  );
}

function MarginChart({ s, active, setActive }: { s: GvSeries; active: number; setActive: (i: number) => void }) {
  return (
    <Chart
      title="Of every $1 of sales, cents kept after the direct costs"
      legend={<><i style={{ background: C.margin, borderRadius: 999 }} />¢ kept per $1 (gross margin)</>}
      periods={s.periods} active={active} setActive={setActive} height={MARGIN_H}
      render={(p) => (
        <span className="gvDotWrap">
          <span className="gvDotGuide" style={{ background: C.rule }} />
          {p.keptCents !== null ? (
            <span className="gvDot" style={{ bottom: `calc(${Math.min(p.keptCents, 100)}% - 5px)`, background: C.margin }} />
          ) : null}
        </span>
      )}
    />
  );
}

function Detail({ p, one, notReported }: { p: GvPeriod; one: string; notReported: string }) {
  const nr = <span style={{ color: C.muted }}>{notReported}</span>;
  return (
    <div className="gvDetail" aria-live="polite">
      <div className="gvDetailHead">{p.label}</div>
      <dl>
        <dt>Sales</dt>
        <dd>
          {p.sales ? <><strong>{p.sales.text}</strong><DerivedTag note={p.sales.derivedNote} /></> : nr}
          {p.lastYear ? <> · {p.lastYear.label}: {p.lastYear.text}<DerivedTag note={p.lastYear.derivedNote} /></> : null}
          {p.growth ? <> · {p.growth} on a year earlier</> : null}
        </dd>
        <dt>Profit or loss</dt>
        <dd>
          {p.profit
            ? <><strong>{p.profit.val >= 0 ? "Profit +" : "Loss −"}{p.profit.text.replace(/^-/, "")}</strong><DerivedTag note={p.profit.derivedNote} /></>
            : nr}
          {p.oneOff ? <div className="gvNote">{p.oneOff}</div> : null}
        </dd>
        <dt>Of every $1 of sales</dt>
        <dd>
          {p.keptCents !== null
            ? <>kept <strong>{p.keptCents}¢</strong> after the direct costs of making and selling it</>
            : p.grossNote ? <span style={{ color: C.muted }}>{p.grossNote}</span> : nr}
        </dd>
        {p.operating || p.net ? (
          <>
            <dt>All costs</dt>
            <dd>
              {p.operating ? <>operating margin: {p.operating}</> : null}
              {p.operating && p.net ? " · " : null}
              {p.net ? <>net margin: {p.net}</> : null}
            </dd>
          </>
        ) : null}
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
  if (!s || !s.periods.length) return null;
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
      <SalesChart s={s} active={at} setActive={setActive} notReported={notReported} />
      <Axis periods={s.periods} active={at} />
      {s.profitMissing ? (
        <p className="gvMissing">{s.profitMissing}</p>
      ) : (
        <>
          <ProfitChart s={s} active={at} setActive={setActive} />
          <Axis periods={s.periods} active={at} />
        </>
      )}
      <MarginChart s={s} active={at} setActive={setActive} />
      <Axis periods={s.periods} active={at} />
      {s.periods.some((p) => derivedOf(p)) ? (
        <p className="gvMissing" style={{ marginTop: 4 }}>
          * Not filed as a {s.one} of its own; worked out from the company&rsquo;s filings. Tap the {s.one} for how.
        </p>
      ) : null}
      <Detail p={s.periods[at]} one={s.one} notReported={notReported} />
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
        .gvGrid { display: grid; gap: 2px; }
        .gvCol { position: relative; display: block; padding: 0; border: 0; border-radius: 6px; cursor: pointer; font: inherit; color: inherit; }
        .gvCol:focus-visible { outline: 2px solid ${C.sales}; outline-offset: 1px; }
        .gvBars { position: absolute; inset: 0 12% 0; display: flex; align-items: flex-end; justify-content: center; gap: 2px; }
        .gvBar { flex: 1 1 0; max-width: 18px; border-radius: 4px 4px 0 0; min-height: 0; }
        .gvNone { height: 2px; border-top: 2px dashed ${C.muted}; }
        .gvPl, .gvDotWrap { position: absolute; inset: 0; }
        .gvZero { position: absolute; left: 0; right: 0; height: 1px; }
        .gvPlBar { position: absolute; left: 25%; right: 25%; max-width: 22px; margin: 0 auto; }
        .gvOneOff { position: absolute; left: 0; right: 0; text-align: center; font-size: 10px; font-weight: 800; color: ${C.ink}; text-decoration: none; cursor: help; white-space: nowrap; }
        .gvDotGuide { position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; }
        .gvDot { position: absolute; left: calc(50% - 5px); width: 10px; height: 10px; border-radius: 999px; box-shadow: 0 0 0 2px #0b1220; }
        .gvAxis { margin-top: 2px; }
        .gvTick { text-align: center; font-size: 11px; white-space: nowrap; overflow: hidden; }
        .gvMissing { margin: 10px 0 0; font-size: 13px; color: ${C.muted}; }
        .gvDetail { margin-top: 10px; border: 1px solid ${C.rule}; border-radius: 12px; padding: 10px 12px; font-size: 14px; }
        .gvDetailHead { font-weight: 900; margin-bottom: 6px; }
        .gvDetail dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0; }
        .gvDetail dt { color: ${C.muted}; font-weight: 700; }
        .gvDetail dd { margin: 0; }
        .gvNote { font-size: 12px; color: ${C.muted}; margin-top: 2px; }
        .gvHint { margin-top: 6px; font-size: 12px; color: ${C.muted}; }
        @media (max-width: 480px) {
          .gvTickAlt { visibility: hidden; }
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
