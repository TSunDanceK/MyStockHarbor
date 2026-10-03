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

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const KL = "lib/ta/keyLevels.ts";
const LIB = "lib/ta/priceLadder.ts";
const CARD = "app/stock/[symbol]/LevelsSignals.tsx";
const PAGE = "app/stock/[symbol]/StockSymbolPageClient.tsx";
const strip = (src) => src.replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "").replace(/^"use client";$/m, "");

async function load(lib = fs.readFileSync(LIB, "utf8"), card = fs.readFileSync(CARD, "utf8")) {
  const unit = `${reasonedValueUnit()}\n${strip(fs.readFileSync(KL, "utf8"))}\n${strip(lib)}\n${strip(card).replace("export default function LevelsSignals", "export function LevelsSignals")}\n`;
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
  return {
    M,
    aapl: M.ladderMarks(AAPL), above: M.ladderMarks(ABOVE), crowd: M.ladderMarks(CROWD),
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
  "labels: stacked to the minimum gap, in order, inside the ladder": ({ crowd, above, M }) => {
    const ys = crowd.map((m) => m.labelY).sort((a, b) => a - b);
    const gaps = ys.slice(1).map((y, i) => y - ys[i]);
    const ordered = crowd.every((m, i) => i === 0 || crowd[i - 1].y <= m.y) && crowd.every((m, i) => i === 0 || crowd[i - 1].labelY < m.labelY);
    // 34 px (two-line labels), written out here so the constant can't shrink silently.
    return M.LABEL_GAP === 34 && gaps.every((g) => g >= 34 - 1e-9) && ys[0] >= 17 && ys.at(-1) <= M.LADDER_HEIGHT - 17 && ordered &&
      // MA200 at the very top of its ladder: its label is kept half a gap inside.
      mark(above, "ma200").y < 17 && mark(above, "ma200").labelY >= 17 &&
      JSON.stringify(M.stackLabels([100, 105, 110], 30, 220)) === "[100,130,160]" &&
      JSON.stringify(M.stackLabels([210, 215], 30, 220)) === "[190,220]" &&
      JSON.stringify(M.stackLabels([0, 2], 30, 220)) === "[0,30]" && JSON.stringify(M.stackLabels([0, 2], 30, 220, 15)) === "[15,45]";
  },
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

const staticRules = {
  "no fetch, no Redis, no reads in either file": (l, c) => ![l, c].some((s) => /fetch\(|redis|Redis|unstable_cache|readTiingo|getDailyHistory/.test(s)),
  "the module imports only keyLevels; the card only React's types, A's ReasonedValue and the modules": (l, c) => {
    const li = [...l.matchAll(/^import[\s\S]*?from\s*"([^"]+)";$/gm)].map((m) => m[1]);
    const ci = [...c.matchAll(/^import[\s\S]*?from\s*"([^"]+)";$/gm)].map((m) => m[1]);
    return li.length === 1 && li[0] === "./keyLevels" &&
      ci.every((i) => ["react", "@/app/components/EstimatedValue", "@/lib/ta/keyLevels", "@/lib/ta/priceLadder"].includes(i));
  },
  "the page hands over what it already computes, and the old rows are gone": (_l, _c, p) => {
    const from = p.indexOf("Price levels &amp; signals</h2>");
    const sec = from < 0 ? "" : p.slice(from, p.indexOf("</section>", from));
    return /<LevelsSignals\s/.test(sec) && !/className="indicator-rows|MACD Signal|Support Quality|macdSignal\?\.label/.test(p) && !/Key levels &amp; signals/.test(p) &&
      /last=\{lastClose\}/.test(sec) && /ma50=\{typeof lastMA50 === "number" \? lastMA50 : null\}/.test(sec) &&
      /ma200=\{typeof lastMA200 === "number" \? lastMA200 : null\}/.test(sec) && /zone=\{macroSupport\}/.test(sec) &&
      /rsi=\{typeof lastRsi === "number" \? lastRsi : null\}/.test(sec) && /macdTone=\{macdSignal\?\.tone \?\? null\}/.test(sec) &&
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
  ["labels: stacked to the minimum gap, in order, inside the ladder", "l", (s) => s.replace("for (let k = 1; k < out.length; k++) out[k] = Math.max(out[k], out[k - 1] + gap);\n  if (out.length) out", "if (out.length) out")],
  ["labels: stacked to the minimum gap, in order, inside the ladder", "l", (s) => s.replace("for (let k = out.length - 2; k >= 0; k--) out[k] = Math.min(out[k], out[k + 1] - gap);", "")],
  ["labels: stacked to the minimum gap, in order, inside the ladder", "l", (s) => s.replace("export const LABEL_GAP = 34;", "export const LABEL_GAP = 10;")],
  ["labels: stacked to the minimum gap, in order, inside the ladder", "l", (s) => s.replace("const labelYs = stackLabels(marks.map((m) => m.y), LABEL_GAP, height, LABEL_GAP / 2);", "const labelYs = stackLabels(marks.map((m) => m.y), LABEL_GAP, height);")],
  ["the zone: a band from its low to its high, touches and volume in its note", "l", (s) => s.replace("band: { top: ladderY(z.upper, s, height), bottom: ladderY(z.lower, s, height) },", "band: { top: ladderY(mid, s, height), bottom: ladderY(z.lower, s, height) },")],
  ["the zone: a band from its low to its high, touches and volume in its note", "c", (s) => s.replace("return `${NOTES.zone} ${p.zone.touches} touches${vol}. ${when}`;", "return `${NOTES.zone} ${when}`;")],
  ["the zone: a band from its low to its high, touches and volume in its note", "c", (s) => s.replace('{marks.filter((m) => m.band).map((m) => (', "{marks.filter(() => false).map((m) => (")],
  ["no zone: omitted with its reason, never hidden", "c", (s) => s.replace("p.zone == null ? `Macro support: ${p.zoneMissing}` : null,", "null,")],
  ["RSI: the marker at its value on the 0–100 bar, the page's zone words", "c", (s) => s.replace("left: `${rsiPct(p.rsi)}%`", "left: `${rsiPct(p.rsi) / 2}%`")],
  ["RSI: the marker at its value on the 0–100 bar, the page's zone words", "l", (s) => s.replace('return rsi >= 70 ? "Overbought zone"', 'return rsi >= 75 ? "Overbought zone"')],
  ["RSI: the marker at its value on the 0–100 bar, the page's zone words", "l", (s) => s.replace("return Math.max(0, Math.min(100, rsi));", "return rsi;")],
  ["MACD: where it sits against its signal line, never Bullish or Bearish", "l", (s) => s.replace('below: { pill: "Below signal",', 'below: { pill: "Bearish",')],
  ["MACD: where it sits against its signal line, never Bullish or Bearish", "l", (s) => s.replace('return tone === "green" ? "above" : tone === "red" ? "below" : "near";', 'return tone === "green" ? "below" : tone === "red" ? "above" : "near";')],
  ["MACD: where it sits against its signal line, never Bullish or Bearish", "c", (s) => s.replace('{macd === "above" ? "▲ " : macd === "below" ? "▼ " : "≈ "}', "")],
  ["never colour alone: each label's colour matches its side, which matches its height", "c", (s) => s.replace("<span style={{ fontSize: 13, fontWeight: 800, color: SIDE_COLOUR[m.side] }}>", "<span style={{ fontSize: 13, fontWeight: 800, color: SIDE_COLOUR.above }}>")],
  ["never colour alone: each label's colour matches its side, which matches its height", "c", (s) => s.replace("{marks.length > 1 ? <p className=\"lsKey\" style={noteStyle}>{LADDER_KEY}</p> : null}", "")],
  ["short history: each missing piece says why", "c", (s) => s.replace("p.ma200 == null ? `MA200: ${p.ma200Missing ?? \"not available\"}` : null,", "null,")],
  ["the notes describe, and nothing reads as advice", "c", (s) => s.replace('rsi: "RSI (14) compares', 'rsi: "A buy signal when RSI (14) compares')],
  ["the notes describe, and nothing reads as advice", "c", (s) => s.replace("return partial ? `As of today's trading so far (${dateWords(asOf)}).` : `As of the close on ${dateWords(asOf)}.`;", "return \"\";")],
  ["the Tiingo credit only when it is passed", "c", (s) => s.replace("{p.credit ? <p className=\"lsCredit\" style={{ ...noteStyle, gridColumn: \"1 / -1\" }}>Daily prices: {p.credit}</p> : null}", "<p className=\"lsCredit\">Daily prices: {p.credit ?? \"Tiingo\"}</p>")],
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
  ["no fetch, no Redis, no reads in either file", (l, c, p) => [l, `${c}\nconst x = fetch("/api/quote");`, p]],
  ["the module imports only keyLevels; the card only React's types, A's ReasonedValue and the modules", (l, c, p) => [`import { getDailyHistory } from "@/lib/server/historyCache";\n${l}`, c, p]],
  ["the page hands over what it already computes, and the old rows are gone", (l, c, p) => [l, c, p.replace("zone={macroSupport}", "zone={computeMacroSupport(history.slice(-100), lastClose)}")]],
  ["the page hands over what it already computes, and the old rows are gone", (l, c, p) => [l, c, p.replace('macdTone={macdSignal?.tone ?? null}', 'macdTone="green"')]],
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
