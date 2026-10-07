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
//   names      short, with period tags (#563 COWORK #123), never wrapping:
//              "High" D W, "Low" D W M, "Close" last wk, "Open" M, "Prev
//              close", "Sep close"; the tap note says D = today, W = this
//              week, M = this month
//   merge      prices equal at 2 dp are one label ("High D M"); a label of
//              more than MERGE_PARTS_MAX names reads "All levels" (or "7
//              levels"), and the fine print names them (a thin stock's flat
//              run put eleven names on one price)
//   crowding   past CROWD_LABELS labels, levels within CROWD_PCT % of each
//              other (on one side of the last price) share a label ("Open D"
//              over "Prev close", each name on its own line), its price "~"
//              their mean; every level keeps its own tick
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

/** A label of more short names than this reads "All levels" / "n levels", and the fine print names them. */
export const MERGE_PARTS_MAX = 2;
/** Past this many level labels, levels within CROWD_PCT % of each other share one (#563 COWORK #123). */
export const CROWD_LABELS = 8;
export const CROWD_PCT = 0.15;

/** The period tags, in order, and what they stand for (the tap note's words). */
export const TAG_ORDER = ["D", "W", "M", "last wk"] as const;
export const TAG_NOTE = "On the pole, D = today (the latest session), W = this week, M = this month; \"last wk\" is last week's close.";
const SHORT: Record<string, [string, string]> = {
  "Day open": ["Open", "D"], "Day high": ["High", "D"], "Day low": ["Low", "D"],
  "Week open": ["Open", "W"], "Week high": ["High", "W"], "Week low": ["Low", "W"],
  "Month open": ["Open", "M"], "Month high": ["High", "M"], "Month low": ["Low", "M"],
  "Last week's close": ["Close", "last wk"],
};
export type LabelPart = { name: string; tags: string[] };
/** ["Day high", "Week high", "Prev close"] → [{ High, [D, W] }, { Prev close, [] }]. */
export function shortParts(names: readonly string[]): LabelPart[] {
  const out: LabelPart[] = [];
  for (const n of names) {
    const [name, tag] = SHORT[n] ?? [n, ""];
    const p = out.find((x) => x.name === name);
    if (p) { if (tag && !p.tags.includes(tag)) p.tags.push(tag); } else out.push({ name, tags: tag ? [tag] : [] });
  }
  const rank = (t: string) => TAG_ORDER.indexOf(t as (typeof TAG_ORDER)[number]);
  return out.map((p) => ({ name: p.name, tags: [...p.tags].sort((a, b) => rank(a) - rank(b)) }));
}
/** "High D W · Prev close". */
export const partsWords = (parts: readonly LabelPart[]) => parts.map((p) => (p.tags.length ? `${p.name} ${p.tags.join(" ")}` : p.name)).join(" · ");

export const POLE_KEY = "Green: above the last price · red: below · thick band: today's range · thin: this month's";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** Equal at 2 dp (#115): one label. */
export const samePrice = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

export type PoleSide = "up" | "down" | "at";
export type PoleLevel = {
  /** Every name the price carries, in order: ["Day high", "Month high"]. */
  names: string[];
  /** "High D M"; "All levels" / "7 levels" past MERGE_PARTS_MAX names. */
  label: string;
  /** The label's short names and tags, to draw ([] for a short "All levels" label and the last price). */
  parts: LabelPart[];
  /** Every name in words, whatever the label: "Day & Month high". */
  full: string;
  /** The level's price, or "~" their mean when crowded levels share the label: "~117.18". */
  valueText: string;
  /** Each level behind the label, with its own tick height (rem) — more than one only for a crowded label. */
  members: { names: string[]; value: number; y: number }[];
  value: number;
  side: PoleSide;
  /** "+0.98%" / "−0.37%" from the last price (a crowded label's from their mean). */
  dist: string;
  /** The tick's true height and the label's placed height, in rem from the pole's top. */
  y: number;
  ly: number;
  /** True for the last price's row (the pill). */
  last?: boolean;
  /** True for the insight page's "level discussed" (#563 COWORK #139): its own row, drawn gold, never merged. */
  discussed?: boolean;
};

/** A post's level discussed (#563 COWORK #139): "200-day" at its value today. */
export type DiscussedLevel = { label: string; value: number };
/**
 * How far past the pole's own range (as a share of that range) the level
 * discussed may sit and still get a tick; beyond it, the pole stays to scale
 * and the level is a marker at its end ("↓ 200-day $241.51 (−3.9%)").
 */
export const DISCUSSED_REACH = 0.5;

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
  /** The names behind a short label, for the fine print: "All levels = 11.24: Day open, …", or null. */
  merged: string | null;
  last: number;
  /** The level discussed when it lies past DISCUSSED_REACH: the marker at the pole's end. Null otherwise. */
  offPole: { label: string; value: number; dist: string; above: boolean } | null;
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
 * [edge, height − bottom] (bottom defaults to edge): down, then up (#115). `gap` is one number, or one per
 * label (gap[i] is the room label i needs below label i − 1; gap[0] is unused).
 */
export function stackLabels(ys: readonly number[], gap: number | readonly number[], height: number, edge = EDGE_REM, bottom = edge): number[] {
  const g = (i: number) => (typeof gap === "number" ? gap : gap[i]);
  const out = ys.map((y) => Math.min(Math.max(y, edge), height - edge));
  for (let i = 1; i < out.length; i++) if (out[i] < out[i - 1] + g(i)) out[i] = out[i - 1] + g(i);
  if (out.length && out[out.length - 1] > height - bottom) out[out.length - 1] = height - bottom;
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
export function keyLevelPole(k: KeyLevels, last: number | null | undefined, gap = LABEL_GAP_REM, heights?: Readonly<Record<string, number>>, discussed?: DiscussedLevel | null): Pole | null {
  if (!k.asOf || !fin(last) || last <= 0) return null;
  const { list, skipped } = poleLevels(k);
  // MERGE: one label per price (2 dp). A level equal to the last price keeps its own label, muted.
  const merged: { names: string[]; value: number }[] = [];
  for (const l of list) {
    const m = merged.find((x) => samePrice(x.value, l.value));
    if (m) { if (!m.names.includes(l.name)) m.names.push(l.name); } else merged.push({ names: [l.name], value: l.value });
  }
  // CROWDING (#563 COWORK #123): past CROWD_LABELS labels, levels within CROWD_PCT % share one, never across the last price.
  let groups = merged.map((m) => ({ names: [...m.names], members: [{ names: m.names, value: m.value }] }));
  if (groups.length > CROWD_LABELS) {
    const out: typeof groups = [];
    for (const g of [...groups].sort((a, b) => b.members[0].value - a.members[0].value)) {
      const prev = out[out.length - 1], v = g.members[0].value;
      const top = prev ? prev.members[0].value : 0;
      if (prev && ((top - v) / last) * 100 < CROWD_PCT && (top > last) === (v > last) && !samePrice(v, last) && !samePrice(top, last)) {
        prev.names.push(...g.names); prev.members.push(...g.members);
      } else out.push(g);
    }
    groups = out;
  }
  const day = k.periods.find((p) => p.key === "day"), month = k.periods.find((p) => p.key === "month");
  const dayLo = day?.levels.low.value, dayHi = day?.levels.high.value;
  const monthOk = month && !month.reason;
  const monLo = monthOk ? month.levels.low.value : dayLo, monHi = monthOk ? month.levels.high.value : dayHi;
  const all = [last, ...merged.map((m) => m.value), ...[dayLo, dayHi, monLo, monHi].filter(fin)];
  let lo = Math.min(...all), hi = Math.max(...all);
  // THE LEVEL DISCUSSED: on the pole when it is near its range, else a marker at the end.
  const base = hi - lo || last * 0.01;
  const dIn = !!discussed && fin(discussed.value) && discussed.value > 0 && discussed.value >= lo - base * DISCUSSED_REACH && discussed.value <= hi + base * DISCUSSED_REACH;
  if (dIn) { lo = Math.min(lo, discussed!.value); hi = Math.max(hi, discussed!.value); }
  const offPole = discussed && !dIn && fin(discussed.value) && discussed.value > 0
    ? { label: discussed.label, value: discussed.value, dist: distWords(discussed.value, last), above: discussed.value > last } : null;
  const span = hi - lo || last * 0.01;
  lo -= span * PAD_FRACTION; hi += span * PAD_FRACTION;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  type Row0 = { names: string[]; value: number; last: boolean; members: { names: string[]; value: number }[]; discussed?: boolean };
  const rows0: Row0[] = [
    ...groups.map((g) => ({ names: g.names, value: mean(g.members.map((m) => m.value)), last: false, members: g.members })),
    { names: ["Last price"], value: last, last: true, members: [] },
    ...(dIn ? [{ names: [discussed!.label], value: discussed!.value, last: false, members: [{ names: [discussed!.label], value: discussed!.value }], discussed: true }] : []),
  ].sort((a, b) => b.value - a.value || (a.last ? -1 : 1));
  const all1 = merged.length === 1;
  const partsOf = (r: Row0) => (r.last ? [] : r.discussed ? [{ name: r.names[0], tags: [] }] : shortParts(r.names));
  const labelOf = (r: Row0) => {
    if (r.last) return "Last price";
    if (r.discussed) return r.names[0];
    const parts = partsOf(r);
    return parts.length > MERGE_PARTS_MAX ? (all1 ? "All levels" : `${r.names.length} levels`) : partsWords(parts);
  };
  const gaps = rows0.map((_, i) => (i === 0 ? 0 : Math.max(gap, (heights?.[labelOf(rows0[i - 1])] ?? 0) + LABEL_AIR_REM)));
  // The last label hangs below its line by its measured height: the pole makes room for it, so it never runs out.
  const bottom = Math.max(EDGE_REM, (heights?.[labelOf(rows0[rows0.length - 1])] ?? 0) - LABEL_LINE_REM / 2 + LABEL_AIR_REM);
  const sum = gaps.reduce((a, b) => a + b, 0);
  const height = Math.max(POLE_REM, Math.round(Math.max(sum + gap + 2 * EDGE_REM, sum + EDGE_REM + bottom) * 1000) / 1000);
  const y = (v: number) => ((hi - v) / (hi - lo)) * height;
  const ys = stackLabels(rows0.map((r) => y(r.value)), gaps, height, EDGE_REM, bottom);
  const rows: PoleLevel[] = rows0.map((r, i) => {
    const label = labelOf(r), vals = r.members.map((m) => m.value), crowded = r.members.length > 1;
    return {
      names: r.names, label, parts: r.last || /levels$/.test(label) ? [] : partsOf(r), full: r.last ? "Last price" : mergeNames(r.names), value: r.value,
      valueText: crowded && !samePrice(Math.min(...vals), Math.max(...vals)) ? `~${poleNumber(r.value)}` : poleNumber(r.value),
      members: r.members.map((m) => ({ names: m.names, value: m.value, y: y(m.value) })),
      side: r.last ? "at" : samePrice(r.value, last) ? "at" : r.value > last ? "up" : "down",
      dist: distWords(r.value, last), y: y(r.value), ly: ys[i], ...(r.last ? { last: true } : {}), ...(r.discussed ? { discussed: true } : {}),
    };
  });
  const band = (a: number | null | undefined, b: number | null | undefined) => (fin(a) && fin(b) ? { top: y(Math.max(a, b)), bottom: y(Math.min(a, b)) } : null);
  const short = rows.filter((r) => !r.last && /levels$/.test(r.label));
  const mergedWords = short.length ? short.map((r) => `${r.label} = ${poleNumber(r.value)}: ${r.names.join(", ")}`).join(" · ") : null;
  return { height, lo, hi, rows, month: band(monLo, monHi), day: band(dayLo, dayHi), skipped, merged: mergedWords, last, offPole };
}

/** The card's levels and pole in one call, from the bars it already holds. */
export function poleFromBars(bars: readonly KeyBar[], last: number | null | undefined, nowMs?: number, gap?: number) {
  const k = keyLevels(bars, { nowMs });
  const ref = fin(last) && last > 0 ? last : k.lastClose;
  return { k, ref, pole: keyLevelPole(k, ref, gap) };
}

/** The visually hidden list, in price order: "Day high $336.19, 0.98% above the last price". */
export function poleListWords(p: Pole): string[] {
  const at = (v: number) => {
    const d = distWords(v, p.last);
    return samePrice(v, p.last) ? "at the last price" : `${d.replace(/^[+−]/, "")} ${v > p.last ? "above" : "below"} the last price`;
  };
  // A crowded label lists each of its levels on its own line.
  return p.rows.flatMap((r) => (r.last ? [`Last price ${priceWords(r.value)}`] : r.members.map((m) => `${mergeNames(m.names)} ${priceWords(m.value)}, ${at(m.value)}`)));
}
