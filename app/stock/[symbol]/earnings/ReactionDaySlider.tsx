"use client";
// THE DAY SLIDER (#552 COWORK #189): one row per report, a slider from 1 to 30
// trading days after it, and the move to that day's close as you drag.
//
// Server-rendered at the presets (Day 1 / 5 / 20, cycling down the rows), so
// the figures are in the page before any script runs. Every number it shows
// arrives as a percentage from reactionDays.ts -- no price ever reaches here.
import { useState } from "react";
import { REACTION_SLIDER_PRESETS, type ReactionDayRow } from "./reactionDays";

const dayPctText = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
const dayLongDate = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

/** Each row's opening day: the presets in turn, never past the row's last day. */
export function presetDays(rows: ReactionDayRow[]): number[] {
  return rows.map((r, i) => Math.min(REACTION_SLIDER_PRESETS[i % REACTION_SLIDER_PRESETS.length], Math.max(r.pct.length, 1)));
}

export function ReactionDaySlider({ rows }: { rows: ReactionDayRow[] }) {
  const [days, setDays] = useState<number[]>(() => presetDays(rows));
  const [all, setAll] = useState<number>(5);
  // ONE AXIS FOR EVERY ROW, so a bar's length compares across reports.
  const values = rows.flatMap((r) => r.pct).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const maxAbs = values.length ? Math.max(...values.map(Math.abs), 1) : 1;
  const longest = Math.max(...rows.map((r) => r.pct.length), 1);
  const setRow = (i: number, d: number) => setDays((prev) => prev.map((x, j) => (j === i ? d : x)));
  const setEvery = (d: number) => { setAll(d); setDays(rows.map((r) => Math.min(d, Math.max(r.pct.length, 1)))); };

  return (
    <div className="rds" data-day-slider="">
      <div className="rdsAll">
        <label className="rdsAllLabel" htmlFor="rds-all">Set all to day <strong>{all}</strong></label>
        <input id="rds-all" className="rdsRange" type="range" min={1} max={longest} step={1} value={all}
          onChange={(e) => setEvery(Number(e.target.value))} aria-label="Set every report to the same trading day" />
        <button type="button" className="rdsReset" onClick={() => setDays(presetDays(rows))}>Reset</button>
      </div>
      <ul className="rdsRows">
        {rows.map((r, i) => {
          const d = days[i] ?? 1;
          const v = r.pct[d - 1] ?? null;
          const m = r.spy[d - 1] ?? null;
          const latest = r.truncated && d === r.pct.length;
          const fill = v === null ? 0 : (Math.abs(v) / maxAbs) * 50;
          return (
            <li key={`${r.label}-${r.reportDate}`} className="rdsRow" data-row={r.label} data-day={d}>
              <div className="rdsWhen">
                <span className="rdsLabel">{r.label}</span>
                <span className="rdsDate">{dayLongDate(r.reportDate)}</span>
                {r.timing ? <span className="rdsTag">{r.timing}</span> : null}
              </div>
              <div className="rdsControl">
                <input className="rdsRange" type="range" min={1} max={Math.max(r.pct.length, 1)} step={1} value={d}
                  onChange={(e) => setRow(i, Number(e.target.value))}
                  aria-label={`${r.label}: trading days after the report`} aria-valuetext={`Day ${d}`} />
                <div className="rdsReadout" aria-live="polite" data-readout="">
                  <strong>{`Day ${d}${latest ? " (latest)" : ""}: `}{v === null ? "—" : dayPctText(v)}</strong>
                  {r.dayDates[d - 1] ? <span className="rdsTo"> to {r.dayDates[d - 1]}</span> : null}
                  {m !== null ? <span className="rdsMarket"> · S&amp;P {dayPctText(m)}</span> : null}
                </div>
                <div className="rdsBar" aria-hidden="true">
                  <span className="rdsZero" />
                  {v !== null && fill > 0 ? (
                    <span className="rdsFill" data-up={v >= 0 ? "1" : "0"}
                      style={{ left: v >= 0 ? "50%" : `${50 - fill}%`, width: `${fill}%`, background: v >= 0 ? "#22c55e" : "#ef4444" }} />
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
