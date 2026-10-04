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
//              last week's close, last month's close. Outside the range (a
//              gap) it is pinned just beyond the edge it lies past, with an
//              arrow and its distance ("prev close 1.8% below the low").
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

export type PrevMark = {
  /** Its place in the row's range, in % (0 = the low, 100 = the high); null when pinned outside. */
  pos: number | null;
  /** Past which edge it is pinned when outside the range, or null when inside. */
  pinned: "left" | "right" | null;
  /** "prev close 1.8% below the low" when pinned; null when inside. */
  gapWords: string | null;
};

export type BarRow = {
  key: PeriodKey;
  title: string;
  /** "2 Oct", "from 28 Sep", "today so far · 14:32 ET", "today · close 16:00 ET (IEX)"; null when withheld. */
  since: string | null;
  /** The bar, or null when the period (or its low or high) can't be built. */
  bar: {
    /** True when the high equals the low: the marks sit centred, and the note says "no range yet". */
    flat: boolean;
    /** The open's tick, in % of the row's range, or null when the open isn't on file. */
    open: number | null;
    /** The last price, in % of the row's range (held to 0–100: a price past the range sits at the edge, and the note says so). */
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

/** The previous close in a row: at its place in the range, or pinned past an edge with its distance from it. */
export function prevMark(v: number, low: number, high: number): PrevMark {
  if (v < low) return { pos: null, pinned: "left", gapWords: `prev close ${((low - v) / low * 100).toFixed(1)}% below the low` };
  if (v > high) return { pos: null, pinned: "right", gapWords: `prev close ${((v - high) / high * 100).toFixed(1)}% above the high` };
  return { pos: rowPct(v, low, high), pinned: null, gapWords: null };
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
    const prev = p.prevClose ? prevMark(p.prevClose.value, sp.low, sp.high) : null;
    const raw = rowPct(last, sp.low, sp.high);
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
        open: isNum(open) ? rowPct(open, sp.low, sp.high) : null,
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
