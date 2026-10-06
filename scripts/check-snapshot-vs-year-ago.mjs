// THE STOCK PAGE'S EARNINGS SNAPSHOT CARD, #563 COWORK #123 §3: rules, then mutants.
//
// The card (app/components/LatestEarningsCard.tsx) through the shipped module
// graph (scripts/lib/render-snapshot.mjs), on a real fact-set fixture, with the
// figures the rules need set on the snapshot:
//   - the tiles coloured against the same quarter a year earlier
//     (lib/snapshotVsYearAgo.ts): EPS higher green / lower red, two losses
//     narrowed green / widened red with the words; margins ±0.5 pt green /
//     red, uncoloured between, "▲ 2.1 pt vs Q2 FY2025"; no year-ago figure
//     uncoloured and said; the tint is the earnings page's (toneTint)
//   - the year-ago figures are the view's own (yearAgoOf), not recomputed
//   - the partial-score paragraph behind a tap, one muted line in its place
//   - the chart to the card's edges: scale labels inside the plot, the newest
//     margin in the legend, never floating on the plot
// A mutant each. Chromium's no-overlap measure for the chart's labels is
// scripts/snapshot-chart-measure.mjs (not in check-all: it needs a browser).
//
//   node scripts/check-snapshot-vs-year-ago.mjs
import fs from "node:fs";
import { loadSnapshot, html, visibleText, once, React } from "./lib/render-snapshot.mjs";

let failures = 0;
const check = (name, ok, detail = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) failures++; };
const run = (rule, m) => { try { return !!rule(m); } catch { return false; } };

const fixture = (sym) => JSON.parse(fs.readFileSync(`data/sec/factset-fixture-${sym}.json`, "utf8"));
const snapshotFor = (M, sym) => {
  const set = fixture(sym);
  const view = M.buildSecEarningsView(set);
  const score = M.scoreFromSec(view, sym, { status: "ready", set, cold: false });
  return { view, snap: M.buildSecEarningsSnapshot({ symbol: sym, view, score, reported: null, nextReport: { kind: "none" } }) };
};
const money = (v) => `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
const PRES = fs.readFileSync("lib/server/secPresentation.ts", "utf8");

async function measure(mutate) {
  const M = await loadSnapshot(mutate);
  const { view, snap } = snapshotFor(M, "AAPL");
  const label = "Q2 FY2025";
  const at = (over) => ({ ...snap, comparedWith: label, ...over });
  const eps = (now, then) => at({ eps: { ...snap.eps, value: now, emptyReason: null }, epsYoY: { kind: "none" }, yearAgo: { label, eps: then, gross: 42.9, operating: 30 } });
  const render = (s) => html(React.createElement(M.default, { snapshot: s, symbol: "AAPL" }));
  const tile = (markup, name) => {
    const i = markup.indexOf(`>${name}</div>`);
    const start = markup.lastIndexOf("<div style=\"border:", i);
    return markup.slice(start, markup.indexOf("</div></div>", i) + 12);
  };
  const margins = at({ margins: { gross: 45, operating: 30.3, net: 20 }, marginReasons: { gross: null, operating: null, net: null }, yearAgo: { label, eps: 1, gross: 42.9, operating: 30 } });
  const partial = at({ partial: true, toneLabel: "Partial · 4 of 5 measured", partialNote: "1 of 5 score inputs wasn't measured (EPS growth — diluted EPS negative in both quarters), so this score isn't comparable." });
  return {
    M, view, snap, label,
    html: {
      up: render(eps(1.2, 1.0)), down: render(eps(0.8, 1.0)), narrowed: render(eps(-0.1, -0.3)), widened: render(eps(-0.5, -0.3)),
      none: render(at({ yearAgo: null, eps: { ...snap.eps, value: 1, emptyReason: null } })), margins: render(margins), partial: render(partial), plain: render(snap),
    },
    tile,
  };
}

const RULES = {
  "EPS: higher green, lower red; two losses narrowed green / widened red, said; no year-ago figure uncoloured and said": ({ M }) => {
    const v = (a, b) => M.epsVsYearAgo(a, b, money);
    return v(1.2, 1).tone === "good" && v(1.2, 1).words === null && v(0.8, 1).tone === "weak" &&
      v(-0.1, -0.3).tone === "good" && v(-0.1, -0.3).words === "loss narrowed from -$0.30" &&
      v(-0.5, -0.3).tone === "weak" && v(-0.5, -0.3).words === "loss widened from -$0.30" &&
      v(1, null).tone === null && v(1, null).words === "no year-ago figure" && v(null, 1).tone === null && v(0.5, -0.2).tone === "good" && v(1, 1).tone === null;
  },
  "margins: up or down by 0.5 pt green / red, uncoloured between; '▲ 2.1 pt vs Q2 FY2025'; no year-ago figure said": ({ M, label }) => {
    const v = (a, b) => M.marginVsYearAgo(a, b, label);
    return v(45, 42.9).tone === "good" && v(45, 42.9).words === "▲ 2.1 pt vs Q2 FY2025" && v(40, 41).tone === "weak" && v(40, 41).words === "▼ 1.0 pt vs Q2 FY2025" &&
      v(40.3, 40).tone === null && v(40.3, 40).words === "▲ 0.3 pt vs Q2 FY2025" && v(40, 40).words === "level with Q2 FY2025" &&
      v(40.5, 40).tone === "good" && v(40, null).tone === null && v(40, null).words === "no year-ago figure";
  },
  "the same bands and tint as the earnings page (MARGIN_BAND_PP, toneTint)": ({ M }) =>
    new RegExp(`export const MARGIN_BAND_PP = ${M.MARGIN_STEP_PT};`).test(PRES) &&
    PRES.includes(`if (tone === "good") return "${M.VS_TINT.good}";`) && PRES.includes(`if (tone === "weak") return "${M.VS_TINT.weak}";`),
  "the year-ago figures are the view's own: EPS from incomeTrendBase, margins from the row of the comparison period": ({ M, view, snap }) => {
    const ya = M.yearAgoOf(view), row = view.margins.find((r) => r.label === view.snapshot.comparedWith);
    return !!ya && ya.label === snap.comparedWith && ya.eps === view.incomeTrendBase.then.epsDiluted && ya.gross === row.gross && ya.operating === row.operating &&
      JSON.stringify(snap.yearAgo) === JSON.stringify(ya) && view.margins.at(-1).label !== ya.label;
  },
  "the tiles: the tint and the words on the card, uncoloured without a year-ago figure": ({ html, tile }) =>
    tile(html.up, "EPS (diluted)").includes("rgba(34,197,94,0.08)") && tile(html.down, "EPS (diluted)").includes("rgba(239,68,68,0.08)") &&
    tile(html.narrowed, "EPS (diluted)").includes("rgba(34,197,94,0.08)") && visibleText(html.narrowed).includes("loss narrowed from -$0.30") &&
    tile(html.widened, "EPS (diluted)").includes("rgba(239,68,68,0.08)") &&
    !/rgba\((34,197,94|239,68,68),0\.08\)/.test(tile(html.none, "EPS (diluted)")) && visibleText(html.none).includes("no year-ago figure") &&
    tile(html.margins, "Gross margin").includes("rgba(34,197,94,0.08)") && visibleText(html.margins).includes("▲ 2.1 pt vs Q2 FY2025") &&
    !/rgba\((34,197,94|239,68,68),0\.08\)/.test(tile(html.margins, "Operating margin")) && visibleText(html.margins).includes("▲ 0.3 pt vs Q2 FY2025"),
  "the partial-score paragraph behind a tap; one muted line in its place": ({ M, html }) =>
    M.partialLine("Partial · 4 of 5 measured") === "1 input not measured: tap for why" && M.partialLine("Partial · 3 of 5 measured") === "2 inputs not measured: tap for why" &&
    /<details data-snapshot-partial=""[^>]*><summary[^>]*font-size:var\(--fs-label\)[^>]*>1 input not measured: tap for why<\/summary><div style="[^"]*font-size:var\(--fs-read\)[^"]*">1 of 5 score inputs/.test(html.partial) &&
    (html.partial.match(/1 of 5 score inputs/g) ?? []).length === 1 && html.partial.indexOf("data-snapshot-partial") < html.partial.indexOf("data-snapshot-chart"),
  "the chart to the card's edges: scale labels inside the plot, the newest margin in the legend, not on the plot": ({ html }) => {
    const svg = /<div style="margin-top:14px" data-snapshot-chart="">(<svg[\s\S]*?<\/svg>)/.exec(html.plain)?.[1] ?? "";
    const legend = /data-snapshot-legend="">([\s\S]*?)<\/div>/.exec(html.plain)?.[1] ?? "";
    return /viewBox="0 0 320 150"/.test(svg) && !/data-margin-latest/.test(svg) && /data-margin-latest/.test(legend) &&
      /<text data-scale="l" x="2"[^>]*text-anchor="start"/.test(svg) && /<text data-scale="r" x="318"[^>]*text-anchor="end"/.test(svg) &&
      /<line x1="2" x2="318"/.test(svg);
  },
};

const MUTANTS = [
  ["EPS:", (s) => once('{ tone: "good", words: `loss narrowed from ${money(then)}` } : { tone: "weak", words: `loss widened from ${money(then)}` }', '{ tone: "weak", words: `loss widened from ${money(then)}` } : { tone: "good", words: `loss narrowed from ${money(then)}` }')(s)],
  ["EPS:", (s) => once('if (!fin(then)) return { tone: null, words: NO_YEAR_AGO };\n  const same', 'if (!fin(then)) return { tone: "good", words: null };\n  const same')(s)],
  ["margins:", (s) => once("export const MARGIN_STEP_PT = 0.5;", "export const MARGIN_STEP_PT = 0;")(s)],
  ["margins:", (s) => once('${d > 0 ? "▲" : "▼"}', '${d > 0 ? "▼" : "▲"}')(s)],
  ["the same bands", (s) => once('good: "rgba(34,197,94,0.08)"', 'good: "rgba(34,197,94,0.2)"')(s)],
  ["the year-ago figures", (s) => once("const m = view.margins.find((r) => r.label === label && !r.marginsRefused) ?? null;", "const m = view.margins.at(-1) ?? null;")(s)],
  ["the tiles:", (s) => once("const tint = tone === \"good\" || tone === \"weak\" ? VS_TINT[tone] : null;", "const tint = null as string | null;")(s)],
  ["the tiles:", (s) => once("meta={snapshot.marginReasons.gross ?? grossVs.words} tone={snapshot.marginReasons.gross ? undefined : toneOf(grossVs.tone)}", "meta={snapshot.marginReasons.gross}")(s)],
  ["the partial-score", (s) => once('<details data-snapshot-partial="" style={earningsHowStyle}>\n          <summary style={partialSummaryStyle}>{partialLine(snapshot.toneLabel)}</summary>\n          <div style={earningsHowBodyStyle}>{snapshot.partialNote}</div>\n        </details>', "<div style={earningsFootnoteStyle}>{snapshot.partialNote}</div>")(s)],
  ["the chart to", (s) => once("const CHART_PAD_L = 2;", "const CHART_PAD_L = 58;")(s)],
  ["the chart to", (s) => once("{segments.map((d) => (", '{last ? <text data-margin-latest="" x={last.x} y={last.y - 6}>{formatLevel(last.v)}</text> : null}\n        {segments.map((d) => (')(s)],
];

console.log("=== Rules ===");
const base = await measure();
for (const [label, rule] of Object.entries(RULES)) check(label, run(rule, base));

console.log("\n=== Mutants: each must FAIL its rule ===");
const R = Object.keys(RULES);
for (const [start, mutate] of MUTANTS) {
  const label = R.find((x) => x.startsWith(start));
  if (!label) { check(`mutant: no rule starts "${start}"`, false); continue; }
  let m = null;
  try { m = await measure(mutate); } catch (e) { if (/once|anchor|match/i.test(String(e))) { check(`mutant bites: ${label} — the mutation did not apply (${String(e).slice(0, 80)})`, false); continue; } }
  check(`mutant bites: ${label}`, !m || !run(RULES[label], m));
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
