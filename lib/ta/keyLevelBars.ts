// THE KEY LEVELS AS RANGE BARS (#563 COWORK #66/#67): presentation geometry
// over lib/ta/keyLevels.ts, which is unchanged. Pure, so the check can drive it.
//
// One row per period (Day, Week, Month). Each bar runs from the period's low
// (left) to its high (right). A tick marks where the period opened and a dot
// marks the last price. All three rows share ONE price scale, from the lowest
// low to the highest high of the periods drawn (the month's, when it is built),
// stretched to take in the last price and padded slightly. So the Day bar sits
// inside the Week bar, and the Week inside the Month: that nesting is the
// point.
//
// COLOUR DESCRIBES, IT NEVER CALLS: green when the last price is above the
// period's open, red when below, neutral within a hair. Like a candle on its
// side. It is never the only cue: the dot's place against the tick says the
// same thing, and the tap note says it in words.
import {
  AT_PRICE_BELOW_PCT, PERIOD_WORDS, dateWords, distanceWords, priceWords, shortDate,
  type KeyLevels, type PeriodKey, type PeriodLevels,
} from "./keyLevels";

/** Padding either side of the shared scale, as a share of its span. */
export const SCALE_PAD = 0.04;
/** The padding when every level is the same price: this share of that price. */
export const FLAT_SCALE_PAD = 0.01;
/** Within this % of the open, the last price is "level with" it: neutral colour. */
export const LEVEL_WITH_OPEN_PCT = AT_PRICE_BELOW_PCT;

export type Tone = "up" | "down" | "flat";
export const TONE_WORDS: Record<Tone, string> = {
  up: "The last price is above this period's open.",
  down: "The last price is below this period's open.",
  flat: "The last price is level with this period's open.",
};

export type Scale = { min: number; max: number };

export type BarRow = {
  key: PeriodKey;
  title: string;
  /** "2 Oct" for the day, "from 28 Sep" for the week and month; null when withheld. */
  since: string | null;
  /** The bar, or null when the period (or its low or high) can't be built. */
  bar: {
    /** Positions on the shared scale, in % of the track. */
    left: number;
    width: number;
    /** The open's tick, or null when the open isn't on file. */
    open: number | null;
    dot: number;
    tone: Tone;
    /** "330.61 – 334.54": the low and high, printed small. */
    range: string;
    /** The tap note: exact open/high/low, each against the last price, and the open's day. */
    note: string;
  } | null;
  /** Why there is no bar, or null. */
  reason: string | null;
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A low and high for the period, or null when either is missing. */
function span(p: PeriodLevels): { low: number; high: number } | null {
  const low = p.levels.low.value, high = p.levels.high.value;
  return isNum(low) && isNum(high) ? { low, high } : null;
}

/** The one scale all three rows share, or null when no row can be drawn. */
export function sharedScale(k: KeyLevels, last: number): Scale | null {
  const spans = k.periods.map(span).filter((s): s is { low: number; high: number } => s !== null);
  if (!spans.length) return null;
  const vals = spans.flatMap((s) => [s.low, s.high]);
  if (isNum(last)) vals.push(last);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = hi > lo ? (hi - lo) * SCALE_PAD : Math.abs(hi) * FLAT_SCALE_PAD || 1;
  return { min: lo - pad, max: hi + pad };
}

/** A price's place on the scale, in % of the track (0 = left). */
export function toPct(v: number, s: Scale): number {
  return ((v - s.min) / (s.max - s.min)) * 100;
}

/** Green above the open, red below, neutral within a hair. */
export function toneOf(last: number, open: number | null): Tone {
  if (!isNum(open) || open <= 0 || !isNum(last)) return "flat";
  const pct = ((last - open) / open) * 100;
  if (Math.abs(pct) < LEVEL_WITH_OPEN_PCT) return "flat";
  return pct > 0 ? "up" : "down";
}

/** A price without its "$", for the small low–high labels: "330.61", "24,240". */
export const bare = (v: number) => priceWords(v).replace(/^\$/, "");

/** "$340.37, 2.0% above the last price" */
function against(v: number, last: number): string {
  const d = distanceWords(v, last);
  return `${priceWords(v)}${d ? `, ${d === "at the last price" ? d : `${d} the last price`}` : ""}`;
}

/** "Mon 28 Sep": dateWords without the year. */
const dayWords = (date: string) => dateWords(date).replace(/ \d{4}$/, "");

/** The three rows on the shared scale. */
export function barRows(k: KeyLevels, last: number): BarRow[] {
  const s = sharedScale(k, last);
  return k.periods.map((p) => {
    const title = PERIOD_WORDS[p.key].title;
    const since = p.from ? (p.key === "day" ? shortDate(p.from) : `from ${shortDate(p.from)}`) : null;
    const sp = span(p);
    if (!s || !sp || !p.from) {
      const reason = p.reason ?? p.levels.low.reason ?? p.levels.high.reason ?? "This period can't be drawn from the prices on file.";
      return { key: p.key, title, since, bar: null, reason };
    }
    const open = p.levels.open.value;
    const tone = toneOf(last, open);
    const parts = [
      isNum(open) ? `Open ${against(open, last)}.` : p.levels.open.reason ?? "",
      `High ${against(sp.high, last)}.`,
      `Low ${against(sp.low, last)}.`,
      isNum(open) ? `Opened at ${priceWords(open)} on ${dayWords(p.from)}. ${TONE_WORDS[tone]}` : "",
    ].filter(Boolean);
    return {
      key: p.key,
      title,
      since,
      bar: {
        left: toPct(sp.low, s),
        width: toPct(sp.high, s) - toPct(sp.low, s),
        open: isNum(open) ? toPct(open, s) : null,
        dot: toPct(last, s),
        tone,
        range: `${bare(sp.low)} – ${bare(sp.high)}`,
        note: parts.join(" "),
      },
      reason: null,
    };
  });
}
