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
  SEC_FIELDS, SEC_FIELD_KEYS, SEC_FIELD_INDEX, secFieldsHash,
  cumulativeFields, instantFields, extractCompanyFacts, quartersCovered,
  cashFlowReconciliation,
} = mod;

// ── 1. the list itself ──────────────────────────────────────────────────────
console.log("\n1. the field list");

check("43 fields", SEC_FIELDS.length === 43, `${SEC_FIELDS.length}`);
check("keys are unique", new Set(SEC_FIELD_KEYS).size === SEC_FIELD_KEYS.length);
check("SEC_FIELD_INDEX agrees with the array order",
  SEC_FIELD_KEYS.every((k, i) => SEC_FIELD_INDEX[k] === i));

const byStatement = (s) => SEC_FIELDS.filter((f) => f.statement === s);
check("16 income, 10 cash-flow, 17 balance-sheet",
  byStatement("income").length === 16 && byStatement("cash-flow").length === 10 &&
    byStatement("balance-sheet").length === 17,
  `${byStatement("income").length}/${byStatement("cash-flow").length}/${byStatement("balance-sheet").length}`);

check("every chain is non-empty", SEC_FIELDS.every((f) => f.chain.length > 0));
check("no chain repeats a tag",
  SEC_FIELDS.every((f) => new Set(f.chain).size === f.chain.length));
check("every unit is one of the three companyfacts keys",
  SEC_FIELDS.every((f) => ["USD", "shares", "USD/shares"].includes(f.unit)));
check("only sharesOutstandingCover is dei",
  SEC_FIELDS.filter((f) => f.taxonomy === "dei").map((f) => f.key).join() === "sharesOutstandingCover");

// ASC 606. `Revenues` is legacy -- AAPL's last is 2018-09-29 -- so it must sit
// BELOW RevenueFromContractWithCustomer..., never above, or every large filer
// renders 2018 revenue as current (BRIEF §"trap 2").
const revenue = SEC_FIELDS.find((f) => f.key === "revenue");
check("`Revenues` ranks below the ASC 606 tag in the revenue chain",
  revenue.chain.indexOf("RevenueFromContractWithCustomerExcludingAssessedTax") <
    revenue.chain.indexOf("Revenues"),
  revenue.chain.join(" > "));

// ── 2. THE PROPERTY THE OWNER ASKED FOR ─────────────────────────────────────
console.log("\n2. instant vs duration-cumulative");

check("ALL 17 balance-sheet fields are instant",
  byStatement("balance-sheet").every((f) => f.kind === "instant"),
  byStatement("balance-sheet").filter((f) => f.kind !== "instant").map((f) => f.key).join(", ") || "17/17");
check("no income or cash-flow field is instant",
  [...byStatement("income"), ...byStatement("cash-flow")].every((f) => f.kind === "duration-cumulative"));
check("cumulativeFields() and instantFields() partition the list",
  cumulativeFields().length + instantFields().length === SEC_FIELDS.length &&
    cumulativeFields().every((f) => f.kind === "duration-cumulative") &&
    instantFields().every((f) => f.kind === "instant"),
  `${cumulativeFields().length} + ${instantFields().length}`);
check("cumulativeFields() contains no balance-sheet field",
  cumulativeFields().every((f) => f.statement !== "balance-sheet"));

// THE STRUCTURAL HALF, read from the shipped source rather than inferred.
//
// The property is "the differencing CANNOT reach an instant field". A value
// assertion cannot show that -- it shows only that it did not this time. So the
// source is read: every site that emits `derived: "differenced"` must sit inside
// the loop over cumulativeFields(), and instantFields() must never be near one.
const extractCode = readCodeOnly("lib/server/secExtract.ts");
const diffSites = [...extractCode.matchAll(/derived:\s*"differenced"/g)].map((m) => m.index);
const cumLoopAt = extractCode.indexOf("for (const field of cumulativeFields())");
const instLoopAt = extractCode.indexOf("for (const field of instantFields())");
check("the extractor emits `differenced` in exactly one place", diffSites.length === 1,
  `${diffSites.length} site(s)`);
check("that site is inside the cumulativeFields() loop and before the instantFields() loop",
  cumLoopAt !== -1 && instLoopAt !== -1 && diffSites.every((i) => i > cumLoopAt && i < instLoopAt),
  `differenced@${diffSites[0]} cumulative@${cumLoopAt} instant@${instLoopAt}`);
check("no subtraction appears anywhere in the instantFields() loop",
  !/\.val!?\s*-\s*/.test(extractCode.slice(instLoopAt, extractCode.indexOf("const pack", instLoopAt))),
  "the instant branch reads values, it does not combine them");

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

const multi = SEC_FIELDS.filter((f) => f.singleValued === false).map((f) => f.key);
check("exactly one field is not single-valued", multi.length === 1, multi.join(", "));
check("and it is sharesOutstandingCover", multi[0] === "sharesOutstandingCover");
check("every other field defaults to singleValued: true",
  SEC_FIELDS.filter((f) => f.key !== "sharesOutstandingCover").every((f) => f.singleValued === true),
  "the spread default survived, checked at runtime rather than read off the type");

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

// The multi-class cover page. Two values, one period, one filing, no class
// label in companyfacts -- picking one IS the BRK.B bug, so it refuses.
const multiClass = JSON.parse(JSON.stringify(facts));
multiClass.facts.dei = { EntityCommonStockSharesOutstanding: { units: { shares: [
  { end: "2026-06-30", val: 300, accn: "b", filed: "2026-07-20" },
  { end: "2026-06-30", val: 700, accn: "b", filed: "2026-07-20" },
] } } };
const out3 = extractCompanyFacts("CHK", multiClass);
const i3 = out3.instants.find((p) => p.end === "2026-06-30");
check("two share classes in one filing are reported AMBIGUOUS, not reduced to one",
  at(i3, "sharesOutstandingCover")?.derived === "ambiguous" &&
    at(i3, "sharesOutstandingCover")?.val === null,
  JSON.stringify(at(i3, "sharesOutstandingCover")));
check("and the ambiguous cell keeps both candidates",
  at(i3, "sharesOutstandingCover")?.candidates?.join() === "700,300");

// A single-class filer must NOT be dragged into the ambiguous branch.
const oneClass = JSON.parse(JSON.stringify(facts));
oneClass.facts.dei = { EntityCommonStockSharesOutstanding: { units: { shares: [
  { end: "2026-06-30", val: 700, accn: "b", filed: "2026-07-20" },
] } } };
const i4 = extractCompanyFacts("CHK", oneClass).instants.find((p) => p.end === "2026-06-30");
check("a single-class filer still resolves normally",
  at(i4, "sharesOutstandingCover")?.derived === "as-filed" &&
    at(i4, "sharesOutstandingCover")?.val === 700);

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
console.log("\n8. cash-flow reconciliation");

const cf = (op, inv, fin, net) => ({ cik: 1, facts: { "us-gaap": Object.fromEntries([
  ["NetCashProvidedByUsedInOperatingActivities", op],
  ["NetCashProvidedByUsedInInvestingActivities", inv],
  ["NetCashProvidedByUsedInFinancingActivities", fin],
  ["CashAndCashEquivalentsPeriodIncreaseDecrease", net],
].map(([k, v]) => [k, { units: { USD: [
  { start: "2026-01-01", end: "2026-03-31", val: v, accn: "a", filed: "2026-04-20" },
] } }])) } });

const good = extractCompanyFacts("OK", cf(100, -40, -30, 30));
check("a reconciling quarter reports no break",
  cashFlowReconciliation(good.quarters).length === 0);
const bad = extractCompanyFacts("NO", cf(100, -40, -30, 999));
check("a non-reconciling quarter is caught",
  cashFlowReconciliation(bad.quarters).length === 1,
  JSON.stringify(cashFlowReconciliation(bad.quarters)[0] ?? {}));
// Filers round to thousands; an exact equality would flag every one of them.
const rounded = extractCompanyFacts("RD", cf(100_000, -40_000, -30_000, 30_001));
check("rounding at the filers' own scale does not trip it",
  cashFlowReconciliation(rounded.quarters).length === 0);

console.log(failures ? `\n${failures} assertion(s) failed.\n` : "\nExtraction structure is sound.\n");
process.exit(failures ? 1 : 0);
