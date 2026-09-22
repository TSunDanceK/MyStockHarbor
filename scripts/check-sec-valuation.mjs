// THE VALUATION NUMERATORS — every refusal run, and run again with the rule
// removed so the assertion is shown to be load-bearing.
//
// Each case below is one that produces a PLAUSIBLE NUMBER rather than an error
// when the rule is absent, which is why they are worth a check at all: a P/E of
// 19 built from three quarters looks exactly like a P/E of 14 built from four,
// and nothing downstream can tell them apart.
import { readCodeOnly, grabConst } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");

const FIELDS = readCodeOnly("lib/server/secFields.ts");
const PRELUDE = [
  FIELDS,
  strip("lib/server/secExtract.ts"),
  strip("lib/server/fxRates.ts"),
  strip("lib/server/secCurrency.ts"),
  strip("lib/server/secFactCodec.ts"),
  strip("lib/server/secEarningsView.ts"),
  // DEADLINE_FALLBACK ONLY, lifted from secReportDates by name.
  //
  // COVER_SHARES_MAX_AGE_DAYS is DERIVED from the statutory table rather than
  // written as a number, so the lift needs that constant. Pinning 455 here
  // instead would put the bound in two places that can disagree -- exactly
  // claude/traps/two-validators-for-one-value.md, and exactly what the lift
  // harness's "never pin a literal" refusal exists to prevent.
  //
  // THE WHOLE MODULE CANNOT BE LIFTED: it declares `DAY`, which the prelude
  // already has, and the duplicate is a SyntaxError at import. So one
  // declaration is cut out by name, and cutting it fails loudly rather than
  // silently yielding nothing.
  grabConst("lib/server/secReportDates.ts", "DEADLINE_FALLBACK"),
].join("\n");
const SRC = strip("lib/server/secValuation.ts");

/** Sums of decimals are not decimals: 1.0+0.9+1.2+0.8 is 3.8999999999999995. */
const near = (a, b, eps = 1e-9) => typeof a === "number" && Math.abs(a - b) < eps;

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const build = (src = SRC) => lift([PRELUDE, src].join("\n"));
const mod = await build();

const underMutation = async (name, from, to, probe) => {
  if (!SRC.includes(from)) {
    check(`mutation "${name}" could not be applied`, false, `source no longer contains: ${from.slice(0, 70)}`);
    return;
  }
  let stillHolds;
  try {
    stillHolds = await probe(await build(SRC.replace(from, to)));
  } catch {
    stillHolds = false;
  }
  check(`MUTATION "${name}" breaks the assertion`, !stillHolds,
    stillHolds ? "the property still held with the rule removed — the assertion above proves nothing" : "");
};

// ── fixtures, positional like the real stored set ─────────────────────────
const EPS = mod.SEC_FIELD_INDEX.epsDiluted;
const WIDTH = mod.SEC_FIELD_KEYS.length;
const q = (fy, fp, end, eps) => {
  const v = Array(WIDTH).fill(null);
  if (eps !== null) v[EPS] = eps;
  return { e: end, s: null, fp, fy, a: "a", f: end, v, d: "" };
};
const set = (over = {}) => ({
  h: "x", symbol: "T", cik: "1", entityName: "T", at: 0,
  quarters: [], years: [], instants: [],
  cover: { asOf: "2026-07-15", accession: "a", filed: "2026-07-15", val: 1_000_000, derived: "as-filed" },
  contentHash: "c", notes: [], ...over,
});
// THE CLOCK, FIXED. valuationInputs now takes `today`, so the staleness bound
// can be exercised at a chosen date rather than by waiting. TODAY sits five
// days after the default fixture's cover asOf (2026-07-15), so every assertion
// written before the bound existed is unaffected by it.
const TODAY = "2026-07-20";

const FOUR = [
  q(2026, "Q2", "2026-06-30", 1.0),
  q(2026, "Q1", "2026-03-31", 0.9),
  q(2025, "Q4", "2025-12-31", 1.2),
  q(2025, "Q3", "2025-09-30", 0.8),
];

console.log("\n1. TWELVE MONTHS MEANS TWELVE MONTHS");
{
  const good = mod.valuationInputs(set({ quarters: FOUR }), TODAY);
  check("four consecutive quarters sum to a TTM",
    near(good.eps?.val, 3.9) && good.eps.basis === "four-quarters" && good.eps.periodEnd === "2026-06-30",
    `got ${good.eps?.val} on ${good.eps?.basis} to ${good.eps?.periodEnd}`);

  // THREE QUARTERS. The common case after D1b, and the one that understates by
  // a quarter while looking entirely normal.
  const three = mod.valuationInputs(set({ quarters: FOUR.slice(0, 3) }), TODAY);
  check("three quarters REFUSE rather than summing to a short year",
    three.eps === null && three.refusals.includes("no-twelve-month-eps"),
    `got ${JSON.stringify(three.eps)}`);

  // A NULL Q4 among four rows — four entries, three numbers.
  const holed = [FOUR[0], FOUR[1], q(2025, "Q4", "2025-12-31", null), FOUR[3]];
  const nulled = mod.valuationInputs(set({ quarters: holed }), TODAY);
  check("four rows with a null among them refuse too",
    nulled.eps === null,
    "a null cell is not a zero quarter");

  // FOUR REAL NUMBERS SPANNING FIFTEEN MONTHS. Q2 is missing, so the newest
  // four entries reach back an extra quarter — and every value is present, so
  // an all-four-or-null rule alone admits it.
  const gapped = [
    q(2026, "Q2", "2026-06-30", 1.0),
    q(2025, "Q4", "2025-12-31", 1.2),
    q(2025, "Q3", "2025-09-30", 0.8),
    q(2025, "Q2", "2025-06-30", 0.7),
  ];
  const gappedIn = mod.valuationInputs(set({ quarters: gapped }), TODAY);
  check("four NON-consecutive quarters refuse, though all four values exist",
    gappedIn.eps === null,
    `Q1 is missing, so these four span fifteen months; all-four-or-null alone would sum them to ${1.0 + 1.2 + 0.8 + 0.7}`);
  await underMutation(
    "consecutiveness test removed (all-four-or-null only)",
    "  for (let i = 1; i < four.length; i++) {\n    if (!isConsecutive(four[i - 1], four[i])) return null;\n  }",
    "",
    (m) => m.valuationInputs(set({ quarters: gapped }), TODAY).eps === null
  );
  // PROBED WITH `holed`, NOT the three-quarter set. Three rows return early on
  // `four.length < 4`, so the null test is never reached and removing it
  // changes nothing — the first version of this mutation passed while proving
  // nothing. `holed` is four CONSECUTIVE rows with one null value, which is the
  // only shape that reaches the rule. Without it `null` coerces to 0 in the
  // sum and the TTM silently loses a quarter.
  await underMutation(
    "all-four-or-null test removed",
    "  if (vals.some((v) => v === null)) return null;",
    "",
    (m) => m.valuationInputs(set({ quarters: holed }), TODAY).eps === null
  );
}

console.log("\n2. A FISCAL YEAR IS A BASIS; FY PLUS NINE MONTHS IS NOT");
{
  const yearOnly = mod.valuationInputs(set({
    quarters: [],
    years: [q(2025, "FY", "2025-12-31", 4.2)],
  }), TODAY);
  check("an annual-only filer uses its fiscal year, which IS twelve months",
    near(yearOnly.eps?.val, 4.2) && yearOnly.eps.basis === "fiscal-year",
    `got ${yearOnly.eps?.val} on ${yearOnly.eps?.basis} — RYAAY and ABEV are this shape`);

  // THE TWO BASES ARE NEVER COMBINED. A filer with three quarters AND a fiscal
  // year must not produce FY + 9M; it falls to the whole year.
  const both = mod.valuationInputs(set({
    quarters: FOUR.slice(0, 3),
    years: [q(2025, "FY", "2025-12-31", 4.2)],
  }), TODAY);
  check("three quarters beside a fiscal year give the YEAR, never the sum of both",
    near(both.eps?.val, 4.2) && both.eps.basis === "fiscal-year",
    `got ${both.eps?.val} on ${both.eps?.basis}; FY+9M would be ${4.2 + 1.0 + 0.9 + 1.2}`);
  check("and quarters are PREFERRED when they qualify, because they are newer",
    mod.valuationInputs(set({ quarters: FOUR, years: [q(2025, "FY", "2025-12-31", 4.2)] }), TODAY)
      .eps?.basis === "four-quarters");
}

console.log("\n3. A MULTI-CLASS SHARE COUNT CANNOT BE PICKED");
{
  const ambiguous = mod.valuationInputs(set({
    quarters: FOUR,
    cover: { asOf: "2026-07-15", accession: "a", filed: "2026-07-15", val: null, derived: "ambiguous", candidates: [600_000, 400_000] },
  }), TODAY);
  check("an ambiguous cover count yields no share basis",
    ambiguous.shares === null &&
      ambiguous.refusals.includes("multi-class-share-count-is-ambiguous"),
    "the extractor already refused to choose; picking here routes around it");
  check("...and market cap says WHY rather than going blank",
    mod.marketCap(ambiguous, 50)?.ok === false &&
      mod.marketCap(ambiguous, 50)?.why === "multi-class-share-count-is-ambiguous",
    "'—' invites the reader to conclude something about the company");
  check("...while the P/E beside it is UNAFFECTED, because the legs are independent",
    mod.peRatio(ambiguous, 50)?.ok === true,
    `got ${JSON.stringify(mod.peRatio(ambiguous, 50))} — suppressing it would hide a figure that is on file`);
  await underMutation(
    "ambiguous multi-class count picked anyway",
    "  if (cover?.candidates?.length) {",
    "  if (false) {",
    (m) => m.valuationInputs(set({
      quarters: FOUR,
      cover: { asOf: "2026-07-15", accession: "a", filed: "2026-07-15", val: 600_000, derived: "ambiguous", candidates: [600_000, 400_000] },
    }), TODAY).shares === null
  );
}

console.log("\n4. THE FIGURES, AND WHAT THEY REFUSE");
{
  const ok = mod.valuationInputs(set({ quarters: FOUR }), TODAY);
  check("market cap is shares x price",
    mod.marketCap(ok, 50)?.val === 50_000_000,
    `1,000,000 shares at $50 -> ${mod.marketCap(ok, 50)?.val}`);
  check("P/E is price / TTM EPS",
    Math.abs(mod.peRatio(ok, 50).val - 50 / 3.9) < 1e-12,
    `$50 / 3.9 = ${mod.peRatio(ok, 50)?.val.toFixed(4)}`);
  check("the share count carries its own as-of date, distinct from the EPS period",
    ok.shares.asOf === "2026-07-15" && ok.eps.periodEnd === "2026-06-30",
    "the cover date sits weeks after the period end and is the newer, right count");

  // A LOSS-MAKER. -8.4 reads as a small positive multiple to anyone skimming.
  const loss = mod.valuationInputs(set({
    quarters: [q(2026, "Q2", "2026-06-30", -1.0), q(2026, "Q1", "2026-03-31", -0.9),
               q(2025, "Q4", "2025-12-31", -1.2), q(2025, "Q3", "2025-09-30", -0.8)],
  }), TODAY);
  check("a negative TTM EPS refuses a P/E rather than printing a negative multiple",
    mod.peRatio(loss, 50)?.ok === false && mod.peRatio(loss, 50)?.why === "eps-is-zero-or-negative",
    `TTM ${loss.eps.val}; a printed -12.8 reads as a small positive to a skimming reader`);
  check("...and its market cap still renders, because that leg is fine",
    mod.marketCap(loss, 50)?.ok === true);
  await underMutation(
    "non-positive EPS divided anyway",
    '  if (inputs.eps.val <= 0) return { ok: false, why: "eps-is-zero-or-negative" };',
    "",
    (m) => m.peRatio(loss, 50)?.ok === false
  );

  // A MISSING PRICE IS THE CALLER'S GAP, NOT A FILING REFUSAL.
  check("a missing price yields null, NOT a refusal about the filing",
    mod.marketCap(ok, null) === null && mod.peRatio(ok, null) === null,
    "attributing a bars outage to the cover page would misname the gap");
  check("a zero or negative price is treated the same way",
    mod.marketCap(ok, 0) === null && mod.peRatio(ok, -3) === null);
}

console.log("\n6. A FOREIGN PRIVATE ISSUER'S SHARE COUNT IS IN A DIFFERENT UNIT FROM ITS PRICE");
{
  // The trap in one line: this cover page is PERFECT. Single class, no
  // candidates, a clean positive count. Every guard that already existed
  // passes it, and the cap it produces is five times too big.
  const tsm = mod.valuationInputs(set({ symbol: "TSM", quarters: FOUR }), TODAY);
  check("the share basis is still read -- the count is a real filed fact",
    tsm.shares?.val === 1_000_000,
    "suppressing the COUNT would hide something the filer did state");
  check("but the refusal is raised, off the symbol and not off the cover page",
    tsm.refusals.includes("ads-ratio-makes-shares-incomparable"));
  check("...so market cap refuses rather than multiplying ordinary shares by an ADS price",
    mod.marketCap(tsm, 50)?.ok === false &&
      mod.marketCap(tsm, 50)?.why === "ads-ratio-makes-shares-incomparable",
    `got ${JSON.stringify(mod.marketCap(tsm, 50))} — 1,000,000 x 50 = 50,000,000 is plausible and wrong`);
  check("...and the refusal names the UNIT, not the company",
    /ordinary|depositary/.test(mod.REFUSAL_WORDS["ads-ratio-makes-shares-incomparable"]));

  check("all five decided filers are suppressed",
    ["HDB", "IBN", "TSM", "BABA", "ASML"].every((x) => mod.sharesAreIncomparableToPrice(x)),
    "claude/DECISIONS-earnings-calendar-v1-2026-09-21 names exactly these five");
  check("...case-insensitively, since symbols reach this from several stores",
    mod.sharesAreIncomparableToPrice("tsm") && mod.sharesAreIncomparableToPrice(" Tsm "));
  check("a domestic filer is UNAFFECTED and still gets a cap",
    mod.marketCap(mod.valuationInputs(set({ quarters: FOUR }), TODAY), 50)?.ok === true,
    "the default fixture symbol is T — a 20-F rule must not reach a 10-K filer");

  // THE ADS REASON WINS OVER THE CLASS REASON. Both are true for a
  // multi-class FPI; only one of them is certain.
  const both = mod.valuationInputs(set({
    symbol: "BABA", quarters: FOUR,
    cover: { asOf: "2026-07-15", accession: "a", filed: "2026-07-15", val: null, derived: "ambiguous", candidates: [6, 4] },
  }), TODAY);
  check("a multi-class FPI is refused for the UNIT, the more specific reason",
    mod.marketCap(both, 50)?.why === "ads-ratio-makes-shares-incomparable");

  // MEASURED 2026-09-21, relay 35588547888. The unit mismatch DOES reach EPS:
  // HDB 1.0000/47, TSM 0.9999/11 (ifrs-full), BABA 0.9984/47, ASML 1.0002/51.
  // Four of five confirmed per-ordinary-share; IBN publishes no XBRL at all.
  check("P/E is suppressed too, and for its OWN reason rather than the cap's",
    mod.peRatio(tsm, 50)?.ok === false &&
      mod.peRatio(tsm, 50)?.why === "ads-ratio-makes-eps-incomparable",
    `got ${JSON.stringify(mod.peRatio(tsm, 50))} — 50 / 3.9 = 12.8 is plausible and five times wrong`);
  check("...and the two refusals stay DISTINCT, because only one was measured",
    mod.marketCap(tsm, 50)?.why !== mod.peRatio(tsm, 50)?.why,
    "a cover-page count is ordinary BY DEFINITION; what EPS is denominated in was a finding");
  check("...with EPS words that name earnings, not the share count",
    /earnings per ordinary share/.test(mod.REFUSAL_WORDS["ads-ratio-makes-eps-incomparable"]));
  check("a domestic filer's P/E is UNAFFECTED",
    mod.peRatio(mod.valuationInputs(set({ quarters: FOUR }), TODAY), 50)?.ok === true);
  // The EPS itself is still read and still rendered beneath the refusal: it is
  // a real filed fact, and it is the reason the ratio is absent.
  check("the EPS basis is still populated — the figure is real, the DIVISION is not",
    near(tsm.eps?.val, 3.9));

  await underMutation(
    "stage 4: FPI market-cap suppression removed",
    '  if (inputs.refusals.includes("ads-ratio-makes-shares-incomparable")) {\n    return { ok: false, why: "ads-ratio-makes-shares-incomparable" };\n  }',
    "",
    (m) => m.marketCap(m.valuationInputs(set({ symbol: "TSM", quarters: FOUR }), TODAY), 50)?.ok === false
  );
  // THE ORDERING MUTANT, AND IT IS THE ONE THAT MATTERS. Gating the guard on a
  // MISSING share count is the plausible way to write this, and it is wrong in
  // exactly the case the rule exists for: TSM's cover page is clean, so
  // `inputs.shares` is set, so the guard never fires and the cap goes out five
  // times too big. Nothing throws and nothing looks odd on screen.
  await underMutation(
    "stage 4: FPI suppression gated on a missing share count (ordering)",
    '  if (inputs.refusals.includes("ads-ratio-makes-shares-incomparable")) {',
    '  if (!inputs.shares && inputs.refusals.includes("ads-ratio-makes-shares-incomparable")) {',
    (m) => m.marketCap(m.valuationInputs(set({ symbol: "TSM", quarters: FOUR }), TODAY), 50)?.ok === false
  );
  await underMutation(
    "stage 4: FPI P/E suppression removed",
    '  if (inputs.refusals.includes("ads-ratio-makes-eps-incomparable")) {\n    return { ok: false, why: "ads-ratio-makes-eps-incomparable" };\n  }',
    "",
    (m) => m.peRatio(m.valuationInputs(set({ symbol: "TSM", quarters: FOUR }), TODAY), 50)?.ok === false
  );
  // The plausible-but-wrong placement again, and it fails the same way: these
  // filers HAVE a clean twelve months of EPS, so a guard gated on its absence
  // never fires.
  await underMutation(
    "stage 4: FPI P/E suppression gated on a missing EPS (ordering)",
    '  if (inputs.refusals.includes("ads-ratio-makes-eps-incomparable")) {',
    '  if (!inputs.eps && inputs.refusals.includes("ads-ratio-makes-eps-incomparable")) {',
    (m) => m.peRatio(m.valuationInputs(set({ symbol: "TSM", quarters: FOUR }), TODAY), 50)?.ok === false
  );
  // Collapsing the two refusals would still suppress both figures, so a test
  // that only checked "is it refused" would pass. What breaks is the WORDS: the
  // P/E would blame the share count, which is not why it is absent.
  await underMutation(
    "stage 4: the two ADS refusals collapsed into one",
    '    refusals.push("ads-ratio-makes-shares-incomparable");\n    refusals.push("ads-ratio-makes-eps-incomparable");',
    '    refusals.push("ads-ratio-makes-shares-incomparable");',
    (m) => m.peRatio(m.valuationInputs(set({ symbol: "TSM", quarters: FOUR }), TODAY), 50)?.why
      === "ads-ratio-makes-eps-incomparable"
  );
  await underMutation(
    "stage 4: FPI symbol matching stops normalising case",
    "return ADS_FILERS_WITHOUT_A_STATED_RATIO.has(String(symbol).trim().toUpperCase());",
    "return ADS_FILERS_WITHOUT_A_STATED_RATIO.has(String(symbol));",
    (m) => m.sharesAreIncomparableToPrice("tsm") === true
  );
}

console.log("\n7. A SHARE COUNT THE FILER STOPPED UPDATING IS NOT A FACT ABOUT TODAY");
{
  // THE REAL SHAPE, from relay 35620148960. Berkshire's newest cover row in
  // companyfacts is dated 2011-04-29 and holds 941,481 -- the CLASS A count,
  // against a Class B count of roughly 1.3 billion. Before this bound it was
  // multiplied by today's close and rendered.
  const berkshire = set({
    quarters: FOUR,
    cover: { asOf: "2011-04-29", accession: "a", filed: "2011-04-29", val: 941_481, derived: "as-filed" },
  });
  const stale = mod.valuationInputs(berkshire, TODAY);

  check("a fifteen-year-old cover count yields NO share basis",
    stale.shares === null,
    `got ${JSON.stringify(stale.shares)} — 941,481 x a Class B price is wrong by about 2,400x`);
  check("...refused for being STALE, not for being absent",
    stale.refusals.includes("share-count-is-stale") &&
      !stale.refusals.includes("no-cover-share-count"),
    "the filer DID state a count; sending a reader to EDGAR for a missing one wastes their time");
  check("...and market cap says so rather than computing",
    mod.marketCap(stale, 50)?.ok === false &&
      mod.marketCap(stale, 50)?.why === "share-count-is-stale");
  check("...while the P/E beside it is UNAFFECTED — the legs stay independent",
    mod.peRatio(stale, 50)?.ok === true,
    "EPS has its own periods and its own freshness; one stale leg must not blank the other");

  // THE BOUND IS DERIVED, AND THE DERIVATION IS THE ASSERTION. A literal 455
  // here would be the second copy this whole arrangement exists to avoid.
  // READ FROM THE SOURCE, not from `mod`: grabConst strips `export`, so the
  // lifted table is in scope for the module but not on its exports. Reading the
  // number out of the declaration keeps the assertion sourced rather than
  // pinned -- a literal 455 here would be the second copy the derivation avoids.
  const fallbackAnnual = Number(/annual:\s*(\d+)/.exec(
    grabConst("lib/server/secReportDates.ts", "DEADLINE_FALLBACK")
  )?.[1]);
  check("the statutory annual deadline was read from the table, not assumed",
    Number.isFinite(fallbackAnnual),
    "if this cannot be parsed the assertion below would compare against NaN and pass nothing");
  check("the bound is one year plus the slowest statutory annual deadline",
    mod.COVER_SHARES_MAX_AGE_DAYS === 365 + fallbackAnnual,
    `${mod.COVER_SHARES_MAX_AGE_DAYS} days = 365 + ${fallbackAnnual} — moves with 17 CFR 240.13a-1`);

  // EITHER SIDE OF THE EDGE, so the bound is shown to be AT the boundary rather
  // than merely somewhere between the fixture and 2011.
  const atEdge = (days) => {
    const d = new Date(Date.parse(TODAY) - days * 86400000).toISOString().slice(0, 10);
    return mod.valuationInputs(set({
      quarters: FOUR,
      cover: { asOf: d, accession: "a", filed: d, val: 1_000_000, derived: "as-filed" },
    }), TODAY).shares !== null;
  };
  check("a count exactly at the bound is still accepted",
    atEdge(mod.COVER_SHARES_MAX_AGE_DAYS) === true);
  check("...and one day past it is not",
    atEdge(mod.COVER_SHARES_MAX_AGE_DAYS + 1) === false,
    "an off-by-one here is the difference between a bound and a decoration");

  // A FUTURE DATE IS WRONG, NOT FRESH — the same rule priceIsCurrent applies to
  // the other operand, for the same reason.
  check("a cover dated after today is refused, not treated as maximally fresh",
    mod.coverIsCurrent("2027-01-01", TODAY) === false,
    "a future date means the filing and the clock disagree");
  check("an unparseable date is refused rather than coerced",
    mod.coverIsCurrent("not-a-date", TODAY) === false && mod.coverIsCurrent(null, TODAY) === false);

  await underMutation(
    "step 3: the cover-share staleness bound removed",
    "    if (coverIsCurrent(cover.asOf, today)) {\n      shares = { val: cover.val, asOf: cover.asOf };\n    } else {\n      refusals.push(\"share-count-is-stale\");\n    }",
    "    shares = { val: cover.val, asOf: cover.asOf };",
    (m) => m.valuationInputs(berkshire, TODAY).shares === null
  );
  // Collapsing the two into one refusal still blanks the figure, so a test
  // asking only "is it refused" passes. What breaks is the WORDS: the reader is
  // told no count was filed, and goes to EDGAR looking for one that is there.
  await underMutation(
    "step 3: stale folded into no-cover-share-count",
    'refusals.push("share-count-is-stale");',
    'refusals.push("no-cover-share-count");',
    (m) => m.marketCap(m.valuationInputs(berkshire, TODAY), 50)?.why === "share-count-is-stale"
  );
  await underMutation(
    "step 3: the future-date guard removed from coverIsCurrent",
    "  if (a > t) return false;\n  return (t - a) / 86400000 <= COVER_SHARES_MAX_AGE_DAYS;",
    "  return Math.abs(t - a) / 86400000 <= COVER_SHARES_MAX_AGE_DAYS;",
    (m) => m.coverIsCurrent("2027-01-01", TODAY) === false
  );
}

// ── 8. HOW THE FOUR REFUSALS COMPOSE ──────────────────────────────────────
// Stage 4 ended with FOUR separate reasons a market cap can be withheld, landed
// across four PRs. They are deliberately NOT one "no data" branch: each names a
// different fact, and merging them would make the page say the same thing about
// four different situations and make any one of them impossible to revisit
// alone.
//
//   security-kind (#495)   this ticker is not the security the filings describe
//                          -> gated in resolveFactSetForRender, BEFORE the store
//                             read, so such a symbol never reaches this module
//   FPI / ADS (#489,#491)  the count is in ordinary shares, the price per ADS
//   staleness (#497)       the filer stopped updating its count
//   weighted-average (#7)  the tag is an average over a period, not a count
//                          -> refused in the CHAIN, so it never becomes a count
//                             at all and has no refusal of its own here
//
// WHAT THIS SECTION ASSERTS IS THE PRECEDENCE, because two can be true at once
// and the reader must get the one that is certain.
console.log("\n8. THE FOUR REFUSALS COMPOSE, AND THE ORDER BETWEEN THEM IS DELIBERATE");
{
  const staleCover = { asOf: "2011-04-29", accession: "a", filed: "2011-04-29", val: 941_481, derived: "as-filed" };

  // FPI beats staleness. An ADS filer with an ancient count has two problems,
  // and the unit mismatch is the one that holds whatever the date says -- a
  // FRESH count would still be in the wrong unit.
  const fpiAndStale = mod.valuationInputs(
    set({ symbol: "TSM", quarters: FOUR, cover: staleCover }), TODAY);
  check("an ADS filer with a stale count is refused for the UNIT, not the date",
    mod.marketCap(fpiAndStale, 50)?.why === "ads-ratio-makes-shares-incomparable",
    "refreshing the count would not fix it; the unit is wrong at any age");

  // Multi-class beats staleness for the same reason: ambiguity is not cured by
  // recency either.
  const ambiguousAndStale = mod.valuationInputs(set({
    quarters: FOUR,
    cover: { ...staleCover, val: null, derived: "ambiguous", candidates: [600_000, 400_000] },
  }), TODAY);
  check("an ambiguous count that is ALSO stale is refused for the ambiguity",
    mod.marketCap(ambiguousAndStale, 50)?.why === "multi-class-share-count-is-ambiguous");

  // Each reason keeps its own words. Four distinct sentences, not one.
  const reasons = [
    "ads-ratio-makes-shares-incomparable",
    "multi-class-share-count-is-ambiguous",
    "share-count-is-stale",
    "no-cover-share-count",
  ];
  check("the four share-count refusals say four different things",
    new Set(reasons.map((r) => mod.REFUSAL_WORDS[r])).size === reasons.length,
    "one merged 'no data' branch is what makes a defect impossible to see from the page");
  check("...and every one of them is a claim about the FILING, not about the company",
    reasons.every((r) => !/no earnings|not profitable|worthless/i.test(mod.REFUSAL_WORDS[r])));

  // THE WEIGHTED-AVERAGE TAG HAS NO REFUSAL HERE, AND THAT IS CORRECT. It is
  // excluded one layer down, in the chain, so it never becomes a cover count
  // this module could refuse. Asserted so nobody "completes the set" by adding
  // a fifth refusal that can never fire.
  check("there is no weighted-average refusal at this layer — it is refused in the chain",
    !Object.keys(mod.REFUSAL_WORDS).some((r) => /weighted/i.test(r)),
    "see check-sec-extract §9; a refusal here would be dead code pretending to be a guard");
}

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}`);
process.exit(failures ? 1 : 0);
