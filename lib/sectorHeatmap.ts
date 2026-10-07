// THE /sector HEAT MAP'S ARITHMETIC (#553 COWORK #157 item 1). Pure: no React,
// no Redis, so scripts/check-sector-heatmap.mjs runs it on fixtures.
//
//   heatTiles     one tile per sector, from the figures the cards already show
//                 (no recomputing), sized by tracked market cap when the SEC
//                 caps cover the constituents well, otherwise by companies
//                 tracked -- and it says which.
//   squarify      the desktop treemap layout (Bruls, Huizing & van Wijk), in
//                 percentages of the box, so the server HTML carries it.
//   tileShade     green up / red down, intensity scaled to the move and capped
//                 at the second-largest move, so one big sector cannot wash
//                 out the rest. Dark enough everywhere for white text.

export type HeatPeriod = "day" | "month" | "ytd";

export const HEAT_PERIODS: { key: HeatPeriod; label: string }[] = [
  { key: "day", label: "Last close" },
  { key: "month", label: "1 month" },
  { key: "ytd", label: "Year to date" },
];

export const HEAT_DEFAULT_PERIOD: HeatPeriod = "ytd";

/**
 * Tracked cap counts as good coverage when, in EVERY sector, at least this
 * share of the constituents carries a cap. One thin sector would otherwise be
 * drawn too small for a reason that is about our data, not its size.
 */
export const HEAT_CAP_COVERAGE_MIN = 0.8;

export type HeatInputRow = {
  slug: string;
  name: string;
  href: string;
  companies: number;
  day: number | null;
  month: number | null;
  ytd: number | null;
  capSum?: number | null;
  capCovered?: number;
  constituents?: number;
};

/** `weight` is what the map draws (floored at HEAT_MIN_SHARE); `rawWeight` the measure. */
export type HeatTile = HeatInputRow & { weight: number; rawWeight: number };

export type HeatSizing = {
  basis: "cap" | "companies";
  /** The weakest sector's cap coverage, 0-1 (null when no caps at all). */
  minCoverage: number | null;
};

export function heatSizing(rows: HeatInputRow[]): HeatSizing {
  const coverages = rows.map((r) =>
    r.constituents && r.constituents > 0 && typeof r.capSum === "number" && r.capSum > 0
      ? (r.capCovered ?? 0) / r.constituents
      : 0
  );
  const minCoverage = rows.length ? Math.min(...coverages) : null;
  const basis = minCoverage != null && minCoverage >= HEAT_CAP_COVERAGE_MIN ? "cap" : "companies";
  return { basis, minCoverage };
}

/**
 * The smallest share of the map a tile may take. Below ~5% a sector's name,
 * return and count no longer fit (Real Estate and Utilities run near 1.5% of
 * tracked cap), so a tile is floored here and the fine print says the sizes
 * are approximate for the smallest sectors.
 */
export const HEAT_MIN_SHARE = 0.05;

/** Tiles, largest first (the treemap's input order). A tile never weighs 0. */
export function heatTiles(rows: HeatInputRow[], sizing: HeatSizing): HeatTile[] {
  const raw = rows.map((r) => Math.max(sizing.basis === "cap" ? r.capSum ?? 0 : r.companies, 1));
  const floor = raw.reduce((a, b) => a + b, 0) * HEAT_MIN_SHARE;
  return rows
    .map((r, i) => ({ ...r, rawWeight: raw[i], weight: Math.max(raw[i], floor) }))
    .sort((a, b) => b.weight - a.weight || b.rawWeight - a.rawWeight || a.name.localeCompare(b.name));
}

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Squarified treemap of `weights` (largest first) into a w x h box. Returns one
 * rect per weight, in input order, in the box's own units.
 */
export function squarify(weights: number[], w: number, h: number): Rect[] {
  const total = weights.reduce((a, b) => a + b, 0);
  const out: Rect[] = new Array(weights.length);
  if (!weights.length || total <= 0) return out.fill({ x: 0, y: 0, w: 0, h: 0 });
  const scale = (w * h) / total;
  const areas = weights.map((v) => v * scale);
  let x = 0;
  let y = 0;
  let width = w;
  let height = h;
  let i = 0;
  const worst = (row: number[], side: number) => {
    const sum = row.reduce((a, b) => a + b, 0);
    const max = Math.max(...row);
    const min = Math.min(...row);
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };
  while (i < areas.length) {
    const side = Math.min(width, height);
    const row = [areas[i]];
    let j = i + 1;
    while (j < areas.length && worst([...row, areas[j]], side) <= worst(row, side)) {
      row.push(areas[j]);
      j += 1;
    }
    const sum = row.reduce((a, b) => a + b, 0);
    if (width >= height) {
      // A column on the left.
      const colW = sum / height;
      let cy = y;
      row.forEach((a, k) => {
        const rh = a / colW;
        out[i + k] = { x, y: cy, w: colW, h: rh };
        cy += rh;
      });
      x += colW;
      width -= colW;
    } else {
      // A row along the top.
      const rowH = sum / width;
      let cx = x;
      row.forEach((a, k) => {
        const rw = a / rowH;
        out[i + k] = { x: cx, y, w: rw, h: rowH };
        cx += rw;
      });
      y += rowH;
      height -= rowH;
    }
    i = j;
  }
  return out;
}

/**
 * The moves' scale for one period: the second-largest absolute move (so only
 * the single biggest can saturate), never under 0.5 percentage points.
 */
export function heatScale(values: Array<number | null>): number {
  const abs = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).map(Math.abs).sort((a, b) => b - a);
  return Math.max(abs[1] ?? abs[0] ?? 0, 0.5);
}

/**
 * Moves inside this band (percentage points, either way) read as flat: slate,
 * not a faint green or red (#553 COWORK #180).
 */
export const HEAT_FLAT_BAND = 0.5;

/**
 * A tile's fill: hue by sign (green up, red down, slate for none or inside
 * HEAT_FLAT_BAND), a MUTED tint that deepens with |move| / scale, capped at 1
 * (#553 COWORK #180: the old 55-60% saturation at up to 30% lightness read as
 * loud full-tile colour). Saturation 18-42%, lightness 17-24%: white text stays
 * well above 4.5:1 on every shade.
 *
 * HIDDEN, NOT DELETED (2026-10-06, COWORK #180). Was: lightness 16% to 30%,
 * hsl(142, 55%, L) up and hsl(0, 60%, L) down, flat only at |move| < 0.005.
 */
export function tileShade(value: number | null, scale: number): { background: string; tone: "up" | "down" | "flat" } {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) < HEAT_FLAT_BAND) {
    return { background: "hsl(215, 20%, 18%)", tone: "flat" };
  }
  const t = Math.min(Math.abs(value) / scale, 1);
  const saturation = (18 + 24 * t).toFixed(1);
  const lightness = (17 + 7 * t).toFixed(1);
  return value > 0
    ? { background: `hsl(142, ${saturation}%, ${lightness}%)`, tone: "up" }
    : { background: `hsl(0, ${saturation}%, ${lightness}%)`, tone: "down" };
}

/**
 * A small tile's name (#553 COWORK #180): the count goes first, then the name
 * shortens; the % never does. Names without a short form keep their own.
 */
const SHORT_NAMES: Record<string, string> = {
  "Communication Services": "Comm. Services",
  "Financial Services": "Fin. Services",
  "Consumer Cyclical": "Cons. Cyclical",
  "Consumer Defensive": "Cons. Defensive",
  "Basic Materials": "Materials",
};
export function heatShortName(name: string): string {
  return SHORT_NAMES[name] ?? name;
}

export function formatHeatPct(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}
