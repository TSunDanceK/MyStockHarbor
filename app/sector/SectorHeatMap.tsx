"use client";

// THE /sector HEAT MAP (#553 COWORK #157 item 1). One tile per sector: a real
// link with its full text (name, the return, "N companies"), never SVG-only.
// Server-rendered on the default period (year to date); the toggle only swaps
// which of the three figures already on the page each tile shows and shades.
//
// Desktop: a squarified treemap. Its rects are computed on the server
// (lib/sectorHeatmap.ts) and travel as CSS variables, applied only above
// 640 px; at 320-640 px the same links flow as a 2-column grid, so names
// never wrap mid-word or clip and nothing scrolls sideways.
import { useState } from "react";
import Link from "next/link";
import {
  HEAT_DEFAULT_PERIOD,
  HEAT_PERIODS,
  formatHeatPct,
  heatScale,
  heatShortName,
  tileShade,
  type HeatPeriod,
  type HeatTile,
  type Rect,
} from "@/lib/sectorHeatmap";

export default function SectorHeatMap({
  tiles,
  rects,
  dayLabel,
  sizedBy,
  credit,
}: {
  tiles: HeatTile[];
  /** Percent rects of the treemap, one per tile, same order. */
  rects: Rect[];
  /** The "Last close" option's label, e.g. "Last close · 2 Oct". */
  dayLabel: string;
  sizedBy: string;
  /** "Market data from Tiingo.com" and its link (required wherever Tiingo figures show). */
  credit: { text: string; href: string };
}) {
  const [period, setPeriod] = useState<HeatPeriod>(HEAT_DEFAULT_PERIOD);
  const scale = heatScale(tiles.map((t) => t[period]));

  return (
    <section className="heatMap" aria-labelledby="heat-title">
      <div className="heatHead">
        <h2 id="heat-title" className="heatTitle">All 11 sectors</h2>
        <div className="heatToggle" role="group" aria-label="Period">
          {HEAT_PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={p.key === period ? "heatPeriod on" : "heatPeriod"}
              aria-pressed={p.key === period}
              onClick={() => setPeriod(p.key)}
            >
              {p.key === "day" ? dayLabel : p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="heatBox">
        {tiles.map((tile, i) => {
          const value = tile[period];
          const shade = tileShade(value, scale);
          const r = rects[i];
          return (
            <Link
              key={tile.slug}
              href={tile.href}
              className={`heatTile ${shade.tone}`}
              data-period-value={value ?? ""}
              style={{
                background: shade.background,
                ["--x" as string]: `${r.x}%`,
                ["--y" as string]: `${r.y}%`,
                ["--w" as string]: `${r.w}%`,
                ["--h" as string]: `${r.h}%`,
              }}
            >
              <span className="heatName">
                <span className="heatNameFull">{tile.name}</span>
                {heatShortName(tile.name) !== tile.name ? <span className="heatNameShort" aria-hidden="true">{heatShortName(tile.name)}</span> : null}
              </span>
              <span className="heatValue">{formatHeatPct(value)}</span>
              <span className="heatCount">{tile.companies} companies</span>
            </Link>
          );
        })}
      </div>

      <p className="heatFine" data-fine-print>
        Constituent-weighted, not index prints. Tiles sized by {sizedBy}; no tile is drawn under 5% of the map, so the smallest sectors are approximate.{" "}
        <a href={credit.href} target="_blank" rel="noopener noreferrer" className="heatCredit">{credit.text}</a>
      </p>

      <style>{`
        .heatMap { margin-top: 22px; }
        .heatHead { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        .heatTitle { margin: 0; font-size: 22px; font-weight: 900; letter-spacing: -0.03em; color: #f8fafc; }
        .heatToggle { display: inline-flex; flex-wrap: wrap; max-width: 100%; gap: 4px; padding: 3px; border-radius: 18px; border: 1px solid rgba(255,255,255,0.10); background: rgba(255,255,255,0.03); }
        .heatPeriod {
          min-height: 36px; padding: 6px 12px; border: 0; border-radius: 999px; cursor: pointer;
          background: none; color: rgba(226,232,240,0.78); font: inherit; font-size: var(--fs-label); font-weight: 750; white-space: nowrap;
        }
        .heatPeriod.on { background: rgba(56,189,248,0.16); color: #e0f2fe; box-shadow: inset 0 0 0 1px rgba(56,189,248,0.45); }
        .heatPeriod:focus-visible { outline: 2px solid #38bdf8; outline-offset: 2px; }
        .heatBox { margin-top: 12px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; }
        .heatTile {
          display: flex; flex-direction: column; justify-content: flex-end; gap: 1px; min-width: 0; min-height: 52px;
          padding: 6px 8px; border-radius: 10px; color: #fff; text-decoration: none;
          border: 1px solid rgba(255,255,255,0.06);
        }
        .heatTile:hover { filter: brightness(1.15); }
        .heatTile:focus-visible { outline: 2px solid #38bdf8; outline-offset: 2px; }
        .heatName { font-size: var(--fs-label); font-weight: 800; line-height: 1.2; overflow-wrap: normal; word-break: normal; hyphens: none; white-space: normal; }
        .heatValue { font-size: 15px; font-weight: 950; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
        .heatCount { font-size: var(--fs-label); font-weight: 600; color: rgba(255,255,255,0.82); }
        /* SMALL TILES (#553 COWORK #180): the count goes first, then the name
           shortens; the % never does. The full name stays in the link for
           screen readers (visually hidden, not removed). */
        .heatCount { display: none; }
        .heatNameFull { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
        .heatName .heatNameFull:only-child { position: static; width: auto; height: auto; overflow: visible; clip: auto; }
        .heatNameShort { display: inline; }
        .heatCredit { color: inherit; }
        .heatFine { margin: 10px 0 0; font-size: var(--fs-label); line-height: 1.5; color: rgba(241,245,249,0.6); }
        @media (max-width: 430px) { .heatPeriod { padding: 6px 9px; } }
        @media (min-width: 641px) {
          /* About half the old height (#553 COWORK #180): 4:1, ~260 px at 1280. */
          .heatBox { display: block; position: relative; aspect-ratio: 4 / 1; min-height: 210px; }
          .heatTile {
            position: absolute; left: calc(var(--x) + 2px); top: calc(var(--y) + 2px);
            width: calc(var(--w) - 4px); height: calc(var(--h) - 4px); min-height: 0; overflow: hidden;
            padding: 8px 10px; container-type: size;
          }
          .heatValue { font-size: 17px; }
          .heatCount { display: inline; }
          .heatNameShort { display: none; }
          .heatNameFull { position: static; width: auto; height: auto; overflow: visible; clip: auto; }
          @container (max-height: 74px) { .heatCount { display: none; } }
          @container (max-width: 150px) {
            .heatCount { display: none; }
            .heatName .heatNameShort { display: inline; }
            .heatName .heatNameFull:not(:only-child) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
          }
        }
      `}</style>
    </section>
  );
}
