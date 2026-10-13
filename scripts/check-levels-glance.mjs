// "LEVELS TO WATCH" ON THE SPX PAGE (#563 COWORK #93): rules, then mutants.
//
// lib/ta/levelsGlance.ts and app/markets/spx/LevelsGlanceCard.tsx are
// transpiled into one module with the Price zones card and its imports, and
// driven with synthetic zones (exact cases) and daily-bar fixtures (the card
// against the Price zones card on the same bars).
//
// Rules: the main line is the shown zone with the most levels, a tie to the
// nearer; no duplicate line when the main zone is also the nearest; the inside
// wording; "just above / below" for a 0.0% distance (#94); the numbers match the Price zones card on the same bars (and the page
// passes both one input object); no advice words; nothing that can push the
// page sideways at 320–430 px; placement under Price zones in the left column
// (#563 COWORK #129; after Key levels on a phone), with the SPY label and the
// Tiingo credit. A mutant each.
//
//   node scripts/check-levels-glance.mjs
import fs from "node:fs";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { reasonedValueUnit } from "./lib/render-cards.mjs";
import { stripComments } from "./lib/source-code.mjs";

const LIB = "lib/ta/levelsGlance.ts", CARD = "app/markets/spx/LevelsGlanceCard.tsx", PAGE = "app/markets/spx/page.tsx";
const DEPS = ["lib/ta/sessionBar.ts", "lib/ta/keyLevels.ts", "lib/ta/macdSeries.ts", "lib/ta/priceLadder.ts", "lib/ta/fairValueGaps.ts"], ZONES = "lib/ta/confluence.ts";
// B's gap detector (imported by the zones since #563 COWORK #108) has its own module-scope isPrice; one bundle can't hold two.
const depSrc = (f) => (f.endsWith("fairValueGaps.ts") ? strip(read(f)).replace(/\bisPrice\b/g, "fvgIsPrice") : strip(read(f)));
const strip = (src) => src.replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "").replace(/^"use client";$/m, "");
const read = (f) => fs.readFileSync(f, "utf8");

let n = 0;
async function load(lib, card, zonesLib = read(ZONES)) {
  const tap = `import { useCallback, useLayoutEffect } from "react";\n${strip(read("app/stock/[symbol]/TapNote.tsx"))}`;
  const zones = strip(read("app/stock/[symbol]/ConfluenceCard.tsx")).replace("export default function ConfluenceCard", "export function ConfluenceCard");
  const unit = `${reasonedValueUnit()}\n${tap}\n${DEPS.map(depSrc).join("\n")}\n${strip(zonesLib)}\n${zones}\n${strip(lib)}\n${strip(card).replace("export default function LevelsGlanceCard", "export function LevelsGlanceCard")}\n`;
  const tmp = `scripts/.check-levels-glance-${process.pid}-${n++}.mjs`;
  fs.writeFileSync(tmp, ts.transpileModule(unit, { fileName: "c.tsx", compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react" } }).outputText);
  try { return await import(`${process.cwd()}/${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
}

// ── synthetic zones ─────────────────────────────────────────────────────────
const Z = (lo, hi, count) => ({ lo, hi, count, members: [] });
const conf = (price, above, below, inside = null) => ({ price, above, below, inside, atr: 1, band: 1, scale: { lo: 0, hi: 1 }, levels: [], omitted: [], reason: null });
const S = {
  // the largest is the farther zone above
  farAbove: conf(100, [Z(101, 101.5, 3), Z(104, 105, 6)], [Z(99, 99.4, 2), Z(96, 97, 4)]),
  // a tie on count: the nearer (below, 0.5%) beats the farther (above, 1%)
  tie: conf(100, [Z(101, 102, 4), Z(105, 106, 2)], [Z(99, 99.5, 4), Z(95, 96, 3)]),
  // the largest is also the nearest above
  nearestIsMain: conf(100, [Z(100.5, 101, 7), Z(103, 104, 2)], [Z(98, 99, 3)]),
  // the price inside a zone that is also the largest
  insideMain: conf(100, [Z(102, 103, 2)], [Z(97, 98, 3)], Z(99.5, 100.4, 5)),
  // inside a small zone, a larger one below
  insideSmall: conf(100, [Z(102, 103, 2)], [Z(97, 98, 6)], Z(99.5, 100.4, 2)),
  none: conf(100, [], []),
};

// ── bar fixtures, all ending Fri 2 Oct 2026 ─────────────────────────────────
function wave(scale = 1, drift = 0.1, p = 17) {
  const out = [];
  for (let t = Date.parse("2025-06-02T00:00:00Z"), i = 0; t <= Date.parse("2026-10-02T00:00:00Z"); t += 86_400_000) {
    const d = new Date(t), date = d.toISOString().slice(0, 10);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const b = (200 + 30 * Math.sin(i / p) + 15 * Math.sin(i / 5.3) + i * drift) * scale;
    out.push({ date, open: b, high: b + 3 * scale, low: b - 2.5 * scale, close: b + 0.8 * scale });
    i++;
  }
  return out;
}
const sma = (b, k) => b.slice(-k).reduce((s, x) => s + x.close, 0) / k;
const NOW = Date.parse("2026-10-03T12:00:00Z");
const FIXTURES = [wave(1, 0.1), wave(1, -0.12), wave(3.6, 0.05, 23), wave(0.9, 0.2, 11), wave(1.2, 0, 29)].map((b) => ({ bars: b, lastPrice: b[b.length - 1].close, nowMs: NOW, ma50: sma(b, 50), ma200: sma(b, 200), macro: null }));
const CREDIT = React.createElement("a", { href: "#" }, "Market data from Tiingo.com");
const ADVICE = /\b(buy|buying|sell|selling|should|must|recommend\w*|will hold|holds?|bounce\w*|breakout|target|opportunit\w*|forecast)\b/i;
const text = (html) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

const RULES = {
  "the main line is the shown zone with the most levels; a tie goes to the nearer one": ({ M }) => {
    const main = (c) => M.glanceLines(c).find((l) => l.kind === "main")?.zone;
    return main(S.farAbove) === S.farAbove.above[1] && main(S.tie) === S.tie.below[0] && main(S.insideSmall) === S.insideSmall.below[0] &&
      M.glanceLines(S.farAbove)[0].text === ": 6 levels cluster here, 4.0% above the last price." && M.glanceLines(S.farAbove)[0].lead === "Around $104.50" &&
      FIXTURES.every((p) => {
        const c = M.confluence(p), shown = [...c.above, ...c.below, ...(c.inside ? [c.inside] : [])], z = M.mainZone(c);
        return !shown.length ? z === null : shown.every((x) => x.count < z.count || (x.count === z.count && M.zoneGap(x, c.price) >= M.zoneGap(z, c.price)));
      });
  },
  "no duplicate line when the largest zone is also the nearest": ({ M }) =>
    Object.values(S).every((c) => { const ls = M.glanceLines(c), zs = ls.map((l) => l.zone); return new Set(zs).size === zs.length && new Set(ls.map((l) => l.text)).size === ls.length; }) &&
    JSON.stringify(M.glanceLines(S.nearestIsMain).map((l) => l.kind)) === '["main","nearBelow"]' &&
    JSON.stringify(M.glanceLines(S.farAbove).map((l) => l.kind)) === '["main","nearAbove","nearBelow"]' &&
    M.glanceLines(S.farAbove)[1].lead + M.glanceLines(S.farAbove)[1].text === "Nearest above: around $101.25 (3 levels, 1.0% above)." &&
    M.glanceLines(S.farAbove)[2].lead + M.glanceLines(S.farAbove)[2].text === "Nearest below: around $99.20 (2 levels, 0.6% below)." &&
    M.glanceLines(S.none).length === 0,
  "the price inside a zone: the first line says so, in the owner's wording": ({ M }) => {
    const a = M.glanceLines(S.insideMain), b = M.glanceLines(S.insideSmall);
    return a[0].kind === "inside" && a[0].text === "The price is inside a zone of 5 levels around $99.95." && !a.some((l) => l.kind === "main") &&
      JSON.stringify(a.map((l) => l.kind)) === '["inside","nearAbove","nearBelow"]' &&
      b[0].kind === "inside" && b[1].kind === "main" && b[1].zone === S.insideSmall.below[0] && a[0].side === "inside";
  },
  "the numbers match the Price zones card on the same bars, and the page passes both one input object": ({ M, page }) =>
    /<ConfluenceCard \{\.\.\.zoneInput\} fill credit=\{credit\} \/>/.test(page) && /<LevelsGlanceCard \{\.\.\.zoneInput\} shownOn=/.test(page) &&
    !/<LevelsGlanceCard \{\.\.\.zoneInput\}[^>]*\b(bars|lastPrice|nowMs|ma50|ma200|macro)=/.test(page) &&
    FIXTURES.every((p) => {
      const c = M.confluence(p), lines = M.glanceLines(c), shown = [...c.above, ...c.below, ...(c.inside ? [c.inside] : [])];
      const zonesCard = text(renderToStaticMarkup(React.createElement(M.ConfluenceCard, { ...p, credit: CREDIT })));
      const glanceCard = text(renderToStaticMarkup(React.createElement(M.LevelsGlanceCard, { ...p, shownOn: "Shown on SPY", credit: CREDIT })));
      return lines.length > 0 && lines.every((l) => {
        const sameZone = shown.some((z) => z.lo === l.zone.lo && z.hi === l.zone.hi && z.count === l.zone.count);
        const mid = M.priceWords((l.zone.lo + l.zone.hi) / 2), dist = M.zoneDistance(l.zone, c.price), cw = M.countWords(l.zone);
        const said = (l.lead ?? "") + l.text;
        return sameZone && said.includes(mid) && said.includes(cw) && (l.kind === "inside" || said.includes(dist)) &&
          zonesCard.includes(cw) && (l.kind === "inside" || zonesCard.includes(dist)) && glanceCard.includes(said.replace(/^: /, ": "));
      });
    }),
  "a distance that rounds to 0.0% reads 'just above' / 'just below', in this card and the Price zones label (#94)": ({ M }) => {
    const c = conf(770, [Z(770.2, 771.4, 3), Z(775, 776, 6)], [Z(769.8, 769.9, 2)]);
    const ls = M.glanceLines(c), said = ls.map((l) => (l.lead ?? "") + l.text);
    const zonesCard = text(renderToStaticMarkup(React.createElement(M.ConfluenceCard, { ...FIXTURES[0], credit: CREDIT })));
    return M.zoneDistance(Z(770.2, 771, 2), 770) === "just above" && M.zoneDistance(Z(769, 769.9, 2), 770) === "just below" &&
      M.zoneDistance(Z(771, 772, 2), 770) === "0.1% above" && M.zoneDistance(Z(774, 775, 2), 770) === "0.5% above" &&
      said.includes("Nearest above: around $770.80 (3 levels, just above).") && said.includes("Nearest below: around $769.85 (2 levels, just below).") &&
      M.glanceLines(conf(770, [Z(770.1, 771, 7)], []))[0].text === ": 7 levels cluster here, just above the last price." &&
      !said.some((x) => /0\.0%/.test(x)) && !/0\.0% (above|below)/.test(zonesCard) &&
      /\{zoneDistance\(mark\.zone, price\)\}/.test(read("app/stock/[symbol]/ConfluenceCard.tsx"));
  },
  "no advice or forecast words in the card": ({ M, card, lib }) =>
    [...Object.values(S), ...FIXTURES.map((p) => M.confluence(p))].every((c) => M.glanceLines(c).every((l) => !ADVICE.test(`${l.lead ?? ""}${l.text}`))) &&
    !ADVICE.test(stripComments(card, { file: CARD }).replace(/import[^;]+;/g, "")) && !ADVICE.test(stripComments(lib, { file: LIB }).replace(/import[^;]+;/g, "")),
  "nothing in the card can push the page sideways at 320–430 px": ({ card, page }) =>
    !/nowrap|width:\s*\d{3}|minWidth:\s*[1-9]/.test(card) && /overflowWrap: "anywhere"/.test(card) && /minWidth: 0,\s*boxSizing: "border-box"/.test(card) &&
    /<div className="spxGlanceCell">\s*<LevelsGlanceCard/.test(page) && /\.spxGlanceCell \{ grid-area: glance; min-width: 0; \}/.test(page) &&
    /@media \(max-width: 900px\) \{[^@]*\.spxLevels \{ grid-template-columns: minmax\(0, 1fr\);/.test(page),
  // UNDER PRICE ZONES (#563 COWORK #129): the left column on desktop; after Key levels on a phone, as before.
  "under Price zones (left column; after Key levels on a phone), with the SPY label and the Tiingo credit": ({ M, page }) => {
    const z = page.indexOf("<ConfluenceCard"), k = page.indexOf("<KeyLevelsCard"), g = page.indexOf("<LevelsGlanceCard"), end = page.indexOf("</div>\n            </div>", k);
    const grid = /\.spxLevels \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); grid-template-rows: 1fr auto; grid-template-areas: "zones keys" "glance keys";/.test(page) &&
      /\.spxZonesCell \{ grid-area: zones; \}/.test(page) && /\.spxKeysCell \{ grid-area: keys; \}/.test(page) &&
      /@media \(max-width: 900px\) \{[^@]*grid-template-areas: "zones" "keys" "glance";/.test(page) &&
      page.indexOf('<div className="spxZonesCell">') < z && page.indexOf('<div className="spxKeysCell">') < k && page.indexOf('<div className="spxGlanceCell">') < g;
    const html = text(renderToStaticMarkup(React.createElement(M.LevelsGlanceCard, { ...FIXTURES[0], shownOn: "Shown on SPY", credit: CREDIT })));
    return grid && z > 0 && k > z && g > k && g < end && /shownOn=\{onSpy \? "Shown on SPY" : "Shown on the S&P 500 index"\} credit=\{credit\} \/>/.test(page) &&
      html.includes("Shown on SPY · Daily prices: Market data from Tiingo.com") && html.startsWith("At a glanceLevels to watch");
  },
};

const src = { lib: read(LIB), card: read(CARD), page: read(PAGE), zones: read(ZONES) };
let failures = 0;
const check = (label, ok) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures++; };
const run = (rule, m) => { try { return !!rule(m); } catch { return false; } };
const measure = async (s) => ({ ...s, page: stripComments(s.page, { file: PAGE }), M: await load(s.lib, s.card, s.zones) });

console.log("=== Rules ===");
const base = await measure(src);
for (const [label, rule] of Object.entries(RULES)) check(label, run(rule, base));

const R = Object.keys(RULES);
const MUTANTS = [
  [R[0], "lib", (s) => s.replace("z.count > best.count ||", "z.count < best.count ||")],
  [R[0], "lib", (s) => s.replace("zoneGap(z, c.price) < zoneGap(best, c.price)", "zoneGap(z, c.price) > zoneGap(best, c.price)")],
  [R[1], "lib", (s) => s.replace("if (z && z !== main)", "if (z)")],
  [R[2], "lib", (s) => s.replace("The price is inside a zone of", "The price is near a zone of")],
  [R[2], "lib", (s) => s.replace("if (main !== c.inside) {", "if (true) {")],
  [R[3], "lib", (s) => s.replace("priceWords((z.lo + z.hi) / 2)", "priceWords(z.lo)")],
  [R[3], "page", (s) => s.replace("<LevelsGlanceCard {...zoneInput} shownOn=", "<LevelsGlanceCard {...zoneInput} ma200={null} shownOn=")],
  [R[4], "zones", (s) => s.replace('return pct === "0.0" ? `just ${side}` : `${pct}% ${side}`;', "return `${pct}% ${side}`;")],
  [R[4], "zones", (s) => s.replace('return pct === "0.0" ? `just ${side}` : `${pct}% ${side}`;', 'return pct === "0.0" ? `just ${side === "above" ? "below" : "above"}` : `${pct}% ${side}`;')],
  [R[5], "lib", (s) => s.replace("cluster here,", "should hold here,")],
  [R[6], "card", (s) => s.replace('overflowWrap: "anywhere"', 'whiteSpace: "nowrap"')],
  [R[7], "card", (s) => s.replace("<> · Daily prices: {credit}</>", "<> {credit}</>")],
  [R[7], "page", (s) => s.replace(/\n\s*\{\/\* LEVELS TO WATCH[^\n]*\n\s*<div className="spxGlanceCell">\n\s*<LevelsGlanceCard[^\n]*\n\s*<\/div>/, "").replace("<ConfluenceCard {...zoneInput} fill credit={credit} />", '<LevelsGlanceCard {...zoneInput} shownOn={onSpy ? "Shown on SPY" : "Shown on the S&P 500 index"} credit={credit} />\n<ConfluenceCard {...zoneInput} fill credit={credit} />')],
  // Back under Key levels in the right column (the pre-#129 layout).
  [R[7], "page", (s) => s.replace('grid-template-areas: "zones keys" "glance keys";', 'grid-template-areas: "zones keys" "zones glance";')],
];
console.log("\n=== Mutants: each must FAIL its rule ===");
for (const [label, where, mutate] of MUTANTS) {
  const mut = mutate(src[where]);
  if (mut === src[where]) { check(`mutant bites: ${label} — the mutation did not apply`, false); continue; }
  let m;
  try { m = await measure({ ...src, [where]: mut }); } catch { m = null; }
  check(`mutant bites: ${label}`, !m || !run(RULES[label], m));
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
