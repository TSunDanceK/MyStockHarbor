// THE CHARTS PREVIEW BUTTON AND THE NAMED RANKING (#553 COWORK #161).
//
// 1. The view toggle is a preview button: a real <button> with aria-pressed and
//    a name that follows its label ("View results as charts" / "... as table"),
//    an aria-hidden thumbnail of the other view, a hint at --fs-label, a 44 px
//    target, and in the docked phone bar the thumbnail plus one word, no hint.
// 2. The ranking: lib/pickerRanking names a page's default order (orderBy names
//    itself; else `rankedBy`). Only the five pages whose section sorts by one
//    plain key carry `rankedBy`, plus /stocks-near-200-day-moving-average,
//    whose composite is named AS a composite (#553 COWORK #184 item 4). The
//    grid shows "Ranked by …" while unsorted, and "Back to … ranking" (desktop
//    and the phone Sort list) once sorted; a page with no ranking reads "The
//    page's order" there, never a column it is not sorted by.
// 3. The order matches the words: the SEC earnings-growth section is ranked by
//    EPS growth alone (no popularity boost), then the small-base group
//    (lib/epsGrowthView, #553 COWORK #186 ruling 1); it, the four trend-flip
//    sections and the daily MA200 section take every candidate, so every
//    listed row is in that order.
// 4. Figures sort highest first on the first click, and every growth column
//    is a figure; the phone Sort list offers "(high to low)" first.
// Every rule has a planted mutant.
//
//   node scripts/check-picker-ranking.mjs
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const GRID = "app/components/PickerResultsGrid.tsx";
const PAGE = "app/components/PickerResultPage.tsx";
const LIB = "lib/pickerRanking.ts";
const BUILDER = "lib/server/pickersBuilder.ts";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const RANKED_PAGES = [
  "app/stocks-with-strong-earnings-growth/page.tsx",
  "app/stocks-with-bullish-trend-flip/page.tsx",
  "app/stocks-with-bearish-trend-flip/page.tsx",
  "app/stocks-with-weekly-bullish-trend-flip/page.tsx",
  "app/stocks-with-weekly-bearish-trend-flip/page.tsx",
  // A composite, named as one (#553 COWORK #184 item 4, ruled in COWORK #186).
  "app/stocks-near-200-day-moving-average/page.tsx",
];

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
let seq = 0;
const tmp = [];
async function loadLib(src) {
  const f = path.join(ROOT, "lib", `.check-prk-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(f, src);
  tmp.push(f);
  return import(pathToFileURL(f).href);
}

function buttonRules(gridRaw) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const g = stripComments(gridRaw, { file: GRID });
  const btn = g.slice(g.indexOf('className="viewToggle viewPreview"') - 40, g.indexOf('className="viewToggle viewPreview"') + 1200);
  want("the toggle is a <button> styled as the preview button", /<button\s+type="button"\s+className="viewToggle viewPreview"/.test(g));
  want("it carries aria-pressed for the chart view", /aria-pressed=\{viewMode === "chart"\}/.test(btn));
  want("its name follows its label", /aria-label=\{viewMode === "list" \? "View results as charts" : "View results as table"\}/.test(btn));
  want("the label flips between the views", /viewMode === "list" \? "View as charts" : "View as table"/.test(btn) && /viewMode === "list" \? "Charts" : "Table"/.test(btn));
  want("the hint flips too", /"Every result as a mini price chart" : "Back to the sortable table"/.test(btn));
  want("the thumbnail swaps with the view", /\{viewMode === "list" \? THUMB_CHARTS : THUMB_TABLE\}/.test(btn));
  const thumbs = [...g.matchAll(/const THUMB_(CHARTS|TABLE) = \(\s*<svg ([^>]*)>/g)];
  want("both thumbnails are aria-hidden", thumbs.length === 2 && thumbs.every((m) => /aria-hidden="true"/.test(m[2])));
  want("the charts thumbnail is a 3 x 2 grid of mini lines", (g.match(/\{ d: "M2 [^"]+", up: (true|false) \}/g) ?? []).length === 6);
  want("a 44 px target with an accent border and fill", /\.viewToggle\.viewPreview \{[^}]*min-height: 44px;[^}]*border: 1px solid rgba\(56,189,248,[^}]*background: rgba\(56,189,248,/.test(g));
  want("the hint reads at --fs-label or larger", /\.viewToggleHint \{[^}]*font-size: var\(--fs-label\)/.test(g));
  want("the docked bar drops the hint and shows one word", /\.screenerControls \.viewPreview \.viewLabelLong,\s*\.screenerControls \.viewPreview \.viewToggleHint \{ display: none; \}/.test(g) && /\.screenerControls \.viewPreview \.viewLabelShort \{ display: inline; \}/.test(g));
  want("the old pill is gone", !/Switch to chart view|>\{viewMode === "list" \? "Charts" : "List"\}</.test(g));
  return fails;
}

function rankingLibRules(L) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const asc = L.pageRanking({ orderBy: { dir: "asc", label: "P/E Ratio" } });
  const desc = L.pageRanking({ orderBy: { dir: "desc", label: "Dividend Yield" } });
  want("orderBy asc names itself, lowest first", asc?.label === "P/E Ratio, lowest first" && asc?.short === "P/E Ratio");
  want("orderBy desc names itself, highest first", desc?.label === "Dividend Yield, highest first");
  want("orderBy wins over rankedBy", L.pageRanking({ orderBy: { dir: "desc", label: "X" }, rankedBy: { label: "Y", short: "y" } })?.short === "X");
  want("rankedBy passes through", L.pageRanking({ rankedBy: { label: "EPS growth, highest first", short: "growth" } })?.short === "growth");
  want("no ranking is null (no line)", L.pageRanking({}) === null);
  return fails;
}

function wiringRules({ grid, page, pages, builder }) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const g = stripComments(grid, { file: GRID });
  const p = stripComments(page, { file: PAGE });
  want("the page derives the ranking and hands it to the grid", /const ranking = pageRanking\(config\);/.test(p) && /<PickerResultsGrid\s+entries=\{entries\}\s+ranking=\{ranking\}/.test(p));
  want('the grid says "Ranked by …" while unsorted', /\) : \(\s*<p className="rankLine">Ranked by \{ranking\.label\}<\/p>/.test(g));
  want('and "Back to … ranking" once sorted, restoring the preset order', /<button type="button" className="rankBack" onClick=\{\(\) => setSort\(null\)\}>\s*Back to \{ranking\.short\} ranking/.test(g));
  want("unsorted, the phone Sort list names the page's order, never a column",
    /value=\{!sort \? RANKING_OPTION : `\$\{sortKey\}:\$\{sortDir\}`\}/.test(g) && /<option value=\{RANKING_OPTION\}>\{sort \? "Back to the page's order" : "The page's order"\}<\/option>/.test(g));
  want("the phone Sort list carries the ranking, which resets the sort",
    /if \(e\.target\.value === RANKING_OPTION\) \{\s*setSort\(null\);\s*return;/.test(g) && /<option value=\{RANKING_OPTION\}>\{sort \? `Back to \$\{ranking\.short\} ranking` : `Ranked by \$\{ranking\.label\}`\}<\/option>/.test(g));
  want("unsorted means the page's order, untouched", /if \(!sortCol \|\| !sort\) return filteredEntries;/.test(g));
  // Which pages may name a section ranking: exactly the five plain-key ones.
  const carrying = Object.entries(pages).filter(([, src]) => /\n\s*rankedBy: /.test(stripComments(src, { file: "page.tsx" }))).map(([f]) => f).sort();
  want("rankedBy sits on exactly the listed pages (no unnamed composite-ranked page)", JSON.stringify(carrying) === JSON.stringify([...RANKED_PAGES].sort()));
  want("the growth page names EPS growth only on the SEC default", /rankedBy: SEC \? \{ label: "EPS growth, highest first, then small bases by the \$ change", short: "growth" \} : undefined,/.test(pages[RANKED_PAGES[0]] ?? ""));
  // The order matches the words.
  const b = stripComments(builder, { file: BUILDER });
  want("the SEC growth section is ranked by EPS growth alone, no popularity boost",
    /_score: earningsGrowthFromSec\s*\? \(strongEarningsGrowthCandidate\.epsGrowthPct \?\? 0\)\s*: strongEarningsGrowthCandidate\.score \+ dynamicBoost\(symbol\),/.test(b));
  want("the growth section takes every candidate", /source: strongEarningsGrowth,\s*take: Math\.max\(20, strongEarningsGrowth\.length\),/.test(b));
  want("the growth section is put in the page's order (lib/epsGrowthView) and that order is its rank",
    /if \(earningsGrowthFromSec\) \{\s*strongEarningsGrowth\.sort\(compareEpsGrowth\);\s*strongEarningsGrowth\.forEach\(\(item, i\) => \{[\s\S]{0,200}?item\._score = strongEarningsGrowth\.length - i;/.test(b));
  want("the daily MA200 section takes every candidate", /source: dailyMa200Proximity,[\s\S]{0,400}?take: Math\.max\(20, dailyMa200Proximity\.length\),/.test(b));
  for (const f of ["trendFlipBullishDaily", "trendFlipBearishDaily", "trendFlipBullishWeekly", "trendFlipBearishWeekly"]) {
    want(`the ${f} section takes every candidate`, new RegExp(`source: ${f},[\\s\\S]{0,2000}?take: Math\\.max\\(40, ${f}\\.length\\),`).test(b));
  }
  want("sections sort by score, highest first", /const sorted = \[\.\.\.arr\]\.sort\(\(a, b\) => \(b\._score \?\? 0\) - \(a\._score \?\? 0\)\);/.test(b));
  // Highest first on the first click.
  want("a figure column sorts highest first on the first click", /return \{ key, dir: type === "str" \? "asc" : "desc" \};/.test(g));
  const growthCols = [...g.matchAll(/const \w+: Col = \{ key: "(\w+)", label: "([^"]*[Gg]rowth[^"]*)", (?:tip: \w+, )?sortType: "(\w+)"/g)];
  want("every growth column is a figure (so it sorts highest first)", growthCols.length >= 1 && growthCols.every((m) => m[3] === "num"));
  want('the phone Sort list offers "(high to low)" first for figures', /const dirs = col\.sortType === "str" \? \(\["asc", "desc"\] as const\) : \(\["desc", "asc"\] as const\);/.test(g));
  return fails;
}

const pageFiles = {};
for (const d of fs.readdirSync(path.join(ROOT, "app"))) {
  const f = `app/${d}/page.tsx`;
  if (fs.existsSync(path.join(ROOT, f))) pageFiles[f] = read(f);
}
const real = { grid: read(GRID), page: read(PAGE), pages: pageFiles, builder: read(BUILDER) };
const libSrc = read(LIB);

try {
  console.log("\n1. The preview button");
  const b = buttonRules(real.grid);
  check("label, name, aria-pressed, aria-hidden thumbnails, 44 px, hint size, docked bar", b.length === 0, b.join("; "));
  console.log("\n2. The ranking, in words");
  const l = rankingLibRules(await loadLib(libSrc));
  check("orderBy names itself; rankedBy passes through; none is null", l.length === 0, l.join("; "));
  console.log("\n3. Wiring, and the order matches the words");
  const w = wiringRules(real);
  check("shown while unsorted, a way back once sorted, the listed pages, builder order, highest first", w.length === 0, w.join("; "));

  console.log("\n4. Planted mutants");
  const BTN = [
    ["the name no longer follows the label", 'aria-label={viewMode === "list" ? "View results as charts" : "View results as table"}', 'aria-label="Toggle view"'],
    ["aria-pressed dropped", "          aria-pressed={viewMode === \"chart\"}\n", ""],
    ["a thumbnail exposed to screen readers", '<svg className="viewThumb" viewBox="0 0 74 42" aria-hidden="true" focusable="false">', '<svg className="viewThumb" viewBox="0 0 74 42" focusable="false">'],
    ["the target under 44 px", "gap: 10px; min-height: 44px;", "gap: 10px; min-height: 30px;"],
    ["the hint below the reading floor", ".viewToggleHint { font-size: var(--fs-label);", ".viewToggleHint { font-size: 10px;"],
    ["the docked bar keeps the hint", "          .screenerControls .viewPreview .viewLabelLong,\n          .screenerControls .viewPreview .viewToggleHint { display: none; }", "          .screenerControls .viewPreview .viewLabelLong { display: none; }"],
  ];
  for (const [label, from, to] of BTN) {
    if (!real.grid.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    const f = buttonRules(real.grid.replace(from, to));
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
  const LIBM = [
    ["asc called highest first", '"asc" ? "lowest" : "highest"', '"asc" ? "highest" : "lowest"'],
    ["rankedBy ignored", "  return config.rankedBy ?? null;", "  return null;"],
  ];
  for (const [label, from, to] of LIBM) {
    if (!libSrc.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    let f;
    try { f = rankingLibRules(await loadLib(libSrc.replace(from, to))); } catch (err) { f = [String(err)]; }
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
  const growth = RANKED_PAGES[0];
  const WIRE = [
    ['the "Ranked by" line dropped', "grid", '            <p className="rankLine">Ranked by {ranking.label}</p>', "            null"],
    ["no way back once sorted", "grid", 'onClick={() => setSort(null)}>\n                Back to', 'onClick={() => undefined}>\n                Back to'],
    ["the phone list's ranking does not reset", "grid", "                  setSort(null);\n                  return;", "                  return;"],
    ["a figure's first click flipped to lowest first", "grid", 'return { key, dir: type === "str" ? "asc" : "desc" };', 'return { key, dir: type === "str" ? "desc" : "asc" };'],
    ["a growth column sorted as text", "grid", 'label: "Div Growth", sortType: "num"', 'label: "Div Growth", sortType: "str"'],
    ["the phone list offers low to high first", "grid", ': (["desc", "asc"] as const);', ': (["asc", "desc"] as const);'],
    ["the popularity boost back on the growth ranking", "builder", "? (strongEarningsGrowthCandidate.epsGrowthPct ?? 0)", "? (strongEarningsGrowthCandidate.epsGrowthPct ?? 0) + dynamicBoost(symbol)"],
    ["the growth section capped at 20 again", "builder", "take: Math.max(20, strongEarningsGrowth.length),", "take: 20,"],
    ["a flip section capped at 40 again", "builder", "take: Math.max(40, trendFlipBearishWeekly.length),", "take: 40,"],
    ["the page stops handing the ranking down", "page", "                  ranking={ranking}\n", ""],
    ["unsorted claims the headline column again", "grid", "value={!sort ? RANKING_OPTION : `${sortKey}:${sortDir}`}", "value={ranking && !sort ? RANKING_OPTION : `${sortKey}:${sortDir}`}"],
    ["the growth order's rank dropped", "builder", "      item._score = strongEarningsGrowth.length - i;\n", ""],
    ["the daily MA200 section capped at 20 again", "builder", "take: Math.max(20, dailyMa200Proximity.length),", "take: 20,"],
  ];
  for (const [label, which, from, to] of WIRE) {
    const src = real[which];
    if (!src.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    const f = wiringRules({ ...real, [which]: src.replace(from, to) });
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
  {
    const m = { ...real, pages: { ...pageFiles, "app/oversold-stocks-today/page.tsx": pageFiles["app/oversold-stocks-today/page.tsx"].replace('  sectionIncludes: ["oversold"],\n', '  sectionIncludes: ["oversold"],\n  rankedBy: { label: "oversold strength", short: "oversold" },\n') } };
    const f = wiringRules(m);
    check('mutant "a composite-ranked page claims a ranking" is caught', m.pages["app/oversold-stocks-today/page.tsx"] !== pageFiles["app/oversold-stocks-today/page.tsx"] && f.length > 0, f[0] ?? "no rule failed");
  }
  {
    const m = { ...real, pages: { ...pageFiles, [growth]: pageFiles[growth].replace("rankedBy: SEC ? {", "rankedBy: true ? {") } };
    const f = wiringRules(m);
    check('mutant "the FMP rollback claims the EPS-growth ranking" is caught', f.length > 0, f[0] ?? "no rule failed");
  }
} finally {
  for (const f of tmp) fs.rmSync(f, { force: true });
}

console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
