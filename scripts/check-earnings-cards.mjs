// THE THREE EARNINGS-PAGE CARDS FROM 2 OCT (#552 COWORK #95/#96/#97/#122).
//
//   S. Score card: the explanation sits in a native <details> ("About this
//      score") in the server HTML; one visible line states how much was
//      measured and, when it says something, the range; the bar outlines the
//      reachable range at full strength and dims the ends; the margin copy nit.
//   N. Next report card: one heading; the detail ("How this is estimated") in a
//      native <details>; no ISO date. (The window line itself is
//      check-next-report-band's.)
//   B. Balance sheet card: a readable date; refusals read "Not available" with
//      the reason in the shared hover/tap note; every bar has its figure; no
//      track for a row with no value; the "Not reported" sentence only when a
//      row says it.
//   C. The CSS that keeps bar rows and the waterfall inside the card at phone
//      width (scripts/measure-earnings-cards-360.mjs is the rendered
//      measurement: no card overflows at 320/360/375/430 px).
//   I. No ISO date in any SEC card's visible text, across five fixtures.
//   plus MUTANTS, one per rule, each caught. A missing mutation anchor fails.
//
//   node scripts/check-earnings-cards.mjs
import fs from "node:fs";
import { loadCards, loadNextReportCard, html, visibleText, React } from "./lib/render-cards.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (src, from, to) => {
  const n = src.split(from).length - 1;
  if (n !== 1) throw Object.assign(new Error(`mutation anchor matched ${n} times: ${from.slice(0, 70)}`), { anchor: true });
  return src.replace(from, to);
};
const fixture = (s) => JSON.parse(fs.readFileSync(`data/sec/factset-fixture-${s}.json`, "utf8"));
const PAGE = fs.readFileSync("app/stock/[symbol]/earnings/page.tsx", "utf8");
const ISO = /\b\d{4}-\d{2}-\d{2}\b/;
const el = React.createElement;

// ── S + B + I: the cards, from fixtures ────────────────────────────────────
async function measureCards(M) {
  const set = fixture("ONDS");
  const view = M.buildSecEarningsView(set);
  const score = M.scoreFromSec(view, "ONDS", { status: "ready" });
  const coverage = M.coverageOf(score);
  const scoreHtml = html(el(M.SecScoreCard, { symbol: "ONDS", score, coverage }));
  const balanceHtml = html(el(M.SecBalanceSheetCard, { view }));
  const iso = [];
  for (const sym of ["AVAV", "ONDS", "AAPL", "KGC", "TSLA"]) {
    const s = fixture(sym), v = M.buildSecEarningsView(s);
    const parts = [
      el(M.SecSnapshotCard, { view: v, pending: null }), el(M.SecRecentPeriodsCard, { view: v }),
      el(M.SecAnnualCard, { view: v, sole: v.tableBasis === "year" }), el(M.SecBalanceSheetCard, { view: v }),
      el(M.SecValuationCard, { view: v, inputs: M.valuationInputs(s, "2026-10-02"), price: 100, priceAsOf: "2026-10-02", today: "2026-10-02" }),
    ];
    for (const p of parts) {
      const markup = html(p);
      const t = visibleText(markup);
      const m = t.match(ISO) ?? markup.match(/title="[^"]*\d{4}-\d{2}-\d{2}[^"]*"/);
      if (m) iso.push(`${sym}: ${m[0]}`);
    }
  }
  return { score, coverage, scoreHtml, balanceHtml, iso, view };
}

const RULES = {
  "S1. 'About this score' is a native <details> in the server HTML, holding the explanation and the partial note":
    ({ scoreHtml, score }) => {
      const d = scoreHtml.match(/<details class="cardDetails scoreAbout"><summary>About this score<\/summary>([\s\S]*?)<\/details>/);
      return Boolean(d) && visibleText(d[1]).includes(score.explanation.slice(0, 60)) && /Not directly comparable with a full score/.test(d[1])
        && !visibleText(scoreHtml.replace(d[0], "")).includes(score.explanation.slice(0, 60));
    },
  "S2. one visible line states the measures and the range (ONDS: 3 of 5, between 10 and 90)":
    ({ scoreHtml, coverage }) => new RegExp(`data-score-summary="">Partial score: ${coverage.measured} of ${coverage.total} measures available, so the full score could fall between ${coverage.low} and ${coverage.high}\\.<`).test(scoreHtml),
  "S3. the bar outlines the reachable range and dims only the ends, labelled 'possible range'":
    ({ scoreHtml }) => (scoreHtml.match(/data-score-out=""/g) ?? []).length === 2 && /data-score-reach=""/.test(scoreHtml) && /possible range/.test(scoreHtml),
  "S4. the margin copy: its own sentence, 'and the quarter was loss-making', no 'though'":
    ({ score }) => /Operating margin is not meaningful here: revenue is too small relative to costs, and the quarter was loss-making\. Later filings may show whether that continues\./.test(score.explanation)
      && !/though the quarter/.test(score.explanation),
  "B1. the balance sheet's date reads '30 Jun 2026'":
    ({ balanceHtml }) => /Financial position at 30 Jun 2026/.test(balanceHtml) && !ISO.test(visibleText(balanceHtml)),
  "B2. refusals read 'Not available', the reason in the hover/tap note":
    ({ balanceHtml }) => (balanceHtml.match(/data-estimate-note="Can&#x27;t calculate[^"]*"[^>]*>Not available</g) ?? []).length === 2
      && !/Can.t calculate/.test(visibleText(balanceHtml)),
  "B3. the cash bar carries its figure on the label line":
    ({ balanceHtml }) => /<span class="hbarLabel">Cash &amp; equivalents[^<]*<\/span><span class="hbarValue">[^<]*\$\d/.test(balanceHtml),
  "B4. no bar track for a row with no value (ONDS: cash only)":
    ({ balanceHtml }) => (balanceHtml.match(/class="hbarTrack"/g) ?? []).length === 1,
  "B5. the 'Not reported' sentence only when a row says 'Not reported'":
    ({ balanceHtml }) => !/Not reported/.test(visibleText(balanceHtml)) && !/means the company.s SEC filing has no figure/.test(visibleText(balanceHtml)),
  "I1. no ISO date in the snapshot, tables, balance sheet or valuation, five fixtures":
    ({ iso }) => iso.length === 0,
};

const real = await measureCards(await loadCards());
for (const [name, rule] of Object.entries(RULES)) {
  let ok = false; try { ok = rule(real); } catch { ok = false; }
  check(name, ok, name.startsWith("I1") && real.iso.length ? real.iso.slice(0, 3).join("; ") : "");
}

const MUTANTS = [
  ["the explanation rendered outside the dropdown (client-only/visible)", (s) => once(s,
    `          <p style={{ marginTop: 10 }}>{score.explanation}</p>\n`, "")],
  ["the visible summary line dropped", (s) => once(s, `<p className="scoreSummary" data-score-summary="">`, `<p className="scoreSummary">`)],
  ["the ends no longer dimmed (only the outline)", (s) => s.split(`<div className="scoreOut" data-score-out=""`).join(`<div className="scoreOut"`)],
  ["'though' restored in the margin copy", (s) => once(s, "${profit ? `, and ${profit}` : \"\"}.`;", "${profit ? `, though ${profit}` : \"\"}.`;")],
  ["the ISO date back on the balance sheet heading", (s) => once(s, "<h3>Financial position at {readableDate(b.asOf)}</h3>", "<h3>Financial position as at {b.asOf}</h3>")],
  ["the long refusal back in the cell", (s) => once(s, "? <ReasonedValue text={NOT_AVAILABLE} reason={cantCalculate(missing)} style={MUTED_VALUE} />", "? <span style={MUTED_VALUE}>{cantCalculate(missing)}</span>")],
  ["the cash figure dropped from its bar", (s) => once(s, "          text: <CellValue cell={b.cash} compact />,", "          text: null,")],
  ["an empty track drawn for a missing value", (s) => once(s, "  if (value === null || !Number.isFinite(value) || max <= 0) return null;", "  if (value === null || !Number.isFinite(value) || max <= 0) return <div className=\"hbarTrack\" aria-hidden=\"true\" />;")],
  ["the 'Not reported' sentence on every card", (s) => once(s, "{balanceShowsNotReported(b) ? <p>{NOT_REPORTED_NOTE}</p> : null}", "<p>{NOT_REPORTED_NOTE}</p>")],
  ["the recent-periods table back on ISO dates", (s) => once(s, `<td data-label="Period ending">{readableDate(r.end)}</td>`, `<td data-label="Period ending">{r.end}</td>`)],
];
for (const [label, mutate] of MUTANTS) {
  let caught, why = "";
  try {
    const m = await measureCards(await loadCards(mutate));
    caught = Object.values(RULES).some((r) => { try { return !r(m); } catch { return true; } });
  } catch (e) { caught = !e?.anchor; if (e?.anchor) why = e.message; }
  check(`MUTATION: ${label} → caught`, caught, why);
}

// ── S3 (CSS) + C: the stylesheet ───────────────────────────────────────────
const cssRules = (css) => ({
  "S3c. CSS: the reachable range is an outline at full strength; the ends are dimmed":
    /\.scoreReach \{[^}]*background: transparent;[^}]*border: 2px solid/.test(css) && /\.scoreOut \{[^}]*background: rgba\(2,6,23,0\.\d+\)/.test(css),
  "C1. CSS: bar rows can't outgrow the card (min-width: 0, minmax(0, 1fr), the head wraps, the track is 100%)":
    /\.hbarList \{[^}]*grid-template-columns: minmax\(0, 1fr\);[^}]*min-width: 0;/.test(css) && /\.hbarRow \{[^}]*minmax\(0, 1fr\);[^}]*min-width: 0;/.test(css)
      && /\.hbarHead \{[^}]*flex-wrap: wrap;[^}]*min-width: 0;/.test(css) && /\.hbarTrack \{[^}]*box-sizing: border-box; width: 100%;/.test(css),
  "C2. CSS: the waterfall's track column is minmax(0, 1fr), at both widths":
    (css.match(/\.wfRow \{ [^}]*grid-template-columns: minmax\(\d+px, \d+%\) minmax\(0, 1fr\) minmax\(\d+px, auto\);/g) ?? []).length === 2,
  "C3. CSS: the dropdowns' summary has a visible focus ring":
    /\.cardDetails > summary:focus-visible \{ outline: 2px solid/.test(css),
});
for (const [name, ok] of Object.entries(cssRules(PAGE))) check(name, ok);
const cssMutants = [
  ["the reachable range dimmed again", once(PAGE, ".scoreReach { position: absolute; top: 0; bottom: 0; box-sizing: border-box; background: transparent;", ".scoreReach { position: absolute; top: 0; bottom: 0; box-sizing: border-box; background: rgba(2,6,23,0.55);")],
  ["the bar head no longer wraps", once(PAGE, ".hbarHead { display: flex; flex-wrap: wrap;", ".hbarHead { display: flex;")],
  ["the waterfall track back to 1fr", once(PAGE, ".wfRow { display: grid; grid-template-columns: minmax(96px, 22%) minmax(0, 1fr)", ".wfRow { display: grid; grid-template-columns: minmax(96px, 22%) 1fr")],
];
for (const [label, css] of cssMutants) check(`MUTATION: ${label} → caught`, Object.values(cssRules(css)).some((ok) => !ok));

// ── N: the Next report card ────────────────────────────────────────────────
const OUTLOOK = {
  symbol: "ONDS", kind: "beyond-window",
  headline: "ONDS is not expected to report in the next 30 days.",
  hedge: "Estimated from this company's own filing history — not a confirmed date, and not announced by the company.",
  evidence: ["Usually reports about 45 days after a period ends (last 15 periods)", "Last reported 2026-08-13, for the period ending 2026-06-30"],
  window: { line: "Mid-November 2026", estimate: true },
};
const nextRules = {
  "N1. one heading, 'Next report'": (h) => (h.match(/Next report/g) ?? []).length === 1 && !/Next expected report/.test(h),
  "N2. 'How this is estimated' is a native <details> holding the hedge and the evidence": (h) => {
    const d = h.match(/<details class="cardDetails"><summary>How this is estimated<\/summary>([\s\S]*?)<\/details>/);
    return Boolean(d) && /not a confirmed date/.test(d[1]) && /Usually reports about 45 days/.test(d[1]) && !/not a confirmed date/.test(h.replace(d[0], "").replace(/data-estimate-note="[^"]*"|title="[^"]*"|aria-label="[^"]*"/g, ""));
  },
  "N3. its dates read '13 Aug 2026', never ISO": (h) => /Last reported 13 Aug 2026, for the period ending 30 Jun 2026/.test(h) && !ISO.test(visibleText(h)),
};
const nextHtml = async (mutate) => { const { NextReportCard } = await loadNextReportCard(mutate); return html(el(NextReportCard, { outlook: OUTLOOK })); };
const nh = await nextHtml();
for (const [name, rule] of Object.entries(nextRules)) check(name, rule(nh));
const nextMutants = [
  ["the duplicate heading restored", (s) => once(s, "      <h3>Next report</h3>", "      <div className=\"eyebrow\">Next report</div>\n      <h3>Next expected report</h3>")],
  ["the detail printed outside a dropdown", (s) => once(s, `<details className="cardDetails">`, `<div className="cardDetails">`).replace("</details>", "</div>").replace(`<summary>{NEXT_REPORT_DETAILS_SUMMARY}</summary>`, "")],
  ["the evidence dates left ISO", (s) => once(s, "<li key={line}>{readableIsoDates(line)}</li>", "<li key={line}>{line}</li>")],
];
for (const [label, mutate] of nextMutants) {
  let caught, why = "";
  try { const h = await nextHtml(mutate); caught = Object.values(nextRules).some((r) => !r(h)); }
  catch (e) { caught = !e?.anchor; if (e?.anchor) why = e.message; }
  check(`MUTATION: ${label} → caught`, caught, why);
}

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
