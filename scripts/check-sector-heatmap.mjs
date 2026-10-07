// THE /sector HEAT MAP (#553 COWORK #157 item 1).
//
// Runtime, on lib/sectorHeatmap.ts and the real SectorHeatMap (server-rendered
// on fixtures):
//   - the default period is year to date, and the three periods are the
//     cards' own figures (no recomputing);
//   - tiles are sized by tracked cap only when every sector's caps cover at
//     least 80% of its constituents, otherwise by companies tracked;
//   - the treemap tiles the box: areas in proportion, inside, no overlap;
//   - a negative sector is red, a positive green, a missing one or one within
//     +/-0.5% slate; the shade is capped at the second-largest move and stays
//     MUTED (saturation <= 45%, lightness <= 25%, #553 COWORK #180); white text
//     stays readable;
//   - every tile is a real link with its full text (name, return, N companies)
//     to that sector's page; the server HTML carries the default period.
// Source: the page passes the cards' rows, the credit and the sizing words;
// the treemap applies only above 640 px, in a 4:1 box (about half the old
// height, COWORK #180), and the phone grid is 3 compact columns; a small tile
// drops its count before its name shortens, and never its %.
// Every rule has a planted mutant.
//
//   node scripts/check-sector-heatmap.mjs
import { register } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";

register("./lib/tsx-render-hooks.mjs", import.meta.url);

const ROOT = process.cwd();
const LIB = "lib/sectorHeatmap.ts";
const MAP = "app/sector/SectorHeatMap.tsx";
const PAGE = "app/sector/page.tsx";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const tmp = [];
let seq = 0;
async function load(rel, src, swap = {}) {
  const dir = path.dirname(path.join(ROOT, rel));
  let out = src;
  for (const [from, to] of Object.entries(swap)) out = out.split(from).join(to);
  const f = path.join(dir, `.check-shm-${process.pid}-${seq++}${path.extname(rel)}`);
  fs.writeFileSync(f, out);
  tmp.push(f);
  return import(pathToFileURL(f).href);
}

const NAMES = ["Technology", "Healthcare", "Financials", "Consumer Discretionary", "Communication Services", "Industrials", "Consumer Staples", "Energy", "Utilities", "Real Estate", "Materials"];
const fixture = (coverage = 0.9) => NAMES.map((name, i) => ({
  slug: name.toLowerCase().replace(/\s+/g, "-"), name, href: `/sector/${name.toLowerCase().replace(/\s+/g, "-")}/news`,
  companies: 40 + i * 3, day: i === 3 ? -1.25 : 0.3 + i * 0.1, month: i === 3 ? -4.5 : 1 + i, ytd: i === 3 ? -12.4 : i === 7 ? null : 5 + i * 2,
  capSum: (11 - i) * 1e12, capCovered: Math.round((40 + i * 3) * (i === 10 ? coverage : 0.95)), constituents: 40 + i * 3,
}));

function libRules(L) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  want("the default period is year to date", L.HEAT_DEFAULT_PERIOD === "ytd" && L.HEAT_PERIODS.map((p) => p.key).join() === "day,month,ytd");
  const good = L.heatSizing(fixture(0.9));
  const thin = L.heatSizing(fixture(0.5));
  want("sized by cap when every sector is >= 80% covered", good.basis === "cap");
  want("sized by companies when one sector is under 80%", thin.basis === "companies");
  const tiles = L.heatTiles(fixture(0.9), good);
  want("tiles carry the cards' own figures, largest first", tiles[0].name === "Technology" && tiles.find((t) => t.name === "Consumer Discretionary").ytd === -12.4 && tiles.every((t, i) => i === 0 || tiles[i - 1].weight >= t.weight));
  const byCo = L.heatTiles(fixture(0.5), thin);
  want("...and by companies the weight is the company count", byCo[0].rawWeight === Math.max(...fixture().map((r) => r.companies)));
  const capTotal = tiles.reduce((a, t) => a + t.rawWeight, 0);
  want("no tile drawn under 5% of the map; larger tiles keep their measure", tiles.every((t) => t.weight >= capTotal * 0.05 - 1e-6) && tiles.filter((t) => t.rawWeight >= capTotal * 0.05).every((t) => t.weight === t.rawWeight));
  const rects = L.squarify(tiles.map((t) => t.weight), 100, 100);
  const total = tiles.reduce((a, t) => a + t.weight, 0);
  const inside = rects.every((r) => r.x >= -1e-6 && r.y >= -1e-6 && r.x + r.w <= 100 + 1e-6 && r.y + r.h <= 100 + 1e-6);
  const prop = rects.every((r, i) => Math.abs(r.w * r.h - (tiles[i].weight / total) * 10000) < 1e-6 * 10000);
  let overlap = false;
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    if (Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-6 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1e-6) overlap = true;
  }
  want("the treemap: areas in proportion, inside the box, no overlap", inside && prop && !overlap);
  want("squarified: no tile thinner than 1:3", rects.every((r) => Math.max(r.w / r.h, r.h / r.w) <= 3));
  const scale = L.heatScale([1, -8, 3, 20]);
  want("the scale is the second-largest move (one big sector cannot wash out the rest)", scale === 8);
  want("negative is red, positive green, missing slate", L.tileShade(-2, 4).tone === "down" && /hsl\(0,/.test(L.tileShade(-2, 4).background) && L.tileShade(2, 4).tone === "up" && L.tileShade(null, 4).tone === "flat");
  const light = (s) => Number(/(\d+(?:\.\d+)?)%\)$/.exec(s.background)[1]);
  want("intensity follows the move, capped at the scale", light(L.tileShade(1, 4)) < light(L.tileShade(3, 4)) && light(L.tileShade(20, 4)) === light(L.tileShade(4, 4)) && light(L.tileShade(20, 4)) <= 30);
  const sat = (s) => Number(/,\s*(\d+(?:\.\d+)?)%,/.exec(s.background)[1]);
  want("muted: saturation <= 45% and lightness <= 25% even at full scale (COWORK #180)", sat(L.tileShade(20, 4)) <= 45 && sat(L.tileShade(-20, 4)) <= 45 && light(L.tileShade(20, 4)) <= 25 && light(L.tileShade(-20, 4)) <= 25);
  want("a move within +/-0.5% reads flat (slate), 0.5% and over is coloured", L.tileShade(0.4, 4).tone === "flat" && L.tileShade(-0.49, 4).tone === "flat" && L.tileShade(0.5, 4).tone === "up" && L.tileShade(-0.5, 4).tone === "down");
  want("short names for the long ones; the rest keep their own", L.heatShortName("Communication Services") === "Comm. Services" && L.heatShortName("Energy") === "Energy");
  return fails;
}

async function renderRules(L, Map) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const React = (await import("react")).default;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const sizing = L.heatSizing(fixture());
  const tiles = L.heatTiles(fixture(), sizing);
  const rects = L.squarify(tiles.map((t) => t.weight), 100, 100);
  const html = renderToStaticMarkup(React.createElement(Map.default, { tiles, rects, dayLabel: "Last close · 2 Oct", sizedBy: "companies tracked", credit: { text: "Market data from Tiingo.com", href: "#tiingo" } }));
  const links = [...html.matchAll(/<a [^>]*class="heatTile[^"]*"[^>]*>([\s\S]*?)<\/a>/g)];
  want("one real link per sector", links.length === 11);
  want("each tile links to its sector page", tiles.every((t) => html.includes(`href="${t.href}"`)));
  want("each tile carries its full text: name, return, N companies", tiles.every((t) => links.some((m) => m[1].includes(`>${t.name.replace("&", "&amp;")}<`) && m[1].includes(`>${t.companies} companies<`))));
  want("a long name carries its short form beside the full one (the full stays in the link)", /<span class="heatNameFull">Communication Services<\/span><span class="heatNameShort" aria-hidden="true">Comm\. Services<\/span>/.test(html));
  want("the server HTML shows the default period (year to date)", links.some((m) => m[1].includes(">-12.40%<")) && !links.some((m) => m[1].includes(">-4.50%<")));
  want("a sector with no figure reads as a dash, not 0", links.some((m) => /Energy[\s\S]*>—</.test(m[1])));
  want("the negative sector is shaded red", /class="heatTile down"[^>]*>[\s\S]*?Consumer Discretionary/.test(html));
  want("the period toggle names the three periods, YTD pressed", /aria-pressed="true"[^>]*>Year to date</.test(html) && />Last close · 2 Oct</.test(html) && />1 month</.test(html));
  want("the fine print: constituent-weighted, the sizing, the floor, and the Tiingo credit", /Constituent-weighted, not index prints\. Tiles sized by companies tracked; no tile is drawn under 5% of the map/.test(html) && />Market data from Tiingo\.com</.test(html));
  return fails;
}

function sourceRules(mapRaw, pageRaw) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const m = stripComments(mapRaw, { file: MAP });
  const p = stripComments(pageRaw, { file: PAGE });
  want("the treemap applies only above 640 px", /@media \(min-width: 641px\) \{[\s\S]*?\.heatTile \{\s*position: absolute;/.test(m));
  want("phones get a compact 3-column grid (COWORK #180: no taller than a screen-third)", /\.heatBox \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/.test(m) && /\.heatTile \{[^}]*min-height: 52px;/.test(m));
  want("a small tile drops its count first, then shortens its name; the % is never hidden", /@container \(max-height: 74px\) \{ \.heatCount \{ display: none; \} \}/.test(m) && /@container \(max-width: 150px\) \{[^}]*\.heatCount \{ display: none; \}[\s\S]*?\.heatNameShort \{ display: inline; \}/.test(m) && !/\.heatValue \{[^}]*display: none/.test(m));
  want("names never break mid-word", /\.heatName \{[^}]*word-break: normal;[^}]*hyphens: none;/.test(m));
  want("the toggle swaps the shown figure only", /const value = tile\[period\];/.test(m) && /useState<HeatPeriod>\(HEAT_DEFAULT_PERIOD\)/.test(m));
  want("the page feeds the cards' own rows (no recomputing)", /day: row\?\.day \?\? null,\s*month: row\?\.month \?\? null,\s*ytd: row\?\.ytd \?\? null,\s*capSum: row\?\.capSum/.test(p));
  want("the treemap is laid out in the box's own 4:1 shape (about half the old height)", /squarify\(tiles\.map\(\(t\) => t\.weight\), 400, 100\)\.map\(\(r\) => \(\{ x: r\.x \/ 4, y: r\.y, w: r\.w \/ 4, h: r\.h \}\)\)/.test(p) && /aspect-ratio: 4 \/ 1;/.test(m));
  want("the page passes the Tiingo credit and the sizing words", /credit=\{\{ text: TIINGO_CREDIT, href: TIINGO_URL \}\}/.test(p) && /sizing\.basis === "cap"/.test(p));
  return fails;
}

try {
  const libSrc = read(LIB), mapSrc = read(MAP), pageSrc = read(PAGE);
  const L = await load(LIB, libSrc);
  console.log("\n1. The arithmetic");
  const l = libRules(L);
  check("default YTD; cap sizing only at >= 80% coverage; treemap; shades", l.length === 0, l.join("; "));
  console.log("\n2. Rendered on fixtures");
  const r = await renderRules(L, await load(MAP, mapSrc));
  check("11 real links with full text; YTD by default; red for a fall; fine print and credit", r.length === 0, r.join("; "));
  console.log("\n3. Source");
  const s = sourceRules(mapSrc, pageSrc);
  check("treemap above 640 px in a 4:1 box, a 3-column grid below; small tiles; the cards' rows; the credit", s.length === 0, s.join("; "));

  console.log("\n4. Planted mutants");
  const LIB_M = [
    ["the default period back to last close", 'export const HEAT_DEFAULT_PERIOD: HeatPeriod = "ytd";', 'export const HEAT_DEFAULT_PERIOD: HeatPeriod = "day";'],
    ["cap sizing without the coverage test", 'const basis = minCoverage != null && minCoverage >= HEAT_CAP_COVERAGE_MIN ? "cap" : "companies";', 'const basis = "cap";'],
    ["the scale uncapped (largest move)", "return Math.max(abs[1] ?? abs[0] ?? 0, 0.5);", "return Math.max(abs[0] ?? 0, 0.5);"],
    ["falls shaded green", '    : { background: `hsl(0, ${saturation}%, ${lightness}%)`, tone: "down" };', '    : { background: `hsl(142, ${saturation}%, ${lightness}%)`, tone: "down" };'],
    ["loud again (full saturation)", "const saturation = (18 + 24 * t).toFixed(1);", "const saturation = (55 + 0 * t).toFixed(1);"],
    ["the flat band dropped", "Math.abs(value) < HEAT_FLAT_BAND", "Math.abs(value) < 0.005"],
    ["no short names", "return SHORT_NAMES[name] ?? name;", "return name;"],
    ["the 5% floor dropped", "weight: Math.max(raw[i], floor)", "weight: raw[i]"],
    ["a strip layout (no squarifying)", "while (j < areas.length && worst([...row, areas[j]], side) <= worst(row, side)) {", "while (false) {"],
  ];
  for (const [label, from, to] of LIB_M) {
    if (!libSrc.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    let f;
    try { f = libRules(await load(LIB, libSrc.replace(from, to))); } catch (err) { f = [String(err)]; }
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
  const MAP_M = [
    ["tiles that are not links", "            <Link\n              key={tile.slug}", "            <div\n              key={tile.slug}"],
    ["the company count dropped from the tile", '<span className="heatCount">{tile.companies} companies</span>', ""],
    ["the Tiingo credit dropped", '<a href={credit.href} target="_blank" rel="noopener noreferrer" className="heatCredit">{credit.text}</a>', ""],
  ];
  for (const [label, from, to] of MAP_M) {
    if (!mapSrc.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    let m = mapSrc.replace(from, to);
    if (label === "tiles that are not links") m = m.replace("            </Link>", "            </div>");
    let f;
    try { f = await renderRules(L, await load(MAP, m)); } catch (err) { f = [String(err)]; }
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
  const SRC_M = [
    ["the treemap at every width (no phone grid)", "@media (min-width: 641px) {", "@media (min-width: 0px) {"],
    ["names allowed to break mid-word", "word-break: normal; hyphens: none;", "word-break: break-all; hyphens: auto;"],
    ["back to the 2-column phone grid", "grid-template-columns: repeat(3, minmax(0, 1fr))", "grid-template-columns: repeat(2, minmax(0, 1fr))"],
    ["the count kept in a short tile", "@container (max-height: 74px) { .heatCount { display: none; } }", ""],
    ["back to the tall 2:1 box", "aspect-ratio: 4 / 1;", "aspect-ratio: 2 / 1;"],
  ];
  for (const [label, from, to] of SRC_M) {
    if (!mapSrc.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    const f = sourceRules(mapSrc.replace(from, to), pageSrc);
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
  {
    const from = "      ytd: row?.ytd ?? null,\n      capSum";
    const f = pageSrc.includes(from) ? sourceRules(mapSrc, pageSrc.replace(from, "      ytd: (row?.month ?? 0) * 3,\n      capSum")) : ["anchor"];
    check('mutant "a recomputed YTD" is caught', pageSrc.includes(from) && f.length > 0, f[0] ?? "no rule failed");
  }
} finally {
  for (const f of tmp) fs.rmSync(f, { force: true });
}

console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
