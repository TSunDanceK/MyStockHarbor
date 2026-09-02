import { NextResponse } from "next/server";

import {
  checkBackfillKey,
  checkBackfillLockout,
  clearBackfillFailures,
  getClientIp,
  recordBackfillFailure,
} from "@/lib/server/backfillAuth";
import { fetchMonthRows } from "@/lib/server/earningsCalendar";
import { PRESET_UNIVERSE } from "@/lib/server/presetUniverse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ─────────────────────────────────────────────────────────────────────────────
// MEASUREMENT ONLY. How concentrated is earnings season, really?
//
// WHY IT EXISTS. Every sizing decision downstream of warm-earnings rests on
// "~70% of companies report within ~20 trading days". THAT IS AN ESTIMATE, and
// this project's estimates have a record: $5.7B against a measured $9.66B
// screener floor, 23% against a measured 75% price-derived share, the universe
// cap against the minute guard. EARNINGS_BATCH_SIZE is the next constant to be
// sized, and it should be sized on a number somebody counted.
//
// WHY A ROUTE AND NOT A SCRIPT. The calendar is reachable from production and
// from nowhere else: a Claude sandbox cannot reach financialmodelingprep.com
// (CONNECT tunnel 403, re-verified 2026-09-02) and holds no FMP key and no
// Upstash credentials. Same reasoning, and the same shape, as
// /api/debug/symbol-changes.
//
// COST. fetchMonthRows reads the shared reference cache first
// (msh:reference:v1:earnings-calendar:<YYYY-MM>, daily TTL) and only calls FMP
// on a miss -- so this is at most one FMP call per requested month, and zero
// for a month already cached. Capped at three months.
//
// THE OBVIOUS WINDOW IS THE WRONG ONE. Probe Q6 measured 29 Aug -> 2 Oct, which
// falls BETWEEN reporting seasons and understates the peak badly. The default
// below is mid-January to February -- a real season. Pass ?months= to choose.
//
// TWO DISTRIBUTIONS, because they may not agree. `all` is every symbol FMP
// lists a date for (~10k names, most of them micro-caps this site never warms).
// `preset` is PRESET_UNIVERSE, ~100 mega-caps -- a proxy for the part of the
// universe that actually matters, since large caps cluster in the middle weeks
// of a season rather than spreading like the tail does. If the two shares
// differ materially, the `preset` one is the one to size against.
//
// NOTHING IS CHANGED BY THIS ROUTE. It does not write, and it does not touch
// EARNINGS_BATCH_SIZE. The constant comes after the measurement -- see
// claude/earnings-season-measurement-2026-09-02.md for the window to ask for,
// how to read an empty answer, and what sits on top of the number before it
// becomes a batch size.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_MONTHS = 3;
const DEFAULT_MONTHS = ["2026-01", "2026-02"];

type DayCount = { date: string; symbols: number };

type Distribution = {
  label: string;
  distinctSymbols: number;
  tradingDays: number;
  /** Every trading day, busiest first. The whole curve, not a summary of it. */
  byDay: DayCount[];
  busiestDay: DayCount | null;
  shareInBusiest10Days: number | null;
  shareInBusiest20Days: number | null;
  /** What one day at the peak implies for a universe of N symbols. */
  impliedPeakDayRefreshes: Record<string, number> | null;
};

function isWeekday(iso: string) {
  const day = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

function distribute(
  label: string,
  pairs: Array<{ symbol: string; date: string }>,
  universeSizes: number[]
): Distribution {
  // DISTINCT SYMBOL-DAYS. earnings-calendar routinely repeats a symbol -- the
  // same ticker appears on several rows for one date -- so counting rows would
  // count the same company's report two or three times and overstate the peak.
  const seen = new Set<string>();
  const perDay = new Map<string, Set<string>>();
  for (const { symbol, date } of pairs) {
    if (!symbol || !date || !isWeekday(date)) continue;
    seen.add(symbol);
    let bucket = perDay.get(date);
    if (!bucket) perDay.set(date, (bucket = new Set()));
    bucket.add(symbol);
  }

  const byDay = [...perDay.entries()]
    .map(([date, symbols]) => ({ date, symbols: symbols.size }))
    .sort((a, b) => b.symbols - a.symbols || a.date.localeCompare(b.date));

  // THE DENOMINATOR IS SYMBOL-DAYS, NOT DISTINCT SYMBOLS. A symbol reporting
  // twice inside the window (rare, but it happens across a quarter boundary)
  // is two pieces of work, and the question here is how much work lands on the
  // busiest days -- not how many companies exist.
  const totalSymbolDays = byDay.reduce((sum, d) => sum + d.symbols, 0);
  const shareOf = (n: number) =>
    totalSymbolDays > 0
      ? byDay.slice(0, n).reduce((sum, d) => sum + d.symbols, 0) / totalSymbolDays
      : null;

  const busiestDay = byDay[0] ?? null;
  const peakShare =
    busiestDay && totalSymbolDays > 0 ? busiestDay.symbols / totalSymbolDays : null;

  return {
    label,
    distinctSymbols: seen.size,
    tradingDays: byDay.length,
    byDay,
    busiestDay,
    shareInBusiest10Days: shareOf(10),
    shareInBusiest20Days: shareOf(20),
    impliedPeakDayRefreshes:
      peakShare === null
        ? null
        : Object.fromEntries(
            universeSizes.map((size) => [String(size), Math.ceil(size * peakShare)])
          ),
  };
}

export async function GET(request: Request) {
  const ip = getClientIp(request);
  const lockout = await checkBackfillLockout(ip);
  if (lockout.locked) {
    return NextResponse.json(
      { error: "Too many attempts.", retryAfterSeconds: lockout.retryAfterSeconds },
      { status: 429 }
    );
  }

  const url = new URL(request.url);
  if (!checkBackfillKey(url.searchParams.get("key") ?? "")) {
    await recordBackfillFailure(ip);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await clearBackfillFailures(ip);

  const requested = (url.searchParams.get("months") ?? DEFAULT_MONTHS.join(","))
    .split(",")
    .map((m) => m.trim())
    .filter((m) => /^\d{4}-\d{2}$/.test(m))
    .slice(0, MAX_MONTHS);

  if (!requested.length) {
    return NextResponse.json(
      { error: "months must be one to three YYYY-MM values" },
      { status: 400 }
    );
  }

  const universeSizes = [1500, 3000];
  const presetSet = new Set(PRESET_UNIVERSE.map((s) => s.trim().toUpperCase()));

  const pairs: Array<{ symbol: string; date: string }> = [];
  const perMonth: Array<{ month: string; rows: number }> = [];
  for (const month of requested) {
    const [year, mon] = month.split("-").map(Number);
    const rows = await fetchMonthRows(year, mon);
    perMonth.push({ month, rows: rows.length });
    for (const row of rows) {
      const symbol = String(row?.symbol ?? "").trim().toUpperCase();
      const date = String(row?.date ?? "").slice(0, 10);
      if (symbol && /^\d{4}-\d{2}-\d{2}$/.test(date)) pairs.push({ symbol, date });
    }
  }

  // AN EMPTY MONTH IS NOT A ZERO. fetchMonthRows returns [] on a 402, a network
  // failure or a missing key just as it does for a genuinely empty month, so a
  // measurement built on it would report a beautifully flat distribution and
  // mean nothing. Said out loud rather than left for the reader to notice.
  const emptyMonths = perMonth.filter((m) => m.rows === 0).map((m) => m.month);

  return NextResponse.json({
    ok: emptyMonths.length === 0,
    months: perMonth,
    emptyMonths,
    warning: emptyMonths.length
      ? "One or more months returned no rows. fetchMonthRows returns [] for a " +
        "plan restriction, a network failure and an empty month alike — treat " +
        "this result as unmeasured, not as flat."
      : null,
    universeSizes,
    distributions: [
      distribute("all", pairs, universeSizes),
      distribute(
        "preset",
        pairs.filter((p) => presetSet.has(p.symbol)),
        universeSizes
      ),
    ],
    howToRead:
      "shareInBusiest20Days is the number the '~70% in ~20 trading days' " +
      "estimate was guessing at. impliedPeakDayRefreshes is how many symbols " +
      "of a universe that size report on the single busiest day — the floor " +
      "for EARNINGS_BATCH_SIZE if the job keeps running once a day, before " +
      "any allowance for the 12h post-report re-fetch or for retries.",
  });
}
