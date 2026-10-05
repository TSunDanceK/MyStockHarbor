// THE KEY LEVELS POLE (#563 COWORK #115, the owner's pick "E1, true scale"):
// the day's, this week's and this month's levels as named ticks on ONE vertical
// price pole, drawn to true price scale, so every level can be compared with
// every other and with the last price at a glance.
//
//   bands      a thin track over this month's low–high; a thicker, lighter
//              band over today's low–high
//   last       an accent bar across the pole and a highlighted pill
//   levels     Day open/high/low; Prev close (the session before the latest);
//              Week open/high/low and last week's close; Month open/high/low
//              and last month's close, named for its month ("Sep close").
//              The Week is skipped when it is only the latest session (its
//              first), and so is the Month; the fine print says so ("Week =
//              today so far" while live, "Week = the latest session" otherwise)
//   merge      prices equal at 2 dp are one label: "Day & Month high"
//   side       green above the last price, red below, muted level with it
//   labels     at least `gap` apart (two passes, down then up, inside the
//              pole); a label off its tick's height gets a leader line, so
//              every tick stays at its true height
//
// Pure: the card's own levels in (lib/ta/keyLevels.ts over the bars the page
// already holds), positions in rem out. No fetch. Copy describes, never advises.
import { keyLevels, priceWords, type KeyBar, type KeyLevels } from "./keyLevels";

/** The pole's drawn height, in rem (#115: about 22–24 rem). Taller only when the labels need it. */
export const POLE_REM = 23;
/** The label line height, in rem (--fs-label at 1.25), and the minimum gap between labels: 1.4× it. */
export const LABEL_LINE_REM = 0.8125 * 1.25;
export const LABEL_GAP_REM = Math.round(LABEL_LINE_REM * 1.4 * 1000) / 1000;
/** The scale runs a little past the month's range (and the levels), so nothing sits on the pole's ends. */
export const PAD_FRACTION = 0.06;
/** The labels stay this far inside the pole's ends, in rem. */
export const EDGE_REM = 0.7;

export const POLE_KEY = "Green: above the last price · red: below · thick band: today's range · thin: this month's";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** Equal at 2 dp (#115): one label. */
export const samePrice = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

export type PoleSide = "up" | "down" | "at";
export type PoleLevel = {
  /** Every name the price carries, in order: ["Day high", "Month high"]. */
  names: string[];
  /** "Day & Month high". */
  label: string;
  value: number;
  side: PoleSide;
  /** "+0.98%" / "−0.37%" from the last price. */
  dist: string;
  /** The tick's true height and the label's placed height, in rem from the pole's top. */
  y: number;
  ly: number;
  /** True for the last price's row (the pill). */
  last?: boolean;
};

export type Pole = {
  /** The pole's height in rem. */
  height: number;
  /** Price → rem from the top. */
  lo: number;
  hi: number;
  /** Rows, top (highest price) first, the last price's row among them. */
  rows: PoleLevel[];
  /** The bands, as rem from the top: the month's (thin) and today's (thick). */
  month: { top: number; bottom: number } | null;
  day: { top: number; bottom: number } | null;
  /** "Week = today so far" (and the Month on its first session), or null. */
  skipped: string | null;
  last: number;
};

/** A price on the pole as the owner's mock-up prints it, without the dollar sign: "336.19" (priceWords' precision). */
export const poleNumber = (v: number) => priceWords(v).replace(/^\$/, "");

/** "+0.98%", "−0.37%", "0.00%". */
export function distWords(v: number, last: number): string {
  const d = ((v - last) / last) * 100;
  const r = Math.round(Math.abs(d) * 100) / 100;
  return r === 0 ? "0.00%" : `${d > 0 ? "+" : "−"}${r.toFixed(2)}%`;
}

/** "Day high" + "Month high" → "Day & Month high"; otherwise the names joined with " & ". */
export function mergeNames(names: readonly string[]): string {
  if (names.length === 1) return names[0];
  const split = names.map((n) => { const i = n.lastIndexOf(" "); return i > 0 ? [n.slice(0, i), n.slice(i + 1)] : [n, ""]; });
  const tail = split[0][1];
  if (tail && split.every(([, t]) => t === tail)) return `${split.map(([h]) => h).join(" & ")} ${tail}`;
  return names.join(" & ");
}

/**
 * The labels in order, each at least its gap below the one above, inside
 * [edge, height − edge]: down, then up (#115). `gap` is one number, or one per
 * label (gap[i] is the room label i needs below label i − 1; gap[0] is unused).
 */
export function stackLabels(ys: readonly number[], gap: number | readonly number[], height: number, edge = EDGE_REM): number[] {
  const g = (i: number) => (typeof gap === "number" ? gap : gap[i]);
  const out = ys.map((y) => Math.min(Math.max(y, edge), height - edge));
  for (let i = 1; i < out.length; i++) if (out[i] < out[i - 1] + g(i)) out[i] = out[i - 1] + g(i);
  if (out.length && out[out.length - 1] > height - edge) out[out.length - 1] = height - edge;
  for (let i = out.length - 2; i >= 0; i--) if (out[i] > out[i + 1] - g(i + 1)) out[i] = out[i + 1] - g(i + 1);
  return out;
}

/** The room between two labels: the minimum gap, or the upper label's measured height and a little air, whichever is more. */
export const LABEL_AIR_REM = 0.35;

/** The levels as named prices, before merging (#115's list), and what was skipped. */
export function poleLevels(k: KeyLevels): { list: { name: string; value: number }[]; skipped: string | null } {
  const list: { name: string; value: number }[] = [];
  const day = k.periods.find((p) => p.key === "day"), week = k.periods.find((p) => p.key === "week"), month = k.periods.find((p) => p.key === "month");
  const add = (name: string, v: number | null | undefined) => { if (fin(v) && v > 0) list.push({ name, value: v }); };
  if (day && !day.reason) {
    add("Day open", day.levels.open.value); add("Day high", day.levels.high.value); add("Day low", day.levels.low.value);
    add("Prev close", day.prevClose?.value);
  }
  // A period that began with the latest session is only today so far: skipped, and said so.
  const weekIsDay = !!week && !!day && !week.reason && week.from === day.from;
  const monthIsDay = !!month && !!day && !month.reason && month.from === day.from;
  if (week && !week.reason && !weekIsDay) {
    add("Week open", week.levels.open.value); add("Week high", week.levels.high.value); add("Week low", week.levels.low.value);
    add("Last week's close", week.prevClose?.value);
  }
  if (month && !month.reason && !monthIsDay) {
    add("Month open", month.levels.open.value); add("Month high", month.levels.high.value); add("Month low", month.levels.low.value);
    if (month.prevClose) add(`${MONTH_NAMES[Number(month.prevClose.date.slice(5, 7)) - 1]} close`, month.prevClose.value);
  }
  // "today so far" while the latest session is live; otherwise it is the latest (completed) session.
  const only = k.live ? "today so far" : "the latest session";
  const skipped = weekIsDay && monthIsDay ? `Week and Month = ${only}` : weekIsDay ? `Week = ${only}` : monthIsDay ? `Month = ${only}` : null;
  return { list, skipped };
}

/**
 * The pole from the card's levels and the last price. Labels are at least `gap`
 * rem apart; `heights` (rem, by label, measured by the card after mount) lets a
 * label that wrapped push the next one down by its own height, and only it.
 * Null without levels or a price.
 */
export function keyLevelPole(k: KeyLevels, last: number | null | undefined, gap = LABEL_GAP_REM, heights?: Readonly<Record<string, number>>): Pole | null {
  if (!k.asOf || !fin(last) || last <= 0) return null;
  const { list, skipped } = poleLevels(k);
  // MERGE: one label per price (2 dp). A level equal to the last price keeps its own label, muted.
  const merged: { names: string[]; value: number }[] = [];
  for (const l of list) {
    const m = merged.find((x) => samePrice(x.value, l.value));
    if (m) { if (!m.names.includes(l.name)) m.names.push(l.name); } else merged.push({ names: [l.name], value: l.value });
  }
  const day = k.periods.find((p) => p.key === "day"), month = k.periods.find((p) => p.key === "month");
  const dayLo = day?.levels.low.value, dayHi = day?.levels.high.value;
  const monthOk = month && !month.reason;
  const monLo = monthOk ? month.levels.low.value : dayLo, monHi = monthOk ? month.levels.high.value : dayHi;
  const all = [last, ...merged.map((m) => m.value), ...[dayLo, dayHi, monLo, monHi].filter(fin)];
  let lo = Math.min(...all), hi = Math.max(...all);
  const span = hi - lo || last * 0.01;
  lo -= span * PAD_FRACTION; hi += span * PAD_FRACTION;
  const rows0 = [...merged.map((m) => ({ names: m.names, value: m.value, last: false })), { names: ["Last price"], value: last, last: true }]
    .sort((a, b) => b.value - a.value || (a.last ? -1 : 1));
  const labelOf = (r: { names: string[]; last: boolean }) => (r.last ? "Last price" : mergeNames(r.names));
  const gaps = rows0.map((_, i) => (i === 0 ? 0 : Math.max(gap, (heights?.[labelOf(rows0[i - 1])] ?? 0) + LABEL_AIR_REM)));
  const height = Math.max(POLE_REM, Math.round((gaps.reduce((a, b) => a + b, 0) + gap + 2 * EDGE_REM) * 1000) / 1000);
  const y = (v: number) => ((hi - v) / (hi - lo)) * height;
  const ys = stackLabels(rows0.map((r) => y(r.value)), gaps, height);
  const rows: PoleLevel[] = rows0.map((r, i) => ({
    names: r.names, label: labelOf(r), value: r.value,
    side: r.last ? "at" : samePrice(r.value, last) ? "at" : r.value > last ? "up" : "down",
    dist: distWords(r.value, last), y: y(r.value), ly: ys[i], ...(r.last ? { last: true } : {}),
  }));
  const band = (a: number | null | undefined, b: number | null | undefined) => (fin(a) && fin(b) ? { top: y(Math.max(a, b)), bottom: y(Math.min(a, b)) } : null);
  return { height, lo, hi, rows, month: band(monLo, monHi), day: band(dayLo, dayHi), skipped, last };
}

/** The card's levels and pole in one call, from the bars it already holds. */
export function poleFromBars(bars: readonly KeyBar[], last: number | null | undefined, nowMs?: number, gap?: number) {
  const k = keyLevels(bars, { nowMs });
  const ref = fin(last) && last > 0 ? last : k.lastClose;
  return { k, ref, pole: keyLevelPole(k, ref, gap) };
}

/** The visually hidden list, in price order: "Day high $336.19, 0.98% above the last price". */
export function poleListWords(p: Pole): string[] {
  return p.rows.map((r) => r.last ? `Last price ${priceWords(r.value)}` : `${r.label} ${priceWords(r.value)}, ${r.side === "at" ? "at the last price" : `${r.dist.replace(/^[+−]/, "")} ${r.side === "up" ? "above" : "below"} the last price`}`);
}
