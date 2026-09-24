// The dashboard's "Selected Indicator Summary" (Relay B, #553 COWORK #38).
//
// WHEN EXACTLY ONE INDICATOR IS SELECTED the summary box shows a one-line LIVE
// READ of it, and the "Selected Indicators" card shows a short MANUAL.
//
// THE READ IS COMPUTED FROM THE PLOTTED SERIES -- the very arrays the chart
// draws, read at the last bar on screen -- so it always matches the chart. It
// follows the D / W / M timeframe ("days" / "weeks" / "months") because the
// series are rebuilt per timeframe, and any change to an indicator's inputs
// reaches it through the same arrays.
//
// COPY RULES (owner's standing rules): hedged ("may", "might", "some traders
// watch"), never an instruction (no buy / sell / consider), beginner-first and
// short. Too little history is said plainly: never NaN, never "n/a".
import { computeTrendHelper, TREND_HELPER_FAST, TREND_HELPER_SLOW } from "./ta/trendHelper";

export type ReadUnit = "day" | "week" | "month";
type Num = number | null | undefined;

export type ReadInput = {
  /** Close per bar for the whole timeframe history. */
  closes: Num[];
  /** Index of the last bar on screen: the read is "as of" this bar. */
  at: number;
  unit: ReadUnit;
  ma50?: Num[];
  ma200?: Num[];
  ema20?: Num[];
  vwma20?: Num[];
  bb?: { upper: Num[]; mid: Num[]; lower: Num[] };
  rsi?: Num[];
  macd?: { line: Num[]; signal: Num[]; hist: Num[] };
  stochK?: Num[];
  stochD?: Num[];
  atr?: Num[];
  atrAvg?: Num[];
  volume?: Num[];
  volumeAvg?: Num[];
  /** The one support / resistance zone the chart draws, if any. */
  zone?: { kind: "support" | "resistance"; lower: number; upper: number } | null;
};

const fin = (v: Num): v is number => typeof v === "number" && Number.isFinite(v);
const at = (s: Num[] | undefined, i: number): number | null => (s && i >= 0 && i < s.length && fin(s[i]) ? (s[i] as number) : null);

export function units(n: number, unit: ReadUnit): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}
/** "3 days ago", or "on the latest day" for the bar itself. */
export function ago(n: number, unit: ReadUnit): string {
  return n === 0 ? `on the latest ${unit}` : `${units(n, unit)} ago`;
}
function pct(v: number): string {
  const a = Math.abs(v);
  return `${a < 10 ? a.toFixed(1) : a.toFixed(0)}%`;
}
function money(v: number): string {
  return `$${v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(4)}`;
}
function barsAvailable(closes: Num[], i: number): number {
  let n = 0;
  for (let k = 0; k <= i && k < closes.length; k++) if (fin(closes[k])) n++;
  return n;
}
function notEnough(what: string, need: number, input: ReadInput): string {
  const have = barsAvailable(input.closes, input.at);
  return `There isn't enough history yet for ${what}: it needs about ${units(need, input.unit)} of prices and ${units(have, input.unit)} ${have === 1 ? "is" : "are"} available so far.`;
}

/** Consecutive bars, ending at i, over which the series kept rising (+n), falling (-n), or 0. */
export function slopeRun(s: Num[] | undefined, i: number): number {
  if (!s) return 0;
  const step = (k: number) => {
    const a = at(s, k), b = at(s, k - 1);
    if (a === null || b === null || a === b) return 0;
    return a > b ? 1 : -1;
  };
  const dir = step(i);
  if (!dir) return 0;
  let n = 0;
  for (let k = i; k > 0 && step(k) === dir; k--) n++;
  return dir * n;
}

/** Bars since the sign of (a - b) last changed, ending at i; null if never within the data. */
export function barsSinceCross(a: Num[] | undefined, b: Num[] | number | undefined, i: number): number | null {
  const diff = (k: number) => {
    const x = at(a, k);
    const y = typeof b === "number" ? b : at(b, k);
    return x === null || y === null ? null : Math.sign(x - y);
  };
  const now = diff(i);
  if (!now) return null;
  for (let k = i - 1; k >= 0; k--) {
    const d = diff(k);
    if (d === null) return null;
    if (d !== now) return i - k - 1;
  }
  return null;
}

function maRead(name: string, period: number, series: Num[] | undefined, input: ReadInput): string {
  const i = input.at;
  const c = at(input.closes, i), m = at(series, i);
  if (c === null || m === null || m === 0) return notEnough(`the ${name}`, period, input);
  const d = ((c - m) / m) * 100;
  const side = Math.abs(d) < 0.05 ? `right at the ${name}` : `${pct(d)} ${d > 0 ? "above" : "below"} the ${name}`;
  const run = slopeRun(series, i);
  const slope = run > 0 ? `, which has been rising for ${units(run, input.unit)}` : run < 0 ? `, which has been falling for ${units(-run, input.unit)}` : ", which is roughly flat";
  const cross = barsSinceCross(input.closes, series, i);
  const crossed = cross !== null && cross <= 5 ? ` Price moved ${d > 0 ? "above" : "below"} it ${ago(cross, input.unit)}.` : "";
  return `Price is ${side}${slope}.${crossed} Some traders watch it as possible support or resistance.`;
}

function trendHelperRead(preset: typeof TREND_HELPER_SLOW | typeof TREND_HELPER_FAST, input: ReadInput): string {
  const th = computeTrendHelper(input.closes.map((v) => (fin(v) ? v : null)), preset.trendLen, preset.confirmBars);
  const i = input.at;
  const state = th.state[i] ?? 0;
  const since = th.barsSinceFlip[i];
  const ma200 = at(input.ma200, i), c = at(input.closes, i);
  const slow = ma200 === null
    ? ` There isn't enough history yet for its purple slow line (MA200), which needs about ${units(200, input.unit)}.`
    : c !== null ? ` Price is ${c >= ma200 ? "above" : "below"} its purple slow line (MA200).` : "";
  if (state === 0 || since === null) {
    return `The helper line is still grey: there isn't enough history yet for it to confirm a direction.${slow}`;
  }
  const colour = state > 0 ? "blue" : "yellow";
  const way = state > 0 ? "upside" : "downside";
  if (th.isFirstConfirmation[i]) {
    return `The line has been ${colour} since it first formed ${units(since, input.unit)} ago, so it hasn't changed direction yet in this history.${slow}`;
  }
  if (since <= 10) {
    return `Turned ${colour} ${ago(since, input.unit)}. This may point to a possible change of trend to the ${way}.${slow}`;
  }
  return `The line has been ${colour} for ${units(since, input.unit)}, so the helper still reads the trend as ${state > 0 ? "up" : "down"}.${slow}`;
}

function bollingerRead(input: ReadInput): string {
  const i = input.at, bb = input.bb;
  const c = at(input.closes, i), u = at(bb?.upper, i), m = at(bb?.mid, i), l = at(bb?.lower, i);
  if (c === null || u === null || m === null || l === null || u <= l) return notEnough("Bollinger Bands", 20, input);
  const width = (u - l) / m;
  let where: string;
  if (c > u) where = "Price closed above the upper band, a band touch that some traders read as a stretched move";
  else if (c < l) where = "Price closed below the lower band, a band touch that some traders read as a stretched move";
  else {
    const p = (c - l) / (u - l);
    where = p >= 0.8 ? "Price is near the upper band" : p <= 0.2 ? "Price is near the lower band" : p >= 0.4 && p <= 0.6 ? "Price is near the middle band" : p > 0.5 ? "Price is between the middle and upper bands" : "Price is between the middle and lower bands";
  }
  // Width now against 20 bars ago, and against the recent range (a squeeze).
  const w = (k: number) => { const uu = at(bb?.upper, k), mm = at(bb?.mid, k), ll = at(bb?.lower, k); return uu !== null && mm !== null && ll !== null && mm !== 0 ? (uu - ll) / mm : null; };
  const back = Math.min(20, i);
  const then = w(i - back);
  let trend = "";
  if (then !== null && back >= 5) {
    const r = width / then;
    trend = r >= 1.15 ? `; the bands have widened over the last ${units(back, input.unit)}` : r <= 0.87 ? `; the bands have narrowed over the last ${units(back, input.unit)}` : "; the band width is about where it was " + `${units(back, input.unit)} ago`;
  }
  let lookback = 0, min = Infinity;
  for (let k = i; k >= 0 && lookback < 120; k--, lookback++) { const x = w(k); if (x === null) break; if (x < min) min = x; }
  const squeeze = lookback >= 60 && width <= min * 1.05
    ? ` The bands are near their narrowest in ${units(lookback, input.unit)}, a "squeeze" that some traders watch because quiet stretches may be followed by bigger moves.`
    : "";
  return `${where}${trend}.${squeeze}`;
}

function rsiRead(input: ReadInput): string {
  const i = input.at, r = at(input.rsi, i);
  if (r === null) return notEnough("RSI", 15, input);
  const zone = r >= 70 ? "above 70, the zone some traders call overbought" : r <= 30 ? "below 30, the zone some traders call oversold" : "between 30 and 70, the neutral zone";
  const back = Math.min(5, i), p = at(input.rsi, i - back);
  const dir = p === null || back < 1 ? "" : r - p >= 5 ? ` It has risen over the last ${units(back, input.unit)}.` : p - r >= 5 ? ` It has fallen over the last ${units(back, input.unit)}.` : "";
  return `RSI is ${r.toFixed(1)}, ${zone}.${dir}`;
}

function macdRead(input: ReadInput): string {
  const i = input.at, mc = input.macd;
  const line = at(mc?.line, i), sig = at(mc?.signal, i), hist = at(mc?.hist, i);
  if (line === null || sig === null || hist === null) return notEnough("MACD", 35, input);
  const cross = barsSinceCross(mc?.line, mc?.signal, i);
  const rel = hist > 0 ? "above" : hist < 0 ? "below" : "level with";
  const when = cross !== null && hist !== 0 ? ` It moved ${rel} it ${ago(cross, input.unit)}.` : "";
  const zero = ` Both lines are ${line > 0 && sig > 0 ? "above" : line < 0 && sig < 0 ? "below" : "around"} zero.`;
  const lean = hist > 0 ? " Some traders read this as upward momentum." : hist < 0 ? " Some traders read this as downward momentum." : "";
  return `The MACD line is ${rel} its signal line.${when}${zero}${lean}`;
}

function stochRead(input: ReadInput): string {
  const i = input.at, k = at(input.stochK, i), d = at(input.stochD, i);
  if (k === null) return notEnough("the Stochastic", 17, input);
  const zone = k >= 80 ? "above 80, the zone some traders call overbought" : k <= 20 ? "below 20, the zone some traders call oversold" : "between 20 and 80";
  const cross = d === null ? null : barsSinceCross(input.stochK, input.stochD, i);
  const kd = d === null ? "" : ` The fast line (%K) is ${k >= d ? "above" : "below"} the slow line (%D)${cross !== null && cross <= 5 ? `, having crossed ${ago(cross, input.unit)}` : ""}.`;
  return `The Stochastic is ${k.toFixed(1)}, ${zone}.${kd}`;
}

function atrRead(input: ReadInput): string {
  const i = input.at, a = at(input.atr, i), avg = at(input.atrAvg, i), c = at(input.closes, i);
  if (a === null || c === null || c === 0) return notEnough("ATR", 15, input);
  const size = `ATR is ${money(a)}, about ${pct((a / c) * 100)} of the price: a typical ${input.unit}'s range.`;
  if (avg === null || avg === 0) return size;
  const r = a / avg;
  const feel = r >= 1.3 ? "swings are larger than usual" : r <= 0.77 ? "swings are smaller than usual" : "swings are about normal";
  return `${size} That is ${r.toFixed(2)}× its 20-${input.unit} average, so ${feel}.`;
}

function volumeRead(input: ReadInput): string {
  const i = input.at, v = at(input.volume, i), avg = at(input.volumeAvg, i);
  if (v === null) return `There is no volume data for this ${input.unit}.`;
  if (avg === null || avg === 0) return notEnough("average volume", 20, input);
  const r = v / avg;
  const feel = r >= 1.8 ? "a spike that some traders read as strong interest" : r >= 1.2 ? "busier than usual" : r <= 0.6 ? "quieter than usual" : "about normal";
  return `Volume on the latest ${input.unit} was ${r.toFixed(2)}× its 20-${input.unit} average, ${feel}.`;
}

function zoneRead(input: ReadInput): string {
  const z = input.zone, c = at(input.closes, input.at);
  if (!z || c === null) return "No clear support or resistance zone was found in the history on this chart.";
  const mid = (z.lower + z.upper) / 2;
  const range = `${money(z.lower)} to ${money(z.upper)}`;
  if (c >= z.lower && c <= z.upper) return `Price is inside the ${z.kind} zone (${range}). Some traders watch how price behaves inside a zone like this.`;
  const d = ((c - mid) / mid) * 100;
  return `The nearest ${z.kind} zone is ${range}; price is ${pct(d)} ${d > 0 ? "above" : "below"} it. Some traders watch zones like this as places where price may pause or turn.`;
}

/** The one-line live read for a single selected indicator. */
export function indicatorRead(indicator: string, input: ReadInput): string {
  switch (indicator) {
    case "MA50": return maRead("50-" + input.unit + " moving average (MA50)", 50, input.ma50, input);
    case "MA200": return maRead("200-" + input.unit + " moving average (MA200)", 200, input.ma200, input);
    case "EMA20": return maRead("20-" + input.unit + " EMA", 20, input.ema20, input);
    case "VWMA(20)": return maRead("20-" + input.unit + " volume-weighted average (VWMA)", 20, input.vwma20, input);
    case "Bollinger(20,2)": return bollingerRead(input);
    case "Trend Helper (Smooth)": return trendHelperRead(TREND_HELPER_SLOW, input);
    case "Trend Helper (Fast)": return trendHelperRead(TREND_HELPER_FAST, input);
    case "Support/Resistance": return zoneRead(input);
    case "RSI(14)": return rsiRead(input);
    case "MACD(12,26,9)": return macdRead(input);
    case "Stochastic(14,3)": return stochRead(input);
    case "ATR(14)": return atrRead(input);
    case "Volume": return volumeRead(input);
    default: return "Custom indicator view is active.";
  }
}

/**
 * The mini manual per indicator: what it is, what its lines or colours mean,
 * and how people often read it. Two or three short sentences, hedged.
 */
export const INDICATOR_MANUAL: Record<string, string> = {
  "MA50":
    "The MA50 is the average closing price of the last 50 bars, drawn as a line. It smooths out day-to-day noise so the medium-term direction is easier to see. Many traders watch whether price holds above or below it, and some treat it as possible support or resistance.",
  "MA200":
    "The MA200 is the average closing price of the last 200 bars, one of the most widely watched long-term lines. Price above a rising MA200 is often described as a long-term uptrend, and below a falling one as a downtrend. Some investors watch pullbacks toward it as moments of interest, though price can cut straight through it.",
  "EMA20":
    "The EMA20 is a 20-bar exponential moving average: like a simple average, but it weights recent prices more, so it reacts faster. Short-term traders often watch whether price is riding above it or slipping below it. A steep slope may suggest strong momentum; a flat one, a pause.",
  "VWMA(20)":
    "The VWMA(20) is a 20-bar average that gives more weight to bars with heavier trading volume. When it sits above a plain average, more trading may have happened at higher prices, and vice versa. Some traders use it to judge whether a move has volume behind it.",
  "Bollinger(20,2)":
    "Bollinger Bands are a 20-bar average (the middle band) with an upper and lower band two standard deviations away. The bands widen when price swings grow and narrow when things go quiet. A close outside a band may suggest a stretched move, and a very tight \"squeeze\" is often watched because calm periods may be followed by bigger moves.",
  "Trend Helper (Smooth)":
    "The Trend Helper is a smoothed trend line that changes colour only once a direction is confirmed: blue means it last confirmed up, yellow means it last confirmed down, and grey means it hasn't confirmed either way yet. The purple line is the MA200, for the longer-term picture. A colour change may point to a possible change of trend; the Smooth setting waits for more confirmation, so it changes colour less often.",
  "Trend Helper (Fast)":
    "The Trend Helper is a smoothed trend line that changes colour once a direction is confirmed: blue means it last confirmed up, yellow means it last confirmed down, and grey means it hasn't confirmed yet. The purple line is the MA200. The Fast setting reacts sooner than Smooth, so it may flag turns earlier but also changes colour more often on noise.",
  "Support/Resistance":
    "Support and resistance zones are price areas where the stock has repeatedly paused or turned before. Support sits below the price and resistance above it. Some traders watch how price behaves when it returns to a zone, but zones can break, and a broken zone sometimes switches role.",
  "RSI(14)":
    "The RSI (Relative Strength Index) measures how strong recent gains are against recent losses, on a 0 to 100 scale over 14 bars. Readings above 70 are often called overbought and below 30 oversold, though a strong trend can stay in those zones for a long time. Some traders also watch for the RSI and price moving in opposite directions (a divergence).",
  "MACD(12,26,9)":
    "The MACD compares a fast (12-bar) and a slow (26-bar) average of price; the signal line is a 9-bar average of the MACD itself, and the bars show the gap between the two. When the MACD crosses above its signal line, some traders read it as momentum turning up, and below as momentum turning down. Crossings above or below zero are watched too.",
  "Stochastic(14,3)":
    "The Stochastic shows where the latest close sits within the last 14 bars' range, from 0 (the low) to 100 (the high). The fast line (%K) and slow line (%D) crossing are often watched as early momentum signals. Readings above 80 are often called overbought and below 20 oversold.",
  "ATR(14)":
    "The ATR (Average True Range) is the typical size of a bar's move over the last 14 bars, in dollars. It measures how much the price swings, not which way. Some traders use it to judge how volatile a stock is right now or to size their expectations for a move.",
  "Volume":
    "Volume is how many shares traded in each bar. Moves on heavier-than-usual volume are often read as having more conviction behind them, and moves on light volume as less convincing. The comparison here is against the 20-bar average.",
};

/** Every indicator the dashboard offers; each must have a read and a manual. */
export const OFFERED_INDICATORS = [
  "MA50", "MA200", "EMA20", "VWMA(20)", "Bollinger(20,2)", "Trend Helper (Smooth)", "Trend Helper (Fast)", "Support/Resistance",
  "RSI(14)", "MACD(12,26,9)", "Stochastic(14,3)", "ATR(14)", "Volume",
] as const;
