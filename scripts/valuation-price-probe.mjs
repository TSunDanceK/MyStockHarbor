// WHICH CLOSE THE VALUATION CARD PRICES A COMPANY WITH — measured, per symbol.
//
// ── THE DEFECT ───────────────────────────────────────────────────────────
// The card took the last bar of the REACTION CHART'S window, which is sized
// around report dates. For a filer that has not reported recently that window
// stops months short of today, so the card priced RYAAY at 50.40 as of
// 2025-05-15 (live 53.51) and CNI at 106.22 as of 2026-03-16 (live 118.95).
// ABEV looked right only because its report cycle is current — which is
// exactly why one symbol passing proves nothing about the others.
//
// ── WHAT THIS ANSWERS, AND WHY IT NEEDS LIVE DATA ────────────────────────
// The fix reads the WHOLE series instead. That is only a fix if the whole
// series actually reaches near today: if a symbol's bar cache simply stops,
// the card would still be wrong, just wrong for a different reason. No
// fixture can say — the bars live in Redis. So for each symbol this prints:
//
//   WINDOW LAST   the close the card used to take       (the defect)
//   SERIES LAST   the close it takes now                (the fix)
//   CURRENT?      whether the new one clears the bound  (the backstop)
//
// SWEEP MODE (SYMBOLS=* or unset) scans every symbol in the report-dates store
// and reports the ones whose newest report is old enough for the two to
// diverge — the population the owner asked about, enumerated rather than
// guessed at from three examples.
//
// Everything is LIFTED from the shipped source, so this answers for the code
// that deploys rather than for a transcription of it.
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();

const constant = (src, n) => (readCodeOnly(src).match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const HISTORY_PREFIX = constant("lib/server/historyCache.ts", "REDIS_HISTORY_PREFIX");
const DATES_PREFIX = constant("lib/server/secReportDatesStore.ts", "SEC_REPORT_DATES_PREFIX");
for (const [n, v] of [["REDIS_HISTORY_PREFIX", HISTORY_PREFIX], ["SEC_REPORT_DATES_PREFIX", DATES_PREFIX]]) {
  if (!v) { console.error(`FATAL: could not read ${n} from source`); process.exit(2); }
}

const PAGE = readCodeOnly("app/stock/[symbol]/earnings/page.tsx");
const HIST = readCodeOnly("lib/server/historyCache.ts");
const PRES = readCodeOnly("lib/server/secPresentation.ts");
const WINDOW_DAYS = Number((PAGE.match(/BAR_WINDOW_DAYS = (\d+)/) ?? [])[1]);
const REPORTS = Number((PAGE.match(/REACTION_REPORTS = (\d+)/) ?? [])[1]);
const MAX_AGE = Number((PRES.match(/VALUATION_PRICE_MAX_AGE_DAYS = (\d+)/) ?? [])[1]);
if (!WINDOW_DAYS || !REPORTS || !MAX_AGE) {
  console.error("FATAL: could not read BAR_WINDOW_DAYS / REACTION_REPORTS / VALUATION_PRICE_MAX_AGE_DAYS");
  process.exit(2);
}

// priceIsCurrent is lifted rather than reimplemented: a probe with its own
// copy of the bound measures the probe, not the page.
const mod = await lift(
  [
    `const VALUATION_PRICE_MAX_AGE_DAYS = ${MAX_AGE};`,
    grabFunction(PRES, "priceIsCurrent"),
    grabFunction(HIST, "getDailyBars")
      .replace("export async function", "async function")
      // The caller supplies the series, so what is measured is the RANGE.
      .replace("const all = await getDailyHistory(symbol, opts);", "const all = symbol;"),
    "export { priceIsCurrent, getDailyBars };",
  ].join("\n")
);

const TODAY = new Date().toISOString().slice(0, 10);
const shiftIso = (iso, d) => new Date(Date.parse(iso) + d * 86400000).toISOString().slice(0, 10);
const ageDays = (iso) => Math.round((Date.parse(TODAY) - Date.parse(iso)) / 86400000);

const raw = (process.env.SYMBOLS || "*").trim();
const SWEEP = raw === "*" || raw === "";
let symbols;
if (SWEEP) {
  symbols = [];
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, { match: `${DATES_PREFIX}:*`, count: 1000 });
    cursor = next;
    for (const k of keys) symbols.push(k.slice(DATES_PREFIX.length + 1));
  } while (cursor !== "0");
  symbols.sort();
} else {
  symbols = raw.split(/[,\s]+/).filter(Boolean);
}

console.log("=".repeat(96));
console.log(`today ${TODAY} · window +/-${WINDOW_DAYS}d around the newest ${REPORTS} reports · bound ${MAX_AGE}d`);
console.log(`${symbols.length} symbol(s)${SWEEP ? " (sweep of the report-dates store)" : ""}`);
console.log("=".repeat(96));

const rows = [];
for (const symbol of symbols) {
  const [rec, entry] = await Promise.all([
    redis.get(`${DATES_PREFIX}:${symbol}`),
    redis.get(`${HISTORY_PREFIX}:${symbol}`),
  ]);
  const bars = Array.isArray(entry?.daily) ? entry.daily : [];
  if (!bars.length) { rows.push({ symbol, note: "no cached bars" }); continue; }
  const seriesLast = bars[bars.length - 1].date;

  const events = (rec?.events ?? []).filter((e) => e.periodEnd);
  const barEvents = events.slice(0, REPORTS);
  const dates = barEvents.map((e) => e.announcedOn).filter(Boolean).sort();
  // NO DATES MEANS NO WINDOW, and the page already kept the full series there —
  // those symbols were never affected and are reported as such rather than
  // padding the count.
  if (!dates.length) { rows.push({ symbol, seriesLast, note: "no SEC dates — full series either way" }); continue; }

  const from = shiftIso(dates[0], -WINDOW_DAYS);
  const to = shiftIso(dates[dates.length - 1], WINDOW_DAYS);
  const bounded = await mod.getDailyBars(bars, from, to, {});
  const windowLast = bounded.length ? bounded[bounded.length - 1].date : null;

  rows.push({
    symbol,
    newestReport: dates[dates.length - 1],
    windowLast,
    windowPrice: bounded.length ? bounded[bounded.length - 1].close : null,
    seriesLast,
    seriesPrice: bars[bars.length - 1].close,
    wasWrong: windowLast !== null && windowLast !== seriesLast,
    windowCurrent: mod.priceIsCurrent(windowLast, TODAY),
    seriesCurrent: mod.priceIsCurrent(seriesLast, TODAY),
  });
}

const measured = rows.filter((r) => r.windowLast !== undefined && r.windowLast !== null);
const stale = measured.filter((r) => !r.windowCurrent);
const fixed = stale.filter((r) => r.seriesCurrent);
const stillStale = measured.filter((r) => !r.seriesCurrent);

const show = SWEEP ? [...stale].sort((a, b) => ageDays(b.windowLast) - ageDays(a.windowLast)) : measured;
console.log(`\n${"symbol".padEnd(8)} ${"newest report".padEnd(14)} ${"WINDOW last".padEnd(22)} ${"SERIES last".padEnd(22)} verdict`);
for (const r of show.slice(0, 60)) {
  const w = `${r.windowLast} (${ageDays(r.windowLast)}d) ${r.windowPrice ?? "—"}`;
  const s = `${r.seriesLast} (${ageDays(r.seriesLast)}d) ${r.seriesPrice ?? "—"}`;
  const verdict = !r.windowCurrent && r.seriesCurrent ? "FIXED by reading the series"
    : !r.seriesCurrent ? "STILL STALE — the bar cache itself stops; the card refuses"
    : "was already current";
  console.log(`${r.symbol.padEnd(8)} ${String(r.newestReport).padEnd(14)} ${w.padEnd(22)} ${s.padEnd(22)} ${verdict}`);
}
if (show.length > 60) console.log(`... and ${show.length - 60} more`);

console.log(`\n${"─".repeat(96)}`);
console.log(`measured:            ${measured.length}`);
console.log(`window was stale:    ${stale.length}  (the population the defect reached)`);
console.log(`  of those, FIXED:   ${fixed.length}  (the whole series is current)`);
console.log(`  still stale:       ${stale.length - fixed.length}  (bar cache stops too — the card now refuses instead of guessing)`);
console.log(`series stale anyway: ${stillStale.length}`);
const skipped = rows.filter((r) => r.note);
if (skipped.length) {
  console.log(`\nnot measured: ${skipped.length}`);
  for (const r of skipped.slice(0, 15)) console.log(`  ${r.symbol.padEnd(8)} ${r.note}`);
  if (skipped.length > 15) console.log(`  ... and ${skipped.length - 15} more`);
}
