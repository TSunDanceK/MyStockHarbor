// THE NEWEST STORED BAR PER SYMBOL, AND WHAT THE SECTOR PAGES NEED FROM THE REST
// (step 5, #553 COWORK #98 rulings 1, 4 and 5).
//
// WHY A SUMMARY AND NOT THE BARS. Every pool reader (Pickers, the sector pages,
// the earnings calendar, the warm jobs) needs, per symbol, only the newest
// consolidated bar and the close before it: the newer-of price
// (pickSurfacePrice), the move measured from the stored close, and the EOD-only
// volume. Reading each symbol's ~1,400-bar history for that would be one Data
// Cache entry per symbol per page (a sector page alone samples 275), so the
// nightly job, which already holds every symbol's bars in memory, writes this
// one hash instead and the readers read ONE cached blob (read.ts
// readTiingoEodLast).
//
// The sector week / month / YTD moves and the MA50 / MA200 breadth flags ride
// along for the same reason: computed here from the same stored bars, once a
// night, rather than per sector per page from 20-25 histories each.
//
// PURE: no imports but types and the spelling rule, so the checks load it in bare Node.
import type { EodBar } from "./types";
import { toDashed } from "../../symbolSpellings.mjs";

/** One symbol's row in the TIINGO_EOD_LAST_KEY hash. Short keys: ~150 B a row. */
export type EodLast = {
  /** Date of the newest stored bar, YYYY-MM-DD (the ET trading day). */
  d: string;
  o: number;
  h: number;
  l: number;
  /** The consolidated close of that day. */
  c: number;
  /** That day's consolidated volume (split-adjusted). The only volume shown. */
  v: number;
  /** The stored close of the session before `d`, or null. */
  pc: number | null;
  /** % move from the close 5 sessions earlier. */
  w: number | null;
  /** % move from the last close on or before the same day a month earlier. */
  m: number | null;
  /** % move from the last close of the previous calendar year. */
  y: number | null;
  /** Last close above its 50-session mean; null under 200 bars (breadth judges both or neither). */
  a50: boolean | null;
  /** Last close above its 200-session mean; null under 200 bars. */
  a200: boolean | null;
};

const pos = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const pct = (to: number, from: number | null | undefined) => (pos(from) ? ((to - from) / from) * 100 : null);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** YYYY-MM-DD one calendar month before `iso` (clamped to the month's last day). */
export function monthBefore(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  return `${py}-${String(pm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** The newest close dated on or before `date`, or null. */
function closeOnOrBefore(bars: EodBar[], date: string): number | null {
  for (let i = bars.length - 1; i >= 0; i--) if (bars[i][0] <= date && pos(bars[i][4])) return bars[i][4];
  return null;
}

/** The summary row for one symbol's stored bars (oldest first), or null if the newest bar has no close. */
export function eodLastRow(bars: EodBar[]): EodLast | null {
  const n = bars.length;
  if (!n) return null;
  const [d, o, h, l, c, v] = bars[n - 1];
  if (!pos(c)) return null;
  const closes = bars.map((b) => b[4]).filter(pos);
  const enough = closes.length >= 200;
  return {
    d,
    o,
    h,
    l,
    c,
    v: Number.isFinite(v) ? v : 0,
    pc: n >= 2 && pos(bars[n - 2][4]) ? bars[n - 2][4] : null,
    w: n >= 6 ? pct(c, bars[n - 6][4]) : null,
    m: pct(c, closeOnOrBefore(bars.slice(0, -1), monthBefore(d))),
    y: pct(c, closeOnOrBefore(bars, `${Number(d.slice(0, 4)) - 1}-12-31`)),
    a50: enough ? c > mean(closes.slice(-50)) : null,
    a200: enough ? c > mean(closes.slice(-200)) : null,
  };
}

/** Parse one stored value (the client may already have parsed it). Exported for the checks. */
export function parseEodLast(value: unknown): EodLast | null {
  let v: unknown = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const r = v as EodLast;
  return typeof r.d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.d) && pos(r.c) ? r : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "1 Oct" for a YYYY-MM-DD date, or null. Parsed by hand: no time zone can move the day. */
export function closeDayLabel(date: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ""));
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month}` : null;
}

/** "Last close · 1 Oct" (the "Sector today" label, COWORK #98 ruling 4), or null. */
export function lastCloseLabel(date: string | null | undefined): string | null {
  const day = closeDayLabel(date);
  return day ? `Last close · ${day}` : null;
}

// ── the sector panels' reads of it (sectorPanels.ts, step 5) ────────────────

/** The stored move of a bar from the close before it, or null. */
export function eodDayMove(r: EodLast | null | undefined): number | null {
  return r && typeof r.pc === "number" && r.pc > 0 ? ((r.c - r.pc) / r.pc) * 100 : null;
}

/**
 * The newest bar date among `symbols`, and only the rows dated that day: one
 * ranking never mixes two sessions (the rule the 30-minute gate kept for live
 * quotes). Rows come back under the caller's spelling.
 */
export function lastCloseRows(
  symbols: string[],
  eod: Record<string, EodLast>
): { date: string | null; rows: Map<string, EodLast> } {
  let date: string | null = null;
  for (const s of symbols) {
    const r = eod[toDashed(s)];
    if (r && (!date || r.d > date)) date = r.d;
  }
  const rows = new Map<string, EodLast>();
  if (date) {
    for (const s of symbols) {
      const r = eod[toDashed(s)];
      if (r && r.d === date) rows.set(s, r);
    }
  }
  return { date, rows };
}

/** Breadth from the stored flags; a symbol under 200 bars has neither and is not sampled. */
export function eodBreadth(symbols: string[], eod: Record<string, EodLast>): { sampled: number; above50: number; above200: number } {
  let sampled = 0;
  let above50 = 0;
  let above200 = 0;
  for (const symbol of symbols) {
    const r = eod[toDashed(symbol)];
    if (!r || r.a50 == null || r.a200 == null) continue;
    sampled += 1;
    if (r.a50) above50 += 1;
    if (r.a200) above200 += 1;
  }
  return { sampled, above50, above200 };
}
