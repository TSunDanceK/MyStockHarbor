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
import { loadCards, loadReactionCharts, html, visibleText, React } from "./lib/render-cards.mjs";
import { once } from "./lib/render-snapshot.mjs";

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
 * ── THE CNI SHAPE, BUILT FROM AZN'S OWN STALE-BUT-POPULATED QUARTERS ───────
 *
 * slice(1, 5) is Q2 FY2024 back to Q2 FY2021: 549, 915, 1280 and 1645 days
 * behind AZN's newest period, and 15/15/14/14 fields filled. The first draft
 * used slice(-3), the three OLDEST quarters — also stale, but AZN stores ONE
 * field for each, so once the recent-periods table gained the thin-row rule the
 * staleness mutation rendered a table with ZERO rows and the assertion could no
 * longer tell "the table came back" from "the table stayed away".
 *
 * 549 days is one day over the threshold and is real filed data, which makes
 * this fixture the TSEM case as well as the CNI one.
 *
 * MODULE SCOPE because two sections use it — the staleness rule below and
 * mutation (k) — and two slices of the same intent would drift apart.
 */
const STALE_AZN = { ...AZN, quarters: AZN.quarters.slice(1, 5) };

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
 * Mirrors page.tsx: growth table only where the TABLES are quarterly, annual
 * card always (`sole` where they are not), recent-periods card self-gates.
 *
 * ── tableBasis, NOT basis, AND THE TWO ARE NOT THE SAME FIELD ──────────────
 * This gated on `view.basis` while page.tsx gates on `secView.tableBasis`, and
 * they differ on exactly the filer this section is calibrated against: AZN's
 * anchor is FY2025 (basis "year") while its quarters are current (tableBasis
 * "quarter"). Measured: the page renders a 3,618-character growth & margins
 * card for AZN that this harness rendered for nobody, so every "what does a
 * reader see" assertion about AZN was made against a page missing a card the
 * real one shows.
 *
 * AND IT COST THE STALENESS MUTATION HALF ITS REACH. Dropping the 548-day test
 * flips tableBasis to "quarter" on a CNI-shaped set while basis stays "year",
 * so the table came back and was caught — and the growth card came back and
 * could not be, because this line still said not to render it. A mutation that
 * can only observe half of what it breaks is half a check.
 */
const renderPage = (mod, view) =>
  [
    html(React.createElement(mod.SecSnapshotCard, { view })),
    view.tableBasis === "year" ? "" : html(React.createElement(mod.SecGrowthMarginsCard, { view })),
    html(React.createElement(mod.SecAnnualCard, { view, sole: view.tableBasis === "year" })),
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

console.log("\n3y. A SYMBOL WITH NO CIK GETS A PAGE, NOT A 404");
{
  // /stock/MSTY/earnings returned a bare 404 while /stock/MSTY rendered. The
  // sibling page's own rule is 200 + an honest state + noindex, because the
  // route is enumerated and a 404 on a real symbol — or a 5xx — is worse.
  const PAGE = fs.readFileSync("app/stock/[symbol]/earnings/page.tsx", "utf8");
  check("the route no longer calls notFound()",
    !/notFound\(\)/.test(PAGE),
    "a symbol whose stock page renders must not 404 on its earnings page");
  check("...and the no-registrant state is rendered instead",
    /noRegistrant \?\s*\(\s*<SecNoRegistrantCard/.test(PAGE.replace(/\s+/g, " ").replace(/ /g, " ")) ||
      /<SecNoRegistrantCard symbol=\{clean\} \/>/.test(PAGE),
    "the branch must mount a card, not fall through to pending");
  check("...and that state is noindex, like the sibling page's no-data state",
    /index: cikForSymbol\(clean\) !== null/.test(PAGE),
    "a 200 that can be indexed as thin content is the cost of not 404-ing");

  // THE COPY MUST NOT GUESS. Measured through the shipped gate: MSTY and JEPI
  // are funds and structurally absent; BK, EA, EQR and WBS are operating
  // companies the committed snapshot is simply missing. A card that told a
  // Bank of New York Mellon visitor it is probably a fund would be worse than
  // the 404 it replaced.
  const CARDS = fs.readFileSync("app/stock/[symbol]/earnings/SecEarningsCards.tsx", "utf8");
  const card = CARDS.slice(CARDS.indexOf("export function SecNoRegistrantCard"));
  const body = card.slice(0, card.indexOf("\nexport ", 10));
  check("the card names BOTH reasons a ticker can be missing",
    /fund or ETF share class/.test(body) && /directory snapshot has not picked up/.test(body),
    "one of them is wrong for half the population either way");
  check("...and asserts neither as the likely one",
    !/usual reason/i.test(body) && !/most often/i.test(body) && /cannot tell which applies/.test(body),
    "the page has no way to tell a fund from a missing registrant");

  const markup = html(React.createElement(M.SecNoRegistrantCard, { symbol: "MSTY" }));
  const text = visibleText(markup);
  check("it renders, names the symbol, and points at a page that works",
    /MSTY/.test(text) && /href="\/stock\/MSTY"/.test(markup),
    text.slice(0, 100));
  check("...and never says the filings are on their way",
    !/not been read into the site yet/.test(text) && !/pending/i.test(text),
    "that is the promise this state exists to stop making");
}

console.log("\n3z. ONE WORD FOR ONE STATE, ACROSS THE WHOLE PAGE");
{
  // MEASURED ON ABVX: the growth table's Q4 EPS column rendered "not filed"
  // while Diluted EPS three cards up rendered "Not reported" — the same fact
  // about the same filer, in two words, and a reader has no way to know they
  // mean the same thing. NOT_REPORTED is the page's established term and every
  // other empty cell already uses it.
  const CARDS = fs.readFileSync("app/stock/[symbol]/earnings/SecEarningsCards.tsx", "utf8");
  check("the Q4 cell renders the shared constant, not its own spelling",
    !/>\s*not filed\s*</.test(CARDS),
    "a literal here is a second word for a state the page already names");
  check("...and the note quotes that constant rather than restating it",
    /\$\{NOT_REPORTED\}/.test(CARDS),
    "a note that spells the word itself can describe one the page stopped showing");

  // AND IT REACHES A READER THAT WAY. The source assertions above cannot see
  // what renders, so the rendered text is checked too — on AAPL, whose table
  // carries Q4 rows. (It was AZN; AZN's current window is Q2 rows only, and
  // the Q4 sentence is now printed only where a Q4 row without EPS exists.)
  const azText = visibleText(html(React.createElement(M.SecGrowthMarginsCard, { view: vAapl })));
  // NOT a bare /not filed/ search: the note's own sentence — "Q4 EPS is not
  // filed as a separate period" — is correct English about the FACT, and
  // banning the phrase outright failed on it. What must not appear is the
  // page telling the reader a CELL shows a word it does not show.
  check("the note tells the reader the word the cells actually carry",
    /so it reads Not reported\./.test(azText) && !/reads? \u201c?not filed/.test(azText),
    (azText.match(/so it reads [^.]*\./) ?? ["no such sentence"])[0]);
  // AND NO CELL CARRIES THE OLD SPELLING. Checked on the markup, where a table
  // cell is distinguishable from prose.
  const azMarkup = html(React.createElement(M.SecGrowthMarginsCard, { view: vAzn }));
  check("...and no table cell renders 'not filed' as its value",
    !/>\s*not filed\s*</.test(azMarkup),
    "the Q4 EPS column was the one that did");
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
  check("Q4 EPS reads 'Not reported' rather than a bare dash",
    q4.every((g) => g.epsYoY === null) ? /Not reported/.test(t) : true,
    "Q4 is never filed as a standalone quarter and nothing is derived to fill it");
  check("...and the reason is in visible text, not only a title attribute",
    /Q4 EPS isn\u2019t filed separately/.test(t),
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
  // ON THE LABEL, as its tooltip, since round 2: the intro states the
  // year-end once and the exact date sits on each FY label.
  check("every annual row names its period end, not only its label",
    vKgc.annual.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.end)) &&
      /title="Ended 2025-12-31"/.test(html(React.createElement(M.SecAnnualCard, { view: vKgc, sole: true }))),
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
console.log("\n10. the anchor is the NEWEST period, whichever kind it is");

// ── THE DEFECT, ON PRODUCTION ─────────────────────────────────────────────
// AZN's snapshot read "Most recent quarter filed: Q2 FY2025 (period ending
// 2025-06-30)" while the store held FY2025, ended 2025-12-31 — six months
// newer — and the five-year card showed it two cards down. "Latest" was
// decided by KIND, not by DATE, so the page presented stale data as current.
//
// AZN IS THE SHAPE FOR THIS, and it is no longer the shape section 10 used to
// test. Its cash card used to disagree with its anchor (annual cash under a
// quarterly anchor); now the anchor IS the year, the cash card is the same
// year, and they agree — so the period-mismatch paragraph correctly does NOT
// render for it any more. That paragraph is still guarded (asserted below),
// but no committed fixture currently produces it; recorded rather than quietly
// dropped.
{
  const newest = (list) => list[0]?.e ?? null;

  check("AZN's newest annual period ends AFTER its newest quarter",
    newest(AZN.years) > newest(AZN.quarters),
    `year ${newest(AZN.years)} > quarter ${newest(AZN.quarters)}`);

  check("...so its anchor is the YEAR, and the snapshot says so",
    vAzn.basis === "year" && vAzn.latestLabel === "FY2025" &&
      vAzn.latestEnd === newest(AZN.years) &&
      /Most recent year filed: FY2025/.test(visibleText(html(React.createElement(M.SecSnapshotCard, { view: vAzn })))),
    `basis=${vAzn.basis} latest=${vAzn.latestLabel} (${vAzn.latestEnd})`);

  // THE TABLE IS STILL A TABLE OF QUARTERS. A newer annual period does not
  // stop twelve quarters existing, and deleting them was the cost of the
  // obvious one-field fix.
  check("...while the quarterly table below it still renders, off quarters",
    vAzn.tableBasis === "quarter" && vAzn.growth.length > 0 &&
      vAzn.growth.every((g) => /^Q\d FY\d{4}$/.test(g.label)),
    `tableBasis=${vAzn.tableBasis}, ${vAzn.growth.length} rows: ${vAzn.growth.map((g) => g.label).join(" ")}`);

  check("...and the Quality of Earnings card agrees with the anchor",
    vAzn.cashQuality.basis === "year" && vAzn.cashQuality.period === "FY2025",
    `${vAzn.cashQuality.basis} ${vAzn.cashQuality.period} — no mismatch paragraph is due, and none renders`);
  check("...so the period-mismatch paragraph does NOT render for it",
    !/does not publish a quarterly cash-flow statement/.test(
      visibleText(html(React.createElement(M.SecCashQualityCard, { view: vAzn })))));

  // THE CONTROLS. A rule that made everything annual would pass the three
  // assertions above and be a different bug.
  for (const [sym, view, set] of [["AAPL", vAapl, AAPL], ["TSLA", vTsla, TSLA]]) {
    check(`${sym}: newest quarter is later than its newest year, so the anchor stays a quarter`,
      newest(set.quarters) > newest(set.years) && view.basis === "quarter" &&
        view.tableBasis === "quarter",
      `quarter ${newest(set.quarters)} > year ${newest(set.years)} -> ${view.basis}`);
  }
  check("KGC has no quarters at all, so both anchors are the year",
    vKgc.basis === "year" && vKgc.tableBasis === "year",
    `${vKgc.basis} / ${vKgc.tableBasis}`);

  // ── A TABLE OF QUARTERS HAS TO BE ABOUT RECENT QUARTERS ─────────────────
  //
  // Anchoring on the newest period by date exposed this underneath: a filer
  // that stopped filing 10-Qs years ago still has those quarters stored, so a
  // FY2025 snapshot sat above a table from another decade. Production: CNI
  // 2009-09-30, ESLT 2016, IAG 2017, BIDU 2018.
  //
  // THE CNI SHAPE IS BUILT FROM REAL DATA, by keeping only AZN's OLDEST
  // quarters — a genuine filed series whose newest entry is years behind the
  // newest annual period. Nothing here invents a period.
  const STALE_DAYS = Number(
    (fs.readFileSync("lib/server/secEarningsView.ts", "utf8")
      .match(/STALE_QUARTER_DAYS = (\d+)/) ?? [])[1]
  );
  check("the staleness threshold is read from the view, not retyped",
    STALE_DAYS === 548, `${STALE_DAYS} days`);

  const vStale = M.buildSecEarningsView(STALE_AZN);
  const staleAge = Math.round(
    (Date.parse(vStale.latestEnd) - Date.parse(STALE_AZN.quarters[0].e)) / 86400000
  );
  check("the CNI-shaped set really is stale, by the threshold's own measure",
    staleAge > STALE_DAYS,
    `newest quarter ${STALE_AZN.quarters[0].e} is ${staleAge} days behind ${vStale.latestEnd}`);
  check("...so no quarterly table renders for it",
    vStale.tableBasis === "year" &&
      !/Recent reported quarters/.test(visibleText(renderPage(M, vStale))) &&
      vStale.growth.every((g) => /^FY\d{4}$/.test(g.label)),
    `tableBasis=${vStale.tableBasis}, rows: ${vStale.growth.map((g) => g.label).join(" ")}`);
  check("...and the page reads as annual throughout, with the five-year card as its growth table",
    /Latest reported year/.test(visibleText(renderPage(M, vStale))) &&
      strayQuarters(visibleText(renderPage(M, vStale))).length === 0,
    "wording follows tableBasis, so it cannot say 'quarter' over fiscal-year rows");

  // AZN ITSELF IS THE CONTROL, and it is the reason the threshold is 18 months
  // rather than something tighter: a half-yearly filer is ~6 months behind by
  // CADENCE, not by having stopped.
  const aznAge = Math.round(
    (Date.parse(vAzn.latestEnd) - Date.parse(AZN.quarters[0].e)) / 86400000
  );
  // ── THE CAPEX HEADING NAMES THE MEASURE THE COLUMN ACTUALLY IS ────────────
//
// capex resolves from ONE concept per filer, and the two in its chain are
// different measures — PaymentsToAcquireProductiveAssets is wider than the
// PP&E concept. A filer on the fallback is not showing the same line as a filer
// on the primary, so one heading over both is a false equivalence on exactly
// the filers that differ. THAT the extractor picks the right concept is
// asserted in check-sec-extract §7b; THIS is that the heading follows it.
//
// THE INPUT IS `cc`, NOT THE ANSWER. These three sets differ only in the stored
// choice, so the assertion is about the view reading it, and no fixture supplies
// the label it is checked against.
{
  const BROAD = "us-gaap|PaymentsToAcquireProductiveAssets";
  const NARROW = "us-gaap|PaymentsToAcquirePropertyPlantAndEquipment";
  const labelOf = (set) => M.buildSecEarningsView(set).cashQuality.capex.label;
  const rowOf = (set) =>
    visibleText(html(React.createElement(M.SecCashQualityCard, { view: M.buildSecEarningsView(set) })));

  check("a set written BEFORE the rule has no stored choice, and is not guessed at",
    GEV.cc === undefined && labelOf(GEV) === "Capital expenditure",
    `GEV.cc = ${JSON.stringify(GEV.cc ?? null)} — absent means "written before the rule", and ` +
      `the honest heading is the plain one; inventing the qualifier would mislabel the other direction`);
  check("a filer on the BROADER concept says so in the row heading",
    labelOf({ ...GEV, cc: { capex: BROAD } }) === "Capital expenditure (incl. other productive assets)",
    labelOf({ ...GEV, cc: { capex: BROAD } }));
  check("...and that heading reaches the reader, not just the view",
    /Capital expenditure \(incl\. other productive assets\)/.test(rowOf({ ...GEV, cc: { capex: BROAD } })),
    "the card read the label off the cell rather than hardcoding one");
  check("a filer on the PP&E concept keeps the plain heading",
    labelOf({ ...GEV, cc: { capex: NARROW } }) === "Capital expenditure" &&
      !/incl\. other productive assets/.test(rowOf({ ...GEV, cc: { capex: NARROW } })),
    "the qualifier is not a standing decoration — it appears only where the measure is wider");
}

// ── THE RECENT-PERIODS TABLE IS HELD TO THE SAME BAR AS THE GROWTH TABLE ──
//
// WHAT THE OWNER SAW ON THE PREVIEW: AZN's "Recent reported quarters" rendered
// 2019-2021 rows carrying a revenue figure and "Not reported" under both
// Diluted EPS and Net income. Those are the SAME periods the growth table had
// already ruled too thin to be a row — AZN stores one field for each — shown
// one card further down because this table mapped the whole stored list with no
// filter and no cap while the growth table filtered and sliced it.
//
// ASSERTED ON THE RENDERED TABLE, not on view.recentPeriods.length: a cap
// applied to the array and a cap applied to the rows are the same number until
// someone renders a subset, and it is the rows a reader counts.
{
  const aznRows = (visibleText(html(React.createElement(M.SecRecentPeriodsCard, { view: vAzn })))
    .match(/Q\d FY20\d\d/g) ?? []);
  const thinEnds = AZN.quarters
    .filter((p) => p.v.filter((v) => v !== null).length <= 1)
    .map((p) => p.e);
  check("AZN's thin quarters are real, and this is how many there are",
    thinEnds.length > 0,
    `${thinEnds.length} of ${AZN.quarters.length} stored quarters carry one field: ${thinEnds.join(" ")}`);
  check("...and none of them renders a row in the recent-periods table",
    vAzn.recentPeriods.every((r) => !thinEnds.includes(r.end)),
    `rows: ${vAzn.recentPeriods.map((r) => r.label).join(" ")}`);
  check("...so no rendered row reads 'Not reported' under BOTH EPS and net income",
    vAzn.recentPeriods.every((r) => r.epsDiluted.val !== null || r.netIncome.val !== null),
    "a row whose only content is revenue is a gap with one number in it, here as in the growth table");
  check("...and the table is capped at the same number of rows as the growth table",
    aznRows.length <= RENDERED_QUARTERS_RENDERED && aznRows.length === vAzn.recentPeriods.length,
    `${aznRows.length} rendered rows against a cap of ${RENDERED_QUARTERS_RENDERED}`);
  check("...while TTM still reads the FULL stored list, not the rendered one",
    vAzn.ttmRevenue !== null,
    "filtering the DISPLAY must not change an aggregate computed from what is stored");
}

{
  // MUTATION: the filter and the cap dropped, so the thin rows come back.
  const rpMod = await loadCards((src) =>
    src.replace(
      '      .filter((p) => valueOf(p, "epsDiluted") !== null || valueOf(p, "netIncome") !== null)\n      .slice(0, renderLimit)\n',
      ""
    )
  );
  const rpView = rpMod.buildSecEarningsView(AZN);
  const rpRows = (visibleText(html(React.createElement(rpMod.SecRecentPeriodsCard, { view: rpView })))
    .match(/Q\d FY20\d\d/g) ?? []);
  check("the recent-periods mutation actually applied", rpView.recentPeriods.length !== vAzn.recentPeriods.length);
  check("MUTATION: without the filter and cap, the one-field quarters return",
    rpView.recentPeriods.length === AZN.quarters.length &&
      rpRows.length > RENDERED_QUARTERS_RENDERED,
    `${vAzn.recentPeriods.length} rows -> ${rpView.recentPeriods.length}, rendering ` +
      `${rpRows.length} against a cap of ${RENDERED_QUARTERS_RENDERED} — the 2019-2021 rows come back`);
}

check("AZN keeps its table, with room to spare",
    vAzn.tableBasis === "quarter" && aznAge < STALE_DAYS,
    `${aznAge} days behind, against a ${STALE_DAYS}-day threshold`);

  // AND THE COMPARATOR IS SEARCHED IN THE ANCHOR'S OWN LIST. With the anchor a
  // year and the tables on quarters, searching the table list for FY2024 finds
  // nothing — a blank comparison on a filer that has the prior year stored.
  check("the snapshot's prior-year comparison resolves for AZN",
    vAzn.snapshot.comparedWith === "FY2024",
    `compared with ${vAzn.snapshot.comparedWith}`);
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
      "  if (cell.val == null) {\n    if (short) {",
      "  if (false) {\n    if (short) {"
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
  // FORCES BOTH PUBLISHED FIELDS, which is what this mutation meant before the
  // anchor split: one field used to decide both the wording and whether the
  // quarterly tables render, and this reproduces that state exactly.
  const forceQuarter = (src) =>
    src.replace(
      "  return {\n    symbol: set.symbol,",
      '  const forcedBasis: PeriodBasis = "quarter";\n  return {\n    symbol: set.symbol,'
    // ANCHORED ON THE PAIR, not on "\n    basis,\n" alone. A single-line anchor
    // is a first-match anchor over three inlined files, and it silently moved
    // to an unrelated `basis,` shorthand in secExtract — mutating a function
    // this section has nothing to do with while reporting that it applied.
    ).replace("\n    basis,\n    tableBasis,\n",
              "\n    basis: forcedBasis,\n    tableBasis: forcedBasis,\n");
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

  // ── (j) "ALWAYS PREFER QUARTERS" — the rule that shipped the stale snapshot ─
  const preferQuarters = (src) =>
    src.replace(
      "    !!newestYear && (!newestQuarter || newestYear.e > newestQuarter.e);",
      "    !!newestYear && !newestQuarter;"
    );
  check("the prefer-quarters mutation actually applied", preferQuarters(cardsSrc) !== cardsSrc);
  const jMod = await loadCards(preferQuarters);
  const jView = jMod.buildSecEarningsView(AZN);
  const jSnap = visibleText(html(React.createElement(jMod.SecSnapshotCard, { view: jView })));
  check("(j) MUTATION: preferring quarters puts AZN's stale snapshot back",
    jView.basis === "quarter" && jView.latestLabel === "Q2 FY2025" &&
      jView.latestEnd === "2025-06-30" &&
      /Most recent quarter filed: Q2 FY2025/.test(jSnap),
    `snapshot returns to ${jView.latestLabel} ended ${jView.latestEnd}, six months older than the FY2025 the store holds`);
  check("...and KGC is unaffected either way, because it has no quarters to prefer",
    jMod.buildSecEarningsView(KGC).basis === "year",
    "a mutation that also broke the annual-only filer would be testing something else");

  // ── (k) THE STALENESS TEST IS REMOVED ───────────────────────────────────
  const dropStaleTest = (src) =>
    src.replace(
      "    !annualOnly && quarterAgeDays !== null && quarterAgeDays <= STALE_QUARTER_DAYS;",
      "    !annualOnly;"
    );
  check("the staleness mutation actually applied", dropStaleTest(cardsSrc) !== cardsSrc);
  const kMod = await loadCards(dropStaleTest);
  const kView = kMod.buildSecEarningsView(STALE_AZN);
  // ASSERTED ON THE RENDERED TABLE, NOT ON growth.every(). The first version of
  // this read `kView.growth.every(...)` and PASSED VACUOUSLY: those three oldest
  // quarters have no prior year stored, so the thin-row filter empties `growth`
  // and `every` on an empty array is true. A check that cannot fail is not a
  // check — the same class of defect this suite exists to catch, in the suite.
  const kText = visibleText(renderPage(kMod, kView));
  const kQuarterRows = (kText.match(/Q\d FY20(0|1|2)\d/g) ?? []);
  check("(k) MUTATION: without the 548-day test, the decade-old table comes back",
    kView.tableBasis === "quarter" && /Recent reported quarters/.test(kText) &&
      kQuarterRows.length > 0,
    `the table returns with ${kQuarterRows.length} quarter labels — ${[...new Set(kQuarterRows)].join(" ")} — under a FY2025 snapshot`);
  check("...and AZN is unaffected, so the mutation is not simply turning everything quarterly",
    kMod.buildSecEarningsView(AZN).tableBasis === "quarter" &&
      kMod.buildSecEarningsView(KGC).tableBasis === "year",
    "AZN kept its table either way; KGC has no quarters to restore");
  // ...AND THE GROWTH & MARGINS CARD, which is the other half of the rule. The
  // ruling is that a stale quarterly series drops the table AND the quarterly
  // growth card; this mutation could only ever observe the table, because the
  // harness gated that card on `basis` where the page gates it on `tableBasis`.
  // Rendered through the same gate the page uses, so it cannot drift again.
  const kGrowth = (kText.match(/Is growth accelerating/g) ?? []).length;
  const baseGrowth = (visibleText(renderPage(M, M.buildSecEarningsView(STALE_AZN)))
    .match(/Is growth accelerating/g) ?? []).length;
  check("(k) ...and the quarterly GROWTH card comes back with it, not just the table",
    kGrowth === 1 && baseGrowth === 0,
    `growth & margins card: ${baseGrowth} unmutated -> ${kGrowth} mutated — the rule drops both, so the mutation must restore both`);

  // THE HARNESS'S GATE IS THE PAGE'S GATE, read from page.tsx rather than
  // agreed with. Both fields exist on the view, so a harness on the wrong one
  // renders a plausible page and asserts about the wrong reader.
  const pageSrc = fs.readFileSync("app/stock/[symbol]/earnings/page.tsx", "utf8");
  const pageGate = (pageSrc.match(/\{secView\.(\w+) === "year" \? null : <SecGrowthMarginsCard/) ?? [])[1];
  const soleGate = (pageSrc.match(/<SecAnnualCard view=\{secView\} sole=\{secView\.(\w+) === "year"\}/) ?? [])[1];
  check("the harness gates the growth card on the same field page.tsx does",
    pageGate === "tableBasis" && soleGate === "tableBasis",
    `page.tsx gates on ${pageGate} / ${soleGate}; this harness gates on tableBasis`);

  // (c) THE CARD REVERTS TO PENDING — the permanent-pending failure.
  const c = await loadCards();
  const pendingText = visibleText(html(React.createElement(c.SecPendingCard, { symbol: "KGC" })));
  check("(c) a pending card is recognisable, so reverting to one is catchable",
    /check back|being fetched/i.test(pendingText) &&
      !/check back|being fetched/i.test(visibleText(renderAll(M, vKgc, "KGC"))),
    "KGC renders the annual page; the pending wording appears only in the pending card");
}

console.log("\n15. EPS is labelled with the standard the filer reports under");
{
  // AZN and KGC file IFRS (ifrs-full is their only financial namespace); AAPL
  // files US GAAP. The label said "GAAP" on all three (owner, #514).
  const t = (v, sym) => visibleText(renderAll(M, v, sym));
  const azn = t(vAzn, "AZN"), kgc = t(vKgc, "KGC"), aapl = t(vAapl, "AAPL");
  check("AZN's EPS labels say IFRS and never GAAP",
    /Diluted EPS \(IFRS\)/.test(azn) && !/GAAP/.test(azn), (azn.match(/[^.]*GAAP[^.]*/) ?? [""])[0]);
  check("KGC's EPS labels say IFRS and never GAAP",
    /EPS \(IFRS\)/.test(kgc) && !/GAAP/.test(kgc), (kgc.match(/[^.]*GAAP[^.]*/) ?? [""])[0]);
  check("AAPL's still say GAAP, and never IFRS",
    /Diluted EPS \(GAAP\)/.test(aapl) && /EPS is GAAP, as filed/.test(M.epsBasisNote(vAapl.accounting)) && !/IFRS/.test(aapl));
  // ── THE BASIS NOTE IS STATED ONCE, IN THE HERO ─────────────────────────
  // It was printed under the snapshot, the five-year table, the valuation
  // card and the income statement — four times on AVAV (cleanup brief A7).
  const pageRaw = fs.readFileSync("app/stock/[symbol]/earnings/page.tsx", "utf8");
  const onCards = (aapl.match(/Companies often headline an adjusted/g) ?? []).length;
  check("the EPS-basis note is not repeated on the cards",
    onCards === 0, `${onCards} copies across the rendered cards`);
  check("...and the page states it once, in the hero, from the filer's own standard",
    (pageRaw.match(/epsBasisNote\(/g) ?? []).length === 1 && /heroNote">\{epsBasisNote\(secView\.accounting\)\}/.test(pageRaw),
    "one call, in the hero");
  const hard = await loadCards(once(
    'return accounting === "IFRS" ? "IFRS" : accounting === "US GAAP" ? "GAAP" : "as filed";',
    'return "GAAP";'
  ));
  check("...and CATCHES the standard hardcoded back to GAAP",
    /GAAP/.test(visibleText(renderAll(hard, hard.buildSecEarningsView(AZN), "AZN"))));
}

console.log("\n16. AVAV — the earnings-page cleanup brief, on the filer it was written about");
{
  // AVAV Q1 FY2027: revenue +5.7% and operating margin -2.3% from -15.2%
  // against Q1 FY2026, a loss in both quarters. Every assertion below is a
  // sentence the page used to print about exactly these figures.
  const AVAV = fixture("AVAV");
  const vAvav = M.buildSecEarningsView(AVAV);
  const sc = M.scoreFromSec(vAvav, "AVAV", { status: "ready" });
  const cov = M.coverageOf(sc);
  const card = visibleText(html(React.createElement(M.SecScoreCard, { symbol: "AVAV", score: sc, coverage: cov })));
  check("A1: a reach as wide as the scale is not printed as a range",
    cov.low === 0 && cov.high === 100 && !/between 0 and 100/.test(card), card.slice(0, 160));
  check("A2: EPS growth is missing because both quarters were losses — and the card says that",
    sc.unavailableWhy.length === 1 && sc.unavailableWhy[0].key === "epsGrowth" &&
      /EPS growth — loss in both quarters/.test(card) && !/do not carry it/.test(card),
    JSON.stringify(sc.unavailableWhy));
  check("A3: the narrative agrees with the page — margin widened, revenue grew, quarter loss-making",
    /revenue grew 5\.7% against Q1 FY2026/i.test(sc.explanation) && /operating margin widened 13\.0pp/.test(sc.explanation) &&
      /loss-making/.test(sc.explanation) && !/slipping|under pressure/.test(sc.explanation),
    sc.explanation);
  check("A4: and it instructs nobody",
    !/\b(should|must)\b/i.test(card), sc.explanation);
  const flipped = await loadCards(once(
    "const mTone = toneForMarginDelta(pp);",
    'const mTone = toneForMarginDelta(pp) === "good" ? "weak" : "good";'
  ));
  check("...and CATCHES a margin clause that ignores the margin's own sign",
    /narrowed/.test(flipped.scoreFromSec(flipped.buildSecEarningsView(AVAV), "AVAV", { status: "ready" }).explanation));

  // A5: the FY2022/FY2023 revenue AVAV filed as IncludingAssessedTax.
  const years = Object.fromEntries(vAvav.annual.map((r) => [r.label, r.revenue.val]));
  check("A5: FY2022 and FY2023 revenue read from the widened chain",
    years.FY2022 === 445732000 && years.FY2023 === 540536000,
    JSON.stringify(years));
  // A blank revenue cell says which kind of blank it is, never "Not reported".
  const noLine = { ...vAvav, untagged: ["revenue"], annual: vAvav.annual.map((r) => ({ ...r, revenue: { ...r.revenue, val: null } })) };
  const annualText = visibleText(html(React.createElement(M.SecAnnualCard, { view: noLine })));
  // SHORT IN THE TABLE since round 2, with the full reason as the tooltip.
  const annualMarkup16 = html(React.createElement(M.SecAnnualCard, { view: noLine }));
  check("...and a revenue cell with no line reads 'No revenue line', not 'Not reported'",
    />No revenue line</.test(annualMarkup16) && annualMarkup16.includes(`title="${M.EMPTY_REASONS.noRevenueLine}:`) &&
      !/Revenue[^|]{0,40}Not reported/.test(annualText.slice(0, 400)),
    annualText.slice(0, 200));

  // B: the valuation card is two tiles, with no paragraph under them.
  const val = visibleText(html(React.createElement(M.SecValuationCard, {
    view: vAvav, inputs: M.valuationInputs(AVAV, "2026-09-22"), price: 164.31, priceAsOf: "2026-09-21", today: "2026-09-22",
  })));
  check("B: valuation reads Market cap $8.4B and P/E Not meaningful, each with a one-line caption",
    /Market cap \$8\.4B 50\.8M shares × \$164\.31 close, 2026-09-21/.test(val) &&
      /P\/E \(GAAP, trailing\) Not meaningful Loss over/.test(val) && !/never an adjusted figure/.test(val),
    val);
  // TREND: the median beside the newest period (owner review, #522). AVAV's
  // typical quarter is dominated by its acquisition year; the latest is not.
  const trend = visibleText(html(React.createElement(M.SecTrendSummaryCard, { view: vAvav })));
  check("the trend card prints Typical beside Latest",
    /Revenue growth Typical \+133\.3% Latest \+5\.7%/.test(trend) && /Operating margin Typical -2\.1% Latest -2\.3%/.test(trend),
    trend);
  const firstNotLast = await loadCards(once(
    "const last = values.length ? values[values.length - 1] : null;",
    "const last = values.length ? values[0] : null;"
  ));
  check("...and CATCHES the oldest period passed off as the latest",
    !/Latest \+5\.7%/.test(visibleText(html(React.createElement(firstNotLast.SecTrendSummaryCard, { view: firstNotLast.buildSecEarningsView(AVAV) })))));
  // A7 + B: the crossing footnote is printed once on the page, however many
  // cards carry a crossing.
  const whole = visibleText(renderAll(M, vAvav, "AVAV"));
  const crossingCopies = (whole.match(/Where a period crosses between profit and loss/g) ?? []).length;
  check("the crossing footnote is printed exactly once",
    crossingCopies === 1, `${crossingCopies} copies`);
}

console.log("\n17. round 2 — fiscal-year ends said once, a horizon not reached draws no bar");
{
  // ── THE DATE RULE: same day / varying day / varying month ───────────────
  const note = M.fiscalYearEndNote;
  const vAvav2 = M.buildSecEarningsView(fixture("AVAV"));
  check("same month and day on every row: 'Fiscal years end 30 April.' (AVAV)",
    note(vAvav2.annual.map((r) => r.end)) === "Fiscal years end 30 April.", note(vAvav2.annual.map((r) => r.end)));
  check("the day moving inside one month: 'late September' (AAPL, a 52/53-week filer)",
    note(vAapl.annual.map((r) => r.end)) === "Fiscal years end in late September.",
    `${vAapl.annual.map((r) => r.end).join(" ")} -> ${note(vAapl.annual.map((r) => r.end))}`);
  check("...a day spread across two thirds of the month names the month alone",
    note(["2024-09-08", "2025-09-14"]) === "Fiscal years end in September.", note(["2024-09-08", "2025-09-14"]));
  check("the month moving: no sentence at all",
    note(["2023-12-30", "2025-01-02"]) === null && note([]) === null, String(note(["2023-12-30", "2025-01-02"])));
  const noMonthRule = await loadCards(once("  if (months.size !== 1) return null;", ""));
  check("...and CATCHES the month rule removed",
    noMonthRule.fiscalYearEndNote(["2023-12-30", "2025-01-02"]) !== null);
  const annualText = visibleText(html(React.createElement(M.SecAnnualCard, { view: vAvav2 })));
  const annualMarkup = html(React.createElement(M.SecAnnualCard, { view: vAvav2 }));
  check("the five-year table drops the 'ended' line and keeps the date as the label's tooltip",
    !/ended \d{4}-\d{2}-\d{2}/.test(annualText) && /title="Ended 2026-04-30"/.test(annualMarkup) &&
      /Each fiscal year as filed, compared with the year before\. Fiscal years end 30 April\./.test(annualText),
    annualText.slice(0, 160));

  // ── SHORT CELLS IN NARROW COLUMNS ───────────────────────────────────────
  const blank = { ...vAvav2, untagged: [], annual: vAvav2.annual.map((r) => ({ ...r, revenue: { ...r.revenue, val: null } })) };
  const bMarkup = html(React.createElement(M.SecAnnualCard, { view: blank }));
  check("a table cell prints 'Not captured' with the full reason as its tooltip",
    />Not captured</.test(bMarkup) && /title="Not captured from this filing: /.test(bMarkup) &&
      !/>Not captured from this filing</.test(bMarkup), "");

  // ── A HORIZON NOT REACHED YET: NO BAR, A MARKER, A TOOLTIP ──────────────
  const R = await loadReactionCharts();
  const qs = [
    { label: "Q4 FY2026", reactionPct: 3.1, drift5Pct: -1.2, drift20Pct: 6.4, drift5Pending: false, drift20Pending: false },
    { label: "Q1 FY2027", reactionPct: 4.5, drift5Pct: 2.0, drift20Pct: null, drift5Pending: false, drift20Pending: true },
  ];
  const chart = html(React.createElement(R.DriftBarChart, { quarters: qs }));
  const bars = (chart.match(/class="driftBar"/g) ?? []).length;
  const heights = [...chart.matchAll(/<path d="M[\d.]+,([\d.]+) V([\d.]+)/g)].map((m) => Math.abs(Number(m[1]) - Number(m[2])));
  check("a missing +20d horizon draws no bar: 5 bars for 6 slots, none of zero height",
    bars === 5 && heights.length === 5 && heights.every((h) => h > 0), `${bars} bars, heights ${heights.map((h) => h.toFixed(1)).join(",")}`);
  check("...but a marker whose tooltip says why",
    /data-pending="drift20Pct"/.test(chart) && /<title>Q1 FY2027 · \+20 trading days: Not yet 20 trading days<\/title>/.test(chart), "");
  check("every bar's tooltip carries its exact figure",
    /<title>Q4 FY2026 · \+5 trading days: -1\.2%<\/title>/.test(chart) && /<title>Q1 FY2027 · Day of reaction: \+4\.5%<\/title>/.test(chart), "");
  const zeroBar = await loadReactionCharts(once(
    "                if (v == null || !Number.isFinite(v)) {",
    "                if (false) {"
  ));
  let caught;
  try {
    const m = html(React.createElement(zeroBar.DriftBarChart, { quarters: qs }));
    caught = (m.match(/class="driftBar"/g) ?? []).length !== 5 || /NaN/.test(m);
  } catch { caught = true; }
  check("...and CATCHES a missing horizon drawn as a bar", caught);
  const card = visibleText(html(React.createElement(R.PriceReactionCard, {
    symbol: "AVAV", latest: { label: "Q1 FY2027", reactionPct: 4.5, volumeMultiple: 5.9 },
    reaction: qs.map((q) => ({ label: q.label, value: q.reactionPct })), drift: qs, datesFromSec: true,
    uncoveredLabels: [], noPriceHistoryNote: "",
  })));
  check("the price-reaction card carries the round-2 copy and nothing it replaced",
    /Close-to-close move around each results filing\. After-close filings are measured to the next day's close\./.test(card) &&
      /Most recent reaction \(Q1 FY2027\): \+4\.5% on 5\.9x average volume\./.test(card) &&
      /Price vs\. the pre-earnings close, after 1, 5 and 20 trading days\./.test(card) &&
      /Includes broader market moves, not only the earnings news\./.test(card) &&
      !/Each bar is keyed/.test(card) && !/clean read of earnings reaction/.test(card),
    card);
}

console.log(failures ? `\n${failures} assertion(s) failed.\n` : "\nRendered output holds.\n");
process.exit(failures ? 1 : 0);
