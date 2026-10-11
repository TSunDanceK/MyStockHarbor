// BULLET FRAGMENTATION — measured, because the obvious detector was wrong.
//
// `.bulletList li` is a two-column grid (12px minmax(0, 1fr)) with ::before as
// the dot. A plain-text bullet is ONE anonymous grid item and lands in column
// two. A bullet containing a <strong> is not: the <strong> is its own grid
// item and each text run around it becomes another, so they flow across both
// tracks and whatever lands in the 12px column wraps a word per line.
//
// THE FIRST VERSION OF THIS SCRIPT COULD NOT SEE THAT. It counted line boxes,
// and a <strong> squeezed into a 12px track still reports ONE client rect —
// the union of its stacked word boxes — so it printed "flows inline" for the
// broken markup. Verified by stripping the fix back out and re-running: the
// WIDTH is the signal (12px fragmented, 210px flowing), not the line count.
//
// REQUIRES PLAYWRIGHT, which is not a repo dependency — install it in a
// scratch directory and run from there, the same as
// scripts/layout-overlap-measure.mjs. Not named check-* deliberately, so
// check-all does not discover a script it cannot run.
// Does each bullet flow as ONE run, or fragment across the grid tracks?
import fs from "node:fs";
import { chromium } from "playwright";
import { loadCards, html, React } from "./lib/render-cards.mjs";

const PAGE = fs.readFileSync("app/stock/[symbol]/earnings/page.tsx", "utf8");
const o = PAGE.indexOf("<style>{`"), c = PAGE.indexOf("`}</style>", o);
const CSS = PAGE.slice(o + "<style>{`".length, c);

const M = await loadCards();
const card = html(React.createElement(M.SecNoRegistrantCard, { symbol: "MSTY" }));
fs.writeFileSync("/tmp/bul.html", `<!doctype html><meta charset="utf-8"><style>${CSS}</style>
<body class="earningsPage"><div class="earningsWrap"><div style="max-width:760px">${card}</div></div></body>`);

const b = await chromium.launch();
const p = await b.newPage({ viewportSize: { width: 1280, height: 900 } });
await p.goto("file:///tmp/bul.html");
const out = await p.evaluate(() => {
  const lis = [...document.querySelectorAll(".bulletList li")];
  return lis.map((li) => {
    // How many DISTINCT left-edges do the strong's client rects have vs the
    // surrounding text? A fragmented bullet puts <strong> in the narrow track.
    const strong = li.querySelector("strong");
    const sr = strong.getBoundingClientRect();
    const liR = li.getBoundingClientRect();
    // Count line boxes the <strong> occupies: >1 with a tiny width means it is
    // wrapping a word per line.
    const rects = [...strong.getClientRects()];
    return {
      text: strong.textContent.trim(),
      strongWidth: Math.round(sr.width),
      strongLines: rects.length,
      liWidth: Math.round(liR.width),
      contentLeft: Math.round(sr.left - liR.left),
    };
  });
});
await b.close();
for (const r of out) {
  // THE WIDTH IS THE TELL, NOT THE LINE COUNT. A <strong> squeezed into the
  // 12px dot track still reports ONE client rect — the union of its stacked
  // word boxes — so counting line boxes says "flows inline" for the broken
  // case and the harness agrees with whatever it is shown. Measured: 12px
  // when fragmented, 210px and 336px when flowing.
  const bad = r.strongWidth <= 20;
  console.log(`"${r.text}"`);
  console.log(`   width ${r.strongWidth}px in an li of ${r.liWidth}px, ${r.strongLines} line box(es), starts ${r.contentLeft}px in`);
  console.log(`   ${bad ? "*** FRAGMENTED — stacking in the narrow track ***" : "flows inline"}`);
}
