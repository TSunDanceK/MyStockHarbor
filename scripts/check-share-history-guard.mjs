// THE DILUTION CHART WITHHOLDS ITS FIGURES ON A BROKEN SERIES (#552 COWORK #89).
//
// Interim guard until the series fix: a split-ratio step, a >100x step or a
// gap over 15 months hides the "Since" % and the Trend label, keeps the line,
// and says so. Rendered, not grepped. Series shapes are the probe's own
// (CODE-A #94, SEC share counts):
//   1. AMZN 2019 -> 2020 at 20:1           -> withheld (split-step)
//   2. PAC x1000 from 2017                 -> withheld (scale-step)
//   3. GDDY 2016 -> 2023, no points between -> withheld (gap)
//   4. NVDA 2008-09 in thousands           -> withheld (scale-step)
//   5. a steady diluter, a flat large cap  -> figures shown, no notice
//   6. the line is still drawn when withheld
//   plus MUTATIONS: the guard dropped, and the gap rule dropped.
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
  const tmp = `scripts/.share-guard-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`;
  fs.writeFileSync(tmp, js);
  try { return await import(`${process.cwd()}/${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
}
const pts = (pairs) => ({ points: pairs.map(([date, shares]) => ({ date, shares })), basis: "annual+quarters" });
const AMZN = pts([["2017-12-31", 480e6], ["2018-12-31", 487e6], ["2019-12-31", 494e6], ["2020-12-31", 10005e6], ["2021-12-31", 10117e6], ["2022-12-31", 10189e6]]);
const PAC = pts([["2015-12-31", 525575547], ["2016-12-31", 525575547], ["2017-12-31", 525575547000], ["2018-12-31", 525575547000]]);
const GDDY = pts([["2013-12-31", 38826000], ["2014-12-31", 38826000], ["2015-12-31", 58676000], ["2016-12-31", 79835000], ["2023-12-31", 148296000], ["2024-06-30", 141269000], ["2024-09-30", 140523000]]);
const NVDA = pts([["2008-01-27", 550108], ["2009-01-25", 548126], ["2010-01-31", 549574000], ["2011-01-30", 575177000]]);
const DILUTER = pts([["2019-12-31", 100e6], ["2020-12-31", 106e6], ["2021-12-31", 112e6], ["2022-12-31", 118e6], ["2023-12-31", 125e6]]);
const FLAT = pts([["2023-03-31", 25.93e9], ["2023-06-30", 25.932e9], ["2023-09-30", 25.93e9], ["2024-03-31", 25.929e9], ["2024-06-30", 25.931e9]]);

const render = (M, data) => renderToStaticMarkup(React.createElement(M.default, { data, symbol: "X" }));
const withheld = (html) => html.includes("figures hidden for now");
const shown = (html) => /More shares outstanding|Fewer shares outstanding|Roughly flat/.test(html) && /[+-]\d+\.\d{2}%|Unchanged/.test(html);

const M = await load(SRC);
for (const [name, data, why] of [["1. AMZN's 20:1 split", AMZN, "split-step"], ["2. PAC's x1000 step", PAC, "scale-step"], ["3. GDDY's 2016-2023 gap", GDDY, "gap"], ["4. NVDA's thousands", NVDA, "scale-step"]]) {
  const html = render(M, data);
  check(`${name}: figures withheld, reason ${why}`, withheld(html) && !shown(html) && html.includes(`data-share-history-defect="${why}"`));
}
for (const [name, data] of [["5a. a steady 25% diluter", DILUTER], ["5b. a flat large cap", FLAT]]) {
  const html = render(M, data);
  check(`${name}: figures shown, no notice`, shown(html) && !withheld(html));
}
check("6. the line is still drawn when withheld", /<polyline points="[^"]+"/.test(render(M, AMZN)));
check("...a 2x step within 3% is a split step; a 1.9x step is not",
  M.shareHistoryDefect(pts([["2020-12-31", 100], ["2021-12-31", 201]]).points) === "split-step" &&
  M.shareHistoryDefect(pts([["2020-12-31", 100], ["2021-12-31", 190]]).points) === null);
{
  const off = await load(SRC.replace("const defect = shareHistoryDefect(points);", "const defect = null;"));
  check("MUTATION: without the guard, AMZN prints a confident dilution figure again", shown(render(off, AMZN)) && !withheld(render(off, AMZN)));
}
{
  const noGap = await load(SRC.replace("if (!found && days > SHARE_GAP_MAX_DAYS) found = \"gap\";", ""));
  check("MUTATION: without the gap rule, GDDY's straight-line rise is summarised again", shown(render(noGap, GDDY)));
}

if (failures) {
  console.log(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nA broken share series keeps its line and withholds its figures.");
