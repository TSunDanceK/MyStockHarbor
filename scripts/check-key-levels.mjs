// THE "KEY LEVELS" CARD (#563 COWORK #64, on #552 CODE-A #137 §1; range bars,
// #66/#67; the pole, #115): C's files lib/ta/keyLevels.ts and
// app/stock/[symbol]/KeyLevelsCard.tsx, plus the one insertion in the stock
// page's sidebar. The pole itself (lib/ta/keyLevelPole.ts) is
// scripts/check-key-levels-pole.mjs.
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
const BARS = "lib/ta/keyLevelPole.ts";
const SESS = "lib/ta/sessionBar.ts";
const CARD = "app/stock/[symbol]/KeyLevelsCard.tsx";
const PAGE = "app/stock/[symbol]/StockSymbolPageClient.tsx";
const strip = (src) => src.replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "").replace(/^"use client";$/m, "");

/** C's TapNote (#563 COWORK #88/#89), with the two hooks the shared unit doesn't import. */
const tapNoteUnit = () => `import { useCallback, useLayoutEffect } from "react";\n${strip(fs.readFileSync("app/stock/[symbol]/TapNote.tsx", "utf8"))}`;

/** The two modules (the levels, the pole: #563 COWORK #115) and the card (with A's ReasonedValue), one transpiled unit. */
async function load(lib = fs.readFileSync(LIB, "utf8"), card = fs.readFileSync(CARD, "utf8"), barsLib = fs.readFileSync(BARS, "utf8"), sess = fs.readFileSync(SESS, "utf8")) {
  const unit = `${reasonedValueUnit()}\n${tapNoteUnit()}\n${strip(sess)}\n${strip(lib)}\n${strip(barsLib)}\n${strip(card).replace("export default function KeyLevelsCard", "export function KeyLevelsCard")}\n`;
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

// #79/#78 fixtures, all ending Fri 2 Oct 2026 on F.monthMidWeek's history.
const upTo = (d) => F.monthMidWeek.filter((b) => b.date < d);
const bar = (date, o, h, l, c) => ({ date, open: o, high: h, low: l, close: c });
// A falling week and a day that rebounds to its high: near the week's low and the day's high.
const SPLIT = [...upTo("2026-09-28"), bar("2026-09-28", 200, 210, 195, 200), bar("2026-09-29", 190, 192, 180, 181), bar("2026-09-30", 182, 183, 170, 171), bar("2026-10-01", 172, 173, 165, 166), bar("2026-10-02", 160, 168, 158, 167.5)];
// Thursday closes at 166; Friday gaps up (172–180) / down (172–180 after a 190 close).
const GAP_UP = [...upTo("2026-10-01"), bar("2026-10-01", 165, 168, 164, 166), bar("2026-10-02", 175, 180, 172, 178)];
const GAP_DOWN = [...upTo("2026-10-01"), bar("2026-10-01", 189, 191, 188, 190), bar("2026-10-02", 175, 180, 172, 178)];
// A flat session: high = low = open = close, after a 170 close (no gap); and after a lower close (a gap, #81).
const FLAT = [...upTo("2026-10-01"), bar("2026-10-01", 169, 171, 168, 170), bar("2026-10-02", 170, 170, 170, 170)];
const FLAT_GAP = [...upTo("2026-10-01"), bar("2026-10-01", 165, 168, 164, 166), bar("2026-10-02", 170, 170, 170, 170)];
// #81: Thursday closes at 171.8, a hair under Friday's 172 low (a tiny gap); or at 160 (a 7% gap).
const TINY_GAP = [...upTo("2026-10-01"), bar("2026-10-01", 170, 172.5, 169, 171.8), bar("2026-10-02", 175, 180, 172, 178)];
const BIG_GAP = [...upTo("2026-10-01"), bar("2026-10-01", 163, 165, 159, 160), bar("2026-10-02", 175, 180, 172, 178)];
const near = (a, b) => typeof a === "number" && Math.abs(a - b) < 1e-9;
const lv = (k, key) => k.periods.find((p) => p.key === key);
const values = (p) => ["open", "high", "low", "close"].map((f) => p.levels[f].value);

/** Everything the rules read, for one load. */
let measure = async function measureAll(M) {
  const K = Object.fromEntries(Object.entries(F).map(([n, b]) => [n, M.keyLevels(b)]));
  const render = (props) => renderToStaticMarkup(React.createElement(M.KeyLevelsCard, props));
  const fullHtml = render({ bars: F.monthMidWeek, lastPrice: null });
  const pricedHtml = render({ bars: F.monthMidWeek, lastPrice: 250 });
  const priced = visibleText(pricedHtml);
  return {
    M, K,
    firstOfMonth: M.keyLevels(F.monthMidWeek.filter((b) => b.date <= "2026-10-01")),
    pricedHtml,
    partial: M.keyLevels(withPartial),
    noHigh: M.keyLevels(noHigh),
    none: M.keyLevels([]),
    fullHtml, full: visibleText(fullHtml),
    priced,
    shortHtml: render({ bars: F.oneBar, lastPrice: 100 }),
    emptyText: visibleText(render({ bars: [], lastPrice: 100 })),
    credited: visibleText(render({ bars: F.monthMidWeek, credit: React.createElement("a", { href: "#" }, "Tiingo credit") })),
    creditedHtml: render({ bars: F.monthMidWeek, credit: React.createElement("a", { href: "#" }, "Tiingo credit") }),
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
  "previous closes: the session before, last week's and last month's final sessions; missing ones say why (#78)": ({ K, firstOfMonth, M }) => {
    const k = K.monthMidWeek, b = F.monthMidWeek, p = (key) => lv(k, key).prevClose;
    const f = lv(firstOfMonth, "month").prevClose, one = lv(K.oneBar, "day");
    return p("day").date === "2026-10-01" && near(p("day").value, at(b, "2026-10-01").close) &&
      p("week").date === "2026-09-25" && near(p("week").value, at(b, "2026-09-25").close) &&
      p("month").date === "2026-09-30" && f.date === "2026-09-30" && lv(firstOfMonth, "day").prevClose.date === "2026-09-30" &&
      one.prevClose === null && one.prevReason === M.PREV_MISSING.day;
  },
  "the card is never blank: no bars still gives the reason": ({ emptyText, M }) =>
    emptyText.includes("Key levels") && emptyText.includes(M.NO_BARS_REASON),
  "the Tiingo credit only when it is passed": ({ full, credited }) =>
    !/Daily prices:/.test(full) && /Daily prices: Tiingo credit/.test(credited),
};

// ── In session or not (#563 COWORK #75/#76) ─────────────────────────────────
// Bars to Thu 1 Oct plus today's partial (Fri 2 Oct, "today so far (IEX), 14:32 ET").
const ET = (date, hhmm) => Date.parse(`${date}T${hhmm}:00-04:00`); // EDT, UTC−4 in October/September
const THU = F.monthMidWeek.filter((b) => b.date <= "2026-10-01");
const PART = { date: "2026-10-02", open: 190, high: 260, low: 150, close: 240, partial: true, label: "today so far (IEX), 14:32 ET" };
const sessionCases = async (M) => {
  const render = (props) => visibleText(renderToStaticMarkup(React.createElement(M.KeyLevelsCard, props)));
  const inS = M.keyLevels([...THU, PART], { nowMs: ET("2026-10-02", "14:32") });
  const stale = M.keyLevels([...THU, PART], { nowMs: ET("2026-10-03", "12:00") }); // Saturday: a Friday partial left over
  const after = M.keyLevels([...THU, { ...PART, label: "today so far (IEX), 16:00 ET" }], { nowMs: ET("2026-10-02", "17:30") }); // after the close, before EOD
  const eodDone = M.keyLevels(F.monthMidWeek, { nowMs: ET("2026-10-03", "01:00") }); // 01:00 ET: the nightly job has stored Friday
  const pre = M.keyLevels([...THU, { ...PART, date: "2026-10-05" }], { nowMs: ET("2026-10-05", "08:00") }); // pre-market Monday
  const sat = M.keyLevels(F.monthMidWeek, { nowMs: ET("2026-10-03", "12:00") }); // Saturday, no partial
  const staleMon = M.keyLevels([...THU, PART], { nowMs: ET("2026-10-05", "10:00") }); // in session Monday, a Friday partial left over
  const hol = M.keyLevels(F.holiday.filter((b) => b.date <= "2026-09-04"), { nowMs: ET("2026-09-07", "11:00") }); // Labor Day
  return {
    inS, stale, after, pre, sat, hol, staleMon, eodDone,
    afterText: render({ bars: [...THU, { ...PART, label: "today so far (IEX), 16:00 ET" }], lastPrice: 240, nowMs: ET("2026-10-02", "17:30") }),
    inText: render({ bars: [...THU, PART], lastPrice: 240, nowMs: ET("2026-10-02", "14:32") }),
    satText: render({ bars: [...THU, PART], lastPrice: 240, nowMs: ET("2026-10-03", "12:00") }),
  };
};
Object.assign(rules, {
  "in session: the Day column is today so far, the week and month include it, labelled with the bar's own time": ({ S, M }) => {
    const d = lv(S.inS, "day"), w = lv(S.inS, "week"), m = lv(S.inS, "month");
    return S.inS.asOf === "2026-10-02" && S.inS.live?.time === "14:32" &&
      values(d).every((v, i) => v === [190, 260, 150, 240][i]) && w.levels.high.value === 260 && m.levels.low.value === 150 &&
      m.from === "2026-10-01" && w.from === "2026-09-28" &&
      /today so far, 14:32 ET \(IEX\)/.test(S.inText) && !/as of the close/.test(S.inText) &&
      M.inSession(ET("2026-10-02", "09:30")) && !M.inSession(ET("2026-10-02", "09:29")) && !M.inSession(ET("2026-10-02", "16:00"));
  },
  "after the close: today's final IEX bar until the nightly job stores the day (#77)": ({ S, M }) =>
    S.after.live?.phase === "afterClose" && S.after.live.time === "16:00" && S.after.asOf === "2026-10-02" && lv(S.after, "day").levels.high.value === 260 &&
    /close, 16:00 ET \(IEX\)/.test(S.afterText) && !/today so far/.test(S.afterText) &&
    S.eodDone.live === null && S.eodDone.asOf === "2026-10-02" && M.sinceOpen(ET("2026-10-02", "17:30")) && !M.sinceOpen(ET("2026-10-02", "09:00")),
  "out of session: the last completed session, never a stale or out-of-hours partial": ({ S }) =>
    [S.stale, S.staleMon].every((k) => k.live === null && k.asOf === "2026-10-01" && lv(k, "day").levels.high.value !== 260) &&
    S.pre.live === null && S.pre.asOf === "2026-10-01" &&
    /as of the close on Thu 1 Oct 2026/.test(S.satText) && !/· today so far/.test(S.satText) && /Month = the latest session/.test(S.satText),
  "a Saturday and a market holiday: the last close, no 'today so far'": ({ S, M }) =>
    S.sat.live === null && S.sat.asOf === "2026-10-02" && S.hol.live === null && S.hol.asOf === "2026-09-04" &&
    !M.inSession(ET("2026-10-03", "12:00")) && !M.inSession(ET("2026-10-04", "12:00")),
});

const staticRules = {
  "no fetch, no Redis, no provider reads in any file": (l, c, _p, b) =>
    ![l, c, b].some((s) => /fetch\(|redis|Redis|unstable_cache|readTiingo|getDailyHistory|historyForSurface|readSurfaceInputs/.test(s)),
  "the modules import only each other; the card only React, C's TapNote and the modules": (l, c, _p, b) => {
    const imports = [...c.matchAll(/^import[\s\S]*?from\s*"([^"]+)";$/gm)].map((m) => m[1]);
    const barImports = [...b.matchAll(/^import[\s\S]*?from\s*"([^"]+)";$/gm)].map((m) => m[1]);
    const libImports = [...l.matchAll(/^import[\s\S]*?from\s*"([^"]+)";$/gm)].map((m) => m[1]);
    return libImports.length === 1 && libImports[0] === "./sessionBar" && barImports.length === 1 && barImports[0] === "./keyLevels" &&
      imports.every((i) => i === "react" || i === "./TapNote" || i === "@/lib/ta/keyLevels" || i === "@/lib/ta/keyLevelPole") &&
      /^import \{ useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode \} from "react";$/m.test(c) && /^import \{[^}]*\} from "\.\/TapNote";$/m.test(c);
  },
  "placement: in the sidebar, directly above the earnings snapshot (the Performance card between them since #111), on the page's own bars, credited only on Tiingo bars": (_l, _c, p) => {
    const side = p.slice(p.indexOf('<aside className="stock-page-sidebar">'), p.indexOf("</aside>"));
    return /<KeyLevelsCard bars=\{history\} lastPrice=\{quote\?\.price \?\? null\} nowMs=\{renderedAt\} credit=\{shownProvider === "tiingo" \? historyCredit : undefined\} \/>[\s{}]*(<\/div>[\s{}]*(\{performance \? \(\s*<div className="sp-slot sp-performance">\s*<PerformanceCard [^\n]*\/>\s*<\/div>\s*\) : null\}[\s{}]*)?<div className="sp-slot sp-earnings"(?: data-reading-owner="a")?>[\s{}]*)?<LatestEarningsCard /.test(side) &&
      (p.match(/<KeyLevelsCard /g) ?? []).length === 1 && /^import KeyLevelsCard from "\.\/KeyLevelsCard";$/m.test(p);
  },
};

console.log("\n=== 1. Fixtures through lib/ta/keyLevels.ts and the card ===\n");
const measure0 = measure;
measure = async (M) => ({ ...(await measure0(M)), S: await sessionCases(M) });
const base = await measure(await load());
for (const [name, rule] of Object.entries(rules)) check(name, rule(base));

console.log("\n=== 2. Static rules ===\n");
const L = fs.readFileSync(LIB, "utf8"), Cd = fs.readFileSync(CARD, "utf8"), P = fs.readFileSync(PAGE, "utf8"), Bs = fs.readFileSync(BARS, "utf8");
const code = (s, f) => stripComments(s, { file: f });
for (const [name, rule] of Object.entries(staticRules)) check(name, rule(code(L, LIB), code(Cd, CARD), code(P, PAGE), code(Bs, BARS)));

console.log("\n=== 3. Mutants: each must FAIL its rule ===\n");
const SS = fs.readFileSync(SESS, "utf8");
const mutants = [
  ["in session: the Day column is today so far, the week and month include it, labelled with the bar's own time", "l", (s) => s.replace("  const sess = sessionBars(bars, opts.nowMs);", "  const sess = sessionBars(bars);")],
  ["in session: the Day column is today so far, the week and month include it, labelled with the bar's own time", "s", (s) => s.replace('const time = (/(\\d{1,2}:\\d{2}) ET/.exec(last.label ?? "") ?? [])[1] ?? null;', "const time = null;")],
  ["in session: the Day column is today so far, the week and month include it, labelled with the bar's own time", "s", (s) => s.replace('return weekday >= 1 && weekday <= 5 && hhmm >= SESSION_OPEN && hhmm < SESSION_CLOSE;', 'return weekday >= 1 && weekday <= 5 && hhmm >= SESSION_OPEN && hhmm <= SESSION_CLOSE;')],
  ["out of session: the last completed session, never a stale or out-of-hours partial", "s", (s) => s.replace(" && last.date === easternNow(nowMs).date;", ";")],
  ["out of session: the last completed session, never a stale or out-of-hours partial", "s", (s) => s.replace("return weekday >= 1 && weekday <= 5 && hhmm >= SESSION_OPEN;\n}", "return true;\n}")],
  ["after the close: today's final IEX bar until the nightly job stores the day (#77)", "s", (s) => s.replace("Number.isFinite(nowMs) && sinceOpen(nowMs) && last.date", "Number.isFinite(nowMs) && inSession(nowMs) && last.date")],
  ["out of session: the last completed session, never a stale or out-of-hours partial", "c", (s) => s.replace("<>as of the close on {k.asOfWords}</>", "<>today so far</>")],
  ["a Saturday and a market holiday: the last close, no 'today so far'", "s", (s) => s.replace("return weekday >= 1 && weekday <= 5 && hhmm", "return hhmm")],

  ["a Monday: the week is that one session; the month from Thu 1 Oct", "l", (s) => s.replace("const sinceMonday = (d.getUTCDay() + 6) % 7;", "const sinceMonday = (d.getUTCDay() + 5) % 7;")],
  ["a Monday holiday: the week opens at Tuesday's open", "l", (s) => s.replace("const firstIn = bars.findIndex((b) => b.date >= start);", "const firstIn = bars.findIndex((b) => b.date === start);")],
  ["the owner's example: day Fri 2 Oct, week from Mon 28 Sep, month from Thu 1 Oct", "l", (s) => s.replace('periodFrom("month", closed, monthStart(last.date)),', 'periodFrom("month", closed, isoWeekMonday(last.date)),')],
  ["the owner's example: day Fri 2 Oct, week from Mon 28 Sep, month from Thu 1 Oct", "l", (s) => s.replace("finite(first.open) ? { value: first.open, reason: null }", "finite(last.open) ? { value: last.open, reason: null }")],
  ["the owner's example: day Fri 2 Oct, week from Mon 28 Sep, month from Thu 1 Oct", "l", (s) => s.replace("close: { value: last.close, reason: null },", "close: { value: first.close, reason: null },")],
  ["mid-week: Wed 30 Sep, the week from Mon 28 Sep, the month from Tue 1 Sep", "l", (s) => s.replace('value: field === "high" ? Math.max(...vals) : Math.min(...vals)', 'value: field === "high" ? Math.max(...vals) : vals[vals.length - 1]')],
  ["mid-week: Wed 30 Sep, the week from Mon 28 Sep, the month from Tue 1 Sep", "l", (s) => s.replace("return `${date.slice(0, 7)}-01`;", "return `${date.slice(0, 7)}-02`;")],
  ["too few bars: what can be shown is, the rest withheld with its reason", "l", (s) => s.replace("if (firstIn <= 0) return withheld(key, SHORT_REASON[key]);", "if (firstIn < 0) return withheld(key, SHORT_REASON[key]);")],
  ["previous closes: the session before, last week's and last month's final sessions; missing ones say why (#78)", "l", (s) => s.replace("prevClose: prevOf(closed, closed.length - 1),", "prevClose: prevOf(closed, closed.length - 2),")],
  ["previous closes: the session before, last week's and last month's final sessions; missing ones say why (#78)", "l", (s) => s.replace("prevClose: prevOf(bars, firstIn), prevReason: null };", "prevClose: prevOf(bars, firstIn - 1), prevReason: null };")],
  ["previous closes: the session before, last week's and last month's final sessions; missing ones say why (#78)", "l", (s) => s.replace("prevReason: closed.length > 1 ? null : PREV_MISSING.day }", "prevReason: null }")],
  ["no bars: every period withheld, with one reason", "l", (s) => s.replace("      reasons: [NO_BARS_REASON],\n", "      reasons: [],\n")],
  ["today so far is never the candle", "l", (s) => s.replace(".filter((b) => b && !b.partial && ", ".filter((b) => b && ")],
  ["a missing field withholds that level only, and says why", "l", (s) => s.replace("if (!vals.every(finite)) return none(fieldMissingReason(key, field));", "")],
  ["a missing field withholds that level only, and says why", "l", (s) => s.replace("if (r && !reasons.includes(r)) reasons.push(r);", "")],
  ["distance words: above / below the right way round, 'at the last price' when it rounds to zero", "l", (s) => s.replace('${pct > 0 ? "above" : "below"}', '${pct > 0 ? "below" : "above"}')],
  ["distance words: above / below the right way round, 'at the last price' when it rounds to zero", "l", (s) => s.replace("export const AT_PRICE_BELOW_PCT = 0.05;", "export const AT_PRICE_BELOW_PCT = 0;")],
  ["dates and prices in words", "l", (s) => s.replace("${WEEKDAYS[d.getUTCDay()]}", "${WEEKDAYS[(d.getUTCDay() + 1) % 7]}")],
  ["dates and prices in words", "l", (s) => s.replace("const dp = Math.abs(v) < 1 ? 4 : Math.abs(v) >= WHOLE_DOLLARS_FROM ? 0 : 2;", "const dp = Math.abs(v) < 1 ? 4 : 2;")],
  ["dates and prices in words", "l", (s) => s.replace("const dp = Math.abs(v) < 1 ? 4 : Math.abs(v) >= WHOLE_DOLLARS_FROM ? 0 : 2;", "const dp = Math.abs(v) >= WHOLE_DOLLARS_FROM ? 0 : 2;")],
  ["the card is never blank: no bars still gives the reason", "c", (s) => s.replace(") : k.reasons.map((r) => <p key={r} className=\"klReason\"", ") : false && k.reasons.map((r) => <p key={r} className=\"klReason\"")],
  ["the Tiingo credit only when it is passed", "c", (s) => s.replace("{pole?.skipped || credit ? (", "{true ? (").replace("{credit ? <>Daily prices: {credit}</> : null}", "<>Daily prices: {credit}</>")],
];
for (const [name, which, mutate] of mutants) {
  const l2 = which === "l" ? mutate(L) : L;
  const c2 = which === "c" ? mutate(Cd) : Cd;
  const b2 = which === "b" ? mutate(Bs) : Bs;
  const s2 = which === "s" ? mutate(SS) : SS;
  const changed = l2 !== L || c2 !== Cd || b2 !== Bs || s2 !== SS;
  let bites = false;
  try { bites = !rules[name](await measure(await load(l2, c2, b2, s2))); } catch { bites = true; }
  check(`mutant bites: ${name}`, changed && bites, changed ? "" : "the mutation did not apply");
}
const staticMutants = [
  ["no fetch, no Redis, no provider reads in any file", (l, c, p, b) => [`${l}\nconst x = fetch("/api/history");`, c, p, b]],
  ["no fetch, no Redis, no provider reads in any file", (l, c, p, b) => [l, c, p, `${b}\nconst x = fetch("/api/history");`]],
  ["the modules import only each other; the card only React, C's TapNote and the modules", (l, c, p, b) => [l, c, p, `import { getDailyHistory } from "@/lib/server/historyCache";\n${b}`]],
  ["the modules import only each other; the card only React, C's TapNote and the modules", (l, c, p, b) => [`import { readTiingoHistoryPoints } from "@/lib/server/tiingoHistory";\n${l}`, c, p, b]],
  ["the modules import only each other; the card only React, C's TapNote and the modules", (l, c, p, b) => [l, `import { getDailyHistory } from "@/lib/server/historyCache";\n${c}`, p, b]],
  ["placement: in the sidebar, directly above the earnings snapshot (the Performance card between them since #111), on the page's own bars, credited only on Tiingo bars", (l, c, p) => [l, c, p.replace('nowMs={renderedAt} credit={shownProvider === "tiingo" ? historyCredit : undefined} />', "nowMs={renderedAt} credit={historyCredit} />")]],
  ["placement: in the sidebar, directly above the earnings snapshot (the Performance card between them since #111), on the page's own bars, credited only on Tiingo bars", (l, c, p) => [l, c, p.replace(/\s*<KeyLevelsCard [^\n]*\n/, "\n")]],
  ["placement: in the sidebar, directly above the earnings snapshot (the Performance card between them since #111), on the page's own bars, credited only on Tiingo bars", (l, c, p) => [l, c, p.replace("<KeyLevelsCard bars={history}", "<KeyLevelsCard bars={history.slice(-5)}")]],
];
for (const [name, mutate] of staticMutants) {
  const args = [code(L, LIB), code(Cd, CARD), code(P, PAGE), code(Bs, BARS)];
  const out = mutate(...args);
  const changed = out.some((s, i) => s !== args[i]);
  check(`mutant bites: ${name}`, changed && !staticRules[name](...out), changed ? "" : "the mutation did not apply");
}

console.log(`\n${failures ? `${failures} FAILED` : "all passed"}\n`);
process.exit(failures ? 1 : 0);
