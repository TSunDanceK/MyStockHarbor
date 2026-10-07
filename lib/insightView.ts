// THE INSIGHT PAGE'S FIGURES (#563 COWORK #132/#133): pure, so the checks can
// drive them. The page reads the bars (Tiingo's stored daily series, the
// stock's and SPY's) and hands them here; nothing in this file reads a store.
//
// ONE TEMPLATE FOR EVERY POST. A post is either the new shape (frontmatter:
// ticker, event type, timeframe, the level(s) discussed, summary, sources,
// bull / bear lines, and NO price fields) or one of the 59 written before it
// (title, excerpt, chartIndicators, overallBreakdown...). normaliseInsight
// maps both onto one shape; the page never branches on the format again.
//
// THE LEVEL DISCUSSED is a kind of level, never a price: "MA200" means the
// 200-day average, wherever it is that day. An old post's level is derived
// from its chart indicator (MA200 → the 200-day; weekly MA200 → the 200-week;
// MA50 → the 50-day; Bollinger → its midline, the 20-day). A post whose
// indicator names no level (RSI, MACD, Volume) has none: its "Since" strip
// shows the move and the S&P comparison only.
//
// THE SETUP LABEL is derived from the data at publication, never from the
// frontmatter, so a slug that says "buy zone" and a tag that said "breakdown
// risk" can no longer disagree with the figures.
//
// COPY RULES: describes, never advises. No "buy", "sell", "should", "must",
// "recommend" in anything this file writes (scripts/check-insight-page.mjs).

export type EodBar = [date: string, open: number, high: number, low: number, close: number, volume: number];

export type InsightLevelKind = "MA50" | "MA200" | "WMA200" | "BBMID";

export const LEVEL_NAME: Record<InsightLevelKind, string> = {
  MA50: "50-day average",
  MA200: "200-day average",
  WMA200: "200-week average",
  BBMID: "20-day average",
};

/** The "within" band for "testing": a close this close to the level is a test of it, in %. */
export const TESTING_PCT = 2;

export type InsightSource = { title: string; url: string; publisher: string | null };

export type InsightFormat = "v2" | "v1";

/**
 * "WHAT'S DRIVING {TICKER} NOW" (#563 COWORK #146): one researched paragraph,
 * written at publish and dated, with its sources. Optional on both formats;
 * never refreshed on a schedule (owner ruling), and it does not move the
 * page's dateModified (only `updated` does).
 */
export type InsightDrivers = { asOf: string; text: string; sources: { title: string; publisher: string; url: string }[] };
/** At most this many sources under the paragraph. */
export const DRIVERS_MAX_SOURCES = 5;

/**
 * The loader's validation: absent is fine (null, no problems); present must be
 * a dated (yyyy-mm-dd, a real day) non-empty paragraph with 1–5 sources, each
 * with a title, a publisher and an https URL. Anything else is rejected whole,
 * with the reasons, and the card falls back to the headline layout.
 */
export function parseDrivers(raw: unknown): { drivers: InsightDrivers | null; problems: string[] } {
  if (raw === undefined || raw === null) return { drivers: null, problems: [] };
  if (typeof raw !== "object" || Array.isArray(raw)) return { drivers: null, problems: ["drivers is not a mapping"] };
  const o = raw as Record<string, unknown>;
  const problems: string[] = [];
  const asOf = o.asOf instanceof Date ? o.asOf.toISOString().slice(0, 10) : str(o.asOf);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number.isNaN(Date.parse(`${asOf}T00:00:00Z`)) || new Date(`${asOf}T00:00:00Z`).toISOString().slice(0, 10) !== asOf) problems.push("drivers.asOf is not a yyyy-mm-dd date");
  const text = str(o.text).replace(/\s+/g, " ");
  if (!text) problems.push("drivers.text is empty");
  const list = Array.isArray(o.sources) ? o.sources : [];
  if (list.length < 1 || list.length > DRIVERS_MAX_SOURCES) problems.push(`drivers.sources has ${list.length} entries (1–${DRIVERS_MAX_SOURCES})`);
  const sources = list.map((s, i) => {
    const r = s && typeof s === "object" ? (s as Record<string, unknown>) : {};
    const src = { title: str(r.title), publisher: str(r.publisher), url: str(r.url) };
    if (!src.title || !src.publisher) problems.push(`drivers.sources[${i}] needs a title and a publisher`);
    if (!/^https:\/\/[^\s/]+\.[^\s]+$/.test(src.url)) problems.push(`drivers.sources[${i}].url is not an https URL`);
    return src;
  });
  return problems.length ? { drivers: null, problems } : { drivers: { asOf, text, sources }, problems: [] };
}

export type NormalisedInsight = {
  format: InsightFormat;
  slug: string;
  title: string;
  /** Publication date, yyyy-mm-dd. */
  date: string;
  /** When the post's TEXT last changed (frontmatter `updated`), else null: the JSON-LD's dateModified, never the daily data refresh (#138). */
  updated: string | null;
  symbol: string;
  timeframe: "d" | "w";
  eventType: string | null;
  levels: InsightLevelKind[];
  /** The short version: one 2–3 sentence summary, shown once. */
  summary: string;
  /** "Why it mattered", behind a tap. */
  why: string | null;
  /** "What happened", as written (markdown). */
  whatHappened: string | null;
  sources: InsightSource[];
  bull: string | null;
  bear: string | null;
  /** v1 only: the rest of the original post, as written, behind a tap. */
  originalRest: string | null;
  /** Where an old post placed the price against its level, in its own words ("above" / "below"), else null. */
  claimedSide: "above" | "below" | null;
  /** The dated "what's driving it now" paragraph, when the post has a valid one (#146). */
  drivers: InsightDrivers | null;
};

// ── FRONTMATTER → ONE SHAPE ─────────────────────────────────────────────────

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const LEVEL_KINDS = new Set<InsightLevelKind>(["MA50", "MA200", "WMA200", "BBMID"]);

/** A v1 post's level from its chart indicator(s) and timeframe; [] when it names none. */
export function levelFromIndicators(indicators: readonly string[], timeframe: "d" | "w"): InsightLevelKind[] {
  for (const ind of indicators) {
    if (ind === "MA200") return [timeframe === "w" ? "WMA200" : "MA200"];
    if (ind === "MA50") return ["MA50"];
    if (ind === "Bollinger(20,2)") return ["BBMID"];
  }
  return [];
}

/** Splits markdown into its "## " sections, in order. */
export function sections(markdown: string): { heading: string; body: string }[] {
  const out: { heading: string; body: string }[] = [];
  let cur: { heading: string; body: string[] } | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m && !line.startsWith("###")) {
      if (cur) out.push({ heading: cur.heading, body: cur.body.join("\n").trim() });
      cur = { heading: m[1], body: [] };
    } else if (cur) cur.body.push(line);
    else if (line.trim()) (cur = { heading: "", body: [line] });
  }
  if (cur) out.push({ heading: cur.heading, body: cur.body.join("\n").trim() });
  return out;
}

/** Emoji and pictographs dropped from a heading (#132: no emoji headers). */
export const stripEmoji = (s: string) => s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/\s{2,}/g, " ").trim();

const SCENARIO = (label: "Bullish" | "Bearish", body: string) => {
  const m = new RegExp(`\\*\\*${label} scenario:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\s*\\*\\*(?:Bullish|Bearish) scenario:|$)`).exec(body);
  return m ? m[1].replace(/\s+/g, " ").trim() || null : null;
};

/** Where an old post's own words put the price against its level. */
export function claimedSideOf(text: string, level: InsightLevelKind | undefined): "above" | "below" | null {
  if (!level) return null;
  const n = level === "MA50" ? "50" : level === "BBMID" ? "(?:20|middle|mid)" : "200";
  const unit = level === "WMA200" ? "(?:-| )?(?:week|weekly)" : level === "BBMID" ? "(?:-| )?(?:day|band|bollinger)" : "(?:-| )?day";
  const re = new RegExp(`\\b(above|below)\\s+(?:its|the)?\\s*(?:rising|falling|flat)?\\s*${n}${unit}`, "i");
  const m = re.exec(text);
  return m ? (m[1].toLowerCase() as "above" | "below") : null;
}

export function normaliseInsight(slug: string, data: Record<string, unknown>, body: string): NormalisedInsight {
  const timeframe = data.timeframe === "w" ? "w" : "d";
  const date = str(data.date);
  const symbol = str(data.symbol ?? data.ticker).toUpperCase();
  const secs = sections(body);
  const find = (re: RegExp) => secs.find((s) => re.test(s.heading));
  const whatHappened = find(/^what happened$/i)?.body || null;
  const drivers = parseDrivers(data.drivers).drivers;

  if (data.eventType !== undefined || data.summary !== undefined) {
    // THE NEW SHAPE. No price fields are read even if present.
    const levels = (Array.isArray(data.levels) ? data.levels : [data.levels]).map(str).filter((l): l is InsightLevelKind => LEVEL_KINDS.has(l as InsightLevelKind));
    const sources = (Array.isArray(data.sources) ? data.sources : [])
      .map((s) => (s && typeof s === "object" ? { title: str((s as Record<string, unknown>).title), url: str((s as Record<string, unknown>).url), publisher: str((s as Record<string, unknown>).publisher) || null } : null))
      .filter((s): s is InsightSource => !!s && !!s.title && /^https:\/\//.test(s.url));
    return {
      format: "v2", slug, title: str(data.title), date, updated: str(data.updated) || null, symbol, timeframe, eventType: str(data.eventType) || null, levels,
      summary: str(data.summary), why: str(data.why) || find(/^why it matter/i)?.body || null, whatHappened, sources,
      bull: str(data.bull) || null, bear: str(data.bear) || null, originalRest: null, claimedSide: null, drivers,
    };
  }

  // AN OLD POST. The summary once (the excerpt, else its "simple view"); the
  // body kept as written, its scenarios as the two one-liners, the rest behind a tap.
  const indicators = Array.isArray(data.chartIndicators) ? data.chartIndicators.map(str) : [];
  const levels = levelFromIndicators(indicators, timeframe);
  const scen = find(/bull vs bear/i)?.body ?? "";
  const shown = new Set(["what happened", "why it matters", "bull vs bear scenarios"]);
  const rest = secs.filter((s) => !shown.has(s.heading.toLowerCase())).map((s) => (s.heading ? `## ${stripEmoji(s.heading)}\n\n${s.body}` : s.body)).join("\n\n").trim();
  const summary = str(data.excerpt) || str(data.overallBreakdown);
  return {
    format: "v1", slug, title: str(data.title), date, updated: str(data.updated) || null, symbol, timeframe, eventType: null, levels,
    summary, why: find(/^why it matters$/i)?.body || null, whatHappened, sources: [],
    bull: SCENARIO("Bullish", scen), bear: SCENARIO("Bearish", scen), originalRest: rest || null,
    claimedSide: claimedSideOf(`${str(data.excerpt)} ${str(data.overallBreakdown)}`, levels[0]), drivers,
  };
}

// ── LEVEL SERIES ────────────────────────────────────────────────────────────

const sma = (closes: readonly number[], n: number): (number | null)[] => {
  const out: (number | null)[] = Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= n) sum -= closes[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
};

type WeekPoint = { date: string; close: number; high?: number; low?: number; volume?: number };

/**
 * Daily points into ISO weeks (Monday keys), each the week's last date and
 * close. The insight chart's aggregator, moved here from the retired
 * InsightPostClient.tsx unchanged; scripts/check-weekly-aggregators.mjs holds
 * it to the site's other seven.
 */
function aggregateToWeekly(points: WeekPoint[]): { date: string; close: number; high: number; low: number; volume: number }[] {
  if (!points.length) return [];
  const buckets = new Map<string, { date: string; close: number; high: number; low: number; volume: number }>();
  for (const point of points) {
    const d = new Date(`${point.date}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) continue;
    const utcDay = d.getUTCDay();
    const diffToMonday = utcDay === 0 ? -6 : 1 - utcDay;
    const weekStart = new Date(d);
    weekStart.setUTCDate(d.getUTCDate() + diffToMonday);
    const key = weekStart.toISOString().slice(0, 10);
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, { date: point.date, close: point.close, high: point.high ?? point.close, low: point.low ?? point.close, volume: point.volume ?? 0 });
      continue;
    }
    existing.date = point.date;
    existing.close = point.close;
    existing.high = Math.max(existing.high, point.high ?? point.close);
    existing.low = Math.min(existing.low, point.low ?? point.close);
    existing.volume += point.volume ?? 0;
  }
  return Array.from(buckets.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([, value]) => value);
}

/** The level's value on every daily bar (null in its warm-up). */
export function levelSeries(bars: readonly EodBar[], kind: InsightLevelKind): (number | null)[] {
  const closes = bars.map((b) => b[4]);
  if (kind === "MA50") return sma(closes, 50);
  if (kind === "MA200") return sma(closes, 200);
  if (kind === "BBMID") return sma(closes, 20);
  // The 200-week: weekly closes (aggregateToWeekly), their 200-SMA, read on
  // each day as the 199 weeks closed before it plus its own week so far.
  const weeks = aggregateToWeekly(bars.map((b) => ({ date: b[0], close: b[4] })));
  const prefix = [0];
  for (const w of weeks) prefix.push(prefix[prefix.length - 1] + w.close);
  let k = 0;
  return bars.map((b) => {
    while (k < weeks.length - 1 && weeks[k].date < b[0]) k++;
    return k < 199 ? null : (prefix[k] - prefix[k - 199] + b[4]) / 200;
  });
}

// ── THE SETUP LABEL ─────────────────────────────────────────────────────────

/** The last bar on or before `date`, by index; -1 when none. */
export function indexOnOrBefore(bars: readonly EodBar[], date: string): number {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid][0] <= date) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

export type SetupLabel = { text: string; tone: "up" | "down" | "flat" };

/**
 * One label, from the data at publication. With a level: "Testing / Above /
 * Below the 200-day average" (testing within TESTING_PCT). Without one: the
 * close against its 50- and 200-day averages.
 */
export function setupLabel(bars: readonly EodBar[], date: string, level: InsightLevelKind | undefined): SetupLabel | null {
  const i = indexOnOrBefore(bars, date);
  if (i < 0) return null;
  const close = bars[i][4];
  if (level) {
    const v = levelSeries(bars, level)[i];
    if (v !== null) {
      const pct = ((close - v) / v) * 100;
      if (Math.abs(pct) <= TESTING_PCT) return { text: `Testing the ${LEVEL_NAME[level]}`, tone: "flat" };
      return pct > 0 ? { text: `Above the ${LEVEL_NAME[level]}`, tone: "up" } : { text: `Below the ${LEVEL_NAME[level]}`, tone: "down" };
    }
  }
  const closes = bars.map((b) => b[4]);
  const m50 = sma(closes, 50)[i], m200 = sma(closes, 200)[i];
  if (m50 === null || m200 === null) return null;
  if (close > m50 && m50 > m200) return { text: "Uptrend: above its 50- and 200-day", tone: "up" };
  if (close < m50 && m50 < m200) return { text: "Downtrend: below its 50- and 200-day", tone: "down" };
  return { text: "Mixed trend", tone: "flat" };
}

// ── SINCE THIS WAS PUBLISHED ────────────────────────────────────────────────

export type LevelOutcome =
  | { kind: "held" }                                   // started above, never closed below
  | { kind: "broke"; on: string }                      // started above, closed below, below now
  | { kind: "broke-reclaimed"; on: string; back: string } // closed below, then back above, above now
  | { kind: "stayed-below" }                           // started below, never closed above
  | { kind: "reclaimed"; on: string }                  // started below, closed above, above now
  | { kind: "reclaimed-lost"; on: string; lost: string }; // closed above, then back below, below now

export type SinceView = {
  /** Sessions since publication (bars after the publish bar). */
  sessions: number;
  thenDate: string;
  thenClose: number;
  nowDate: string;
  nowClose: number;
  /** % move since publication. */
  movePct: number;
  level: null | {
    kind: InsightLevelKind;
    name: string;
    thenValue: number;
    nowValue: number;
    /** Close vs the level at publication, %. */
    thenPct: number;
    /** Close vs the level now, %. */
    nowPct: number;
    outcome: LevelOutcome;
  };
  /** The stock's move minus SPY's over the same sessions, in percentage points; null without SPY. */
  vsSpxPts: number | null;
};

/**
 * THE HELD / BROKE RULE, on daily CLOSES after publication. The side at
 * publication is where the publish-day close sat (on the level counts as
 * above). A close on the other side is the first crossing; a close back is
 * the return. The outcome is read against the latest close.
 */
export function levelOutcome(closes: readonly number[], levels: readonly (number | null)[], dates: readonly string[], from: number): LevelOutcome {
  const side = (i: number) => (levels[i] === null ? null : closes[i] >= (levels[i] as number) ? "above" : "below");
  const start = side(from) ?? "above";
  // The first close on the other side, and the latest close back on the starting side.
  let firstCross: string | null = null, lastBack: string | null = null, cur = start;
  for (let i = from + 1; i < closes.length; i++) {
    const s = side(i);
    if (!s || s === cur) continue;
    cur = s;
    if (s !== start) firstCross ??= dates[i];
    else lastBack = dates[i];
  }
  if (start === "above") {
    if (!firstCross) return { kind: "held" };
    return cur === "above" && lastBack ? { kind: "broke-reclaimed", on: firstCross, back: lastBack } : { kind: "broke", on: firstCross };
  }
  if (!firstCross) return { kind: "stayed-below" };
  return cur === "below" && lastBack ? { kind: "reclaimed-lost", on: firstCross, lost: lastBack } : { kind: "reclaimed", on: firstCross };
}

/** Null until at least one session has closed after publication. */
export function sinceView(bars: readonly EodBar[], spy: readonly EodBar[] | null, date: string, level: InsightLevelKind | undefined): SinceView | null {
  const from = indexOnOrBefore(bars, date);
  if (from < 0 || bars.length - 1 - from < 1) return null;
  const last = bars.length - 1;
  const thenClose = bars[from][4], nowClose = bars[last][4];
  const movePct = ((nowClose - thenClose) / thenClose) * 100;
  let lvl: SinceView["level"] = null;
  if (level) {
    const series = levelSeries(bars, level);
    const tv = series[from], nv = series[last];
    if (tv !== null && nv !== null) {
      lvl = {
        kind: level, name: LEVEL_NAME[level], thenValue: tv, nowValue: nv,
        thenPct: ((thenClose - tv) / tv) * 100, nowPct: ((nowClose - nv) / nv) * 100,
        outcome: levelOutcome(bars.map((b) => b[4]), series, bars.map((b) => b[0]), from),
      };
    }
  }
  let vsSpxPts: number | null = null;
  if (spy?.length) {
    // SPY over the same dates: its close on the publish bar's date and on the latest bar's.
    const s0 = indexOnOrBefore(spy, bars[from][0]), s1 = indexOnOrBefore(spy, bars[last][0]);
    if (s0 >= 0 && s1 > s0) vsSpxPts = movePct - ((spy[s1][4] - spy[s0][4]) / spy[s0][4]) * 100;
  }
  return { sessions: last - from, thenDate: bars[from][0], thenClose, nowDate: bars[last][0], nowClose, movePct, level: lvl, vsSpxPts };
}

// ── WORDS ───────────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "28 Jul 2026" */
export const dayWords = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return `${dd} ${MONTHS[m - 1]} ${y}`; };
export const pctWords = (v: number, digits = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}%`;
export const ptsWords = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)} pts`;

/** The level stat's one line: what the closes did against it since publication. */
export function outcomeWords(o: LevelOutcome): { word: string; detail: string | null; tone: "up" | "down" | "flat" } {
  switch (o.kind) {
    case "held": return { word: "Held", detail: "No daily close below it since", tone: "up" };
    case "broke": return { word: "Broke", detail: `First close below on ${dayWords(o.on)}`, tone: "down" };
    case "broke-reclaimed": return { word: "Reclaimed", detail: `Closed below on ${dayWords(o.on)}, back above on ${dayWords(o.back)}`, tone: "up" };
    case "stayed-below": return { word: "Stayed below", detail: "No daily close above it since", tone: "down" };
    case "reclaimed": return { word: "Reclaimed", detail: `First close above on ${dayWords(o.on)}`, tone: "up" };
    case "reclaimed-lost": return { word: "Lost again", detail: `Closed above on ${dayWords(o.on)}, back below on ${dayWords(o.lost)}`, tone: "down" };
  }
}

/**
 * THE MUTED LINE where an old post's words and its data disagree (#133):
 * "At publication the close was 2.1% below the 200-day average." Null when
 * they agree, when the post made no claim, or there is no level value.
 */
export function differenceNote(n: NormalisedInsight, bars: readonly EodBar[]): string | null {
  const level = n.levels[0];
  if (!level || !n.claimedSide) return null;
  const i = indexOnOrBefore(bars, n.date);
  const v = i >= 0 ? levelSeries(bars, level)[i] : null;
  if (i < 0 || v === null) return null;
  const pct = ((bars[i][4] - v) / v) * 100;
  const actual = pct >= 0 ? "above" : "below";
  if (actual === n.claimedSide) return null;
  return `At publication the close was ${Math.abs(pct).toFixed(1)}% ${actual} the ${LEVEL_NAME[level]}.`;
}
