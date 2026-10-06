// "EARNINGS THIS WEEK" (#552 COWORK #170, owner pick): the last seven days of
// results filed, who reported on each, and a compact "coming up".
//
// PURE. Every rule the page draws by lives here so a check can drive it on
// fixtures with a mutant per rule; the reads and the background fill are in
// earningsWeekStore.ts.
//
//   the strip      today and the six calendar days before it, oldest first;
//   the selection  today if it has filings, else the newest day that does;
//   a row          revenue (with YoY) and diluted EPS for the PERIOD THE
//                  ANNOUNCEMENT COVERS, never simply the newest stored one;
//                  "Shares since" from the last close before the filing to
//                  the latest close;
//   coming up      the estimates, in four week windows from today.

const DAY = 86_400_000;
const parse = (d: string) => Date.parse(`${d}T00:00:00.000Z`);
export const addDays = (d: string, n: number) => new Date(parse(d) + n * DAY).toISOString().slice(0, 10);

/** The strip's days: today and the six calendar days before it, oldest first. */
export const STRIP_DAYS = 7;
export function weekDays(today: string): string[] {
  return Array.from({ length: STRIP_DAYS }, (_, i) => addDays(today, i - (STRIP_DAYS - 1)));
}

/** Today if it has filings, otherwise the most recent day in the strip that has some (today when none does). */
export function defaultDay(days: readonly string[], counts: ReadonlyMap<string, number>, today: string): string {
  if ((counts.get(today) ?? 0) > 0) return today;
  for (let i = days.length - 1; i >= 0; i--) if ((counts.get(days[i]) ?? 0) > 0) return days[i];
  return today;
}

/** The tile's pill: the count; "0" on today until the first filing; "—" on a past day with none. */
export function countPill(count: number, isToday: boolean): string {
  if (count > 0) return String(count);
  return isToday ? "0" : "—";
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dow = (d: string) => new Date(parse(d)).getUTCDay();
const dayNum = (d: string) => Number(d.slice(8, 10));
const mon = (d: string) => Number(d.slice(5, 7)) - 1;

/** "Mon" / "5 Oct", the tile's two lines. */
export const tileWeekday = (d: string) => WEEKDAY[dow(d)];
export const tileDate = (d: string) => `${dayNum(d)} ${MONTH[mon(d)]}`;
/** "THURSDAY 1 OCTOBER · 4 COMPANIES" (upper-cased by the page). */
export function dayEyebrow(d: string, count: number): string {
  return `${WEEKDAY_LONG[dow(d)]} ${dayNum(d)} ${MONTH_LONG[mon(d)]} · ${count} ${count === 1 ? "company" : "companies"}`;
}
/** "30 Sep 2026": a filed date in the page's short form. */
export const shortDate = (d: string) => `${dayNum(d)} ${MONTH[mon(d)]} ${d.slice(0, 4)}`;
/** "Thursday 1 October", for the empty-day line. */
export const dayLong = (d: string) => `${WEEKDAY_LONG[dow(d)]} ${dayNum(d)} ${MONTH_LONG[mon(d)]}`;

// ── A ROW'S FIGURES ─────────────────────────────────────────────────────────

/**
 * The close the move is measured from: the last close BEFORE the filing.
 * Filed after the close, that day's own close came before it; filed before the
 * open or during the session, the previous trading day's did. Bars oldest
 * first, `[date, …, close at index 4]` as stored.
 */
export function closeBeforeFiling(
  bars: readonly (readonly [string, ...unknown[]])[],
  announcedOn: string,
  timing: "before-open" | "during-market" | "after-close" | null,
): { date: string; close: number } | null {
  const sameDayCounts = timing === "after-close";
  for (let i = bars.length - 1; i >= 0; i--) {
    const d = String(bars[i][0]).slice(0, 10);
    if (d < announcedOn || (sameDayCounts && d === announcedOn)) {
      const c = Number(bars[i][4]);
      return Number.isFinite(c) && c > 0 ? { date: d, close: c } : null;
    }
  }
  return null;
}

/** The move from the close before the filing to the latest close, %; null when either is missing or the latest predates it. */
export function sharesSince(before: { date: string; close: number } | null, latest: { date: string; close: number } | null): number | null {
  if (!before || !latest || !(before.close > 0) || !(latest.close > 0) || latest.date < before.date) return null;
  return ((latest.close - before.close) / before.close) * 100;
}

/**
 * THE FIGURES FOR THE ANNOUNCED PERIOD, OR NONE. The announcement (an 8-K
 * press release) usually comes days or weeks before the 10-Q carries the
 * tagged figures; until it does, the newest stored quarter is the PREVIOUS
 * one, and printing it beside today's announcement would be the wrong
 * quarter's revenue. So the figures show only when the stored latest period
 * ends on the period the announcement was matched to.
 */
export type ReportedFigures = {
  periodEnd: string;
  revenue: number | null;
  /** % vs the same period a year earlier; null when there is no comparable period. */
  revenueYoY: number | null;
  epsDiluted: number | null;
};
export function figuresForAnnouncement(
  announcedPeriodEnd: string | null,
  latest: { end: string | null; revenue: number | null; revenueYoY: number | null; epsDiluted: number | null } | null,
): ReportedFigures | null {
  if (!announcedPeriodEnd || !latest || latest.end !== announcedPeriodEnd) return null;
  return { periodEnd: announcedPeriodEnd, revenue: latest.revenue, revenueYoY: latest.revenueYoY, epsDiluted: latest.epsDiluted };
}

// ── ONE ROW PER FILER, UNDER ITS MOST-TRADED CLASS (#552 COWORK #174) ──────
//
// A filer with two common classes announces once: MKC and MKC-V are one
// McCormick 8-K. The row shows the class readers know — the most traded, by
// the pool's volume — and a class ticker whose base ticker is on the same CIK
// (MKC-V → MKC) offers that base as well, so a lone secondary class still
// shows as the primary. Ties: a ticker without a class suffix, then A–Z.
export const hasClassSuffix = (s: string) => /[-.][A-Z]{1,2}$/.test(s);
export const baseTicker = (s: string) => s.replace(/[-.][A-Z]{1,2}$/, "");
export function primaryPerFiler<T extends { symbol: string }>(
  rows: readonly T[],
  opts: { cikOf: (s: string) => string | null; siblingsOf: (s: string) => string[]; volumeOf: (s: string) => number | null },
): { row: T; symbol: string }[] {
  const groups = new Map<string, { row: T; symbols: Set<string> }>();
  for (const r of rows) {
    const key = opts.cikOf(r.symbol) ?? `sym:${r.symbol}`;
    const g = groups.get(key) ?? { row: r, symbols: new Set<string>() };
    g.symbols.add(r.symbol);
    for (const s of opts.siblingsOf(r.symbol)) g.symbols.add(s);
    groups.set(key, g);
  }
  return [...groups.values()].map(({ row, symbols }) => {
    const ranked = [...symbols].sort((a, b) =>
      (opts.volumeOf(b) ?? -1) - (opts.volumeOf(a) ?? -1)
      || Number(hasClassSuffix(a)) - Number(hasClassSuffix(b))
      || (a < b ? -1 : a > b ? 1 : 0));
    return { row, symbol: ranked[0] };
  });
}

// ── COMING UP: four week windows from today (#552 COWORK #179) ────────────
//
// THE COLUMNS ARE DATE WINDOWS, NOT DAYS: the dates are estimates, so a row
// says "this week" or "the week of 19 Oct", never a day. Column one is the
// rest of this week (today to Sunday); then the next three Mon–Sun weeks.
// They roll forward on Monday because they are computed from today.
//
// AN EMPTY "THIS WEEK" IS NOT A COLUMN (#552 COWORK #180): with nothing
// estimated and no due name for the rest of the week, the page says so in one
// line and the grid shows the next FOUR Mon–Sun weeks instead.

/** Monday of the week holding `d`. */
const mondayOf = (d: string) => addDays(d, -((dow(d) + 6) % 7));
/** "12–18 Oct"; "26 Oct–1 Nov" across a month; "11 Oct" for one day. */
export function dayRange(start: string, end: string): string {
  if (start === end) return `${dayNum(start)} ${MONTH[mon(start)]}`;
  return mon(start) === mon(end)
    ? `${dayNum(start)}–${dayNum(end)} ${MONTH[mon(end)]}`
    : `${dayNum(start)} ${MONTH[mon(start)]}–${dayNum(end)} ${MONTH[mon(end)]}`;
}

export const COMING_UP_COLUMNS = 4;
export type ComingUpColumn<T> = {
  key: string;
  /** "This week" / "Next week" / "Week of 19 Oct". */
  label: string;
  /** "12–18 Oct": column one starts today, not on Monday. */
  range: string;
  start: string;
  end: string;
  isThisWeek: boolean;
  items: T[];
};

/**
 * The four columns, each sorted by market cap, largest first; an unknown cap
 * last, then A–Z. A row estimated before today or after the last window is not
 * placed. Column one is the rest of this week, UNLESS it would be empty and
 * `thisWeekHasDue` is false: then the four are the next four Mon–Sun weeks
 * (the caller tells by `columns[0].isThisWeek`). A later week that is empty
 * stays, and says so.
 */
export function comingUpColumns<T extends { symbol: string; estimatedOn: string; cap: number | null }>(
  rows: readonly T[],
  today: string,
  opts: { thisWeekHasDue?: boolean } = {},
): ComingUpColumn<T>[] {
  const all = weekColumns(rows, today, COMING_UP_COLUMNS + 1);
  const skip = all[0].items.length === 0 && !opts.thisWeekHasDue;
  return skip ? all.slice(1) : all.slice(0, COMING_UP_COLUMNS);
}

function weekColumns<T extends { symbol: string; estimatedOn: string; cap: number | null }>(
  rows: readonly T[],
  today: string,
  count: number,
): ComingUpColumn<T>[] {
  const monday = mondayOf(today);
  const cols = Array.from({ length: count }, (_, w): ComingUpColumn<T> => {
    const weekStart = addDays(monday, 7 * w);
    const start = w === 0 ? today : weekStart;
    const end = addDays(weekStart, 6);
    const label = w === 0 ? "This week" : w === 1 ? "Next week" : `Week of ${dayNum(weekStart)} ${MONTH[mon(weekStart)]}`;
    return { key: `w${w}`, label, range: dayRange(start, end), start, end, isThisWeek: w === 0, items: [] };
  });
  for (const r of rows) {
    const col = cols.find((c) => r.estimatedOn >= c.start && r.estimatedOn <= c.end);
    if (col) col.items.push(r);
  }
  for (const c of cols) c.items.sort(byCapThenSymbol);
  return cols;
}

/**
 * ONE ROW PER COMPANY (#552 COWORK #180): GOOGL and GOOG are one Alphabet
 * row. Rows on the same CIK collapse to the class with the larger market cap
 * (ties: a ticker without a class suffix, then A–Z); the others ride along as
 * `also`, for a small "also GOOG". A row with no CIK on record stands alone.
 */
export function onePerCompany<T extends { symbol: string; cap: number | null }>(
  rows: readonly T[],
  cikOf: (symbol: string) => string | null,
): (T & { also: string[] })[] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const key = cikOf(r.symbol) ?? `sym:${r.symbol}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()].map((g) => {
    const [lead, ...rest] = [...g].sort((a, b) =>
      (b.cap ?? -1) - (a.cap ?? -1)
      || Number(hasClassSuffix(a.symbol)) - Number(hasClassSuffix(b.symbol))
      || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
    return { ...lead, also: [...new Set(rest.map((r) => r.symbol))].filter((s) => s !== lead.symbol) };
  });
}

/** Market cap, largest first; an unknown cap last; then A–Z. */
export const byCapThenSymbol = (a: { symbol: string; cap: number | null }, b: { symbol: string; cap: number | null }) =>
  (b.cap ?? -1) - (a.cap ?? -1) || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0);
