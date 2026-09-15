// The stored field list and the extraction, checked for the properties that
// cannot be seen in a number.
//
// WHAT THIS CHECK CAN AND CANNOT DO, stated up front because the distinction is
// the whole design of it.
//
//   CAN: assert STRUCTURAL properties -- that every balance-sheet field is
//   instant, that the differencing walks a list an instant field is not on, that
//   the positional hash moves when order or membership moves and stays put when
//   a tag chain is corrected. Those are properties of the shipped definitions
//   and of the shipped source, read from where they live.
//
//   CANNOT: assert that a number is right. That needs real companyfacts diffed
//   against the frozen FMP ground truth, which is a relay job
//   (scripts/sec-extract-probe.mjs), not a check.
//
// AND IT MUST NOT INVENT ONE. check-sec-daily-index.mjs's header states the rule
// -- "a check that can produce its own expected value is not a check" -- and §17
// is the worked example: a synthetic fixture produced {periodic-report: 77,
// unconfirmed: 50} from a modulo-5 round robin and was reported as a replay of a
// real week for days. So there is NO synthetic companyfacts document here. The
// arithmetic below runs on rows whose VALUES are arbitrary precisely because
// nothing asserts what they should be -- only that a duration was differenced
// and an instant was not, which is a property of the code and not of the data.
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// secFields.ts imports nothing, so it lifts whole. secExtract.ts imports only
// from it, so the two concatenate once that one import line is dropped.
const fieldsSrc = fs.readFileSync("lib/server/secFields.ts", "utf8");
const extractSrcRaw = fs.readFileSync("lib/server/secExtract.ts", "utf8");
const extractSrc = extractSrcRaw.replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secFields";/, "");
const mod = await lift(`${fieldsSrc}\n${extractSrc}`);

const {
  SEC_FIELDS, SEC_FIELD_KEYS, SEC_FIELD_INDEX, secFieldsHash, COVER_SHARES_FIELD,
  cumulativeFields, instantFields, asFiledOnlyFields, fieldPartition,
  extractCompanyFacts, readCoverShares, quartersCovered,
  checkIdentities, identityRates,
} = mod;

// ── 1. the list itself ──────────────────────────────────────────────────────
console.log("\n1. the field list");

check("45 fields", SEC_FIELDS.length === 45, `${SEC_FIELDS.length}`);
check("keys are unique", new Set(SEC_FIELD_KEYS).size === SEC_FIELD_KEYS.length);
check("SEC_FIELD_INDEX agrees with the array order",
  SEC_FIELD_KEYS.every((k, i) => SEC_FIELD_INDEX[k] === i));

const byStatement = (s) => SEC_FIELDS.filter((f) => f.statement === s);
check("16 income, 11 cash-flow, 18 balance-sheet",
  byStatement("income").length === 16 && byStatement("cash-flow").length === 11 &&
    byStatement("balance-sheet").length === 18,
  `${byStatement("income").length}/${byStatement("cash-flow").length}/${byStatement("balance-sheet").length}`);

check("every chain is non-empty", SEC_FIELDS.every((f) => f.chain.length > 0));
check("no chain repeats a tag",
  SEC_FIELDS.every((f) => new Set(f.chain).size === f.chain.length));
check("every unit is one of the three companyfacts keys",
  SEC_FIELDS.every((f) => ["USD", "shares", "USD/shares"].includes(f.unit)));
// THE COVER PAGE IS NOT IN THE PERIOD LIST ANY MORE. While it was, its cover
// date entered the instant series as a period of its own carrying one field,
// and an 8-slice returned four balance sheets for AAPL, MU and PLAB.
check("NO field in the period list is dei — the cover page left it",
  SEC_FIELDS.every((f) => f.taxonomy === "us-gaap"),
  SEC_FIELDS.filter((f) => f.taxonomy !== "us-gaap").map((f) => f.key).join(", ") || "45/45 us-gaap");
check("COVER_SHARES_FIELD exists, is dei, and is NOT in SEC_FIELDS",
  COVER_SHARES_FIELD.taxonomy === "dei" &&
    COVER_SHARES_FIELD.key === "sharesOutstandingCover" &&
    !SEC_FIELD_KEYS.includes("sharesOutstandingCover"));

// ASC 606. `Revenues` is legacy -- AAPL's last is 2018-09-29 -- so it must sit
// BELOW RevenueFromContractWithCustomer..., never above, or every large filer
// renders 2018 revenue as current (BRIEF §"trap 2").
const revenue = SEC_FIELDS.find((f) => f.key === "revenue");
check("`Revenues` ranks below the ASC 606 tag in the revenue chain",
  revenue.chain.indexOf("RevenueFromContractWithCustomerExcludingAssessedTax") <
    revenue.chain.indexOf("Revenues"),
  revenue.chain.join(" > "));

// ── 2. THE PROPERTY THE OWNER ASKED FOR ─────────────────────────────────────
console.log("\n2. the four kinds, and what may be differenced");

check("ALL 18 balance-sheet fields are instant",
  byStatement("balance-sheet").every((f) => f.kind === "instant"),
  byStatement("balance-sheet").filter((f) => f.kind !== "instant").map((f) => f.key).join(", ") || "18/18");

// THE DEFECT THAT GOT PAST THE FIRST VERSION OF THIS CHECK. These four sit on
// the income statement and ARE durations, so a cumulative/instant split put them
// on the differencing path -- and it printed -668,000 shares for PLAB.
const NON_ADDITIVE = ["sharesBasic", "sharesDiluted", "epsBasic", "epsDiluted"];
check("the two share counts are duration-average",
  ["sharesBasic", "sharesDiluted"].every((k) => SEC_FIELDS.find((f) => f.key === k).kind === "duration-average"));
check("the two EPS figures are duration-ratio",
  ["epsBasic", "epsDiluted"].every((k) => SEC_FIELDS.find((f) => f.key === k).kind === "duration-ratio"));
check("and NONE of the four is on the cumulative list",
  cumulativeFields().every((f) => !NON_ADDITIVE.includes(f.key)),
  cumulativeFields().filter((f) => NON_ADDITIVE.includes(f.key)).map((f) => f.key).join(", ") || "clear");
check("both EPS fields name a ratioSource whose operands are real field keys",
  ["epsBasic", "epsDiluted"].every((k) => {
    const r = SEC_FIELDS.find((f) => f.key === k).ratioSource;
    return r && SEC_FIELD_KEYS.includes(r.numerator) && SEC_FIELD_KEYS.includes(r.denominator);
  }));

const part = fieldPartition();
check("the three sets partition the list exactly once",
  part.cumulative.length + part.asFiledOnly.length + part.instant.length === SEC_FIELDS.length &&
    new Set([...part.cumulative, ...part.asFiledOnly, ...part.instant].map((f) => f.key)).size === SEC_FIELDS.length,
  `${part.cumulative.length} + ${part.asFiledOnly.length} + ${part.instant.length} = ${SEC_FIELDS.length}`);
check("cumulativeFields() contains no balance-sheet field",
  part.cumulative.every((f) => f.statement !== "balance-sheet"));
check("the FX leg is present and cumulative",
  SEC_FIELDS.find((f) => f.key === "fxEffectOnCash")?.kind === "duration-cumulative",
  "without it the cash reconciliation reports FX movement as failure");

// THE STRUCTURAL HALF, read from the shipped source rather than inferred.
//
// The property is "the differencing CANNOT reach a non-additive field". A value
// assertion shows only that it did not this time. So the source is read: every
// site that emits `derived: "differenced"` must sit inside the loop over
// cumulativeFields(), and the other two loops must come after it.
const extractCode = readCodeOnly("lib/server/secExtract.ts");
const diffSites = [...extractCode.matchAll(/derived:\s*"differenced"/g)].map((m) => m.index);
const cumLoopAt = extractCode.indexOf("for (const field of cumulativeFields())");
const asFiledAt = extractCode.indexOf("for (const field of asFiledOnlyFields())");
const instLoopAt = extractCode.indexOf("for (const field of instantFields())");
check("the extractor emits `differenced` in exactly one place", diffSites.length === 1,
  `${diffSites.length} site(s)`);
check("that site is inside the cumulativeFields() loop, before both other loops",
  cumLoopAt !== -1 && asFiledAt !== -1 && instLoopAt !== -1 &&
    diffSites.every((i) => i > cumLoopAt && i < asFiledAt) && asFiledAt < instLoopAt,
  `differenced@${diffSites[0]} cumulative@${cumLoopAt} asFiledOnly@${asFiledAt} instant@${instLoopAt}`);
check("no subtraction of two field values appears after the cumulative loop ends",
  !/\.val!?\s*-\s*\w+\.(?:best\.)?row\.val/.test(extractCode.slice(asFiledAt)),
  "the as-filed and instant branches read values, they do not combine them");

// ── 3. the positional fail-safe ─────────────────────────────────────────────
console.log("\n3. secFieldsHash");

const base = secFieldsHash();
check("stable across calls", secFieldsHash() === base, base);
const swapped = [...SEC_FIELD_KEYS];
[swapped[0], swapped[1]] = [swapped[1], swapped[0]];
check("a REORDER moves the hash", secFieldsHash(swapped) !== base);
check("a REMOVAL moves the hash", secFieldsHash(SEC_FIELD_KEYS.slice(1)) !== base);
check("an ADDITION moves the hash", secFieldsHash([...SEC_FIELD_KEYS, "newField"]) !== base);
// The point of hashing keys rather than the whole definition: a corrected tag
// chain must NOT invalidate stored values, or every chain fix costs a full
// universe re-fetch at ~150 KB wire each (there is no conditional check on
// companyfacts -- sec-reread-no-cheap-check, 23 of 23).
check("a CHAIN correction does NOT move the hash",
  secFieldsHash(SEC_FIELDS.map((f) => f.key)) === base,
  "chains are not hashed, deliberately — see the docblock");

// ── 4. singleValued ─────────────────────────────────────────────────────────
console.log("\n4. singleValued");

check("NO field in the period list is multi-valued any more",
  SEC_FIELDS.every((f) => f.singleValued === true),
  SEC_FIELDS.filter((f) => !f.singleValued).map((f) => f.key).join(", ") || "45/45 single-valued");
check("the cover field is the one that is not",
  COVER_SHARES_FIELD.singleValued === false,
  "several classes, one period key, and no axis in companyfacts to tell them apart");

// ── 5. quartersCovered ──────────────────────────────────────────────────────
console.log("\n5. period length bands");

check("3M, 6M, 9M, 12M map to 1..4",
  [quartersCovered(90), quartersCovered(181), quartersCovered(273), quartersCovered(365)].join() === "1,2,3,4");
// A 4-4-5 retail calendar makes a quarter 84-98 days and a 53-week year 371.
check("a 4-4-5 quarter (98d) and a 53-week year (371d) are still recognised",
  quartersCovered(98) === 1 && quartersCovered(371) === 4);
check("the gaps between bands return null, they do not round",
  [quartersCovered(130), quartersCovered(230), quartersCovered(320)].every((v) => v === null));

// ── 6. the arithmetic, on rows whose values nothing predicts ────────────────
console.log("\n6. differencing behaviour");

// READ THE HEADER BEFORE ADDING TO THIS. These rows carry ARBITRARY values and
// NOTHING below asserts what a number should be. What is asserted is the SHAPE
// of what came out: that a 6M row against a 3M row produced a `differenced`
// cell, that an instant row produced an `as-filed` one, and that the instant
// value equals the row it was read from. Those hold for any values at all,
// which is exactly why they are safe to assert here and a number is not.
const facts = {
  cik: 1, entityName: "Check Co",
  facts: {
    "us-gaap": {
      NetCashProvidedByUsedInOperatingActivities: { units: { USD: [
        { start: "2026-01-01", end: "2026-03-31", val: 111, accn: "a", filed: "2026-04-20", fy: 2026, fp: "Q1" },
        { start: "2026-01-01", end: "2026-06-30", val: 777, accn: "b", filed: "2026-07-20", fy: 2026, fp: "Q2" },
      ] } },
      Assets: { units: { USD: [
        { end: "2026-03-31", val: 5000, accn: "a", filed: "2026-04-20", fy: 2026, fp: "Q1" },
        { end: "2026-06-30", val: 6000, accn: "b", filed: "2026-07-20", fy: 2026, fp: "Q2" },
      ] } },
      // A SECOND BALANCE-SHEET LINE, so "no instant row is a one-field row"
      // tests the code rather than the thinness of this fixture.
      Liabilities: { units: { USD: [
        { end: "2026-03-31", val: 2000, accn: "a", filed: "2026-04-20", fy: 2026, fp: "Q1" },
        { end: "2026-06-30", val: 2400, accn: "b", filed: "2026-07-20", fy: 2026, fp: "Q2" },
      ] } },
    },
  },
};
const out = extractCompanyFacts("CHK", facts);
const at = (rec, key) => rec.values[SEC_FIELD_INDEX[key]];
const q2 = out.quarters.find((q) => q.end === "2026-06-30");
const q1 = out.quarters.find((q) => q.end === "2026-03-31");

check("the 3M frame came out as-filed", at(q1, "operatingCashFlow")?.derived === "as-filed");
check("the 6M frame came out DIFFERENCED, not as-filed",
  at(q2, "operatingCashFlow")?.derived === "differenced",
  at(q2, "operatingCashFlow")?.derived);
check("the differenced cell names the two frames it came from",
  at(q2, "operatingCashFlow")?.from?.join("..") === "2026-03-31..2026-06-30");
check("the differenced quarter's start is the PRIOR frame's end, not the year's",
  q2.start === "2026-03-31", q2.start);

// THE ASSERTION THE OWNER NAMED. Assets is instant; it must appear untouched on
// the instant record and must not appear on a quarter at all.
const i2 = out.instants.find((p) => p.end === "2026-06-30");
check("an instant field is never differenced",
  i2 && at(i2, "totalAssets")?.derived === "as-filed" && at(i2, "totalAssets")?.val === 6000,
  `${at(i2, "totalAssets")?.derived} ${at(i2, "totalAssets")?.val}`);
check("and it does not appear on any quarter record",
  out.quarters.every((q) => at(q, "totalAssets") === null));
check("EVERY instant field on EVERY emitted period is as-filed or ambiguous — never differenced",
  [...out.instants, ...out.quarters, ...out.years].every((p) =>
    instantFields().every((f) => {
      const v = at(p, f.key);
      return v === null || v.derived !== "differenced";
    })));

// A restatement: the same period filed twice, newest accession wins. Again no
// number is predicted -- what is asserted is WHICH ROW was chosen, by its own
// accession, which the input states.
const restated = JSON.parse(JSON.stringify(facts));
restated.facts["us-gaap"].Assets.units.USD.push(
  { end: "2026-06-30", val: 6500, accn: "c", filed: "2027-02-01", fy: 2026, fp: "FY" });
const out2 = extractCompanyFacts("CHK", restated);
const i2b = out2.instants.find((p) => p.end === "2026-06-30");
check("a restatement wins on `filed`, and the record carries its accession",
  at(i2b, "totalAssets")?.val === 6500 && i2b.accession === "c",
  `${at(i2b, "totalAssets")?.val} accn=${i2b.accession}`);

// The multi-class cover page. Two values, one date, one filing, no class label
// in companyfacts -- picking one IS the BRK.B bug, so it refuses.
const multiClass = JSON.parse(JSON.stringify(facts));
multiClass.facts.dei = { EntityCommonStockSharesOutstanding: { units: { shares: [
  { end: "2026-07-18", val: 300, accn: "b", filed: "2026-07-20" },
  { end: "2026-07-18", val: 700, accn: "b", filed: "2026-07-20" },
] } } };
const out3 = extractCompanyFacts("CHK", multiClass);
check("two share classes in one filing are reported AMBIGUOUS, not reduced to one",
  out3.coverShares?.derived === "ambiguous" && out3.coverShares?.val === null,
  JSON.stringify(out3.coverShares));
check("and it keeps both candidates", out3.coverShares?.candidates?.join() === "700,300");

// THE DEFECT D2 EXISTED TO FIX. The cover date is 2026-07-18 and no balance
// sheet was filed at it; while this field lived in the instant grid that date
// became a period row carrying one field and displaced a real one.
check("the cover date does NOT create a period row",
  out3.instants.every((p) => p.end !== "2026-07-18"),
  out3.instants.map((p) => p.end).join(", "));
// THE OWNER'S ASSERTION, SCOPED TO WHERE IT MEANS SOMETHING HERE. "No period row
// carries only one field" is a statement about REAL filings and is asserted as
// such in scripts/sec-extract-probe.mjs, over all five symbols. Against a
// fixture it would only measure how many fields the fixture supplies -- the
// quarter rows below carry one field because this fixture has one duration
// field, which says nothing about the code. What the fixture CAN show is the
// specific pollution D2 was: an instant row created by a cover date, carrying
// the cover field and nothing else.
check("no instant row is a one-field row",
  out3.instants.every((p) => p.values.filter((v) => v !== null).length > 1),
  out3.instants.map((p) => `${p.end}:${p.values.filter((v) => v !== null).length}`).join(" "));
// Not a loop over the rows: it cannot BE in a row, because it has no position in
// the positional array. That is the structural form of the same claim, and the
// loop version was testing nothing (its body ignored the row).
check("and no row anywhere CAN carry a cover-page reading",
  SEC_FIELD_INDEX.sharesOutstandingCover === undefined,
  "the field has no index in the positional array, so no row has a slot for it");

const oneClass = JSON.parse(JSON.stringify(facts));
oneClass.facts.dei = { EntityCommonStockSharesOutstanding: { units: { shares: [
  { end: "2026-07-18", val: 700, accn: "b", filed: "2026-07-20" },
] } } };
const single = extractCompanyFacts("CHK", oneClass).coverShares;
check("a single-class filer resolves normally, with its own asOf",
  single?.derived === "as-filed" && single?.val === 700 && single?.asOf === "2026-07-18",
  JSON.stringify(single));
check("a filer with no cover page at all gets null, not a guess",
  extractCompanyFacts("CHK", facts).coverShares === null);

// ── 6b. D1 and D1b: the non-additive durations ──────────────────────────────
console.log("\n6b. the non-additive durations");

// Q1 and Q2 3-month frames filed, plus 6M cumulative netIncome. Values are
// arbitrary; what is asserted is WHICH cells exist and how they were derived.
const nonAdd = { cik: 1, facts: { "us-gaap": {
  NetIncomeLoss: { units: { USD: [
    { start: "2026-01-01", end: "2026-03-31", val: 100, accn: "a", filed: "2026-04-20" },
    { start: "2026-01-01", end: "2026-06-30", val: 300, accn: "b", filed: "2026-07-20" },
  ] } },
  WeightedAverageNumberOfSharesOutstandingBasic: { units: { shares: [
    { start: "2026-01-01", end: "2026-03-31", val: 50, accn: "a", filed: "2026-04-20" },
    { start: "2026-01-01", end: "2026-06-30", val: 52, accn: "b", filed: "2026-07-20" },
  ] } },
  EarningsPerShareBasic: { units: { "USD/shares": [
    { start: "2026-01-01", end: "2026-03-31", val: 2, accn: "a", filed: "2026-04-20" },
    { start: "2026-01-01", end: "2026-06-30", val: 5.77, accn: "b", filed: "2026-07-20" },
  ] } },
} } };
const na = extractCompanyFacts("NA", nonAdd);
const naQ1 = na.quarters.find((q) => q.end === "2026-03-31");
const naQ2 = na.quarters.find((q) => q.end === "2026-06-30");

check("netIncome IS differenced (the control — the cumulative path still works)",
  at(naQ2, "netIncome")?.derived === "differenced" && at(naQ2, "netIncome")?.val === 200);
// THE BUG: 52 - 50 = 2 was being stored as Q2's share count.
check("sharesBasic is NOT differenced — the 6M average produces no Q2 cell",
  at(naQ2, "sharesBasic") === null,
  JSON.stringify(at(naQ2, "sharesBasic")));
check("and the filed 3-month average IS kept",
  at(naQ1, "sharesBasic")?.derived === "as-filed" && at(naQ1, "sharesBasic")?.val === 50);
// 5.77 - 2 = 3.77 was being stored; the truth for Q2 is 200/52 = 3.846...
check("epsBasic is NOT differenced",
  at(naQ2, "epsBasic")?.derived !== "differenced",
  at(naQ2, "epsBasic")?.derived);
check("and with no filed frame and no denominator it stays NULL rather than guessing",
  at(naQ2, "epsBasic") === null,
  "the 6M denominator is not this quarter's, so there is nothing to divide by");

// The computed path: give Q2 its own filed 3-month share count and EPS follows.
const withQ2Shares = JSON.parse(JSON.stringify(nonAdd));
withQ2Shares.facts["us-gaap"].WeightedAverageNumberOfSharesOutstandingBasic.units.shares.push(
  { start: "2026-04-01", end: "2026-06-30", val: 54, accn: "b", filed: "2026-07-20" });
const na2 = extractCompanyFacts("NA", withQ2Shares);
const na2Q2 = na2.quarters.find((q) => q.end === "2026-06-30");
check("a filed 3-month average for Q2 is picked up",
  at(na2Q2, "sharesBasic")?.val === 54 && at(na2Q2, "sharesBasic")?.derived === "as-filed");
check("and EPS is then COMPUTED as netIncome / shares for that same quarter",
  at(na2Q2, "epsBasic")?.derived === "computed" &&
    Math.abs(at(na2Q2, "epsBasic").val - 200 / 54) < 1e-9,
  JSON.stringify(at(na2Q2, "epsBasic")));
check("the computed cell names both operands",
  at(na2Q2, "epsBasic")?.computedFrom?.join() === "netIncome,sharesBasic");
check("a FILED per-period EPS still wins over the computed one",
  at(naQ1, "epsBasic")?.derived === "as-filed" && at(naQ1, "epsBasic")?.val === 2);

// ── 7. the tag-change guard ─────────────────────────────────────────────────
console.log("\n7. the ASC 606 boundary");

// Differencing two frames that resolved to DIFFERENT tags subtracts one concept
// from another. It must refuse and say so, not produce a number.
const boundary = { cik: 1, facts: { "us-gaap": {
  RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [
    { start: "2018-01-01", end: "2018-06-30", val: 900, accn: "b", filed: "2018-07-20" },
  ] } },
  Revenues: { units: { USD: [
    { start: "2018-01-01", end: "2018-03-31", val: 400, accn: "a", filed: "2018-04-20" },
  ] } },
} } };
const out4 = extractCompanyFacts("BND", boundary);
const bq = out4.quarters.find((q) => q.end === "2018-06-30");
check("a mid-year tag change is NOT differenced",
  !bq || at(bq, "revenue") === null || at(bq, "revenue").derived !== "differenced");
check("and the refusal is recorded as a note rather than swallowed",
  out4.notes.some((n) => n.includes("tag changed mid-year")), out4.notes[0] ?? "(none)");

// ── 8. the free arithmetic assertion ────────────────────────────────────────
console.log("\n8. internal identities");

// Values are arbitrary and NOTHING here asserts what a number should be. What is
// asserted is that an identity that HOLDS reports pass, one that does not reports
// fail, and one whose operands are absent reports SKIPPED rather than a vacuous
// pass. That third state is the whole point: an identity over two nulls is true
// and would score a filer with no balance sheet as perfectly consistent.
const idFacts = (over) => ({ cik: 1, facts: { "us-gaap": Object.fromEntries(
  Object.entries({
    NetCashProvidedByUsedInOperatingActivities: 100,
    NetCashProvidedByUsedInInvestingActivities: -40,
    NetCashProvidedByUsedInFinancingActivities: -30,
    EffectOfExchangeRateOnCashAndCashEquivalents: 5,
    CashAndCashEquivalentsPeriodIncreaseDecrease: 35,
    ...over,
  }).map(([k, v]) => [k, { units: { USD: [
    { start: "2026-01-01", end: "2026-03-31", val: v, accn: "a", filed: "2026-04-20" },
  ] } }])
) } });

const rates = (r) => identityRates(r);
const CASH_ID = "operating + investing + financing + fx = netChangeInCash";

const okCash = checkIdentities(extractCompanyFacts("OK", idFacts({})));
check("a reconciling quarter passes", rates(okCash)[CASH_ID]?.pass === 1,
  JSON.stringify(rates(okCash)[CASH_ID]));
// THE FX LEG. Without it 100 - 40 - 30 = 30 against a stated 35 is a 14% "break",
// and that is most of what the ARM/MU/PLAB runs reported as failures.
check("the FX leg is what makes it reconcile — it is read, not ignored",
  rates(checkIdentities(extractCompanyFacts("FX", idFacts({
    EffectOfExchangeRateOnCashAndCashEquivalents: 0,
  }))))[CASH_ID]?.fail === 1,
  "with fx zeroed and netChange still 35, the same rows must now FAIL");
check("a genuine break is still caught",
  rates(checkIdentities(extractCompanyFacts("NO", idFacts({
    CashAndCashEquivalentsPeriodIncreaseDecrease: 999,
  }))))[CASH_ID]?.fail === 1);

// A MISSING OPERAND IS SKIPPED, NEVER PASS.
const noFin = idFacts({});
delete noFin.facts["us-gaap"].NetCashProvidedByUsedInFinancingActivities;
const skipped = checkIdentities(extractCompanyFacts("SK", noFin));
check("a missing operand reports SKIPPED, not a vacuous pass",
  rates(skipped)[CASH_ID]?.skipped === 1 && rates(skipped)[CASH_ID]?.pass === 0,
  JSON.stringify(rates(skipped)[CASH_ID]));
check("and the skipped result names which field was null",
  skipped.find((r) => r.identity === CASH_ID)?.missing?.join() === "financingCashFlow");

// assets = liabilities + equity, on instants.
const bs = (a, l, e) => ({ cik: 1, facts: { "us-gaap": Object.fromEntries(
  [["Assets", a], ["Liabilities", l], ["StockholdersEquity", e]].map(([k, v]) => [k, { units: { USD: [
    { end: "2026-03-31", val: v, accn: "a", filed: "2026-04-20" },
  ] } }])
) } });
const BS_ID = "assets = liabilities + equity";
check("the balance sheet identity passes when it balances",
  rates(checkIdentities(extractCompanyFacts("B", bs(1000, 600, 400))))[BS_ID]?.pass === 1);
check("and fails when it does not",
  rates(checkIdentities(extractCompanyFacts("B", bs(1000, 600, 900))))[BS_ID]?.fail === 1);

// THE PLAB CASE. A filer with a noncontrolling interest balances only against
// TOTAL equity; against the parent-only figure PLAB failed 8 of 8 quarters by
// ~23%. The two are separate fields because they mean different things -- the
// page's "shareholders' equity" is the parent-only one.
const withNci = bs(1000, 600, 300);
withNci.facts["us-gaap"].StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest =
  { units: { USD: [{ end: "2026-03-31", val: 400, accn: "a", filed: "2026-04-20" }] } };
const nci = extractCompanyFacts("NCI", withNci);
check("a filer with an NCI balances against totalEquity, not parent-only equity",
  rates(checkIdentities(nci))[BS_ID]?.pass === 1,
  JSON.stringify(rates(checkIdentities(nci))[BS_ID]));
check("and the parent-only figure is still stored, unchanged, under its own key",
  nci.instants[0].values[SEC_FIELD_INDEX.stockholdersEquity]?.val === 300 &&
    nci.instants[0].values[SEC_FIELD_INDEX.totalEquity]?.val === 400,
  "merging them would have fixed the identity by changing what the page calls equity");
check("with no NCI tag at all it falls back to parent-only rather than skipping",
  rates(checkIdentities(extractCompanyFacts("B", bs(1000, 600, 400))))[BS_ID]?.pass === 1);
// ...but absent BOTH, it must skip, never pass.
const noEquity = bs(1000, 600, 400);
delete noEquity.facts["us-gaap"].StockholdersEquity;
check("absent both equity tags it SKIPS, it does not pass on two nulls",
  rates(checkIdentities(extractCompanyFacts("B", noEquity)))[BS_ID]?.skipped === 1,
  JSON.stringify(rates(checkIdentities(extractCompanyFacts("B", noEquity)))[BS_ID]));

// cashEnd - cashStart = netChangeInCash, which spans two instants AND a quarter.
const spanning = idFacts({});
spanning.facts["us-gaap"].CashAndCashEquivalentsAtCarryingValue = { units: { USD: [
  { end: "2025-12-31", val: 500, accn: "z", filed: "2026-01-20" },
  { end: "2026-03-31", val: 535, accn: "a", filed: "2026-04-20" },
] } };
const CASH_SPAN = "cashEnd - cashStart = netChangeInCash";
const span = checkIdentities(extractCompanyFacts("SP", spanning));
check("the two-period cash identity passes when the balances move by the stated amount",
  rates(span)[CASH_SPAN]?.pass === 1, JSON.stringify(rates(span)[CASH_SPAN]));
// The quarter's start is 2026-01-01 but the prior balance sheet is dated
// 2025-12-31, one day earlier. Matching on the exact date is DELIBERATE: a
// fuzzy match would silently pair a quarter with the wrong balance sheet.
check("a quarter with no cash balance at either date reports SKIPPED",
  rates(checkIdentities(extractCompanyFacts("SP2", idFacts({}))))[CASH_SPAN]?.skipped === 1);
// The one-day predecessor is EXACT, not a window. A balance sheet two days
// early belongs to a different period and must not be pressed into service.
const twoDaysEarly = JSON.parse(JSON.stringify(spanning));
twoDaysEarly.facts["us-gaap"].CashAndCashEquivalentsAtCarryingValue.units.USD[0].end = "2025-12-30";
// THE MU/ASTS CASE. netChangeInCash filed on the restricted-inclusive concept
// must be compared against the restricted-inclusive BALANCE. Mixing them showed
// as a plausible few percent, and once as 27.5%.
const restricted = idFacts({});
delete restricted.facts["us-gaap"].CashAndCashEquivalentsPeriodIncreaseDecrease;
restricted.facts["us-gaap"].CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect =
  { units: { USD: [{ start: "2026-01-01", end: "2026-03-31", val: 35, accn: "a", filed: "2026-04-20" }] } };
// Two balances at each date: the plain one drifts, the restricted-inclusive one
// moves by exactly the stated change.
restricted.facts["us-gaap"].CashAndCashEquivalentsAtCarryingValue = { units: { USD: [
  { end: "2025-12-31", val: 500, accn: "z", filed: "2026-01-20" },
  { end: "2026-03-31", val: 900, accn: "a", filed: "2026-04-20" },
] } };
restricted.facts["us-gaap"].CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents = { units: { USD: [
  { end: "2025-12-31", val: 600, accn: "z", filed: "2026-01-20" },
  { end: "2026-03-31", val: 635, accn: "a", filed: "2026-04-20" },
] } };
const restr = checkIdentities(extractCompanyFacts("R", restricted));
check("a restricted-inclusive change is compared against the restricted-inclusive balance",
  rates(restr)[CASH_SPAN]?.pass === 1,
  `plain cash moved 400 and would FAIL; restricted moved 35 and passes — ${JSON.stringify(rates(restr)[CASH_SPAN])}`);

check("a balance sheet TWO days before the start is not accepted as the opener",
  rates(checkIdentities(extractCompanyFacts("SP3", twoDaysEarly)))[CASH_SPAN]?.skipped === 1,
  "a wider window would pair a cash flow with the wrong opening balance and report pass");

check("identityRates counts every state and invents none",
  Object.values(rates(span)).every((r) =>
    r.pass + r.fail + r.skipped > 0 && Object.keys(r).join() === "pass,fail,skipped"));

console.log(failures ? `\n${failures} assertion(s) failed.\n` : "\nExtraction structure is sound.\n");
process.exit(failures ? 1 : 0);
