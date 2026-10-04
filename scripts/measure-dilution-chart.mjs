// THE DILUTION CHART AT PHONE WIDTH, MEASURED (#552 COWORK #136).
//
// Renders DilutionHistory for committed SEC fixtures through the shipped
// builder, loads each in Chromium at each width inside a 16 px page gutter,
// reports anything wider than the page, and writes a 360 px screenshot per
// fixture to SHOTS (default /tmp): AAPL (a −9% drift) and AVAV (+99%).
//
//   node scripts/measure-dilution-chart.mjs        # widths 320 360 375 430
//
// NOT IN check-all: it needs Chromium and Playwright (installed globally).
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const SHOTS = path.resolve(process.env.SHOTS || "/tmp");
const B = await import("../lib/server/secShareHistory.ts");
const js = ts.transpileModule(fs.readFileSync("app/components/DilutionHistory.tsx", "utf8"), {
  fileName: "d.tsx", compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react" },
}).outputText;
const tmp = `scripts/.dilution-measure-${process.pid}.mjs`;
fs.writeFileSync(tmp, js);
const C = await import(`${process.cwd()}/${tmp}`).finally(() => fs.rmSync(tmp, { force: true }));

const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
const { chromium } = createRequire(path.join(globalRoot, "noop.js"))("playwright");
const browser = await chromium.launch();
let bad = 0;
for (const sym of (process.env.FIXTURES || "AAPL,AVAV").split(",")) {
  const set = JSON.parse(fs.readFileSync(`data/sec/factset-fixture-${sym}.json`, "utf8"));
  const data = B.buildShareHistory(set);
  const body = renderToStaticMarkup(React.createElement(C.default, { data, symbol: sym }));
  const file = path.join(SHOTS, `dilution-${sym}.html`);
  fs.writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0;padding:16px;background:#020617;color:#f8fafc;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}</style></head><body><div id="col">${body}</div></body></html>`);
  for (const width of (process.env.WIDTHS || "320,360,375,430").split(",").map(Number)) {
    const p = await browser.newPage({ viewport: { width, height: 1400 } });
    await p.goto(`file://${file}`);
    const r = await p.evaluate(() => ({ page: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }));
    const wide = r.page > r.view + 1;
    console.log(`${sym} ${width}px: ${wide ? `PAGE scrollWidth ${r.page} > ${r.view}` : "fits"}`);
    bad += wide ? 1 : 0;
    if (width === 360) await p.locator("#col").screenshot({ path: path.join(SHOTS, `dilution-${sym}-360.png`) });
    await p.close();
  }
}
await browser.close();
process.exit(bad ? 1 : 0);
