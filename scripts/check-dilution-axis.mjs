// THE DILUTION CHART DRAWS A FLAT SHARE COUNT FLAT (#535 COWORK #22 §3/§4).
//
// TSM, about 25.93bn shares since 2019: autoscaled to min..max, the rounding
// noise filled the plot and read as a five-year buyback. Rendered here, not
// grepped:
//   1. a flat series (±0.02%) spans under a tenth of the plot height;
//   2. a 15% dilution still fills the chart (the axis is not anchored at 0);
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
const DILUTER = series([100e6, 103e6, 106e6, 109e6, 112e6, 115e6]);
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
check("2. a 15% dilution still fills the chart (over 80%)", dil.range > 0.8 * H, `${dil.range.toFixed(1)} of ${H}`);
const labels = [...flat.html.matchAll(/text-anchor="end"[^>]*>([^<]+)</g)].map((m) => m[1]);
check("3. three right-hand labels in the page's share format", labels.filter((l) => /^\d+\.\d{2}B$/.test(l)).length === 3, labels.join(" | "));
check("4. two decimals, and 'Unchanged' under 0.01%",
  M.formatShareChange(-0.0231) === "-0.02%" && M.formatShareChange(0.004) === "Unchanged" && M.formatShareChange(15) === "+15.00%" && M.formatShareChange(null) === "—");
check("...and the trend cell keeps 'Roughly flat'", /Roughly flat/.test(flat.html));
{
  const old = await load(SRC.replace(
    "const { lo: minV, hi: maxV } = shareAxis(values);",
    "const minV = Math.min(...values); const maxV = Math.max(...values);"));
  check("MUTATION: the old min..max axis draws the flat series tall again", yRange(old, TSM).range > 0.8 * H);
}

if (failures) {
  console.log(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nA flat share count reads flat, and real dilution still fills the chart.");
