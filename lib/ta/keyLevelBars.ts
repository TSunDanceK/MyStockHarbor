// THE KEY LEVELS AS RANGE BARS: presentation geometry over lib/ta/keyLevels.ts.
// Pure, so the check can drive it.
//
// EACH ROW ON ITS OWN SCALE (owner ruling, #563 COWORK #79; replaces the shared
// scale of #66/#78). One row per period (Day, Week, Month). The bar IS that
// period's low → high and fills the track: left edge = low, right edge = high.
// Within it, at their true positions in THAT row's range:
//   the dot    the last price, (last − low) / (high − low)
//   the tick   where the period opened
//   ◇          the previous period's close (#78): the session before the day,
//              last week's close, last month's close.
// A GAP IS EMPTY TRACK (owner change, #563 COWORK #81; replaces #79's pinned
// diamond): when the previous close lies outside the low–high range, the row's
// scale stretches to include it, min(low, prev) → max(high, prev). The coloured
// bar then spans only low → high, the ◇ sits at the stretched end, and the
// plain grey track between them is the size of the gap. The note under the row
// gives the exact figure ("prev close 1.8% below the low"). A gap too small to
// see (under MIN_GAP_PCT of the track) keeps the ◇ that far from the bar's end.
// So a price can sit near the week's low and the day's high at once, and the
// rows show it. A running period has an open but no close; the previous
// period's close is the useful "close" level.
//
// COLOUR DESCRIBES, IT NEVER CALLS: the dot is green when the last price is
// above the period's open, red when below, neutral within a hair. Never the
// only cue: the dot's place against the tick says the same, and the tap note
// says it in words.
import {
  AT_PRICE_BELOW_PCT, PERIOD_WORDS, PREV_WORDS, dateWords, distanceWords, priceWords, shortDate,
  type KeyLevels, type PeriodKey, type PeriodLevels,
} from "./keyLevels";

/** Within this % of the open, the last price is "level with" it: neutral colour. */
export const LEVEL_WITH_OPEN_PCT = AT_PRICE_BELOW_PCT;

export type Tone = "up" | "down" | "flat";
export const TONE_WORDS: Record<Tone, string> = {
  up: "The last price is above this period's open.",
  down: "The last price is below this period's open.",
  flat: "The last price is level with this period's open.",
};
export const FLAT_RANGE_WORDS = "No range yet: this period's high and low are the same price.";

/** A gap narrower than this % of the track still leaves the ◇ this far from the bar's end. */
export const MIN_GAP_PCT = 4;

export type PrevMark = {
  /** Its place on the row's scale, in % (0 = the left end, 100 = the right end). */
  pos: number;
  /** Which side of the range it lies on when it is a gap, or null when inside. */
  gap: "below" | "above" | null;
  /** "prev close 1.8% below the low" on a gap; null when inside. */
  gapWords: string | null;
};

/** A row's scale: the low–high range, stretched to take in a previous close outside it. */
export type RowScale = { lo: number; hi: number };

export type BarRow = {
  key: PeriodKey;
  title: string;
  /** "2 Oct", "from 28 Sep", "today so far · 14:32 ET", "today · close 16:00 ET (IEX)"; null when withheld. */
  since: string | null;
  /** The bar, or null when the period (or its low or high) can't be built. */
  bar: {
    /** True when the high equals the low: "no range yet". */
    flat: boolean;
    /** The coloured bar's ends (the low and the high), in % of the row's scale: 0 and 100 with no gap. */
    from: number;
    to: number;
    /** The open's tick, in % of the row's scale, or null when the open isn't on file. */
    open: number | null;
    /** The last price, in % of the row's scale (held to 0–100: a price past it sits at the edge, and the note says so). */
    dot: number;
    tone: Tone;
    /** The previous period's close, or null with the reason in the note. */
    prev: PrevMark | null;
    /** "330.61 – 334.54": the low and high, printed at the row's ends. */
    range: string;
    /** The tap note: exact open/high/low, the previous close, each against the last price. */
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

/** A price's place in a row's own range, in % (0 = low, 100 = high); 50 for a flat range. */
export function rowPct(v: number, low: number, high: number): number {
  return high > low ? ((v - low) / (high - low)) * 100 : 50;
}

/** Green above the open, red below, neutral within a hair. */
export function toneOf(last: number, open: number | null): Tone {
  if (!isNum(open) || open <= 0 || !isNum(last)) return "flat";
  const pct = ((last - open) / open) * 100;
  if (Math.abs(pct) < LEVEL_WITH_OPEN_PCT) return "flat";
  return pct > 0 ? "up" : "down";
}

/** "prev close 1.8% below the low" / "prev close 3.2% above the high"; null inside the range. */
export function gapWords(v: number, low: number, high: number): string | null {
  if (v < low) return `prev close ${((low - v) / low * 100).toFixed(1)}% below the low`;
  if (v > high) return `prev close ${((v - high) / high * 100).toFixed(1)}% above the high`;
  return null;
}

/**
 * The row's scale (#81): low → high, stretched to the previous close when it
 * lies outside. A gap under MIN_GAP_PCT of the track is widened to it, so the
 * ◇ never sits on the bar's end; the note carries the exact size.
 */
export function rowScale(low: number, high: number, prev: number | null): RowScale {
  if (prev === null || (prev >= low && prev <= high)) return { lo: low, hi: high };
  const m = MIN_GAP_PCT / 100;
  if (prev < low) return { lo: Math.min(prev, high > low ? (low - m * high) / (1 - m) : prev), hi: high };
  return { lo: low, hi: Math.max(prev, high > low ? (high - m * low) / (1 - m) : prev) };
}

/** The previous close on the row's scale: in place inside the range, at the stretched end on a gap. */
export function prevMark(v: number, low: number, high: number, sc: RowScale = rowScale(low, high, v)): PrevMark {
  const gap = v < low ? "below" : v > high ? "above" : null;
  const pos = gap === "below" ? 0 : gap === "above" ? 100 : rowPct(v, sc.lo, sc.hi);
  return { pos, gap, gapWords: gapWords(v, low, high) };
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

/** The three rows, each on its own scale. */
export function barRows(k: KeyLevels, last: number): BarRow[] {
  return k.periods.map((p) => {
    const title = PERIOD_WORDS[p.key].title;
    // TODAY (#563 COWORK #75/#77): the Day row says which, with the bar's own time.
    const liveDay = p.key === "day" && !!k.live;
    const t = k.live?.time ? ` ${k.live.time} ET` : "";
    const since = !p.from ? null
      : liveDay ? (k.live!.phase === "afterClose" ? `today · close${t} (IEX)` : `today so far${t ? ` ·${t}` : ""}`)
        : p.key === "day" ? shortDate(p.from) : `from ${shortDate(p.from)}`;
    const sp = span(p);
    if (!sp || !p.from) {
      const reason = p.reason ?? p.levels.low.reason ?? p.levels.high.reason ?? "This period can't be drawn from the prices on file.";
      return { key: p.key, title, since, bar: null, reason };
    }
    const flat = !(sp.high > sp.low);
    const open = p.levels.open.value;
    const tone = toneOf(last, open);
    const sc = rowScale(sp.low, sp.high, p.prevClose?.value ?? null);
    const at = (v: number) => rowPct(v, sc.lo, sc.hi);
    const prev = p.prevClose ? prevMark(p.prevClose.value, sp.low, sp.high, sc) : null;
    const raw = at(last);
    const outside = !flat && (last < sp.low ? "The last price is below this period's low." : last > sp.high ? "The last price is above this period's high." : "");
    const prevDist = p.prevClose ? distanceWords(p.prevClose.value, last) : null;
    const parts = [
      flat ? FLAT_RANGE_WORDS : "",
      isNum(open) ? `Open ${against(open, last)}.` : p.levels.open.reason ?? "",
      `High ${against(sp.high, last)}.`,
      `Low ${against(sp.low, last)}.`,
      p.prevClose
        ? `${PREV_WORDS[p.key]} ${priceWords(p.prevClose.value)} (${dayWords(p.prevClose.date)})${prevDist ? ` · ${prevDist === "at the last price" ? prevDist : `${prevDist} the last price`}` : ""}.`
        : p.prevReason ?? "",
      isNum(open) ? `Opened at ${priceWords(open)} ${liveDay ? "today" : `on ${dayWords(p.from)}`}. ${TONE_WORDS[tone]}` : "",
      outside || "",
    ].filter(Boolean);
    return {
      key: p.key,
      title,
      since,
      bar: {
        flat,
        from: sc.hi > sc.lo ? at(sp.low) : 0,
        to: sc.hi > sc.lo ? at(sp.high) : 100,
        open: isNum(open) ? at(open) : null,
        dot: Math.max(0, Math.min(100, raw)),
        tone,
        prev,
        range: `${bare(sp.low)} – ${bare(sp.high)}`,
        note: parts.join(" "),
      },
      reason: null,
    };
  });
}
