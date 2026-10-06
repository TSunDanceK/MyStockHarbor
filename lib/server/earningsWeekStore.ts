// THE READS AND THE BACKGROUND FILL BEHIND "EARNINGS THIS WEEK" (#552 COWORK #170).
// The rules themselves are pure, in earningsWeek.ts.
//
// ── WHAT ONE RENDER READS ────────────────────────────────────────────────
//   the day lists     the month index the calendar already reads (one HGETALL,
//                     memoised 6h per instance; two across a month boundary);
//   market cap        one HMGET of the price pool, for the sort only;
//   the row figures   ONE MGET of the strip's 14 keys (7 SEC-derived, 7 Tiingo);
//   the latest close  the Tiingo last-bar blob (one HGETALL, Data Cache 24h).
// So about 4 commands a warm render, whatever the day count. No SEC request.
//
// ── WHY THE ROW FIGURES ARE PRECOMPUTED ─────────────────────────────────
// Revenue, EPS and the close before the filing need three per-symbol reads
// each (the report-dates record, the fact set, the bar history) — a peak
// week is several hundred. That is a job's cost, not a page's, so the page's
// existing after() fills them a few dozen symbols at a time behind the same
// once-per-five-minutes gate, and the render reads the results in one MGET.
// A row not yet filled shows "—", never a guess.
//
// TWO KEYS PER DAY, by owner. The SEC-derived figures sit under msh:; the
// close before the filing is Tiingo data, so it lives under msh:tiingo:, where
// the Tiingo clean-up reaches it (the rule earningsCalendar.stripPoolPrices
// follows for the day blobs).
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { canWriteSecState } from "./secWriteGate";
import { readFactSet } from "./secFactStore";
import { readReportDates } from "./secReportDatesStore";
import { buildSecEarningsView } from "./secEarningsView";
import { moneyIsUsd, unitOf } from "./pickersSecFundamentals";
import { readTiingoHistory } from "./marketData/read";
import { TIINGO_PREFIX } from "./marketData/keys";
import { closeBeforeFiling, figuresForAnnouncement, type ReportedFigures } from "./earningsWeek";

// THE PAGE-READ CLIENT, WITH ITS DEADLINE (#553 CODE-B #144): the same
// options every page-path client carries.
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? Redis.fromEnv(PAGE_READ_CACHE) : null;

/** A preview fills and reads its own copy; production's is written by production only. */
const scoped = (key: string) => (canWriteSecState() ? key : `${key}:preview`);
export const weekFiguresKey = (date: string) => scoped(`msh:earnings-week:figures:v1:${date}`);
export const weekCloseKey = (date: string) => scoped(`${TIINGO_PREFIX}earnings-week:close-before:v1:${date}`);
/** Ten days: the strip is seven, and a day leaves it before its keys lapse. */
const WEEK_TTL_SECONDS = 10 * 24 * 60 * 60;
/** A symbol whose figures were not there yet (the 10-Q comes after the press release) is retried after this. */
export const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

/** Per symbol: the figures for the announced period, or null with when it was last tried. */
export type FiguresEntry = { f: ReportedFigures | null; at: number };
export type CloseEntry = { d: string; c: number } | { d: null; at: number };
export type DayFigures = Record<string, FiguresEntry>;
export type DayCloses = Record<string, CloseEntry>;

const parseJson = <T,>(v: unknown): T | null => {
  if (v == null) return null;
  if (typeof v === "string") { try { return JSON.parse(v) as T; } catch { return null; } }
  return typeof v === "object" ? (v as T) : null;
};

/** The strip's figures and closes, in ONE MGET. A failed read is empty: the rows show "—". */
export async function readWeekFigures(days: readonly string[]): Promise<{ figures: Map<string, DayFigures>; closes: Map<string, DayCloses> }> {
  const figures = new Map<string, DayFigures>(), closes = new Map<string, DayCloses>();
  if (!redis || !days.length) return { figures, closes };
  try {
    const keys = [...days.map(weekFiguresKey), ...days.map(weekCloseKey)];
    const vals = await redis.mget<unknown[]>(...keys);
    days.forEach((d, i) => {
      figures.set(d, parseJson<DayFigures>(vals?.[i]) ?? {});
      closes.set(d, parseJson<DayCloses>(vals?.[days.length + i]) ?? {});
    });
  } catch {
    // fail open
  }
  return { figures, closes };
}

/** What one symbol needs filled on one day. */
export function needsFill(f: FiguresEntry | undefined, c: CloseEntry | undefined, nowMs: number): { figures: boolean; close: boolean } {
  return {
    figures: !f || (f.f === null && nowMs - f.at >= RETRY_AFTER_MS),
    close: !c || (c.d === null && nowMs - c.at >= RETRY_AFTER_MS),
  };
}

/**
 * Fill the strip's missing figures and closes, newest day first, at most
 * `maxSymbols` symbols a run (three reads each). Called from the page's
 * after(), behind claimCalendarScan's once-per-five-minutes gate.
 */
export async function fillWeekFigures(
  /** Per day, each row's shown ticker and the ticker its announcement record is under (MKC and MKC-V, #552 COWORK #174). */
  daySymbols: ReadonlyMap<string, readonly { symbol: string; source: string }[]>,
  opts: { maxSymbols?: number; nowMs?: number } = {},
): Promise<{ symbols: number; days: number }> {
  if (!redis) return { symbols: 0, days: 0 };
  const max = opts.maxSymbols ?? 30;
  const now = opts.nowMs ?? Date.now();
  const days = [...daySymbols.keys()].sort().reverse();
  const { figures, closes } = await readWeekFigures(days);
  let done = 0, touched = 0;
  for (const date of days) {
    if (done >= max) break;
    const f = figures.get(date) ?? {}, c = closes.get(date) ?? {};
    let changed = false;
    for (const { symbol, source } of daySymbols.get(date) ?? []) {
      if (done >= max) break;
      const need = needsFill(f[symbol], c[symbol], now);
      if (!need.figures && !need.close) continue;
      done++; changed = true;
      const rec = await readReportDates(source).catch(() => null);
      const event = rec?.events.find((e) => e.announcedOn === date) ?? null;
      if (need.figures) {
        let got: ReportedFigures | null = null;
        const set = event?.periodEnd ? await readFactSet(source).catch(() => null) : null;
        if (set && moneyIsUsd(unitOf(set))) {
          const v = buildSecEarningsView(set);
          const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
          got = v && figuresForAnnouncement(event?.periodEnd ?? null, {
            end: v.latestEnd ?? null,
            revenue: num(v.snapshot.revenue.val),
            revenueYoY: num(v.snapshot.revenueYoY),
            epsDiluted: num(v.snapshot.epsDiluted.val),
          });
        }
        f[symbol] = { f: got, at: now };
      }
      if (need.close) {
        const eod = await readTiingoHistory(symbol).catch(() => null);
        const before = eod ? closeBeforeFiling(eod.bars as unknown as [string, ...unknown[]][], date, event?.timing ?? null) : null;
        c[symbol] = before ? { d: before.date, c: before.close } : { d: null, at: now };
      }
    }
    if (changed) {
      touched++;
      try {
        await redis.set(weekFiguresKey(date), f, { ex: WEEK_TTL_SECONDS });
        await redis.set(weekCloseKey(date), c, { ex: WEEK_TTL_SECONDS });
      } catch {
        // best-effort; the next run retries
      }
    }
  }
  return { symbols: done, days: touched };
}
