// WHAT A READER ACTUALLY SEES — rendered, not scanned.
//
// ── WHY THIS EXISTS ALONGSIDE check-sec-earnings-page ──────────────────────
// That check reads the SOURCE, which is right for "is this hidden card
// registered" and wrong for "does the word `accession` reach a reader". A regex
// over JSX cannot tell a string that renders from one inside a branch that
// never runs, and it cannot see text assembled from two expressions. Three
// findings in a row were about OUTPUT: an internal citation live on the page,
// a database key in prose, and a hidden card that should render nothing.
//
// So this renders the shipped cards against REAL fact sets with
// react-dom/server and asserts on the markup and the visible text.
//
// NO FIXTURE SUPPLIES AN EXPECTED VALUE. data/sec/factset-fixture-*.json are
// captured from live companyfacts by the shipped extractor
// (scripts/sec-fixture-capture.mjs) and verified by SHA-256 against the
// runner's own hash. Every number in them comes from SEC.
import fs from "node:fs";
import { loadCards, html, visibleText, React } from "./lib/render-cards.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const fixture = (sym) =>
  JSON.parse(fs.readFileSync(`data/sec/factset-fixture-${sym}.json`, "utf8"));

const M = await loadCards();
const RENDERED_QUARTERS_RENDERED = Number(
  (fs.readFileSync("lib/server/secEarningsView.ts", "utf8")
    .match(/RENDERED_QUARTERS = (\d+)/) ?? [])[1]
);
const AAPL = fixture("AAPL");
const KGC = fixture("KGC");
const AZN = fixture("AZN");
const TSLA = fixture("TSLA");
// THE TWO FILERS THAT PUBLISH NO PaymentsToAcquirePropertyPlantAndEquipment.
// Every fixture above does, so none of them could ever have caught the capex
// chain gap — see §14. GEV is also the spun-off filer with four fiscal years.
const GEV = fixture("GEV");
const KTOS = fixture("KTOS");
const vAapl = M.buildSecEarningsView(AAPL);
const vKgc = M.buildSecEarningsView(KGC);
const vAzn = M.buildSecEarningsView(AZN);
const vTsla = M.buildSecEarningsView(TSLA);
const vGev = M.buildSecEarningsView(GEV);
const vKtos = M.buildSecEarningsView(KTOS);

/**
 * The cards the PAGE ACTUALLY RENDERS for one view, gated exactly as
 * page.tsx gates them.
 *
 * THE GATING IS PART OF THE SUBJECT, not harness convenience. This used to
 * render SecNoQuartersCard for every view — a card the page shows only when
 * there is NO view at all — so the "what does a reader see" text included a
 * card no reader of that page sees. An assertion about KGC's visible words is
 * worthless if the harness adds words the page does not.
 *
 * Mirrors page.tsx: growth table only on a quarter anchor, annual card always
 * (`sole` on a year anchor), recent-periods card self-gates on the basis.
 */
const renderPage = (mod, view) =>
  [
    html(React.createElement(mod.SecSnapshotCard, { view })),
    view.basis === "year" ? "" : html(React.createElement(mod.SecGrowthMarginsCard, { view })),
    html(React.createElement(mod.SecAnnualCard, { view, sole: view.basis === "year" })),
    html(React.createElement(mod.SecCashQualityCard, { view })),
    html(React.createElement(mod.SecBalanceSheetCard, { view })),
    html(React.createElement(mod.SecIncomeStatementCard, { view })),
    // SELF-GATING: returns null on a year anchor. Rendered unconditionally here
    // BECAUSE that is how the page calls it — if the guard is ever removed this
    // harness sees the table appear, which is the point.
    html(React.createElement(mod.SecRecentPeriodsCard, { view })),
    // The five retired ids, each rendered through the real component.
    ...["eps-estimate", "revenue-estimate", "forward-consensus",
        "quarter-estimate-columns", "revenue-by-segment"]
      .map((id) => html(React.createElement(mod.HiddenCard, { id }))),
  ].join("\n");

/** The page's cards PLUS the no-view state cards, for the banned-term scan. */
const renderAll = (mod, view, symbol) =>
  [
    renderPage(mod, view),
    html(React.createElement(mod.SecNoQuartersCard, { symbol, years: 0, instants: 0 })),
  ].join("\n");

console.log("\n1. the fixtures are real, and say so");

check("both fixtures carry the current quarter window",
  AAPL.w === 12 && KGC.w === 12, `AAPL w=${AAPL.w} KGC w=${KGC.w}`);
check("AAPL is the DENSE case", AAPL.quarters.length === 12,
  `${AAPL.quarters.length} quarters stored — 12 is what makes 8 rendered rows reachable`);
check("AZN is the SPARSE QUARTERLY case — 12 stored, a three-quarter hole",
  AZN.quarters.length === 12 && AZN.years.length === 6 && AZN.w === 12,
  `q=${AZN.quarters.length} y=${AZN.years.length} w=${AZN.w}`);
check("KGC is the ANNUAL-ONLY control",
  KGC.quarters.length === 0 && KGC.years.length === 6,
  `q=${KGC.quarters.length} y=${KGC.years.length} — no quarters at all, which is the point`);
check("neither fixture was hand-built: both carry a real fieldsHash",
  AAPL.h === KGC.h && /^[0-9a-f]{8}$/.test(AAPL.h), AAPL.h);

console.log("\n2. A2 — every rendered row can reach its prior year");

{
  // THE DEFECT: eight stored and eight rendered meant the oldest four rows had
  // no prior-year quarter inside the window. Measured 4 of 8 on AAPL.
  const withBase = vAapl.growth.filter((g) => g.comparedWith !== null).length;
  check("all 8 rendered rows name a comparison period for a dense filer",
    vAapl.growth.length === 8 && withBase === 8,
    `${withBase} of ${vAapl.growth.length} — was 4 of 8 at an 8-quarter window`);
  check("...and each one is the SAME fiscal quarter, one year earlier",
    vAapl.growth.every((g) => {
      const m = /^(Q\d) FY(\d+)$/.exec(g.label);
      const b = /^(Q\d) FY(\d+)$/.exec(g.comparedWith ?? "");
      return m && b && m[1] === b[1] && Number(m[2]) - 1 === Number(b[2]);
    }),
    vAapl.growth.map((g) => `${g.label}<-${g.comparedWith}`).join(" "));
  // A ROW WITH NO PRIOR YEAR STILL SAYS SO — and the window change MOVED where
  // that case lives. It used to be KGC's oldest fiscal year, which had nothing
  // behind it at five stored; at six stored, every rendered year reaches one.
  // That is the fix working, not the property lapsing, so the assertion moves
  // to a set that genuinely runs out: see mutation (h), which truncates a real
  // fixture to five years and asserts the oldest cell reads "not on file".
  // ── ON THE FIXTURES CAPTURED AT THE CURRENT WINDOW ───────────────────────
  // AAPL's fixture predates the year window (y=5, no `y` field) and is kept
  // that way ON PURPOSE: it is exactly what a set written before this change
  // looks like, so it is the live control for "five stored, oldest row blank"
  // sitting beside three that have six. Its own assertion is the inverse one,
  // below, and mutation (h) reproduces the same state from a six-year set.
  const currentWindow = [vAzn, vKgc, vTsla];
  check("every rendered year reaches a prior one, on the fixtures captured at y=6",
    currentWindow.every((v) => v.annual.every((r) => r.comparedWith !== null)),
    currentWindow.map((v) => `${v.symbol}:${v.annual.filter((r) => !r.comparedWith).length} blank`).join(" "));
  // AAPL is stored at y=5, so its oldest year has no comparator — and is now
  // DROPPED rather than rendered blank. Four rows, all compared. That is both
  // halves of the fix visible on one fixture.
  check("...and AAPL, stored at y=5, renders four compared rows rather than five with a blank",
    AAPL.years.length === 5 && vAapl.annual.length === 4 &&
      vAapl.annual.every((r) => r.comparedWith !== null),
    `${vAapl.annual.map((r) => `${r.label}<-${r.comparedWith}`).join(" ")} — the uncompared year is a base, not a row`);
}

console.log("\n3. A5 — the five retired ids render nothing at all");

{
  for (const id of ["eps-estimate", "revenue-estimate", "forward-consensus",
                    "quarter-estimate-columns", "revenue-by-segment"]) {
    const markup = html(React.createElement(M.HiddenCard, { id }));
    check(`"${id}" renders no markup`, markup === "", JSON.stringify(markup.slice(0, 60)));
  }
  // THE REGISTRY IS NOT REMOVED — it is what stops the column being re-added
  // and wired to whatever is nearest.
  check("...but the registry still holds all five with their reasons",
    M.RETIRED_SOURCES.length === 5 &&
      M.RETIRED_SOURCES.every((r) => r.source && r.retiredOn && r.reason),
    M.RETIRED_SOURCES.map((r) => r.id).join(", "));
  let threw = false;
  try { M.retiredSource("not-a-real-id"); } catch { threw = true; }
  check("...and retiredSource still THROWS on an unknown id", threw,
    "a soft fallback would let an unregistered hide ship");
}

console.log("\n4. A6 + A7 — nothing internal reaches the reader");

{
  const text = visibleText(renderAll(M, vAapl, "AAPL")) + " " +
               visibleText(renderAll(M, vKgc, "KGC"));
  // READ FROM RENDERED TEXT, not from source. Attribute values are stripped
  // with their tags, so an accession inside an href is not a hit — only prose.
  const BANNED = [
    ["FMP", /\bFMP\b/],
    ["accession", /accession/i],
    ["companyfacts", /companyfacts/i],
    ["XBRL", /\bXBRL\b/],
    ["hide-list", /hide-list/i],
    ["verdict", /verdict/i],
    ["section sign", /§/],
    // A raw accession number is the thing itself, not the word.
    ["a bare accession number", /\b\d{10}-\d{2}-\d{6}\b/],
  ];
  for (const [name, re] of BANNED) {
    const hit = re.exec(text);
    check(`no rendered text says ${name}`, !hit,
      hit ? `…${text.slice(Math.max(0, hit.index - 50), hit.index + 60)}…` : "");
  }
  check("the filing DATE is still shown — only the key went",
    /filed\s+\d{4}-\d{2}-\d{2}/.test(text), text.slice(0, 0) || "");
}

console.log("\n5. A3 — a blank Q4 EPS says why");

{
  const markup = html(React.createElement(M.SecGrowthMarginsCard, { view: vAapl }));
  const t = visibleText(markup);
  const q4 = vAapl.growth.filter((g) => /^Q4 /.test(g.label));
  check("AAPL's window contains a Q4 row to test", q4.length > 0,
    q4.map((g) => g.label).join(" "));
  check("Q4 EPS reads 'not filed' rather than a bare dash",
    q4.every((g) => g.epsYoY === null) ? /not filed/.test(t) : true,
    "Q4 is never filed as a standalone quarter and nothing is derived to fill it");
  check("...and the reason is in visible text, not only a title attribute",
    /Q4 EPS is not filed as a separate period/.test(t),
    "hover-only is invisible on a touch screen");
  // THE REASON MUST NOT DESCRIBE A CALENDAR THE FILER DOES NOT KEEP. The old
  // wording said "companies file nine-month and full-year figures", which is a
  // US 10-Q filer's year and not AZN's — it files half-yearly, so there is no
  // nine-month figure to difference and the sentence explained a mechanism
  // that does not exist for it.
  check("...and it does not assume a nine-month filing exists",
    !/nine-month/.test(t) && !/standalone fourth quarter/.test(t),
    "AZN files half-yearly under 20-F/6-K");
}

console.log("\n6. KGC renders a real page, and never a pending one");

{
  const t = visibleText(renderAll(M, vKgc, "KGC"));
  check("the annual card carries all five fiscal years",
    vKgc.annual.length === 5 && /FY2021/.test(t) && /FY2025/.test(t),
    vKgc.annual.map((r) => r.label).join(" "));
  check("nothing on the page reads as waiting",
    !/check back|being fetched|not loaded yet|coming soon/i.test(t));
  check("the quarterly table is not rendered for an annual-only filer",
    vKgc.basis === "year" && !/Revenue YoY.*Gross margin.*gap/s.test(t),
    "a quarterly table with no quarters is an empty table");
  check("every annual row names its period end, not only its label",
    vKgc.annual.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.end)) &&
      /ended 2025-12-31/.test(t),
    "two filers' FY2025 can be nine months apart");
  check("the cash card is labelled as annual, not as a quarter",
    vKgc.cashQuality.basis === "year" && vKgc.cashQuality.period === "FY2025",
    `${vKgc.cashQuality.basis} / ${vKgc.cashQuality.period}`);
}

// ════════════════════════════════════════════════════════════════════════════
console.log("\n8. an annual-only filer is not described in quarters");
// ════════════════════════════════════════════════════════════════════════════
//
// THE #465 EYE-CHECK FOUND SIX QUARTERLY SENTENCES ON /stock/KGC/earnings, over
// a page whose every figure is a fiscal year: the lede, the score narrative,
// the "Latest reported quarter" eyebrow, "Most recent quarter filed: FY2025",
// "Quarters are labelled by the company's own fiscal calendar", and a "Recent
// reported quarters" table sitting under a card that said "there is no
// quarterly table below".
//
// THE ASSERTION IS ON THE RENDERED TEXT, NOT ON THE SOURCE, because the defect
// was never visible in any one file: each sentence was locally reasonable and
// the page as a whole was not.

/**
 * The only sentences allowed to say "quarter" on an annual-only filer.
 *
 * WHITELISTED BY EXACT SENTENCE, not by a loosened pattern. These exist to tell
 * the reader the company does NOT file quarterly — the one thing on an annual
 * page that legitimately needs the word. A regex like /quarterly/ would have
 * admitted every sentence this section is about.
 */
const QUARTER_WHITELIST = [
  /files annually\s*,? so these are the only periods it publishes — there is no quarterly table below\./,
  /does not publish a quarterly cash-flow statement\./,
  /does not file quarterly results/,
  /is built around the most recent reported/,
];

/** Sentences of `text` that say "quarter" and are not whitelisted. */
const strayQuarters = (text) =>
  text
    .split(/(?<=[.!?])\s+/)
    .filter((sent) => /quarter/i.test(sent))
    .filter((sent) => !QUARTER_WHITELIST.some((ok) => ok.test(sent)))
    .map((sent) => sent.trim());

{
  const kgcText = visibleText(renderPage(M, vKgc));
  const aaplText = visibleText(renderPage(M, vAapl));
  const stray = strayQuarters(kgcText);

  check("KGC's rendered page says 'quarter' only where it says it does not file them",
    stray.length === 0,
    stray.length ? stray.map((x) => `"${x}"`).join(" | ") : "0 stray quarterly sentences");

  // THE CONTROL. "No page says quarter" would also pass if the noun had been
  // deleted everywhere, which would be a different bug and an equally wrong page.
  check("...and AAPL, whose anchor IS a quarter, still says so",
    /quarter/i.test(aaplText) && vAapl.basis === "quarter",
    `AAPL basis=${vAapl.basis}`);

  check("the recent-periods table renders for AAPL and not for KGC",
    /Recent reported quarters/.test(aaplText) && !/Recent reported/.test(kgcText),
    "an annual filer's history IS the five-year card — a second table of the same rows is duplication");

  check("KGC's eyebrow and lede name the year",
    /Latest reported year/.test(kgcText) && /Most recent year filed: FY2025/.test(kgcText),
    "the eyebrow read 'Latest reported quarter' over FY2025");

  check("the vocabulary has one entry per basis and no third spelling",
    Object.keys(M.PERIOD_WORDS).sort().join(",") === "quarter,year",
    Object.keys(M.PERIOD_WORDS).join(","));
}

// ════════════════════════════════════════════════════════════════════════════
console.log("\n9. a percentage change across zero is not printed as a number");
// ════════════════════════════════════════════════════════════════════════════
//
// KGC's own filed EPS: FY2021 $0.17, FY2022 -$0.47, FY2023 $0.34. The page
// rendered -376.5% and +172.3% — the same swing described once as a collapse
// and once as a boom, both artefacts of a negative base.

{
  const kgcText = visibleText(renderPage(M, vKgc));
  const rows = Object.fromEntries(vKgc.annual.map((r) => [r.label, r]));

  check("the two crossing-zero rows are real, and their inputs are filed figures",
    rows.FY2022?.epsDiluted.val === -0.47 && rows.FY2021?.epsDiluted.val === 0.17 &&
      rows.FY2023?.epsDiluted.val === 0.34,
    `FY2021 $${rows.FY2021?.epsDiluted.val} -> FY2022 $${rows.FY2022?.epsDiluted.val} -> FY2023 $${rows.FY2023?.epsDiluted.val}`);

  check("a profit-to-loss year says 'Swung to loss'",
    rows.FY2022?.epsYoY === "swung-to-loss" && /Swung to loss/.test(kgcText),
    `FY2022 epsYoY = ${JSON.stringify(rows.FY2022?.epsYoY)}`);
  check("a loss-to-profit year says 'Turned profitable'",
    rows.FY2023?.epsYoY === "turned-profitable" && /Turned profitable/.test(kgcText),
    `FY2023 epsYoY = ${JSON.stringify(rows.FY2023?.epsYoY)}`);
  // THE ABBREVIATION IS GONE. The owner did not know what "n/m" meant, which is
  // the whole verdict on it — an abbreviation tells a reader something is being
  // withheld without saying what.
  check("...and 'n/m' appears nowhere a reader can see it",
    !/\bn\/m\b/.test(kgcText) && !/not meaningful/i.test(kgcText),
    "replaced by what actually happened in the period");

  // A NUMBER THAT WAS MEANINGFUL MUST STILL PRINT. A guard that suppressed
  // every EPS comparison would pass the two assertions above and be useless.
  check("...while a profit-to-profit year still prints its percentage",
    typeof rows.FY2025?.epsYoY === "number" && /\+153\.2%/.test(kgcText),
    `FY2025 epsYoY = ${rows.FY2025?.epsYoY}`);
  check("and revenue, which never crosses zero here, is untouched",
    vKgc.annual.filter((r) => typeof r.revenueYoY === "number").length === vKgc.annual.length,
    vKgc.annual.map((r) => `${r.label}:${typeof r.revenueYoY}`).join(" "));

  check("the wording reaches the reader with its legend, in visible text",
    /crosses between profit and loss/.test(kgcText) &&
      !/-376\.5%/.test(kgcText) && !/\+172\.3%/.test(kgcText),
    "the two numbers the eye-check found are gone and the words explain themselves");

  // THE LEGEND IS CONDITIONAL, so a page with no n/m cell must not carry it.
  check("...and a page with no crossing does not carry the legend",
    !/crosses between profit and loss/.test(visibleText(renderPage(M, vAapl))),
    "a standing legend for a marker that never appears is noise on every other page");
}

// ════════════════════════════════════════════════════════════════════════════
console.log("\n10. the THIRD shape — a quarterly anchor whose cash flow is annual");
// ════════════════════════════════════════════════════════════════════════════
//
// AZN is neither of the other two fixtures. It files 20-F/6-K half-yearly, so
// its ANCHOR is a quarter while its cash-flow statement exists only on 6- and
// 12-month frames — the cash card falls back to the year while the rest of the
// page stays quarterly.
//
// IT IS THE CASE THE CASH CARD'S FALLBACK PARAGRAPH IS FOR, and it is also the
// case that made that paragraph wrong on KGC: the paragraph was gated on the
// CASH basis alone, so an annual-only filer got "every figure here is the full
// year FY2025, not FY2025" — the same period named twice as if it were two.
{
  check("AZN's anchor is a quarter while its cash card is a year",
    vAzn.basis === "quarter" && vAzn.cashQuality.basis === "year",
    `anchor ${vAzn.basis} / cash ${vAzn.cashQuality.basis} ${vAzn.cashQuality.period} vs latest ${vAzn.latestLabel}`);

  const aznCash = visibleText(html(React.createElement(M.SecCashQualityCard, { view: vAzn })));
  const kgcCash = visibleText(html(React.createElement(M.SecCashQualityCard, { view: vKgc })));

  check("the mismatch paragraph renders for AZN, where the two periods differ",
    /does not publish a quarterly cash-flow statement/.test(aznCash) &&
      new RegExp(`not ${vAzn.latestLabel}`).test(aznCash),
    `cash ${vAzn.cashQuality.period} against anchor ${vAzn.latestLabel}`);

  check("...and NOT for KGC, where they are the same period",
    !/does not publish a quarterly cash-flow statement/.test(kgcCash) &&
      vKgc.cashQuality.period === vKgc.latestLabel,
    `KGC cash ${vKgc.cashQuality.period} IS its anchor ${vKgc.latestLabel} — "the full year FY2025, not FY2025"`);

  // AND THE SPARSE QUARTERLY SHAPE STILL MATCHES BY LABEL, not by offset —
  // this is the fixture the original YoY defect was measured on.
  const byLabel = vAzn.growth.filter((g) => {
    const m = /^Q(\d) FY(\d+)$/.exec(g.label);
    const b = /^Q(\d) FY(\d+)$/.exec(g.comparedWith ?? "");
    return m && b && m[1] === b[1] && Number(m[2]) - 1 === Number(b[2]);
  }).length;
  // NOT A HARDCODED COUNT. This read `byLabel === 8` and went stale the moment
  // the thin-row filter changed how many rows AZN renders — a literal that
  // measures the fixture rather than the property. The property is that every
  // row carrying a comparator matches by fiscal label, and that the only row
  // without one is the oldest, whose prior year is not in the stored window.
  check("every AZN row compares against its own fiscal quarter, one year back",
    byLabel === vAzn.growth.length && vAzn.growth.every((g) => g.comparedWith),
    `${byLabel} of ${vAzn.growth.length} rows match by label, and none renders without a base — ` +
      `this is the filer whose table read "+75.9% Compared with Q2 FY2021" against a latest of Q2 FY2025`);

  check("AZN still reads as quarterly throughout, which is correct for it",
    /quarter/i.test(visibleText(renderPage(M, vAzn))) && vAzn.basis === "quarter");
}

// ════════════════════════════════════════════════════════════════════════════
console.log("\n11. a row too thin to carry the table does not take a slot");
// ════════════════════════════════════════════════════════════════════════════
//
// Measured on the #465 preview, /stock/AZN/earnings: Q3 FY2020, Q4 FY2020 and
// Q1 FY2021 rendered with four of five cells empty. AZN stores exactly ONE
// field for those periods (revenue) against 15 for its full quarters, so each
// produced a revenue YoY and nothing else — three of the eight slots carrying
// one number apiece.
//
// The bar is an EPS comparison or a margin. The assertion is on the RENDERED
// ROWS, and the fixture cannot supply it: which periods survive is decided by
// what AZN filed.
{
  /** Filled cells per rendered row, read back off the view the cards receive. */
  const filled = (v) =>
    v.margins.map((m, i) => {
      const g = v.growth[i];
      return {
        label: m.label,
        n: [g.revenueYoY, g.epsYoY, m.gross, m.operating, m.net]
          .filter((x) => x !== null).length,
      };
    });

  const aznRows = filled(vAzn);
  check("no AZN row is down to a bare revenue comparison",
    aznRows.every((r) => r.n >= 3),
    aznRows.map((r) => `${r.label}(${r.n}/5)`).join(" "));

  check("...and the three the eye-check named are the ones that went",
    !aznRows.some((r) => ["Q3 FY2020", "Q4 FY2020", "Q1 FY2021"].includes(r.label)),
    "each stored one field — revenue — against 15 on AZN's full quarters");

  // THE FILTER MUST NOT SILENTLY SHORTEN A DENSE FILER'S TABLE. AAPL and KGC
  // are the controls: a rule that trimmed them too would pass the assertion
  // above and be a different bug.
  check("a dense filer still renders its full eight rows",
    filled(vAapl).length === RENDERED_QUARTERS_RENDERED,
    filled(vAapl).map((r) => `${r.label}(${r.n}/5)`).join(" "));
  check("and the annual filer still renders all five fiscal years",
    filled(vKgc).length === 5 && vKgc.annual.length === 5,
    filled(vKgc).map((r) => `${r.label}(${r.n}/5)`).join(" "));

  // AND THE ROWS ARE STILL PAIRED. margins[i] and growth[i] are read together
  // by the card, so a filter applied to one list and not the other would put a
  // margin beside another period's growth — plausible, and wrong.
  check("every margins row is paired with the growth row for the SAME period",
    vAzn.margins.length === vAzn.growth.length &&
      vAzn.margins.every((m, i) => m.label === vAzn.growth[i].label),
    `${vAzn.margins.length} rows, labels aligned`);
}

// ════════════════════════════════════════════════════════════════════════════
console.log("\n12. money is written to the cent");
// ════════════════════════════════════════════════════════════════════════════
//
// The money formatter used maximumFractionDigits: 2, which DROPS A TRAILING
// ZERO — so a filed EPS of 4.30 rendered "$4.3" and 4.50 rendered "$4.5".
// Owner found both on production: TSLA FY2023 and AZN FY2024. "$4.3" is not
// how anyone writes money, and it reads as a different, less precise number
// than the filing contains.
//
// TWO ANGLES, because the per-cell one is precise and the sweep is the one
// that catches a renderer added later.
{
  /** Every EPS cell in the markup, by the data-label the card gives it. */
  const epsCells = (markup) =>
    [...markup.matchAll(/data-label="(?:Diluted EPS(?: \(GAAP\))?|Basic EPS \(GAAP\))"[^>]*>([\s\S]*?)<\/td>/g)]
      .map((m) => m[1].replace(/<[^>]*>/g, "").trim())
      .filter(Boolean);

  const ONE_DECIMAL = /\$-?\d+\.\d(?![\d])/;

  for (const [sym, view] of [["AAPL", vAapl], ["AZN", vAzn], ["KGC", vKgc]]) {
    const markup = renderPage(M, view);
    const cells = epsCells(markup);
    const bad = cells.filter((c) => ONE_DECIMAL.test(c) && !/[BM]\b/.test(c));
    check(`${sym}: every EPS cell is written to two decimals`,
      cells.length > 0 && bad.length === 0,
      bad.length ? bad.join(" | ") : `${cells.length} EPS cells, e.g. ${cells.slice(0, 4).join(" ")}`);
  }

  // THE SWEEP. Non-compact money renders ONLY for per-share values on this
  // page — everything else goes through the compact B/M forms — so a bare
  // "$N.N" anywhere in the visible text is a per-share figure short a digit.
  const allText = [vAapl, vAzn, vKgc].map((v) => visibleText(renderPage(M, v))).join(" ");
  const strays = [...allText.matchAll(/\$-?\d+\.\d(?![\dBM])/g)].map((m) => m[0]);
  check("...and no bare one-decimal dollar figure appears anywhere on the three pages",
    strays.length === 0,
    strays.length ? [...new Set(strays)].join(" ") : "three pages swept");
}

// ════════════════════════════════════════════════════════════════════════════
console.log("\n13. the five-year card can reach its own FY-1");
// ════════════════════════════════════════════════════════════════════════════
//
// THE SAME DEFECT AS THE QUARTER WINDOW, ONE TABLE OVER. Five years stored and
// five rendered meant the OLDEST rendered row could never find its comparator,
// so it read "not on file" on every symbol that had ever filed. Owner found it
// on TSLA: FY2021 blank on a filer with two decades of 10-Ks.
{
  const STORED_YEARS = Number(
    (fs.readFileSync("lib/server/secExtract.ts", "utf8").match(/SEC_YEAR_WINDOW = (\d+)/) ?? [])[1]
  );
  const RENDERED = Number(
    (fs.readFileSync("lib/server/secEarningsView.ts", "utf8").match(/RENDERED_YEARS = (\d+)/) ?? [])[1]
  );
  check("more years are stored than rendered, which is what makes the reach possible",
    STORED_YEARS > RENDERED, `${STORED_YEARS} stored, ${RENDERED} rendered`);

  for (const [sym, view, set] of [["TSLA", vTsla, TSLA], ["AZN", vAzn, AZN], ["KGC", vKgc, KGC]]) {
    const rows = view.annual;
    const missing = rows.filter((r) => r.comparedWith === null).map((r) => r.label);
    check(`${sym}: every rendered fiscal year names the year it is measured against`,
      set.years.length >= STORED_YEARS && rows.length === RENDERED && missing.length === 0,
      `${set.years.length} stored -> ${rows.map((r) => `${r.label}<-${r.comparedWith}`).join(" ")}`);
  }

  // THE OLDEST ROW IS THE ONE THAT MOVED. Named explicitly because it is the
  // row the owner reported, and because every OTHER row passed before too —
  // an assertion over all five would have passed at four out of five.
  check("...and the oldest row specifically, which is the one that was blank",
    vTsla.annual[0].label === "FY2021" && vTsla.annual[0].comparedWith === "FY2020",
    `${vTsla.annual[0].label} <- ${vTsla.annual[0].comparedWith}`);
}

console.log("\n14. capex reaches a filer that does not publish the PP&E concept");
// ════════════════════════════════════════════════════════════════════════════
//
// THE DEFECT: the capex chain held ONE tag. GEV and KTOS do not publish it at
// all — measured against the payloads, relay 35024074183 — so capex was null on
// every stored quarter and every stored year for both, and the Quality of
// Earnings card said "Can't calculate — capital expenditure not reported"
// beside an operating cash flow that had resolved perfectly.
//
// GEV AND KTOS ARE THE FIXTURES FOR IT, and they are the reason the fixtures
// exist: AAPL, TSLA, AZN and KGC all publish the first chain entry, so not one
// of them could ever have failed this, and an assertion over the four already
// committed would have passed throughout the defect.
{
  const chainSrc = fs.readFileSync("lib/server/secFields.ts", "utf8");
  const capexChain = (chainSrc.match(/key: "capex", chain: \[([^\]]*)\]/) ?? [])[1] ?? "";
  const entries = [...capexChain.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

  // ORDER IS THE GUARANTEE, not membership. Resolution is rank-first per
  // period, so the broad concept sitting SECOND is what keeps a filer that
  // publishes both on the narrower PP&E reading. Reversed, this check still
  // finds two entries and AAPL quietly changes meaning.
  check("the PP&E concept is first and the productive-assets fallback second",
    entries[0] === "PaymentsToAcquirePropertyPlantAndEquipment" &&
      entries[1] === "PaymentsToAcquireProductiveAssets",
    entries.join(" -> "));

  // THE NEAR-MISSES ARE NAMED SO THEY CANNOT BE ADDED BACK QUIETLY. Each was on
  // the same printed list as the concept that was taken, each matches the same
  // name patterns, and each would put a plausible wrong number on the card:
  // business acquisitions overstate GEV's capex ~6x, and the accrual line is
  // not a cash flow at all and reads 9.1m against KTOS's real 37.1m.
  const banned = [
    "PaymentsToAcquireBusinessesNetOfCashAcquired",
    "PaymentsToAcquireEquityMethodInvestments",
    "PaymentsToAcquireInterestInJointVenture",
    "CapitalExpendituresIncurredButNotYetPaid",
  ];
  const taken = banned.filter((t) => entries.includes(t));
  check("no near-miss concept was taken alongside it", taken.length === 0,
    taken.length ? `in the chain: ${taken.join(", ")}` : `none of ${banned.length} candidates`);

  for (const [sym, view] of [["GEV", vGev], ["KTOS", vKtos]]) {
    const q = view.cashQuality;
    check(`${sym}: capital expenditure has a figure, and free cash flow computes`,
      q.capex.val !== null && q.freeCashFlow !== null && q.freeCashFlowMissing === null,
      `ocf=${q.operatingCashFlow.val} capex=${q.capex.val} (${q.capex.derived}) fcf=${q.freeCashFlow}`);

    // READ OUT OF THE MARKUP, not off the view. The view holding a number and
    // the reader seeing one are different claims, and this file exists for the
    // second of them.
    const text = visibleText(renderPage(M, view));
    check(`${sym}: and the card no longer says the figure is not reported`,
      !/capital expenditure not reported/i.test(text),
      `"Can't calculate" absent from ${text.length} chars of rendered text`);
  }

  // THE CONTROL, and it is the whole risk of this change: a filer that already
  // resolved must resolve to the SAME number. AAPL publishes both concepts.
  check("AAPL is unmoved — a filer publishing both keeps the narrower reading",
    vAapl.cashQuality.capex.val === 2455000000,
    `Q3 FY2026 capex ${vAapl.cashQuality.capex.val} (${vAapl.cashQuality.capex.derived})`);
}

console.log("\n7. the three mutations, each re-rendered from broken source");

{
  // The exact text loadCards transpiles, so "did the mutation apply" is asked
  // of the same string the mutation is handed — not of one file out of three.
  const cardsSrc = [
    fs.readFileSync("lib/server/secEarningsView.ts", "utf8"),
    fs.readFileSync("app/stock/[symbol]/earnings/SecEarningsCards.tsx", "utf8"),
  ].join("\n");
  const render = async (mutate) => {
    const mod = await loadCards(mutate);
    const v = mod.buildSecEarningsView(AAPL);
    return { mod, v, text: visibleText(renderAll(mod, v, "AAPL")) };
  };

  // (a) OFFSET-BASED YoY — the defect this whole line of work removed.
  //
  // ── AND IT MUST BE TESTED ON THE SPARSE FIXTURE ─────────────────────────
  // The first version of this mutation ran against AAPL and reported 0 of 8
  // rows wrong — because on a DENSE, gapless filer `q[i + 4]` IS the same
  // fiscal quarter one year earlier. That is not a flaw in the mutation; it is
  // the entire reason the defect survived every check for as long as it did,
  // reproduced here. A dense filer cannot catch it, so the assertion is made
  // where the two rules disagree.
  // FOUR ROWS BACK IN THE STORED LIST — the shape of the original defect,
  // expressed against `q` because the comparison is now derived in `measured`,
  // which runs over the whole stored list before any rows are chosen.
  const offsetMutation = (src) =>
    src.replace(
      "const prior = priorYearOf(q, p);",
      "const prior = q[q.indexOf(p) + 4] ?? null;"
    );
  const wrongRows = (view) =>
    view.growth.filter((g) => {
      const m = /^(?:(Q\d) )?FY(\d+)$/.exec(g.label);
      const b = /^(?:(Q\d) )?FY(\d+)$/.exec(g.comparedWith ?? "");
      if (!m) return false;
      // A row whose prior year is genuinely absent is correct when it is null.
      const trueBase = view.growth.some((x) => x.label === g.label) && g.comparedWith;
      if (!trueBase) return false;
      return !b || m[1] !== b[1] || Number(m[2]) - 1 !== Number(b[2]);
    }).length;

  const aDense = await render(offsetMutation);
  const aSparseMod = await loadCards(offsetMutation);
  const aSparse = aSparseMod.buildSecEarningsView(KGC);

  check("(a) offset-based YoY is caught on the SPARSE fixture",
    wrongRows(aSparse) > 0,
    `KGC: ${wrongRows(aSparse)} of ${aSparse.growth.length} rows compare against the wrong ` +
      `fiscal year — ${aSparse.growth.map((g) => `${g.label}<-${g.comparedWith}`).join(" ")}`);
  check("...and the DENSE fixture cannot catch it, which is why it survived",
    wrongRows(aDense.v) === 0,
    "AAPL is gapless, so four rows back IS one year back — recording this so the " +
      "next person does not 'fix' this mutation by pointing it at AAPL");

  // ── (b) AN ABSENT FIGURE IS GIVEN A VALUE ───────────────────────────────
  //
  // RETARGETED, and the reason is worth keeping. This used to mutate `pct` and
  // count dashes: with rows lacking a comparator now dropped, and Q4 EPS
  // intercepted by its own "not filed" branch, NO null reaches pct on any
  // committed fixture — so the old mutation passed by mutating a path nothing
  // travels. The guarantee moved to CellValue, so the mutation follows it.
  //
  // "$0" for an unfiled figure is the specific lie this guards: a zero is a
  // claim the company filed nil, and it is the same failure as the retired
  // "EPS surprise: 0.00", which read as "came in exactly in line".
  const coalesceCell = (src) =>
    src.replace(
      "  if (cell.val == null) {\n    return <span style={{ color: \"#94a3b8\", fontWeight: 600 }}>{NOT_REPORTED}</span>;\n  }",
      ""
    ).replace(
      "? money(cell.val, compact && !cell.perShare, cell.perShare)",
      "? money(cell.val ?? 0, compact && !cell.perShare, cell.perShare)"
    );
  check("the absent-figure mutation actually applied", coalesceCell(cardsSrc) !== cardsSrc);
  const bMod = await loadCards(coalesceCell);
  const bText = visibleText(renderPage(bMod, bMod.buildSecEarningsView(AAPL)));
  const absentNow = (visibleText(renderPage(M, vAapl)).match(/Not reported/g) ?? []).length;
  const absentMutated = (bText.match(/Not reported/g) ?? []).length;
  // FEWER, NOT ZERO. DerivedValue is a second mechanism with its own null
  // branch and this mutation does not touch it, so the three cells it owns
  // still read "Not reported" — asserting zero would be asserting that one
  // mutation breaks two independent guards, which is not true and would make
  // the check fail for a correct reason.
  check("(b) an unfiled figure given a value is caught",
    absentNow > 0 && absentMutated < absentNow && /\$0\b/.test(bText),
    `${absentNow} cells read "Not reported" -> ${absentMutated} (the rest are DerivedValue's, untouched); ` +
      `"$0" now stands where the filer published nothing`);

  // ── (d) THE BASIS IS FORCED BACK TO "quarter" ───────────────────────────
  //
  // The brief's mutation for defect 1. If every noun really does come from the
  // anchor, pinning the anchor to "quarter" must put the quarterly sentences
  // back on KGC — and if any noun is still a literal, this mutation cannot
  // move it and the section-8 assertion was never testing anything.
  //
  // MUTATED WHERE THE VIEW PUBLISHES THE BASIS, not where it picks the anchor.
  // Forcing the ANCHOR to quarters makes buildSecEarningsView return null for
  // KGC (it has none) and the render throws — which tests that the anchor
  // matters, not that the nouns follow it. Forcing the PUBLISHED field leaves
  // the annual data in place and lies to the cards about what kind of period it
  // is, which is precisely the state the page shipped in.
  const forceQuarter = (src) =>
    src.replace(
      "  return {\n    symbol: set.symbol,",
      '  const forcedBasis: PeriodBasis = "quarter";\n  return {\n    symbol: set.symbol,'
    ).replace("\n    basis,\n", "\n    basis: forcedBasis,\n");
  check("the force-quarter mutation actually applied", forceQuarter(cardsSrc) !== cardsSrc);
  const dMod = await loadCards(forceQuarter);
  const dView = dMod.buildSecEarningsView(KGC);
  const dStray = strayQuarters(visibleText(renderPage(dMod, dView)));
  check("(d) MUTATION: forcing the basis to 'quarter' puts the quarterly wording back on KGC",
    dView.basis === "quarter" && dStray.length > 0,
    `${dStray.length} stray quarterly sentences return — ` +
      dStray.slice(0, 3).map((x) => `"${x}"`).join(" | "));
  check("...including the table that should not exist for an annual filer",
    /Recent reported quarters/.test(visibleText(renderPage(dMod, dView))),
    "the guard is on the basis, so the mutation restores the table too");

  // ── (e) THE n/m GUARD IS REMOVED ────────────────────────────────────────
  //
  // The brief's mutation for defect 2: with the guard gone, KGC's FY2022 and
  // FY2023 cells must show a percentage again. The numbers asserted are the
  // ones the eye-check read off the preview, and they are NOT supplied to the
  // renderer — they are what the unguarded arithmetic produces from the filed
  // EPS figures.
  const dropNmGuard = (src) =>
    src.replace('if (then < 0 && now >= 0) return "turned-profitable";', "")
       .replace('if (then >= 0 && now < 0) return "swung-to-loss";', "")
       .replace('if (then < 0 && now < 0) return "loss-both";', "")
       .replace('if (then === 0) return now > 0 ? "turned-profitable" : null;',
                "if (then === 0) return null;")
       .replace("  return ((now - then) / then) * 100;",
                "  return ((now - then) / Math.abs(then)) * 100;");
  check("the n/m-guard mutation actually applied", dropNmGuard(cardsSrc) !== cardsSrc);
  const eMod = await loadCards(dropNmGuard);
  const eView = eMod.buildSecEarningsView(KGC);
  const eText = visibleText(renderPage(eMod, eView));
  check("(e) MUTATION: without the guard, the crossing-zero cells print percentages again",
    /-376\.5%/.test(eText) && /\+172\.3%/.test(eText),
    "the same swing rendered once as a collapse and once as a boom — both from a negative base");
  check("...and the legend disappears with them, so it cannot be a standing decoration",
    !/crosses between profit and loss/.test(eText),
    "the note is conditional on a marker actually being present");

  // ── (f) THE THIN-ROW FILTER IS REMOVED ──────────────────────────────────
  //
  // With every period eligible again, AZN's three revenue-only rows come back
  // and push out three that carry margins — which is the state the eye-check
  // found.
  const dropRowFilter = (src) =>
    src.replace(
      "const rows = measured.filter((r) => hasSomething(r) && hasComparator(r)).slice(0, renderLimit);",
      "const rows = measured.filter(hasComparator).slice(0, renderLimit);"
    );
  check("the thin-row mutation actually applied", dropRowFilter(cardsSrc) !== cardsSrc);
  const fMod = await loadCards(dropRowFilter);
  const fView = fMod.buildSecEarningsView(AZN);
  const fThin = fView.margins.filter((m, i) => {
    const g = fView.growth[i];
    return [g.revenueYoY, g.epsYoY, m.gross, m.operating, m.net].filter((x) => x !== null).length <= 1;
  });
  check("(f) MUTATION: without the filter, AZN's one-cell rows take three slots again",
    fThin.length === 3 &&
      fThin.map((m) => m.label).sort().join(" ") === "Q1 FY2021 Q3 FY2020 Q4 FY2020",
    `${fThin.length} rows return with one filled cell — ${fThin.map((m) => m.label).join(" ")}`);

  // ── (g) THE PER-SHARE PRECISION IS REVERTED ─────────────────────────────
  const revertMoney = (src) =>
    src.replace(
      `const digits = perShare
    ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { maximumFractionDigits: 2 };`,
      "const digits = { maximumFractionDigits: 2 };"
    );
  check("the money-format mutation actually applied", revertMoney(cardsSrc) !== cardsSrc);
  const gMod = await loadCards(revertMoney);
  const gText = [AAPL, AZN, KGC]
    .map((f) => visibleText(renderPage(gMod, gMod.buildSecEarningsView(f)))).join(" ");
  const gStrays = [...new Set([...gText.matchAll(/\$-?\d+\.\d(?![\dBM])/g)].map((m) => m[0]))];
  check("(g) MUTATION: without the per-share rule, one-decimal money comes back",
    gStrays.length > 0,
    `${gStrays.length} distinct: ${gStrays.slice(0, 6).join(" ")}`);

  // ── (h) THE YEAR WINDOW IS NARROWED BACK TO FIVE ────────────────────────
  //
  // Mutating the DATA rather than the code, because that is what a set written
  // before the change actually looks like: five years stored, five rendered,
  // nothing for the oldest to reach.
  const fiveYearSet = { ...TSLA, years: TSLA.years.slice(0, 5) };
  const hView = M.buildSecEarningsView(fiveYearSet);
  check("(h) MUTATION: five years stored renders one row FEWER, not one row blank",
    hView.annual.length === vTsla.annual.length - 1 &&
      hView.annual.every((r) => r.comparedWith !== null),
    `${vTsla.annual.length} rows at y=6 -> ${hView.annual.length} at y=5, all compared — ` +
      `the year that cannot be compared is a base, not a row`);

  // AND IT READS "not on file", NOT A NEIGHBOUR. Widening the window must not
  // teach the card to reach for the nearest row when the right one is absent:
  // a genuinely missing FY-1 is still a blank.
  // ON THE CELL, NOT ON TEXT DISTANCE. The first version of this asserted that
  // the oldest row's label was not followed by the NEXT row's label within the
  // visible text — which is meaningless, because visibleText runs the whole
  // table together with no row separator, so the pattern matched every time and
  // the assertion was testing nothing. The claim is about ONE CELL, so it is
  // read out of the markup by the data-label the card gives it.
  const hMarkup = html(React.createElement(M.SecAnnualCard, { view: hView, sole: false }));
  const comparedCells = [...hMarkup.matchAll(/data-label="Compared with"[^>]*>([\s\S]*?)<\/td>/g)]
    .map((m) => m[1].replace(/<[^>]*>/g, "").trim());
  // DROPPING A ROW MUST NOT RE-BASE THE NEXT ONE. The risk in removing rows is
  // that the survivors quietly shift onto whatever is now below them; every
  // remaining row still names its OWN fiscal year minus one.
  check("...and no surviving row is re-based onto a neighbour",
    comparedCells.length === hView.annual.length &&
      hView.annual.every((r, i) =>
        comparedCells[i] === r.comparedWith &&
        Number(String(r.label).slice(2)) - 1 === Number(String(r.comparedWith).slice(2))),
    `compared-with column: ${comparedCells.join(" | ")} — a wrong base is worse than a blank, because a blank cannot be quoted`);

  // ── (i) THE CAPEX CHAIN GAP, REPRODUCED IN THE DATA ─────────────────────
  //
  // MUTATING THE DATA, NOT THE SOURCE, and for the same reason as (h): the
  // chain runs in the EXTRACTOR, and a fixture is already extracted, so there
  // is no source edit that can un-resolve a value already stored. What a set
  // written before the chain gained its second entry actually looks like is
  // this — every capex cell null, everything else untouched — so that is what
  // is built, from the real GEV fixture rather than a hand-made one.
  //
  // WITHOUT THIS, §14 IS DECORATIVE. It asserts the card does NOT say
  // "capital expenditure not reported"; that is only a claim if the card is
  // known to say it when capex is absent.
  const CAPEX_INDEX = M.SEC_FIELD_KEYS.indexOf("capex");
  check("the capex field index was found, so the mutation can reach the cell",
    CAPEX_INDEX >= 0, `capex is field ${CAPEX_INDEX} of ${M.SEC_FIELD_KEYS.length}`);
  const blankCapex = (p) => ({
    ...p,
    v: p.v.map((val, i) => (i === CAPEX_INDEX ? null : val)),
    d: p.d.slice(0, CAPEX_INDEX) + "-" + p.d.slice(CAPEX_INDEX + 1),
  });
  const iSet = {
    ...GEV,
    quarters: GEV.quarters.map(blankCapex),
    years: GEV.years.map(blankCapex),
  };
  check("the capex mutation actually applied",
    vGev.cashQuality.capex.val !== null &&
      M.buildSecEarningsView(iSet).cashQuality.capex.val === null,
    `GEV capex ${vGev.cashQuality.capex.val} -> null`);
  const iView = M.buildSecEarningsView(iSet);
  const iText = visibleText(renderPage(M, iView));
  check("(i) MUTATION: with capex gone, the card names it as the input that stopped FCF",
    iView.cashQuality.freeCashFlow === null &&
      iView.cashQuality.freeCashFlowMissing === "capital expenditure" &&
      /capital expenditure not reported/i.test(iText),
    `freeCashFlowMissing=${iView.cashQuality.freeCashFlowMissing} — the exact state GEV was in`);

  // AND IT DOES NOT SILENTLY SUBSTITUTE. The risk in a fallback chain is that
  // a missing figure reaches for the nearest available one; operating cash
  // flow is untouched by the mutation and free cash flow still refuses.
  check("...and operating cash flow is unaffected, so FCF refused rather than guessed",
    iView.cashQuality.operatingCashFlow.val === vGev.cashQuality.operatingCashFlow.val,
    `ocf ${iView.cashQuality.operatingCashFlow.val} on both sides of the mutation`);

  // (c) THE CARD REVERTS TO PENDING — the permanent-pending failure.
  const c = await loadCards();
  const pendingText = visibleText(html(React.createElement(c.SecPendingCard, { symbol: "KGC" })));
  check("(c) a pending card is recognisable, so reverting to one is catchable",
    /check back|being fetched/i.test(pendingText) &&
      !/check back|being fetched/i.test(visibleText(renderAll(M, vKgc, "KGC"))),
    "KGC renders the annual page; the pending wording appears only in the pending card");
}

console.log(failures ? `\n${failures} assertion(s) failed.\n` : "\nRendered output holds.\n");
process.exit(failures ? 1 : 0);
