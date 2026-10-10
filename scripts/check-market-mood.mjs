// MARKET MOOD (#563 COWORK #96): rules, then mutants.
//
// lib/marketMood.ts (the maths), app/markets/spx/MarketMoodCard.tsx (the
// thermometer) and the wiring around them: the nightly write in the tiingo-eod
// route, the cached read on the SPX page, LQD in the Tiingo universe, and the
// CNN reading gone from the page and the weekly file.
//
// Rules: the percentile maths; the plain average and the ≥ 5 of 6 rule; the
// labels at their band edges; the inputs on fixture bars (fear at the lows,
// greed at the highs; junk only with LQD; ETFs kept out of the stock tallies);
// what is stored is scores only; no route exposes the series; the nightly
// write, the one-off seed on a night already done (#97), and the read; LQD in both universe writes; no VIX or put/call; no CNN
// text on the page; the card's face, tap note and Tiingo credit; nothing that
// can push the page sideways at 320–430 px. A mutant each.
//
//   node scripts/check-market-mood.mjs
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { stripComments } from "./lib/source-code.mjs";

const F = {
  lib: "lib/marketMood.ts",
  card: "app/markets/spx/MarketMoodCard.tsx",
  page: "app/markets/spx/page.tsx",
  dash: "lib/server/dashboardCards.ts",
  write: "lib/server/marketMoodWrite.ts",
  read: "lib/server/marketMoodRead.ts",
  eod: "app/api/jobs/tiingo-eod/route.ts",
  pool: "app/api/jobs/warm-price-pool/route.ts",
  universe: "lib/server/tiingoUniverse.ts",
  keys: "lib/server/marketData/keys.ts",
  weekly: "content/markets/spx-weekly.json",
  words: "lib/spxPage.ts",
};
const read = (f) => fs.readFileSync(f, "utf8");
const strip = (src) => src.replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "").replace(/^"use client";$/m, "");
const code = (src, file) => stripComments(src, { file });

let n = 0;
async function load(lib, card) {
  const tap = `import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";\n${strip(read("app/stock/[symbol]/TapNote.tsx"))}`;
  const unit = `${tap}\n${strip(lib)}\n${strip(card).replace("export default function MarketMoodCard", "export function MarketMoodCard")}\n`;
  const tmp = `scripts/.check-market-mood-${process.pid}-${n++}.mjs`;
  fs.writeFileSync(tmp, ts.transpileModule(unit, { fileName: "c.tsx", compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react" } }).outputText);
  try { return await import(`${process.cwd()}/${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
}

// ── fixtures: weekdays to Fri 2 Oct 2026, a market wave ─────────────────────
function wave(seed, kind = "stock") {
  const out = [];
  for (let t = Date.parse("2023-01-02T00:00:00Z"), i = 0; t <= Date.parse("2026-10-02T00:00:00Z"); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const mkt = 100 + i * 0.03 + 14 * Math.sin(i / 45) + 4 * Math.sin(i / 11);
    // The market swings harder on the way down: realised volatility rises near the lows.
    const shake = (1 - Math.sin(i / 45)) * 0.6 * Math.sin(i * 1.7 + seed);
    const c = kind === "bond" ? 100 - 5 * Math.sin(i / 45) + 0.3 * Math.sin(i / 7 + seed)
      : kind === "hy" ? 100 + 3 * Math.sin(i / 45) + 0.2 * Math.sin(i / 5)
      : (mkt + shake) * (0.5 + seed / 60) + 2 * Math.sin(i / (6 + seed % 9));
    out.push([d.toISOString().slice(0, 10), c, c * 1.01, c * 0.99, c, 1e6 * (1 + ((i + seed) % 7) / 10)]);
    i++;
  }
  return out;
}
const STOCKS = Array.from({ length: 130 }, (_, i) => [`S${i}`, wave(i + 1)]);
const BASE = new Map([...STOCKS, ["SPY", wave(30)], ["TLT", wave(2, "bond")], ["HYG", wave(3, "hy")]]);
const WITH_LQD = new Map([...BASE, ["LQD", wave(4, "bond")]]);
const SWINGY = wave(30).slice(-400).map((b, i) => { const c = 100 * (1 + (i < 370 ? 0.002 : 0.03) * Math.sin(i * 2.1)); return [b[0], c, c, c, c, 1e6]; });
const ADVICE_OR_THIRD = /\bCNN\b|fear\s*(?:&|and)\s*greed/i;

const RULES = {
  "the percentile: rank in the trailing window, ties half, NaN below 200 values or off a gap": ({ M }) => {
    const up = Array.from({ length: 300 }, (_, i) => i);
    const flat = Array.from({ length: 260 }, () => 5);
    const gaps = up.map((x, i) => (i % 2 ? NaN : x));
    return M.WINDOW === 252 && M.MIN_PCTL === 200 &&
      M.percentileAt(up, 299) === 100 && Math.abs(M.percentileAt(up.map((x) => -x), 299)) === 0 &&
      Number.isNaN(M.percentileAt(up, 150)) && Math.abs(M.percentileAt(flat, 259) - 50) < 1e-9 &&
      Number.isNaN(M.percentileAt(gaps, 299)) && Number.isNaN(M.percentileAt(gaps, 298)) &&
      Math.abs(M.percentileAt([...up.slice(0, 251), 125], 251) - (100 * 125.5) / 251) < 1e-9;
  },
  "the reading is the plain average of the available inputs, shown only with ≥ 5 of 6": ({ M }) => {
    const m = M.computeMarketMood(WITH_LQD);
    const plain = m.days.every((d) => {
      const s = Object.values(d.s);
      return d.r === null ? s.length < 5 : s.length >= 5 && d.r === Math.round(s.reduce((a, b) => a + b, 0) / s.length);
    });
    return M.MOOD_MIN_INPUTS === 5 && M.MOOD_INPUTS.length === 6 &&
      M.blend([10, 20, 30, 40, 50])?.v === 30 && M.blend([10, 20, 30, 40, 50]).n === 5 && M.blend([10, 20, 30, 40]) === null &&
      M.blend([10, 20, NaN, 30, 40, 50, 90])?.v === 40 && M.blend([0, 0, 0, 0, 100]).v === 20 && plain &&
      m.days.some((d) => d.r !== null && d.n === 6) && M.computeMarketMood(BASE).days.every((d) => d.r === null || d.n === 5);
  },
  "the labels at their band edges: ≤24 · ≤44 · ≤55 · ≤75 · above": ({ M }) =>
    [[0, "Extreme fear"], [24, "Extreme fear"], [24.4, "Extreme fear"], [24.6, "Fear"], [25, "Fear"], [44, "Fear"], [45, "Neutral"], [55, "Neutral"], [56, "Greed"], [75, "Greed"], [76, "Extreme greed"], [100, "Extreme greed"]]
      .every(([s, l]) => M.moodLabel(s) === l),
  "the inputs on fixture bars: fear near the lows, greed near the highs; junk only with LQD; ETFs out of the tallies": ({ M }) => {
    const m = M.computeMarketMood(WITH_LQD), spy = WITH_LQD.get("SPY"), at = new Map(spy.map((b, i) => [b[0], i]));
    const xs = [], ys = [];
    for (const d of m.days.slice(-252)) {
      if (d.r === null) continue;
      const g = at.get(d.d), hi = Math.max(...spy.slice(Math.max(0, g - 251), g + 1).map((b) => b[4]));
      xs.push(d.r); ys.push(spy[g][4] / hi - 1);
    }
    const rank = (a) => { const o = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]), out = []; o.forEach(([, i], k) => (out[i] = k)); return out; };
    const rx = rank(xs), ry = rank(ys), c = (xs.length - 1) / 2;
    const rho = rx.reduce((s, v, i) => s + (v - c) * (ry[i] - c), 0) / rx.reduce((s, v) => s + (v - c) ** 2, 0);
    const base = M.moodInputs(BASE), lqd = M.moodInputs(WITH_LQD);
    const withEtfAsStock = M.moodInputs(new Map([...BASE, ["QQQ", wave(77)]])), etfExcluded = M.moodInputs(new Map([...BASE, ["QQQ", wave(77)]]), ["QQQ"]);
    return xs.length >= 200 && rho > 0.5 &&
      base.inputs.junk.every((x) => Number.isNaN(x)) && lqd.inputs.junk.slice(-200).every(Number.isFinite) &&
      M.MOOD_ETFS.includes("LQD") && M.MOOD_ETFS.includes("TLT") && !M.MOOD_ETFS.includes("IEF") &&
      JSON.stringify(withEtfAsStock.inputs.strength) !== JSON.stringify(base.inputs.strength) && JSON.stringify(etfExcluded.inputs.strength) === JSON.stringify(base.inputs.strength) &&
      M.computeMarketMood(new Map([["SPY", wave(30).slice(0, 100)]])) === null &&
      // Calm for a year, then a month of wild swings: the volatility input reads fear (below zero, inverted).
      (() => { const v = M.moodInputs(new Map([["SPY", SWINGY]])).inputs.volatility; return v[v.length - 1] < 0 && v[300] > -0.5; })();
  },
  "what is stored is 0–100 scores by date only: no price, bar or volume": ({ M }) => {
    const m = M.computeMarketMood(WITH_LQD), j = JSON.stringify(m);
    const keysOk = Object.keys(m).join() === "v,asOf,days" && m.days.every((d) => Object.keys(d).join() === "d,r,n,s" && Object.keys(d.s).every((k) => M.MOOD_INPUTS.some((x) => x.key === k)));
    const nums = m.days.flatMap((d) => [d.r, ...Object.values(d.s)]).filter((x) => x !== null);
    const back = M.parseStoredMood(j);
    return keysOk && nums.every((x) => Number.isInteger(x) && x >= 0 && x <= 100) && m.days.every((d) => d.n <= 6) &&
      m.days.length === M.KEEP_DAYS && JSON.stringify(back) === j &&
      M.parseStoredMood({ ...m, days: [{ d: "2026-10-02", r: 731.2, n: 5, s: {} }] }) === null && M.parseStoredMood("{") === null && M.parseStoredMood(null) === null;
  },
  "no route or JSON export serves the series; the page hands the card one day and 90 readings": ({ src, files }) =>
    files.filter((f) => /(^|\/)route\.ts$/.test(f) && /marketMoodRead|readMarketMood|TIINGO_MOOD_KEY/.test(read(f))).length === 0 &&
    // The dashboard's "Market right now" (#563 COWORK #134) is the second reader, through the same moodView.
    files.filter((f) => /marketMoodRead|readMarketMood/.test(read(f)) && f !== F.read).sort().join() === [F.dash, F.page].sort().join() &&
    /mood: moodView\(moodRaw\)/.test(read(F.dash)) && /readMarketMood\(\)\.catch\(\(\) => null\)/.test(read(F.dash)) &&
    files.filter((f) => /marketMoodWrite|writeMarketMood/.test(read(f)) && f !== F.write).join() === F.eod &&
    /const mood = moodView\(await readMarketMood\(\)\);/.test(src.pageCode) && /<MarketMoodCard view=\{mood\} credit=/.test(src.pageCode) &&
    !/\b(?:days|StoredMood)\b/.test(code(src.card, F.card).replace(/MoodDay/g, "")),
  "the nightly write: one SET under msh:tiingo:, after a complete night, before the Pickers build; the page reads through MOOD_TAG": ({ src }) => {
    const w = code(src.write, F.write), r = code(src.read, F.read), eod = code(src.eod, F.eod);
    return /export const TIINGO_MOOD_KEY = `\$\{TIINGO_PREFIX\}mood:v1`;/.test(src.keys) &&
      (w.match(/\b(?:redis|r)\.set\(/g) ?? []).length === 1 && /r\.set\(TIINGO_MOOD_KEY, JSON\.stringify\(m\), \{ ex: TIINGO_EOD_TTL_SECONDS \}\);\s*revalidateTag\(MOOD_TAG, "max"\);/.test(w) &&
      [...w.matchAll(/\b(?:redis|r)\.(\w+)\s*[<(]/g)].every((x) => ["set", "get", "mget"].includes(x[1])) &&
      // #97: the seed runs once (a reading on file ends it at 1 GET), only on a night already done, and stops before writing at its deadline.
      /if \(\(await redis\.get<unknown>\(TIINGO_MOOD_KEY\)\) !== null\) return \{ mood: "on file" \};/.test(w) &&
      /for \(let i = 0; i < symbols\.length; i \+= SEED_MGET_CHUNK\) \{\s*if \(Date\.now\(\) > deadline\) return/.test(w) &&
      /if \("skipped" in eod && eod\.skipped === "already-complete"\) Object\.assign\(mood, await seedMarketMoodIfMissing\(startedAt \+ FUNCTION_MS - MOOD_SEED_RESERVE_MS\)\);/.test(eod) &&
      /computeMarketMood\(bars, MOOD_EXCLUDE\)/.test(w) && /MOOD_EXCLUDE: readonly string\[\] = \[\.\.\.uniqueEtfs, \.\.\.POOL_BENCHMARK_ETFS\]/.test(w) &&
      /return async \(bars: Map<string, EodBar\[\]>\) => \{\s*Object\.assign\(out, await writeMarketMood\(bars\)\);\s*await next\(bars\);\s*\};/.test(eod) &&
      /runTiingoEod\(Date\.now\(\), withMood\(pickersOnBars\(req, startedAt, onBars\), mood\)\)/.test(eod) &&
      (r.match(/redis\.\w+[<(]/g) ?? []).join() === "redis.get<" &&
      /unstable_cache\(loadMood, \["tiingo-mood-v1"\], \{ tags: \[MOOD_TAG\], revalidate: 24 \* 60 \* 60 \}\)/.test(r) && /Redis\.fromEnv\(PAGE_READ_CACHE\)/.test(r);
  },
  "LQD joins the Tiingo universe on both writes (in session and off hours)": ({ src }) =>
    /stockPages: STOCK_PAGE_SYMBOLS,\s*mood: MOOD_ETFS,\s*\}\);/.test(code(src.pool, F.pool)) &&
    /stockPages: STOCK_PAGE_SYMBOLS,\s*mood: MOOD_ETFS,\s*\}\);\s*const written = await writeTiingoUniverse\(plan, nowMs\);/.test(code(src.universe, F.universe)),
  "no VIX or put/call input; the volatility input is SPY's own swings": ({ M, src }) => {
    const lib = code(src.lib, F.lib);
    return !/\b(vix|vixcls|fred|cboe|put|call)\b/i.test(lib.replace(/Option-market/g, "")) &&
      M.MOOD_INPUTS.find((x) => x.key === "volatility")?.line === "Volatility (from SPY's own price swings)" &&
      M.MOOD_INPUTS.map((x) => x.key).join() === "momentum,strength,breadth,volatility,safeHaven,junk";
  },
  "no CNN or Fear & Greed text on the page, in its cards, FAQ or weekly file": ({ M, src }) => {
    const view = M.moodView(M.computeMarketMood(WITH_LQD));
    const html = renderToStaticMarkup(React.createElement(M.MarketMoodCard, { view, credit: "Market data from Tiingo.com" }));
    const words = code(src.words, F.words);
    return ![src.pageCode, code(src.card, F.card), words, src.weekly, html, read("app/markets/spx/LevelsGlanceCard.tsx")].some((t) => ADVICE_OR_THIRD.test(t)) &&
      !/sentiment/.test(src.weekly.replace(/"[^"]*"/g, (s) => (/^"sentiment"$/.test(s) ? s : ""))) && !/weekly\.sentiment|<Tile label="Sentiment"/.test(src.pageCode);
  },
  "the card: Market Mood, 0–100, its label and date, a 90-day line, the tap note's words, the Tiingo credit": ({ M, src }) => {
    const view = M.moodView(M.computeMarketMood(WITH_LQD));
    const html = renderToStaticMarkup(React.createElement(M.MarketMoodCard, { view, credit: "Market data from Tiingo.com" }));
    const text = html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
    const none = renderToStaticMarkup(React.createElement(M.MarketMoodCard, { view: null }));
    return view.spark.length === 90 && view.day.d === "2026-10-02" &&
      text.includes("Market Mood") && text.includes(`${view.day.r} /100`) && text.includes(view.label) && text.includes("Reading for Fri 2 Oct 2026") &&
      text.includes("Daily prices: Market data from Tiingo.com") && (html.match(/<polyline /g) ?? []).length === 1 &&
      M.moodNoteText(6) === "Our reading of market mood from 6 public market measures on our own data. A description, not a forecast. Option-market data isn't included." &&
      /\{moodNoteText\(inputs\.length\)\}/.test(src.card) &&
      // #97: the red → green gradient spans the whole tube, so a low reading's fill never ends in green.
      /backgroundSize: `100% \$\{\(100 \* 100\) \/ fillPct\}%`, backgroundPosition: "bottom"/.test(src.card) && /\{x\.line\}<\/span><strong[^>]*>\{day\.s\[x\.key\]\}<\/strong>/.test(src.card) &&
      /<MarketMoodCard view=\{mood\} credit=\{<a href=\{TIINGO_URL\}[^\n]*>\{TIINGO_CREDIT\}<\/a>\} \/>/.test(src.pageCode) &&
      none.replace(/<[^>]+>/g, "").includes("Market Mood will appear after tonight&#x27;s update.") && !/problem on our side|\b50\b/.test(none.replace(/<[^>]+>/g, ""));
  },
  "nothing in the card or the hero can push the page sideways at 320–430 px": ({ src }) => {
    const c = code(src.card, F.card);
    return /minWidth: 0, boxSizing: "border-box"/.test(c) && /width="100%"/.test(c) && !/nowrap/.test(c) && !/width: \d{3,}/.test(c) &&
      /\.spxHeroGrid \{ grid-template-columns: minmax\(0, 1fr\) !important; \}/.test(src.pageCode) &&
      /className="spxHeroGrid" style=\{\{ display: "grid", gridTemplateColumns: "minmax\(0, 1fr\) 300px"/.test(src.pageCode);
  },
};

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name === "node_modules" || e.name.startsWith(".") ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : []));
const FILES = [...walk("app"), ...walk("lib")];
const SRC = Object.fromEntries(Object.entries(F).map(([k, f]) => [k, read(f)]));
let failures = 0;
const check = (label, ok) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures++; };
const run = (rule, m) => { try { return !!rule(m); } catch { return false; } };
const measure = async (s, files = FILES) => ({ src: { ...s, pageCode: code(s.page, F.page) }, files, M: await load(s.lib, s.card) });

console.log("=== Rules ===");
const base = await measure(SRC);
for (const [label, rule] of Object.entries(RULES)) check(label, run(rule, base));

const R = Object.keys(RULES);
const MUTANTS = [
  [R[0], "lib", (s) => s.replace("return (100 * (below + 0.5 * (equal - 1))) / (n - 1);", "return (100 * (below + equal)) / n;")],
  [R[0], "lib", (s) => s.replace("export const MIN_PCTL = 200;", "export const MIN_PCTL = 20;")],
  [R[1], "lib", (s) => s.replace("export const MOOD_MIN_INPUTS = 5;", "export const MOOD_MIN_INPUTS = 4;")],
  [R[1], "lib", (s) => s.replace("return xs.length >= min ? { v: xs.reduce((a, b) => a + b, 0) / xs.length, n: xs.length } : null;", "return xs.length >= min ? { v: [...xs].sort((a, b) => a - b)[xs.length >> 1], n: xs.length } : null;")],
  [R[2], "lib", (s) => s.replace("{ max: 44, label: \"Fear\" },", "{ max: 45, label: \"Fear\" },")],
  [R[2], "lib", (s) => s.replace("const s = Math.round(score);", "const s = Math.floor(score);")],
  [R[3], "lib", (s) => s.replace("return -(rv[g] / (s / 50) - 1);", "return rv[g] / (s / 50) - 1;")],
  [R[3], "lib", (s) => s.replace("junk: gap(on(\"HYG\"), on(\"LQD\"))", "junk: gap(on(\"HYG\"), on(\"TLT\"))")],
  [R[3], "lib", (s) => s.replace("const skip = new Set<string>([...MOOD_ETFS, ...exclude]);", "const skip = new Set<string>([...MOOD_ETFS]);")],
  [R[4], "lib", (s) => s.replace("days.push({ d: dates[i], r: b ? Math.round(b.v) : null,", "days.push({ d: dates[i], close: spyClose(i), r: b ? Math.round(b.v) : null,").replace("const keys = MOOD_INPUTS.map((x) => x.key);\n  const days", "const keys = MOOD_INPUTS.map((x) => x.key);\n  const spyClose = (i: number) => bars.get(\"SPY\")![i][4];\n  const days")],
  [R[4], "lib", (s) => s.replace("const p = Math.round(percentileAt(inputs[k], i));", "const p = percentileAt(inputs[k], i);")],
  [R[5], "page", (s) => s.replace("<MarketMoodCard view={mood} credit=", "<MarketMoodCard view={mood} series={await readMarketMood()} credit=")],
  [R[5], "files", null],
  [R[6], "write", (s) => s.replace("  revalidateTag(MOOD_TAG, \"max\");\n", "")],
  [R[6], "write", (s) => s.replace('    if ((await redis.get<unknown>(TIINGO_MOOD_KEY)) !== null) return { mood: "on file" };\n', "")],
  [R[6], "write", (s) => s.replace('      if (Date.now() > deadline) return { mood: "seed stopped: time (the next run tries again)", moodSeedReads: reads };\n', "")],
  [R[6], "eod", (s) => s.replace('if ("skipped" in eod && eod.skipped === "already-complete") Object.assign(', "Object.assign(")],
  [R[6], "eod", (s) => s.replace("    Object.assign(out, await writeMarketMood(bars));\n    await next(bars);", "    await next(bars);\n    Object.assign(out, await writeMarketMood(bars));")],
  [R[6], "keys", (s) => s.replace("export const TIINGO_MOOD_KEY = `${TIINGO_PREFIX}mood:v1`;", "export const TIINGO_MOOD_KEY = \"msh:mood:v1\";")],
  [R[7], "universe", (s) => s.replace("      mood: MOOD_ETFS,\n    });\n    const written", "    });\n    const written")],
  [R[7], "pool", (s) => s.replace("      mood: MOOD_ETFS,\n", "")],
  [R[8], "lib", (s) => s.replace("{ key: \"volatility\", line: \"Volatility (from SPY's own price swings)\" },", "{ key: \"volatility\", line: \"Volatility (VIX vs its 50-day average)\" },")],
  [R[9], "page", (s) => s.replace("{weekly.oneLiner}", "{weekly.oneLiner} CNN Fear &amp; Greed")],
  [R[9], "words", (s) => s.replace("the Market Mood reading beside it is the broader measure.", "sentiment is the Fear & Greed reading beside it.")],
  [R[10], "card", (s) => s.replace("{moodNoteText(inputs.length)}", "{moodNoteText(6)}")],
  [R[10], "page", (s) => s.replace(/<MarketMoodCard view=\{mood\} credit=\{<a[^\n]*\/>/, "<MarketMoodCard view={mood} credit={credit} />")],
  [R[10], "card", (s) => s.replaceAll("Reading for {dayWords(day.d)}", "Latest reading")],
  [R[10], "card", (s) => s.replace('backgroundSize: `100% ${(100 * 100) / fillPct}%`, backgroundPosition: "bottom", ', "")],
  [R[10], "card", (s) => s.replace("Market Mood will appear after tonight&apos;s update.", "Market Mood isn&apos;t available just now. This is a problem on our side.")],
  [R[11], "card", (s) => s.replace("minWidth: 0, boxSizing: \"border-box\", position: \"relative\"", "minWidth: 320, boxSizing: \"border-box\", position: \"relative\"")],
  [R[11], "page", (s) => s.replace("          .spxHeroGrid { grid-template-columns: minmax(0, 1fr) !important; }\n", "")],
];
console.log("\n=== Mutants: each must FAIL its rule ===");
for (const [label, where, mutate] of MUTANTS) {
  let m;
  if (where === "files") {
    // A new public route that reads the series.
    const fake = "app/api/market-mood/route.ts";
    const files = [...FILES, fake];
    const realRead = fs.readFileSync;
    m = await measure(SRC, files);
    const rule = RULES[label];
    const ok = (() => { const orig = fs.readFileSync; fs.readFileSync = (f, ...a) => (f === fake ? 'import { readMarketMood } from "@/lib/server/marketMoodRead";\nexport async function GET() { return Response.json(await readMarketMood()); }' : orig(f, ...a)); try { return run(rule, m); } finally { fs.readFileSync = realRead; } })();
    check(`mutant bites: ${label} (a public route)`, !ok);
    continue;
  }
  const mut = mutate(SRC[where]);
  if (mut === SRC[where]) { check(`mutant bites: ${label} — the mutation did not apply`, false); continue; }
  try { m = await measure({ ...SRC, [where]: mut }); } catch { m = null; }
  check(`mutant bites: ${label}`, !m || !run(RULES[label], m));
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
