// THE "KEY LEVELS" CARD (#563 COWORK #64, on #552 CODE-A #137 §1): C's new files
// lib/ta/keyLevels.ts and app/stock/[symbol]/KeyLevelsCard.tsx, plus the one
// insertion in the stock page's sidebar.
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. THE OWNER'S DEFINITIONS DRIFT: the week starting on a Sunday, a Monday
//      holiday dropping the week, the month opening at the week's open, a high
//      that isn't the highest, an open that isn't the period's first.
//   2. A SESSION STILL TRADING passed off as "the close": Tiingo's "today so far"
//      bar must never be the day's candle.
//   3. A GUESSED LEVEL: a week or month whose first session isn't on file, or a
//      level whose bars lack the field, drawn anyway instead of withheld with
//      its reason. And the opposite: a blank card.
//   4. THE WORDS: distances the wrong way round, "0.0% above", advice wording,
//      the as-of date gone, the credit shown on bars that aren't Tiingo's.
//   5. COST: the module or the card fetching or reading Redis.
//   6. PLACEMENT: the card out of the sidebar, below the earnings snapshot, or
//      fed something other than the bars the page already holds. The credit
//      gate ends ": undefined", not ": null", so check-tiingo-step3's chart
//      mutant (which edits the first ": null" form) still lands on the chart.
//
// Fixtures are trading calendars built here from fixed dates (US holidays as
// they fall in 2026); expected dates and values are written out by hand.
//
//   node scripts/check-key-levels.mjs
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

const LIB = "lib/ta/keyLevels.ts";
const CARD = "app/stock/[symbol]/KeyLevelsCard.tsx";
const PAGE = "app/stock/[symbol]/StockSymbolPageClient.tsx";
const strip = (src) => src.replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "").replace(/^"use client";$/m, "");

/** The lib and the card (with A's ReasonedValue), one transpiled unit. */
async function load(lib = fs.readFileSync(LIB, "utf8"), card = fs.readFileSync(CARD, "utf8")) {
  const unit = `${reasonedValueUnit()}\n${strip(lib)}\n${strip(card).replace("export default function KeyLevelsCard", "export function KeyLevelsCard")}\n`;
  const js = ts.transpileModule(unit, {
    fileName: "keylevels.tsx",
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react" },
  }).outputText;
  const tmp = `scripts/.check-key-levels-${process.pid}.mjs`;
  fs.writeFileSync(tmp, js);
  try {
    return await import(`${process.cwd()}/${tmp}?t=${Date.now()}-${Math.random()}`);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// ── Fixtures ────────────────────────────────────────────────────────────────
// Weekdays from `from` to `to`, minus the holidays: one bar per session, every
// value distinct so a wrong pick can't match by accident.
const HOLIDAYS_2026 = new Set(["2026-09-07"]); // Labor Day, Mon 7 Sep 2026
function sessions(from, to) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t), date = d.toISOString().slice(0, 10), dow = d.getUTCDay();
    if (dow === 0 || dow === 6 || HOLIDAYS_2026.has(date)) continue;
    out.push(date);
  }
  return out;
}
function barsFor(from, to) {
  return sessions(from, to).map((date, i) => {
    const open = 100 + i * 1.5 + (i % 4) * 0.3;
    return { date, open, high: open + 2 + (i % 3), low: open - 1 - (i % 2) * 0.7, close: open + 0.5 - (i % 5) * 0.2, volume: 1000 + i };
  });
}
const at = (bars, date) => bars.find((b) => b.date === date);
const between = (bars, a, b) => bars.filter((x) => x.date >= a && x.date <= b);
const maxHigh = (bars) => Math.max(...bars.map((b) => b.high));
const minLow = (bars) => Math.min(...bars.map((b) => b.low));

const F = {
  // The owner's example: Sat 3 Oct 2026 shows Fri 2 Oct; the week from Mon 28
  // Sep (across the month end), the month from Thu 1 Oct, mid-week.
  monthMidWeek: barsFor("2026-07-01", "2026-10-02"),
  // A Monday: the week is that one session.
  monday: barsFor("2026-07-01", "2026-10-05"),
  // Mid-week: Wed 30 Sep, the week from Mon 28 Sep, the month from Tue 1 Sep.
  midWeek: barsFor("2026-07-01", "2026-09-30"),
  // Monday holiday: Thu 10 Sep, the week from Tue 8 Sep (Mon 7 Sep closed).
  holiday: barsFor("2026-07-01", "2026-09-10"),
  // Too few for the week: the series starts Wed 30 Sep (after Mon 28 Sep), but
  // a bar before 1 Oct proves the month's first session is on file.
  shortWeek: barsFor("2026-09-30", "2026-10-02"),
  // Too few for either: one bar.
  oneBar: barsFor("2026-10-02", "2026-10-02"),
};
// Today so far (Tiingo's hourly pool row) after Fri 2 Oct: never the candle.
const withPartial = [...F.monthMidWeek, { date: "2026-10-05", open: 999, high: 1999, low: 1, close: 555, partial: true }];
// A bar in the week lacking its high (an FMP row, say): the week's high is withheld.
const noHigh = F.monthMidWeek.map((b) => (b.date === "2026-09-29" ? { ...b, high: undefined } : b));

const near = (a, b) => typeof a === "number" && Math.abs(a - b) < 1e-9;
const lv = (k, key) => k.periods.find((p) => p.key === key);
const values = (p) => ["open", "high", "low", "close"].map((f) => p.levels[f].value);

/** Everything the rules read, for one load. */
async function measure(M) {
  const K = Object.fromEntries(Object.entries(F).map(([n, b]) => [n, M.keyLevels(b)]));
  const render = (props) => renderToStaticMarkup(React.createElement(M.KeyLevelsCard, props));
  const fullHtml = render({ bars: F.monthMidWeek, lastPrice: null });
  const priced = render({ bars: F.monthMidWeek, lastPrice: 250 });
  return {
    M, K,
    partial: M.keyLevels(withPartial),
    noHigh: M.keyLevels(noHigh),
    none: M.keyLevels([]),
    fullHtml, full: visibleText(fullHtml),
    priced: visibleText(priced),
    shortHtml: render({ bars: F.oneBar, lastPrice: 100 }),
    emptyText: visibleText(render({ bars: [], lastPrice: 100 })),
    credited: visibleText(render({ bars: F.monthMidWeek, credit: React.createElement("a", { href: "#" }, "Tiingo credit") })),
  };
}

const rules = {
  "the owner's example: day Fri 2 Oct, week from Mon 28 Sep, month from Thu 1 Oct": ({ K }) => {
    const k = K.monthMidWeek, b = F.monthMidWeek;
    const d = lv(k, "day"), w = lv(k, "week"), m = lv(k, "month");
    const day = at(b, "2026-10-02"), wk = between(b, "2026-09-28", "2026-10-02"), mo = between(b, "2026-10-01", "2026-10-02");
    return k.asOf === "2026-10-02" && d.from === "2026-10-02" && w.from === "2026-09-28" && m.from === "2026-10-01" &&
      values(d).every((v, i) => near(v, [day.open, day.high, day.low, day.close][i])) &&
      values(w).every((v, i) => near(v, [at(b, "2026-09-28").open, maxHigh(wk), minLow(wk), day.close][i])) &&
      values(m).every((v, i) => near(v, [at(b, "2026-10-01").open, maxHigh(mo), minLow(mo), day.close][i])) &&
      k.reasons.length === 0;
  },
  "a Monday: the week is that one session; the month from Thu 1 Oct": ({ K }) => {
    const k = K.monday, b = F.monday, mon = at(b, "2026-10-05"), mo = between(b, "2026-10-01", "2026-10-05");
    const w = lv(k, "week"), m = lv(k, "month");
    return k.asOf === "2026-10-05" && w.from === "2026-10-05" &&
      values(w).every((v, i) => near(v, [mon.open, mon.high, mon.low, mon.close][i])) &&
      m.from === "2026-10-01" && near(m.levels.open.value, at(b, "2026-10-01").open) && near(m.levels.high.value, maxHigh(mo));
  },
  "mid-week: Wed 30 Sep, the week from Mon 28 Sep, the month from Tue 1 Sep": ({ K }) => {
    const k = K.midWeek, b = F.midWeek, wk = between(b, "2026-09-28", "2026-09-30"), mo = between(b, "2026-09-01", "2026-09-30");
    const w = lv(k, "week"), m = lv(k, "month");
    return k.asOf === "2026-09-30" && w.from === "2026-09-28" && m.from === "2026-09-01" &&
      near(w.levels.low.value, minLow(wk)) && near(m.levels.low.value, minLow(mo)) && near(m.levels.high.value, maxHigh(mo)) &&
      near(m.levels.open.value, at(b, "2026-09-01").open);
  },
  "a Monday holiday: the week opens at Tuesday's open": ({ K }) => {
    const k = K.holiday, b = F.holiday, w = lv(k, "week"), wk = between(b, "2026-09-08", "2026-09-10");
    return k.asOf === "2026-09-10" && w.from === "2026-09-08" && w.reason === null &&
      near(w.levels.open.value, at(b, "2026-09-08").open) && near(w.levels.high.value, maxHigh(wk));
  },
  "too few bars: what can be shown is, the rest withheld with its reason": ({ K, M }) => {
    const s = K.shortWeek, o = K.oneBar;
    return lv(s, "week").reason === M.SHORT_REASON.week && values(lv(s, "week")).every((v) => v === null) &&
      lv(s, "month").reason === null && lv(s, "month").from === "2026-10-01" &&
      lv(o, "day").reason === null && values(lv(o, "day")).every((v) => typeof v === "number") &&
      lv(o, "week").reason === M.SHORT_REASON.week && lv(o, "month").reason === M.SHORT_REASON.month &&
      o.reasons.includes(M.SHORT_REASON.week) && o.reasons.includes(M.SHORT_REASON.month);
  },
  "no bars: every period withheld, with one reason": ({ none, M }) =>
    none.asOf === null && none.periods.every((p) => p.reason === M.NO_BARS_REASON) && none.reasons.length === 1,
  "today so far is never the candle": ({ partial }) =>
    partial.asOf === "2026-10-02" && !values(lv(partial, "week")).some((v) => v === 1999 || v === 1 || v === 555 || v === 999),
  "a missing field withholds that level only, and says why": ({ noHigh, M }) => {
    const w = lv(noHigh, "week");
    return w.levels.high.value === null && w.levels.high.reason === M.fieldMissingReason("week", "high") &&
      typeof w.levels.low.value === "number" && typeof w.levels.open.value === "number" &&
      noHigh.reasons.includes(M.fieldMissingReason("week", "high")) && typeof lv(noHigh, "day").levels.high.value === "number";
  },
  "distance words: above / below the right way round, 'at the last price' when it rounds to zero": ({ M }) =>
    M.distanceWords(102.1, 100) === "2.1% above" && M.distanceWords(99.6, 100) === "0.4% below" &&
    M.distanceWords(100.04, 100) === "at the last price" && M.distanceWords(100.06, 100) === "0.1% above" &&
    M.distanceWords(100, 0) === null,
  "dates and prices in words": ({ M }) =>
    M.dateWords("2026-10-02") === "Fri 2 Oct 2026" && M.dateWords("2026-09-28") === "Mon 28 Sep 2026" &&
    M.priceWords(1234.5) === "$1,234.50" && M.priceWords(0.12345) === "$0.1235" && M.priceWords(25012.5) === "$25,013",
  "the card: twelve values, the as-of close, a distance on each": ({ fullHtml, full }) =>
    (fullHtml.match(/class="klValue"/g) ?? []).length === 12 && (fullHtml.match(/class="klDist"/g) ?? []).length === 12 &&
    /As of the close on Fri 2 Oct 2026\./.test(full) && /Distances are from that close, \$/.test(full),
  "the card measures from the page's last price when it has one": ({ priced }) =>
    /Distances are from the last price, \$250\.00\./.test(priced) && !/at the last price/.test(priced) && /% below/.test(priced),
  "the card: a withheld level is a dash with its reason, and a reason line under the grid": ({ shortHtml, M }) => {
    const t = visibleText(shortHtml);
    return (shortHtml.match(/class="klValue"/g) ?? []).length === 4 && (shortHtml.match(/class="klReason"/g) ?? []).length === 2 &&
      t.includes(M.SHORT_REASON.week) && t.includes(M.SHORT_REASON.month) &&
      (shortHtml.match(/role="button"[^>]*aria-label="[^"]*—/g) ?? []).length >= 8;
  },
  "the card is never blank: no bars still gives the reason": ({ emptyText, M }) =>
    emptyText.includes("Key levels") && emptyText.includes(M.NO_BARS_REASON),
  "the note says what the levels are, and nothing reads as advice": ({ fullHtml, full, M }) =>
    /What are these\?/.test(full) && M.KEY_LEVELS_NOTE.startsWith("Levels some traders watch") && fullHtml.includes("Levels some traders watch") &&
    !/\b(buy|sell|bullish|bearish|support|resistance|target|should|recommend)\b/i.test(`${full} ${M.KEY_LEVELS_NOTE}`),
  "the Tiingo credit only when it is passed": ({ full, credited }) =>
    !/Daily prices:/.test(full) && /Daily prices: Tiingo credit/.test(credited),
};

const staticRules = {
  "no fetch, no Redis, no provider reads in either file": (l, c) =>
    ![l, c].some((s) => /fetch\(|redis|Redis|unstable_cache|readTiingo|getDailyHistory|historyForSurface|readSurfaceInputs/.test(s)),
  "the module imports nothing; the card only React's types, A's ReasonedValue and the module": (l, c) => {
    const imports = [...c.matchAll(/^import[\s\S]*?from\s*"([^"]+)";$/gm)].map((m) => m[1]);
    return !/^import\b/m.test(l) &&
      imports.every((i) => i === "react" || i === "@/app/components/EstimatedValue" || i === "@/lib/ta/keyLevels") &&
      /^import type \{[^}]*\} from "react";$/m.test(c) && /^import \{ ReasonedValue \} from "@\/app\/components\/EstimatedValue";$/m.test(c);
  },
  "placement: in the sidebar, directly above the earnings snapshot, on the page's own bars, credited only on Tiingo bars": (_l, _c, p) => {
    const side = p.slice(p.indexOf('<aside className="stock-page-sidebar">'), p.indexOf("</aside>"));
    return /<KeyLevelsCard bars=\{history\} lastPrice=\{quote\?\.price \?\? null\} credit=\{shownProvider === "tiingo" \? historyCredit : undefined\} \/>[\s{}]*<LatestEarningsCard /.test(side) &&
      (p.match(/<KeyLevelsCard /g) ?? []).length === 1 && /^import KeyLevelsCard from "\.\/KeyLevelsCard";$/m.test(p);
  },
};

console.log("\n=== 1. Fixtures through lib/ta/keyLevels.ts and the card ===\n");
const base = await measure(await load());
for (const [name, rule] of Object.entries(rules)) check(name, rule(base));

console.log("\n=== 2. Static rules ===\n");
const L = fs.readFileSync(LIB, "utf8"), Cd = fs.readFileSync(CARD, "utf8"), P = fs.readFileSync(PAGE, "utf8");
const code = (s, f) => stripComments(s, { file: f });
for (const [name, rule] of Object.entries(staticRules)) check(name, rule(code(L, LIB), code(Cd, CARD), code(P, PAGE)));

console.log("\n=== 3. Mutants: each must FAIL its rule ===\n");
const mutants = [
  ["a Monday: the week is that one session; the month from Thu 1 Oct", "l", (s) => s.replace("const sinceMonday = (d.getUTCDay() + 6) % 7;", "const sinceMonday = (d.getUTCDay() + 5) % 7;")],
  ["a Monday holiday: the week opens at Tuesday's open", "l", (s) => s.replace("const firstIn = bars.findIndex((b) => b.date >= start);", "const firstIn = bars.findIndex((b) => b.date === start);")],
  ["the owner's example: day Fri 2 Oct, week from Mon 28 Sep, month from Thu 1 Oct", "l", (s) => s.replace('periodFrom("month", closed, monthStart(last.date)),', 'periodFrom("month", closed, isoWeekMonday(last.date)),')],
  ["the owner's example: day Fri 2 Oct, week from Mon 28 Sep, month from Thu 1 Oct", "l", (s) => s.replace("finite(first.open) ? { value: first.open, reason: null }", "finite(last.open) ? { value: last.open, reason: null }")],
  ["the owner's example: day Fri 2 Oct, week from Mon 28 Sep, month from Thu 1 Oct", "l", (s) => s.replace("close: { value: last.close, reason: null },", "close: { value: first.close, reason: null },")],
  ["mid-week: Wed 30 Sep, the week from Mon 28 Sep, the month from Tue 1 Sep", "l", (s) => s.replace('value: field === "high" ? Math.max(...vals) : Math.min(...vals)', 'value: field === "high" ? Math.max(...vals) : vals[vals.length - 1]')],
  ["mid-week: Wed 30 Sep, the week from Mon 28 Sep, the month from Tue 1 Sep", "l", (s) => s.replace("return `${date.slice(0, 7)}-01`;", "return `${date.slice(0, 7)}-02`;")],
  ["too few bars: what can be shown is, the rest withheld with its reason", "l", (s) => s.replace("if (firstIn <= 0) return withheld(key, SHORT_REASON[key]);", "if (firstIn < 0) return withheld(key, SHORT_REASON[key]);")],
  ["no bars: every period withheld, with one reason", "l", (s) => s.replace("      reasons: [NO_BARS_REASON],\n", "      reasons: [],\n")],
  ["today so far is never the candle", "l", (s) => s.replace(".filter((b) => b && !b.partial && ", ".filter((b) => b && ")],
  ["a missing field withholds that level only, and says why", "l", (s) => s.replace("if (!vals.every(finite)) return none(fieldMissingReason(key, field));", "")],
  ["a missing field withholds that level only, and says why", "l", (s) => s.replace("if (r && !reasons.includes(r)) reasons.push(r);", "")],
  ["distance words: above / below the right way round, 'at the last price' when it rounds to zero", "l", (s) => s.replace('${pct > 0 ? "above" : "below"}', '${pct > 0 ? "below" : "above"}')],
  ["distance words: above / below the right way round, 'at the last price' when it rounds to zero", "l", (s) => s.replace("export const AT_PRICE_BELOW_PCT = 0.05;", "export const AT_PRICE_BELOW_PCT = 0;")],
  ["dates and prices in words", "l", (s) => s.replace("${WEEKDAYS[d.getUTCDay()]}", "${WEEKDAYS[(d.getUTCDay() + 1) % 7]}")],
  ["dates and prices in words", "l", (s) => s.replace("const dp = Math.abs(v) < 1 ? 4 : Math.abs(v) >= WHOLE_DOLLARS_FROM ? 0 : 2;", "const dp = Math.abs(v) < 1 ? 4 : 2;")],
  ["dates and prices in words", "l", (s) => s.replace("const dp = Math.abs(v) < 1 ? 4 : Math.abs(v) >= WHOLE_DOLLARS_FROM ? 0 : 2;", "const dp = Math.abs(v) >= WHOLE_DOLLARS_FROM ? 0 : 2;")],
  ["the card: twelve values, the as-of close, a distance on each", "c", (s) => s.replace("As of the close on {k.asOfWords}.", "As of {k.asOfWords}.")],
  ["the card: twelve values, the as-of close, a distance on each", "c", (s) => s.replace('{dist ? <div className="klDist" style={distStyle}>{dist}</div> : null}', "")],
  ["the card measures from the page's last price when it has one", "c", (s) => s.replace("const reference = hasPrice ? lastPrice : k.lastClose;", "const reference = k.lastClose;")],
  ["the card: a withheld level is a dash with its reason, and a reason line under the grid", "c", (s) => s.replace('<ReasonedValue text="—" reason={lv.reason} />', "<span>—</span>")],
  ["the card: a withheld level is a dash with its reason, and a reason line under the grid", "c", (s) => s.replace('<p key={r} className="klReason" style={noteStyle}>{r}</p>', "null")],
  ["the card is never blank: no bars still gives the reason", "c", (s) => s.replace("{k.reasons.map((r) => (", "{k.reasons.slice(1).map((r) => (")],
  ["the note says what the levels are, and nothing reads as advice", "c", (s) => s.replace('"Levels some traders watch: ', '"Levels where traders buy: ')],
  ["the note says what the levels are, and nothing reads as advice", "c", (s) => s.replace('<ReasonedValue text="What are these?" reason={KEY_LEVELS_NOTE} />', "")],
  ["the Tiingo credit only when it is passed", "c", (s) => s.replace("{credit ? <p style={noteStyle}>Daily prices: {credit}</p> : null}", "<p style={noteStyle}>Daily prices: {credit ?? \"Tiingo\"}</p>")],
];
for (const [name, which, mutate] of mutants) {
  const l2 = which === "l" ? mutate(L) : L;
  const c2 = which === "c" ? mutate(Cd) : Cd;
  const changed = l2 !== L || c2 !== Cd;
  let bites = false;
  try { bites = !rules[name](await measure(await load(l2, c2))); } catch { bites = true; }
  check(`mutant bites: ${name}`, changed && bites, changed ? "" : "the mutation did not apply");
}
const staticMutants = [
  ["no fetch, no Redis, no provider reads in either file", (l, c, p) => [`${l}\nconst x = fetch("/api/history");`, c, p]],
  ["the module imports nothing; the card only React's types, A's ReasonedValue and the module", (l, c, p) => [`import { readTiingoHistoryPoints } from "@/lib/server/tiingoHistory";\n${l}`, c, p]],
  ["the module imports nothing; the card only React's types, A's ReasonedValue and the module", (l, c, p) => [l, `import { getDailyHistory } from "@/lib/server/historyCache";\n${c}`, p]],
  ["placement: in the sidebar, directly above the earnings snapshot, on the page's own bars, credited only on Tiingo bars", (l, c, p) => [l, c, p.replace('credit={shownProvider === "tiingo" ? historyCredit : undefined} />', "credit={historyCredit} />")]],
  ["placement: in the sidebar, directly above the earnings snapshot, on the page's own bars, credited only on Tiingo bars", (l, c, p) => [l, c, p.replace(/\s*<KeyLevelsCard [^\n]*\n/, "\n")]],
  ["placement: in the sidebar, directly above the earnings snapshot, on the page's own bars, credited only on Tiingo bars", (l, c, p) => [l, c, p.replace("<KeyLevelsCard bars={history}", "<KeyLevelsCard bars={history.slice(-5)}")]],
];
for (const [name, mutate] of staticMutants) {
  const args = [code(L, LIB), code(Cd, CARD), code(P, PAGE)];
  const out = mutate(...args);
  const changed = out.some((s, i) => s !== args[i]);
  check(`mutant bites: ${name}`, changed && !staticRules[name](...out), changed ? "" : "the mutation did not apply");
}

console.log(`\n${failures ? `${failures} FAILED` : "all passed"}\n`);
process.exit(failures ? 1 : 0);
