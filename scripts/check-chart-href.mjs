// EVERY "CHART" LINK LANDS ON THE CHART (#563 COWORK #151): rules, then mutants.
//
//   A. lib/chartHref.ts: chartHref(sym) is /dashboard?symbol=SYM#analyser,
//      chartHref() is /dashboard#analyser, extra params ride ahead of the hash;
//      chartHrefFrom rebuilds stored "/?symbol=…#chart" links the same way;
//      wantsAnalyser reads #analyser, #chart and ?symbol=.
//   B. No hand-built chart link anywhere in app/ or lib/ (API routes aside):
//      no "/dashboard?", "/dashboard#", "/?…" or "/#chart" literal outside
//      lib/chartHref.ts, and the builders' buildDashboardHref returns chartHref.
//   C. A link whose words are chart intent ("Chart", "Open the dashboard",
//      "Charting dashboard") is built by chartHref, never a plain "/" or
//      "/dashboard"; a plain "/dashboard" literal lives only in the navigation
//      files (header, footer, nav sections, sitemap, the retired phone page).
//   D. The landing: the bottom nav's "Chart" goes through chartHref and is lit
//      on "/" and /dashboard; the analyser jump is a layout effect, "instant",
//      on wantsAnalyser; the hero's own scroll respects reduced motion.
// A mutant each.
//
//   node scripts/check-chart-href.mjs
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";

register("./lib/tsx-render-hooks.mjs", import.meta.url);

const HELPER = "lib/chartHref.ts", NAV = "app/components/StockPagesBottomNav.tsx", CLIENT = "app/components/DashboardClient.tsx";
const BUILDERS = ["lib/server/pickersBuilder.ts", "lib/server/playsBuilder.ts", "lib/server/bullFlagsBuilder.ts", "lib/server/descendingTrianglesBuilder.ts"];
// Navigation to the page itself, not chart intent: these may say "/dashboard".
const PLAIN_OK = new Set(["app/components/SiteHeader.tsx", "app/layout.tsx", "lib/navSections.ts", "app/sitemap.ts", "app/stocks/page.tsx", "app/components/MobileHomePage.tsx", "app/components/HomePageRouter.tsx", "app/dashboard/page.tsx", HELPER]);
const read = (f) => fs.readFileSync(f, "utf8");

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!/node_modules|\.next|^app\/api$/.test(p)) walk(p); } else if (/\.tsx?$/.test(e.name) && !e.name.startsWith(".")) files.push(p);
  }
})("app");
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(e.name)) files.push(p); } })("lib");

let seq = 0;
async function loadHelper(src) {
  const file = path.join("lib", `.check-chart-href-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, src);
  try { return await import(pathToFileURL(path.resolve(file)).href); } finally { fs.rmSync(file, { force: true }); }
}

/** A: the helper's answers. */
function helperRules(H) {
  const fails = [], want = (l, ok) => { if (!ok) fails.push(l); };
  want("chartHref(sym) is /dashboard?symbol=SYM#analyser", H.chartHref(" amzn ") === "/dashboard?symbol=AMZN#analyser" && H.chartHref("BRK.B") === "/dashboard?symbol=BRK.B#analyser");
  want("chartHref() is /dashboard#analyser", H.chartHref() === "/dashboard#analyser" && H.chartHref("") === "/dashboard#analyser");
  want("extra params ride ahead of the hash, empties dropped", H.chartHref("AMZN", { tf: "D", indicator: undefined, srLower: 12.5 }) === "/dashboard?symbol=AMZN&tf=D&srLower=12.5#analyser");
  want("a stored /?symbol=…#chart link is rebuilt to the analyser, params kept", H.chartHrefFrom("/?symbol=NVDA&tf=W&indicator=RSI%2814%29#chart") === "/dashboard?symbol=NVDA&tf=W&indicator=RSI%2814%29#analyser");
  want("a stored link without a symbol takes the fallback; an empty one too", H.chartHrefFrom("/?tf=D", "msft") === "/dashboard?symbol=MSFT&tf=D#analyser" && H.chartHrefFrom("", "msft") === "/dashboard?symbol=MSFT#analyser" && H.chartHrefFrom(undefined) === "/dashboard#analyser");
  want("an already-built link survives a second pass", H.chartHrefFrom(H.chartHref("AMZN", { tf: "W" })) === "/dashboard?symbol=AMZN&tf=W#analyser");
  want("wantsAnalyser: #analyser, #chart, ?symbol=; not a bare visit", H.wantsAnalyser("#analyser", null) && H.wantsAnalyser("#chart", null) && H.wantsAnalyser("", "amzn") && !H.wantsAnalyser("", null) && !H.wantsAnalyser("#top", ""));
  return fails;
}

const LINK_RE = /href(?:=|:\s*)(?:"(\/(?:dashboard)?)"|\{`[^`]*`\}|\{([A-Za-z_.]+)\([^)]*\)\})/g;
const INTENT = /(^|\s)(Chart\b|Open (the )?dashboard|Charting dashboard)/i;
/** B and C over every file's source (with any overrides), comments stripped. */
function scanRules(over = {}) {
  const fails = [];
  for (const f of files) {
    if (f === HELPER || f.startsWith("app/api/")) continue;
    const raw = over[f] ?? read(f), s = stripComments(raw, { file: f });
    const lit = s.match(/["'`](\/dashboard[?#]|\/\?[a-z$]|\/#chart)/);
    if (lit) fails.push(`${f}: a hand-built chart link (${lit[1]}…), not chartHref`);
    for (const m of s.matchAll(LINK_RE)) {
      if (m[1] === undefined) continue;
      const after = s.slice(m.index, m.index + 1500);
      const text = (after.match(/>([\s\S]*?)<\/(?:Link|a)>/)?.[1] ?? "").replace(/<[^>]+>|\{[^}]*\}/g, " ").replace(/\s+/g, " ").trim();
      const label = m[0].startsWith("href:") ? (after.match(/(?:label|title):\s*"([^"]+)"/)?.[1] ?? "") : text;
      if (INTENT.test(label)) fails.push(`${f}: "${label.slice(0, 40)}" links to a plain "${m[1]}", not chartHref`);
      if (m[1] === "/dashboard" && !PLAIN_OK.has(f)) fails.push(`${f}: a plain "/dashboard" outside the navigation files`);
    }
  }
  for (const b of BUILDERS) {
    const s = stripComments(over[b] ?? read(b), { file: b });
    const body = s.match(/function buildDashboardHref\([\s\S]*?\n\}\n/)?.[0] ?? "";
    if (!/return chartHref\(/.test(body)) fails.push(`${b}: buildDashboardHref does not return chartHref`);
  }
  return fails;
}

/** D: the bottom nav and the landing's jump. */
function landingRules(over = {}) {
  const fails = [], want = (l, ok) => { if (!ok) fails.push(l); };
  const nav = stripComments(over[NAV] ?? read(NAV), { file: NAV }), c = stripComments(over[CLIENT] ?? read(CLIENT), { file: CLIENT });
  want("the bottom nav's Chart goes through chartHref", /\{ key: "chart", label: "Chart", href: chartHref\(symbol \|\| FALLBACK_SYMBOL\)/.test(nav));
  want("the bottom nav's Chart is lit on \"/\" and /dashboard", /const isDashboard = pathname === "\/" \|\| pathname\.startsWith\("\/dashboard"\);/.test(nav) && /const active: NavKey = isDashboard\s*\?\s*"chart"/.test(nav));
  want("the analyser jump is a layout effect on wantsAnalyser, instant",
    /useLayoutEffect\(\(\) => \{\s*if \(!landing \|\| !wantsAnalyser\(window\.location\.hash, deepSymbol\)\) return;\s*analyserRef\.current\?\.scrollIntoView\(\{ behavior: "instant", block: "start" \}\);/.test(c));
  want("no smooth scroll that ignores reduced motion", !/behavior: "smooth"/.test(c) && /analyserRef\.current\?\.scrollIntoView\(\{ behavior: scrollMotion\(\), block: "start" \}\)/.test(c));
  return fails;
}

let failures = 0;
const check = (label, ok, detail = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures++; };

console.log("A. The helper");
const helperSrc = read(HELPER);
const a = helperRules(await loadHelper(helperSrc));
check("chartHref, chartHrefFrom and wantsAnalyser answer as specified", a.length === 0, a.join("; "));
console.log("\nB–C. Every chart link on the site");
const bc = scanRules();
check(`no hand-built chart link in ${files.length} files; chart words always go through chartHref`, bc.length === 0, bc.slice(0, 5).join("; "));
console.log("\nD. The bottom nav and the landing");
const d = landingRules();
check("Chart tab and the analyser jump", d.length === 0, d.join("; "));

console.log("\nMutants: each must be caught");
const HELPER_MUTANTS = [
  ["chartHref drops the anchor", "return `/dashboard${q ? `?${q}` : \"\"}#${ANALYSER_ID}`;", "return `/dashboard${q ? `?${q}` : \"\"}`;"],
  ["chartHref back on the root", "return `/dashboard${q ? `?${q}` : \"\"}#${ANALYSER_ID}`;", "return `/${q ? `?${q}` : \"\"}#${ANALYSER_ID}`;"],
  ["a stored link loses its params", "for (const [k, v] of new URLSearchParams(query)) params[k] = v;", ""],
  ["#chart no longer asks for the analyser", ' || hash === "#chart"', ""],
];
for (const [label, from, to] of HELPER_MUTANTS) {
  if (!helperSrc.includes(from)) { check(`mutant "${label}" applies`, false, "matched nothing"); continue; }
  const f = helperRules(await loadHelper(helperSrc.replace(from, to)));
  check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
}
const SRC_MUTANTS = [
  ["Bottlenecks' Chart hand-built again", "app/components/BottleneckShockView.tsx", "href={chartHref(company.ticker)}", "href={`/dashboard?symbol=${encodeURIComponent(company.ticker)}`}", scanRules],
  ["the stock page's chart link back on /?symbol=", "app/stock/[symbol]/StockSymbolPageClient.tsx", "<Link href={chartHref(symbol)}", "<Link href={`/?symbol=${encodeURIComponent(symbol)}`}", scanRules],
  ["an 'Open the Dashboard' CTA back on a plain /", "app/how-to-read-stock-charts/page.tsx", "<Link href={chartHref()}", '<Link href="/"', scanRules],
  ["the About card back on plain /dashboard", "app/about/page.tsx", "href: chartHref(),", 'href: "/dashboard",', scanRules],
  ["a plays builder back on /?symbol=", "lib/server/playsBuilder.ts", '  return chartHref(symbol, { tf: timeframe === "ST" ? "D" : timeframe === "M" ? "W" : timeframe });', "  return `/?symbol=${symbol}`;", scanRules],
  ["the bottom nav's Chart hand-built", NAV, "href: chartHref(symbol || FALLBACK_SYMBOL)", "href: `/dashboard?symbol=${encoded}`", (o) => [...scanRules(o), ...landingRules(o)]],
  ["the bottom nav unlit on \"/\"", NAV, 'pathname === "/" || pathname.startsWith("/dashboard")', 'pathname.startsWith("/dashboard")', landingRules],
  ["the jump after paint, animated", CLIENT, 'useLayoutEffect(() => {\n    if (!landing || !wantsAnalyser(window.location.hash, deepSymbol)) return;\n    analyserRef.current?.scrollIntoView({ behavior: "instant", block: "start" });', 'useEffect(() => {\n    if (!landing || !wantsAnalyser(window.location.hash, deepSymbol)) return;\n    analyserRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });', landingRules],
  ["#analyser ignored by the landing", CLIENT, "if (!landing || !wantsAnalyser(window.location.hash, deepSymbol)) return;", "if (!landing || !cleanSymbol(deepSymbol)) return;", landingRules],
  ["the hero scroll ignores reduced motion", CLIENT, "scrollIntoView({ behavior: scrollMotion(), block: \"start\" }));", "scrollIntoView({ behavior: \"smooth\", block: \"start\" }));", landingRules],
];
for (const [label, file, from, to, rule] of SRC_MUTANTS) {
  const src = read(file);
  if (!src.includes(from)) { check(`mutant "${label}" applies`, false, "matched nothing"); continue; }
  const f = rule({ [file]: src.replace(from, to) });
  check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
}

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
