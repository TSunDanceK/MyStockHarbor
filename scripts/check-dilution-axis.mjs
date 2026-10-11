// THE DILUTION CHART DRAWS A FLAT SHARE COUNT FLAT (#535 COWORK #22 §3/§4).
//
// TSM, about 25.93bn shares since 2019: autoscaled to min..max, the rounding
// noise filled the plot and read as a five-year buyback. Rendered here, not
// grepped:
//   1. a flat series (±0.02%) spans under a tenth of the plot height;
//   2. a heavy diluter (+100%) still fills the chart (the axis is not anchored
//      at 0), and since #552 COWORK #136 a −5.5% drift (AAPL's) takes about a
//      quarter of it rather than the whole height;
//   3. three right-hand axis labels in the page's share format;
//   4. the change reads to two decimals, "Unchanged" under 0.01%;
//   plus a MUTATION: the old min..max axis must redraw the flat series tall.
import fs from "node:fs";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const SRC = fs.readFileSync("app/components/DilutionHistory.tsx", "utf8");
async function load(src) {
  const js = ts.transpileModule(src, {
    fileName: "dilution.tsx",
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react" },
  }).outputText;
  const tmp = `scripts/.dilution-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`;
  fs.writeFileSync(tmp, js);
  try { return await import(`${process.cwd()}/${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
}
const series = (vals) => ({ points: vals.map((shares, i) => ({ date: `${2019 + i}-12-31`, shares })), basis: "year" });
const TSM = series([25.93e9, 25.932e9, 25.93e9, 25.929e9, 25.931e9, 25.925e9]);
const DILUTER = series([100e6, 120e6, 140e6, 160e6, 180e6, 200e6]);
/** AAPL's drift as the owner saw it: −5.5% over the window. */
const DRIFT = series([15.51e9, 15.38e9, 15.22e9, 15.03e9, 14.84e9, 14.657e9]);
const H = 220 - 14 - 26; // plot height, as the component computes it

function yRange(M, data) {
  const html = renderToStaticMarkup(React.createElement(M.default, { data, symbol: "X" }));
  const pts = (html.match(/<polyline points="([^"]+)"/) ?? [])[1].split(" ").map((p) => Number(p.split(",")[1]));
  return { html, range: Math.max(...pts) - Math.min(...pts) };
}

const M = await load(SRC);
const flat = yRange(M, TSM);
const dil = yRange(M, DILUTER);
check("1. a flat share count draws flat (under 10% of the plot height)", flat.range < 0.1 * H, `${flat.range.toFixed(1)} of ${H}`);
check("2. a +100% diluter still fills the chart (over 80%)", dil.range > 0.8 * H, `${dil.range.toFixed(1)} of ${H}`);
const drift = yRange(M, DRIFT);
check("2b. a −5.5% drift looks like 5%: under 40% of the height, not the whole chart (#552 COWORK #136)",
  drift.range < 0.4 * H && drift.range > 0.1 * H, `${drift.range.toFixed(1)} of ${H}`);
const labels = [...flat.html.matchAll(/text-anchor="end"[^>]*>([^<]+)</g)].map((m) => m[1]);
check("3. three right-hand labels in the page's share format", labels.filter((l) => /^\d+\.\d{2}B$/.test(l)).length === 3, labels.join(" | "));
check("4. two decimals, and 'Unchanged' under 0.01%",
  M.formatShareChange(-0.0231) === "-0.02%" && M.formatShareChange(0.004) === "Unchanged" && M.formatShareChange(15) === "+15.00%" && M.formatShareChange(null) === "—");
// THE TREND WORDS COME FROM THE 3-YEAR FIGURE NOW (#552 COWORK #89 §5): a
// flat count over three years reads "roughly unchanged", hedged.
check("...and a flat 3-year count reads 'roughly unchanged'",
  M.threeYearWords(-0.02).label === "Share count roughly unchanged over the last 3 years" && M.threeYearWords(-0.02).tone === "flat");
{
  const old = await load(SRC.replace(
    "const { lo: minV, hi: maxV } = shareAxis(values);",
    "const minV = Math.min(...values); const maxV = Math.max(...values);"));
  check("MUTATION: the old min..max axis draws the flat series tall again", yRange(old, TSM).range > 0.8 * H);
}
{
  const narrow = await load(SRC.replace("export const SHARE_AXIS_MIN_HALF_SPAN = 0.1;", "export const SHARE_AXIS_MIN_HALF_SPAN = 0.025;"));
  check("MUTATION: the old ±2.5% floor draws a −5.5% drift full height again (caught by 2b)", yRange(narrow, DRIFT).range >= 0.4 * H);
}

if (failures) {
  console.log(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nA flat share count reads flat, and real dilution still fills the chart.");
