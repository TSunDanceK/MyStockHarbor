// THE PERFORMANCE STRIP (#563 COWORK #69): C's lib/ta/performance.ts and
// app/stock/[symbol]/PerformanceStrip.tsx, and the page's hand-over.
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. THE DATES: a weekend or holiday not falling back to the trading day
//      before it, a month-end not clamped (31 Mar − 1M = 28/29 Feb), YTD
//      measured from 1 Jan instead of the previous year's last close.
//   2. A GUESS: a period before the prices on file, or across a gap, shown
//      anyway instead of "—" with its reason.
//   3. THE S&P 500 LINE: SPY's change on different dates from the stock's, or
//      the difference the wrong way round.
//   4. "Today so far" counted as a close.
//   5. THE PAGE: the strip built from the 500 bars the client gets (no 3Y/5Y),
//      bars or returns sent to the client, SPY read beside a non-Tiingo series.
//   6. COLOUR ALONE: no arrow or sign beside the green/red.
//
//   node scripts/check-performance-strip.mjs
import fs from "node:fs";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { reasonedValueUnit, visibleText } from "./lib/render-cards.mjs";
import { stripComments } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const KL = "lib/ta/keyLevels.ts";
const SESS = "lib/ta/sessionBar.ts";
const LIB = "lib/ta/performance.ts";
const CARD = "app/stock/[symbol]/PerformanceStrip.tsx";
const PAGE = "app/stock/[symbol]/page.tsx";
const CLIENT = "app/stock/[symbol]/StockSymbolPageClient.tsx";
const strip = (src) => src.replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "").replace(/^"use client";$/m, "");

async function load(lib = fs.readFileSync(LIB, "utf8"), card = fs.readFileSync(CARD, "utf8"), kl = fs.readFileSync(KL, "utf8"), sess = fs.readFileSync(SESS, "utf8")) {
  const unit = `${reasonedValueUnit()}\n${strip(sess)}\n${strip(kl)}\n${strip(lib)}\n${strip(card).replace("export default function PerformanceStrip", "export function PerformanceStrip")}\n`;
  const js = ts.transpileModule(unit, { fileName: "p.tsx", compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react" } }).outputText;
  const tmp = `scripts/.check-performance-strip-${process.pid}.mjs`;
  fs.writeFileSync(tmp, js);
  try { return await import(`${process.cwd()}/${tmp}?t=${Date.now()}-${Math.random()}`); } finally { fs.rmSync(tmp, { force: true }); }
}

// Weekdays, minus the US holidays the checks lean on.
const HOLIDAYS = new Set(["2026-09-07", "2025-12-25", "2026-01-01"]);
function bars(from, to, f) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`), i = 0; t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t), date = d.toISOString().slice(0, 10);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6 || HOLIDAYS.has(date)) continue;
    out.push({ date, close: f(i++), open: 1, high: 1, low: 1 });
  }
  return out;
}
const STOCK = bars("2021-03-01", "2026-10-02", (i) => 100 + i * 0.1);
const SPY = bars("2021-03-01", "2026-10-02", (i) => 400 + i * 0.05);
const at = (b, d) => b.find((x) => x.date === d).close;
const near = (a, b) => typeof a === "number" && Math.abs(a - b) < 1e-9;

async function measure(M) {
  const S = sessionCases(M);
  const full = M.performanceStrip(STOCK, SPY);
  const chip = (s, k) => s.chips.find((c) => c.key === k);
  const listed = M.performanceStrip(STOCK.filter((b) => b.date >= "2024-03-01"), SPY);
  const gap = M.performanceStrip(STOCK.filter((b) => b.date < "2025-09-20" || b.date > "2025-10-05"), SPY);
  const partial = M.performanceStrip([...STOCK, { date: "2026-10-05", close: 999, partial: true }], SPY);
  const noSpy = M.performanceStrip(STOCK, null);
  const render = (strip, credit) => renderToStaticMarkup(React.createElement(M.PerformanceStrip, { strip, credit }));
  const fullHtml = render(full), listedHtml = render(listed);
  return { M, S, full, listed, gap, partial, noSpy, chip, fullHtml, fullText: visibleText(fullHtml), listedHtml, listedText: visibleText(listedHtml),
    credited: visibleText(render(full, React.createElement("a", { href: "#" }, "Tiingo credit"))),
    self: M.performanceStrip(STOCK, SPY, undefined, { benchmark: false }), selfText: visibleText(render(M.performanceStrip(STOCK, SPY, undefined, { benchmark: false }))) };
}

// ── In session or not (#563 COWORK #75/#76) ─────────────────────────────────
const ET = (date, hhmm) => Date.parse(`${date}T${hhmm}:00-04:00`);
const THU = STOCK.filter((b) => b.date <= "2026-10-01"), SPY_THU = SPY.filter((b) => b.date <= "2026-10-01");
const PART = { date: "2026-10-02", close: 777, partial: true, label: "today so far (IEX), 14:32 ET" };
const SPY_PART = { date: "2026-10-02", close: 555, partial: true, label: "today so far (IEX), 14:31 ET" };
const sessionCases = (M) => ({
  inS: M.performanceStrip([...THU, PART], [...SPY_THU, SPY_PART], ET("2026-10-02", "14:32")),
  noSpyToday: M.performanceStrip([...THU, PART], SPY_THU, ET("2026-10-02", "14:32")),
  sat: M.performanceStrip([...THU, PART], [...SPY_THU, SPY_PART], ET("2026-10-03", "12:00")),
  staleMon: M.performanceStrip([...THU, PART], [...SPY_THU, SPY_PART], ET("2026-10-05", "10:00")),
  after: M.performanceStrip([...THU, { ...PART, label: "today so far (IEX), 16:00 ET" }], [...SPY_THU, SPY_PART], ET("2026-10-02", "17:30")),
  pre: M.performanceStrip([...THU, PART], [...SPY_THU, SPY_PART], ET("2026-10-02", "08:30")),
  hol: M.performanceStrip(STOCK.filter((b) => b.date <= "2026-09-04"), SPY, ET("2026-09-07", "11:00")),
});
const rules = {
  "in session: the end is the latest price, labelled with its time; SPY on the same day": ({ S, chip, M }) => {
    const c = chip(S.inS, "1Y");
    return S.inS.end === 777 && S.inS.live?.time === "14:32" && S.inS.asOf === "2026-10-02" &&
      c.note.includes("to $777.00 (last price, 14:32 ET)") && near(c.spyPct, ((555 - at(SPY, "2025-10-02")) / at(SPY, "2025-10-02")) * 100) &&
      chip(S.noSpyToday, "1Y").spyPct === null && /no price for the same day/.test(chip(S.noSpyToday, "1Y").spyReason) &&
      /To the last price, 14:32 ET \(IEX\) · price change only/.test(visibleText(renderToStaticMarkup(React.createElement(M.PerformanceStrip, { strip: S.inS }))));
  },
  "after the close: the day's final IEX price until the nightly job stores the day (#77)": ({ S, chip, M }) =>
    S.after.live?.phase === "afterClose" && S.after.end === 777 && chip(S.after, "1M").note.includes("to $777.00 (close, 16:00 ET (IEX))") &&
    /To the close, 16:00 ET \(IEX\) · price change only/.test(visibleText(renderToStaticMarkup(React.createElement(M.PerformanceStrip, { strip: S.after })))),
  "out of session: the last close; a stale partial, a Saturday and a holiday never count": ({ S, chip }) =>
    [S.sat, S.staleMon, S.pre].every((x) => x.live === null && x.end === at(STOCK, "2026-10-01") && x.asOf === "2026-10-01" && /\(close, Thu 1 Oct 2026\)/.test(chip(x, "1M").note)) &&
    S.hol.live === null && S.hol.asOf === "2026-09-04",
  "rolling dates: same calendar date back, month-ends clamped, a weekend or holiday takes the trading day before": ({ M, full, chip }) =>
    M.monthsBefore("2026-10-02", 1) === "2026-09-02" && M.monthsBefore("2026-03-31", 1) === "2026-02-28" &&
    M.monthsBefore("2024-03-31", 1) === "2024-02-29" && M.monthsBefore("2026-10-02", 60) === "2021-10-02" &&
    // 1M from Fri 2 Oct: Wed 2 Sep. 1Y: Thu 2 Oct 2025. 5Y: Sat 2 Oct 2021 -> Fri 1 Oct 2021.
    chip(full, "1M").from.date === "2026-09-02" && chip(full, "1Y").from.date === "2025-10-02" && chip(full, "5Y").from.date === "2021-10-01" &&
    // Mon 7 Sep 2026 (Labor Day) -> Fri 4 Sep.
    M.closeOnOrBefore(STOCK, "2026-09-07").date === "2026-09-04" && M.closeOnOrBefore(STOCK, "2026-09-06").date === "2026-09-04",
  "YTD: against the previous year's last close": ({ full, chip }) =>
    chip(full, "YTD").from.date === "2025-12-31" && near(chip(full, "YTD").pct, ((at(STOCK, "2026-10-02") - at(STOCK, "2025-12-31")) / at(STOCK, "2025-12-31")) * 100),
  "the % change is the latest close against the start close": ({ full, chip }) =>
    near(chip(full, "3M").pct, ((at(STOCK, "2026-10-02") - at(STOCK, "2026-07-02")) / at(STOCK, "2026-07-02")) * 100) && full.asOf === "2026-10-02",
  "missing history: '—' with its reason, never estimated": ({ listed, gap, chip, listedText }) =>
    chip(listed, "3Y").pct === null && chip(listed, "5Y").pct === null && /Prices on file start Fri 1 Mar 2024/.test(chip(listed, "3Y").reason) &&
    typeof chip(listed, "1Y").pct === "number" && chip(gap, "1Y").pct === null && /No close on file within a week before/.test(chip(gap, "1Y").reason) &&
    (listedText.match(/—/g) ?? []).length >= 2,
  "the S&P 500: SPY's change on the same dates, the difference the right way round": ({ full, chip, noSpy, M }) => {
    const c = chip(full, "1Y");
    const spy = ((at(SPY, "2026-10-02") - at(SPY, "2025-10-02")) / at(SPY, "2025-10-02")) * 100;
    return near(c.spyPct, spy) && near(c.diffPts, c.pct - spy) &&
      M.spyWords(8.24) === "8.2 pts ahead of the S&P 500" && M.spyWords(-3) === "3.0 pts behind the S&P 500" && M.spyWords(0.01) === "level with the S&P 500" &&
      chip(noSpy, "1Y").spyPct === null && /aren't on file/.test(chip(noSpy, "1Y").spyReason);
  },
  "today so far is never the close": ({ partial }) => partial.asOf === "2026-10-02" && partial.end === at(STOCK, "2026-10-02"),
  "on a page that is the S&P 500 (#563 COWORK #90): no line or note against it, the same changes": ({ self, full, selfText }) =>
    self.benchmark === false && full.benchmark === true && !/S&P 500|SPY/.test(selfText) &&
    self.chips.every((c, i) => c.pct === full.chips[i].pct && c.spyPct === null && c.diffPts === null && !/S&P 500|SPY/.test(c.note)),
  "the strip: six chips, an arrow and a sign beside the colour, the S&P line, closes stated once": ({ fullHtml, fullText }) =>
    (fullHtml.match(/class="perfChip"/g) ?? []).length === 6 && /▲ \+\d+\.\d%/.test(fullText) && !/▼/.test(fullText) &&
    /data-tone="up"/.test(fullHtml) && (fullHtml.match(/class="perfSpy"[^>]*>[\d.]+ pts (ahead of|behind) the S&amp;P 500</g) ?? []).length === 6 &&
    /To the close on Fri 2 Oct 2026 · price change only/.test(fullText),
  "a tap note per chip: the exact dates and closes, hedged": ({ full, fullHtml, M }) =>
    full.chips.every((c) => c.note.includes(M.PRICE_ONLY)) &&
    /^From \$[\d,.]+ \(close, Thu 2 Oct 2025\) to \$[\d,.]+ \(close, Fri 2 Oct 2026\): \+\d+\.\d%\. The S&P 500 \(SPY\) moved \+\d+\.\d% over the same dates: [\d.]+ pts (ahead of|behind) the S&P 500\./.test(full.chips[3].note) &&
    (fullHtml.match(/role="button"/g) ?? []).length === 6,
  "nothing reads as advice; the credit only when passed": ({ fullText, credited, full }) =>
    !/\b(buy|sell|outperform|should|recommend|will)\b/i.test(`${fullText} ${full.chips.map((c) => c.note).join(" ")}`) &&
    !/Tiingo credit/.test(fullText) && /Tiingo credit/.test(credited),
};

const staticRules = {
  "no fetch or Redis in the module or the strip": (l, c) => ![l, c].some((s) => /fetch\(|redis|Redis|unstable_cache|readTiingo|getDailyHistory/.test(s)),
  "the page builds it from the full series, SPY only beside a Tiingo series, and hands down the strip, not bars": (_l, _c, page, client) =>
    /const performance = performanceStrip\(historyResult\.points, historyResult\.provider === "tiingo" \? spyPoints : null, Date\.now\(\)\);/.test(page) &&
    /historyOnTiingo\("CHARTS"\) \? readTiingoHistoryPoints\("SPY"\) : Promise\.resolve\(null\)/.test(page) &&
    /performance=\{performance\}/.test(page) && !/spyPoints=\{|spyBars=\{/.test(page) &&
    /\{performance \? <PerformanceStrip strip=\{performance\} credit=\{historyProvider === "tiingo" \? historyCredit : undefined\} \/> : null\}/.test(client),
};

console.log("\n=== 1. Fixtures ===\n");
const base = await measure(await load());
for (const [n, r] of Object.entries(rules)) check(n, r(base));
console.log("\n=== 2. Static rules ===\n");
const L = fs.readFileSync(LIB, "utf8"), Cd = fs.readFileSync(CARD, "utf8");
const code = (f, s = fs.readFileSync(f, "utf8")) => stripComments(s, { file: f });
const args0 = [code(LIB, L), code(CARD, Cd), code(PAGE), code(CLIENT)];
for (const [n, r] of Object.entries(staticRules)) check(n, r(...args0));

console.log("\n=== 3. Mutants: each must FAIL its rule ===\n");
const mutants = [
  ["rolling dates: same calendar date back, month-ends clamped, a weekend or holiday takes the trading day before", "l", (s) => s.replace("return new Date(Date.UTC(y, m, Math.min(day, last))).toISOString().slice(0, 10);", "return new Date(Date.UTC(y, m, day)).toISOString().slice(0, 10);")],
  ["rolling dates: same calendar date back, month-ends clamped, a weekend or holiday takes the trading day before", "l", (s) => s.replace("for (const b of bars) { if (b.date <= date) hit = b; else break; }", "for (const b of bars) { if (b.date >= date) { hit = b; break; } }")],
  ["YTD: against the previous year's last close", "l", (s) => s.replace("`${Number(last.date.slice(0, 4)) - 1}-12-31`", "`${last.date.slice(0, 4)}-01-02`")],
  ["the % change is the latest close against the start close", "l", (s) => s.replace("const pctChange = (from: number, to: number) => (from > 0 ? ((to - from) / from) * 100 : null);", "const pctChange = (from: number, to: number) => (from > 0 ? ((to - from) / to) * 100 : null);")],
  ["missing history: '—' with its reason, never estimated", "l", (s) => s.replace("  if ((atUtc(date).getTime() - atUtc(hit.date).getTime()) / DAY > MAX_GAP_DAYS) return null;\n", "")],
  ["missing history: '—' with its reason, never estimated", "l", (s) => s.replace("  if (!hit) return null;\n", "  if (!hit) hit = bars[0] ?? null;\n  if (!hit) return null;\n")],
  ["the S&P 500: SPY's change on the same dates, the difference the right way round", "l", (s) => s.replace("const diffPts = spyPct === null ? null : pct - spyPct;", "const diffPts = spyPct === null ? null : spyPct - pct;")],
  ["the S&P 500: SPY's change on the same dates, the difference the right way round", "l", (s) => s.replace("const spyFrom = closeOnOrBefore(spy, from.date);", "const spyFrom = closeOnOrBefore(spy, monthsBefore(from.date, 1));")],
  ["today so far is never the close", "l", (s) => s.replace("{ bars: (bars ?? []).filter((b) => !b.partial), live: null, time: null, phase: null }", "{ bars: [...(bars ?? [])], live: null, time: null, phase: null }")],
  ["on a page that is the S&P 500 (#563 COWORK #90): no line or note against it, the same changes", "c", (s) => s.replace('{!strip.benchmark ? "" : c.diffPts', "{c.diffPts")],
  ["on a page that is the S&P 500 (#563 COWORK #90): no line or note against it, the same changes", "l", (s) => s.replace("    if (!benchmark) {", "    if (false) {")],
  ["the strip: six chips, an arrow and a sign beside the colour, the S&P line, closes stated once", "c", (s) => s.replace('const arrow = c.pct === null ? "" : c.pct > 0 ? "▲ " : c.pct < 0 ? "▼ " : "";', 'const arrow = "";')],
  ["the strip: six chips, an arrow and a sign beside the colour, the S&P line, closes stated once", "c", (s) => s.replace("c.diffPts !== null ? spyWords(c.diffPts) :", "c.diffPts !== null ? \"\" :")],
  ["the strip: six chips, an arrow and a sign beside the colour, the S&P line, closes stated once", "c", (s) => s.replace("<>To the close on {strip.asOfWords}</>", "<>{strip.asOfWords}</>")],
  ["a tap note per chip: the exact dates and closes, hedged", "c", (s) => s.replace("reason={c.note}", "reason={null}")],
  ["a tap note per chip: the exact dates and closes, hedged", "l", (s) => s.replace("return { key: p.key, pct, reason: null, from, spyPct, spyReason, diffPts, note: `${head}${vs} ${PRICE_ONLY}` };", "return { key: p.key, pct, reason: null, from, spyPct, spyReason, diffPts, note: `${head}${vs}` };")],
  ["nothing reads as advice; the credit only when passed", "c", (s) => s.replace("{credit ? <> · {credit}</> : null}", "{\" · Tiingo credit\"}")],
];
const KLsrc = fs.readFileSync(KL, "utf8"), SSsrc = fs.readFileSync(SESS, "utf8");
mutants.push(
  ["in session: the end is the latest price, labelled with its time; SPY on the same day", "l", (s) => s.replace("const spyEnd = spyEndAny && spyEndAny.date === last.date ? spyEndAny : null;", "const spyEnd = spyEndAny;")],
  ["in session: the end is the latest price, labelled with its time; SPY on the same day", "l", (s) => s.replace("  const endWords = u.live\n", "  const endWords = false\n")],
  ["in session: the end is the latest price, labelled with its time; SPY on the same day", "c", (s) => s.replace(": <>To the last price{strip.live.time", ": <>To the close{strip.live.time")],
  ["out of session: the last close; a stale partial, a Saturday and a holiday never count", "s", (s) => s.replace(" && last.date === easternNow(nowMs).date;", ";")],
  ["out of session: the last close; a stale partial, a Saturday and a holiday never count", "s", (s) => s.replace("Number.isFinite(nowMs) && sinceOpen(nowMs) && last.date", "Number.isFinite(nowMs) && last.date")],
  ["after the close: the day's final IEX price until the nightly job stores the day (#77)", "l", (s) => s.replace('? u.phase === "afterClose" ? `close, ${u.time ? `${u.time} ET` : "today"} (IEX)`', '? false ? `close, ${u.time ? `${u.time} ET` : "today"} (IEX)`')],
  ["after the close: the day's final IEX price until the nightly job stores the day (#77)", "c", (s) => s.replace('? strip.live.phase === "afterClose"', "? false")],
);
for (const [n, which, mutate] of mutants) {
  let changed = false, bites = false;
  try {
    if (which === "kl") {
      const m = mutate(KLsrc); changed = m !== KLsrc;
      bites = !rules[n](await measure(await load(L, Cd, m)));
    } else if (which === "s") {
      const m = mutate(SSsrc); changed = m !== SSsrc;
      bites = !rules[n](await measure(await load(L, Cd, KLsrc, m)));
    } else {
      const l2 = which === "l" ? mutate(L) : L, c2 = which === "c" ? mutate(Cd) : Cd;
      changed = l2 !== L || c2 !== Cd;
      bites = !rules[n](await measure(await load(l2, c2)));
    }
  } catch { bites = true; }
  check(`mutant bites: ${n}`, changed && bites, changed ? "" : "the mutation did not apply");
}
const staticMutants = [
  ["no fetch or Redis in the module or the strip", (a) => [a[0], `${a[1]}\nconst x = fetch("/api/history");`, a[2], a[3]]],
  ["the page builds it from the full series, SPY only beside a Tiingo series, and hands down the strip, not bars", (a) => [a[0], a[1], a[2].replace("performanceStrip(historyResult.points,", "performanceStrip(points.slice(-500),"), a[3]]],
  ["the page builds it from the full series, SPY only beside a Tiingo series, and hands down the strip, not bars", (a) => [a[0], a[1], a[2].replace('historyOnTiingo("CHARTS") ? readTiingoHistoryPoints("SPY") : Promise.resolve(null)', 'readTiingoHistoryPoints("SPY")'), a[3]]],
  ["the page builds it from the full series, SPY only beside a Tiingo series, and hands down the strip, not bars", (a) => [a[0], a[1], a[2].replace("performance={performance}", "performance={performance}\n        spyPoints={spyPoints}"), a[3]]],
];
for (const [n, mutate] of staticMutants) {
  const out = mutate(args0);
  const changed = out.some((s, i) => s !== args0[i]);
  check(`mutant bites: ${n}`, changed && !staticRules[n](...out), changed ? "" : "the mutation did not apply");
}
console.log(`\n${failures ? `${failures} FAILED` : "all passed"}\n`);
process.exit(failures ? 1 : 0);
