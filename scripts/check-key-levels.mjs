// THE "KEY LEVELS" CARD (#563 COWORK #64, on #552 CODE-A #137 §1; range bars,
// #66/#67): C's files lib/ta/keyLevels.ts, lib/ta/keyLevelBars.ts and
// app/stock/[symbol]/KeyLevelsCard.tsx, plus the one insertion in the stock
// page's sidebar.
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
//   7. THE BARS (#66): three rows on separate scales (the nesting is the point),
//      a scale that drops the last price, a tick or dot off its price, the
//      colour backwards or alone (the dot against the tick and the note's words
//      must say the same), a bar with no tap note, labels too wide for 320 px.
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
const BARS = "lib/ta/keyLevelBars.ts";
const SESS = "lib/ta/sessionBar.ts";
const CARD = "app/stock/[symbol]/KeyLevelsCard.tsx";
const PAGE = "app/stock/[symbol]/StockSymbolPageClient.tsx";
const strip = (src) => src.replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "").replace(/^"use client";$/m, "");

/** C's TapNote (#563 COWORK #88/#89), with the two hooks the shared unit doesn't import. */
const tapNoteUnit = () => `import { useCallback, useLayoutEffect } from "react";\n${strip(fs.readFileSync("app/stock/[symbol]/TapNote.tsx", "utf8"))}`;

/** The two modules and the card (with A's ReasonedValue), one transpiled unit. */
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
  const close = K.monthMidWeek.lastClose;
  const big = F.monthMidWeek.map((b) => ({ ...b, open: b.open * 120, high: b.high * 120, low: b.low * 120, close: b.close * 120 }));
  return {
    M, K,
    rows: M.barRows(K.monthMidWeek, close),
    split: M.barRows(M.keyLevels(SPLIT), SPLIT.at(-1).close),
    splitK: M.keyLevels(SPLIT),
    gapUp: M.barRows(M.keyLevels(GAP_UP), GAP_UP.at(-1).close),
    gapDown: M.barRows(M.keyLevels(GAP_DOWN), GAP_DOWN.at(-1).close),
    flat: M.barRows(M.keyLevels(FLAT), FLAT.at(-1).close),
    flatGap: M.barRows(M.keyLevels(FLAT_GAP), FLAT_GAP.at(-1).close),
    tinyGap: M.barRows(M.keyLevels(TINY_GAP), TINY_GAP.at(-1).close),
    bigGap: M.barRows(M.keyLevels(BIG_GAP), BIG_GAP.at(-1).close),
    gapDownHtml: render({ bars: GAP_DOWN, lastPrice: null }),
    flatHtml: render({ bars: FLAT, lastPrice: null }),
    gapUpHtml: render({ bars: GAP_UP, lastPrice: null }),
    splitHtml: render({ bars: SPLIT, lastPrice: null }),
    firstOfMonth: M.keyLevels(F.monthMidWeek.filter((b) => b.date <= "2026-10-01")),
    outside: M.barRows(K.monthMidWeek, 400),
    bigRows: M.barRows(M.keyLevels(big), big[big.length - 1].close),
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
    noteHtml: (bar) => renderToStaticMarkup(React.createElement(M.RowNoteBody, { bar })),
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
  "each row on its own scale: low to high, stretched to a previous close outside it; dot, tick, ◇ and bar at their places (#79/#81)": ({ rows, K, split, splitK }) =>
    [[rows, K.monthMidWeek], [split, splitK]].every(([rs, k]) => rs.every((r, i) => {
      const L = k.periods[i].levels, pc = k.periods[i].prevClose.value;
      const lo = Math.min(L.low.value, pc), hi = Math.max(L.high.value, pc);
      if (r.bar.prev.gap === null && !(near(lo, L.low.value) && near(hi, L.high.value))) return false;
      // A tiny gap widens the scale a little further; none of these rows has one.
      const pct = (v) => ((v - lo) / (hi - lo)) * 100;
      return near(r.bar.open, pct(L.open.value)) && near(r.bar.dot, Math.max(0, Math.min(100, pct(k.lastClose)))) &&
        near(r.bar.prev.pos, pct(pc)) && near(r.bar.from, pct(L.low.value)) && near(r.bar.to, pct(L.high.value));
    })) &&
    // No gap: the bar fills the track.
    split.some((r) => r.bar.prev.gap === null) && split.filter((r) => r.bar.prev.gap === null).every((r) => r.bar.from === 0 && r.bar.to === 100),
  "the rows differ: near the week's low and the day's high at once (#79)": ({ split }) =>
    split[0].bar.dot > 85 && split[1].bar.dot < 25,
  "a gap stretches the row's scale: the bar shorter, the ◇ at the stretched end, grey track between, the note gives the size (#81)": ({ gapUp, gapDown, M }) => {
    const u = gapUp[0].bar, d = gapDown[0].bar;
    return u.prev.gap === "below" && u.prev.pos === 0 && near(u.from, (172 - 166) / (180 - 166) * 100) && u.to === 100 &&
      u.prev.gapWords === `prev close ${((172 - 166) / 172 * 100).toFixed(1)}% below the low` &&
      d.prev.gap === "above" && d.prev.pos === 100 && d.from === 0 && near(d.to, (180 - 172) / (190 - 172) * 100) &&
      d.prev.gapWords === `prev close ${((190 - 180) / 180 * 100).toFixed(1)}% above the high` &&
      // The dot and tick on the stretched scale: Friday opened 175, last 178.
      near(u.open, (175 - 166) / 14 * 100) && near(u.dot, (178 - 166) / 14 * 100) &&
      M.prevMark(175, 172, 180).gap === null && near(M.prevMark(175, 172, 180).pos, 37.5) && M.prevMark(175, 172, 180).gapWords === null;
  },
  "a tiny gap keeps the ◇ a minimum offset from the bar's end; a big one shows a visibly shorter bar (#81)": ({ tinyGap, bigGap, M }) => {
    const t = tinyGap[0].bar, b = bigGap[0].bar;
    return t.prev.gap === "below" && t.prev.pos === 0 && near(t.from, M.MIN_GAP_PCT) && t.prev.gapWords === "prev close 0.1% below the low" &&
      b.prev.gap === "below" && b.prev.pos === 0 && near(b.from, (172 - 160) / (180 - 160) * 100) && b.to - b.from < 50 &&
      b.prev.gapWords === `prev close ${((172 - 160) / 172 * 100).toFixed(1)}% below the low`;
  },
  "a flat range: centred marks and 'no range yet'; after a gap, the bar at the far end from the ◇ (#79/#81)": ({ flat, flatGap, flatHtml, M }) =>
    flat[0].bar.prev.gap === null && flat[0].bar.from === 0 && flat[0].bar.to === 100 &&
    flatGap[0].bar.flat && flatGap[0].bar.prev.pos === 0 && flatGap[0].bar.from === 100 && flatGap[0].bar.dot === 100 &&
    flat[0].bar.flat && flat[0].bar.dot === 50 && flat[0].bar.open === 50 && flat[0].bar.note.includes(M.FLAT_RANGE_WORDS) &&
    /class="klFlat"[^>]*>No range yet</.test(flatHtml) && !flat[1].bar.flat,
  "previous closes: the session before, last week's and last month's final sessions; missing ones say why (#78)": ({ K, firstOfMonth, M }) => {
    const k = K.monthMidWeek, b = F.monthMidWeek, p = (key) => lv(k, key).prevClose;
    const f = lv(firstOfMonth, "month").prevClose, one = lv(K.oneBar, "day");
    return p("day").date === "2026-10-01" && near(p("day").value, at(b, "2026-10-01").close) &&
      p("week").date === "2026-09-25" && near(p("week").value, at(b, "2026-09-25").close) &&
      p("month").date === "2026-09-30" && f.date === "2026-09-30" && lv(firstOfMonth, "day").prevClose.date === "2026-09-30" &&
      one.prevClose === null && one.prevReason === M.PREV_MISSING.day;
  },
  "the ◇ is drawn and keyed, its note gives value, date and distance (#78)": ({ fullHtml, full, rows, gapUpHtml, gapDownHtml, splitHtml }) =>
    (fullHtml.match(/class="klPrev"/g) ?? []).length === 3 && !/klPrevPin|◂|▸/.test(fullHtml + gapUpHtml + gapDownHtml) &&
    // Inside the range (SPLIT's day: Thursday's 166 within Friday's 158–168): drawn in place, the bar full width.
    /class="klPrev" style="[^"]*left:80%/.test(splitHtml) &&
    /grey space between ◇ and the bar: a gap from the previous close/.test(full) &&
    // On a gap the bar is drawn short on the stretched scale, the ◇ at the end, over a grey rail.
    /class="klRail"/.test(gapUpHtml) && /class="klBar" style="[^"]*left:42\.857\d*%;width:57\.142\d*%/.test(gapUpHtml) &&
    /class="klPrev" style="[^"]*left:0%/.test(gapUpHtml) && /class="klPrev" style="[^"]*left:100%/.test(gapDownHtml) &&
    /◇ previous close/.test(full) &&
    rows[0].bar.rowNote.bullets.some((b) => b.key === "prev" && b.label === "Previous session's close" && /^\$[\d,.]+ \(Thu 1 Oct\) — [\d.]+% (above|below)$/.test(b.text)) &&
    rows[1].bar.rowNote.bullets.some((b) => b.key === "prev" && b.label === "Last week's close" && /^\$[\d,.]+ \(Fri 25 Sep\)/.test(b.text)) &&
    // The gap's words left the face for the row's note (#88 §1, #89).
    !/klGap/.test(gapUpHtml + gapDownHtml),
  "the gap bullet: on gap rows only, after the previous close, with the gap's size (#89)": ({ gapUp, gapDown, rows }) => {
    const keys = (r) => r.bar.rowNote.bullets.map((b) => b.key);
    const gap = (r) => r.bar.rowNote.bullets.find((b) => b.key === "gap");
    return keys(gapUp[0]).join(",") === "open,high,low,prev,gap,last" && gap(gapUp[0]).text === `the previous close is ${((172 - 166) / 172 * 100).toFixed(1)}% below the low` &&
      gap(gapDown[0]).text === `the previous close is ${((190 - 180) / 180 * 100).toFixed(1)}% above the high` &&
      [...rows, ...gapUp, ...gapDown].every((r) => !!gap(r) === (r.bar.prev?.gap != null));
  },
  "colour: green above the open, red below, neutral within a hair": ({ M }) =>
    M.toneOf(101, 100) === "up" && M.toneOf(99, 100) === "down" && M.toneOf(100.04, 100) === "flat" && M.toneOf(100, null) === "flat",
  "never colour alone: the dot sits right of the tick when green, left when red, and the note says so": ({ rows, outside, split, M }) =>
    [...rows, ...outside, ...split].every((r) => {
      const b = r.bar;
      return b.tone === "flat" ? b.rowNote.verdict === M.VERDICT_WORDS.flat
        : (b.tone === "up" ? b.dot > b.open : b.dot < b.open) && b.rowNote.verdict === M.VERDICT_WORDS[b.tone];
    }) && outside.every((r) => r.bar.tone === "up"),
  "each row's note (#89): header, then open · high · low · previous close · last price, each once, distances from the last price": ({ rows, outside, fullHtml, K }) => {
    const n = (r) => r.bar.rowNote, w = n(rows[1]), d = n(rows[0]), wo = n(outside[1]), open = lv(K.monthMidWeek, "week").levels.open.value;
    const text = (nn, key) => nn.bullets.find((b) => b.key === key)?.text ?? "";
    return [d, w, n(rows[2])].every((x) => /^open,high,low,prev,(gap,)?last$/.test(x.bullets.map((b) => b.key).join(","))) &&
      w.title === "Week" && w.when === "from Mon 28 Sep" && d.when === "Fri 2 Oct" && /^\$[\d,.]+–\$[\d,.]+$/.test(w.range) &&
      text(w, "open").startsWith(`$${open.toFixed(2)} — `) &&
      /^\$[\d,.]+ — [\d.]+% below the last price$/.test(text(wo, "open")) && /^\$[\d,.]+ — [\d.]+% below$/.test(text(wo, "high")) && /^\$[\d,.]+ — [\d.]+% below$/.test(text(wo, "low")) &&
      /^\$[\d,.]+ — the close on Fri 2 Oct$/.test(text(d, "last")) &&
      // The open appears once: one bullet, and its price once in the whole note.
      rows.every((r) => n(r).bullets.filter((b) => b.key === "open").length === 1 && r.bar.note.split(`$${lv(K.monthMidWeek, r.key).levels.open.value.toFixed(2)}`).length === 2 && !/Opened at/.test(r.bar.note)) &&
      (fullHtml.match(/<span class="klRange"[^>]*><button type="button" data-note="[^"]+" class="tapNoteBtn"/g) ?? []).length === 3;
  },
  "the note's verdict follows the open rule, coloured; each bullet carries the card's own mark (#89)": ({ rows, outside, split, noteHtml, M }) =>
    [...rows, ...outside, ...split].every((r) => {
      const h = noteHtml(r.bar);
      const colour = { up: "#22c55e", down: "#ef4444", flat: "#94a3b8" }[r.bar.tone];
      return new RegExp(`class="klVerdict" data-tone="${r.bar.tone}" style="[^"]*color:${colour}[^"]*">${M.VERDICT_WORDS[r.bar.tone].replace("'", "(?:'|&#x27;)")}<`).test(h) &&
        (h.match(/class="klBullet" data-key="(open|high|low|prev|gap|last)"/g) ?? []).length === r.bar.rowNote.bullets.length &&
        (h.match(/<li class="klBullet"[^>]*><span aria-hidden="true" class="noteDot"/g) ?? []).length === r.bar.rowNote.bullets.length;
    }) && split.some((r) => r.bar.tone === "up") && split.some((r) => r.bar.tone === "down"),
  "low–high labels, whole dollars from $10,000": ({ rows, bigRows, K, M }) => {
    const w = lv(K.monthMidWeek, "week").levels;
    return rows[1].bar.range === `${M.bare(w.low.value)} – ${M.bare(w.high.value)}` && /^\d+\.\d\d – \d+\.\d\d$/.test(rows[1].bar.range) &&
      bigRows.every((r) => /^\d{2},\d{3} – \d{2},\d{3}$/.test(r.bar.range));
  },
  "the card: three bars, one line with the last price and the as-of close, no Close row": ({ fullHtml, full }) =>
    (fullHtml.match(/class="klTrack"/g) ?? []).length === 3 && (fullHtml.match(/class="klDot"/g) ?? []).length === 3 &&
    (fullHtml.match(/class="klOpen"/g) ?? []).length === 3 &&
    /Last close \$[\d,.]+ · as of the close on Fri 2 Oct 2026/.test(full) && !/\bClose\b/.test(full.replace("Last close", "")),
  "the card measures from the page's last price, coloured by tone": ({ priced, pricedHtml }) =>
    /Last price \$250\.00 · as of the close on Fri 2 Oct 2026/.test(priced) &&
    (pricedHtml.match(/data-tone="up"/g) ?? []).length === 3 &&
    (pricedHtml.match(/class="klDot" style="[^"]*background:#22c55e/g) ?? []).length === 3,
  "a period that can't be built keeps its row, with its reason in place of the bar": ({ shortHtml, M }) => {
    const t = visibleText(shortHtml);
    return (shortHtml.match(/class="klRow"/g) ?? []).length === 3 && (shortHtml.match(/class="klTrack"/g) ?? []).length === 1 &&
      (shortHtml.match(/class="klReason"/g) ?? []).length === 2 && t.includes(M.SHORT_REASON.week) && t.includes(M.SHORT_REASON.month);
  },
  "the card is never blank: no bars still gives the reason": ({ emptyText, M }) =>
    emptyText.includes("Key levels") && emptyText.includes(M.NO_BARS_REASON),
  "the notes say what the levels are, and nothing reads as advice": ({ fullHtml, full, rows, M }) =>
    /What are these\?/.test(full) && M.KEY_LEVELS_NOTE.startsWith("Levels some traders watch") &&
    /Bar: that period[’']s low to high · tick: the open · ◇ previous close · dot: the last price, green above the open, red below · grey space between ◇ and the bar: a gap from the previous close\./.test(full) &&
    !/\b(buy|sell|bullish|bearish|support|resistance|target|should|recommend)\b/i.test(`${full} ${M.KEY_LEVELS_NOTE} ${rows.map((r) => r.bar.note).join(" ")}`),
  "the Tiingo credit only when it is passed": ({ full, credited }) =>
    !/Daily prices:/.test(full) && /Daily prices: Tiingo credit/.test(credited),
  "the small print folded (#88 §1): 'How to read this' closed, holding the key; the credit and the last price outside": ({ creditedHtml }) => {
    const d = /<details class="howToRead"([^>]*)>([\s\S]*?)<\/details>/.exec(creditedHtml);
    return !!d && !/\bopen\b/.test(d[1]) && />How to read this ▾</.test(d[2]) && /Bar: that period[’']s low to high/.test(d[2]) &&
      !/Daily prices/.test(d[2]) && !/class="klAsOf"/.test(d[2]) && creditedHtml.indexOf("Daily prices") > creditedHtml.indexOf("</details>") &&
      (creditedHtml.match(/Bar: that period/g) ?? []).length === 1;
  },
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
      /today so far, 14:32 ET \(IEX\)/.test(S.inText) && /today so far · 14:32 ET/.test(S.inText) && !/as of the close/.test(S.inText) &&
      M.inSession(ET("2026-10-02", "09:30")) && !M.inSession(ET("2026-10-02", "09:29")) && !M.inSession(ET("2026-10-02", "16:00"));
  },
  "after the close: today's final IEX bar until the nightly job stores the day (#77)": ({ S, M }) =>
    S.after.live?.phase === "afterClose" && S.after.live.time === "16:00" && S.after.asOf === "2026-10-02" && lv(S.after, "day").levels.high.value === 260 &&
    /close, 16:00 ET \(IEX\)/.test(S.afterText) && /today · close 16:00 ET \(IEX\)/.test(S.afterText) && !/today so far/.test(S.afterText) &&
    S.eodDone.live === null && S.eodDone.asOf === "2026-10-02" && M.sinceOpen(ET("2026-10-02", "17:30")) && !M.sinceOpen(ET("2026-10-02", "09:00")),
  "out of session: the last completed session, never a stale or out-of-hours partial": ({ S }) =>
    [S.stale, S.staleMon].every((k) => k.live === null && k.asOf === "2026-10-01" && lv(k, "day").levels.high.value !== 260) &&
    S.pre.live === null && S.pre.asOf === "2026-10-01" &&
    /as of the close on Thu 1 Oct 2026/.test(S.satText) && !/today so far/.test(S.satText),
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
      imports.every((i) => i === "react" || i === "./TapNote" || i === "@/lib/ta/keyLevels" || i === "@/lib/ta/keyLevelBars") &&
      /^import \{ useRef, type CSSProperties, type ReactNode \} from "react";$/m.test(c) && /^import \{[^}]*\} from "\.\/TapNote";$/m.test(c);
  },
  "placement: in the sidebar, directly above the earnings snapshot, on the page's own bars, credited only on Tiingo bars": (_l, _c, p) => {
    const side = p.slice(p.indexOf('<aside className="stock-page-sidebar">'), p.indexOf("</aside>"));
    return /<KeyLevelsCard bars=\{history\} lastPrice=\{quote\?\.price \?\? null\} nowMs=\{renderedAt\} credit=\{shownProvider === "tiingo" \? historyCredit : undefined\} \/>[\s{}]*(<\/div>[\s{}]*<div className="sp-slot sp-earnings"(?: data-reading-owner="a")?>[\s{}]*)?<LatestEarningsCard /.test(side) &&
      (p.match(/<KeyLevelsCard /g) ?? []).length === 1 && /^import KeyLevelsCard from "\.\/KeyLevelsCard";$/m.test(p);
  },
  "a tap on the bar opens its row's note (the same note as the range label, its own outside-tap owner)": (_l, c) =>
    /<div className="klTrack" \{\.\.\.note\.owner\} data-tone=\{r\.bar\.tone\}[^>]*onClick=\{note\.toggle\}/.test(c) &&
    /<span className="klRange"[^>]*>\s*<NoteButton note=\{note\}>\{r\.bar\.range\}<\/NoteButton>/.test(c) &&
    /<FlowPanel note=\{note\} anchor=\{head\} phone=\{phone\}[^>]*>\s*<RowNoteBody bar=\{r\.bar\} \/>/.test(c),
  "the tick and the dot both stay visible where they meet: the tick is taller, the dot on top, the ◇ above the bar": (_l, c) =>
    /className="klOpen" style=\{\{ position: "absolute", top: 6, height: 18,[^\n]*?zIndex: 1 \}\}/.test(c) &&
    /className="klDot" style=\{\{ position: "absolute", top: 9, width: 10, height: 10,[^\n]*?zIndex: 2 \}\}/.test(c) &&
    /const diamondStyle: CSSProperties = \{ position: "absolute", top: 0, width: 7, height: 7,/.test(c) && /className="klBar" style=\{\{ position: "absolute", top: 10, height: 8,/.test(c),
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
  ["in session: the Day column is today so far, the week and month include it, labelled with the bar's own time", "b", (s) => s.replace("const liveDay = p.key === \"day\" && !!k.live;", "const liveDay = false;")],
  ["in session: the Day column is today so far, the week and month include it, labelled with the bar's own time", "s", (s) => s.replace('return weekday >= 1 && weekday <= 5 && hhmm >= SESSION_OPEN && hhmm < SESSION_CLOSE;', 'return weekday >= 1 && weekday <= 5 && hhmm >= SESSION_OPEN && hhmm <= SESSION_CLOSE;')],
  ["out of session: the last completed session, never a stale or out-of-hours partial", "s", (s) => s.replace(" && last.date === easternNow(nowMs).date;", ";")],
  ["out of session: the last completed session, never a stale or out-of-hours partial", "s", (s) => s.replace("return weekday >= 1 && weekday <= 5 && hhmm >= SESSION_OPEN;\n}", "return true;\n}")],
  ["after the close: today's final IEX bar until the nightly job stores the day (#77)", "s", (s) => s.replace("Number.isFinite(nowMs) && sinceOpen(nowMs) && last.date", "Number.isFinite(nowMs) && inSession(nowMs) && last.date")],
  ["after the close: today's final IEX bar until the nightly job stores the day (#77)", "b", (s) => s.replace('k.live!.phase === "afterClose" ? `today · close${t} (IEX)`', 'false ? `today · close${t} (IEX)`')],
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
  ["no bars: every period withheld, with one reason", "l", (s) => s.replace("      reasons: [NO_BARS_REASON],\n", "      reasons: [],\n")],
  ["today so far is never the candle", "l", (s) => s.replace(".filter((b) => b && !b.partial && ", ".filter((b) => b && ")],
  ["a missing field withholds that level only, and says why", "l", (s) => s.replace("if (!vals.every(finite)) return none(fieldMissingReason(key, field));", "")],
  ["a missing field withholds that level only, and says why", "l", (s) => s.replace("if (r && !reasons.includes(r)) reasons.push(r);", "")],
  ["distance words: above / below the right way round, 'at the last price' when it rounds to zero", "l", (s) => s.replace('${pct > 0 ? "above" : "below"}', '${pct > 0 ? "below" : "above"}')],
  ["distance words: above / below the right way round, 'at the last price' when it rounds to zero", "l", (s) => s.replace("export const AT_PRICE_BELOW_PCT = 0.05;", "export const AT_PRICE_BELOW_PCT = 0;")],
  ["dates and prices in words", "l", (s) => s.replace("${WEEKDAYS[d.getUTCDay()]}", "${WEEKDAYS[(d.getUTCDay() + 1) % 7]}")],
  ["dates and prices in words", "l", (s) => s.replace("const dp = Math.abs(v) < 1 ? 4 : Math.abs(v) >= WHOLE_DOLLARS_FROM ? 0 : 2;", "const dp = Math.abs(v) < 1 ? 4 : 2;")],
  ["dates and prices in words", "l", (s) => s.replace("const dp = Math.abs(v) < 1 ? 4 : Math.abs(v) >= WHOLE_DOLLARS_FROM ? 0 : 2;", "const dp = Math.abs(v) >= WHOLE_DOLLARS_FROM ? 0 : 2;")],
  ["each row on its own scale: the bar is that period's low to high; dot, tick and ◇ at their places in it (#79)", "b", (s) => s.replace("return high > low ? ((v - low) / (high - low)) * 100 : 50;", "return high > low ? ((v - low) / high) * 100 : 50;")],
  ["the rows differ: near the week's low and the day's high at once (#79)", "b", (s) => s.replace("const raw = at(last);", "const raw = rowPct(last, k.periods[1].levels.low.value ?? sp.low, k.periods[1].levels.high.value ?? sp.high);")],
  ["each row on its own scale: low to high, stretched to a previous close outside it; dot, tick, ◇ and bar at their places (#79/#81)", "b", (s) => s.replace("const at = (v: number) => rowPct(v, sc.lo, sc.hi);", "const at = (v: number) => rowPct(v, sp.low, sp.high);")],
  ["each row on its own scale: low to high, stretched to a previous close outside it; dot, tick, ◇ and bar at their places (#79/#81)", "b", (s) => s.replace("from: sc.hi > sc.lo ? at(sp.low) : 0,", "from: 0,")],
  ["a gap stretches the row's scale: the bar shorter, the ◇ at the stretched end, grey track between, the note gives the size (#81)", "b", (s) => s.replace("if (prev === null || (prev >= low && prev <= high)) return { lo: low, hi: high };", "return { lo: low, hi: high };")],
  ["a gap stretches the row's scale: the bar shorter, the ◇ at the stretched end, grey track between, the note gives the size (#81)", "b", (s) => s.replace('const pos = gap === "below" ? 0 : gap === "above" ? 100 :', 'const pos = gap === "below" ? 100 : gap === "above" ? 0 :')],
  ["a gap stretches the row's scale: the bar shorter, the ◇ at the stretched end, grey track between, the note gives the size (#81)", "b", (s) => s.replace("((v - high) / high * 100).toFixed(1)", "((v - high) / v * 100).toFixed(1)")],
  ["a tiny gap keeps the ◇ a minimum offset from the bar's end; a big one shows a visibly shorter bar (#81)", "b", (s) => s.replace("if (prev < low) return { lo: Math.min(prev, high > low ? (low - m * high) / (1 - m) : prev), hi: high };", "if (prev < low) return { lo: prev, hi: high };")],
  ["a tiny gap keeps the ◇ a minimum offset from the bar's end; a big one shows a visibly shorter bar (#81)", "b", (s) => s.replace("if (prev < low) return { lo: Math.min(prev, high > low ? (low - m * high) / (1 - m) : prev), hi: high };", "if (prev < low) return { lo: Math.min(prev, (low - m * high) / (1 - m)) - (high - low), hi: high };")],
  ["a flat range: centred marks and 'no range yet'; after a gap, the bar at the far end from the ◇ (#79/#81)", "b", (s) => s.replace("const flat = !(sp.high > sp.low);", "const flat = false;")],
  ["a flat range: centred marks and 'no range yet'; after a gap, the bar at the far end from the ◇ (#79/#81)", "c", (s) => s.replace('{r.bar.flat ? <div className="klFlat"', '{false ? <div className="klFlat"')],
  ["previous closes: the session before, last week's and last month's final sessions; missing ones say why (#78)", "l", (s) => s.replace("prevClose: prevOf(closed, closed.length - 1),", "prevClose: prevOf(closed, closed.length - 2),")],
  ["previous closes: the session before, last week's and last month's final sessions; missing ones say why (#78)", "l", (s) => s.replace("prevClose: prevOf(bars, firstIn), prevReason: null };", "prevClose: prevOf(bars, firstIn - 1), prevReason: null };")],
  ["previous closes: the session before, last week's and last month's final sessions; missing ones say why (#78)", "l", (s) => s.replace("prevReason: closed.length > 1 ? null : PREV_MISSING.day }", "prevReason: null }")],
  ["the ◇ is drawn and keyed, its note gives value, date and distance (#78)", "c", (s) => s.replace('<div className="klPrev" style={{ ...diamondStyle, left: `${r.bar.prev.pos}%` }} />', "null")],
  ["the ◇ is drawn and keyed, its note gives value, date and distance (#78)", "c", (s) => s.replace("tick: the open · ◇ previous close · dot", "tick: the open · dot")],
  ["the ◇ is drawn and keyed, its note gives value, date and distance (#78)", "c", (s) => s.replace(" · grey space between ◇ and the bar: a gap from the previous close.", ".")],
  ["the ◇ is drawn and keyed, its note gives value, date and distance (#78)", "c", (s) => s.replace("left: `${r.bar.from}%`, width: `${r.bar.to - r.bar.from}%`,", "left: 0, right: 0,")],
  ["the ◇ is drawn and keyed, its note gives value, date and distance (#78)", "b", (s) => s.replace("text: `${priceWords(p.prevClose.value)} (${dayWords(p.prevClose.date)})", "text: `${priceWords(p.prevClose.value)}")],
  ["the ◇ is drawn and keyed, its note gives value, date and distance (#78)", "c", (s) => s.replace('{r.bar.flat ? <div className="klFlat"', '{r.bar.prev?.gapWords ? <div className="klGap">◇ {r.bar.prev.gapWords}</div> : null}\n          {r.bar.flat ? <div className="klFlat"')],
  ["the gap bullet: on gap rows only, after the previous close, with the gap's size (#89)", "b", (s) => s.replace("      if (prev?.gapWords) bullets.push(", "      if (false) bullets.push(")],
  ["the gap bullet: on gap rows only, after the previous close, with the gap's size (#89)", "b", (s) => s.replace('.replace(/^prev close /, "")', '.replace(/^prev close /, "").replace("below", "above")')],
  ["colour: green above the open, red below, neutral within a hair", "b", (s) => s.replace('return pct > 0 ? "up" : "down";', 'return pct > 0 ? "down" : "up";')],
  ["colour: green above the open, red below, neutral within a hair", "b", (s) => s.replace('  if (Math.abs(pct) < LEVEL_WITH_OPEN_PCT) return "flat";\n', "")],
  ["never colour alone: the dot sits right of the tick when green, left when red, and the note says so", "b", (s) => s.replace("verdict: isNum(open) ? VERDICT_WORDS[tone] : null,", "verdict: isNum(open) ? VERDICT_WORDS.up : null,")],
  ["never colour alone: the dot sits right of the tick when green, left when red, and the note says so", "b", (s) => s.replace("const tone = toneOf(last, open);", "const tone = toneOf(open ?? last, last);")],
  ["each row's note (#89): header, then open · high · low · previous close · last price, each once, distances from the last price", "b", (s) => s.replace('    if (isNum(open)) bullets.push({ key: "open"', '    bullets.push({ key: "last", label: "Last price", text: "" });\n    if (isNum(open)) bullets.push({ key: "open"')],
  ["each row's note (#89): header, then open · high · low · previous close · last price, each once, distances from the last price", "b", (s) => s.replace('      flat ? FLAT_RANGE_WORDS : "",', '      isNum(open) ? `Opened at ${priceWords(open)}.` : "",\n      flat ? FLAT_RANGE_WORDS : "",')],
  ["each row's note (#89): header, then open · high · low · previous close · last price, each once, distances from the last price", "b", (s) => s.replace('label: "Open", text: from(open, last, true)', 'label: "Open", text: from(open, last, false)')],
  ["each row's note (#89): header, then open · high · low · previous close · last price, each once, distances from the last price", "b", (s) => s.replace("p.key === \"day\" ? dayWords(p.from) : `from ${dayWords(p.from)}`,\n      range", "p.key === \"day\" ? dayWords(p.from) : dayWords(p.from),\n      range")],
  ["each row's note (#89): header, then open · high · low · previous close · last price, each once, distances from the last price", "c", (s) => s.replace("<NoteButton note={note}>{r.bar.range}</NoteButton>", "{r.bar.range}")],
  ["the note's verdict follows the open rule, coloured; each bullet carries the card's own mark (#89)", "c", (s) => s.replace("color: TONE_COLOUR[n.tone] }}>{n.verdict}", "color: C.value }}>{n.verdict}")],
  ["the note's verdict follows the open rule, coloured; each bullet carries the card's own mark (#89)", "c", (s) => s.replace("<NoteDot shape={MARK[b.key].shape} colour={MARK[b.key].colour(n.tone)} />", "")],
  ["low–high labels, whole dollars from $10,000", "b", (s) => s.replace('priceWords(v).replace(/^\\$/, "")', "v.toFixed(2)")],
  ["the card: three bars, one line with the last price and the as-of close, no Close row", "c", (s) => s.replace('{hasPrice || k.live ? "Last price" : "Last close"}', '{"Last price"}')],
  ["the card: three bars, one line with the last price and the as-of close, no Close row", "c", (s) => s.replace("<>as of the close on {k.asOfWords}</>", "<>as of {k.asOfWords}</>")],
  ["the card: three bars, one line with the last price and the as-of close, no Close row", "c", (s) => s.replace("              {r.bar.open !== null ? (", "              {false ? (")],
  ["the card measures from the page's last price, coloured by tone", "c", (s) => s.replace("const last = hasPrice ? lastPrice : k.lastClose;", "const last = k.lastClose;")],
  ["the card measures from the page's last price, coloured by tone", "c", (s) => s.replace('up: "#22c55e", down: "#ef4444"', 'up: "#ef4444", down: "#22c55e"')],
  ["a period that can't be built keeps its row, with its reason in place of the bar", "c", (s) => s.replace('<p className="klReason" style={{ ...noteStyle, marginTop: 4 }}>{r.reason}</p>', "null")],
  ["the card is never blank: no bars still gives the reason", "c", (s) => s.replace("{k.reasons.length && !rows.length ? k.reasons.map(", "{false ? k.reasons.map(")],
  ["the notes say what the levels are, and nothing reads as advice", "c", (s) => s.replace('"Levels some traders watch: ', '"Levels where traders buy: ')],
  ["the notes say what the levels are, and nothing reads as advice", "c", (s) => s.replace("dot: the last price, green above the open, red below", "dot: the last price. Green means buy, red means sell")],
  ["the notes say what the levels are, and nothing reads as advice", "c", (s) => s.replace("<NoteButton note={what}>What are these?</NoteButton>", "")],
  ["the Tiingo credit only when it is passed", "c", (s) => s.replace('{credit ? <p className="klCredit" data-fine-print style={noteStyle}>Daily prices: {credit}</p> : null}', '<p className="klCredit" style={noteStyle}>Daily prices: {credit ?? "Tiingo"}</p>')],
  ["the small print folded (#88 §1): 'How to read this' closed, holding the key; the credit and the last price outside", "c", (s) => s.replace('<p className="klKey" style={{ margin: 0 }}>{KEY_LINE}</p>', '<p className="klKey" style={{ margin: 0 }}>{KEY_LINE}</p>\n          {credit ? <p>Daily prices: {credit}</p> : null}')],
  ["the small print folded (#88 §1): 'How to read this' closed, holding the key; the credit and the last price outside", "c", (s) => s.replace("        <HowToRead>\n          <p className=\"klKey\"", "        <><p className=\"klKey\" style={{ margin: 0 }}>{KEY_LINE}</p></>\n      ) : null}\n      {rows.some((r) => r.bar) ? (\n        <HowToRead>\n          <p className=\"klKey\"")],
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
  ["a tap on the bar opens its row's note (the same note as the range label, its own outside-tap owner)", (l, c, p, b) => [l, c.replace(" onClick={note.toggle}", ""), p, b]],
  ["a tap on the bar opens its row's note (the same note as the range label, its own outside-tap owner)", (l, c, p, b) => [l, c.replace(" {...note.owner} data-tone=", " data-tone="), p, b]],
  ["a tap on the bar opens its row's note (the same note as the range label, its own outside-tap owner)", (l, c, p, b) => [l, c.replace("<RowNoteBody bar={r.bar} />", "{r.bar.note}"), p, b]],
  ["the tick and the dot both stay visible where they meet: the tick is taller, the dot on top, the ◇ above the bar", (l, c, p, b) => [l, c.replace("top: 6, height: 18, width: 2,", "top: 10, height: 8, width: 2,"), p, b]],
  ["the tick and the dot both stay visible where they meet: the tick is taller, the dot on top, the ◇ above the bar", (l, c, p, b) => [l, c.replace('const diamondStyle: CSSProperties = { position: "absolute", top: 0,', 'const diamondStyle: CSSProperties = { position: "absolute", top: 10,'), p, b]],
  ["the tick and the dot both stay visible where they meet: the tick is taller, the dot on top, the ◇ above the bar", (l, c, p, b) => [l, c.replace("zIndex: 2 }}", "zIndex: 0 }}"), p, b]],
  ["the modules import only each other; the card only React, C's TapNote and the modules", (l, c, p, b) => [`import { readTiingoHistoryPoints } from "@/lib/server/tiingoHistory";\n${l}`, c, p, b]],
  ["the modules import only each other; the card only React, C's TapNote and the modules", (l, c, p, b) => [l, `import { getDailyHistory } from "@/lib/server/historyCache";\n${c}`, p, b]],
  ["placement: in the sidebar, directly above the earnings snapshot, on the page's own bars, credited only on Tiingo bars", (l, c, p) => [l, c, p.replace('nowMs={renderedAt} credit={shownProvider === "tiingo" ? historyCredit : undefined} />', "nowMs={renderedAt} credit={historyCredit} />")]],
  ["placement: in the sidebar, directly above the earnings snapshot, on the page's own bars, credited only on Tiingo bars", (l, c, p) => [l, c, p.replace(/\s*<KeyLevelsCard [^\n]*\n/, "\n")]],
  ["placement: in the sidebar, directly above the earnings snapshot, on the page's own bars, credited only on Tiingo bars", (l, c, p) => [l, c, p.replace("<KeyLevelsCard bars={history}", "<KeyLevelsCard bars={history.slice(-5)}")]],
];
for (const [name, mutate] of staticMutants) {
  const args = [code(L, LIB), code(Cd, CARD), code(P, PAGE), code(Bs, BARS)];
  const out = mutate(...args);
  const changed = out.some((s, i) => s !== args[i]);
  check(`mutant bites: ${name}`, changed && !staticRules[name](...out), changed ? "" : "the mutation did not apply");
}

console.log(`\n${failures ? `${failures} FAILED` : "all passed"}\n`);
process.exit(failures ? 1 : 0);
