// The dashboard's single-indicator read and mini manuals (Relay B, #553 COWORK #38).
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. A READ THAT DISAGREES WITH THE CHART: it must come from the plotted
//      series (the dashboard's own TA functions, lifted from DashboardClient
//      below, not re-implemented here), as of the last bar on screen.
//   2. COPY THAT BREAKS THE OWNER'S RULES: an instruction (buy / sell /
//      consider / should), an unhedged call, or NaN / n/a / undefined leaking
//      on a short history (new listings like SPCX).
//   3. THE WRONG UNITS: a weekly chart read in "days".
//   4. AN INDICATOR WITH NO READ OR NO MANUAL, now or when one is added.
//   5. THE WIRING: one indicator must show the read and the manual; two or
//      more keep the per-indicator lines, led by the names.
//
//   node scripts/check-indicator-read.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const MODULE = "lib/indicatorRead.ts";
const DASH = "app/components/DashboardClient.tsx";

let seq = 0;
async function loadSibling(relFile, source) {
  const file = path.join(path.dirname(path.join(ROOT, relFile)), `.check-indread-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, source);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}

// The dashboard's own indicator math, lifted verbatim so the check computes
// exactly what the chart plots.
const dashRaw = fs.readFileSync(path.join(ROOT, DASH), "utf8");
const taStart = dashRaw.indexOf("function movingAverage(");
const taEnd = dashRaw.indexOf("function lastNum(");
if (taStart < 0 || taEnd < taStart) throw new Error("could not find the dashboard's TA functions");
const TA = await loadSibling("lib/indicatorRead.ts", `type Point = { date: string; open?: number; close: number; high?: number; low?: number; volume?: number };\n${dashRaw.slice(taStart, taEnd)}\nexport { movingAverage, bollinger, ema, rsiWilder, macd, vwma, stochastic, atr, smaNullable };`);

// Deterministic synthetic bars: a slow wave on a drift, so trends, crosses and
// band changes all occur. No market data is stored here.
function bars(n, { drift = 0.05, amp = 12, period = 90, seed = 1 } = {}) {
  let x = seed;
  const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647) - 0.5;
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = 100 + drift * i + amp * Math.sin((2 * Math.PI * i) / period) + rnd() * 2;
    out.push({ date: `d${i}`, close: c, high: c + 1 + Math.abs(rnd()), low: c - 1 - Math.abs(rnd()), volume: 1e6 * (1 + 0.5 * Math.sin(i / 7) + rnd() * 0.3) });
  }
  return out;
}
function inputFor(points, unit = "day", atIdx = points.length - 1, zone = null) {
  const closes = points.map((p) => p.close);
  const vol = points.map((p) => p.volume);
  const atrFull = TA.atr(points, 14);
  return {
    closes, at: atIdx, unit,
    ma50: TA.movingAverage(closes, 50), ma200: TA.movingAverage(closes, 200), ema20: TA.ema(closes, 20), vwma20: TA.vwma(closes, vol, 20),
    bb: TA.bollinger(closes, 20, 2), rsi: TA.rsiWilder(closes, 14), macd: TA.macd(closes, 12, 26, 9),
    stochK: TA.stochastic(points, 14, 3).k, stochD: TA.stochastic(points, 14, 3).d, atr: atrFull, atrAvg: TA.smaNullable(atrFull, 20),
    volume: vol, volumeAvg: TA.smaNullable(vol, 20), zone,
  };
}

const BANNED = /\b(buy|sell|consider|should|must|recommend|guarantee|will (rise|fall|go))\b/i;
const LEAK = /NaN|n\/a|undefined|Infinity|null/;

async function suite(R, dash) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };

  // 4. Every offered indicator has a read and a manual; the dashboard offers exactly these.
  const offered = [...R.OFFERED_INDICATORS];
  const lists = /const PRICE_OVERLAY_OPTIONS: Overlay\[\] = \[([^\]]*)\];\s*const LOWER_OVERLAY_OPTIONS: Overlay\[\] = \[([^\]]*)\];/.exec(dash);
  const dashOffered = lists ? [...`${lists[1]},${lists[2]}`.matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
  ok("the read module covers exactly the indicators the dashboard offers", JSON.stringify([...dashOffered].sort()) === JSON.stringify([...offered].sort()), `${dashOffered.join("|")}`);
  for (const ind of offered) {
    const m = R.INDICATOR_MANUAL[ind];
    ok(`${ind}: has a mini manual`, typeof m === "string" && m.length > 60);
    const sentences = (m ?? "").split(/(?<=[.!?])\s+(?=[A-Z"])/).length;
    ok(`${ind}: the manual is two or three sentences`, sentences >= 2 && sentences <= 3, String(sentences));
    ok(`${ind}: the manual never tells the reader what to do`, !BANNED.test(m ?? ""), (m ?? "").match(BANNED)?.[0]);
  }

  // 1-3. Reads on a long history, a short one (a new listing), and in weeks.
  const long = bars(400), short = bars(40, { seed: 7 }), wk = bars(260, { seed: 3, period: 40 });
  const zone = { kind: "support", lower: 95, upper: 98 };
  for (const [label, pts, unit] of [["long daily", long, "day"], ["new listing (40 bars)", short, "day"], ["weekly", wk, "week"]]) {
    for (const ind of offered) {
      const t = R.indicatorRead(ind, inputFor(pts, unit, pts.length - 1, zone));
      ok(`${label} / ${ind}: a real read`, typeof t === "string" && t.length > 20 && t !== "Custom indicator view is active.", t);
      ok(`${label} / ${ind}: no NaN / n/a / undefined`, !LEAK.test(t), t);
      ok(`${label} / ${ind}: no instruction`, !BANNED.test(t), t);
      if (unit === "week") ok(`${label} / ${ind}: never says "day"`, !/\bdays?\b/.test(t), t);
    }
  }
  const s200 = R.indicatorRead("MA200", inputFor(short));
  ok("a new listing: MA200 says plainly there isn't enough history, with the counts", /isn't enough history yet/.test(s200) && /about 200 days/.test(s200) && /40 days are available/.test(s200), s200);
  const sTh = R.indicatorRead("Trend Helper (Fast)", inputFor(short));
  ok("a new listing: the Trend Helper says its slow line needs more history", /purple slow line \(MA200\), which needs about 200 days/.test(sTh), sTh);

  // The read matches the plotted series at the bar on screen.
  const L = inputFor(long, "day", 300);
  const ema = L.ema20[300], c = L.closes[300], d = ((c - ema) / ema) * 100;
  const tE = R.indicatorRead("EMA20", L);
  ok("EMA20: the % gap is the plotted gap at the last bar on screen", tE.includes(`${Math.abs(d) < 10 ? Math.abs(d).toFixed(1) : Math.abs(d).toFixed(0)}% ${d > 0 ? "above" : "below"}`), tE);
  ok("EMA20: the slope run is counted from the plotted line", new RegExp(`(rising|falling) for ${Math.abs(R.slopeRun(L.ema20, 300))} days|roughly flat`).test(tE), tE);
  const rsi = L.rsi[300];
  ok("RSI: the value is the plotted value", R.indicatorRead("RSI(14)", L).includes(`RSI is ${rsi.toFixed(1)}`));

  // Trend Helper: a fresh flip reads as a possible change of trend, with the colour.
  const flip = [];
  for (let i = 0; i < 160; i++) flip.push({ date: `f${i}`, close: 200 - i * 0.8, high: 0, low: 0, volume: 1 });
  for (let i = 0; i < 12; i++) flip.push({ date: `u${i}`, close: 72 + i * 4, high: 0, low: 0, volume: 1 });
  const fr = R.indicatorRead("Trend Helper (Fast)", { closes: flip.map((p) => p.close), at: flip.length - 1, unit: "day", ma200: TA.movingAverage(flip.map((p) => p.close), 200) });
  ok("Trend Helper: a recent flip to blue reads as a possible change of trend to the upside", /^Turned blue (\d+ days? ago|on the latest day)\. This may point to a possible change of trend to the upside\./.test(fr), fr);
  const wr = R.indicatorRead("Trend Helper (Fast)", { closes: flip.map((p) => p.close), at: flip.length - 1, unit: "week", ma200: [] });
  ok("Trend Helper: weekly units", /weeks? ago|on the latest week/.test(wr), wr);

  // Bollinger: a squeeze is named.
  const sq = bars(200, { amp: 10, period: 60, seed: 5 }).map((p, i) => (i > 170 ? { ...p, close: 100 + (i % 2) * 0.01, high: 100.2, low: 99.8 } : p));
  const br = R.indicatorRead("Bollinger(20,2)", inputFor(sq));
  ok("Bollinger: a squeeze is named, hedged", /squeeze/.test(br) && /may be followed/.test(br), br);

  // 5. Wiring.
  ok("one indicator: the summary shows the live read", /const singleIndicator = selectedIndicators\.length === 1 \? selectedIndicators\[0\] : null;/.test(dash) && /if \(singleRead\) return singleRead;/.test(dash));
  ok("the read is as of the last bar on screen, from the full plotted series", /closes: closesAll, at: displayEnd - 1, unit: readUnit,/.test(dash));
  ok("the timeframe sets the units", /const readUnit: ReadUnit = activeTimeframe === "W" \? "week" : activeTimeframe === "M" \? "month" : "day";/.test(dash));
  ok("the manual goes in the Selected Indicators card and the phone accordion", (dash.match(/<IndicatorManual name=\{singleIndicator \?\? ""\} text=\{singleManual\} \/>/g) ?? []).length === 2);
  ok("two or more: the names lead the per-indicator lines", /const names = `Showing \$\{selectedIndicators\.join\(", "\)\}\.`;/.test(dash));
  ok("the Learn more link stays", /Learn more →<\/Link>/.test(dash));
  return fails;
}

const src = fs.readFileSync(path.join(ROOT, MODULE), "utf8");
const dash = readCodeOnly(DASH);

const base = await suite(await loadSibling(MODULE, src), dash);
if (base.length) {
  console.error("FAIL check-indicator-read:\n  " + base.join("\n  "));
  process.exit(1);
}

const mut = (label, s, from, to) => {
  if (!s.includes(from)) throw new Error(`mutant "${label}": anchor not found`);
  return s.replace(from, () => to);
};
const MUTANTS = [
  ["the hedge dropped from the flip read", () => [mut("hedge", src, "This may point to a possible change of trend", "This points to a change of trend"), dash]],
  ["an instruction in a manual", () => [mut("advice", src, "Some traders use it to judge how volatile a stock is right now", "You should buy when it is low"), dash]],
  ["NaN leaks on a short history", () => [mut("nan", src, "if (c === null || m === null || m === 0) return notEnough(`the ${name}`, period, input);", "if (c === null) return notEnough(`the ${name}`, period, input);"), dash]],
  ["units ignore the timeframe", () => [mut("units", src, "return `${n} ${unit}${n === 1 ? \"\" : \"s\"}`;", "return `${n} day${n === 1 ? \"\" : \"s\"}`;"), dash]],
  ["an indicator without a manual", () => [mut("manual", src, "  \"Volume\":\n", "  \"Volume_\":\n"), dash]],
  ["Trend Helper colours swapped", () => [mut("colour", src, `const colour = state > 0 ? "blue" : "yellow";`, `const colour = state > 0 ? "yellow" : "blue";`), dash]],
  ["the read taken at the end of history, not the last bar on screen", () => [src, mut("at", dash, "at: displayEnd - 1,", "at: closesAll.length - 1,")]],
  ["the single read not shown", () => [src, mut("show", dash, "if (singleRead) return singleRead;", "")]],
  ["weekly charts read in days", () => [src, mut("tf", dash, `activeTimeframe === "W" ? "week"`, `activeTimeframe === "W" ? "day"`)]],
];

let survived = 0;
for (const [label, make] of MUTANTS) {
  const [s, d] = make();
  let fails;
  try { fails = await suite(await loadSibling(MODULE, s), d); } catch { fails = ["threw"]; }
  if (!fails.length) { survived++; console.error(`MUTANT SURVIVED: ${label}`); }
}
if (survived) process.exit(1);
console.log(`check-indicator-read: ${MUTANTS.length} mutants caught; every indicator has a hedged read and manual, units follow the timeframe`);
