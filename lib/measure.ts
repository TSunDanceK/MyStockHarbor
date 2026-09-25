// The Interactive chart's measure tools, as maths (Relay B, #553 COWORK #28 part b).
//
// Three tools, each a custom klinecharts overlay (app/components/InteractiveChart.tsx
// draws them; this module only does the numbers and the label text):
//   - Price range:  the change in price between two points, in $ and %.
//   - Date range:   the span between two points, in bars and calendar days.
//   - Measure:      both (the default, and what Shift + drag draws).
//
// THE % BASE IS THE START POINT: the first point placed (or where a Shift-drag
// began). Measuring 100 -> 110 is +10%; measuring 110 -> 100 is -9.09%, not
// -10%, the same as a price moving from one to the other.
//
// Pure: no DOM, no chart. scripts/check-measure-tools.mjs runs it.

export type MeasureKind = "price" | "date" | "both";

/** A chart point, as klinecharts gives it (any field may be missing mid-draw). */
export type MeasurePoint = { value?: number; dataIndex?: number; timestamp?: number };

export type MeasureStats = {
  /** End price minus start price. */
  dPrice: number | null;
  /** dPrice as a % of the START price. */
  dPct: number | null;
  /** Bars from start to end (negative when drawn right to left). */
  bars: number | null;
  /** Calendar days from start to end, when both ends sit on real bars. */
  days: number | null;
  /** Whether the end is at or above the start (green), else red. */
  up: boolean;
};

const DAY_MS = 86_400_000;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function measureStats(a: MeasurePoint, b: MeasurePoint): MeasureStats {
  const dPrice = num(a.value) && num(b.value) ? b.value - a.value : null;
  const dPct = dPrice !== null && num(a.value) && a.value !== 0 ? (dPrice / Math.abs(a.value)) * 100 : null;
  const bars = num(a.dataIndex) && num(b.dataIndex) ? Math.round(b.dataIndex) - Math.round(a.dataIndex) : null;
  const days = num(a.timestamp) && num(b.timestamp) ? Math.round((b.timestamp - a.timestamp) / DAY_MS) : null;
  return { dPrice, dPct, bars, days, up: dPrice === null || dPrice >= 0 };
}

// A real minus sign lines up with "+" in the label.
const MINUS = "−";
function signed(v: number, digits: number): string {
  const s = Math.abs(v).toFixed(digits);
  if (Number(s) === 0) return s;
  return `${v < 0 ? MINUS : "+"}${s}`;
}
function count(n: number, one: string, many: string): string {
  const abs = Math.abs(n);
  return `${n < 0 ? MINUS : ""}${abs} ${abs === 1 ? one : many}`;
}

/** "+4.20 (+2.35%)" */
export function priceLabel(s: MeasureStats, pricePrecision = 2): string {
  if (s.dPrice === null) return "";
  const pct = s.dPct === null ? "" : ` (${signed(s.dPct, 2)}%)`;
  return `${signed(s.dPrice, pricePrecision)}${pct}`;
}

/** "18 bars · 26 days" (days left out past the last bar, where there is no date). */
export function dateLabel(s: MeasureStats): string {
  if (s.bars === null) return "";
  return s.days === null ? count(s.bars, "bar", "bars") : `${count(s.bars, "bar", "bars")} · ${count(s.days, "day", "days")}`;
}

/** The label lines a tool shows, top to bottom. */
export function measureLabel(kind: MeasureKind, s: MeasureStats, pricePrecision = 2): string[] {
  const lines = kind === "price" ? [priceLabel(s, pricePrecision)]
    : kind === "date" ? [dateLabel(s)]
    : [priceLabel(s, pricePrecision), dateLabel(s)];
  return lines.filter(Boolean);
}

/** The label colour: green up, red down; a date range has no direction, so blue. */
export const MEASURE_UP = "#22c55e";
export const MEASURE_DOWN = "#ef4444";
export const MEASURE_NEUTRAL = "#60a5fa";
export function measureColor(kind: MeasureKind, s: MeasureStats): string {
  if (kind === "date") return MEASURE_NEUTRAL;
  return s.up ? MEASURE_UP : MEASURE_DOWN;
}

/** The overlay names registered with klinecharts, and the menu entries. */
export const MEASURE_TOOLS: { key: MeasureKind; overlay: string; label: string }[] = [
  { key: "both", overlay: "mshMeasure", label: "Price & date (Measure)" },
  { key: "price", overlay: "mshPriceRange", label: "Price range" },
  { key: "date", overlay: "mshDateRange", label: "Date range" },
];
