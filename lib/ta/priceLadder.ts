// THE STOCK PAGE'S "PRICE LEVELS" LADDER AND "SIGNALS" GAUGES (#563 COWORK
// #68): presentation geometry and words over figures the page already computes
// (the MA50 / MA200 / RSI (14) lines, buildMacd, computeMacroSupport). Pure: no
// calculation here changes a value. It only places values on a scale and words
// them.
//
// THE LADDER: one vertical price scale with the last price (the anchor), MA50,
// MA200 and the macro support zone (a band from its low to its high) at their
// real heights. Labels that would overlap are pushed apart to a minimum gap and
// joined to their true height by a short leader. A level below the last price
// and one above it are told apart by colour AND by position, and a key says so.
//
// THE GAUGES: RSI (14) on a 0–100 bar with the 30 and 70 bands; MACD as a
// state pill and one hedged line. "Bullish" / "Bearish" are gone (owner ruling,
// COWORK #68): they read as a call. The state is where the MACD line sits
// against its signal line, which is what the figure measures.
import { distanceWords, priceWords } from "./keyLevels";

/** Padding above and below the ladder's scale, as a share of its span. */
export const LADDER_PAD = 0.08;
/** The ladder's drawn height and the least room between two labels, in px. */
export const LADDER_HEIGHT = 240;
/** Each label is two lines (name, then value and distance), so this is its height plus a little air. */
export const LABEL_GAP = 34;

export type LadderSide = "anchor" | "below" | "above";

export type LadderInput = {
  last: number;
  ma50: number | null;
  ma200: number | null;
  zone: { lower: number; upper: number; touches: number; volumeRatio: number | null } | null;
};

export type LadderMark = {
  key: "last" | "ma50" | "ma200" | "zone";
  name: string;
  /** The price the mark sits at: the zone's middle for the band. */
  value: number;
  /** Its true height on the scale, in px from the top. */
  y: number;
  /** Where its label sits after stacking, in px from the top. */
  labelY: number;
  side: LadderSide;
  /** "$322.42 · 3.5% below", or "$333.69" for the anchor. Distances are from the last price (the key says so). */
  words: string;
  /** The band's top and bottom in px, for the zone only. */
  band: { top: number; bottom: number } | null;
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** The scale: lowest to highest of every value drawn, padded. Null without a price. */
export function ladderScale(input: LadderInput): { min: number; max: number } | null {
  if (!isNum(input.last)) return null;
  const vals = [input.last, input.ma50, input.ma200, input.zone?.lower, input.zone?.upper].filter(isNum);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = hi > lo ? (hi - lo) * LADDER_PAD : hi * 0.02;
  return { min: lo - pad, max: hi + pad };
}

/** A price's height on the ladder, in px from the top (the higher the price, the nearer the top). */
export function ladderY(v: number, s: { min: number; max: number }, height = LADDER_HEIGHT): number {
  return ((s.max - v) / (s.max - s.min)) * height;
}

/**
 * Labels pushed apart to at least `gap`, kept inside [edge, height − edge]
 * (a label is centred on its y, so `edge` keeps half of it from poking out),
 * in the marks' own order from the top. A forward pass pushes each label down
 * off the one above; a backward pass pulls the stack back up if it ran off the
 * bottom.
 */
export function stackLabels(ys: readonly number[], gap = LABEL_GAP, height = LADDER_HEIGHT, edge = 0): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y || a.i - b.i);
  const out = order.map((o) => Math.max(edge, o.y));
  for (let k = 1; k < out.length; k++) out[k] = Math.max(out[k], out[k - 1] + gap);
  if (out.length) out[out.length - 1] = Math.min(out[out.length - 1], height - edge);
  for (let k = out.length - 2; k >= 0; k--) out[k] = Math.min(out[k], out[k + 1] - gap);
  if (out.length && out[0] < edge) {
    out[0] = edge;
    for (let k = 1; k < out.length; k++) out[k] = Math.max(out[k], out[k - 1] + gap);
  }
  const placed = Array<number>(ys.length);
  order.forEach((o, k) => { placed[o.i] = out[k]; });
  return placed;
}

/** "3.5% below", "at the price": from the last price, which the key names once. */
function fromPrice(v: number, last: number): string {
  const d = distanceWords(v, last);
  if (!d) return "";
  return d === "at the last price" ? "at the price" : d;
}

const sideOf = (v: number, last: number): LadderSide => (v < last ? "below" : "above");

/** The ladder's marks, top to bottom as drawn, or [] without a price. */
export function ladderMarks(input: LadderInput, height = LADDER_HEIGHT): LadderMark[] {
  const s = ladderScale(input);
  if (!s) return [];
  const { last } = input;
  const marks: Omit<LadderMark, "labelY">[] = [
    { key: "last", name: "Last price", value: last, y: ladderY(last, s, height), side: "anchor", words: priceWords(last), band: null },
  ];
  if (isNum(input.ma50)) marks.push({ key: "ma50", name: "MA50", value: input.ma50, y: ladderY(input.ma50, s, height), side: sideOf(input.ma50, last), words: `${priceWords(input.ma50)} · ${fromPrice(input.ma50, last)}`, band: null });
  if (isNum(input.ma200)) marks.push({ key: "ma200", name: "MA200", value: input.ma200, y: ladderY(input.ma200, s, height), side: sideOf(input.ma200, last), words: `${priceWords(input.ma200)} · ${fromPrice(input.ma200, last)}`, band: null });
  const z = input.zone;
  if (z && isNum(z.lower) && isNum(z.upper)) {
    const mid = (z.lower + z.upper) / 2;
    // A band that holds the price reads "the price is inside the zone"; otherwise its near edge's distance.
    const inside = last >= z.lower && last <= z.upper;
    const edge = last > z.upper ? z.upper : z.lower;
    marks.push({
      key: "zone", name: "Macro support", value: mid, y: ladderY(mid, s, height),
      side: inside ? "anchor" : sideOf(mid, last),
      words: `${priceWords(z.lower)}–${priceWords(z.upper)} · ${inside ? "price inside" : fromPrice(edge, last)}`,
      band: { top: ladderY(z.upper, s, height), bottom: ladderY(z.lower, s, height) },
    });
  }
  const labelYs = stackLabels(marks.map((m) => m.y), LABEL_GAP, height, LABEL_GAP / 2);
  return marks.map((m, i) => ({ ...m, labelY: labelYs[i] })).sort((a, b) => a.y - b.y);
}

// ── Signals ────────────────────────────────────────────────────────────────

/** RSI's zone words: the page's own, unchanged. */
export function rsiZone(rsi: number): string {
  return rsi >= 70 ? "Overbought zone" : rsi <= 30 ? "Oversold zone" : "Neutral zone";
}

/** The RSI marker's place on the 0–100 bar, in %. */
export function rsiPct(rsi: number): number {
  return Math.max(0, Math.min(100, rsi));
}

export type MacdState = "above" | "below" | "near";
/** The page's buildMacd tone, read as where the MACD line sits against its signal line. */
export function macdState(tone: "green" | "yellow" | "red"): MacdState {
  return tone === "green" ? "above" : tone === "red" ? "below" : "near";
}
export const MACD_WORDS: Record<MacdState, { pill: string; line: string }> = {
  above: { pill: "Above signal", line: "Momentum above its signal line" },
  below: { pill: "Below signal", line: "Momentum below its signal line" },
  near: { pill: "Near signal", line: "Momentum near its signal line" },
};
