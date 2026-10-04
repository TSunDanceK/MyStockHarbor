// The Price Action card's Monthly view and end-of-period labels (#553 COWORK #115).
//
// What must hold:
//   1. lib/closeReturns.ts: daily/weekly windows unchanged in length and math;
//      labels name the END of each period ("2 Oct", "week to 2 Oct", "Sep 2026");
//      a month is complete only when its last session reaches the month's last
//      weekday; the month in progress is kept apart, measured against the last
//      complete month's close.
//   2. The card: a Monthly tab with "previous month's close"; by default the
//      month in progress is left out with a line saying so; in "show" mode it is
//      drawn as "Oct so far", lighter and dashed; the tiles count complete months
//      only in both; ?monthPartial=show applies on a preview deployment only.
// Each rule also gets a planted mutant.
//
//   node scripts/check-returns-monthly.mjs
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = process.cwd();
const raw = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const LIB = "lib/closeReturns.ts";
const TOGGLE = "app/components/ReturnsToggleCard.tsx";
const CHART = "app/components/ReturnsBarChart.tsx";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

let seq = 0;
async function loadLib(src) {
  const tmp = path.join(ROOT, "lib", `.check-rm-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(tmp, src);
  try { return await import(pathToFileURL(tmp).href); } finally { fs.rmSync(tmp, { force: true }); }
}
const TMP_DIR = path.join(ROOT, "scripts", `.check-rm-render-${process.pid}`);
async function importTsx(files, entry) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const tag = `${++seq}`;
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

// Weekday sessions from 2025-08-01 to `end`, closes rising 1 a session from 100.
function sessions(end) {
  const out = [];
  const d = new Date(Date.UTC(2025, 7, 1));
  let c = 100;
  while (d.toISOString().slice(0, 10) <= end) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push({ date: d.toISOString().slice(0, 10), close: c++ });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// ── 1. The pure series ────────────────────────────────────────────────────
console.log("\n=== 1. lib/closeReturns.ts ===\n");
async function libRules(L) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const mid = sessions("2026-10-02"); // Fri 2 Oct: October in progress
  const daily = L.dailyReturnBars(mid, 20);
  want("daily: 20 bars, labelled by the session's own date (\"2 Oct\")", daily.length === 20 && daily[19].label === "2 Oct" && daily[19].date === "2026-10-02");
  const lastTwo = mid.slice(-2);
  want("daily: close vs the previous session's close", Math.abs(daily[19].changePercent - ((lastTwo[1].close - lastTwo[0].close) / lastTwo[0].close) * 100) < 1e-9);
  const weekly = L.weeklyReturnBars(mid, 12);
  want("weekly: 12 bars, labelled by the week's LAST session (\"week to 2 Oct\", not the Monday)",
    weekly.length === 12 && weekly[11].label === "week to 2 Oct" && weekly[10].label === "week to 25 Sep");
  const m = L.monthlyReturnBars(mid, 12);
  want("monthly: 12 complete months, labelled by month, ending Sep 2026", m.complete.length === 12 && m.complete[11].label === "Sep 2026" && m.complete[0].label === "Oct 2025");
  const sepEnd = mid.filter((p) => p.date <= "2026-09-30").at(-1);
  const augEnd = mid.filter((p) => p.date <= "2026-08-31").at(-1);
  want("monthly: a month's last close vs the previous month's", Math.abs(m.complete[11].changePercent - ((sepEnd.close - augEnd.close) / augEnd.close) * 100) < 1e-9);
  want("monthly: October in progress is kept apart, against September's close, marked partial",
    m.partial?.label === "Oct so far" && m.partial.partial === true && m.partialMonth === "October" &&
    Math.abs(m.partial.changePercent - ((mid.at(-1).close - sepEnd.close) / sepEnd.close) * 100) < 1e-9);
  const done = L.monthlyReturnBars(sessions("2026-09-30"), 12);
  want("monthly: a month whose last session is its last weekday is complete (no partial)", done.partial === null && done.complete.at(-1).label === "Sep 2026");
  want("the last weekday of a month skips the weekend (Oct 2026 -> Fri 30th; Aug 2026 -> Mon 31st)",
    L.lastWeekdayOf("2026-10") === "2026-10-30" && L.lastWeekdayOf("2026-08") === "2026-08-31" && L.lastWeekdayOf("2026-05") === "2026-05-29");
  want("junk points (bad date, zero close) are skipped", L.dailyReturnBars([{ date: "x", close: 1 }, { date: "2026-01-02", close: 0 }, { date: "2026-01-05", close: 10 }, { date: "2026-01-06", close: 11 }], 5).length === 1);
  return fails;
}
const LIB_SRC = raw(LIB);
const L = await loadLib(LIB_SRC);
const lFails = await libRules(L);
for (const f of lFails) check(f, false);
check("the series: windows, math, end-of-period labels, the month in progress kept apart", lFails.length === 0);
for (const [label, from, to] of [
  ["the weekly label back on the Monday", /\(p\) => `week to \$\{dayLabel\(p\.end\)\}`/, "(p) => `week to ${dayLabel(p.key)}`"],
  ["the month in progress counted as complete", /const inProgress = !!last && last\.end < lastWeekdayOf\(last\.key\);/, "const inProgress = false;"],
  ["the partial measured against itself", /const prev = complete\[complete\.length - 1\]\.close;/, "const prev = last.close;"],
]) {
  const m = LIB_SRC.replace(from, to);
  if (m === LIB_SRC) { check(`mutant "${label}" applies`, false, "matched nothing"); continue; }
  const fails = await libRules(await loadLib(m));
  check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
}

// ── 2. The card ───────────────────────────────────────────────────────────
console.log("\n=== 2. The Monthly tab ===\n");
const mid = sessions("2026-10-02");
const INPUT = {
  daily: L.dailyReturnBars(mid, 20),
  weekly: L.weeklyReturnBars(mid, 12),
  monthly: L.monthlyReturnBars(mid, 12),
};
async function cardRules(toggleSrc, chartSrc) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const Mod = await importTsx({ ReturnsBarChart: chartSrc, ReturnsToggleCard: toggleSrc }, "ReturnsToggleCard");
  const render = (partialMode) => renderToStaticMarkup(React.createElement(Mod.ReturnsToggleView, { symbol: "AAPL", ...INPUT, partialMode, active: "monthly", idBase: "m" }));
  const omit = render("omit");
  const show = render("show");
  const panel = (html) => html.slice(html.indexOf('id="m-panel-monthly"'));
  want("a Monthly tab exists, third", /id="m-tab-daily"[\s\S]*id="m-tab-weekly"[\s\S]*id="m-tab-monthly"/.test(omit));
  want("the heading reads \"AAPL close vs previous month's close\"", /AAPL close vs previous month(&#x27;|')s close/.test(panel(omit)));
  want("omit: the month in progress is not drawn, and a line says so", !/Oct so far/.test(panel(omit)) && /October so far isn(&#x27;|')t included\./.test(panel(omit)));
  want("show: it is drawn as \"Oct so far\", lighter and dashed, with no \"isn't included\" line",
    /Oct so far: [+-][\d.]+% \(month in progress\)/.test(panel(show)) && /fill-opacity="0\.35"/.test(panel(show)) && /stroke-dasharray="3 2"/.test(panel(show)) && !/isn(&#x27;|')t included/.test(panel(show)));
  const tile = (html) => /Latest monthly change[^<]*<\/div><div[^>]*>([^<]+)</.exec(panel(html))?.[1];
  const sep = INPUT.monthly.complete.at(-1).changePercent;
  const fmt = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
  want("the tiles count complete months only, in both modes (latest = Sep 2026)", tile(omit) === fmt(sep) && tile(show) === fmt(sep));
  want("show: the tile names which month it is (\"(Sep 2026)\")", /Latest monthly change \(Sep 2026\)/.test(panel(show)));
  want("the preview switch: ?monthPartial=show applies on a *.vercel.app preview only",
    Mod.partialModeFor("mystockharbor-git-x-tsundanceks-projects.vercel.app", "?monthPartial=show") === "show" &&
    Mod.partialModeFor("www.mystockharbor.com", "?monthPartial=show") === "omit" &&
    Mod.partialModeFor("localhost", "?monthPartial=show") === "omit" &&
    Mod.partialModeFor("evil.vercel.app.example.com", "?monthPartial=show") === "omit" &&
    Mod.partialModeFor("x.vercel.app", "") === "omit");
  want("the server HTML (default card) uses the default treatment", !/Oct so far/.test(renderToStaticMarkup(React.createElement(Mod.default, { symbol: "AAPL", ...INPUT }))));
  return fails;
}
const TOGGLE_SRC = raw(TOGGLE);
const CHART_SRC = raw(CHART);
try {
  const cFails = await cardRules(TOGGLE_SRC, CHART_SRC);
  for (const f of cFails) check(f, false);
  check("the card: the Monthly tab, both treatments of the month in progress, complete-month tiles", cFails.length === 0);
  for (const [label, file, from, to] of [
    ["the partial counted in the tiles", "chart", /const whole = bars\.filter\(\(b\) => !b\.partial\);/, "const whole = bars;"],
    ["the partial drawn as a full bar", "chart", /fillOpacity=\{b\.partial \? 0\.35 : 1\}/, "fillOpacity={1}"],
    ["no line when it is left out", "toggle", /note: monthly\.partialMonth && !show \? `\$\{monthly\.partialMonth\} so far isn't included\.` : undefined,/, "note: undefined,"],
    ["the switch on in production", "toggle", /if \(!hostname\.endsWith\("\.vercel\.app"\)\) return "omit";/, ""],
    ["the partial shown by default", "toggle", /const show = mode === "show" && monthly\.partial;/, "const show = monthly.partial;"],
  ]) {
    const t = file === "toggle" ? TOGGLE_SRC.replace(from, to) : TOGGLE_SRC;
    const c = file === "chart" ? CHART_SRC.replace(from, to) : CHART_SRC;
    if (t === TOGGLE_SRC && c === CHART_SRC) { check(`mutant "${label}" applies`, false, "matched nothing"); continue; }
    const fails = await cardRules(t, c);
    check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
  }
} finally {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
}

check("the section title names all three periods",
  /Daily, weekly or monthly close-over-close change/.test(raw("app/stock/[symbol]/StockSymbolPageClient.tsx")));

console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
