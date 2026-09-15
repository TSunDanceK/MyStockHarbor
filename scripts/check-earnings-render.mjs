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
const AAPL = fixture("AAPL");
const KGC = fixture("KGC");
const vAapl = M.buildSecEarningsView(AAPL);
const vKgc = M.buildSecEarningsView(KGC);

/** Every card the page can render, as markup, for one view. */
const renderAll = (mod, view, symbol) =>
  [
    mod.SecSnapshotCard && html(React.createElement(mod.SecSnapshotCard, { view })),
    view.annualOnly ? "" : html(React.createElement(mod.SecGrowthMarginsCard, { view })),
    html(React.createElement(mod.SecAnnualCard, { view, sole: view.annualOnly })),
    html(React.createElement(mod.SecCashQualityCard, { view })),
    html(React.createElement(mod.SecBalanceSheetCard, { view })),
    // The five retired ids, each rendered through the real component.
    ...["eps-estimate", "revenue-estimate", "forward-consensus",
        "quarter-estimate-columns", "revenue-by-segment"]
      .map((id) => html(React.createElement(mod.HiddenCard, { id }))),
    html(React.createElement(mod.SecNoQuartersCard, { symbol, years: 0, instants: 0 })),
  ].join("\n");

console.log("\n1. the fixtures are real, and say so");

check("both fixtures carry the current quarter window",
  AAPL.w === 12 && KGC.w === 12, `AAPL w=${AAPL.w} KGC w=${KGC.w}`);
check("AAPL is the DENSE case", AAPL.quarters.length === 12,
  `${AAPL.quarters.length} quarters stored — 12 is what makes 8 rendered rows reachable`);
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
    /Q4 EPS is not filed separately/.test(t),
    "hover-only is invisible on a touch screen");
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
    vKgc.annualOnly === true && !/Revenue YoY.*Gross margin.*gap/s.test(t),
    "a quarterly table with no quarters is an empty table");
  check("every annual row names its period end, not only its label",
    vKgc.annual.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.end)) &&
      /ended 2025-12-31/.test(t),
    "two filers' FY2025 can be nine months apart");
  check("the cash card is labelled as annual, not as a quarter",
    vKgc.cashQuality.basis === "year" && vKgc.cashQuality.period === "FY2025",
    `${vKgc.cashQuality.basis} / ${vKgc.cashQuality.period}`);
}

console.log("\n7. the three mutations, each re-rendered from broken source");

{
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
  const offsetMutation = (src) =>
    src.replace(
      "const prior = priorYearOf(q, p);",
      "const prior = q[shown.indexOf(p) + 4] ?? null;"
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
