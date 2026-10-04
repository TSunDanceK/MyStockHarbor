// Tiingo step 3 (#553 COWORK #71 row 3): the stock-page charts and /api/history,
// behind PRICE_PROVIDER_CHARTS / PRICE_PROVIDER_HISTORY, and the COWORK #89
// Daily | Weekly toggle that rides with it.
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. THE SERIES LIES: a partial IEX bar appended when the close has already
//      landed, IEX venue volume summed into a day or a week, a label dropped, or
//      Tiingo bars spliced onto FMP ones (COWORK #53 §3, #56, #57 §2).
//   2. A SURFACE SWITCHED WITHOUT ITS GATE, a typo that switches it, or an FMP
//      fallback that keeps running with FMP_API_KEY unset (COWORK #55, CODE-B #69).
//   3. THE COWORK #72 LIMITS LOOSENED "while we were in there": BotID dropped
//      from /api/history, /api/ un-disallowed in robots, a CORS header, a
//      download, or a NEW route that serves Tiingo data. Any of those needs a
//      Cowork ruling first, so each is pinned here with a mutant.
//   4. THE TOGGLE HALF-SWITCHES (COWORK #89): the chart changes but the tiles,
//      the title or the explainer stay on the other view; the weekly view
//      missing from the server HTML; no tablist; colour as the only cue.
//   5. TIINGO BARS AS PUBLIC JSON (COWORK #103: "Tiingo-derived bars don't go
//      out through public JSON; pages read them in-process"). On the Tiingo
//      path /api/history must answer `private, no-store` (a CDN hit would skip
//      BotID), cap `days` at what our charts ask for, and refuse a request that
//      is not same-origin with a 403 carrying no bars, while the FMP path keeps
//      its public headers. And the chart credit follows whose bars are SHOWN,
//      not the gate or whether the page was seeded.
//
// Section 1 runs the real lib/server/tiingoHistory.ts on fixtures; section 2
// re-runs it on mutated copies. Section 3 renders the real toggle card and the
// chart with react-dom/server; section 4 renders mutated copies (and a mutated
// markup for "the tiles don't switch"). Section 5 reads source for the gates and
// the #72 limits; section 6 plants a mutant for each. Section 7 runs the REAL
// /api/history GET handler with its I/O stubbed (BotID, the FMP read, the Data
// Cache reader) under both gates, then re-runs it on mutated copies of the route
// and the helper. Every mutant must fail.
//
//   node scripts/check-tiingo-step3.mjs
import { register } from "node:module";
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { stripComments } from "./lib/source-code.mjs";

register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

const ROOT = process.cwd();
const raw = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const report = (summary, fails) => {
  for (const f of fails) check(f, false);
  check(summary, fails.length === 0);
};

const FILES = {
  helper: "lib/server/tiingoHistory.ts",
  route: "app/api/history/route.ts",
  quoteRoute: "app/api/quote/route.ts",
  robots: "app/robots.ts",
  botid: "instrumentation-client.ts",
  stockPage: "app/stock/[symbol]/page.tsx",
  stockClient: "app/stock/[symbol]/StockSymbolPageClient.tsx",
  chart: "app/stock/[symbol]/StockPriceChart.tsx",
  dashPage: "app/dashboard/page.tsx",
  dashClient: "app/components/DashboardClient.tsx",
  toggle: "app/components/ReturnsToggleCard.tsx",
  returns: "app/components/ReturnsBarChart.tsx",
  interactive: "app/components/InteractiveChart.tsx",
};

// ── 1. The helper, on the real module ─────────────────────────────────────
// 2026-10-01 18:05 UTC = 14:05 EDT, a Thursday session.
const THU_1405 = Date.UTC(2026, 9, 1, 18, 5);
const WED_1500 = Date.UTC(2026, 8, 30, 19, 0);
const bar = (date, close, volume = 1000) => [date, close - 0.5, close + 1, close - 1, close, volume];
const BARS = [bar("2026-09-28", 97, 1100), bar("2026-09-29", 98, 2000), bar("2026-09-30", 100, 3000)];
const ROW = { price: 103, open: 101, high: 104, low: 99, prevClose: 100, at: THU_1405 };
const FMP = [{ date: "2026-09-30", close: 99.9, volume: 5 }];

const T = await import(pathToFileURL(path.join(ROOT, "lib/server/marketData/tiingo.ts")).href);

/** Section-1 assertions over a module; returns the failure labels. */
async function behaviour(H) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };

  const pts = H.buildTiingoHistoryPoints(BARS, null);
  want("bars -> points: date, OHLC and split-adjusted volume carried as stored",
    pts?.length === 3 && pts[2].date === "2026-09-30" && pts[2].close === 100 && pts[2].open === 99.5 &&
    pts[2].high === 101 && pts[2].low === 99 && pts[2].volume === 3000 && !pts.some((p) => p.partial));

  const live = H.buildTiingoHistoryPoints(BARS, ROW);
  const last = live?.[live.length - 1];
  want("a newer IEX row appends ONE partial bar, labelled \"today so far (IEX), hh:mm ET\"",
    live?.length === 4 && last.date === "2026-10-01" && last.close === 103 && last.open === 101 && last.high === 104 &&
    last.low === 99 && last.partial === true && last.label === "today so far (IEX), 14:05 ET");
  want("the partial bar carries no volume at all (IEX volume never reaches a chart)", last && !("volume" in last));
  want("the partial bar is not appended when the close for that day has landed",
    H.buildTiingoHistoryPoints(BARS, { ...ROW, at: WED_1500 })?.length === 3);
  want("a pool row with no stored bars is not a history: null, so the caller keeps FMP",
    H.buildTiingoHistoryPoints([], ROW) === null && H.buildTiingoHistoryPoints(null, null) === null);

  // Price basis B: the planted 2-for-1 from check-tiingo-step1, through the real
  // parser, reaches the chart halved with its volume doubled (COWORK #30, #60).
  const split = T.parseEodCsv([
    "date,close,high,low,open,volume,adjClose,adjHigh,adjLow,adjOpen,adjVolume,divCash,splitFactor",
    "2026-09-24,51,52,49,50,300,40,41,39,40,999,0,1",
    "2026-09-22,100,104,96,98,100,80,83,77,78,999,0.5,1",
    "2026-09-23,50,51,48,49,200,40,41,38,39,999,0,2",
  ].join("\n"));
  const sp = H.buildTiingoHistoryPoints(split, null);
  want("basis B: the pre-split bar reaches the chart halved, volume doubled, no dividend adjustment",
    sp?.[0]?.close === 50 && sp[0].volume === 200 && sp[1].close === 50 && sp[2].close === 51 && !sp.some((p) => p.close === 40));

  // Weekly/monthly roll-up: the period holding the partial bar is partial.
  const rolled = H.carryPartialLabel(live, [{ date: "2026-09-28", close: 100 }, { date: "2026-10-01", close: 103 }]);
  want("the roll-up's last period inherits the partial label; a closed series is untouched",
    rolled[1].label === "today so far (IEX), 14:05 ET" && rolled[1].partial === true && rolled[0].label === undefined &&
    H.carryPartialLabel(pts, [{ date: "x", close: 1 }])[0].label === undefined);

  // The switch, with an injected reader and FMP.
  const run = async (env, inputs) => {
    let fmpCalls = 0, reads = 0;
    const out = await H.historyForSurface("HISTORY", "ABC", async () => { fmpCalls++; return FMP; }, {
      env,
      readInputs: async () => { reads++; if (inputs instanceof Error) throw inputs; return inputs; },
    });
    return { ...out, fmpCalls, reads };
  };
  const HIT = { row: ROW, bars: BARS };
  const MISS = { row: ROW, bars: null };
  const KEY = { FMP_API_KEY: "x" };

  let r = await run({ ...KEY }, HIT);
  want("gate unset: FMP exactly as before, Tiingo never read", r.provider === "fmp" && r.points === FMP && r.reads === 0);
  r = await run({ ...KEY, PRICE_PROVIDER_HISTORY: "tiingoo" }, HIT);
  want("a typo in the gate stays on FMP", r.provider === "fmp" && r.reads === 0);
  r = await run({ ...KEY, PRICE_PROVIDER_CHARTS: "tiingo" }, HIT);
  want("CHARTS switched does not switch HISTORY", r.provider === "fmp" && r.reads === 0);
  r = await run({ ...KEY, PRICE_PROVIDER_HISTORY: " Tiingo " }, HIT);
  want("switched, a hit: the Tiingo series whole, FMP not called (never spliced)",
    r.provider === "tiingo" && r.fmpCalls === 0 && r.points.length === 4 && r.points.every((p) => p.date >= "2026-09-28" && p.close !== 99.9));
  r = await run({ ...KEY, PRICE_PROVIDER_HISTORY: "tiingo" }, MISS);
  want("switched, a miss: FMP whole while FMP_API_KEY is set", r.provider === "fmp" && r.points === FMP && r.fmpCalls === 1);
  r = await run({ PRICE_PROVIDER_HISTORY: "tiingo" }, MISS);
  want("switched, a miss, FMP_API_KEY unset: the residual drops out, FMP not called",
    r.provider === "none" && r.points.length === 0 && r.fmpCalls === 0);
  r = await run({ ...KEY, PRICE_PROVIDER_HISTORY: "tiingo" }, new Error("redis down"));
  want("a reader that throws is a miss, never a broken page", r.provider === "fmp" && r.fmpCalls === 1);
  return fails;
}

console.log("\n=== 1. The step-3 history helper ===\n");
const H = await import(pathToFileURL(path.join(ROOT, FILES.helper)).href);
report("the Tiingo series is whole, labelled, volume-free on the partial bar, and gated", await behaviour(H));

// ── 2. Behaviour mutants ──────────────────────────────────────────────────
console.log("\n=== 2. Helper mutants ===\n");
const HELPER_SRC = raw(FILES.helper);
const HELPER_MUTANTS = [
  ["the partial bar appended even when the close has landed", /todaySoFar\(bars \?\? \[\], /, "todaySoFar([], "],
  ["IEX volume added to the partial bar", /partial: true, label: today\.label \}\);/, "partial: true, label: today.label, volume: 7 });"],
  ["the partial bar loses its label", /, label: today\.label \}\);/, " });"],
  ["Tiingo bars spliced onto FMP's", /if \(tiingo\) return \{ points: tiingo, provider: "tiingo" \};/, 'if (tiingo) return { points: [...(await fmp()), ...tiingo], provider: "tiingo" };'],
  ["FMP called on a miss with FMP_API_KEY unset", /\n\s*if \(!env\.FMP_API_KEY\) return \{ points: \[\], provider: "none" \};/, ""],
  ["the gate ignored", /if \(!historyOnTiingo\(surface, env\)\)/, "if (false)"],
  ["the roll-up loses the partial label", /if \(!tail\?\.partial \|\| !rolled\.length\) return rolled;/, "return rolled;"],
];
for (const [label, from, to] of HELPER_MUTANTS) {
  const m = HELPER_SRC.replace(from, to);
  if (m === HELPER_SRC) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  const tmp = path.join(ROOT, "lib/server", `.check-step3-mutant-${process.pid}.ts`);
  fs.writeFileSync(tmp, m);
  try {
    const M = await import(`${pathToFileURL(tmp).href}?m=${encodeURIComponent(label)}`);
    const fails = await behaviour(M);
    check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// ── 3. The toggle and the chart, rendered ─────────────────────────────────
console.log("\n=== 3. The #89 toggle and the chart, server-rendered ===\n");

const TMP_DIR = path.join(ROOT, "scripts", `.check-step3-render-${process.pid}`);
let tmpN = 0;
/** Transpile TSX sources and import them; `files` maps a module name to its source. */
async function importTsx(files, entry) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const tag = `${++tmpN}`;
  for (const [name, src] of Object.entries(files)) {
    let js = ts.transpileModule(src, {
      fileName: `${name}.tsx`,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react" },
    }).outputText;
    for (const other of Object.keys(files)) js = js.replaceAll(`"./${other}"`, `"./${other}-${tag}.mjs"`);
    fs.writeFileSync(path.join(TMP_DIR, `${name}-${tag}.mjs`), js);
  }
  return import(pathToFileURL(path.join(TMP_DIR, `${entry}-${tag}.mjs`)).href);
}

/** Every element opened by `openRe` (a <div ...> tag), with its matching close. */
function elements(html, openRe) {
  const out = [];
  for (const m of html.matchAll(openRe)) {
    const start = m.index;
    const tag = /<div|<\/div>/g;
    tag.lastIndex = start + m[0].length;
    let depth = 1, t, end = -1;
    while ((t = tag.exec(html))) {
      depth += t[0] === "<div" ? 1 : -1;
      if (depth === 0) { end = t.index + t[0].length; break; }
    }
    if (end < 0) continue;
    out.push({ start, end, open: m[0], outer: html.slice(start, end), inner: html.slice(start + m[0].length, end - 6) });
  }
  return out;
}
const panelsOf = (html) => elements(html, /<div[^>]*role="tabpanel"[^>]*>/g);
const cut = (html, spans) => spans.reduceRight((h, s) => h.slice(0, s.start) + h.slice(s.end), html);

const DAILY = Array.from({ length: 20 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, label: `Sep ${i + 1}`, changePercent: i % 3 === 0 ? -0.5 : 0.75 }));
DAILY[19] = { ...DAILY[19], changePercent: 1.25 };
const WEEKLY = Array.from({ length: 12 }, (_, i) => ({ date: `2026-07-${String(i + 1).padStart(2, "0")}`, label: `Wk ${i + 1}`, changePercent: i % 2 ? 2 : -1 }));
WEEKLY[11] = { ...WEEKLY[11], changePercent: -3.5 };
const VIEWS = {
  daily: { eyebrow: "Daily returns", compare: "previous day", chart: "daily close-over-close", tile: "Latest daily change", latest: "+1.25%" },
  weekly: { eyebrow: "Weekly returns", compare: "previous week", chart: "weekly close-over-close", tile: "Latest weekly change", latest: "-3.50%" },
};
/** The four parts of one view, each present in `html`. Returns the missing ones. */
function missingParts(html, v) {
  const P = VIEWS[v];
  const missing = [];
  if (!(html.includes(`>${P.eyebrow}<`) && new RegExp(`<h3[^>]*>[^<]*close vs ${P.compare}`).test(html))) missing.push("title line");
  if (!new RegExp(`<p[^>]*>Each bar is the percentage change[^<]*${P.compare}`).test(html)) missing.push("explainer");
  if (!new RegExp(`<svg[^>]*aria-label="[^"]*${P.chart}`).test(html)) missing.push("chart");
  if (!(html.includes(P.tile) && html.includes("Up / down over window") && html.includes("Average change") && html.includes(P.latest))) missing.push("3 tiles");
  return missing;
}
const other = (v) => (v === "daily" ? "weekly" : "daily");
const leaks = (html, v) => {
  const P = VIEWS[v];
  return [P.eyebrow, P.tile, P.chart].filter((s) => html.includes(s));
};

/** The toggle's rules over the markup for each state. Returns failure labels. */
function toggleMarkupRules(byState) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  for (const [state, html] of Object.entries(byState)) {
    const panels = panelsOf(html);
    want(`[${state}] both views are in the server HTML, one tab panel each`, panels.length === 2);
    for (const [i, v] of [[0, "daily"], [1, "weekly"]]) {
      const p = panels[i];
      if (!p) continue;
      const miss = missingParts(p.inner, v);
      want(`[${state}] the ${v} panel holds all four parts (missing: ${miss.join(", ") || "none"})`, miss.length === 0);
      want(`[${state}] the ${v} panel holds nothing of the ${other(v)} view`, leaks(p.inner, other(v)).length === 0);
      want(`[${state}] the ${v} panel is ${v === state ? "shown" : "hidden"}`, /\shidden=""/.test(p.open) === (v !== state));
    }
    const outside = cut(html, panels);
    want(`[${state}] no chart, title, explainer or tile outside the panels`,
      !/<svg|returns-stats-row|<h3|Each bar is/.test(outside));
    const visible = cut(html, panels.filter((p) => /\shidden=""/.test(p.open)));
    want(`[${state}] what is visible is the ${state} view, all four parts`, missingParts(visible, state).length === 0);
    want(`[${state}] nothing of the ${other(state)} view is visible`, leaks(visible, other(state)).length === 0);

    // The tablist.
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>([\s\S]*?)<\/button>/g)];
    want(`[${state}] a real tablist with two tabs`, /role="tablist"/.test(html) && tabs.length === 2);
    for (const [i, v] of [[0, "daily"], [1, "weekly"]]) {
      const t = tabs[i];
      if (!t) continue;
      const on = v === state;
      const id = /\sid="([^"]+)"/.exec(t[0])?.[1];
      const controls = /aria-controls="([^"]+)"/.exec(t[0])?.[1];
      const panel = panelsOf(html)[i];
      want(`[${state}] the ${v} tab: aria-selected="${on}"`, t[0].includes(`aria-selected="${on}"`));
      want(`[${state}] the ${v} tab controls its panel, which is labelled by it`,
        !!controls && !!panel && panel.open.includes(`id="${controls}"`) && panel.open.includes(`aria-labelledby="${id}"`));
      want(`[${state}] roving tabindex on the ${v} tab`, t[0].includes(`tabindex="${on ? 0 : -1}"`));
      want(`[${state}] the ${v} tab's active state is not colour alone (a check mark, only when active)`, t[1].includes("✓") === on);
    }
  }
  return fails;
}

/** Keyboard: the tablist's own handler, driven directly. */
function keyboardRules(Mod) {
  const fails = [];
  const findRole = (el, role) => {
    if (!el || typeof el !== "object") return null;
    if (Array.isArray(el)) { for (const c of el) { const f = findRole(c, role); if (f) return f; } return null; }
    if (el.props?.role === role) return el;
    return findRole(el.props?.children, role);
  };
  const press = (active, key) => {
    const got = [];
    const tree = Mod.ReturnsToggleView({ symbol: "ABC", daily: DAILY, weekly: WEEKLY, active, idBase: "t", onSelect: (k, focus) => got.push([k, focus]) });
    const list = findRole(tree, "tablist");
    list?.props.onKeyDown?.({ key, preventDefault() {} });
    return got.map((g) => g.join(":")).join(",");
  };
  const want = (label, ok) => { if (!ok) fails.push(label); };
  want("ArrowRight moves Daily -> Weekly and focuses it", press("daily", "ArrowRight") === "weekly:true");
  want("ArrowLeft wraps Daily -> Weekly", press("daily", "ArrowLeft") === "weekly:true");
  want("Home selects Daily, End selects Weekly", press("weekly", "Home") === "daily:true" && press("daily", "End") === "weekly:true");
  want("other keys are left alone (Enter/Space are the buttons' own)", press("daily", "x") === "");
  return fails;
}

/** The active tab's style carries weight and an underline, not only colour. */
function styleRules(toggleSrc) {
  const fails = [];
  const rule = /\.returns-toggle-tab\.is-active \{([^}]*)\}/.exec(toggleSrc)?.[1] ?? "";
  const base = /\.returns-toggle-tab \{([^}]*)\}/.exec(toggleSrc)?.[1] ?? "";
  if (!/font-weight: 900/.test(rule) || /font-weight: 900/.test(base)) fails.push("the active tab is heavier than the inactive one");
  if (!/text-decoration: underline/.test(rule)) fails.push("the active tab is underlined");
  return fails;
}

async function renderToggle(toggleSrc, returnsSrc) {
  const Mod = await importTsx({ ReturnsBarChart: returnsSrc, ReturnsToggleCard: toggleSrc }, "ReturnsToggleCard");
  const byState = {
    // The default export, as the page mounts it: whatever it starts on is the default.
    daily: renderToStaticMarkup(React.createElement(Mod.default, { symbol: "ABC", daily: DAILY, weekly: WEEKLY })),
    // The other state, through the stateless view the default export renders.
    weekly: renderToStaticMarkup(React.createElement(Mod.ReturnsToggleView, { symbol: "ABC", daily: DAILY, weekly: WEEKLY, active: "weekly", idBase: "w" })),
  };
  return { Mod, byState };
}

async function toggleFails(toggleSrc, returnsSrc, mutateMarkup = null) {
  const { Mod, byState } = await renderToggle(toggleSrc, returnsSrc);
  if (mutateMarkup) for (const k of Object.keys(byState)) byState[k] = mutateMarkup(byState[k], k);
  return [...toggleMarkupRules(byState), ...keyboardRules(Mod), ...styleRules(toggleSrc)];
}

const TOGGLE_SRC = raw(FILES.toggle);
const RETURNS_SRC = raw(FILES.returns);
const CHART_SRC = raw(FILES.chart);

/** The chart: short-history notes, the partial label, the credit. */
async function chartFails(chartSrc) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const C = await importTsx({ StockPriceChart: chartSrc }, "StockPriceChart");
  const data = Array.from({ length: 120 }, (_, i) => ({ date: `2026-${String(5 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`, close: 100 + (i % 7) }));
  data[data.length - 1] = { ...data[data.length - 1], label: "today so far (IEX), 14:05 ET" };
  const ma50 = data.map((_, i) => (i >= 49 ? 101 : null));
  const none = data.map(() => null);
  const short = renderToStaticMarkup(React.createElement(C.default, { symbol: "KRMN", data, ma50, ma200: none, credit: React.createElement("a", { href: "#credit" }, "credit") }));
  const full = renderToStaticMarkup(React.createElement(C.default, { symbol: "AAPL", data: data.slice(0, -1), ma50: ma50.slice(0, -1), ma200: ma50.slice(0, -1) }));
  const notes = short.match(/title="Not enough price history stored yet"/g) ?? [];
  want("short history: the MA200 legend says why, on hover, and MA50 (computable) does not", notes.length === 1 && /title="Not enough price history stored yet"[^]*?MA200/.test(short) && C.SHORT_HISTORY_NOTE === "Not enough price history stored yet");
  want("a full history shows no note", !full.includes("Not enough price history"));
  want("the chart names the partial bar", short.includes("(today so far (IEX), 14:05 ET)") && !full.includes("today so far"));
  want("the chart shows the credit it is given", short.includes('href="#credit"') && !full.includes("#credit"));
  return fails;
}

try {
  report("the toggle: both views server-rendered, Daily default, all four parts switch together, accessible", await toggleFails(TOGGLE_SRC, RETURNS_SRC));
  report("the chart: short-history note, partial-bar label, credit", await chartFails(CHART_SRC));

  // ── 4. Toggle and chart mutants ─────────────────────────────────────────
  console.log("\n=== 4. Toggle and chart mutants ===\n");
  /** COWORK #89's named mutant, on the markup: the daily tiles stay put while the view changes. */
  const tilesStay = (html) => {
    const panels = panelsOf(html);
    const dailyTiles = elements(panels[0]?.inner ?? "", /<div class="returns-stats-row">/g)[0]?.outer ?? "";
    let out = html;
    for (const p of [...panels].reverse()) {
      const t = elements(p.outer, /<div class="returns-stats-row">/g)[0];
      if (t) out = out.slice(0, p.start + t.start) + out.slice(p.start + t.end);
    }
    return out.replace("<style>", `${dailyTiles}<style>`);
  };
  const chartStays = (html) => {
    const p = panelsOf(html);
    const daily = /<svg[\s\S]*?<\/svg>/.exec(p[0]?.inner ?? "")?.[0] ?? "";
    return html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace("<style>", `${daily}<style>`);
  };
  const MARKUP_MUTANTS = [
    ["the tiles don't switch (COWORK #89)", tilesStay],
    ["the chart doesn't switch", chartStays],
    ["the title line stays on daily", (html) => html.replace(/>Weekly returns</g, ">Daily returns<")],
  ];
  for (const [label, fn] of MARKUP_MUTANTS) {
    const fails = await toggleFails(TOGGLE_SRC, RETURNS_SRC, fn);
    check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
  }

  const TOGGLE_MUTANTS = [
    ["Weekly is the default", /useState<ReturnsViewKey>\("daily"\)/, 'useState<ReturnsViewKey>("weekly")'],
    ["the inactive view is not server-rendered", /\{views\.map\(\(v\) => \(/, "{views.filter((v) => v.key === current).map((v) => ("],
    ["an explainer outside the panels", /\{views\.map\(\(v\) => \(/, "<p>Each bar is the percentage change in ABC versus its previous day's close</p>{views.map((v) => ("],
    ["no tablist role", /<div role="tablist"/, '<div role="group"'],
    ["aria-selected dropped", /\s*aria-selected=\{on\}/, ""],
    ["aria-controls dropped", /\s*aria-controls=\{`\$\{idBase\}-panel-\$\{v\.key\}`\}/, ""],
    ["no roving tabindex", /tabIndex=\{on \? 0 : -1\}/, "tabIndex={0}"],
    ["arrow keys ignored", /if \(e\.key === "ArrowRight" \|\| e\.key === "ArrowDown"\) next = \(i \+ 1\) % views\.length;/, ""],
    ["Home/End ignored", /else if \(e\.key === "Home"\) next = 0;/, ""],
    ["the active state by colour only", /\{on \? <span aria-hidden="true" className="returns-toggle-check">✓<\/span> : null\}/, ""],
    ["the active tab no heavier or underlined", /font-weight: 900; text-decoration: underline;/, "font-weight: 600;"],
  ];
  for (const [label, from, to] of TOGGLE_MUTANTS) {
    const m = TOGGLE_SRC.replace(from, to);
    if (m === TOGGLE_SRC) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
    const fails = await toggleFails(m, RETURNS_SRC);
    check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
  }
  const RETURNS_MUTANTS = [
    ["the bare view drops its tiles", /<div className="returns-stats-row">/, '<div className="returns-stats-row" hidden={bare}>'],
  ];
  for (const [label, from, to] of RETURNS_MUTANTS) {
    const m = RETURNS_SRC.replace(from, to);
    if (m === RETURNS_SRC) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
    const fails = await toggleFails(TOGGLE_SRC, m, (html) => cut(html, elements(html, /<div class="returns-stats-row" hidden="">/g)));
    check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
  }
  const CHART_MUTANTS = [
    ["a bare \"—\": the MA200 note dropped", /title=\{has200 \? undefined : SHORT_HISTORY_NOTE\}/, "title={undefined}"],
    ["the partial-bar label dropped from the chart", /\{series\[series\.length - 1\]\.label \? ` \(\$\{series\[series\.length - 1\]\.label\}\)` : null\}/, ""],
    ["the chart drops the credit", /\{credit \? <> · \{credit\}<\/> : null\}/, ""],
  ];
  for (const [label, from, to] of CHART_MUTANTS) {
    const m = CHART_SRC.replace(from, to);
    if (m === CHART_SRC) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
    const fails = await chartFails(m);
    check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
  }
} finally {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
}

// ── 5. Static rules: the call-site gates and the COWORK #72 limits ────────
console.log("\n=== 5. Gates and the COWORK #72 limits ===\n");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && !e.name.startsWith(".")) walk(rel, out); }
    else if (/\.(tsx|ts|mjs|js)$/.test(e.name)) out.push(rel);
  }
  return out;
}

// The API routes allowed to serve Tiingo data. ADDING ONE IS A NEW PUBLIC JSON
// ROUTE CARRYING TIINGO DATA: it needs a Cowork ruling first (COWORK #72).
const TIINGO_API_ROUTES = new Set(["app/api/history/route.ts"]);
const TIINGO_READ = /\b(readTiingoHistory|readTiingoPool|readSurfaceInputs|readSurfacePrice|readTiingoQuote|readTiingoHistoryPoints|historyForSurface|tiingoPickerHistory)\b|marketData\/read["']|tiingoSurfacePrice["']|tiingoHistory["']|tiingoQuote["']/;

function rules(srcs) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const code = Object.fromEntries(Object.entries(srcs).map(([f, s]) => [f, /\.(ts|tsx)$/.test(f) ? stripComments(s, { file: f }) : s]));

  // /api/history: BotID first, the HISTORY gate, the same shape.
  const route = code[FILES.route];
  const bot = route.indexOf("if (await isUnwantedBot()) {");
  const read = route.indexOf("await historyForSurface(");
  want("/api/history keeps BotID (isUnwantedBot) ahead of any history read", bot >= 0 && read > bot);
  want("/api/history switches on HISTORY, keeping its own FMP read as the fallback",
    /await historyForSurface\("HISTORY", symbol, \(\) =>\s*getDailyHistory\(symbol, \{ caller: "api-history" \}\)\s*\)/.test(route));
  want("/api/history keeps the same d/w/m roll-up and the {symbol, interval, points} shape",
    /const points = carryPartialLabel\(daily, aggregate\(daily, interval\)\);/.test(route) &&
    /symbol,\s*interval,\s*points: points\.slice\(-days\),/.test(route) &&
    /Math\.max\(30, Math\.min\(5000, /.test(route));
  want("/api/history is still in BotID's protect list", /\{ path: "\/api\/history", method: "GET" \}/.test(code[FILES.botid]));
  want("/api/quote keeps Deep Analysis and its quote-token gate",
    /await isUnwantedBot\("deepAnalysis"\)/.test(code[FILES.quoteRoute]) && /= verifyQuoteToken\(/.test(code[FILES.quoteRoute]));
  want("robots.txt still disallows /api/", /userAgent: "\*",[\s\S]{0,80}disallow: \["\/api\/"\]/.test(code[FILES.robots]));

  const apiFiles = Object.keys(code).filter((f) => f.startsWith("app/api/"));
  want(`the API routes were found (${apiFiles.length})`, apiFiles.length >= 40);
  const cors = Object.keys(code).filter((f) => /Access-Control-Allow-/i.test(code[f]));
  want(`no CORS opening anywhere (${cors.join(", ") || "none"})`, cors.length === 0);
  const dl = apiFiles.filter((f) => /Content-Disposition|text\/csv|\.xlsx\b/i.test(code[f]));
  want(`no download or CSV/Excel response from an API route (${dl.join(", ") || "none"})`, dl.length === 0);
  const tiingoRoutes = apiFiles.filter((f) => /\/route\.ts$/.test(f) && !f.startsWith("app/api/jobs/") && TIINGO_READ.test(code[f]));
  const extra = tiingoRoutes.filter((f) => !TIINGO_API_ROUTES.has(f));
  want(`no new API route reads Tiingo data (${extra.join(", ") || "none"})`, extra.length === 0 && tiingoRoutes.includes(FILES.route));

  // The stock page: both SSR history reads on CHARTS, nothing read around it.
  const sp = code[FILES.stockPage];
  const reads = (sp.match(/getDailyHistory\(upper/g) ?? []).length;
  const gated = (sp.match(/historyForSurface\("CHARTS", upper, \(\) => getDailyHistory\(upper/g) ?? []).length;
  want(`the stock page's two SSR history reads both switch on CHARTS (${gated}/${reads})`, reads === 2 && gated === 2);
  want("the stock page hands the credit down only when a shown series can be Tiingo's (the seed, or the HISTORY fallback)",
    /historyCredit=\{\s*historyResult\.provider === "tiingo" \|\| historyOnTiingo\("HISTORY"\) \?/.test(sp));
  want("the stock page tells the client whose bars the seed is", /historyProvider=\{historyResult\.provider\}/.test(sp));
  // The dashboard seed: HISTORY, the same gate as the route it refetches from.
  const dp = code[FILES.dashPage];
  want("the dashboard's SSR seed switches on HISTORY",
    /historyForSurface\("HISTORY", symbol, \(\) => getDailyHistory\(symbol, \{ caller: "dashboard" \}\)\)/.test(dp) &&
    (dp.match(/getDailyHistory\(symbol/g) ?? []).length === 1);
  want("the dashboard shows the credit under the chart", /historyCredit=\{\s*historyOnTiingo\("HISTORY"\) \?/.test(dp) && /\{historyCredit\}/.test(code[FILES.dashClient]));

  // COWORK #103 nit: the dashboard credit follows the provider of the series
  // SHOWN (seed, each refetch, a cache hit, the interactive chart's own fetch),
  // not the gate: a Tiingo miss that fell back to FMP shows no credit.
  const dc = code[FILES.dashClient];
  want("the dashboard credit is shown only while the series shown is Tiingo's",
    /\{historyCredit && historyProvider === "tiingo" && chartMode !== "tradingview" \? \(/.test(dc));
  want("the dashboard's seed provider comes from the server read",
    /initialHistoryProvider=\{rawHistory\.provider\}/.test(dp) && /\(h\) => \(\{ points: h\.points as Point\[\], provider: h\.provider as string \}\)/.test(dp) &&
    /useState<string \| null>\(\(\) => \(seedMatchesSymbol \? initialHistoryProvider : null\)\)/.test(dc));
  want("each dashboard refetch sets the provider from /api/history's answer, and caches it",
    /const prov = typeof h\.provider === "string" \? h\.provider : null;/.test(dc) &&
    /setHistoryAll\(pts\); setHistoryProvider\(prov\); setSymbolCache\(prev => \(\{ \.\.\.prev, \[ck\]: \{ quote: q, history: pts, provider: prov \} \}\)\);/.test(dc));
  want("a dashboard cache hit restores its own provider", /setHistoryAll\(hit\.history\); setHistoryProvider\(hit\.provider \?\? null\);/.test(dc));
  want("the interactive chart reports the provider of the bars it fetched itself",
    /<InteractiveChart [^>]*onProvider=\{setHistoryProvider\}/.test(dc) &&
    /onProvider\?\.\(typeof json\?\.provider === "string" \? json\.provider : null\);/.test(code[FILES.interactive]));

  // The client: the toggle's inputs are unchanged (#89: no data or calculation change).
  const sc = code[FILES.stockClient];
  // #553 COWORK #115: the same windows (20 daily, 12 weekly), now from
  // lib/closeReturns.ts with end-of-period labels, plus 12 complete months.
  want("the returns inputs: 20 daily, 12 weekly, 12 monthly, from the page's own bars",
    /const dailyReturns = useMemo\(\(\) => dailyReturnBars\(history, 20\), \[history\]\);/.test(sc) &&
    /const weeklyReturns = useMemo\(\(\) => weeklyReturnBars\(history, 12\), \[history\]\);/.test(sc) &&
    /const monthlyReturns = useMemo\(\(\) => monthlyReturnBars\(history, 12\), \[history\]\);/.test(sc));
  want("one toggle card, Daily first, and no second returns chart beside it",
    (sc.match(/<ReturnsToggleCard /g) ?? []).length === 1 && /daily=\{dailyReturns\} weekly=\{weeklyReturns\} monthly=\{monthlyReturns\}/.test(sc) && !/<ReturnsBarChart /.test(sc));
  // RE-ANCHORED for C's Price levels ladder (#563 COWORK #68), which replaced the
  // indicator rows: the same intent, a short history hands its reason to the MA,
  // and the ladder prints it ("MA200: Not enough price history stored yet").
  want("the MA rows say why on a short history, not a bare \"—\"",
    /ma200Missing=\{closes\.length && closes\.length < 200 \? SHORT_HISTORY_NOTE : null\}/.test(sc) &&
    /ma50Missing=\{closes\.length && closes\.length < 50 \? SHORT_HISTORY_NOTE : null\}/.test(sc) &&
    /<LevelsSignals\s/.test(sc));
  // COWORK #103 nit: keyed on the provider of the series shown, so a
  // client-fetched Tiingo chart is credited and a seeded FMP one is not.
  want("the stock chart is given the credit only while the series shown is Tiingo's",
    /credit=\{shownProvider === "tiingo" \? historyCredit : null\}/.test(sc));
  want("the stock chart's provider starts as the seed's",
    /const \[shownProvider, setShownProvider\] = useState<string \| null>\(seededHistory \? historyProvider \?\? null : null\);/.test(sc));
  want("the stock page's client fetch takes the provider from /api/history's answer",
    /if \(cancelled\) return;\s*setShownProvider\(typeof data\.provider === "string" \? data\.provider : null\);/.test(sc));

  // COWORK #103: the Tiingo `days` cap is exactly the most any chart asks for,
  // and every /api/history caller can pass the same-origin check without
  // Fetch Metadata (it sends the page token).
  const cap = Number(/export const TIINGO_HISTORY_MAX_DAYS = (\d+);/.exec(code[FILES.helper])?.[1]);
  const callers = [];
  for (const [f, c] of Object.entries(code)) {
    if (!f.startsWith("app/") || f.startsWith("app/api/")) continue;
    let i = -1;
    while ((i = c.indexOf("/api/history?", i + 1)) >= 0) {
      const win = c.slice(i, i + 420);
      let days = [];
      const lit = /days=(\d+)/.exec(win);
      if (lit) days = [Number(lit[1])];
      else if (/days=\$\{selectedTimeframe\.fetchBars\}/.test(win)) days = [...c.matchAll(/fetchBars: (\d+)/g)].map((m) => Number(m[1]));
      callers.push({ f, days, token: /"x-msh-page-token": pageToken/.test(win) });
    }
  }
  const unknown = callers.filter((x) => !x.days.length).map((x) => x.f);
  want(`the /api/history callers were found, each with a known days (${callers.length}; unknown: ${unknown.join(", ") || "none"})`,
    callers.length >= 3 && unknown.length === 0 && [FILES.dashClient, FILES.stockClient, FILES.interactive].every((f) => callers.some((x) => x.f === f)));
  const most = Math.max(0, ...callers.flatMap((x) => x.days));
  want(`the Tiingo days cap (${cap}) is the most any chart requests (${most})`, Number.isFinite(cap) && cap === most);
  const tokenless = callers.filter((x) => !x.token).map((x) => x.f);
  want(`every /api/history caller sends the page token (${tokenless.join(", ") || "all do"})`, tokenless.length === 0);
  return fails;
}

const ALL = [...walk("app"), ...walk("lib"), "instrumentation-client.ts", "middleware.ts", "next.config.ts", "vercel.json"].filter((f) => fs.existsSync(path.join(ROOT, f)));
const srcs = Object.fromEntries(ALL.map((f) => [f, raw(f)]));
for (const f of Object.values(FILES)) srcs[f] ??= raw(f);
report("step 3's gates and the #72 limits hold", rules(srcs));

// ── 6. Static mutants ─────────────────────────────────────────────────────
console.log("\n=== 6. Static mutants ===\n");
const MUTANTS = [
  ["BotID dropped from /api/history", FILES.route, /if \(await isUnwantedBot\(\)\) \{/, "if (false) {"],
  ["/api/history taken out of BotID's protect list", FILES.botid, /\{ path: "\/api\/history", method: "GET" \},/, ""],
  ["/api/quote downgraded to Basic", FILES.quoteRoute, /isUnwantedBot\("deepAnalysis"\)/, "isUnwantedBot()"],
  ["robots.txt opens /api/", FILES.robots, /disallow: \["\/api\/"\],/, "disallow: [],"],
  ["a CORS header on /api/history", FILES.route, /: getCacheControlHeader\(\),/, ': getCacheControlHeader(), "Access-Control-Allow-Origin": "*",'],
  ["a CSV download from /api/history", FILES.route, /: getCacheControlHeader\(\),/, ': getCacheControlHeader(), "Content-Disposition": "attachment; filename=history.csv",'],
  ["/api/history on the CHARTS gate", FILES.route, /historyForSurface\("HISTORY", /, 'historyForSurface("CHARTS", '],
  ["/api/history's monthly roll-up dropped", FILES.route, /const points = carryPartialLabel\(daily, aggregate\(daily, interval\)\);/, "const points = daily;"],
  // The read now carries the cold-fill option (#553 COWORK #121), so the mutant takes the whole call.
  ["the stock page's metadata read left on FMP", FILES.stockPage, /historyForSurface\("CHARTS", upper, \(\) => getDailyHistory\(upper, \{ caller: "stock-page" \}\), \{[\s\S]*?\}\)/, 'getDailyHistory(upper, { caller: "stock-page" })'],
  ["the stock page hands the credit down whatever the provider", FILES.stockPage, /historyResult\.provider === "tiingo" \|\| historyOnTiingo\("HISTORY"\) \?/, "true ?"],
  ["the stock page passes no seed provider", FILES.stockPage, /historyProvider=\{historyResult\.provider\}/, ""],
  ["the stock chart credited by the seed, not the provider (COWORK #103)", FILES.stockClient, /credit=\{shownProvider === "tiingo" \? historyCredit : null\}/, "credit={seededHistory ? historyCredit : null}"],
  ["the stock client ignores the fetched provider", FILES.stockClient, /setShownProvider\(typeof data\.provider === "string" \? data\.provider : null\);/, ""],
  ["the stock chart's provider starts as Tiingo whatever the seed", FILES.stockClient, /useState<string \| null>\(seededHistory \? historyProvider \?\? null : null\)/, 'useState<string | null>("tiingo")'],
  ["the dashboard credit keyed on the gate, not the provider (COWORK #103)", FILES.dashClient, /historyCredit && historyProvider === "tiingo" && chartMode/, "historyCredit && chartMode"],
  ["a dashboard refetch keeps the previous provider", FILES.dashClient, /setHistoryProvider\(prov\); /, ""],
  ["a dashboard cache hit keeps the previous provider", FILES.dashClient, /setHistoryProvider\(hit\.provider \?\? null\); /, ""],
  ["the dashboard seed's provider not passed", FILES.dashPage, /initialHistoryProvider=\{rawHistory\.provider\}/, ""],
  ["the interactive chart does not report its provider", FILES.interactive, /onProvider\?\.\(typeof json\?\.provider === "string" \? json\.provider : null\);/, ""],
  ["a chart asks for more than the Tiingo cap", FILES.dashClient, /fetchBars: 2600/, "fetchBars: 3000"],
  ["the interactive chart asks for more than the cap", FILES.interactive, /days=2000/, "days=4000"],
  ["the Tiingo cap raised past what the charts use", FILES.helper, /TIINGO_HISTORY_MAX_DAYS = 2600;/, "TIINGO_HISTORY_MAX_DAYS = 5000;"],
  ["the stock page's history fetch sends no page token", FILES.stockClient, /&days=900`, pageToken \? \{ headers: \{ "x-msh-page-token": pageToken \} \} : undefined\)/, "&days=900`)"],
  ["the dashboard seed left on FMP", FILES.dashPage, /historyForSurface\("HISTORY", symbol, \(\) => getDailyHistory\(symbol, \{ caller: "dashboard" \}\)\)/, 'getDailyHistory(symbol, { caller: "dashboard" })'],
  ["the weekly input window changed", FILES.stockClient, /weeklyReturnBars\(history, 12\)/, "weeklyReturnBars(history, 20)"],
  ["the monthly view not handed to the card", FILES.stockClient, / monthly=\{monthlyReturns\}/, ""],
  ["the old second returns card restored", FILES.stockClient, /<ReturnsToggleCard /, '<ReturnsBarChart symbol={symbol} periodLabel="Weekly" compareLabel="x" bars={weeklyReturns} /><ReturnsToggleCard '],
  ["a bare \"—\" on a short MA200", FILES.stockClient, /ma200Missing=\{closes\.length && closes\.length < 200 \? SHORT_HISTORY_NOTE : null\}/, "ma200Missing={null}"],
];
for (const [label, file, from, to] of MUTANTS) {
  const m = srcs[file].replace(from, to);
  if (m === srcs[file]) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  const fails = rules({ ...srcs, [file]: m });
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}
{
  const planted = { ...srcs, "app/api/history-export/route.ts": 'import { readTiingoHistory } from "@/lib/server/marketData/read";\nexport async function GET() { return Response.json(await readTiingoHistory("AAPL")); }\n' };
  const fails = rules(planted);
  check('mutant "a new API route serving Tiingo history" is caught', fails.length > 0, fails[0] ?? "no assertion failed");
}

// ── 7. /api/history on the Tiingo path: the REAL handler, stubbed I/O ─────
// COWORK #103. The route file and the helper are the shipped sources; only
// their I/O is swapped, by rewriting three import specifiers in a temp copy:
// BotID (isUnwantedBot), the FMP read (getDailyHistory) and the Data Cache
// reader that historyForSurface uses (injected through its own `readInputs`
// seam). next/server is the real one.
console.log("\n=== 7. /api/history on the Tiingo path, the real route handler ===\n");

const ROUTE_TMP = path.join(ROOT, "scripts", `.check-step3-route-${process.pid}`);
const ROUTE_DIR = path.join(ROOT, "app/api/history");
const HELPER_DIR = path.join(ROOT, "lib/server");
const QT = await import(pathToFileURL(path.join(ROOT, "lib/server/quoteToken.ts")).href);
const HELPER_REAL_SRC = raw(FILES.helper);
const ROUTE_SRC = raw(FILES.route);

// A long Tiingo series, so the cap has something to cut: 3,000 stored bars.
const LONG_BARS = Array.from({ length: 3000 }, (_, i) => {
  const d = new Date(Date.UTC(2014, 0, 1) + i * 86400000).toISOString().slice(0, 10);
  return bar(d, 100 + (i % 11), 1000 + i);
});
const LONG_FMP = LONG_BARS.map((b) => ({ date: b[0], close: b[4] - 0.01, volume: 7 }));

const STUB = (globalThis.__step3Route = { bot: false, inputs: null, fmp: LONG_FMP, fmpThrows: false, fmpCalls: 0, reads: 0 });
let routeN = 0;
const routeTemps = [];

/** Import a temp copy of `routeSrc` whose helper is `helperSrc`, I/O stubbed. Returns its GET. */
async function loadRoute(routeSrc, helperSrc) {
  fs.mkdirSync(ROUTE_TMP, { recursive: true });
  const n = `${process.pid}-${++routeN}`;
  const helperFile = path.join(HELPER_DIR, `.check-step3-route-helper-${n}.ts`);
  fs.writeFileSync(helperFile, helperSrc);
  const helperUrl = pathToFileURL(helperFile).href;
  const bot = path.join(ROUTE_TMP, `bot-${n}.mjs`);
  fs.writeFileSync(bot, "export async function isUnwantedBot() { return globalThis.__step3Route.bot; }\n");
  const fmp = path.join(ROUTE_TMP, `fmp-${n}.mjs`);
  fs.writeFileSync(fmp, [
    "export async function getDailyHistory() {",
    "  const s = globalThis.__step3Route; s.fmpCalls++;",
    "  if (s.fmpThrows) throw new Error('fmp down');",
    "  return s.fmp;",
    "}",
  ].join("\n"));
  const helper = path.join(ROUTE_TMP, `helper-${n}.mjs`);
  fs.writeFileSync(helper, [
    `import * as real from ${JSON.stringify(helperUrl)};`,
    `export * from ${JSON.stringify(helperUrl)};`,
    "export function historyForSurface(surface, symbol, fmp, deps = {}) {",
    "  return real.historyForSurface(surface, symbol, fmp, { ...deps, readInputs: async () => { const s = globalThis.__step3Route; s.reads++; return s.inputs; } });",
    "}",
  ].join("\n"));
  const swaps = [
    ['"@/lib/botid-guard"', JSON.stringify(pathToFileURL(bot).href)],
    ['"../../../lib/server/historyCache"', JSON.stringify(pathToFileURL(fmp).href)],
    ['"@/lib/server/tiingoHistory"', JSON.stringify(pathToFileURL(helper).href)],
    ['"next/server"', '"next/server.js"'],
  ];
  let src = routeSrc;
  for (const [from, to] of swaps) {
    if (!src.includes(from)) throw new Error(`route import ${from} not found`);
    src = src.replaceAll(from, to);
  }
  const routeFile = path.join(ROUTE_DIR, `.check-step3-route-${n}.ts`);
  fs.writeFileSync(routeFile, src);
  routeTemps.push(routeFile, helperFile);
  return (await import(pathToFileURL(routeFile).href)).GET;
}

const ENV_KEYS = ["PRICE_PROVIDER_HISTORY", "FMP_API_KEY", "QUOTE_TOKEN_SECRET"];
const SAVED_ENV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const setEnv = (env) => {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
};

/** One request through GET. Returns status, headers, body and the I/O counts. */
async function call(GET, { env, headers = {}, query = "symbol=abc&days=5000", inputs = null, bot = false, fmpThrows = false }) {
  setEnv(env);
  Object.assign(STUB, { bot, inputs, fmpThrows, fmpCalls: 0, reads: 0 });
  const res = await GET(new Request(`https://example.test/api/history?${query}`, { headers }));
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, cc: res.headers.get("cache-control") ?? "", body, text, fmpCalls: STUB.fmpCalls, reads: STUB.reads };
}

const TIINGO = { PRICE_PROVIDER_HISTORY: "tiingo", FMP_API_KEY: "x" };
const FMP_GATE = { FMP_API_KEY: "x" };
const SAME = { "sec-fetch-site": "same-origin" };
const HIT_LONG = { row: null, bars: LONG_BARS };
const NO_STORE = "private, no-store";
const PUBLIC_OK = /^public, s-maxage=(900|3600), stale-while-revalidate=(900|3600)$/;
const PUBLIC_ERR = "public, s-maxage=60, stale-while-revalidate=300";
const hasBars = (r) => Array.isArray(r.body?.points) || /"close"/.test(r.text);

/** The COWORK #103 rules over one route + helper pair. Returns failure labels. */
async function routeFails(routeSrc, helperSrc) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  let GET;
  try { GET = await loadRoute(routeSrc, helperSrc); } catch (e) { return [`the route loads (${e.message})`]; }
  const H2 = await import(pathToFileURL(routeTemps[routeTemps.length - 1]).href);
  const CAP = H2.TIINGO_HISTORY_MAX_DAYS;

  // Tiingo path, same-origin: private, no-store; days capped; provider named.
  let r = await call(GET, { env: TIINGO, headers: SAME, inputs: HIT_LONG });
  want(`[tiingo] a same-origin request is answered 200 (${r.status})`, r.status === 200);
  want(`[tiingo] Cache-Control is "${NO_STORE}" (${r.cc})`, r.cc === NO_STORE);
  want(`[tiingo] days=5000 is capped at ${CAP} (${r.body?.points?.length} bars)`, CAP === 2600 && r.body?.points?.length === CAP);
  want(`[tiingo] the newest bar is kept when capping (${r.body?.points?.at?.(-1)?.date})`, r.body?.points?.at?.(-1)?.date === LONG_BARS[LONG_BARS.length - 1][0]);
  want(`[tiingo] the answer names its provider, "tiingo" (${r.body?.provider})`, r.body?.provider === "tiingo");
  r = await call(GET, { env: TIINGO, headers: SAME, inputs: HIT_LONG, query: "symbol=abc&days=abc" });
  want(`[tiingo] a junk days is the default 365, never "all" (${r.body?.points?.length})`, r.body?.points?.length === 365);
  r = await call(GET, { env: TIINGO, headers: SAME, inputs: HIT_LONG, query: "symbol=abc&days=900" });
  want(`[tiingo] a chart's own request (days=900) is served whole (${r.body?.points?.length})`, r.body?.points?.length === 900);
  r = await call(GET, { env: TIINGO, headers: SAME, inputs: HIT_LONG, query: "symbol=abc&days=2600&interval=w" });
  want(`[tiingo] the weekly roll-up is still served, no-store (${r.status}, ${r.cc})`, r.status === 200 && r.cc === NO_STORE && r.body?.interval === "w" && r.body.points.length > 400 && r.body.points.length < 450);

  // Tiingo path, not same-origin: 403, no bars, nothing read.
  for (const [label, headers] of [
    ["cross-site", { "sec-fetch-site": "cross-site" }],
    ["same-site", { "sec-fetch-site": "same-site" }],
    ["a typed-in URL (Sec-Fetch-Site: none)", { "sec-fetch-site": "none" }],
    ["a plain curl (no Fetch Metadata, no token)", {}],
  ]) {
    r = await call(GET, { env: TIINGO, headers, inputs: HIT_LONG });
    want(`[tiingo] ${label}: 403 (${r.status})`, r.status === 403);
    want(`[tiingo] ${label}: no bars in the body`, !hasBars(r));
    want(`[tiingo] ${label}: nothing read (Tiingo ${r.reads}, FMP ${r.fmpCalls})`, r.reads === 0 && r.fmpCalls === 0);
    want(`[tiingo] ${label}: the 403 is no-store too (${r.cc})`, r.cc === NO_STORE);
  }

  // The page token: counts only when it verifies.
  const secret = `check-${process.pid}-${Math.random().toString(36).slice(2)}`;
  setEnv({ ...TIINGO, QUOTE_TOKEN_SECRET: secret });
  const good = QT.mintQuoteToken();
  r = await call(GET, { env: { ...TIINGO, QUOTE_TOKEN_SECRET: secret }, headers: { "x-msh-page-token": good }, inputs: HIT_LONG });
  want(`[tiingo] no Fetch Metadata but a valid page token: 200 (${r.status})`, good.length > 0 && r.status === 200 && r.body?.points?.length === CAP);
  r = await call(GET, { env: { ...TIINGO, QUOTE_TOKEN_SECRET: secret }, headers: { "x-msh-page-token": `${good}x` }, inputs: HIT_LONG });
  want(`[tiingo] a forged page token: 403 (${r.status})`, r.status === 403 && !hasBars(r));
  r = await call(GET, { env: TIINGO, headers: { "x-msh-page-token": "anything" }, inputs: HIT_LONG });
  want(`[tiingo] a token while QUOTE_TOKEN_SECRET is unset proves nothing: 403 (${r.status})`, r.status === 403 && !hasBars(r));

  // BotID still runs on the Tiingo path.
  r = await call(GET, { env: TIINGO, headers: SAME, inputs: HIT_LONG, bot: true });
  want(`[tiingo] BotID still blocks a same-origin bot (${r.status})`, r.status === 403 && !hasBars(r) && r.reads === 0);
  want(`[tiingo] the BotID 403 is no-store too (${r.cc})`, r.cc === NO_STORE);

  // A Tiingo miss falls back to FMP: still no-store, and it says "fmp".
  r = await call(GET, { env: TIINGO, headers: SAME, inputs: { row: null, bars: null } });
  want(`[tiingo] a miss: FMP's bars, provider "fmp", still no-store (${r.body?.provider}, ${r.cc})`,
    r.status === 200 && r.body?.provider === "fmp" && r.fmpCalls === 1 && r.cc === NO_STORE && r.body.points.length === CAP);
  r = await call(GET, { env: TIINGO, headers: SAME, inputs: { row: null, bars: null }, fmpThrows: true });
  want(`[tiingo] an error answer is no-store too (${r.status}, ${r.cc})`, r.status === 500 && r.cc === NO_STORE);

  // FMP path (gate unset): exactly as before. Public tiered s-maxage, the 5000
  // clamp, no origin check, no provider field, Tiingo never read.
  r = await call(GET, { env: FMP_GATE, headers: {}, inputs: HIT_LONG });
  want(`[fmp] a plain request is still 200 with no origin check (${r.status})`, r.status === 200);
  want(`[fmp] Cache-Control unchanged: public, tiered s-maxage (${r.cc})`, PUBLIC_OK.test(r.cc));
  want(`[fmp] the 5000 clamp unchanged: all ${LONG_FMP.length} bars (${r.body?.points?.length})`, r.body?.points?.length === LONG_FMP.length);
  want(`[fmp] the body is unchanged: {symbol, interval, points} only (${Object.keys(r.body ?? {}).join(",")})`, Object.keys(r.body ?? {}).join(",") === "symbol,interval,points");
  want(`[fmp] Tiingo never read, FMP read once (${r.reads}/${r.fmpCalls})`, r.reads === 0 && r.fmpCalls === 1);
  r = await call(GET, { env: FMP_GATE, headers: { "sec-fetch-site": "cross-site" }, inputs: HIT_LONG, query: "symbol=abc&days=10" });
  want(`[fmp] a cross-site request is unchanged (200), min clamp 30 (${r.status}, ${r.body?.points?.length})`, r.status === 200 && r.body?.points?.length === 30);
  r = await call(GET, { env: FMP_GATE, headers: {}, fmpThrows: true });
  want(`[fmp] the error header unchanged (${r.cc})`, r.status === 500 && r.cc === PUBLIC_ERR);
  return fails;
}

try {
  report("/api/history on the Tiingo path: no-store, capped, same-origin only; the FMP path unchanged", await routeFails(ROUTE_SRC, HELPER_REAL_SRC));

  const ROUTE_MUTANTS = [
    ["the Tiingo path keeps the public s-maxage", "route", /onTiingo \? TIINGO_HISTORY_CACHE_CONTROL : getCacheControlHeader\(\)/, "getCacheControlHeader()"],
    ["the Tiingo error answer is public", "route", /onTiingo \? TIINGO_HISTORY_CACHE_CONTROL : getErrorCacheControlHeader\(\)/, "getErrorCacheControlHeader()"],
    ["the Tiingo 403 is shared-cacheable", "route", /status: 403, headers: \{ "Cache-Control": TIINGO_HISTORY_CACHE_CONTROL \}/, 'status: 403, headers: { "Cache-Control": "public, s-maxage=900" }'],
    ["the Tiingo BotID 403 is shared-cacheable", "route", /onTiingo \? \{ status: 403, headers: \{ "Cache-Control": TIINGO_HISTORY_CACHE_CONTROL \} \} : \{ status: 403 \}/, "{ status: 403 }"],
    ["days not clamped on the Tiingo path", "route", /\? tiingoHistoryDays\(searchParams\.get\("days"\)\)/, '? Math.max(30, Math.min(5000, Number(searchParams.get("days") || "365")))'],
    ["the same-origin check dropped", "route", /if \(onTiingo && !historyRequestSameOrigin\(req\.headers\)\.ok\) \{/, "if (false) {"],
    ["the same-origin check applied to the FMP path too", "route", /if \(onTiingo && !historyRequestSameOrigin\(req\.headers\)\.ok\) \{/, "if (!historyRequestSameOrigin(req.headers).ok) {"],
    ["the FMP path made no-store", "route", /onTiingo \? TIINGO_HISTORY_CACHE_CONTROL : getCacheControlHeader\(\)/, "TIINGO_HISTORY_CACHE_CONTROL"],
    ["the Tiingo answer names no provider", "route", /\.\.\.\(onTiingo \? \{ provider \} : \{\}\),/, ""],
    ["the FMP body gains a provider field", "route", /\.\.\.\(onTiingo \? \{ provider \} : \{\}\),/, "provider,"],
    ["the cap raised to the old 5000", "helper", /Math\.min\(TIINGO_HISTORY_MAX_DAYS, /, "Math.min(5000, "],
    ["a junk days serves everything", "helper", /\n\s*if \(!Number\.isFinite\(n\)\) return TIINGO_HISTORY_DEFAULT_DAYS;/, ""],
    ["any Sec-Fetch-Site accepted", "helper", /headers\.get\("sec-fetch-site"\) === "same-origin"/, 'headers.get("sec-fetch-site") !== "cross-site"'],
    ["a missing Sec-Fetch-Site accepted", "helper", /headers\.get\("sec-fetch-site"\) === "same-origin"/, '(headers.get("sec-fetch-site") ?? "same-origin") === "same-origin"'],
    ["an unconfigured page token counts as proof", "helper", /verifyQuoteToken\(headers\.get\(QUOTE_TOKEN_HEADER\)\)\.reason === "valid"/, "verifyQuoteToken(headers.get(QUOTE_TOKEN_HEADER)).ok"],
    ["the page token ignored", "helper", /\n\s*if \(verifyQuoteToken\(headers\.get\(QUOTE_TOKEN_HEADER\)\)\.reason === "valid"\) return \{ ok: true, via: "page-token" \};/, ""],
  ];
  for (const [label, which, from, to] of ROUTE_MUTANTS) {
    const base = which === "route" ? ROUTE_SRC : HELPER_REAL_SRC;
    const m = base.replace(from, to);
    if (m === base) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
    const fails = which === "route" ? await routeFails(m, HELPER_REAL_SRC) : await routeFails(ROUTE_SRC, m);
    check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
  }
} finally {
  setEnv({});
  for (const [k, v] of Object.entries(SAVED_ENV)) if (v !== undefined) process.env[k] = v;
  for (const f of routeTemps) fs.rmSync(f, { force: true });
  fs.rmSync(ROUTE_TMP, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
