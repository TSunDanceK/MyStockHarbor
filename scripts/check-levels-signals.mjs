// THE STOCK PAGE'S "PRICE LEVELS" LADDER AND "SIGNALS" GAUGES (#563 COWORK #68):
// C's lib/ta/priceLadder.ts and app/stock/[symbol]/LevelsSignals.tsx, and the
// page's hand-over of values it already computes.
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. A MARK AT THE WRONG HEIGHT: the scale upside down, a pad that hides the
//      ends, MA200 drawn below the price when it sits above it.
//   2. LABELS ON TOP OF EACH OTHER, or pushed off the ladder.
//   3. THE ZONE: the band not spanning its low to high, its touches and volume
//      lost now that Support quality lives in its note, or a missing zone
//      hidden instead of said.
//   4. RSI: the marker off its value, the 30/70 zone words changed.
//   5. MACD: "Bullish" / "Bearish" back (owner ruling: hedged wording only).
//   6. COLOUR ALONE: a label's colour not matching its side of the price.
//   7. ADVICE WORDING in the notes; the credit on bars that aren't Tiingo's.
//   8. THE PAGE: a value recomputed here instead of handed over, or a fetch.
//
//   node scripts/check-levels-signals.mjs
import fs from "node:fs";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { reasonedValueUnit, visibleText } from "./lib/render-cards.mjs";
import { stripComments } from "./lib/source-code.mjs";
import { grabFunction } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const KL = "lib/ta/keyLevels.ts";
const LIB = "lib/ta/priceLadder.ts";
const CARD = "app/stock/[symbol]/LevelsSignals.tsx";
const MACD = "lib/ta/macdSeries.ts";
const SESS = "lib/ta/sessionBar.ts";
const PAGE = "app/stock/[symbol]/StockSymbolPageClient.tsx";
const strip = (src) => src.replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "").replace(/^"use client";$/m, "");

/**
 * THE PAGE'S OWN buildMacd (and the helpers it calls), lifted from
 * StockSymbolPageClient.tsx, so the mini chart's series is checked against the
 * reading the pill shows, not against a copy of it (#563 COWORK #74).
 */
const PAGE_MACD = ["avg", "ema", "lastNum", "buildMacd"]
  .map((n) => grabFunction(fs.readFileSync("app/stock/[symbol]/StockSymbolPageClient.tsx", "utf8"), n))
  .map((f, i) => (f ?? `/* missing ${i} */`).replace(/^function (\w+)/, "function page_$1"))
  .join("\n").replace(/\b(avg|ema|lastNum)\(/g, "page_$1(").replace(/function page_page_/g, "function page_");

async function load(lib = fs.readFileSync(LIB, "utf8"), card = fs.readFileSync(CARD, "utf8"), macd = fs.readFileSync(MACD, "utf8"), sess = fs.readFileSync(SESS, "utf8")) {
  const unit = `${reasonedValueUnit()}\n${strip(sess)}\n${strip(fs.readFileSync(KL, "utf8"))}\n${strip(lib)}\n${strip(macd)}\n${PAGE_MACD}\nexport { page_buildMacd };\n${strip(card).replace("export default function LevelsSignals", "export function LevelsSignals")}\n`;
  const js = ts.transpileModule(unit, {
    fileName: "ls.tsx",
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react" },
  }).outputText;
  const tmp = `scripts/.check-levels-signals-${process.pid}.mjs`;
  fs.writeFileSync(tmp, js);
  try {
    return await import(`${process.cwd()}/${tmp}?t=${Date.now()}-${Math.random()}`);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

const near = (a, b, e = 1e-9) => typeof a === "number" && Math.abs(a - b) < e;
// The values Cowork saw on AAPL (#68), and two harder shapes.
const AAPL = { last: 333.69, ma50: 322.42, ma200: 290.1, zone: { lower: 255.4, upper: 268.9, touches: 3, volumeRatio: 1.1 } };
const ABOVE = { last: 100, ma50: 104, ma200: 120, zone: null }; // MA200 above the price
const CROWD = { last: 100, ma50: 100.3, ma200: 99.6, zone: { lower: 98.5, upper: 101.2, touches: 4, volumeRatio: null } }; // all within ~3%
const props = (x, extra = {}) => ({
  last: x.last, ma50: x.ma50, ma200: x.ma200, zone: x.zone, zoneMissing: "No repeated weekly support zone found",
  rsi: 54.7, macdTone: "red", asOf: "2026-10-02", ...extra,
});

async function measure(M) {
  const render = (p) => renderToStaticMarkup(React.createElement(M.LevelsSignals, p));
  const aaplHtml = render(props(AAPL));
  const aboveHtml = render(props(ABOVE, { macdTone: "green", rsi: 74.2 }));
  // #74 fixtures: a wave (crosses often) and an accelerating rise (no cross in the window).
  const wave = Array.from({ length: 220 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10), close: 100 + 10 * Math.sin(i / 8) }));
  const climb = wave.map((b, i) => ({ ...b, close: 100 + 0.01 * i * i }));
  const waveHtml = render(props(AAPL, { macdTone: "red", macdBars: wave }));
  return {
    M, wave, climb, waveHtml, waveText: visibleText(waveHtml), climbText: visibleText(render(props(AAPL, { macdTone: "green", macdBars: climb }))),
    aapl: M.ladderMarks(AAPL), above: M.ladderMarks(ABOVE), crowd: M.ladderMarks(CROWD),
    // Eight markers inside ~4% of the price (#73: the ladder must hold up to 8 without overlaps).
    eight: M.layoutLadder([
      { key: "last", name: "Last price", value: 100, anchor: true }, { key: "a", name: "MA50", value: 100.4 }, { key: "b", name: "MA200", value: 99.5 },
      { key: "c", name: "52-week high", value: 103.9 }, { key: "d", name: "52-week low", value: 96.2 }, { key: "e", name: "Week open", value: 100.1 },
      { key: "f", name: "Month open", value: 99.9 }, { key: "g", name: "Prev. day high", value: 100.6 },
    ], 100),
    aaplScale: M.ladderScale(AAPL),
    aaplHtml, aaplText: visibleText(aaplHtml), aboveHtml, aboveText: visibleText(aboveHtml),
    shortText: visibleText(render(props({ last: 50, ma50: null, ma200: null, zone: null }, { ma50Missing: "Not enough price history stored yet", ma200Missing: "Not enough price history stored yet", rsi: null, macdTone: null }))),
    credited: visibleText(render(props(AAPL, { credit: React.createElement("a", { href: "#" }, "Tiingo credit") }))),
  };
}
const mark = (marks, key) => marks.find((m) => m.key === key);

const rules = {
  "the scale: the highest value nearest the top, every mark at its own height, padded 8%": ({ aapl, aaplScale, M }) => {
    const H = M.LADDER_HEIGHT, s = aaplScale, span = 333.69 - 255.4;
    return near(s.max, 333.69 + span * 0.08, 1e-6) && near(s.min, 255.4 - span * 0.08, 1e-6) &&
      near(M.ladderY(s.max, s), 0) && near(M.ladderY(s.min, s), H) &&
      aapl.every((m) => near(m.y, M.ladderY(m.value, s))) &&
      mark(aapl, "last").y < mark(aapl, "ma50").y && mark(aapl, "ma50").y < mark(aapl, "ma200").y && mark(aapl, "ma200").y < mark(aapl, "zone").y;
  },
  "MA200 above the price reads above, drawn above": ({ above }) => {
    const l = mark(above, "last"), m2 = mark(above, "ma200"), m5 = mark(above, "ma50");
    return m2.side === "above" && m2.y < l.y && m5.y < l.y && m5.y > m2.y && /^\$120\.00 · 20\.0% above$/.test(m2.words) && !mark(above, "zone");
  },
  "labels: stacked to the minimum gap on each side, in order, inside the ladder": ({ crowd, above, eight, M }) => {
    const sideOk = (marks) => ["right", "left"].every((side) => {
      const on = marks.filter((m) => m.labelSide === side);
      const ys = on.map((m) => m.labelY);
      // In price order, 46 px apart (three-line labels; written out so the constant can't shrink), half a gap inside each end.
      return ys.every((y, k) => k === 0 || y - ys[k - 1] >= 46 - 1e-9) && ys.every((y) => y >= 23 - 1e-9 && y <= M.LADDER_HEIGHT - 23 + 1e-9);
    });
    return M.LABEL_GAP === 46 && sideOk(crowd) && sideOk(eight) && eight.length === 8 &&
      // MA200 at the very top of its ladder: its label is kept half a gap inside.
      mark(above, "ma200").y < 23 && mark(above, "ma200").labelY >= 23 &&
      JSON.stringify(M.stackLabels([100, 105, 110], 30, 220)) === "[100,130,160]" &&
      JSON.stringify(M.stackLabels([210, 215], 30, 220)) === "[190,220]" &&
      JSON.stringify(M.stackLabels([0, 2], 30, 220)) === "[0,30]" && JSON.stringify(M.stackLabels([0, 2], 30, 220, 15)) === "[15,45]";
  },
  "labels alternate sides down the pillar: right, left, right, …": ({ aapl, eight, crowd }) =>
    [aapl, eight, crowd].every((ms) => ms.every((m, i) => (i === 0 || ms[i - 1].y <= m.y) && m.labelSide === (i % 2 === 0 ? "right" : "left"))),
  "the pillar is centred; the anchor keeps its bolder marker and label": ({ aaplHtml }) =>
    /class="lsAxis" style="position:absolute;left:calc\(50% - 1px\)/.test(aaplHtml) &&
    /class="lsBand" style="position:absolute;left:calc\(50% - 11px\);width:22px/.test(aaplHtml) &&
    (aaplHtml.match(/class="lsTick" data-key="[^"]+" style="position:absolute;left:calc\(50% - (5|8)px\)/g) ?? []).length === 4 &&
    /data-key="last" style="position:absolute;left:calc\(50% - 8px\);[^"]*width:16px;height:6px/.test(aaplHtml) &&
    /data-key="last"[^>]*data-label-side="[a-z]+"[^>]*>[^]*?font-size:0.875rem;font-weight:900/.test(aaplHtml),
  "leaders stop short of the label's edge, so no line crosses text": ({ aaplHtml, M }) => {
    const w = M.LABEL_OFFSET - M.LEADER_GAP;
    return M.LEADER_GAP >= 4 && (aaplHtml.match(new RegExp(`<svg class="lsLeaders lsLeaders-(right|left)" width="${w}"`, "g")) ?? []).length === 2 &&
      new RegExp(`data-label-side="right" style="[^"]*left:calc\\(50% \\+ ${M.LABEL_OFFSET}px\\)`).test(aaplHtml) &&
      new RegExp(`data-label-side="left" style="[^"]*right:calc\\(50% \\+ ${M.LABEL_OFFSET}px\\)`).test(aaplHtml) &&
      [...aaplHtml.matchAll(/<line [^>]*x1="([\d.]+)"[^>]*x2="([\d.]+)"/g)].every((l) => Math.max(+l[1], +l[2]) <= w);
  },
  "the Signals column keeps its width": ({ aaplHtml }) =>
    /\.lsGrid \{ display: grid; grid-template-columns: minmax\(0, 3fr\) minmax\(0, 2fr\); gap: 28px; \}/.test(aaplHtml),
  "the zone: a band from its low to its high, touches and volume in its note": ({ aapl, aaplScale, aaplHtml, M }) => {
    const z = mark(aapl, "zone");
    return near(z.band.top, M.ladderY(268.9, aaplScale)) && near(z.band.bottom, M.ladderY(255.4, aaplScale)) &&
      /^\$255\.40–\$268\.90 · 19\.4% below$/.test(z.words) &&
      (aaplHtml.match(/class="lsBand"/g) ?? []).length === 1 &&
      /data-estimate-note="A price band where weekly lows have turned up more than once[^"]*3 touches · 1\.1× zone volume/.test(aaplHtml);
  },
  "no zone: omitted with its reason, never hidden": ({ aboveHtml, aboveText }) =>
    !/class="lsBand"/.test(aboveHtml) && aboveText.includes("Macro support: No repeated weekly support zone found"),
  "RSI: the marker at its value on the 0–100 bar, the page's zone words": ({ aaplHtml, aaplText, aboveHtml, aboveText, M }) =>
    /class="lsRsiMark" style="[^"]*left:54\.7%/.test(aaplHtml) && /left:30%[^>]*>30<\/span>/.test(aaplHtml) && /left:70%[^>]*>70<\/span>/.test(aaplHtml) && /class="lsRsiMark" style="[^"]*left:74\.2%/.test(aboveHtml) &&
    aaplText.includes("Neutral zone") && aboveText.includes("Overbought zone") && M.rsiZone(30) === "Oversold zone" &&
    M.rsiPct(140) === 100 && M.rsiPct(-3) === 0,
  "MACD: where it sits against its signal line, never Bullish or Bearish": ({ aaplText, aboveText, aaplHtml, M }) =>
    aaplText.includes("▼ Below signal") && aaplText.includes("Momentum below its signal line") &&
    aboveText.includes("▲ Above signal") && aboveText.includes("Momentum above its signal line") &&
    M.macdState("yellow") === "near" && !/bullish|bearish/i.test(`${aaplHtml} ${aboveText} ${JSON.stringify(M.MACD_WORDS)}`),
  "never colour alone: each label's colour matches its side, which matches its height": ({ aapl, above, aaplHtml, M }) =>
    [...aapl, ...above].every((m) => m.key === "last" || m.side === "anchor" || (m.side === "below") === (m.y > mark(aapl.includes(m) ? aapl : above, "last").y)) &&
    (aaplHtml.match(/data-side="below"/g) ?? []).length === 3 &&
    new RegExp(`data-key="ma50" data-side="below"[^>]*>[^]*?color:${M.SIDE_COLOUR.below}`).test(aaplHtml) &&
    aaplHtml.includes(M.LADDER_KEY),
  "short history: each missing piece says why": ({ shortText }) =>
    shortText.includes("MA50: Not enough price history stored yet") && shortText.includes("MA200: Not enough price history stored yet") &&
    shortText.includes("Macro support: No repeated weekly support zone found") && /Momentum unavailable/.test(shortText),
  "the notes describe, and nothing reads as advice": ({ aaplHtml, aaplText, M }) =>
    Object.values(M.NOTES).every((n) => aaplHtml.includes(n.slice(0, 40))) && /As of the close on Fri 2 Oct 2026\./.test(aaplText) &&
    !/\b(buy|sell|bullish|bearish|should|recommend|target|will (rise|fall|bounce))\b/i.test(`${aaplText} ${Object.values(M.NOTES).join(" ")}`),
  "the Tiingo credit only when it is passed": ({ aaplText, credited }) =>
    !/Daily prices:/.test(aaplText) && /Daily prices: Tiingo credit/.test(credited),
};

const ET = (date, hhmm) => Date.parse(`${date}T${hhmm}:00-04:00`);
const PB = (date) => ({ date, close: 1, partial: true, label: "today so far (IEX), 14:32 ET" });
const DONE = [{ date: "2026-09-30", close: 1 }, { date: "2026-10-01", close: 1 }];
Object.assign(rules, {
  "today's partial bar counts only in session and only on its own day (#75/#76)": ({ M }) => {
    const inS = M.liveBars([...DONE, PB("2026-10-02")], ET("2026-10-02", "14:32"));
    const out = [
      M.liveBars([...DONE, PB("2026-10-02")], ET("2026-10-03", "12:00")), // Saturday, stale Friday partial
      M.liveBars([...DONE, PB("2026-10-02")], ET("2026-10-05", "10:00")), // in-session Monday, stale Friday partial
      M.liveBars(DONE, ET("2026-09-07", "11:00")), // Labor Day: no new bar
      M.liveBars([...DONE, PB("2026-10-02")], ET("2026-10-02", "08:30")), // pre-market: a same-day bar before the open
    ];
    // After the close the day's final IEX bar is kept until the nightly job stores the day (#77).
    const after = M.liveBars([...DONE, PB("2026-10-02")], ET("2026-10-02", "17:30"));
    return inS.bars.length === 3 && inS.live?.date === "2026-10-02" && inS.time === "14:32" && inS.phase === "session" &&
      after.live?.date === "2026-10-02" && after.phase === "afterClose" &&
      out.every((o) => o.live === null && o.bars.length === 2 && o.bars.every((b) => !b.partial));
  },
  "the MACD note says when today's session is included": ({ M }) => {
    const r = (t) => renderToStaticMarkup(React.createElement(M.LevelsSignals, props(AAPL, { macdToday: t })));
    return /Includes today&#x27;s session so far \(14:32 ET\)\./.test(r({ time: "14:32", phase: "session" })) &&
      /Includes today&#x27;s session \(close, 16:00 ET, IEX\)\./.test(r({ time: "16:00", phase: "afterClose" })) &&
      !/Includes today/.test(r(null)) && /As of the close on Fri 2 Oct 2026\./.test(r(null));
  },
  "the MACD legend draws its lines: solid MACD, dotted signal (#77)": ({ waveHtml }) =>
    /<svg class="lsSwatchMacd"[^>]*><line [^>]*stroke-width="1\.5"[^>]*>(<\/line>)?<\/svg>MACD/.test(waveHtml) &&
    /<svg class="lsSwatchSignal"[^>]*><line [^>]*stroke-dasharray="3 3"[^>]*>(<\/line>)?<\/svg>Signal/.test(waveHtml) && !/— MACD ┄ Signal/.test(waveHtml),
  "MACD series: its last point is the page's own reading": ({ M, wave, climb }) => [wave, climb].every((b) => {
    const page = M.page_buildMacd(b.map((x) => x.close)), s = M.macdSeries(b), last = s.points.at(-1);
    return page && Math.abs(last.macd - page.macd) < 1e-9 && Math.abs(last.signal - page.signal) < 1e-9 && Math.abs(last.hist - page.histogram) < 1e-9 && s.points.length === 30;
  }),
  "MACD histogram: above zero in the pill's blue, below in its amber": ({ M, wave, waveHtml }) => {
    const s = M.macdSeries(wave), bars = [...waveHtml.matchAll(/class="lsMacdBar" data-sign="(above|below)"[^>]*fill="([^"]+)"/g)];
    return bars.length === 30 && bars.every((b, i) => (s.points[i].hist >= 0 ? "above" : "below") === b[1] && b[2] === M.MACD_COLOUR[b[1]]) &&
      bars.some((b) => b[1] === "above") && bars.some((b) => b[1] === "below") && /class="lsMacdLineSignal"[^>]*stroke-dasharray="3 3"/.test(waveHtml);
  },
  "MACD crossover: the last change of side in the window, dated; none in a steady climb": ({ M, wave, climb, waveText, climbText }) => {
    const s = M.macdSeries(wave), c = M.macdSeries(climb), i = s.crossIndex, sign = (h) => Math.sign(h);
    return i !== null && sign(s.points[i].hist) !== sign(s.points[i - 1].hist) && s.points.slice(i).every((p) => sign(p.hist) === sign(s.points.at(-1).hist)) &&
      waveText.includes(`crossed ${M.shortDate(s.points[i].date)}`) &&
      c.crossIndex === null && c.runFillsWindow && !/crossed/.test(climbText) && /Momentum above its signal line for 30\+ sessions/.test(climbText);
  },
  "MACD run length: the sessions since the cross, said in words": ({ M, wave, waveText }) => {
    const s = M.macdSeries(wave);
    return s.run === s.points.length - s.crossIndex && waveText.includes(`Momentum below its signal line ${M.runWords(s)}`) &&
      /^for \d+ sessions?$/.test(M.runWords(s)) && M.runWords({ ...s, run: 1, runFillsWindow: false }) === "for 1 session" &&
      !/bullish|bearish/i.test(waveText);
  },
});

const staticRules0 = {
  "MACD in the Signals column: one set of bars for the pill and the chart, today's partial only in session": (_l, _c, p) =>
    /const l = liveBars\(history as \(Point & \{ partial\?: boolean; label\?: string \}\)\[\], renderedAt \?\? NaN\);/.test(p) &&
    /return \{ tone: buildMacd\(l\.bars\.map\(\(p\) => p\.close\)\)\?\.tone \?\? null, bars: l\.bars, today: l\.live && l\.phase \? \{ time: l\.time, phase: l\.phase \} : null \};/.test(p) &&
    /renderedAt=\{Date\.now\(\)\}/.test(fs.readFileSync("app/stock/[symbol]/page.tsx", "utf8")),
};
const staticRules = {
  ...staticRules0,
  // #563 COWORK #103: A's ReasonedValue note is position: fixed, and a transform on an
  // ancestor becomes its containing block (the note collapsed into the label, off the card).
  "no transform on a ladder label or its body (its tap note is position: fixed)": (_l, c) => {
    const label = c.match(/className="lsLabel"[\s\S]*?<ReasonedValue/)?.[0] ?? "";
    return !!label && !/transform:/.test(label) && /position: "absolute", top: m\.labelY, height: 0, display: "flex", alignItems: "center"/.test(label) && !/\.lsLabel[^{]*\{[^}]*transform/.test(c);
  },
  "no fetch, no Redis, no reads in either file": (l, c) => ![l, c].some((s) => /fetch\(|redis|Redis|unstable_cache|readTiingo|getDailyHistory/.test(s)),
  "the module imports only keyLevels; the card only React's types, A's ReasonedValue and the modules": (l, c) => {
    const li = [...l.matchAll(/^import[\s\S]*?from\s*"([^"]+)";$/gm)].map((m) => m[1]);
    const ci = [...c.matchAll(/^import[\s\S]*?from\s*"([^"]+)";$/gm)].map((m) => m[1]);
    return li.length === 1 && li[0] === "./keyLevels" &&
      ci.every((i) => ["react", "@/app/components/EstimatedValue", "@/lib/ta/keyLevels", "@/lib/ta/priceLadder", "@/lib/ta/macdSeries"].includes(i));
  },
  "the page hands over what it already computes, and the old rows are gone": (_l, _c, p) => {
    const from = p.indexOf("Price levels &amp; signals</h2>");
    const sec = from < 0 ? "" : p.slice(from, p.indexOf("</section>", from));
    return /<LevelsSignals\s/.test(sec) && !/className="indicator-rows|MACD Signal|Support Quality|macdSignal\?\.label/.test(p) && !/Key levels &amp; signals/.test(p) &&
      /last=\{lastClose\}/.test(sec) && /ma50=\{typeof lastMA50 === "number" \? lastMA50 : null\}/.test(sec) &&
      /ma200=\{typeof lastMA200 === "number" \? lastMA200 : null\}/.test(sec) && /zone=\{macroSupport\}/.test(sec) &&
      /rsi=\{typeof lastRsi === "number" \? lastRsi : null\}/.test(sec) && /macdTone=\{macdLive\.tone\}/.test(sec) && /macdBars=\{macdLive\.bars\}/.test(sec) && /macdToday=\{macdLive\.today\}/.test(sec) &&
      /ma50Missing=\{closes\.length && closes\.length < 50 \? SHORT_HISTORY_NOTE : null\}/.test(sec) &&
      /ma200Missing=\{closes\.length && closes\.length < 200 \? SHORT_HISTORY_NOTE : null\}/.test(sec) &&
      /credit=\{shownProvider === "tiingo" \? historyCredit : undefined\}/.test(sec) &&
      /const macroSupport = useMemo\(\(\) => computeMacroSupport\(history, lastClose\), \[history, lastClose\]\);/.test(p) &&
      /const macdSignal = useMemo\(\(\) => buildMacd\(closes\), \[closes\]\);/.test(p);
  },
};

console.log("\n=== 1. Fixtures through lib/ta/priceLadder.ts and the card ===\n");
const base = await measure(await load());
for (const [name, rule] of Object.entries(rules)) check(name, rule(base));

console.log("\n=== 2. Static rules ===\n");
const L = fs.readFileSync(LIB, "utf8"), Cd = fs.readFileSync(CARD, "utf8"), P = fs.readFileSync(PAGE, "utf8");
const code = (s, f) => stripComments(s, { file: f });
for (const [name, rule] of Object.entries(staticRules)) check(name, rule(code(L, LIB), code(Cd, CARD), code(P, PAGE)));

console.log("\n=== 3. Mutants: each must FAIL its rule ===\n");
const mutants = [
  ["the scale: the highest value nearest the top, every mark at its own height, padded 8%", "l", (s) => s.replace("return ((s.max - v) / (s.max - s.min)) * height;", "return ((v - s.min) / (s.max - s.min)) * height;")],
  ["the scale: the highest value nearest the top, every mark at its own height, padded 8%", "l", (s) => s.replace("export const LADDER_PAD = 0.08;", "export const LADDER_PAD = 0;")],
  ["the scale: the highest value nearest the top, every mark at its own height, padded 8%", "l", (s) => s.replace("const vals = [input.last, input.ma50, input.ma200, input.zone?.lower, input.zone?.upper]", "const vals = [input.last, input.ma50, input.ma200]")],
  ["MA200 above the price reads above, drawn above", "l", (s) => s.replace('const sideOf = (v: number, last: number): LadderSide => (v < last ? "below" : "above");', 'const sideOf = (_v: number, _last: number): LadderSide => "below";')],
  ["MA200 above the price reads above, drawn above", "l", (s) => s.replace("return d === \"at the last price\" ? \"at the price\" : d;", "return d.replace(\"above\", \"below\");")],
  ["labels: stacked to the minimum gap on each side, in order, inside the ladder", "l", (s) => s.replace("for (let k = 1; k < out.length; k++) out[k] = Math.max(out[k], out[k - 1] + gap);\n  if (out.length) out", "if (out.length) out")],
  ["labels: stacked to the minimum gap on each side, in order, inside the ladder", "l", (s) => s.replace("for (let k = out.length - 2; k >= 0; k--) out[k] = Math.min(out[k], out[k + 1] - gap);", "")],
  ["labels: stacked to the minimum gap on each side, in order, inside the ladder", "l", (s) => s.replace("export const LABEL_GAP = 46;", "export const LABEL_GAP = 20;")],
  ["labels: stacked to the minimum gap on each side, in order, inside the ladder", "l", (s) => s.replace("const ys = stackLabels(idx.map((i) => placed[i].y), LABEL_GAP, height, LABEL_GAP / 2);", "const ys = stackLabels(idx.map((i) => placed[i].y), LABEL_GAP, height);")],
  ["labels: stacked to the minimum gap on each side, in order, inside the ladder", "l", (s) => s.replace("const ys = stackLabels(idx.map((i) => placed[i].y), LABEL_GAP, height, LABEL_GAP / 2);", "const ys = idx.map((i) => placed[i].y);")],
  ["labels alternate sides down the pillar: right, left, right, …", "l", (s) => s.replace('const sides: LabelSide[] = placed.map((_, i) => (i % 2 === 0 ? "right" : "left"));', 'const sides: LabelSide[] = placed.map(() => "right");')],
  ["the pillar is centred; the anchor keeps its bolder marker and label", "c", (s) => s.replace('left: "calc(50% - 1px)", top: 0, bottom: 0, width: 2', "left: 10, top: 0, bottom: 0, width: 2")],
  ["the pillar is centred; the anchor keeps its bolder marker and label", "c", (s) => s.replace('fontSize: m.key === "last" ? "0.875rem" : "0.8125rem", fontWeight: m.key === "last" ? 900 : 800', 'fontSize: "0.8125rem", fontWeight: 800')],
  ["leaders stop short of the label's edge, so no line crosses text", "l", (s) => s.replace("export const LEADER_GAP = 4;", "export const LEADER_GAP = -10;")],
  ["leaders stop short of the label's edge, so no line crosses text", "c", (s) => s.replace("width={LABEL_OFFSET - LEADER_GAP}", "width={LABEL_OFFSET + 20}")],
  ["the Signals column keeps its width", "c", (s) => s.replace(".lsGrid { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 28px; }", ".lsGrid { display: grid; grid-template-columns: minmax(0, 4fr) minmax(0, 1fr); gap: 28px; }")],
  ["the zone: a band from its low to its high, touches and volume in its note", "l", (s) => s.replace("band: it.band ? { top: ladderY(it.band.high, s, height),", "band: it.band ? { top: ladderY(it.value, s, height),")],
  ["the zone: a band from its low to its high, touches and volume in its note", "c", (s) => s.replace("return `${NOTES.zone} ${p.zone.touches} touches${vol}. ${when}`;", "return `${NOTES.zone} ${when}`;")],
  ["the zone: a band from its low to its high, touches and volume in its note", "c", (s) => s.replace('{marks.filter((m) => m.band).map((m) => (', "{marks.filter(() => false).map((m) => (")],
  ["no zone: omitted with its reason, never hidden", "c", (s) => s.replace("p.zone == null ? `Macro support: ${p.zoneMissing}` : null,", "null,")],
  ["RSI: the marker at its value on the 0–100 bar, the page's zone words", "c", (s) => s.replace("left: `${rsiPct(p.rsi)}%`", "left: `${rsiPct(p.rsi) / 2}%`")],
  ["RSI: the marker at its value on the 0–100 bar, the page's zone words", "l", (s) => s.replace('return rsi >= 70 ? "Overbought zone"', 'return rsi >= 75 ? "Overbought zone"')],
  ["RSI: the marker at its value on the 0–100 bar, the page's zone words", "l", (s) => s.replace("return Math.max(0, Math.min(100, rsi));", "return rsi;")],
  ["MACD: where it sits against its signal line, never Bullish or Bearish", "l", (s) => s.replace('below: { pill: "Below signal",', 'below: { pill: "Bearish",')],
  ["MACD: where it sits against its signal line, never Bullish or Bearish", "l", (s) => s.replace('return tone === "green" ? "above" : tone === "red" ? "below" : "near";', 'return tone === "green" ? "below" : tone === "red" ? "above" : "near";')],
  ["MACD: where it sits against its signal line, never Bullish or Bearish", "c", (s) => s.replace('{macd === "above" ? "▲ " : macd === "below" ? "▼ " : "– "}', "")],
  ["never colour alone: each label's colour matches its side, which matches its height", "c", (s) => s.replace('fontWeight: m.key === "last" ? 900 : 800, color: SIDE_COLOUR[m.side] }}', 'fontWeight: m.key === "last" ? 900 : 800, color: SIDE_COLOUR.above }}')],
  ["never colour alone: each label's colour matches its side, which matches its height", "c", (s) => s.replace("{marks.length > 1 ? <p className=\"lsKey\" style={readStyle}>{LADDER_KEY}</p> : null}", "")],
  ["short history: each missing piece says why", "c", (s) => s.replace("p.ma200 == null ? `MA200: ${p.ma200Missing ?? \"not available\"}` : null,", "null,")],
  ["the notes describe, and nothing reads as advice", "c", (s) => s.replace('rsi: "RSI (14) compares', 'rsi: "A buy signal when RSI (14) compares')],
  ["the notes describe, and nothing reads as advice", "c", (s) => s.replace("return partial ? `As of today's trading so far (${dateWords(asOf)}).` : `As of the close on ${dateWords(asOf)}.`;", "return \"\";")],
  ["the Tiingo credit only when it is passed", "c", (s) => s.replace("{p.credit ? <p className=\"lsCredit\" data-fine-print style={{ ...noteStyle, gridColumn: \"1 / -1\" }}>Daily prices: {p.credit}</p> : null}", "<p className=\"lsCredit\">Daily prices: {p.credit ?? \"Tiingo\"}</p>")],
];
const MS = fs.readFileSync(MACD, "utf8"), SSs = fs.readFileSync(SESS, "utf8");
mutants.push(
  ["today's partial bar counts only in session and only on its own day (#75/#76)", "s", (s) => s.replace(" && last.date === easternNow(nowMs).date;", ";")],
  ["today's partial bar counts only in session and only on its own day (#75/#76)", "s", (s) => s.replace("Number.isFinite(nowMs) && sinceOpen(nowMs) && last.date", "Number.isFinite(nowMs) && last.date")],
  ["the MACD note says when today's session is included", "c", (s) => s.replace("return t.phase === \"afterClose\"", "return false")],
  ["the MACD note says when today's session is included", "c", (s) => s.replace("reason={`${NOTES.macd} ${macdTodayWords(p.macdToday) ?? when}`}", "reason={`${NOTES.macd} ${when}`}")],
  ["the MACD legend draws its lines: solid MACD, dotted signal (#77)", "c", (s) => s.replace('strokeWidth="1.25" strokeDasharray="3 3" /></svg>Signal', 'strokeWidth="1.25" /></svg>Signal')],
  ["MACD series: its last point is the page's own reading", "m", (s) => s.replace("let cur = avg(values.slice(0, period));", "let cur = values[0];")],
  ["MACD series: its last point is the page's own reading", "m", (s) => s.replace("const sig = emaSeries(macdVals, 9);", "const sig = emaSeries(macdVals, 10);")],
  ["MACD histogram: above zero in the pill's blue, below in its amber", "c", (s) => s.replace("fill={p.hist >= 0 ? MACD_COLOUR.above : MACD_COLOUR.below}", "fill={MACD_COLOUR.above}")],
  ["MACD histogram: above zero in the pill's blue, below in its amber", "c", (s) => s.replace('strokeDasharray="3 3" ', "")],
  ["MACD crossover: the last change of side in the window, dated; none in a steady climb", "m", (s) => s.replace("for (let i = points.length - 1; i >= 1; i--) {", "for (let i = 1; i < points.length; i++) {")],
  ["MACD crossover: the last change of side in the window, dated; none in a steady climb", "c", (s) => s.replace("<span className=\"lsMacdCrossed\">crossed {shortDate(ms.points[ms.crossIndex].date)}</span>", "<span>crossed</span>")],
  ["MACD run length: the sessions since the cross, said in words", "m", (s) => s.replace("for (let i = all.length - 1; i >= 0 && sideOf(all[i].hist) === now && now !== 0; i--) run++;", "for (let i = all.length - 1; i >= 0 && sideOf(all[i].hist) === now && now !== 0; i--) run += 2;")],
  ["MACD run length: the sessions since the cross, said in words", "c", (s) => s.replace("`${MACD_WORDS[macd].line} ${runWords(ms)}`", "MACD_WORDS[macd].line")],
);
for (const [name, which, mutate] of mutants) {
  const l2 = which === "l" ? mutate(L) : L;
  const c2 = which === "c" ? mutate(Cd) : Cd;
  const m2 = which === "m" ? mutate(MS) : MS;
  const s2 = which === "s" ? mutate(SSs) : SSs;
  const changed = l2 !== L || c2 !== Cd || m2 !== MS || s2 !== SSs;
  let bites = false;
  try { bites = !rules[name](await measure(await load(l2, c2, m2, s2))); } catch { bites = true; }
  check(`mutant bites: ${name}`, changed && bites, changed ? "" : "the mutation did not apply");
}
const staticMutants = [
  ["no transform on a ladder label or its body (its tap note is position: fixed)", (l, c, p) => [l, c.replace('position: "absolute", top: m.labelY, height: 0,', 'position: "absolute", top: m.labelY, height: 0, transform: "translateY(-50%)",'), p]],
  ["no transform on a ladder label or its body (its tap note is position: fixed)", (l, c, p) => [l, c.replace('<div className="lsLabelBody" style={{ display: "flex",', '<div className="lsLabelBody" style={{ transform: "translateZ(0)", display: "flex",'), p]],
  ["no fetch, no Redis, no reads in either file", (l, c, p) => [l, `${c}\nconst x = fetch("/api/quote");`, p]],
  ["the module imports only keyLevels; the card only React's types, A's ReasonedValue and the modules", (l, c, p) => [`import { getDailyHistory } from "@/lib/server/historyCache";\n${l}`, c, p]],
  ["the page hands over what it already computes, and the old rows are gone", (l, c, p) => [l, c, p.replace("zone={macroSupport}", "zone={computeMacroSupport(history.slice(-100), lastClose)}")]],
  ["the page hands over what it already computes, and the old rows are gone", (l, c, p) => [l, c, p.replace('macdTone={macdLive.tone}', 'macdTone="green"')]],
  ["MACD in the Signals column: one set of bars for the pill and the chart, today's partial only in session", (l, c, p) => [l, c, p.replace("liveBars(history as (Point & { partial?: boolean; label?: string })[], renderedAt ?? NaN)", "{ bars: history, live: null, time: null }")]],
  ["MACD in the Signals column: one set of bars for the pill and the chart, today's partial only in session", (l, c, p) => [l, c, p.replace("tone: buildMacd(l.bars.map((p) => p.close))?.tone ?? null", "tone: buildMacd(closes)?.tone ?? null")]],
  ["the page hands over what it already computes, and the old rows are gone", (l, c, p) => [l, c, p.replace('credit={shownProvider === "tiingo" ? historyCredit : undefined}\n', "credit={historyCredit}\n")]],
];
for (const [name, mutate] of staticMutants) {
  const args = [code(L, LIB), code(Cd, CARD), code(P, PAGE)];
  const out = mutate(...args);
  const changed = out.some((s, i) => s !== args[i]);
  check(`mutant bites: ${name}`, changed && !staticRules[name](...out), changed ? "" : "the mutation did not apply");
}

console.log(`\n${failures ? `${failures} FAILED` : "all passed"}\n`);
process.exit(failures ? 1 : 0);
