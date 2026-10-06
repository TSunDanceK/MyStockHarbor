"use client";

// THE LAST SEVEN DAYS: "Results filed" and "Who reported" (#552 COWORK #170).
//
// Everything is rendered on the server and handed in; tapping a tile only
// changes which day's list is shown, with no navigation and no fetch. The
// rules (the window, the default day, the pills, the figures) live in
// lib/server/earningsWeek.ts, where a check drives them.
import Link from "next/link";
import { useState } from "react";
import type React from "react";
import TickerLogo from "@/app/components/TickerLogo";
import BackfillButton from "./BackfillButton";

export type WeekRow = {
  symbol: string;
  company: string;
  /** "$11.7B", or null when the announced period's figures are not on file yet. */
  revenue: string | null;
  /** % vs the same period a year earlier, or null (no comparable period). */
  revenueYoY: number | null;
  /** "$1.42", diluted, as filed. */
  eps: string | null;
  /** % from the last close before the filing to the latest close. */
  since: number | null;
};

export type WeekDay = {
  date: string;
  weekday: string;
  dateLabel: string;
  count: number;
  pill: string;
  isToday: boolean;
  /** "THURSDAY 1 OCTOBER · 4 COMPANIES" */
  eyebrow: string;
  /** When there are no rows: the day's honest sentence ("No results filed on …", or why it cannot be listed). */
  emptyLine: string | null;
  rows: WeekRow[];
};

const signedPct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;
const toneOf = (v: number | null) => (v === null ? undefined : v > 0 ? "#4ade80" : v < 0 ? "#f87171" : "#cbd5e1");

export default function EarningsWeek({ days, initial, credit = null, backfill = false }: {
  days: WeekDay[];
  initial: string;
  /** The owner's "Backfill this date" control: off on production (#552 COWORK #174), on a preview only. */
  backfill?: boolean;
  /** The "Shares since" closes' source, as the page's linked credit; null when they are not Tiingo's. */
  credit?: React.ReactNode;
}) {
  const [selected, setSelected] = useState(initial);
  const day = days.find((d) => d.date === selected) ?? days[days.length - 1];
  return (
    <section className="ewCard" aria-labelledby="ewHeading">
      <div className="ewEyebrow">Last 7 days</div>
      <h2 id="ewHeading" className="ewHeading">Results filed</h2>
      <div className="ewStrip" role="group" aria-label="Choose a day">
        {days.map((d) => (
          <button
            key={d.date}
            type="button"
            className={`ewTile${d.isToday ? " ewToday" : ""}${d.date === day.date ? " ewSelected" : ""}`}
            aria-pressed={d.date === day.date}
            data-week-day={d.date}
            onClick={() => setSelected(d.date)}
          >
            <span className="ewWeekday">{d.weekday}</span>
            {/* "5 Oct" as two words, so a large text size may break it between them rather than cut it. */}
            <span className="ewDate">{d.dateLabel}</span>
            <span className={`ewPill${d.count > 0 ? " ewPillOn" : ""}`} data-count={d.count}>{d.pill}</span>
          </button>
        ))}
      </div>

      <div className="ewListHead">
        <div className="ewEyebrow" data-selected-day={day.date}>{day.eyebrow}</div>
        <h3 className="ewSubheading">Who reported</h3>
      </div>
      {day.rows.length ? (
        <div className="ewTable" role="table" aria-label={`Results filed ${day.dateLabel}`}>
          <div className="ewRow ewRowHead" role="row">
            <span role="columnheader">Company</span>
            <span role="columnheader" className="ewNum">Revenue (YoY)</span>
            <span role="columnheader" className="ewNum ewWide">EPS</span>
            <span role="columnheader" className="ewNum ewWide">Shares since</span>
          </div>
          {day.rows.map((r) => (
            <div key={r.symbol} className="ewRow" role="row" data-row={r.symbol}>
              <span role="cell" className="ewCo">
                <TickerLogo symbol={r.symbol} name={r.company} size={22} radius={6} alt="" />
                <Link href={`/stock/${encodeURIComponent(r.symbol)}/earnings`} prefetch={false} className="ewSym">{r.symbol}</Link>
                <span className="ewName">{r.company}</span>
              </span>
              <span role="cell" className="ewNum" data-revenue="">
                {r.revenue ?? "—"}
                {/* NO COMPARABLE QUARTER: the YoY reads "—", never a guess. */}
                {r.revenue ? <span className="ewYoY" data-yoy="" style={{ color: toneOf(r.revenueYoY) }}>{r.revenueYoY === null ? "—" : signedPct(r.revenueYoY)}</span> : null}
              </span>
              <span role="cell" className="ewNum ewWide" data-eps="">{r.eps ?? "—"}</span>
              <span role="cell" className="ewNum ewWide" data-since="" style={{ color: toneOf(r.since) }}>{r.since === null ? "—" : signedPct(r.since)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="ewEmpty" data-empty-day="">{day.emptyLine}</p>
      )}
      {/* THIS CARD'S FINE PRINT (COWORK #170): where "Shares since" comes from. */}
      {credit && day.rows.length ? (
        <p className="ewFine" data-fine-print="">
          &ldquo;Shares since&rdquo;: last close before the filing to the latest close. Closes: {credit}
        </p>
      ) : null}
      {/* The owner's re-fill, for the day shown: an internal control, never on production. */}
      {backfill ? <BackfillButton date={day.date} hasEarnings={day.count > 0} /> : null}

      <style>{`
        .ewCard { margin: 0 0 24px; padding: 20px; border-radius: 16px; background: #0b1220; border: 1px solid rgba(255,255,255,0.12); box-shadow: 0 12px 30px rgba(0,0,0,0.28); }
        .ewEyebrow { font-size: var(--fs-label); font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; color: #93c5fd; }
        .ewHeading { margin: 4px 0 14px; font-size: 1.375rem; font-weight: 900; color: #f8fafc; }
        .ewSubheading { margin: 2px 0 10px; font-size: 1.125rem; font-weight: 900; color: #f8fafc; }
        .ewStrip { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; margin-bottom: 20px; }
        .ewTile { display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 0; padding: 8px 2px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.10); background: rgba(255,255,255,0.02); color: #e2e8f0; cursor: pointer; font: inherit; text-align: center; }
        .ewTile:focus-visible { outline: 2px solid #93c5fd; outline-offset: 2px; }
        .ewToday { border-style: dashed; border-color: rgba(147,197,253,0.75); }
        /* SOLID, AND THE SAME WIDTH AS EVERY OTHER TILE: an inset ring, not a thicker border. */
        .ewSelected { border-color: #93c5fd; box-shadow: inset 0 0 0 1px #93c5fd; background: rgba(147,197,253,0.14); }
        .ewWeekday { font-size: var(--fs-label); font-weight: 800; color: #cbd5e1; }
        .ewDate { font-size: var(--fs-label); font-weight: 700; color: #94a3b8; line-height: 1.25; }
        .ewPill { min-width: 1.75rem; padding: 2px 6px; border-radius: 999px; font-size: var(--fs-label); font-weight: 900; line-height: 1.3; text-align: center; color: #64748b; }
        .ewPillOn { color: #bbf7d0; background: rgba(34,197,94,0.18); border: 1px solid rgba(34,197,94,0.45); }
        .ewListHead { margin-bottom: 4px; }
        .ewTable { display: grid; }
        .ewRow { display: grid; grid-template-columns: minmax(0, 1fr) 9rem 5.5rem 6.5rem; align-items: center; gap: 12px; padding: 9px 0; border-top: 1px solid rgba(255,255,255,0.07); font-size: var(--fs-read); }
        .ewRowHead { font-size: var(--fs-label); font-weight: 800; color: #94a3b8; border-top: none; }
        .ewCo { display: flex; align-items: center; gap: 8px; min-width: 0; }
        .ewSym { font-weight: 900; color: #f8fafc; text-decoration: none; }
        .ewSym:hover { text-decoration: underline; }
        .ewName { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #cbd5e1; }
        .ewNum { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; color: #e2e8f0; }
        .ewYoY { margin-left: 6px; font-weight: 800; }
        .ewFine { margin: 10px 0 0; font-size: var(--fs-fine); line-height: 1.5; color: rgba(203,213,225,0.7); }
        .ewFine a { color: inherit; }
        .ewEmpty { margin: 6px 0 0; font-size: var(--fs-read); line-height: var(--lh-read); color: #cbd5e1; }
        @media (max-width: 640px) {
          .ewCard { padding: 14px; }
          .ewWide { display: none; }
          .ewRow { grid-template-columns: minmax(0, 1fr) auto; }
          .ewStrip { gap: 4px; }
        }
        /* THE STRIP AT 320 px: the tiles bleed into the card's padding and the
           date steps down to the fine size, so "Mon" / "5 Oct" / the pill fit. */
        @media (max-width: 400px) {
          .ewCard { padding: 12px 10px; }
          .ewStrip { gap: 1px; margin: 0 -8px 18px; }
          .ewTile { padding: 6px 0; }
          .ewDate { font-size: var(--fs-fine); font-weight: 600; letter-spacing: -0.03em; }
          .ewPill { min-width: 0; padding: 1px 4px; }
        }
        @media (max-width: 360px) {
          .ewName { display: none; }
        }
      `}</style>
    </section>
  );
}
