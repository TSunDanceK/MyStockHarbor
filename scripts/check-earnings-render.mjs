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
const vAapl = M.buildSecEarningsView(AAPL);
const vKgc = M.buildSecEarningsView(KGC);
const vAzn = M.buildSecEarningsView(AZN);

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
  AZN.quarters.length === 12 && AZN.years.length === 5 && AZN.w === 12,
  `q=${AZN.quarters.length} y=${AZN.years.length} w=${AZN.w}`);
check("KGC is the ANNUAL-ONLY control",
  KGC.quarters.length === 0 && KGC.years.length === 5,
  `q=${KGC.quarters.length} y=${KGC.years.length} — unchanged by the window, which is the point`);
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
  // A ROW WITH NO PRIOR YEAR STILL SAYS SO. The window does not manufacture a
  // comparator — KGC's oldest fiscal year has none and must read "not on file".
  const oldest = vKgc.annual[0];
  check("a period with genuinely no prior year still reads 'not on file'",
    oldest.comparedWith === null && oldest.revenueYoY === null,
    `${oldest.label} — widening the window must not invent a base`);
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

  check("a profit-to-loss year is n/m, not a percentage",
    rows.FY2022?.epsYoY === "n/m", `FY2022 epsYoY = ${JSON.stringify(rows.FY2022?.epsYoY)}`);
  check("a loss-to-profit year is n/m, not a percentage",
    rows.FY2023?.epsYoY === "n/m", `FY2023 epsYoY = ${JSON.stringify(rows.FY2023?.epsYoY)}`);

  // A NUMBER THAT WAS MEANINGFUL MUST STILL PRINT. A guard that suppressed
  // every EPS comparison would pass the two assertions above and be useless.
  check("...while a profit-to-profit year still prints its percentage",
    typeof rows.FY2025?.epsYoY === "number" && /\+153\.2%/.test(kgcText),
    `FY2025 epsYoY = ${rows.FY2025?.epsYoY}`);
  check("and revenue, which never crosses zero here, is untouched",
    vKgc.annual.filter((r) => typeof r.revenueYoY === "number").length === 4,
    vKgc.annual.map((r) => `${r.label}:${typeof r.revenueYoY}`).join(" "));

  check("the marker reaches the reader with its legend, in visible text",
    /n\/m/.test(kgcText) && /not meaningful/i.test(kgcText) &&
      !/-376\.5%/.test(kgcText) && !/\+172\.3%/.test(kgcText),
    "the two numbers the eye-check found are gone and the marker explains itself");

  // THE LEGEND IS CONDITIONAL, so a page with no n/m cell must not carry it.
  check("...and a page with no n/m cell does not carry the legend",
    !/not meaningful/i.test(visibleText(renderPage(M, vAapl))),
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
  const withBase = vAzn.growth.filter((g) => g.comparedWith).length;
  check("every AZN row with a comparator compares against its own fiscal quarter, one year back",
    byLabel === withBase && withBase === vAzn.growth.length - 1,
    `${byLabel} of ${vAzn.growth.length} rows match by label; only the oldest (${vAzn.growth[0].label}) has no prior year stored — ` +
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
    filled(vKgc).length === 5,
    filled(vKgc).map((r) => `${r.label}(${r.n}/5)`).join(" "));

  // AND THE ROWS ARE STILL PAIRED. margins[i] and growth[i] are read together
  // by the card, so a filter applied to one list and not the other would put a
  // margin beside another period's growth — plausible, and wrong.
  check("every margins row is paired with the growth row for the SAME period",
    vAzn.margins.length === vAzn.growth.length &&
      vAzn.margins.every((m, i) => m.label === vAzn.growth[i].label),
    `${vAzn.margins.length} rows, labels aligned`);
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

  // (b) NULL COALESCED TO 0 — "0.00" reads as a filed zero.
  const b = await render((src) =>
    src.replace(
      'v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`',
      '!Number.isFinite(v ?? 0) ? "—" : `${(v ?? 0) >= 0 ? "+" : ""}${(v ?? 0).toFixed(digits)}%`'
    )
  );
  const dashesNow = (visibleText(renderAll(M, vAapl, "AAPL")).match(/—/g) ?? []).length;
  const dashesMutated = (b.text.match(/—/g) ?? []).length;
  check("(b) a null coalesced to 0 is caught",
    dashesMutated < dashesNow && /\+0\.0%/.test(b.text),
    `${dashesNow} dashes become ${dashesMutated}; "+0.0%" now appears where a figure was absent`);

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
    src.replace(
      "  if (then <= 0 || now < 0) return NOT_MEANINGFUL;\n",
      ""
    ).replace(
      "  return ((now - then) / then) * 100;",
      "  if (then === 0) return null;\n  return ((now - then) / Math.abs(then)) * 100;"
    );
  check("the n/m-guard mutation actually applied", dropNmGuard(cardsSrc) !== cardsSrc);
  const eMod = await loadCards(dropNmGuard);
  const eView = eMod.buildSecEarningsView(KGC);
  const eText = visibleText(renderPage(eMod, eView));
  check("(e) MUTATION: without the guard, the crossing-zero cells print percentages again",
    /-376\.5%/.test(eText) && /\+172\.3%/.test(eText),
    "the same swing rendered once as a collapse and once as a boom — both from a negative base");
  check("...and the legend disappears with them, so it cannot be a standing decoration",
    !/not meaningful/i.test(eText),
    "the note is conditional on a marker actually being present");

  // ── (f) THE THIN-ROW FILTER IS REMOVED ──────────────────────────────────
  //
  // With every period eligible again, AZN's three revenue-only rows come back
  // and push out three that carry margins — which is the state the eye-check
  // found.
  const dropRowFilter = (src) =>
    src.replace(
      "const rows = measured.filter(hasSomething).slice(0, RENDERED_QUARTERS);",
      "const rows = measured.slice(0, RENDERED_QUARTERS);"
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
