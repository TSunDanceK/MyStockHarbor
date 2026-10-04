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

/** The two modules and the card (with A's ReasonedValue), one transpiled unit. */
async function load(lib = fs.readFileSync(LIB, "utf8"), card = fs.readFileSync(CARD, "utf8"), barsLib = fs.readFileSync(BARS, "utf8"), sess = fs.readFileSync(SESS, "utf8")) {
  const unit = `${reasonedValueUnit()}\n${strip(sess)}\n${strip(lib)}\n${strip(barsLib)}\n${strip(card).replace("export default function KeyLevelsCard", "export function KeyLevelsCard")}\n`;
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
    midRows: M.barRows(K.midWeek, K.midWeek.lastClose),
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
  "one shared scale: day inside week inside month, every mark at its own price": ({ rows, midRows, K, M }) => {
    const right = (b) => b.left + b.width;
    const inside = (a, b) => a.left >= b.left - 1e-9 && right(a) <= right(b) + 1e-9;
    // A slight pad either side: 4% of the span, written out here so the constant can't drift silently.
    const pad = (0.04 / 1.08) * 100;
    // Wed 30 Sep: the week sits inside September, so day ⊂ week ⊂ month, the month at the padded edges.
    const [d2, w2, m2] = midRows.map((r) => r.bar);
    const nested = inside(d2, w2) && inside(w2, m2) && near(m2.left, pad) && near(right(m2), 100 - pad);
    // Fri 2 Oct: the week (from Mon 28 Sep) reaches back past the month (from Thu 1 Oct), so the
    // scale spans both: the day inside each, the widest edges at the padding.
    const [d, w, m] = rows.map((r) => r.bar);
    const union = inside(d, w) && inside(d, m) && near(Math.min(w.left, m.left), pad) && near(Math.max(right(w), right(m)), 100 - pad);
    const k = K.monthMidWeek, s = M.sharedScale(k, k.lastClose);
    return rows.every((r) => r.bar) && nested && union &&
      ["day", "week", "month"].every((key, i) => near(rows[i].bar.open, M.toPct(lv(k, key).levels.open.value, s)) &&
        near(rows[i].bar.left, M.toPct(lv(k, key).levels.low.value, s)) && near(rows[i].bar.dot, M.toPct(k.lastClose, s)));
  },
  "the scale takes in a last price outside every range": ({ outside }) =>
    outside.every((r) => r.bar.dot > r.bar.left + r.bar.width && r.bar.dot <= 100 && r.bar.dot >= 90),
  "colour: green above the open, red below, neutral within a hair": ({ M }) =>
    M.toneOf(101, 100) === "up" && M.toneOf(99, 100) === "down" && M.toneOf(100.04, 100) === "flat" && M.toneOf(100, null) === "flat",
  "never colour alone: the dot sits right of the tick when green, left when red, and the note says so": ({ rows, outside, M }) =>
    [...rows, ...outside].every((r) => {
      const b = r.bar;
      return b.tone === "flat" ? b.note.includes(M.TONE_WORDS.flat)
        : (b.tone === "up" ? b.dot > b.open : b.dot < b.open) && b.note.includes(M.TONE_WORDS[b.tone]);
    }) && outside.every((r) => r.bar.tone === "up"),
  "each bar has its tap note: open, high and low against the last price, and the open's day": ({ rows, outside, fullHtml, K }) => {
    const w = rows[1].bar.note, wo = outside[1].bar.note, open = lv(K.monthMidWeek, "week").levels.open.value;
    return /Opened at \$[\d,.]+ on Mon 28 Sep\./.test(w) && w.includes(`Opened at $${open.toFixed(2)}`) &&
      /^Open \$[\d,.]+, [\d.]+% below the last price\. High \$[\d,.]+, [\d.]+% below the last price\. Low \$[\d,.]+, [\d.]+% below the last price\./.test(wo) &&
      (fullHtml.match(/<span class="klRange"[^>]*><span[^>]*><span role="button"/g) ?? []).length === 3;
  },
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
    /What are these\?/.test(full) && M.KEY_LEVELS_NOTE.startsWith("Levels some traders watch") && fullHtml.includes("Levels some traders watch") &&
    /Bar: low to high · tick: the open · dot: the last price\./.test(full) &&
    !/\b(buy|sell|bullish|bearish|support|resistance|target|should|recommend)\b/i.test(`${full} ${M.KEY_LEVELS_NOTE} ${rows.map((r) => r.bar.note).join(" ")}`),
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
  const after = M.keyLevels([...THU, PART], { nowMs: ET("2026-10-02", "17:30") }); // after the close
  const pre = M.keyLevels([...THU, { ...PART, date: "2026-10-05" }], { nowMs: ET("2026-10-05", "08:00") }); // pre-market Monday
  const sat = M.keyLevels(F.monthMidWeek, { nowMs: ET("2026-10-03", "12:00") }); // Saturday, no partial
  const staleMon = M.keyLevels([...THU, PART], { nowMs: ET("2026-10-05", "10:00") }); // in session Monday, a Friday partial left over
  const hol = M.keyLevels(F.holiday.filter((b) => b.date <= "2026-09-04"), { nowMs: ET("2026-09-07", "11:00") }); // Labor Day
  return {
    inS, stale, after, pre, sat, hol, staleMon,
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
  "out of session: the last completed session, never a stale or out-of-hours partial": ({ S }) =>
    [S.stale, S.after, S.staleMon].every((k) => k.live === null && k.asOf === "2026-10-01" && lv(k, "day").levels.high.value !== 260) &&
    S.pre.live === null && S.pre.asOf === "2026-10-01" &&
    /as of the close on Thu 1 Oct 2026/.test(S.satText) && !/today so far/.test(S.satText),
  "a Saturday and a market holiday: the last close, no 'today so far'": ({ S, M }) =>
    S.sat.live === null && S.sat.asOf === "2026-10-02" && S.hol.live === null && S.hol.asOf === "2026-09-04" &&
    !M.inSession(ET("2026-10-03", "12:00")) && !M.inSession(ET("2026-10-04", "12:00")),
});

const staticRules = {
  "no fetch, no Redis, no provider reads in any file": (l, c, _p, b) =>
    ![l, c, b].some((s) => /fetch\(|redis|Redis|unstable_cache|readTiingo|getDailyHistory|historyForSurface|readSurfaceInputs/.test(s)),
  "the modules import only each other; the card only React's types, A's ReasonedValue and the modules": (l, c, _p, b) => {
    const imports = [...c.matchAll(/^import[\s\S]*?from\s*"([^"]+)";$/gm)].map((m) => m[1]);
    const barImports = [...b.matchAll(/^import[\s\S]*?from\s*"([^"]+)";$/gm)].map((m) => m[1]);
    const libImports = [...l.matchAll(/^import[\s\S]*?from\s*"([^"]+)";$/gm)].map((m) => m[1]);
    return libImports.length === 1 && libImports[0] === "./sessionBar" && barImports.length === 1 && barImports[0] === "./keyLevels" &&
      imports.every((i) => i === "react" || i === "@/app/components/EstimatedValue" || i === "@/lib/ta/keyLevels" || i === "@/lib/ta/keyLevelBars") &&
      /^import type \{[^}]*\} from "react";$/m.test(c) && /^import \{ ReasonedValue \} from "@\/app\/components\/EstimatedValue";$/m.test(c);
  },
  "placement: in the sidebar, directly above the earnings snapshot, on the page's own bars, credited only on Tiingo bars": (_l, _c, p) => {
    const side = p.slice(p.indexOf('<aside className="stock-page-sidebar">'), p.indexOf("</aside>"));
    return /<KeyLevelsCard bars=\{history\} lastPrice=\{quote\?\.price \?\? null\} nowMs=\{renderedAt\} credit=\{shownProvider === "tiingo" \? historyCredit : undefined\} \/>[\s{}]*<LatestEarningsCard /.test(side) &&
      (p.match(/<KeyLevelsCard /g) ?? []).length === 1 && /^import KeyLevelsCard from "\.\/KeyLevelsCard";$/m.test(p);
  },
  "a tap on the bar opens its row's note": (_l, c) =>
    /<div className="klTrack" data-tone=\{r\.bar\.tone\} onClick=\{openRowNote\}/.test(c) &&
    /e\.currentTarget\.closest\("\.klRow"\)\?\.querySelector<HTMLElement>\("\.klRange \[role=\\"button\\"\]"\)\?\.click\(\);/.test(c),
  "the tick and the dot both stay visible where they meet: the tick is taller, the dot on top": (_l, c) =>
    /className="klOpen" style=\{\{ position: "absolute", top: 0, height: 18,[^\n]*?zIndex: 1 \}\}/.test(c) &&
    /className="klDot" style=\{\{ position: "absolute", top: 4, width: 10, height: 10,[^\n]*?zIndex: 2 \}\}/.test(c),
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
  ["out of session: the last completed session, never a stale or out-of-hours partial", "s", (s) => s.replace("Number.isFinite(nowMs) && inSession(nowMs) && last.date", "Number.isFinite(nowMs) && last.date")],
  ["out of session: the last completed session, never a stale or out-of-hours partial", "c", (s) => s.replace("{k.live ? <>today so far", "{true ? <>today so far")],
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
  ["one shared scale: day inside week inside month, every mark at its own price", "b", (s) => s.replace("const spans = k.periods.map(span)", "const spans = k.periods.slice(0, 1).map(span)")],
  ["one shared scale: day inside week inside month, every mark at its own price", "b", (s) => s.replace("width: toPct(sp.high, s) - toPct(sp.low, s),", "width: toPct(sp.high, s),")],
  ["one shared scale: day inside week inside month, every mark at its own price", "b", (s) => s.replace("open: isNum(open) ? toPct(open, s) : null,", "open: isNum(open) ? toPct(sp.low, s) : null,")],
  ["one shared scale: day inside week inside month, every mark at its own price", "b", (s) => s.replace("export const SCALE_PAD = 0.04;", "export const SCALE_PAD = 0;")],
  ["the scale takes in a last price outside every range", "b", (s) => s.replace("  if (isNum(last)) vals.push(last);\n", "")],
  ["the scale takes in a last price outside every range", "b", (s) => s.replace("dot: toPct(last, s),", "dot: toPct(k.lastClose ?? last, s),")],
  ["colour: green above the open, red below, neutral within a hair", "b", (s) => s.replace('return pct > 0 ? "up" : "down";', 'return pct > 0 ? "down" : "up";')],
  ["colour: green above the open, red below, neutral within a hair", "b", (s) => s.replace('  if (Math.abs(pct) < LEVEL_WITH_OPEN_PCT) return "flat";\n', "")],
  ["never colour alone: the dot sits right of the tick when green, left when red, and the note says so", "b", (s) => s.replace("`on ${dayWords(p.from)}`}. ${TONE_WORDS[tone]}`", "`on ${dayWords(p.from)}`}.`")],
  ["never colour alone: the dot sits right of the tick when green, left when red, and the note says so", "b", (s) => s.replace("const tone = toneOf(last, open);", "const tone = toneOf(open ?? last, last);")],
  ["each bar has its tap note: open, high and low against the last price, and the open's day", "b", (s) => s.replace("`Opened at ${priceWords(open)} ${liveDay ? \"today\" : `on ${dayWords(p.from)}`}.", "`Opened at ${priceWords(open)}.")],
  ["each bar has its tap note: open, high and low against the last price, and the open's day", "b", (s) => s.replace("`High ${against(sp.high, last)}.`", "`High ${priceWords(sp.high)}.`")],
  ["each bar has its tap note: open, high and low against the last price, and the open's day", "c", (s) => s.replace("<ReasonedValue text={r.bar.range} reason={r.bar.note} />", "{r.bar.range}")],
  ["low–high labels, whole dollars from $10,000", "b", (s) => s.replace('priceWords(v).replace(/^\\$/, "")', "v.toFixed(2)")],
  ["the card: three bars, one line with the last price and the as-of close, no Close row", "c", (s) => s.replace('{hasPrice || k.live ? "Last price" : "Last close"}', '{"Last price"}')],
  ["the card: three bars, one line with the last price and the as-of close, no Close row", "c", (s) => s.replace("<>as of the close on {k.asOfWords}</>", "<>as of {k.asOfWords}</>")],
  ["the card: three bars, one line with the last price and the as-of close, no Close row", "c", (s) => s.replace("              {r.bar.open !== null ? (", "              {false ? (")],
  ["the card measures from the page's last price, coloured by tone", "c", (s) => s.replace("const last = hasPrice ? lastPrice : k.lastClose;", "const last = k.lastClose;")],
  ["the card measures from the page's last price, coloured by tone", "c", (s) => s.replace('up: "#22c55e", down: "#ef4444"', 'up: "#ef4444", down: "#22c55e"')],
  ["a period that can't be built keeps its row, with its reason in place of the bar", "c", (s) => s.replace('<p className="klReason" style={{ ...noteStyle, marginTop: 4 }}>{r.reason}</p>', "null")],
  ["the card is never blank: no bars still gives the reason", "c", (s) => s.replace("{k.reasons.length && !rows.length ? k.reasons.map(", "{false ? k.reasons.map(")],
  ["the notes say what the levels are, and nothing reads as advice", "c", (s) => s.replace('"Levels some traders watch: ', '"Levels where traders buy: ')],
  ["the notes say what the levels are, and nothing reads as advice", "c", (s) => s.replace("Green when the last price is above the open, red when below.", "Green means buy, red means sell.")],
  ["the notes say what the levels are, and nothing reads as advice", "c", (s) => s.replace('<ReasonedValue text="What are these?" reason={KEY_LEVELS_NOTE} />', "")],
  ["the Tiingo credit only when it is passed", "c", (s) => s.replace("{credit ? <p style={noteStyle}>Daily prices: {credit}</p> : null}", "<p style={noteStyle}>Daily prices: {credit ?? \"Tiingo\"}</p>")],
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
  ["the modules import only each other; the card only React's types, A's ReasonedValue and the modules", (l, c, p, b) => [l, c, p, `import { getDailyHistory } from "@/lib/server/historyCache";\n${b}`]],
  ["a tap on the bar opens its row's note", (l, c, p, b) => [l, c.replace(" onClick={openRowNote}", ""), p, b]],
  ["a tap on the bar opens its row's note", (l, c, p, b) => [l, c.replace('.querySelector<HTMLElement>(".klRange [role=\\"button\\"]")?.click();', ';'), p, b]],
  ["the tick and the dot both stay visible where they meet: the tick is taller, the dot on top", (l, c, p, b) => [l, c.replace("top: 0, height: 18, width: 2,", "top: 5, height: 8, width: 2,"), p, b]],
  ["the tick and the dot both stay visible where they meet: the tick is taller, the dot on top", (l, c, p, b) => [l, c.replace("zIndex: 2 }}", "zIndex: 0 }}"), p, b]],
  ["the modules import only each other; the card only React's types, A's ReasonedValue and the modules", (l, c, p, b) => [`import { readTiingoHistoryPoints } from "@/lib/server/tiingoHistory";\n${l}`, c, p, b]],
  ["the modules import only each other; the card only React's types, A's ReasonedValue and the modules", (l, c, p, b) => [l, `import { getDailyHistory } from "@/lib/server/historyCache";\n${c}`, p, b]],
  ["placement: in the sidebar, directly above the earnings snapshot, on the page's own bars, credited only on Tiingo bars", (l, c, p) => [l, c, p.replace('credit={shownProvider === "tiingo" ? historyCredit : undefined} />', "credit={historyCredit} />")]],
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
