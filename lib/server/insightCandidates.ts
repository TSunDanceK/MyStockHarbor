// THE DAILY INSIGHT CANDIDATES (#553 COWORK #181, with #188).
//
// B builds the SELECTION, so the scheduled insight writer never picks from web
// chatter and never sees market data. A nightly step in the existing tiingo-eod
// job (no new cron) writes INSIGHT_CANDIDATES_KEY from the bars already in
// memory; a read-only relay task hands the writer the day's list.
//
// ── THE RULES (owner, 6 Oct) ──────────────────────────────────────────────
//   universe  the top INSIGHT_UNIVERSE by market cap (A's marketCap via
//             secCapAndPe: SEC cover shares x the night's close)
//   event     a real event on the session, one of: results just reported or
//             expected this week (A's report-dates store), a 200-day test, a
//             Trend Helper flip (daily, or weekly on the week's first
//             session), a 52-week closing high or low, a 5%+ gap, a volume
//             spike
//   filed     a stored SEC fact set with a latest filed period (#188): the
//             post's right rail shows filed earnings. Read from the picker SEC
//             rows the size ranking already reads -- no per-symbol GET
//   repeat    no ticker within INSIGHT_REPEAT_DAYS of its last post. Applied on
//             the READ path (finalInsightCandidates), which runs with the repo
//             checked out: the nightly cron function is not given
//             content/insights, and a post written today must count tomorrow
//             without waiting for a deploy
//   ranked    size x event strength; the key keeps the top INSIGHT_RANKED_KEEP
//             so the read path still has ~10 after repeats
//   buzz      one retail-buzz slot a week: the most-searched name on the site
//             (its own search-demand ZSETs, no scraping) with a cap of at
//             least BUZZ_MIN_CAP and an event that session. Flagged every night;
//             the writer uses it once a week
//
// ── NO PRICES, LEVELS OR BARS IN THE KEY ───────────────────────────────────
// It is handed to an AI writer, and Tiingo data may not go into AI (the
// contract note, as COWORK #181 states it). Tickers, event labels, dates and
// a size bucket only; the reasons are words, with no figure from the bars.
// insightKeyViolations is the guard, and the write refuses a value it flags.
import { secCapAndPe, type SecCapRow } from "./pickersSecFundamentals";
import { latestResults, type StoredReportDates } from "./secReportDatesStore";
import { latestTrendFlip, resampleWeeklyClosed, TREND_HELPER_SLOW } from "../ta/trendHelper";
import { CAP_RANK_HOLD_OUT } from "./topByCap";
import { toDashed } from "../symbolSpellings.mjs";
import type { EodBar } from "./marketData/types";

export const INSIGHT_CANDIDATES_KEY = "msh:insights:candidates:v1";
export const INSIGHT_UNIVERSE = 300;
export const INSIGHT_RANKED_KEEP = 25;
export const INSIGHT_FINAL = 10;
export const INSIGHT_REPEAT_DAYS = 30;
export const BUZZ_MIN_CAP = 10e9;
/** Kept a week past the next night, so a skipped night leaves yesterday's list readable. */
export const INSIGHT_CANDIDATES_TTL_SECONDS = 8 * 24 * 60 * 60;

export type InsightEvent =
  | "results-reported"
  | "results-this-week"
  | "gap-up"
  | "gap-down"
  | "high-52w"
  | "low-52w"
  | "trend-flip-up"
  | "trend-flip-down"
  | "weekly-trend-flip-up"
  | "weekly-trend-flip-down"
  | "ma200-test"
  | "volume-spike";

/** Strength, and the words the writer is given. No figure from the bars in any of them. */
export const INSIGHT_EVENTS: Record<InsightEvent, { strength: number; words: string }> = {
  "results-reported": { strength: 3, words: "reported results in the last few days (SEC filing on file)" },
  "gap-up": { strength: 3, words: "gapped up 5% or more at the open" },
  "gap-down": { strength: 3, words: "gapped down 5% or more at the open" },
  "high-52w": { strength: 2.5, words: "closed at a 52-week high" },
  "low-52w": { strength: 2.5, words: "closed at a 52-week low" },
  "weekly-trend-flip-up": { strength: 2.5, words: "Trend Helper flipped up on the weekly chart last week" },
  "weekly-trend-flip-down": { strength: 2.5, words: "Trend Helper flipped down on the weekly chart last week" },
  "results-this-week": { strength: 2, words: "results are expected this week (an estimated date)" },
  "trend-flip-up": { strength: 2, words: "Trend Helper flipped up on the daily chart" },
  "trend-flip-down": { strength: 2, words: "Trend Helper flipped down on the daily chart" },
  "ma200-test": { strength: 1.5, words: "tested its 200-day moving average" },
  "volume-spike": { strength: 1, words: "traded about twice its usual volume or more" },
};

export type CapBucket = "mega" | "large" | "mid";
export const capBucketOf = (cap: number): CapBucket => (cap >= 200e9 ? "mega" : cap >= 10e9 ? "large" : "mid");

export type InsightCandidate = {
  symbol: string;
  /** The strongest event; `events` lists them all, strongest first. */
  event: InsightEvent;
  events: InsightEvent[];
  /** The session the events are on (YYYY-MM-DD). */
  eventDate: string;
  capBucket: CapBucket;
  reason: string;
  buzz?: true;
};

export type InsightExclusion = { symbol: string; why: "no-fact-set" | "no-filed-period" };

export type InsightCandidatesValue = {
  v: 1;
  asOf: string;
  at: string;
  ranked: InsightCandidate[];
  buzz: InsightCandidate | null;
  /** Top-cap names WITH an event that #188 left out, and why (first 30). */
  excluded: InsightExclusion[];
};

const DAY_MS = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** Pure. The events on the last bar of `bars` (closed daily bars, oldest first). */
export function eventsOf(bars: readonly EodBar[], rec: StoredReportDates | null, asOf: string): InsightEvent[] {
  const out: InsightEvent[] = [];
  const n = bars.length;
  if (n >= 2) {
    const [, o, h, l, c, v] = bars[n - 1];
    const prevC = bars[n - 2][4];
    if (prevC > 0 && o > 0) {
      const gap = o / prevC - 1;
      if (gap >= 0.05) out.push("gap-up");
      else if (gap <= -0.05) out.push("gap-down");
    }
    if (n >= 253) {
      const prior = bars.slice(n - 252, n - 1).map((b) => b[4]);
      if (c > Math.max(...prior)) out.push("high-52w");
      else if (c < Math.min(...prior)) out.push("low-52w");
    }
    if (n >= 200) {
      const ma200 = bars.slice(n - 200).reduce((s, b) => s + b[4], 0) / 200;
      if (l <= ma200 * 1.01 && h >= ma200 * 0.99 && c >= ma200 * 0.97) out.push("ma200-test");
    }
    if (n >= 21) {
      const avg = bars.slice(n - 21, n - 1).reduce((s, b) => s + b[5], 0) / 20;
      if (avg > 0 && v >= 2 * avg) out.push("volume-spike");
    }
    const { trendLen, confirmBars } = TREND_HELPER_SLOW;
    const closes = bars.map((b) => b[4]);
    const daily = latestTrendFlip(closes, trendLen, confirmBars);
    if (daily && daily.barsSinceFlip === 0 && !daily.isFirstConfirmation) out.push(daily.direction > 0 ? "trend-flip-up" : "trend-flip-down");
    // WEEKLY, ON THE WEEK'S FIRST SESSION ONLY: the closed week flips once, and
    // reporting it every day of the following week would repeat one event five times.
    const weeks = resampleWeeklyClosed(bars.map((b) => ({ date: b[0], close: b[4] })));
    if (weeks.length && weeks[weeks.length - 1].date === bars[n - 2][0]) {
      const weekly = latestTrendFlip(weeks.map((w) => w.close), trendLen, confirmBars);
      if (weekly && weekly.barsSinceFlip === 0 && !weekly.isFirstConfirmation) out.push(weekly.direction > 0 ? "weekly-trend-flip-up" : "weekly-trend-flip-down");
    }
  }
  // RESULTS: an announcement on file within the last 3 days (through asOf), or
  // an estimated date in the next 7. Only what the store holds as of asOf.
  const latest = latestResults(rec);
  if (latest && latest.announcedOn <= asOf && daysBetween(latest.announcedOn, asOf) <= 3) out.push("results-reported");
  else if (rec?.next && rec.next.kind === "date" && rec.next.date > asOf && daysBetween(asOf, rec.next.date) <= 7) out.push("results-this-week");
  return out.sort((a, b) => INSIGHT_EVENTS[b].strength - INSIGHT_EVENTS[a].strength || a.localeCompare(b));
}

/** Size x event strength: log10 of the cap in $bn (floored at 0.5), times the strongest event plus a quarter of the rest. */
export function insightScore(cap: number, events: InsightEvent[]): number {
  if (!events.length) return 0;
  const size = Math.max(0.5, Math.log10(cap / 1e9));
  const [top, ...rest] = events.map((e) => INSIGHT_EVENTS[e].strength);
  return size * (top + 0.25 * rest.reduce((a, b) => a + b, 0));
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export function reasonOf(events: InsightEvent[]): string {
  return capitalise(events.map((e) => INSIGHT_EVENTS[e].words).join("; ")) + ".";
}

export type InsightInputs = {
  asOf: string;
  /** Closed daily bars per symbol (dashed spelling), oldest first. */
  bars: ReadonlyMap<string, readonly EodBar[]>;
  /** The picker SEC rows (any spelling). */
  secRows: Record<string, SecCapRow>;
  /** Report-dates records for the top-cap names (dashed). */
  reportDates: ReadonlyMap<string, StoredReportDates | null>;
  /** The site's search demand, highest first. */
  demand: ReadonlyArray<{ symbol: string; score: number }>;
};

/** Pure. Every capped symbol, largest first, with its cap and row. */
export function capRanked(bars: InsightInputs["bars"], secRows: InsightInputs["secRows"]): { symbol: string; cap: number; row: SecCapRow }[] {
  const out: { symbol: string; cap: number; row: SecCapRow }[] = [];
  const seen = new Set<string>();
  for (const [field, row] of Object.entries(secRows)) {
    const symbol = toDashed(field);
    if (seen.has(symbol) || CAP_RANK_HOLD_OUT.has(symbol)) continue;
    seen.add(symbol);
    const b = bars.get(symbol);
    const close = b && b.length ? b[b.length - 1][4] : null;
    if (!(typeof close === "number" && close > 0)) continue;
    const cap = secCapAndPe(row, close).marketCap;
    if (typeof cap === "number" && Number.isFinite(cap) && cap > 0) out.push({ symbol, cap, row });
  }
  return out.sort((a, b) => b.cap - a.cap || a.symbol.localeCompare(b.symbol));
}

/** #188: a fact set with a latest filed period (the row's EPS period). */
const filedOk = (row: SecCapRow | undefined): InsightExclusion["why"] | null =>
  !row ? "no-fact-set" : row.eps && typeof row.eps.periodEnd === "string" ? null : "no-filed-period";

/** Pure. The night's ranked list, buzz pick and #188 exclusions. Repeats are NOT applied here. */
export function selectInsightCandidates(input: InsightInputs, at: string): InsightCandidatesValue {
  const all = capRanked(input.bars, input.secRows);
  const top = all.slice(0, INSIGHT_UNIVERSE);
  const scored: { c: InsightCandidate; score: number }[] = [];
  const excluded: InsightExclusion[] = [];
  const candidateOf = (symbol: string, cap: number, events: InsightEvent[]): InsightCandidate => ({
    symbol,
    event: events[0],
    events,
    eventDate: input.asOf,
    capBucket: capBucketOf(cap),
    reason: reasonOf(events),
  });
  for (const { symbol, cap, row } of top) {
    const events = eventsOf(input.bars.get(symbol) ?? [], input.reportDates.get(symbol) ?? null, input.asOf);
    if (!events.length) continue;
    const why = filedOk(row);
    if (why) { excluded.push({ symbol, why }); continue; }
    scored.push({ c: candidateOf(symbol, cap, events), score: insightScore(cap, events) });
  }
  scored.sort((a, b) => b.score - a.score || a.c.symbol.localeCompare(b.c.symbol));

  // BUZZ: the most-searched name with a cap of at least BUZZ_MIN_CAP and an event.
  const byCap = new Map(all.map((x) => [x.symbol, x]));
  let buzz: InsightCandidate | null = null;
  for (const d of input.demand) {
    const sym = toDashed(String(d.symbol).trim().toUpperCase());
    const hit = byCap.get(sym);
    if (!hit || hit.cap < BUZZ_MIN_CAP || filedOk(hit.row)) continue;
    const events = eventsOf(input.bars.get(sym) ?? [], input.reportDates.get(sym) ?? null, input.asOf);
    if (!events.length) continue;
    buzz = { ...candidateOf(sym, hit.cap, events), buzz: true };
    break;
  }
  return { v: 1, asOf: input.asOf, at, ranked: scored.slice(0, INSIGHT_RANKED_KEEP).map((s) => s.c), buzz, excluded: excluded.slice(0, 30) };
}

/**
 * READ PATH. Pure. The writer's list: the ranked names with no post in the
 * last INSIGHT_REPEAT_DAYS (by `content/insights` frontmatter `symbol` and
 * `date`), top INSIGHT_FINAL, and the buzz pick under the same rule.
 */
export function finalInsightCandidates(
  value: InsightCandidatesValue,
  posts: ReadonlyArray<{ symbol?: string | null; date: string }>
): { asOf: string; candidates: InsightCandidate[]; buzz: InsightCandidate | null; repeats: string[] } {
  const last = new Map<string, string>();
  for (const p of posts) {
    if (!p.symbol || !p.date) continue;
    const s = toDashed(String(p.symbol).trim().toUpperCase());
    if (!last.has(s) || p.date > last.get(s)!) last.set(s, p.date.slice(0, 10));
  }
  const recent = (s: string) => {
    const d = last.get(s);
    return d !== undefined && daysBetween(d, value.asOf) < INSIGHT_REPEAT_DAYS;
  };
  const repeats = value.ranked.filter((c) => recent(c.symbol)).map((c) => c.symbol);
  return {
    asOf: value.asOf,
    candidates: value.ranked.filter((c) => !recent(c.symbol)).slice(0, INSIGHT_FINAL),
    buzz: value.buzz && !recent(value.buzz.symbol) ? value.buzz : null,
    repeats,
  };
}

/**
 * THE GUARD. Pure. Every way a price, level or bar could ride in the key: a
 * number anywhere but `v`, a dollar sign, a decimal figure, or a field named
 * like one. Empty = clean.
 */
export function insightKeyViolations(value: unknown, path = "$"): string[] {
  const out: string[] = [];
  const PRICEY = /^(price|close|open|high|low|level|bars?|ma\d*|cap|marketCap|volume|change|pct)$/i;
  if (typeof value === "number") {
    if (path !== "$.v") out.push(`${path} is a number`);
  } else if (typeof value === "string") {
    if (/\$/.test(value) || /\d+\.\d+/.test(value)) out.push(`${path} carries a figure`);
  } else if (Array.isArray(value)) {
    value.forEach((x, i) => out.push(...insightKeyViolations(x, `${path}[${i}]`)));
  } else if (value && typeof value === "object") {
    for (const [k, x] of Object.entries(value)) {
      if (PRICEY.test(k)) out.push(`${path}.${k} is a price-shaped field`);
      out.push(...insightKeyViolations(x, `${path}.${k}`));
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────── I/O

type SetClient = { set: (key: string, value: string, opts: { ex: number }) => Promise<unknown> };

/**
 * THE NIGHTLY STEP (tiingo-eod, a complete night only). Reads, besides the
 * bars in memory: the picker SEC rows (the Data Cache blob the pool already
 * reads -- 1 HGETALL on a miss), one MGET of the top names' report dates, the
 * 14 search-demand ZSETs (one pipeline). Writes 1 SET. Never throws: a failure
 * is reported in the job's result, never a failed night.
 */
export async function writeInsightCandidates(
  r: SetClient,
  bars: ReadonlyMap<string, EodBar[]>,
  asOf: string,
  nowMs: number
): Promise<{ ok: true; ranked: number; buzz: string | null } | { ok: false; error: string }> {
  try {
    const { readSecCapRows } = await import("./tiingoPool");
    const { readReportDatesBulk } = await import("./secReportDatesStore");
    const { readSearchDemand } = await import("./searchDemand");
    const secRows = (await readSecCapRows().catch(() => null)) ?? {};
    const dashed = new Map<string, EodBar[]>();
    for (const [s, b] of bars) dashed.set(toDashed(s), b);
    const top = capRanked(dashed, secRows).slice(0, INSIGHT_UNIVERSE).map((x) => x.symbol);
    const demand = await readSearchDemand(50).catch(() => []);
    const want = [...new Set([...top, ...demand.map((d) => toDashed(String(d.symbol).toUpperCase()))])];
    const rd = await readReportDatesBulk(want);
    const reportDates = rd.ok ? rd.recs : new Map<string, StoredReportDates | null>();
    // To the second: a millisecond part ("00.000") would read as a figure to the guard.
    const at = new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, "Z");
    const value = selectInsightCandidates({ asOf, bars: dashed, secRows, reportDates, demand }, at);
    const bad = insightKeyViolations(value);
    if (bad.length) return { ok: false, error: `refused: ${bad[0]}` };
    await r.set(INSIGHT_CANDIDATES_KEY, JSON.stringify(value), { ex: INSIGHT_CANDIDATES_TTL_SECONDS });
    return { ok: true, ranked: value.ranked.length, buzz: value.buzz?.symbol ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
