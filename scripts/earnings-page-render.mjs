// THE EARNINGS PAGE'S SEC SECTIONS, RENDERED STANDALONE — for reading the
// visible text and for screenshots, from a committed fact-set fixture.
//
// The sandbox cannot reach a Vercel preview or the production domain, so this
// is the nearest thing to the page it can see: the page's ACTUAL <style>
// block, the ACTUAL score card and cards in the order page.tsx mounts them,
// rendered with react-dom/server from data/sec/factset-fixture-<SYM>.json.
// Price-dependent cards take PRICE / PRICE_ON from the environment, because a
// fixture holds filings, not a price.
//
//   FIXTURE=AVAV PRICE=164.31 PRICE_ON=2026-09-21 OUT=/tmp/avav.html \
//     node scripts/earnings-page-render.mjs          # prints visible text
//
// NOT IN check-all: it asserts nothing. The checks that do assert on this
// output are check-earnings-render and check-sec-earnings-page.
import fs from "node:fs";
import { loadCards, loadReactionCharts, html, visibleText, React } from "./lib/render-cards.mjs";

const SYM = (process.env.FIXTURE || "AVAV").toUpperCase();
const PAGE = fs.readFileSync("app/stock/[symbol]/earnings/page.tsx", "utf8");
const open = PAGE.indexOf("<style>{`");
const close = PAGE.indexOf("`}</style>", open);
if (open < 0 || close < 0) { console.error("FATAL: could not find the style block"); process.exit(2); }

const M = await loadCards();
const set = JSON.parse(fs.readFileSync(`data/sec/factset-fixture-${SYM}.json`, "utf8"));
const view = M.buildSecEarningsView(set);
const score = M.scoreFromSec(view, SYM, { status: "ready" });
const coverage = M.coverageOf(score);
// The score card's colours are interpolated from the score's tone in page.tsx.
const CSS = PAGE.slice(open + "<style>{`".length, close)
  .replace(/\$\{toneColor\(score\.tone\)\}/g, M.toneColor(score.tone))
  .replace(/\$\{toneBg\(score\.tone\)\}/g, M.toneBg(score.tone));

const today = process.env.TODAY || new Date().toISOString().slice(0, 10);
const price = process.env.PRICE ? Number(process.env.PRICE) : null;
const priceOn = process.env.PRICE_ON || today;
const el = (C, props) => { try { return html(React.createElement(C, props)); } catch (e) { return `<!-- ${C.name}: ${e.message} -->`; } };

// The hero's EPS-basis line, when the page has one (it moved there from four
// cards). Absent from an older page, which is what a before-render needs.
const heroNote = /heroNote/.test(PAGE) ? `<p class="earningsDataNote heroNote">${M.epsBasisNote(view.accounting)}</p>` : "";
const sections = [
  ["hero", heroNote],
  ["score", el(M.SecScoreCard, { symbol: SYM, score, coverage })],
  ["snapshot", el(M.SecSnapshotCard, { view, pending: null })],
  ["growth", view.tableBasis === "year" ? "" : el(M.SecGrowthMarginsCard, { view })],
  ["annual", el(M.SecAnnualCard, { view, sole: view.tableBasis === "year" })],
  ["trend", el(M.SecTrendSummaryCard, { view })],
  ["valuation", el(M.SecValuationCard, { view, inputs: M.valuationInputs(set, today), price, priceAsOf: priceOn, today })],
  ["cash", el(M.SecCashQualityCard, { view })],
  ["balance", el(M.SecBalanceSheetCard, { view })],
];
// THE PRICE-REACTION CARD, when REACTION=<json> is given: rows as
// scripts/reaction-window-diagnosis.mjs prints them (REACTION_JSON), oldest
// first, from the shipped computeEarningsReactionDetail over the cached bars.
// Labels come from the fixture's own quarters by period end.
if (process.env.REACTION) {
  const R = await loadReactionCharts();
  const rows = JSON.parse(fs.readFileSync(process.env.REACTION, "utf8"));
  const byEnd = new Map((set.quarters ?? []).map((q) => [q.e, q]));
  const label = (r) => {
    const q = byEnd.get(r.periodEnd);
    const hit = view.recentPeriods?.find((p) => p.end === r.periodEnd)?.label;
    return hit ?? (q ? `${q.fp} FY${q.fy}` : r.periodEnd);
  };
  const qs = rows.map((r) => ({ ...r, label: label(r) }));
  const latest = [...qs].reverse().find((q) => q.reactionPct != null) ?? null;
  sections.push(["reaction", el(R.PriceReactionCard, {
    symbol: SYM, latest, reaction: qs.map((q) => ({ label: q.label, value: q.reactionPct })), drift: qs,
    datesFromSec: true, uncoveredLabels: qs.filter((q) => q.reason === "uncovered").map((q) => q.label), noPriceHistoryNote: "",
  })]);
}
const side = [
  ["income", el(M.SecIncomeStatementCard, { view })],
  ["recent", el(M.SecRecentPeriodsCard, { view })],
];

let words = 0;
for (const [name, markup] of [...sections, ...side]) {
  const t = visibleText(markup);
  const n = t ? t.split(/\s+/).length : 0;
  words += n;
  console.log(`\n── ${name} (${n} words)\n${t}`);
}
console.log(`\nTOTAL ${words} words`);

const scheme = process.env.SCHEME || "dark";
fs.writeFileSync(process.env.OUT || `/tmp/earnings-${SYM}.html`, `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="${scheme}">
<style>${CSS}</style>
</head><body class="earningsPage" style="margin:0"><main class="earningsPage"><div class="earningsWrap">
  <section class="hero"><div><h1>${SYM} Stock Earnings, EPS &amp; Revenue Breakdown</h1>${sections[0][1]}</div>${sections[1][1]}</section>
  <section class="contentGrid">
    <div style="display: grid; gap: 18px">${sections.slice(2).map((s) => s[1]).join("\n")}</div>
    <aside class="sideColumn">${side.map((s) => s[1]).join("\n")}</aside>
  </section>
</div></main></body></html>`);
