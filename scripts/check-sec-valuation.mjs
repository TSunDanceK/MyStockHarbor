// THE VALUATION NUMERATORS — every refusal run, and run again with the rule
// removed so the assertion is shown to be load-bearing.
//
// Each case below is one that produces a PLAUSIBLE NUMBER rather than an error
// when the rule is absent, which is why they are worth a check at all: a P/E of
// 19 built from three quarters looks exactly like a P/E of 14 built from four,
// and nothing downstream can tell them apart.
import { readCodeOnly } from "./lib/source-code.mjs";
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
const FOUR = [
  q(2026, "Q2", "2026-06-30", 1.0),
  q(2026, "Q1", "2026-03-31", 0.9),
  q(2025, "Q4", "2025-12-31", 1.2),
  q(2025, "Q3", "2025-09-30", 0.8),
];

console.log("\n1. TWELVE MONTHS MEANS TWELVE MONTHS");
{
  const good = mod.valuationInputs(set({ quarters: FOUR }));
  check("four consecutive quarters sum to a TTM",
    near(good.eps?.val, 3.9) && good.eps.basis === "four-quarters" && good.eps.periodEnd === "2026-06-30",
    `got ${good.eps?.val} on ${good.eps?.basis} to ${good.eps?.periodEnd}`);

  // THREE QUARTERS. The common case after D1b, and the one that understates by
  // a quarter while looking entirely normal.
  const three = mod.valuationInputs(set({ quarters: FOUR.slice(0, 3) }));
  check("three quarters REFUSE rather than summing to a short year",
    three.eps === null && three.refusals.includes("no-twelve-month-eps"),
    `got ${JSON.stringify(three.eps)}`);

  // A NULL Q4 among four rows — four entries, three numbers.
  const holed = [FOUR[0], FOUR[1], q(2025, "Q4", "2025-12-31", null), FOUR[3]];
  const nulled = mod.valuationInputs(set({ quarters: holed }));
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
  const gappedIn = mod.valuationInputs(set({ quarters: gapped }));
  check("four NON-consecutive quarters refuse, though all four values exist",
    gappedIn.eps === null,
    `Q1 is missing, so these four span fifteen months; all-four-or-null alone would sum them to ${1.0 + 1.2 + 0.8 + 0.7}`);
  await underMutation(
    "consecutiveness test removed (all-four-or-null only)",
    "  for (let i = 1; i < four.length; i++) {\n    if (!isConsecutive(four[i - 1], four[i])) return null;\n  }",
    "",
    (m) => m.valuationInputs(set({ quarters: gapped })).eps === null
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
    (m) => m.valuationInputs(set({ quarters: holed })).eps === null
  );
}

console.log("\n2. A FISCAL YEAR IS A BASIS; FY PLUS NINE MONTHS IS NOT");
{
  const yearOnly = mod.valuationInputs(set({
    quarters: [],
    years: [q(2025, "FY", "2025-12-31", 4.2)],
  }));
  check("an annual-only filer uses its fiscal year, which IS twelve months",
    near(yearOnly.eps?.val, 4.2) && yearOnly.eps.basis === "fiscal-year",
    `got ${yearOnly.eps?.val} on ${yearOnly.eps?.basis} — RYAAY and ABEV are this shape`);

  // THE TWO BASES ARE NEVER COMBINED. A filer with three quarters AND a fiscal
  // year must not produce FY + 9M; it falls to the whole year.
  const both = mod.valuationInputs(set({
    quarters: FOUR.slice(0, 3),
    years: [q(2025, "FY", "2025-12-31", 4.2)],
  }));
  check("three quarters beside a fiscal year give the YEAR, never the sum of both",
    near(both.eps?.val, 4.2) && both.eps.basis === "fiscal-year",
    `got ${both.eps?.val} on ${both.eps?.basis}; FY+9M would be ${4.2 + 1.0 + 0.9 + 1.2}`);
  check("and quarters are PREFERRED when they qualify, because they are newer",
    mod.valuationInputs(set({ quarters: FOUR, years: [q(2025, "FY", "2025-12-31", 4.2)] }))
      .eps?.basis === "four-quarters");
}

console.log("\n3. A MULTI-CLASS SHARE COUNT CANNOT BE PICKED");
{
  const ambiguous = mod.valuationInputs(set({
    quarters: FOUR,
    cover: { asOf: "2026-07-15", accession: "a", filed: "2026-07-15", val: null, derived: "ambiguous", candidates: [600_000, 400_000] },
  }));
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
    })).shares === null
  );
}

console.log("\n4. THE FIGURES, AND WHAT THEY REFUSE");
{
  const ok = mod.valuationInputs(set({ quarters: FOUR }));
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
  }));
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
  const tsm = mod.valuationInputs(set({ symbol: "TSM", quarters: FOUR }));
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
    mod.marketCap(mod.valuationInputs(set({ quarters: FOUR })), 50)?.ok === true,
    "the default fixture symbol is T — a 20-F rule must not reach a 10-K filer");

  // THE ADS REASON WINS OVER THE CLASS REASON. Both are true for a
  // multi-class FPI; only one of them is certain.
  const both = mod.valuationInputs(set({
    symbol: "BABA", quarters: FOUR,
    cover: { asOf: "2026-07-15", accession: "a", filed: "2026-07-15", val: null, derived: "ambiguous", candidates: [6, 4] },
  }));
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
    mod.peRatio(mod.valuationInputs(set({ quarters: FOUR })), 50)?.ok === true);
  // The EPS itself is still read and still rendered beneath the refusal: it is
  // a real filed fact, and it is the reason the ratio is absent.
  check("the EPS basis is still populated — the figure is real, the DIVISION is not",
    near(tsm.eps?.val, 3.9));

  await underMutation(
    "stage 4: FPI market-cap suppression removed",
    '  if (inputs.refusals.includes("ads-ratio-makes-shares-incomparable")) {\n    return { ok: false, why: "ads-ratio-makes-shares-incomparable" };\n  }',
    "",
    (m) => m.marketCap(m.valuationInputs(set({ symbol: "TSM", quarters: FOUR })), 50)?.ok === false
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
    (m) => m.marketCap(m.valuationInputs(set({ symbol: "TSM", quarters: FOUR })), 50)?.ok === false
  );
  await underMutation(
    "stage 4: FPI P/E suppression removed",
    '  if (inputs.refusals.includes("ads-ratio-makes-eps-incomparable")) {\n    return { ok: false, why: "ads-ratio-makes-eps-incomparable" };\n  }',
    "",
    (m) => m.peRatio(m.valuationInputs(set({ symbol: "TSM", quarters: FOUR })), 50)?.ok === false
  );
  // The plausible-but-wrong placement again, and it fails the same way: these
  // filers HAVE a clean twelve months of EPS, so a guard gated on its absence
  // never fires.
  await underMutation(
    "stage 4: FPI P/E suppression gated on a missing EPS (ordering)",
    '  if (inputs.refusals.includes("ads-ratio-makes-eps-incomparable")) {',
    '  if (!inputs.eps && inputs.refusals.includes("ads-ratio-makes-eps-incomparable")) {',
    (m) => m.peRatio(m.valuationInputs(set({ symbol: "TSM", quarters: FOUR })), 50)?.ok === false
  );
  // Collapsing the two refusals would still suppress both figures, so a test
  // that only checked "is it refused" would pass. What breaks is the WORDS: the
  // P/E would blame the share count, which is not why it is absent.
  await underMutation(
    "stage 4: the two ADS refusals collapsed into one",
    '    refusals.push("ads-ratio-makes-shares-incomparable");\n    refusals.push("ads-ratio-makes-eps-incomparable");',
    '    refusals.push("ads-ratio-makes-shares-incomparable");',
    (m) => m.peRatio(m.valuationInputs(set({ symbol: "TSM", quarters: FOUR })), 50)?.why
      === "ads-ratio-makes-eps-incomparable"
  );
  await underMutation(
    "stage 4: FPI symbol matching stops normalising case",
    "return ADS_FILERS_WITHOUT_A_STATED_RATIO.has(String(symbol).trim().toUpperCase());",
    "return ADS_FILERS_WITHOUT_A_STATED_RATIO.has(String(symbol));",
    (m) => m.sharesAreIncomparableToPrice("tsm") === true
  );
}

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}`);
process.exit(failures ? 1 : 0);
