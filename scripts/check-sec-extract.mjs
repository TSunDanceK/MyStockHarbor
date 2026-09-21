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
// secExtract now also imports secCurrency (the reporting-currency decision has
// to happen before the first field is read), and secCurrency imports fxRates.
// All three concatenate once their import lines are dropped — secCurrency's
// only other import is type-only and erases.
const fxSrc = fs.readFileSync("lib/server/fxRates.ts", "utf8");
const currencySrc = fs
  .readFileSync("lib/server/secCurrency.ts", "utf8")
  .replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const extractSrcRaw = fs.readFileSync("lib/server/secExtract.ts", "utf8");
const extractSrc = extractSrcRaw
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secFields";/, "")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secCurrency";/, "");
const PRELUDE = `${fieldsSrc}\n${fxSrc}\n${currencySrc}`;
const mod = await lift(`${PRELUDE}\n${extractSrc}`);

// THE SAME TWO FILES, RE-LIFTED WITH ONE LINE OF THE SHIPPED SOURCE BROKEN.
// Used by §7's mutations: an assertion that survives the removal of the rule it
// claims to be testing is not testing it.
const liftMutated = async (mutate) => {
  const broken = mutate(extractSrc);
  if (broken === extractSrc) throw new Error("mutation did not apply — the anchor text moved");
  return lift(`${PRELUDE}\n${broken}`);
};

const {
  SEC_FIELDS, SEC_FIELD_KEYS, SEC_FIELD_INDEX, secFieldsHash, COVER_SHARES_FIELD,
  cumulativeFields, instantFields, asFiledOnlyFields, fieldPartition,
  extractCompanyFacts, readCoverShares, quartersCovered, spanDays, sameFrame,
  checkIdentities, identityRates,
} = mod;

// ── 1. the list itself ──────────────────────────────────────────────────────
console.log("\n1. the field list");

check("46 fields", SEC_FIELDS.length === 46, `${SEC_FIELDS.length}`);
check("keys are unique", new Set(SEC_FIELD_KEYS).size === SEC_FIELD_KEYS.length);
check("SEC_FIELD_INDEX agrees with the array order",
  SEC_FIELD_KEYS.every((k, i) => SEC_FIELD_INDEX[k] === i));

const byStatement = (s) => SEC_FIELDS.filter((f) => f.statement === s);
check("17 income, 11 cash-flow, 18 balance-sheet",
  byStatement("income").length === 17 && byStatement("cash-flow").length === 11 &&
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
  SEC_FIELDS.filter((f) => f.taxonomy !== "us-gaap").map((f) => f.key).join(", ") || "46/46 us-gaap");
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
  SEC_FIELDS.filter((f) => !f.singleValued).map((f) => f.key).join(", ") || "46/46 single-valued");
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
console.log("\n6c. fiscal period labels");

// THE DEFECT THIS SECTION EXISTS FOR, found by rendering the page's own output
// rather than by a check. companyfacts' `fy`/`fp` describe the FILING, not the
// period: reading them put "Q1 FY2027" on ARM's June 2025 quarter and gave AAPL
// TWO ROWS LABELLED "Q3 FY2026" -- 2026-06-27 and 2025-06-28 -- in one
// eight-row table.
//
// REAL FISCAL CALENDARS, from the five probe symbols' own filings. Not invented
// dates: the year-ends are 26 Sep, 31 Mar, 28 Aug, 2 Aug and 31 Dec, and three
// of the five are 52/53-week filers whose year-end moves a few days annually.
const CALENDARS = [
  ["AAPL", "2026-09-26",
    ["2026-06-27", "2026-03-28", "2025-12-27", "2025-09-27", "2025-06-28", "2025-03-29", "2024-12-28", "2024-09-28"],
    "Q3 FY2026|Q2 FY2026|Q1 FY2026|Q4 FY2025|Q3 FY2025|Q2 FY2025|Q1 FY2025|Q4 FY2024"],
  ["ARM", "2026-03-31",
    ["2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30", "2025-06-30", "2025-03-31"],
    "Q1 FY2027|Q4 FY2026|Q3 FY2026|Q2 FY2026|Q1 FY2026|Q4 FY2025"],
  ["MU", "2026-08-28",
    ["2026-05-28", "2026-02-26", "2025-11-27", "2025-08-28", "2024-08-29"],
    "Q3 FY2026|Q2 FY2026|Q1 FY2026|Q4 FY2025|Q4 FY2024"],
  ["ASTS", "2025-12-31",
    ["2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30"],
    "Q2 FY2026|Q1 FY2026|Q4 FY2025|Q3 FY2025"],
];
for (const [sym, anchor, ends, want] of CALENDARS) {
  const got = ends.map((e) => { const f = mod.fiscalLabel(e, anchor); return `${f.fp} FY${f.fy}`; }).join("|");
  check(`${sym}: every quarter labelled by its own fiscal calendar`, got === want, got);
}

// THE PROPERTY THAT FAILED IN THE RENDER: no two rows in one table share a
// label. Asserted directly, because "the labels look right" is how the last
// version passed review.
for (const [sym, anchor, ends] of CALENDARS) {
  const labels = ends.map((e) => { const f = mod.fiscalLabel(e, anchor); return `${f.fp} FY${f.fy}`; });
  check(`${sym}: no two quarters carry the same label`,
    new Set(labels).size === labels.length, labels.join(" "));
}

// A 52/53-week filer's year-end moves a few days a year. An exact match would
// push every year-end quarter into the NEXT fiscal year and label Q4 as Q1.
check("a year-end four days off the anchor still reads Q4",
  (() => { const f = mod.fiscalLabel("2025-09-27", "2026-09-26"); return f.fp === "Q4" && f.fy === 2025; })(),
  JSON.stringify(mod.fiscalLabel("2025-09-27", "2026-09-26")));
check("...and one a full quarter off does NOT",
  mod.fiscalLabel("2025-06-28", "2026-09-26").fp === "Q3",
  "the tolerance is wider than calendar drift and far narrower than a quarter");
check("with no annual frame to anchor on, it labels nothing rather than guessing",
  mod.fiscalLabel("2026-06-30", null).fp === null);

// ── 6d. WHICH YEAR THE FILER CALLS IT — READ, NEVER GUESSED ───────────────
//
// THE DEFECT, from the #472 preview: AAP's snapshot read "Q2 FY2027 (period
// ending 2026-07-18)". AAP calls that quarter Q2 FY2026. AAP and WMT both end a
// fiscal year within days of the new calendar year and name it differently, and
// NO RULE ABOUT DATES can separate them — the name is the filer's.
//
// Nothing about the wrong one fails. The date beside it is right and the
// quarter number is right; only a reader who knows the company sees it.
console.log("\n6d. the fiscal YEAR NAME, calibrated per filer");

// ── MEASURED FROM THE MIDPOINT, NOT THE END ───────────────────────────────
// AAP's year-end is the Saturday nearest 31 December: 2 January one year, 27
// December the next. An offset measured against the END year would flip
// between 0 and -1 for the same company with no change in how it names
// anything, and a calibration that oscillates renames the page every few years.
const mid = (iso) => mod.fiscalMidYear(Date.parse(`${iso}T00:00:00Z`));
check("a year-end either side of New Year reads the SAME midpoint year",
  mid("2027-01-02") === 2026 && mid("2026-12-27") === 2026,
  `${mid("2027-01-02")} / ${mid("2026-12-27")} — AAP's year-end lands on both sides`);
check("a September year-end's midpoint year is its own year",
  mid("2026-09-26") === 2026);

// A companyfacts payload carrying only what the calibration reads: each fact
// row's `fy`/`fp` are the FILING's DocumentFiscalYearFocus.
const fyFacts = (rows) => ({
  facts: { "us-gaap": { Revenues: { units: { USD: rows } } } },
});
// AAP-SHAPED: fiscal 2026 ran Dec 2025 - Jan 2027 and the 10-K says fy 2026 —
// the year it mostly occupies. Offset 0.
const AAP = fyFacts([
  { accn: "k26", form: "10-K", fp: "FY", fy: 2026, start: "2025-12-28", end: "2027-01-02", val: 1 },
  // THE COMPARATIVE, stamped with the SAME fy — which is why the pairing can
  // only be read from the LATEST period in the filing.
  { accn: "k26", form: "10-K", fp: "FY", fy: 2026, start: "2024-12-29", end: "2025-12-27", val: 1 },
  // An earlier 10-K whose year ended on the OTHER side of New Year — 28
  // December, not 2 January — and which the filer still names for the year it
  // occupies. The end-year reading would put these two a year apart.
  { accn: "k24", form: "10-K", fp: "FY", fy: 2024, start: "2023-12-31", end: "2024-12-28", val: 1 },
]);
// WMT-SHAPED: fiscal 2027 runs Feb 2026 - Jan 2027 and is named for the year it
// ENDS in. Offset +1.
const WMT = fyFacts([
  { accn: "w27", form: "10-K", fp: "FY", fy: 2027, start: "2026-02-01", end: "2027-01-31", val: 1 },
  { accn: "w26", form: "10-K", fp: "FY", fy: 2026, start: "2025-02-01", end: "2026-01-31", val: 1 },
]);

const aapNaming = mod.fiscalYearOffset(AAP, "2027-01-02");
const wmtNaming = mod.fiscalYearOffset(WMT, "2027-01-31");
check("AAP-shaped: named for the year it mostly occupies",
  aapNaming.offset === 0 && aapNaming.basis === "annual", JSON.stringify(aapNaming));
check("...and BOTH of its 10-Ks agree, though their year-ends straddle New Year",
  aapNaming.agreeing === 2 && aapNaming.disagreeing === 0,
  `${aapNaming.agreeing} agreeing / ${aapNaming.disagreeing} — an end-year offset would have split them`);
check("WMT-shaped: named for the year it ENDS in",
  wmtNaming.offset === 1 && wmtNaming.basis === "annual", JSON.stringify(wmtNaming));

// THE LABELS THEMSELVES, which is what a reader sees.
const lab = (end, anchor, naming) => { const f = mod.fiscalLabel(end, anchor, naming); return `${f.fp} FY${f.fy}`; };
check("AAP's July quarter reads Q2 FY2026, as AAP calls it",
  lab("2026-07-18", "2027-01-02", aapNaming) === "Q2 FY2026", lab("2026-07-18", "2027-01-02", aapNaming));
check("...and uncalibrated it reads FY2027, which is the shipped defect",
  lab("2026-07-18", "2027-01-02", null) === "Q2 FY2027", lab("2026-07-18", "2027-01-02", null));
check("WMT's July quarter reads Q2 FY2027, as WMT calls it",
  lab("2026-07-31", "2027-01-31", wmtNaming) === "Q2 FY2027", lab("2026-07-31", "2027-01-31", wmtNaming));

// ── THE MUTATIONS: each convention forced, and the other filer must break ──
// A calibration that happens to agree with one convention is indistinguishable
// from that convention hard-coded, so both hard-codings are tried.
const FILTER_LINE = "  const recent = readings.slice(0, 4).filter((r) => r.offset === 0 || r.offset === 1);";
{
  const occupied = await liftMutated((src) =>
    src.replace(FILTER_LINE, "  const recent = readings.slice(0, 4).map((r) => ({ ...r, offset: 0 }));"));
  check("MUTATION forcing 'year it occupies': AAP still right (it is that convention)",
    occupied.fiscalYearOffset(AAP, "2027-01-02").offset === 0);
  check("MUTATION forcing 'year it occupies': WMT goes wrong",
    occupied.fiscalYearOffset(WMT, "2027-01-31").offset !== 1,
    `${occupied.fiscalYearOffset(WMT, "2027-01-31").offset} — a convention applied to a filer that does not use it`);

  const endYear = await liftMutated((src) =>
    src.replace(FILTER_LINE, "  const recent = readings.slice(0, 4).map((r) => ({ ...r, offset: 1 }));"));
  check("MUTATION forcing end-year naming: WMT still right (it is that convention)",
    endYear.fiscalYearOffset(WMT, "2027-01-31").offset === 1);
  check("MUTATION forcing end-year naming: AAP goes wrong",
    endYear.fiscalYearOffset(AAP, "2027-01-02").offset !== 0,
    `${endYear.fiscalYearOffset(AAP, "2027-01-02").offset} — this is the defect restored`);
}

// ── READING THE COMPARATIVES WOULD BREAK IT ───────────────────────────────
{
  const oldest = await liftMutated((src) =>
    src.replace("          if (!cur || r.end > cur.end) {", "          if (!cur || r.end < cur.end) {"));
  const got = oldest.fiscalYearOffset(AAP, "2027-01-02");
  check("MUTATION taking the OLDEST period of a filing: AAP is misnamed",
    got.offset !== 0 || got.basis === null,
    `${JSON.stringify(got)} — a 10-K stamps its fy on every comparative it restates`);
}

// ── AN UNREADABLE FILER NAMES NOTHING NEW ─────────────────────────────────
// A FOREIGN PRIVATE ISSUER FILES NO 10-K AT ALL. Eleven of them — BABA, SONY,
// RYAAY, MUFG among them — read as "naming unreadable" when the filter named
// only the domestic form, so the annual report is matched by what it IS rather
// than by one of its names.
{
  const SONY = fyFacts([
    { accn: "f26", form: "20-F", fp: "FY", fy: 2026, start: "2025-04-01", end: "2026-03-31", val: 1 },
    { accn: "f25", form: "20-F", fp: "FY", fy: 2025, start: "2024-04-01", end: "2025-03-31", val: 1 },
  ]);
  const n = mod.fiscalYearOffset(SONY, "2026-03-31");
  check("a 20-F states the fiscal year just as a 10-K does",
    n.basis === "annual" && n.offset === 1 && n.agreeing === 2, JSON.stringify(n));
  const CNI = fyFacts([
    { accn: "c26", form: "40-F", fp: "FY", fy: 2026, start: "2026-01-01", end: "2026-12-31", val: 1 },
  ]);
  check("...and so does a 40-F", mod.fiscalYearOffset(CNI, "2026-12-31").basis === "annual");
}

check("no readable annual report or 10-Q leaves the naming unread, and the label falls back",
  (() => { const n = mod.fiscalYearOffset(fyFacts([]), "2026-12-31"); return n.basis === null && n.agreeing === 0; })(),
  JSON.stringify(mod.fiscalYearOffset(fyFacts([]), "2026-12-31")));
check("...and an unread naming leaves every existing label exactly as it was",
  CALENDARS.every(([, anchor, ends, want]) =>
    ends.map((e) => lab(e, anchor, mod.fiscalYearOffset(fyFacts([]), anchor))).join("|") === want),
  "a filer whose naming cannot be read must not be relabelled by the attempt");
check("a nonsense offset is refused rather than renaming every period",
  (() => {
    const junk = fyFacts([{ accn: "x", form: "10-K", fp: "FY", fy: 1999, start: "2025-12-28", end: "2027-01-02", val: 1 }]);
    const n = mod.fiscalYearOffset(junk, "2027-01-02");
    return n.basis === null;
  })(),
  "only 0 and +1 are conventions; anything else is a malformed filing");

// ── THE ANCHOR ITSELF, WHICH THE CENSUS CAUGHT BEING WRONG ───────────────
//
// `yearEndAnchor` is "the newest twelve-month frame's end", and a trailing-
// twelve-month comparative in a 10-Q is twelve months long without being a
// fiscal year. The census found AMZN anchored on 30 June and BG on 31 March —
// both December filers — so every quarter either one showed was labelled off
// the wrong year-end, and had been since before any of this.
{
  const AMZN = fyFacts([
    { accn: "a25", form: "10-K", fp: "FY", fy: 2025, start: "2025-01-01", end: "2025-12-31", val: 1 },
    { accn: "a24", form: "10-K", fp: "FY", fy: 2024, start: "2024-01-01", end: "2024-12-31", val: 1 },
    // THE IMPOSTOR: a twelve-month span ending mid-year, filed in a 10-Q.
    { accn: "q26", form: "10-Q", fp: "Q2", fy: 2026, start: "2025-07-01", end: "2026-06-30", val: 1 },
  ]);
  const n = mod.fiscalYearOffset(AMZN, "2026-06-30");
  check("the annual filing's own period end is offered as the anchor",
    n.yearEnd === "2025-12-31", `${n.yearEnd} — the 10-K's period end, not the TTM frame's`);
  check("...and a 10-Q never supplies one, or every label moves by a quarter",
    mod.fiscalYearOffset(fyFacts([
      { accn: "q1", form: "10-Q", fp: "Q2", fy: 2026, start: "2026-04-01", end: "2026-06-30", val: 1 },
      { accn: "q2", form: "10-Q", fp: "Q1", fy: 2026, start: "2026-01-01", end: "2026-03-31", val: 1 },
      { accn: "q3", form: "10-Q", fp: "Q3", fy: 2025, start: "2025-07-01", end: "2025-09-30", val: 1 },
    ]), "2025-12-31").yearEnd === null);
  // THE LABEL, BOTH WAYS. Against the frame-derived anchor the newest quarter
  // reads a year early; against the filing's own year end it reads right.
  check("the wrong anchor mislabels AMZN's June quarter",
    lab("2026-06-30", "2026-06-30", n) === "Q4 FY2025",
    `${lab("2026-06-30", "2026-06-30", n)} — anchored on a TTM frame`);
  check("...and the 10-K's year end labels it correctly",
    lab("2026-06-30", n.yearEnd, n) === "Q2 FY2026",
    `${lab("2026-06-30", n.yearEnd, n)}`);
  check("the extraction prefers the filing's year end over the frame's",
    /const labelAnchor = naming\.yearEnd \?\? yearEndAnchor;/.test(extractSrc) &&
      /fiscalLabel\(end, labelAnchor, naming\)/.test(extractSrc));
}

// ── 6e. A TWELVE-MONTH COMPARATIVE IS NOT A FISCAL YEAR ───────────────────
//
// THE DEFECT, measured on AMZN's own companyfacts:
//   us-gaap:CashCashEquivalents...IncludingExchangeRateEffect
//     2025-07-01..2026-06-30  (364d, 10-Q Q2)
// Six such trailing years reached AMZN's `years` list. On the five-year card
// they rendered AS FISCAL YEARS; on the reaction card they took every quarter's
// label. Length cannot tell them apart — 364 days either way. The END can.
console.log("\n6e. a trailing twelve months is not a fiscal year");
{
  // AN AMZN-SHAPED PAYLOAD: a December filer with a real 10-K year, real
  // quarters, and the 10-Q's twelve-month comparative ending at a QUARTER end.
  const amznFacts = {
    cik: 2, entityName: "Trailing Co",
    facts: {
      "us-gaap": {
        NetIncomeLoss: { units: { USD: [
          // The fiscal year, from the 10-K.
          { start: "2025-01-01", end: "2025-12-31", val: 400, accn: "k25", form: "10-K", filed: "2026-02-05", fy: 2025, fp: "FY" },
          { start: "2024-01-01", end: "2024-12-31", val: 300, accn: "k24", form: "10-K", filed: "2025-02-06", fy: 2024, fp: "FY" },
          // Real quarters.
          { start: "2026-01-01", end: "2026-03-31", val: 90, accn: "q1", form: "10-Q", filed: "2026-05-01", fy: 2026, fp: "Q1" },
          { start: "2026-01-01", end: "2026-06-30", val: 190, accn: "q2", form: "10-Q", filed: "2026-07-31", fy: 2026, fp: "Q2" },
          // THE IMPOSTOR: twelve months ending mid-year, filed in the Q2 10-Q.
          { start: "2025-07-01", end: "2026-06-30", val: 410, accn: "q2", form: "10-Q", filed: "2026-07-31", fy: 2026, fp: "Q2" },
        ] } },
        Assets: { units: { USD: [
          { end: "2026-06-30", val: 9000, accn: "q2", form: "10-Q", filed: "2026-07-31", fy: 2026, fp: "Q2" },
        ] } },
      },
    },
  };
  const amznOut = extractCompanyFacts("AMZN", amznFacts);
  const yearEnds = amznOut.years.map((y) => y.end);
  check("the fiscal year is kept",
    yearEnds.includes("2025-12-31") && yearEnds.includes("2024-12-31"), yearEnds.join(" · "));
  check("the trailing year ending at a QUARTER end is not in `years`",
    !yearEnds.includes("2026-06-30"),
    `${yearEnds.join(" · ")} — a 364-day span ending 30 June is not a fiscal year`);
  check("...and the quarter at that end survives, untouched",
    amznOut.quarters.some((q) => q.end === "2026-06-30"),
    "dropping the trailing year must not drop the quarter that shares its end");

  // THE ANCHOR THE FILTER USES IS THE ANNUAL FILING'S, not the newest frame —
  // using the frame would ask the list to validate itself, and on AMZN the
  // newest frame WAS one of the trailing years.
  check("the filter measures against the 10-K's own period end",
    /onFiscalYearEnd\(e, naming\.yearEnd\)/.test(extractSrc),
    "yearEndAnchor is derived FROM yearCells, so it cannot referee them");

  // ── THE MUTATION: admit any twelve-month frame, which is what shipped ────
  {
    const anyTwelve = await liftMutated((src) =>
      src.replace("    new Map([...yearCells].filter(([e]) => onFiscalYearEnd(e, naming.yearEnd))),",
        "    yearCells,"));
    const broken = anyTwelve.extractCompanyFacts("AMZN", amznFacts);
    check("the admit-anything mutation actually applied",
      broken.years.length !== amznOut.years.length,
      `${broken.years.map((y) => y.end).join(" · ")}`);
    check("MUTATION: the trailing year returns to `years` — the five-year card's rows",
      broken.years.some((y) => y.end === "2026-06-30"),
      `${broken.years.map((y) => y.end).join(" · ")} — this is what AMZN rendered`);
    // AND IT IS THE NEWEST, which is the snapshot anchor: the same row that
    // would decide basis and tableBasis for the whole page.
    check("...and it lands FIRST, where the snapshot anchor reads",
      broken.years[0]?.end === "2026-06-30",
      "the anchor, tableBasis and the 548-day gate all read set.years[0]");
  }

  // THE SLACK IS FOR WEEKDAY DRIFT, NOT FOR A DIFFERENT PERIOD.
  check("a year end eight days off the anchor is still a fiscal year",
    mod.onFiscalYearEnd("2026-01-08", "2026-01-02"));
  check("...and one a quarter off is not",
    !mod.onFiscalYearEnd("2026-03-31", "2026-01-02"));
  check("a December/January filer matches ACROSS the new year",
    mod.onFiscalYearEnd("2025-12-27", "2027-01-02") && mod.onFiscalYearEnd("2024-12-28", "2027-01-02"),
    "AAP's year end lands on both sides of it");
  check("with no annual filing to anchor on, nothing is dropped",
    mod.onFiscalYearEnd("2026-06-30", null),
    "that is exactly the behaviour that shipped, and it stays where nothing better is known");
}

// ── THE RELABEL MUST NOT SPLIT A YEAR-OVER-YEAR PAIR ──────────────────────
//
// YoY matches BY LABEL — same fp, fy-1 — so a shift applied to some periods and
// not others would compare a quarter against one two years away while the page
// said "compared with Q2 FY2025". The offset is one reading per filer, applied
// at a single call site, and that is the property asserted: one site, and the
// gap between any two labels is unchanged by it.
check("the naming is applied at exactly ONE call site",
  (extractSrc.match(/fiscalLabel\(end, labelAnchor/g) ?? []).length === 1,
  "two sites is two places for a filer to be half-relabelled");
{
  const ends = ["2026-07-18", "2026-04-18", "2026-01-17", "2025-10-05", "2025-07-19"];
  const pair = (naming) => ends.map((e) => {
    const f = mod.fiscalLabel(e, "2027-01-02", naming);
    return `${f.fp}:${f.fy}`;
  });
  const naive = pair(null), calibrated = pair(aapNaming);
  check("every period shifts by the SAME year, so fp is untouched",
    naive.every((l, i) => l.split(":")[0] === calibrated[i].split(":")[0]));
  check("...and every fy shifts by exactly one, so fy-1 still pairs the same rows",
    naive.every((l, i) => Number(l.split(":")[1]) - Number(calibrated[i].split(":")[1]) === 1),
    `${naive.join(" ")} vs ${calibrated.join(" ")}`);
  check("...and no two periods collide after the relabel",
    new Set(calibrated).size === new Set(naive).size);
}

// AND THE SOURCE SIDE: pack() must not read the row's own fy/fp again.
check("pack() does not read fy or fp off the companyfacts row",
  !/fp: row\?\.fp|fy: .*row\?\.fy/.test(extractCode),
  "those describe the filing, not the period it covers");

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
  out4.notes.some((n) => n.includes("concept changed mid-year")), out4.notes[0] ?? "(none)");

// ── THE SAME-CONCEPT RULE, ON A FIELD THAT STILL USES THE DEFAULT POLICY ──
//
// THIS BLOCK USED TO BE AIMED AT CAPEX AND CANNOT BE ANY MORE. capex is now
// marked `oneConceptPerFiler`: one concept is fixed for the whole column and
// every other is refused before resolution, so two concepts never reach the
// differencing and the guard below is UNREACHABLE on it. Left pointed at capex,
// every assertion here would have gone on passing while testing nothing — the
// guard removed entirely would not have changed one of them.
//
// operatingCashFlow is the field it moves to: duration-cumulative, a two-entry
// chain, and NOT marked, so it is exactly the shape capex used to be.
//
// NOTHING BELOW ASSERTS A CASH-FLOW NUMBER. The values are arbitrary and chosen
// far apart precisely so that any figure appearing where null is required is
// visibly a subtraction of one concept from the other rather than a plausible
// quarter. 900 - 400 = 500 is the number the guard must NOT produce.
const OCF_A = "NetCashProvidedByUsedInOperatingActivities";
const OCF_B = "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations";
const ocfIdx = SEC_FIELDS.findIndex((f) => f.key === "operatingCashFlow");
check("the field the same-concept rule is tested on does NOT use the sticky policy",
  SEC_FIELDS[ocfIdx].oneConceptPerFiler !== true &&
    SEC_FIELDS[ocfIdx].chain.length >= 2,
  `operatingCashFlow: ${SEC_FIELDS[ocfIdx].chain.length} chain entries, sticky=${!!SEC_FIELDS[ocfIdx].oneConceptPerFiler} ` +
    `— a sticky field would refuse the second concept before the guard could see it`);

const twoConcept = {
  cik: 1,
  facts: { "us-gaap": {
    // The 6M frame under one concept...
    [OCF_A]: { units: { USD: [
      { start: "2026-01-01", end: "2026-06-30", val: 900, accn: "b", filed: "2026-07-20" },
    ] } },
    // ...and the 3M it would have to be differenced against under the other.
    [OCF_B]: { units: { USD: [
      { start: "2026-01-01", end: "2026-03-31", val: 400, accn: "a", filed: "2026-04-20" },
    ] } },
  } },
};
const tc = extractCompanyFacts("TWOC", twoConcept);
const tcQ2 = tc.quarters.find((q) => q.end === "2026-06-30");
check("both YTD operands must be the SAME concept, or the quarter is null",
  !tcQ2 || tcQ2.values[ocfIdx] === null,
  `Q2 operatingCashFlow = ${JSON.stringify(tcQ2?.values[ocfIdx] ?? null)} — 900 under one ` +
    `concept minus 400 under another is arithmetic on unrelated numbers, whatever it evaluates to`);
check("...and the Q1 that IS single-concept still resolves, so the refusal is the quarter, not the field",
  tc.quarters.find((q) => q.end === "2026-03-31")?.values[ocfIdx]?.val === 400,
  "a rule that emptied the whole field would pass the assertion above for the wrong reason");
check("...and the refusal names both concepts in a note",
  tc.notes.some((n) => n.startsWith("operatingCashFlow ") && n.includes(OCF_A) && n.includes(OCF_B)),
  tc.notes.find((n) => n.startsWith("operatingCashFlow ")) ?? "(none)");

{
  // MUTATION: the same-concept test removed, so the differencing takes whatever
  // frame sits one length below regardless of which concept filed it.
  const mixMod = await liftMutated((src) =>
    src.replace("if (conceptKey(prior.best) !== conceptKey(f.best)) {", "if (false) {")
  );
  const mixed = mixMod.extractCompanyFacts("TWOC", twoConcept);
  const mixedQ2 = mixed.quarters.find((q) => q.end === "2026-06-30");
  check("MUTATION: allowing mixed operands makes a number appear where null is required",
    mixedQ2?.values[ocfIdx]?.val === 500 &&
      mixedQ2?.values[ocfIdx]?.derived === "differenced",
    `the mutation renders ${JSON.stringify(mixedQ2?.values[ocfIdx]?.val ?? null)} — ` +
      `an operating-cash-flow quarter assembled from two different concepts, and nothing ` +
      `about the rendered cell would say so`);
  check("...and the note disappears with it, so the refusal cannot be recorded but unperformed",
    !mixed.notes.some((n) => n.startsWith("operatingCashFlow ")),
    "the note and the refusal are the same branch");
}

// ── A CONCEPT IS ns|tag, AND THE NAMESPACE DEFEATED THIS GUARD ────────────
//
// The test above changes the TAG. This one keeps the tag identical and changes
// only the NAMESPACE, which is the case a bare `prior.best.tag !== f.best.tag`
// cannot see — and that is exactly what it was, until this fixture.
//
// EIGHT MAPPED LINES ARE SPELLED THE SAME under `us-gaap` and `ifrs-full`, so
// this is not a contrived shape: a dual-tagging foreign private issuer whose 6M
// frame resolves to `ifrs-full|GrossProfit` and whose 3M frame resolves to
// `us-gaap|GrossProfit` was differenced, writing 900 − 400 = 500 into one cell
// stamped `ns: "ifrs-full"` while one operand came from us-gaap — with NO note,
// because nothing had noticed a change to record.
//
// THE DUAL LIST IS DERIVED, NOT TYPED. It is computed from the shipped chains,
// so a field that gains an identically-spelled ifrs entry later is covered by
// this check without anyone remembering to add it.
{
  const dualFields = SEC_FIELDS.filter(
    (f) => (f.ifrsChain ?? []).some((t) => (f.chain ?? []).includes(t))
  );
  check("the shared-spelling case is real, and derived from the shipped chains",
    dualFields.length > 0,
    `${dualFields.length} field(s) spell a concept identically under both taxonomies: ` +
      dualFields.map((f) => f.key).join(", "));

  // A DURATION field, because instants are never differenced and an assertion
  // on one could not fail however badly the namespaces were mixed.
  const dualDur = dualFields.find((f) => String(f.kind).startsWith("duration"));
  const sharedTag = (dualDur.ifrsChain ?? []).find((t) => (dualDur.chain ?? []).includes(t));
  const dualIdx = SEC_FIELDS.findIndex((f) => f.key === dualDur.key);
  const crossNs = {
    cik: 1,
    facts: {
      // The 3M frame under the filer's primary taxonomy...
      [dualDur.taxonomy]: { [sharedTag]: { units: { USD: [
        { start: "2026-01-01", end: "2026-03-31", val: 400, accn: "a", filed: "2026-04-20" },
      ] } } },
      // ...and the 6M under ifrs-full. Same spelling, different concept.
      "ifrs-full": { [sharedTag]: { units: { USD: [
        { start: "2026-01-01", end: "2026-06-30", val: 900, accn: "b", filed: "2026-07-20" },
      ] } } },
    },
  };
  const xn = extractCompanyFacts("DUALNS", crossNs);
  const xnQ2 = xn.quarters.find((q) => q.end === "2026-06-30");
  check(`a namespace change alone blocks differencing, on ${dualDur.key}`,
    !xnQ2 || xnQ2.values[dualIdx] === null,
    `Q2 ${dualDur.key} = ${JSON.stringify(xnQ2?.values[dualIdx] ?? null)} — the tag is ` +
      `"${sharedTag}" on both sides and the concepts are still different`);
  check("...and the refusal names both NAMESPACES, not just the tag twice",
    xn.notes.some((n) =>
      n.startsWith(`${dualDur.key} `) &&
      n.includes(`${dualDur.taxonomy}|${sharedTag}`) &&
      n.includes(`ifrs-full|${sharedTag}`)),
    xn.notes.find((n) => n.startsWith(`${dualDur.key} `)) ??
      "(none) — a note reading 'GrossProfit -> GrossProfit' would be worse than none");

  // MUTATION: the guard put back the way it was — comparing bare tag names.
  // This is the defect as it shipped, not an invented one.
  const bareMod = await liftMutated((src) =>
    src.replace(
      "if (conceptKey(prior.best) !== conceptKey(f.best)) {",
      "if (prior.best.tag !== f.best.tag) {"
    )
  );
  const bare = bareMod.extractCompanyFacts("DUALNS", crossNs);
  const bareQ2 = bare.quarters.find((q) => q.end === "2026-06-30");
  check("MUTATION: comparing bare tag names differences straight across the namespaces",
    bareQ2?.values[dualIdx]?.val === 500 &&
      bareQ2?.values[dualIdx]?.derived === "differenced",
    `the mutation renders ${JSON.stringify(bareQ2?.values[dualIdx]?.val ?? null)} from ` +
      `900 (ifrs-full) − 400 (${dualDur.taxonomy}), stamped ns="${bareQ2?.values[dualIdx]?.ns}" ` +
      `— one cell, two taxonomies`);
  check("...and it records no note, so the mix is silent as well as wrong",
    !bare.notes.some((n) => n.startsWith(`${dualDur.key} `)),
    "nothing compared unequal, so nothing was there to report");
  // THE MUTATION MUST NOT SIMPLY BREAK EVERYTHING: the tag-change case it was
  // written for still has to refuse under it, or this would pass by disabling
  // the guard rather than by narrowing it.
  // A REFUSAL IS EITHER A NULL CELL OR NO QUARTER AT ALL, and which one depends
  // on whether any other field carried that period. Asserting only `=== null`
  // read `undefined` as a failure and reported the guard broken when it had
  // refused correctly — the same shape the capex assertion above already uses.
  {
    const bareTwoC = bareMod.extractCompanyFacts("TWOC", twoConcept);
    const bareTwoQ2 = bareTwoC.quarters.find((q) => q.end === "2026-06-30");
    check("...while the TAG-change case still refuses under the same mutation",
      (!bareTwoQ2 || bareTwoQ2.values[ocfIdx] === null) &&
        bareTwoC.notes.some((n) => n.startsWith("operatingCashFlow ")),
      "the bare-tag guard is narrower, not absent — which is why it read as working");
  }
}

// ── AND ACROSS PERIODS: THE CONCEPT THE FILER USES NOW ────────────────────
//
// ON operatingCashFlow FOR THE SAME REASON AS THE BLOCK ABOVE: capex no longer
// uses this policy at all, so a fixture built on it would assert the default
// preference against a field that has been exempted from it.
//
// The rule above says which pairs may be subtracted. This says which of two
// PRESENT readings a period takes: the concept covering the filer's newest
// period wins, and the other is used only where the preferred one is absent.
//
// THE FIXTURE PUBLISHES BOTH CONCEPTS ON THE NEWER YEAR and only the primary on
// the older one — the migration shape — so rank-first and preferred-tag give
// DIFFERENT answers on the newer year and the same answer on the older. A
// fixture where they agree everywhere would pass under either rule.
const migrated = {
  cik: 1,
  facts: { "us-gaap": {
    [OCF_A]: { units: { USD: [
      { start: "2024-01-01", end: "2024-12-31", val: 100, accn: "a", filed: "2025-02-01" },
      { start: "2025-01-01", end: "2025-12-31", val: 110, accn: "b", filed: "2026-02-01" },
    ] } },
    [OCF_B]: { units: { USD: [
      { start: "2025-01-01", end: "2025-12-31", val: 220, accn: "b", filed: "2026-02-01" },
      { start: "2026-01-01", end: "2026-12-31", val: 230, accn: "c", filed: "2027-02-01" },
    ] } },
  } },
};
const mig = extractCompanyFacts("MIGR", migrated);
const yearAt = (e) => mig.years.find((y) => y.end === e)?.values[ocfIdx];
check("the preferred concept is the one covering the filer's NEWEST period",
  yearAt("2026-12-31")?.tag === OCF_B,
  `${yearAt("2026-12-31")?.tag} — the only concept on that period, so this is the premise, not the claim`);
check("...so a period publishing BOTH takes the preferred one, not the chain's first",
  yearAt("2025-12-31")?.tag === OCF_B && yearAt("2025-12-31")?.val === 220,
  `FY2025 resolved to ${yearAt("2025-12-31")?.tag} = ${yearAt("2025-12-31")?.val}; ` +
    `rank-first would have taken ${OCF_A} = 110 and made one column mean two things`);
check("...and a period where the preferred concept is ABSENT still resolves, from the other",
  yearAt("2024-12-31")?.tag === OCF_A && yearAt("2024-12-31")?.val === 100,
  "preferring a concept must never delete a value — it only chooses between present readings");

{
  // MUTATION: the preference dropped, so resolution is rank-first per period
  // again and the column splits across concepts down its own length.
  const rankMod = await liftMutated((src) =>
    src.replace(
      "    preferred && conceptKey(c) === preferred ? -1 : c.rank;",
      "    c.rank;"
    )
  );
  const r = rankMod.extractCompanyFacts("MIGR", migrated);
  const rYear = (e) => r.years.find((y) => y.end === e)?.values[ocfIdx];
  check("MUTATION: without the preference, one filer's operatingCashFlow column resolves from two concepts",
    rYear("2025-12-31")?.tag === OCF_A && rYear("2026-12-31")?.tag === OCF_B,
    `FY2025 ${rYear("2025-12-31")?.tag} = ${rYear("2025-12-31")?.val} but FY2026 ` +
      `${rYear("2026-12-31")?.tag} = ${rYear("2026-12-31")?.val} — adjacent rows of one ` +
      `column, two different measures, no marking`);
  check("...and the us-gaap-over-ifrs precedence is NOT what the preference is doing",
    rankMod.extractCompanyFacts("BOTHM", {
      cik: 1,
      facts: {
        "us-gaap": { Assets: { units: { USD: [{ end: "2026-06-30", val: 111, accn: "a", filed: "2026-07-01" }] } } },
        "ifrs-full": { Assets: { units: { USD: [{ end: "2026-06-30", val: 222, accn: "b", filed: "2026-08-01" }] } } },
      },
    }).instants[0]?.values[SEC_FIELDS.findIndex((f) => f.key === "totalAssets")]?.val === 111,
    "rank still decides across namespaces with the preference gone, so §11's fixture " +
      "is testing chain rank and this is testing the preference — two rules, two checks");
}

// AND THE RE-READ KEY HAS TO MOVE WHEN THE RESOLUTION DOES. A stored set
// written under rank-first holds figures the shipped code would not write; if
// secChainsHash ignores the policy, needsReread reports every set current and
// the store serves them forever.
check("the resolution policy is fed into secChainsHash",
  /feed\(`policy\|\$\{CHAIN_RESOLUTION_POLICY\}`\)/.test(fieldsSrc) &&
    mod.secChainsHash() !== (await lift(
      fieldsSrc.replace("feed(`policy|${CHAIN_RESOLUTION_POLICY}`);", "")
    )).secChainsHash(),
  "the hash a set is compared against differs with the policy line present and absent");

// ── capex: ONE CONCEPT PER FILER, ANCHORED ON THE NEWEST PERIOD ──────────
//
// The two blocks above test the DEFAULT policy on a field that uses it. capex
// is marked, and the mark changes exactly one thing:
//
//   · SELECTION IS THE SAME — the concept filed for the filer's newest period
//     that carries a figure, with the earlier chain entry winning a period that
//     files both. That is preferredTag, unchanged, so there is no second
//     selector and no second rule about ties;
//   · every OTHER concept is then refused for the rest of the column, so a
//     period the chosen one does not cover reads "Not reported" instead of
//     switching measure mid-column.
//
// WHY IT WAS RULED THIS WAY, measured: across 119 SYMBOLS, three file both
// concepts for a period that is still stored and disagree by 78.9% (CRM),
// 37.6% (GE) and 14.8% (SCHW) — so a per-period fallback puts two measures in
// one column under one heading.
console.log("\n7b. capex resolves from one concept per filer");

const CAPEX_A = "PaymentsToAcquirePropertyPlantAndEquipment";
const CAPEX_B = "PaymentsToAcquireProductiveAssets";
const capexIdx = SEC_FIELDS.findIndex((f) => f.key === "capex");
const capexDef = SEC_FIELDS[capexIdx];
check("capex is the field marked for it, and the mark is read from the shipped list",
  capexDef.oneConceptPerFiler === true &&
    capexDef.chain[0] === CAPEX_A && capexDef.chain[1] === CAPEX_B,
  `chain [${capexDef.chain.join(", ")}] sticky=${capexDef.oneConceptPerFiler}`);

// TIES GO TO PP&E, and the newest period is what decides. Both concepts on
// FY2025 (the newest), so the tie-break is the claim; FY2024 has only the
// primary, so it is untouched either way and is the control.
const tieOnNewest = {
  cik: 1,
  facts: { "us-gaap": {
    [CAPEX_A]: { units: { USD: [
      { start: "2024-01-01", end: "2024-12-31", val: 100, accn: "a", filed: "2025-02-01" },
      { start: "2025-01-01", end: "2025-12-31", val: 110, accn: "b", filed: "2026-02-01" },
    ] } },
    [CAPEX_B]: { units: { USD: [
      // FILED LATER than the primary for the same period, so "newest filing
      // wins" would take it. Rank has to beat filing date here.
      { start: "2025-01-01", end: "2025-12-31", val: 220, accn: "c", filed: "2026-03-01" },
    ] } },
  } },
};
const tie = extractCompanyFacts("TIEC", tieOnNewest);
const tieY = (e) => tie.years.find((y) => y.end === e)?.values[capexIdx];
check("where the newest period files BOTH, the PP&E concept wins the tie",
  tie.conceptChoice.capex === `us-gaap|${CAPEX_A}` && tieY("2025-12-31")?.val === 110,
  `chose ${tie.conceptChoice.capex}, FY2025 = ${tieY("2025-12-31")?.val} — and the broader ` +
    `reading was filed a month LATER, so this is rank beating filing date, not an accident`);
check("...and the whole column follows it, including older periods",
  tieY("2024-12-31")?.tag === CAPEX_A && tieY("2024-12-31")?.val === 100,
  "chosen once, applied to every period");

// THE NVDA / PANW / GE SHAPE, which is what the ruling turned on: the primary
// concept on an OLD annual period, the broader one on the recent quarters.
// Under "highest rank filed anywhere" the column is fixed on a concept the
// quarters do not carry and every quarterly cell is refused.
const oldPrimaryNewBroad = {
  cik: 1,
  facts: { "us-gaap": {
    [CAPEX_A]: { units: { USD: [
      { start: "2021-01-01", end: "2021-12-31", val: 55, accn: "z", filed: "2022-02-01" },
    ] } },
    [CAPEX_B]: { units: { USD: [
      { start: "2026-01-01", end: "2026-03-31", val: 200, accn: "p", filed: "2026-04-20" },
      { start: "2026-01-01", end: "2026-06-30", val: 450, accn: "q", filed: "2026-07-20" },
      { start: "2026-01-01", end: "2026-12-31", val: 900, accn: "r", filed: "2027-02-01" },
    ] } },
  } },
};
const nv = extractCompanyFacts("NVSHAPE", oldPrimaryNewBroad);
const nvQ = (e) => nv.quarters.find((q) => q.end === e)?.values[capexIdx];
const nvCells = [...nv.quarters, ...nv.years]
  .filter((p) => p.values[capexIdx]?.val != null).length;
check("a filer whose RECENT periods are on the broader concept keeps its column",
  nv.conceptChoice.capex === `us-gaap|${CAPEX_B}` && nvQ("2026-03-31")?.val === 200,
  `chose ${nv.conceptChoice.capex} — the NVDA/PANW/GE shape: the primary concept appears ` +
    `once, years ago, and does not get to empty every recent quarter`);
check("...and that is more than one cell, so the assertion is about a column",
  nvCells >= 3, `${nvCells} capex cells carry a figure`);

// A FILER THAT NEVER PUBLISHES THE PRIMARY — GEV and KTOS are the real ones.
const onlyBroad = {
  cik: 1,
  facts: { "us-gaap": { [CAPEX_B]: { units: { USD: [
    { start: "2025-01-01", end: "2025-12-31", val: 220, accn: "b", filed: "2026-02-01" },
    { start: "2026-01-01", end: "2026-12-31", val: 230, accn: "c", filed: "2027-02-01" },
  ] } } } },
};
const ob = extractCompanyFacts("ONLYB", onlyBroad);
check("a filer that never files the PP&E concept uses the broader one, and says so",
  ob.years.find((y) => y.end === "2026-12-31")?.values[capexIdx]?.tag === CAPEX_B &&
    ob.conceptChoice.capex === `us-gaap|${CAPEX_B}`,
  `conceptChoice.capex = ${ob.conceptChoice.capex} — this is the GEV/KTOS case, and the ` +
    `row label has to change with it`);

// AND THE REFUSAL, which is the half that costs cells: a filer whose newest
// period is on the PRIMARY concept refuses the broader one on older periods
// rather than switching.
const newPrimaryOldBroad = {
  cik: 1,
  facts: { "us-gaap": {
    [CAPEX_A]: { units: { USD: [
      { start: "2026-01-01", end: "2026-12-31", val: 130, accn: "c", filed: "2027-02-01" },
    ] } },
    [CAPEX_B]: { units: { USD: [
      { start: "2025-01-01", end: "2025-12-31", val: 220, accn: "b", filed: "2026-02-01" },
    ] } },
  } },
};
const np = extractCompanyFacts("NEWPRIM", newPrimaryOldBroad);
const npY = (e) => np.years.find((y) => y.end === e)?.values[capexIdx];
check("a period the chosen concept does not cover is NOT filled from the other",
  np.conceptChoice.capex === `us-gaap|${CAPEX_A}` &&
    (npY("2025-12-31") === null || npY("2025-12-31") === undefined),
  `chose ${np.conceptChoice.capex}; FY2025 = ${JSON.stringify(npY("2025-12-31") ?? null)} — ` +
    `the filer published 220 under the broader concept and the column refuses it`);

{
  // MUTATION (1): the restriction dropped, so an absent period falls back to
  // the other concept again — the mixed column the ruling exists to stop.
  const noRestrict = await liftMutated((src) =>
    src.replace("  if (restrict && preferred) {", "  if (false) {")
  );
  const m1 = noRestrict.extractCompanyFacts("NEWPRIM", newPrimaryOldBroad);
  const m1y = m1.years.find((y) => y.end === "2025-12-31")?.values[capexIdx];
  check("MUTATION: without the refusal, the absent period is filled from the OTHER concept",
    m1y?.val === 220 && m1y?.tag === CAPEX_B,
    `FY2025 comes back as ${m1y?.tag} = ${m1y?.val} beside FY2026 ` +
      `${npY("2026-12-31")?.tag} = ${npY("2026-12-31")?.val} — two measures, one column, one heading`);
  check("...and the mutation leaves the non-sticky field alone, so it is the restriction being tested",
    noRestrict.extractCompanyFacts("MIGR", migrated).years
      .find((y) => y.end === "2025-12-31")?.values[ocfIdx]?.tag === OCF_B,
    "operatingCashFlow never took the restrict branch, so its resolution is unchanged");

  // MUTATION (2): THE RULE THIS ONE REPLACED — choose the highest-ranked
  // concept the filer files for ANY period, rather than the newest period's.
  // This is not an invented mutation: it is what shipped in 17a6422e, and the
  // 119-symbol run is why it did not stay.
  const rankAnywhere = await liftMutated((src) =>
    src.replace(
      "      preferredTag(all)",
      "      field.oneConceptPerFiler\n" +
      "        ? (() => { let b = null; for (const c of all) if (!b || c.rank < b.rank) b = c;\n" +
      "                   return b ? `${b.ns}|${b.tag}` : null; })()\n" +
      "        : preferredTag(all)"
    )
  );
  const m2 = rankAnywhere.extractCompanyFacts("NVSHAPE", oldPrimaryNewBroad);
  const m2cells = [...m2.quarters, ...m2.years]
    .filter((p) => p.values[capexIdx]?.val != null).length;
  check("the highest-rank-anywhere mutation actually applied",
    m2.conceptChoice.capex === `us-gaap|${CAPEX_A}`,
    `it chose ${m2.conceptChoice.capex} where the rule chooses ${nv.conceptChoice.capex}`);
  check("MUTATION: choosing the highest-ranked concept filed ANYWHERE empties the column",
    m2cells < nvCells && m2cells <= 1,
    `${nvCells} capex cells under the rule -> ${m2cells} under the mutation — one filing from ` +
      `2021 fixes the column on a concept none of the recent periods carries, which is what ` +
      `cost NVDA 17 cells, PANW 18 and GE 15 on the 119-symbol run`);
  check("...and the tie-break is unaffected by it, so the two rules are separable",
    rankAnywhere.extractCompanyFacts("TIEC", tieOnNewest).conceptChoice.capex ===
      `us-gaap|${CAPEX_A}`,
    "a filer whose newest period files both lands on PP&E under either rule — the mutation " +
      "is about WHICH PERIOD decides, not about how a tie is broken");
}

// AND THE RE-READ KEY HAS TO MOVE FOR THIS TOO. A stored set written before the
// sticky rule holds capex figures the shipped code would not write — the mixed
// column — so if secChainsHash ignores the flag, every such set reports itself
// current and keeps serving them.
check("oneConceptPerFiler is fed into secChainsHash",
  mod.secChainsHash() !== (await lift(
    fieldsSrc.replace('+ `|one:${f.oneConceptPerFiler ? 1 : 0}`', "+ ``")
  )).secChainsHash(),
  "a set written under the old resolution must not report itself current");

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

// grossProfit is STORED, not derived, so the identity has two independent
// numbers to compare. Asserted to fail when they disagree — a derived left-hand
// side would make this identity unfailable, which is the vacuous pass the whole
// three-state design exists to avoid.
const gp = (rev, cogs, gross) => ({ cik: 1, facts: { "us-gaap": Object.fromEntries(
  [["Revenues", rev], ["CostOfRevenue", cogs], ["GrossProfit", gross]].map(([k, v]) => [k, { units: { USD: [
    { start: "2026-01-01", end: "2026-03-31", val: v, accn: "a", filed: "2026-04-20" },
  ] } }])
) } });
const GP_ID = "grossProfit = revenue - costOfRevenue";
check("the gross-profit identity passes when the filed figures agree",
  rates(checkIdentities(extractCompanyFacts("G", gp(1000, 400, 600))))[GP_ID]?.pass === 1);
check("and FAILS when they do not — it is two filed numbers, not one derived twice",
  rates(checkIdentities(extractCompanyFacts("G", gp(1000, 400, 550))))[GP_ID]?.fail === 1,
  JSON.stringify(rates(checkIdentities(extractCompanyFacts("G", gp(1000, 400, 550))))[GP_ID]));
const noGp = gp(1000, 400, 600);
delete noGp.facts["us-gaap"].GrossProfit;
check("a filer that publishes no GrossProfit SKIPS it rather than checking a derivation against itself",
  rates(checkIdentities(extractCompanyFacts("G", noGp)))[GP_ID]?.skipped === 1);

check("identityRates counts every state and invents none",
  Object.values(rates(span)).every((r) =>
    r.pass + r.fail + r.skipped > 0 && Object.keys(r).join() === "pass,fail,skipped"));

console.log("\n FRAME LENGTHS: a field with no adjacent frame yields no quarter");

// ── WHY AZN's CASH-FLOW CHAIN IS EMPTY, PINNED AS A MECHANISM ─────────────
//
// The review offered two candidates: the ifrs-full cash tags are unmapped, or
// the differencing needs two consecutive cumulative periods a half-yearly filer
// never supplies. MEASURED (relay 34978655653) it is NEITHER.
//
//   ifrs-full:CashFlowsFromUsedInOperatingActivities  PRESENT, 45 USD rows
//   span-days=[180,181,364,365]   11 year-starts, 10 with >1 cumulative end
//   stored latest quarter frame:  start=2025-04-01 end=2025-06-30 span=90d
//   revenue            frame lengths n=[1,2,4]  -> quarter possible
//   operatingCashFlow  frame lengths n=[2,4]    -> quarter NOT possible
//
// The tag is mapped and present, and AZN does supply two cumulative frames per
// year. The cause is that extractCompanyFacts steps ONE frame-length at a time
// (`byLen.get(f.n - 1)`): n=2 needs an n=1 and n=4 needs an n=3, and AZN's cash
// -flow statement publishes neither. Its income statement publishes n=1, which
// is why revenue resolves on the very same row that cash flow does not.
//
// Asserted against a crafted payload because it is a property of the MECHANISM,
// not a business figure — the values below are 1 and 2 and carry no meaning.
{
  const row = (start, end, val) => ({ start, end, val, accn: `a${val}`, filed: "2026-01-01" });
  const facts = (tag, rows) => ({
    cik: 1, facts: { "us-gaap": { [tag]: { units: { USD: rows } } } },
  });
  const idxOf = (k) => SEC_FIELDS.findIndex((f) => f.key === k);

  // n=[2,4] only — AZN's cash-flow shape.
  const halfOnly = extractCompanyFacts("HALF", facts("NetCashProvidedByUsedInOperatingActivities", [
    row("2025-01-01", "2025-06-30", 100),   // n=2
    row("2025-01-01", "2025-12-31", 250),   // n=4
  ]));
  check("a field publishing only n=2 and n=4 yields NO quarter",
    halfOnly.quarters.every((p) => p.values[idxOf("operatingCashFlow")]?.val == null),
    "n=2 needs an n=1 to difference against and n=4 needs an n=3; neither exists");
  check("...but it DOES yield the annual figure",
    halfOnly.years.some((p) => p.values[idxOf("operatingCashFlow")]?.val === 250),
    "the cash numbers are not missing from the filing, only from the quarter");

  // n=[1,2,4] — AZN's revenue shape, same filer, same year.
  const withQ1 = extractCompanyFacts("FULL", facts("Revenues", [
    row("2025-01-01", "2025-03-31", 40),    // n=1
    row("2025-01-01", "2025-06-30", 100),   // n=2
    row("2025-01-01", "2025-12-31", 250),   // n=4
  ]));
  const q1 = withQ1.quarters.find((p) => p.end === "2025-03-31");
  const q2 = withQ1.quarters.find((p) => p.end === "2025-06-30");
  check("adding an n=1 frame makes BOTH the first and second quarter resolvable",
    q1?.values[idxOf("revenue")]?.val === 40 &&
      q2?.values[idxOf("revenue")]?.val === 60,
    `q1=${q1?.values[idxOf("revenue")]?.val} q2=${q2?.values[idxOf("revenue")]?.val} ` +
      "— 100 - 40 = 60, which is the difference the cash chain cannot take");
  check("...and the differenced one is labelled as differenced, not as filed",
    q2?.values[idxOf("revenue")]?.derived === "differenced");
}

console.log("\n PERIOD COHERENCE: one quarter row, one reporting period");

// ── THE CARD THAT MUST NEVER MIX PERIODS ──────────────────────────────────
//
// WHAT PROMPTED IT. NVDA's Quality of Earnings card, Q2 FY2027: net income
// $59.69B beside a derived operating cash flow of $24.08B. secEarningsView
// reads BOTH from the same PeriodRecord, so a gap that size is either a real
// accrual gap or one of the two cells is built from a six-month frame.
//
// MEASURED, relay 35086929046, on the shipped extractor and NVDA's own
// payload: net income is AS-FILED from 2026-04-27..2026-07-26 (90d, the
// filer's own CY2026Q2 frame) and operating cash flow is 74.42B on
// 2026-01-26..2026-07-26 minus 50.34B on 2026-01-26..2026-04-26, which covers
// 2026-04-26..2026-07-26 (91d). BOTH ARE QUARTERS. There was no period mix;
// the gap is the filer's.
//
// ── SO THIS IS A GUARD, NOT A FIX, AND IT GUARDS SOMETHING REAL ───────────
// Nothing asserted that invariant. The cell that decides it is `covers`, and
// before this it did not exist: a PeriodRecord's `start` is written into
// quarterMeta by whichever FIELD reached that period end first and overwritten
// by every differenced write after it, so it is one field's frame and not the
// row's. Measuring a cell against the row's start measures the wrong thing --
// the first frame-length probe did exactly that and could only ever see the
// as-filed half.
//
// TWO PROPERTIES, both of the mechanism and neither of any number:
//   (i)  every duration cell on a QUARTER row covers ONE quarter
//   (ii) every duration cell on one row covers the SAME quarter as its
//        neighbours, within SAME_FRAME_SLACK_DAYS
// The values below are 10/30/60/90 and mean nothing.
{
  const row = (start, end, val) => ({ start, end, val, accn: `a${val}`, filed: "2026-09-01" });
  const idxOf = (k) => SEC_FIELDS.findIndex((f) => f.key === k);
  const DURATION_KEYS = SEC_FIELDS
    .map((f, i) => [f, i])
    .filter(([f]) => f.kind !== "instant")
    .map(([f, i]) => [f.key, i]);

  /**
   * THE INVARIANT ITSELF, as a function, so the mutations below are judged by
   * the SAME code that judges the shipped extractor. An assertion written out
   * twice is two assertions that can disagree.
   *
   * Returns the offending cells, so a failure names them instead of saying no.
   */
  const incoherent = (out, mod = { quartersCovered, sameFrame }) => {
    const bad = [];
    for (const q of out.quarters) {
      const cells = DURATION_KEYS
        .map(([key, i]) => [key, q.values[i]])
        .filter(([, v]) => v && v.val !== null);
      for (const [key, v] of cells) {
        if (!v.covers) { bad.push(`${q.end} ${key}: no covers`); continue; }
        const n = mod.quartersCovered(spanDays(v.covers[0], v.covers[1]));
        if (n !== 1) {
          bad.push(`${q.end} ${key}: covers ${v.covers.join("..")} = ${n ?? "no"} quarter(s)`);
        }
      }
      // (ii) against the FIRST cell rather than pairwise: sameFrame pins the
      // end exactly and the start within a week, so agreement with one is
      // agreement with all, and the report names a reference frame.
      const [, ref] = cells[0] ?? [];
      for (const [key, v] of cells.slice(1)) {
        if (!mod.sameFrame(v.covers, ref?.covers)) {
          bad.push(
            `${q.end} ${key}: covers ${v.covers?.join("..") ?? "?"} but the row's other ` +
              `cells cover ${ref?.covers?.join("..") ?? "?"}`
          );
        }
      }
    }
    return bad;
  };

  // A FILER WITH BOTH SHAPES IN ONE ROW, which is the case the invariant is
  // about: net income filed standalone, cash flow only cumulative. Q2 must come
  // out as-filed on one and differenced on the other, and still be one period.
  const mixedShape = {
    cik: 1,
    facts: { "us-gaap": {
      NetIncomeLoss: { units: { USD: [
        row("2026-01-01", "2026-03-31", 10),
        // The standalone quarter, starting the day AFTER the prior frame ends
        // -- the off-by-one SAME_FRAME_SLACK_DAYS exists for.
        row("2026-04-01", "2026-06-30", 30),
      ] } },
      NetCashProvidedByUsedInOperatingActivities: { units: { USD: [
        row("2026-01-01", "2026-03-31", 60),
        row("2026-01-01", "2026-06-30", 90),
      ] } },
    } },
  };
  const mixed = extractCompanyFacts("MIX", mixedShape);
  const mq2 = mixed.quarters.find((q) => q.end === "2026-06-30");
  check("the fixture really does exercise both derivations in ONE row",
    mq2?.values[idxOf("netIncome")]?.derived === "as-filed" &&
      mq2?.values[idxOf("operatingCashFlow")]?.derived === "differenced",
    `netIncome=${mq2?.values[idxOf("netIncome")]?.derived} ` +
      `operatingCashFlow=${mq2?.values[idxOf("operatingCashFlow")]?.derived} ` +
      "— a fixture where both cells came out the same way would test half of it");
  check("every duration cell carries the frame it covers",
    DURATION_KEYS.every(([, i]) => {
      const v = mq2?.values[i];
      return !v || v.val === null || Array.isArray(v.covers);
    }),
    "a cell with no covers cannot be checked at all, which is the state this replaced");
  check("no quarter row mixes periods",
    incoherent(mixed).length === 0, incoherent(mixed).join("; ") || "clean");
  check("...and the as-filed cell's one-day-later start is ACCEPTED, not a failure",
    mq2?.values[idxOf("netIncome")]?.covers?.[0] === "2026-04-01" &&
      mq2?.values[idxOf("operatingCashFlow")]?.covers?.[0] === "2026-03-31",
    "the two spellings of the quarter's first day are a week apart at most, by design");

  {
    // MUTATION (1): the differencing steps TWO frame lengths instead of one, so
    // a quarter row is handed a six-month figure -- the exact shape the NVDA
    // report suspected. The invariant must see it.
    const twoStep = await liftMutated((src) =>
      src.replace("const prior = byLen.get(f.n - 1);", "const prior = byLen.get(f.n - 2);")
    );
    const broken = twoStep.extractCompanyFacts("MIX", {
      cik: 1,
      facts: { "us-gaap": {
        NetIncomeLoss: { units: { USD: [
          row("2026-01-01", "2026-03-31", 10),
          row("2026-04-01", "2026-06-30", 30),
        ] } },
        NetCashProvidedByUsedInOperatingActivities: { units: { USD: [
          row("2026-01-01", "2026-03-31", 60),
          row("2026-01-01", "2026-06-30", 90),
          row("2026-01-01", "2026-09-30", 120),
        ] } },
      } },
    });
    const bad = incoherent(broken, { quartersCovered: twoStep.quartersCovered, sameFrame: twoStep.sameFrame });
    check("MUTATION: differencing across two frame lengths puts a half-year in a quarter row",
      bad.length > 0, bad.join("; ") || "(the invariant saw nothing — it is not testing this)");
    check("...and it is the SPAN that gives it away, not a missing value",
      bad.some((b) => /= 2 quarter\(s\)|but the row's other cells cover/.test(b)),
      bad.join("; ") || "(none)");
  }

  {
    // MUTATION (2): covers dropped from the differenced write. A cell with no
    // frame is unjudgeable, and the check must FAIL on that rather than skip
    // it -- "no covers" is the state that let the question go unanswered for a
    // day.
    const noCovers = await liftMutated((src) =>
      src.replace(`          derived: "differenced",\n          covers: [prior.end, f.end],`, `          derived: "differenced",`)
    );
    const blind = noCovers.extractCompanyFacts("MIX", mixedShape);
    const bad = incoherent(blind, { quartersCovered: noCovers.quartersCovered, sameFrame: noCovers.sameFrame });
    check("MUTATION: a duration cell with no covers is a failure, never a pass",
      bad.some((b) => b.includes("no covers")), bad.join("; ") || "(silently skipped)");
  }

  // ── THE RATIO FALLBACK, WHICH IS WHERE A MIX WOULD ACTUALLY BE COMPUTED ──
  //
  // "A quarter's earnings over a year's share count is a wrong number that
  // looks like a right one" is what the code says. Both operands sit in one
  // cell map keyed by period END, and that was taken as proof they shared a
  // period -- they share an end. A denominator whose START is a year earlier
  // is a different frame and the division crosses it.
  {
    const ratio = SEC_FIELDS.find((f) => f.ratioSource);
    check("there is a ratio field to test the guard on", !!ratio, ratio?.key ?? "(none)");
    const num = SEC_FIELDS.find((f) => f.key === ratio.ratioSource.numerator);
    const den = SEC_FIELDS.find((f) => f.key === ratio.ratioSource.denominator);
    // ── THE TWO FRAMES HAVE TO BE REACHABLE, AND ONE SHAPE IS NOT ─────────
    //
    // The obvious fixture -- a year-long denominator -- CANNOT reach this code
    // and the first draft of this block asserted a pass it was not earning:
    // a duration-average field only writes to quarterCells on an n=1 frame, so
    // a 365-day share count lands in yearCells and the quarter simply has no
    // denominator. Null, for a reason that has nothing to do with the guard.
    //
    // The reachable shape is both operands inside the quarter BAND (80-105
    // days) but not the same quarter: quartersCovered is deliberately wide for
    // 4-4-5 calendars, so a numerator differenced out to 100 days and a filed
    // 90-day share count share an END and cover ten days differently. Each
    // cell is a legal quarter on its own; the DIVISION across them is not.
    const crossed = {
      cik: 1,
      facts: { "us-gaap": {
        // 180d - 80d = a 100-day "quarter", the wide end of the band.
        [num.chain[0]]: { units: { USD: [
          row("2026-01-01", "2026-03-22", 10),
          row("2026-01-01", "2026-06-30", 40),
        ] } },
        // ...against a share count filed on the ordinary 90-day quarter.
        [den.chain[0]]: { units: { shares: [row("2026-04-01", "2026-06-30", 90)] } },
      } },
    };
    const cr = extractCompanyFacts("XFRM", crossed);
    const crQ = cr.quarters.find((q) => q.end === "2026-06-30");
    check("the fixture puts BOTH operands in the quarter map, or it tests nothing",
      crQ?.values[idxOf(num.key)]?.val === 30 && crQ?.values[idxOf(den.key)]?.val === 90,
      `${num.key}=${JSON.stringify(crQ?.values[idxOf(num.key)]?.val ?? null)} ` +
        `${den.key}=${JSON.stringify(crQ?.values[idxOf(den.key)]?.val ?? null)} ` +
        "— a denominator that never reached the quarter would make the next assertion pass for free");
    check("...and each operand is a legal quarter ON ITS OWN, so only the division is wrong",
      quartersCovered(spanDays(...crQ.values[idxOf(num.key)].covers)) === 1 &&
        quartersCovered(spanDays(...crQ.values[idxOf(den.key)].covers)) === 1,
      `${crQ?.values[idxOf(num.key)]?.covers?.join("..")} and ` +
        `${crQ?.values[idxOf(den.key)]?.covers?.join("..")}`);
    check("a ratio is NOT computed across two different frames",
      crQ?.values[idxOf(ratio.key)] == null,
      `${ratio.key} = ${JSON.stringify(crQ?.values[idxOf(ratio.key)]?.val ?? null)} ` +
        "— a hundred days of earnings over ninety days of shares");
    check("...and the refusal names both frames in a note",
      cr.notes.some((n) => n.startsWith(`${ratio.key} `) && n.includes("covers")),
      cr.notes.find((n) => n.startsWith(`${ratio.key} `)) ?? "(none)");
    check("...and the row-level invariant sees the same disagreement independently",
      incoherent(cr).some((b) => b.includes("but the row's other cells cover")),
      incoherent(cr).join("; ") || "(clean — then the guard and the invariant disagree)");

    // MUTATION: the guard removed, so the two frames divide.
    const unguarded = await liftMutated((src) =>
      src.replace("if (!sameFrame(numCell?.covers, denCell?.covers)) {", "if (false) {")
    );
    const un = unguarded.extractCompanyFacts("XFRM", crossed);
    const unQ = un.quarters.find((q) => q.end === "2026-06-30");
    check("MUTATION: without the guard the cross-frame ratio is computed",
      unQ?.values[idxOf(ratio.key)]?.val === 30 / 90,
      `the mutation renders ${JSON.stringify(unQ?.values[idxOf(ratio.key)]?.val ?? null)} — ` +
        "a per-share figure whose numerator and denominator cover different periods");
    // AND IT MUST NOT SIMPLY BREAK EVERYTHING: a ratio whose operands DO agree
    // still has to compute, or the guard above would pass by emptying the field.
    const aligned = extractCompanyFacts("XFRM2", {
      cik: 1,
      facts: { "us-gaap": {
        [num.chain[0]]: { units: { USD: [row("2026-04-01", "2026-06-30", 30)] } },
        [den.chain[0]]: { units: { shares: [row("2026-04-01", "2026-06-30", 90)] } },
      } },
    });
    const alQ = aligned.quarters.find((q) => q.end === "2026-06-30");
    check("...and a ratio whose operands DO share a frame still computes",
      alQ?.values[idxOf(ratio.key)]?.val === 30 / 90,
      `${ratio.key} = ${JSON.stringify(alQ?.values[idxOf(ratio.key)]?.val ?? null)} ` +
        "— a guard that emptied the field would pass the assertion above for the wrong reason");
  }
}

console.log("\n IFRS: a second namespace, ranked BELOW the primary one");

{
  const fieldsSrc = fs.readFileSync("lib/server/secFields.ts", "utf8");
  const withIfrs = SEC_FIELDS.filter((f) => f.ifrsChain?.length);
  check("most fields carry an ifrs-full chain",
    withIfrs.length >= 40,
    `${withIfrs.length} of ${SEC_FIELDS.length} — the gap covered a quarter of stock pages`);
  // THE TWO DELIBERATE GAPS. Named, so that "this field has no IFRS entry" is a
  // decision on the record rather than something nobody noticed.
  const without = SEC_FIELDS.filter((f) => !f.ifrsChain?.length).map((f) => f.key).sort();
  check("...and the fields WITHOUT one are the three documented gaps",
    JSON.stringify(without) ===
      JSON.stringify(["cashIncludingRestricted", "dividendsDeclaredPerShare", "nonOperatingIncomeExpense"]),
    `${without.join(", ") || "none"} — restricted cash and a non-operating total have no ` +
      `IFRS equivalent, and 0 of 20 probed filers publish a per-share dividend under ifrs-full`);
  // ── A SHARED SPELLING IS TWO SOURCES, NOT A DUPLICATE ─────────────────────
  //
  // The first version of this assertion required the two chains to be disjoint,
  // on the reasoning that a repeated tag "adds a rank without adding a source".
  // That is wrong, and it is wrong in the same way the first IFRS probe was:
  // IFRS and us-gaap SHARE SPELLINGS, and `facts["us-gaap"].GrossProfit` and
  // `facts["ifrs-full"].GrossProfit` are different data under one name. The
  // probe confirmed all eight are real ifrs-full tags that real filers publish
  // and that win cells (Goodwill in 13 of 20, Assets and Liabilities in 17).
  //
  // So the overlap is ENUMERATED rather than forbidden — a new one should be a
  // deliberate act — and the property that matters, that the namespace decides
  // which one wins, is proven by running the extractor below.
  const shared = withIfrs
    .filter((f) => f.ifrsChain.some((t) => f.chain.includes(t)))
    .map((f) => f.key).sort();
  check("the tags spelled the same in both taxonomies are the known eight",
    JSON.stringify(shared) === JSON.stringify([
      "goodwill", "grossProfit", "interestExpense", "netIncome",
      "researchAndDevelopment", "sellingGeneralAndAdministrative",
      "totalAssets", "totalLiabilities",
    ]),
    `${shared.join(", ")} — a shared spelling is fine because the NAMESPACE ` +
      `disambiguates; assuming the tag name could was what made a us-gaap-only ` +
      `filer report 71 "ifrs cells"`);
  // ── PRECEDENCE, RUN RATHER THAN READ ──────────────────────────────────────
  // A filer that tags BOTH must keep its us-gaap reading. Asserted by feeding
  // the extractor a payload with the same field under both namespaces and
  // different values, because "appended after" is a claim about rowsForField
  // that a comment cannot check.
  const both = extractCompanyFacts("BOTH", {
    cik: 1,
    facts: {
      "us-gaap": { Assets: { units: { USD: [{ end: "2026-06-30", val: 111, accn: "a", filed: "2026-07-01" }] } } },
      "ifrs-full": { Assets: { units: { USD: [{ end: "2026-06-30", val: 222, accn: "b", filed: "2026-08-01" }] } } },
    },
  });
  const idx = SEC_FIELDS.findIndex((f) => f.key === "totalAssets");
  const cellBoth = both.instants[0]?.values[idx];
  check("a dual-tagging filer keeps its us-gaap value, not the ifrs one",
    cellBoth?.val === 111 && cellBoth?.ns === "us-gaap",
    `got ${JSON.stringify({ val: cellBoth?.val, ns: cellBoth?.ns })} — and note the ifrs row ` +
      `was filed LATER, so this also proves rank beats recency across namespaces`);
  const ifrsOnly = extractCompanyFacts("IFRS", {
    cik: 1,
    facts: { "ifrs-full": { Assets: { units: { USD: [{ end: "2026-06-30", val: 222, accn: "b", filed: "2026-07-01" }] } } } },
  });
  check("...and an ifrs-only filer falls through to it",
    ifrsOnly.instants[0]?.values[idx]?.val === 222 &&
      ifrsOnly.instants[0]?.values[idx]?.ns === "ifrs-full");
  // ── THE CURRENCY GUARD, RETARGETED RATHER THAN RELAXED ───────────────────
  //
  // The rule used to be "only USD is ever read". It is now "only the filer's
  // ONE reporting currency is ever read", and the distinction these three
  // assertions defend is that the second is still a guard: admitting EUR for a
  // euro reporter must not admit JPY for that same filer, and must not admit
  // EUR for a filer that reports in dollars.
  //
  // The extraction performs NO conversion — it is network-free — so these
  // values are euros and `reportingCurrency` says so. Turning them into
  // dollars is secCurrency's job and is checked in check-sec-currency.
  const eur = extractCompanyFacts("EUR", {
    cik: 1,
    facts: { "ifrs-full": { Assets: { units: { EUR: [{ end: "2026-06-30", val: 999, accn: "b", filed: "2026-07-01" }] } } } },
  });
  check("a euro reporter's figures ARE read, and in euros",
    eur.instants[0]?.values[idx]?.val === 999 && eur.reportingCurrency === "EUR",
    `got ${eur.instants[0]?.values[idx]?.val} in ${eur.reportingCurrency} — ` +
      "no conversion here; the extraction is network-free and says what currency it read");
  // THE GUARD ITSELF: a SECOND foreign currency on the same filer is still
  // refused. This is the assertion that would fail if "admit the home
  // currency" had been implemented as "admit any currency".
  const eurJpy = extractCompanyFacts("EURJPY", {
    cik: 1,
    facts: {
      "ifrs-full": {
        Assets: {
          units: {
            EUR: [{ end: "2026-06-30", val: 999, accn: "b", filed: "2026-07-01" },
                  { end: "2026-03-31", val: 998, accn: "c", filed: "2026-04-01" }],
            JPY: [{ end: "2026-06-30", val: 777777, accn: "b", filed: "2026-07-01" }],
          },
        },
      },
    },
  });
  // THE WINNER IS THE CURRENCY COVERING THE MOST FIELDS, and the loser's rows
  // are NOT READ — which is what makes a winner safe. This fixture gives EUR
  // and JPY one field each, so USD takes the tie by the documented rule and
  // both are refused; the point being asserted is that the JPY rows never
  // reach a field the EUR rows also populate.
  check("a second foreign currency never shares a column with the first",
    eurJpy.instants.every((p) =>
      p.values.every((v) => v === null || v.val !== 777777)),
    `decided ${eurJpy.reportingCurrency}; the JPY figure must not appear anywhere`);
  // AND A DOLLAR REPORTER IS UNMOVED. Any USD at all wins, so no symbol
  // rendering today can be pulled onto a conversion path by this change.
  const mixed = extractCompanyFacts("MIXED", {
    cik: 1,
    facts: {
      "ifrs-full": {
        Assets: {
          units: {
            USD: [{ end: "2026-06-30", val: 111, accn: "a", filed: "2026-07-01" }],
            EUR: [{ end: "2026-06-30", val: 999, accn: "b", filed: "2026-07-01" }],
          },
        },
      },
    },
  });
  check("a filer publishing any USD at all is read as USD, and its EUR ignored",
    mixed.reportingCurrency === "USD" &&
      mixed.instants[0]?.values[idx]?.val === 111,
    `got ${mixed.instants[0]?.values[idx]?.val} in ${mixed.reportingCurrency}`);
  // AND NOTHING IS RECORDED AS REFUSED, WHICH IS CORRECT RATHER THAN A GAP.
  // refusedUnits exists to explain an EMPTY extraction to the reader — it is
  // only written when a field took nothing at all. Here the field took its USD
  // value, and the EUR rows are the same facts filed twice, so there is no
  // unreadability to explain and naming a "refused" currency would invite
  // unreadableReason to report one on a filer that read perfectly.
  check("...and records no refusal, because nothing was left unexplained",
    mixed.refusedUnits.length === 0,
    `refused ${JSON.stringify(mixed.refusedUnits)}`);
  check("a USD reporter records no refused currency",
    ifrsOnly.refusedUnits.length === 0 && ifrsOnly.reportingCurrency === "USD");
  check("the ifrs table cites the run that corrected it",
    /relay 34970388423|34971118882|34971551511/.test(fieldsSrc),
    "four entries were deleted and two added on this evidence");
}

console.log(failures ? `\n${failures} assertion(s) failed.\n` : "\nExtraction structure is sound.\n");
process.exit(failures ? 1 : 0);
