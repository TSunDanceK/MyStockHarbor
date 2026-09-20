// WHY ONE REPORT VANISHES FROM THE PRICE-REACTION CARDS.
//
// RYAAY's FY2021 renders on neither chart while FY2022, FY2023 and FY2025 do.
// The bounded bar window is the obvious suspect because it is the thing that
// changed — and "the thing that changed" is not evidence, so this computes
// BOTH paths against the real data and prints them side by side:
//
//   FULL     computeEarningsReactionDetail over the whole cached series, which
//            is what main does today
//   BOUNDED  the same function over the +/-45-day window the branch fetches
//
// IF THEY AGREE, the window is exonerated and the cause is upstream of it —
// most likely the bar series simply not reaching back to the report. That is a
// pre-existing gap the branch would merely be inheriting, and fixing the
// window would fix nothing.
//
// IF THEY DIFFER, the window is the cause and the difference names the report.
//
// Both functions are LIFTED from the shipped source, so this answers for the
// deployed code rather than for a transcription of it.
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();

const num = (src, n) => (readCodeOnly(src).match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const HISTORY_PREFIX = num("lib/server/historyCache.ts", "REDIS_HISTORY_PREFIX");
const DATES_PREFIX = num("lib/server/secReportDatesStore.ts", "SEC_REPORT_DATES_PREFIX");
for (const [n, v] of [["REDIS_HISTORY_PREFIX", HISTORY_PREFIX], ["SEC_REPORT_DATES_PREFIX", DATES_PREFIX]]) {
  if (!v) { console.error(`FATAL: could not read ${n} from source`); process.exit(2); }
}

const PAGE = readCodeOnly("app/stock/[symbol]/earnings/page.tsx");
const HIST = readCodeOnly("lib/server/historyCache.ts");
const WINDOW_DAYS = Number((PAGE.match(/BAR_WINDOW_DAYS = (\d+)/) ?? [])[1]);
const REPORTS = Number((PAGE.match(/REACTION_REPORTS = (\d+)/) ?? [])[1]);
if (!WINDOW_DAYS || !REPORTS) { console.error("FATAL: could not read the window constants"); process.exit(2); }

// THE CONSTANTS THE LIFTED FUNCTIONS NAME, READ FROM THE SOURCE AND SUPPLIED.
//
// computeEarningsReactionDetail closes over REACTION_SESSION_GAP_DAYS. A lift
// without it throws ReferenceError the moment the function is CALLED — after
// the header, the bar counts and the window have already printed, so it reads
// as a run that stopped rather than as a missing constant. That is the exact
// failure #474 fixed in the annual-filer census, and it has now happened three
// times in this repo; the constant is read from the source rather than pinned,
// so a change to it moves this with it.
const GAP_DAYS = Number((PAGE.match(/REACTION_SESSION_GAP_DAYS = (\d+)/) ?? [])[1]);
if (!GAP_DAYS) { console.error("FATAL: could not read REACTION_SESSION_GAP_DAYS"); process.exit(2); }

const mod = await lift(
  [
    `const REACTION_SESSION_GAP_DAYS = ${GAP_DAYS};`,
    grabFunction(PAGE, "computeEarningsReactionDetail"),
    grabFunction(HIST, "getDailyBars")
      .replace("export async function", "async function")
      // The store is not reachable from the slicing logic; the caller supplies
      // the series so what is measured is the RANGE, not the fetch.
      .replace("const all = await getDailyHistory(symbol, opts);", "const all = symbol;"),
    "export { computeEarningsReactionDetail, getDailyBars };",
  ].join("\n")
);

const SYMS = (process.env.SYMBOLS || "RYAAY,AAPL,CNI").split(/[,\s]+/).filter(Boolean);
const shiftIso = (iso, d) => new Date(Date.parse(iso) + d * 86400000).toISOString().slice(0, 10);

console.log("=".repeat(78));
console.log(`window +/-${WINDOW_DAYS} calendar days around the newest ${REPORTS} reports · session gap bound ${GAP_DAYS}d`);
console.log("=".repeat(78));

for (const symbol of SYMS) {
  console.log(`\n${"─".repeat(78)}\n${symbol}`);
  const rec = await redis.get(`${DATES_PREFIX}:${symbol}`);
  const entry = await redis.get(`${HISTORY_PREFIX}:${symbol}`);
  const bars = Array.isArray(entry?.daily) ? entry.daily : [];
  if (!bars.length) { console.log("  no cached bars at all"); continue; }
  console.log(`  BARS: ${bars.length} from ${bars[0].date} to ${bars[bars.length - 1].date}`);

  const events = (rec?.events ?? []).filter((e) => e.periodEnd);
  console.log(`  EVENTS with a periodEnd: ${events.length}` +
    (events.length ? ` (stored order: ${events.slice(0, 3).map((e) => e.announcedOn).join(", ")}...)` : ""));
  if (!events.length) { console.log("  -> no SEC dates, so the page keeps the FULL series"); continue; }

  const barEvents = events.slice(0, REPORTS);
  const dates = barEvents.map((e) => e.announcedOn).filter(Boolean).sort();
  const from = shiftIso(dates[0], -WINDOW_DAYS);
  const to = shiftIso(dates[dates.length - 1], WINDOW_DAYS);
  console.log(`  WINDOW: ${from} .. ${to}  (oldest report ${dates[0]}, newest ${dates[dates.length - 1]})`);

  // ── DOES THE SERIES EVEN REACH THE OLDEST REPORT? ──────────────────────
  // The question the window cannot answer for itself. A window starting before
  // the first cached bar is not narrow, it is EMPTY on that side, and no
  // widening of it produces a bar that was never cached.
  const firstBar = bars[0].date;
  console.log(`  series starts ${firstBar}; window starts ${from} -> ` +
    (from < firstBar
      ? `THE SERIES STARTS LATE. ${firstBar} > ${from}, so the oldest report has no bars behind it whatever the window says.`
      : "the series covers the window's start"));

  const bounded = await mod.getDailyBars(bars, from, to, {});
  console.log(`  bounded slice: ${bounded.length} of ${bars.length} bars` +
    (bounded.length ? ` (${bounded[0].date} .. ${bounded[bounded.length - 1].date})` : ""));

  console.log(`  ${"report".padEnd(12)} ${"FULL series".padEnd(34)} BOUNDED window`);
  for (const e of barEvents.slice().reverse()) {
    const row = { symbol, date: e.announcedOn, time: e.timing === "after-close" ? "amc" : "bmo" };
    const f = mod.computeEarningsReactionDetail(row, bars);
    const b = mod.computeEarningsReactionDetail(row, bounded);
    const fmt = (r) =>
      `react ${r.reactionPct === null ? "—" : r.reactionPct.toFixed(1)} ` +
      `vol ${r.volumeMultiple === null ? "—" : r.volumeMultiple.toFixed(2)} ` +
      `d5 ${r.drift5Pct === null ? "—" : r.drift5Pct.toFixed(1)} ` +
      `d20 ${r.drift20Pct === null ? "—" : r.drift20Pct.toFixed(1)}`;
    const same = JSON.stringify(f) === JSON.stringify(b);
    console.log(`  ${String(e.announcedOn).padEnd(12)} ${fmt(f).padEnd(34)} ${fmt(b)}  ${same ? "" : "  <<< DIFFERS"}`);
  }
  const anyDiff = barEvents.some((e) => {
    const row = { symbol, date: e.announcedOn, time: e.timing === "after-close" ? "amc" : "bmo" };
    return JSON.stringify(mod.computeEarningsReactionDetail(row, bars)) !==
      JSON.stringify(mod.computeEarningsReactionDetail(row, bounded));
  });
  console.log(`  VERDICT: the window ${anyDiff ? "CHANGES" : "changes NOTHING"} for ${symbol}`);
}
