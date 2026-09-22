// THE LAYOUT HARNESS — kept because reasoning about min-width was wrong once.
//
// I shipped `.contentGrid > * { min-width: 0 }`, reported the overlap fixed,
// and the owner found it still overlapping on the preview. The rule was in the
// deployment and was correct; it just stopped one level short. Reading CSS and
// arguing about it produced a confident wrong answer twice, so this asks
// Chromium instead.
//
// It builds a standalone page from the earnings page's ACTUAL <style> block
// and its ACTUAL rendered cards, in the nesting page.tsx uses, and
// scripts/layout-overlap-measure.mjs then reports whether the main column's
// painted content crosses into the aside.
//
//   node scripts/layout-overlap-harness.mjs && OUT=/tmp/h.html node scripts/layout-overlap-measure.mjs
//   FIXTURE=AAPL W=1280 EXTRA_CSS=".card { min-width: 0 }" ...
//
// NOT IN check-all: it needs a browser, and the suite must run without one.
// The measurements it produced are recorded at the rule in page.tsx, which is
// where someone changing that rule will look.
// A REAL LAYOUT MEASUREMENT, not an argument about min-width.
//
// Builds a standalone page with the earnings page's ACTUAL <style> block and
// the ACTUAL rendered cards, in the same nesting the page uses, so Chromium
// can be asked the only question that matters: does the left column's box
// cross into the aside's?
import fs from "node:fs";
import { loadCards, html, React } from "./lib/render-cards.mjs";

const PAGE = fs.readFileSync("app/stock/[symbol]/earnings/page.tsx", "utf8");
// The style block is the template literal between <style>{` and `}</style>.
const open = PAGE.indexOf("<style>{`");
const close = PAGE.indexOf("`}</style>", open);
if (open < 0 || close < 0) { console.error("FATAL: could not find the style block"); process.exit(2); }
const CSS = PAGE.slice(open + "<style>{`".length, close);
console.error(`css: ${CSS.length} chars, min-width rules: ${(CSS.match(/min-width: 0/g) ?? []).length}`);

const M = await loadCards();
const f = (s) => JSON.parse(fs.readFileSync(`data/sec/factset-fixture-${s}.json`, "utf8"));
const v = M.buildSecEarningsView(f(process.env.FIXTURE || "GEV"));

// THE LEFT COLUMN'S CARDS, as page.tsx mounts them: an inline-styled grid div
// inside .contentGrid. The table-bearing ones are the point.
const left = [M.SecSnapshotCard, M.SecGrowthMarginsCard, M.SecAnnualCard, M.SecRecentPeriodsCard]
  .map((C) => { try { return html(React.createElement(C, { view: v })); } catch { return ""; } })
  .join("\n");
const right = [M.SecIncomeStatementCard, M.SecCashQualityCard]
  .map((C) => { try { return html(React.createElement(C, { view: v })); } catch { return ""; } })
  .join("\n");

const EXTRA = process.env.EXTRA_CSS || "";
fs.writeFileSync(process.env.OUT || "/tmp/harness.html", `<!doctype html><html><head><meta charset="utf-8">
<style>${CSS}</style>
<style>${EXTRA}</style>
</head><body class="earningsPage"><div class="earningsWrap">
  <section class="contentGrid">
    <div id="mainColumn" style="display: grid; gap: 18px">${left}</div>
    <aside class="sideColumn" id="sideColumn">${right}</aside>
  </section>
</div></body></html>`);
console.error("harness written");
