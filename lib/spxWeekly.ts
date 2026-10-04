// THE SPX PAGE'S WEEKLY FIGURES (#563 COWORK #90): researched once a week and
// kept in content/markets/spx-weekly.json, not inside the page's JSX. The
// weekly scheduled task edits only that file; the page reads it at render time
// through parseSpxWeekly, so a malformed file shows no weekly figures rather
// than wrong ones.
//
// Everything LIVE on the page (trend score, performance, levels, signals,
// charts) comes from SPY's bars instead; this file carries what a price series
// can't: the index's own close, its all-time high, the week's three points,
// breadth, sentiment and what to watch.
//
// STALE: an asOf more than STALE_DAYS old makes the hero read "Last weekly
// update: <date>" and the weekly tiles show their dates, so old figures never
// pass for current ones.
//
// COPY: descriptive and hedged; no buy/sell/should wording (FORBIDDEN).

export const STALE_DAYS = 10;
export const ONE_LINER_MAX = 160;
export const POINT_MAX = 140;
export const WATCH_MAX = 140;
// #563 COWORK #91: an SEO page first, so the written analysis has floors as well
// as caps; a lazy week can't publish one-liners.
export const INTRO_MIN = 150, INTRO_MAX = 500;
export const SECTION_MIN = 120, SECTION_MAX = 600, SECTION_HEADING_MAX = 60;
export const MARKET_READ_MIN = 1400, MARKET_READ_MAX = 2200, PARAGRAPH_MIN = 200;
export const WATCH_MIN = 40;
/** The visuals that each get a write-up beneath them. */
export const SECTION_KEYS = ["performance", "chart", "levels", "signals", "change"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
export const SENTIMENT_LABELS = ["Extreme Fear", "Fear", "Neutral", "Greed", "Extreme Greed"] as const;
/** Advice words a reader could take as a call; never in the weekly copy. */
export const FORBIDDEN = /\b(buy|buying|sell|selling|should|must|recommend(?:s|ed)?)\b/i;

export type SpxWeekly = {
  /** The session the figures describe (the index close's date), YYYY-MM-DD. */
  asOf: string;
  /** The S&P 500 index close on `asOf` (the index, not SPY). */
  indexClose: number;
  ath: { level: number; date: string };
  oneLiner: string;
  /** 2–3 sentences under the H1: the page's main text (#91). */
  intro: string;
  /** A short write-up beneath each visual, saying what it shows this week (#91). */
  sections: Record<SectionKey, { heading?: string; body: string }>;
  /** The Market read: 2–4 paragraphs, 1,400–2,200 characters in all (#91). */
  marketRead: string[];
  points: { label: string; text: string }[];
  /** % of S&P 500 stocks above their 200-day (and 50-day) average; null when the week's research has none. */
  breadth: { pct200: number | null; pct50?: number | null; source: string; date: string };
  sentiment: { fearGreed: number; label: (typeof SENTIMENT_LABELS)[number]; source: string; date: string };
  targets?: { low: number; high: number; source: string }[];
  watchDown: string[];
  watchUp: string[];
};

export type SpxWeeklyRead = { ok: true; data: SpxWeekly } | { ok: false; problems: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isPos = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** A real calendar date in YYYY-MM-DD. */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Every string in the file, for the wording rule. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (isObj(v)) Object.values(v).forEach((x) => strings(x, out));
  return out;
}

/** The file, checked: its shape and types, valid dates, length caps, no advice words. */
export function parseSpxWeekly(raw: unknown): SpxWeeklyRead {
  const p: string[] = [];
  if (!isObj(raw)) return { ok: false, problems: ["not an object"] };
  const r = raw as Record<string, unknown>;
  if (!isIsoDate(r.asOf)) p.push("asOf: not a valid YYYY-MM-DD date");
  if (!isPos(r.indexClose)) p.push("indexClose: not a positive number");
  if (!isObj(r.ath) || !isPos(r.ath.level) || !isIsoDate(r.ath.date)) p.push("ath: needs level (positive number) and date (YYYY-MM-DD)");
  if (!isStr(r.oneLiner)) p.push("oneLiner: missing");
  else if (r.oneLiner.length > ONE_LINER_MAX) p.push(`oneLiner: ${r.oneLiner.length} characters, over ${ONE_LINER_MAX}`);
  const sentences = (t: string) => (t.match(/[.!?](\s|$)/g) ?? []).length;
  if (!isStr(r.intro)) p.push("intro: missing");
  else {
    if (r.intro.length < INTRO_MIN || r.intro.length > INTRO_MAX) p.push(`intro: ${r.intro.length} characters, needs ${INTRO_MIN}–${INTRO_MAX}`);
    if (sentences(r.intro) < 2 || sentences(r.intro) > 3) p.push(`intro: ${sentences(r.intro)} sentences, needs 2–3`);
  }
  if (!isObj(r.sections)) p.push("sections: missing");
  else for (const k of SECTION_KEYS) {
    const sec = (r.sections as Record<string, unknown>)[k];
    if (!isObj(sec) || !isStr(sec.body)) { p.push(`sections.${k}: needs a body`); continue; }
    const len = (sec.body as string).length;
    if (len < SECTION_MIN || len > SECTION_MAX) p.push(`sections.${k}: ${len} characters, needs ${SECTION_MIN}–${SECTION_MAX}`);
    if (sec.heading !== undefined && !(isStr(sec.heading) && (sec.heading as string).length <= SECTION_HEADING_MAX)) p.push(`sections.${k}.heading: up to ${SECTION_HEADING_MAX} characters`);
  }
  if (!Array.isArray(r.marketRead) || r.marketRead.length < 2 || r.marketRead.length > 4 || !r.marketRead.every(isStr)) p.push("marketRead: 2 to 4 paragraphs");
  else {
    const total = (r.marketRead as string[]).reduce((a, x) => a + x.length, 0);
    if (total < MARKET_READ_MIN || total > MARKET_READ_MAX) p.push(`marketRead: ${total} characters, needs ${MARKET_READ_MIN}–${MARKET_READ_MAX}`);
    (r.marketRead as string[]).forEach((x, i) => { if (x.length < PARAGRAPH_MIN) p.push(`marketRead[${i}]: ${x.length} characters, under ${PARAGRAPH_MIN}`); });
  }
  if (!Array.isArray(r.points) || r.points.length !== 3) p.push("points: needs exactly 3");
  else r.points.forEach((pt, i) => {
    if (!isObj(pt) || !isStr(pt.label) || !isStr(pt.text)) p.push(`points[${i}]: needs label and text`);
    else if ((pt.text as string).length > POINT_MAX) p.push(`points[${i}]: ${(pt.text as string).length} characters, over ${POINT_MAX}`);
  });
  const b = r.breadth;
  if (!isObj(b) || !isStr(b.source) || !isIsoDate(b.date)) p.push("breadth: needs source and date");
  else {
    for (const k of ["pct200", "pct50"] as const) {
      const v = b[k];
      if (v === undefined && k === "pct50") continue;
      if (!(v === null || (typeof v === "number" && v >= 0 && v <= 100))) p.push(`breadth.${k}: a % from 0 to 100, or null`);
    }
  }
  const s = r.sentiment;
  if (!isObj(s) || !isStr(s.source) || !isIsoDate(s.date)) p.push("sentiment: needs source and date");
  else {
    if (!(typeof s.fearGreed === "number" && Number.isInteger(s.fearGreed) && s.fearGreed >= 0 && s.fearGreed <= 100)) p.push("sentiment.fearGreed: a whole number from 0 to 100");
    if (!SENTIMENT_LABELS.includes(s.label as (typeof SENTIMENT_LABELS)[number])) p.push(`sentiment.label: one of ${SENTIMENT_LABELS.join(", ")}`);
  }
  if (r.targets !== undefined && !(Array.isArray(r.targets) && r.targets.every((t) => isObj(t) && isPos(t.low) && isPos(t.high) && (t.low as number) <= (t.high as number) && isStr(t.source))))
    p.push("targets: each needs low ≤ high and a source");
  for (const k of ["watchDown", "watchUp"] as const) {
    const w = r[k];
    if (!Array.isArray(w) || w.length < 3 || w.length > 4 || !w.every(isStr)) p.push(`${k}: 3 to 4 sentences`);
    else w.forEach((x, i) => {
      const t = x as string;
      if (t.length < WATCH_MIN || t.length > WATCH_MAX) p.push(`${k}[${i}]: ${t.length} characters, needs ${WATCH_MIN}–${WATCH_MAX}`);
      if (!/^[A-Z0-9]/.test(t) || !/[.!?]$/.test(t)) p.push(`${k}[${i}]: a full sentence (a capital, a full stop)`);
    });
  }
  const advice = strings(raw).filter((x) => FORBIDDEN.test(x));
  if (advice.length) p.push(`advice wording: ${advice.map((x) => `"${x.match(FORBIDDEN)![0]}"`).join(", ")}`);
  return p.length ? { ok: false, problems: p } : { ok: true, data: raw as unknown as SpxWeekly };
}

/** True when `asOf` is more than STALE_DAYS before `nowMs`. */
export function isStale(asOf: string, nowMs: number): boolean {
  return nowMs - Date.parse(`${asOf}T00:00:00Z`) > STALE_DAYS * 86_400_000;
}

/** "Fri 2 Oct 2026" */
export function weeklyDate(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  return t.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** "7,722.72" */
export const indexWords = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
