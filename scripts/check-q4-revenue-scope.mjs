// A DERIVED Q4 REVENUE THAT CROSSES SCOPES IS WITHHELD (#552 COWORK #196/#200).
//
// Q4 is FY − 9M. Where the year's revenue line and the quarters' line cover
// different scopes, that difference is arithmetic on unlike numbers (OXY FY2025:
// $1.66B against $5–7B quarters). The census (CODE-A #205) showed the plain
// "under 40%" flag also catches true small Q4s (milestone-driven biotechs), so
// the rule needs the filer's own second total. Pinned on companyfacts-shaped
// payloads through the REAL extractor:
//   WITHHELD  TOTAL: contract-line Q4 under 40%, `Revenues` Q4 normal (COF, CNA)
//             OXY-shaped: Q4 under 40%, no second total, and the nine months
//             it was differenced from disagree with the three quarters shown
//             FIX-shaped: a negative derived Q4
//   KEPT      LUMPY: under 40%, no second total, nine months = the quarters
//             (a real small or seasonal quarter)
//             BOTH LOW: under 40%, and the second total collapses too
//             NORMAL: a Q4 at the year's run-rate
//   STORED    the codec writes "W" and reads back "withheld", value null
//   PAGE      the view's note and the card's "Not reported" branch
// plus mutations of the pure verdict, each caught.
import fs from "node:fs";
import { lift } from "./lib/earnings-plan.mjs";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const fieldsSrc = fs.readFileSync("lib/server/secFields.ts", "utf8");
const fxSrc = fs.readFileSync("lib/server/fxRates.ts", "utf8");
const currencySrc = fs.readFileSync("lib/server/secCurrency.ts", "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const extractRaw = fs.readFileSync("lib/server/secExtract.ts", "utf8")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secFields";/, "")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secCurrency";/, "");
// The codec after them, so the stored form is the real encoder's.
const codecSrc = fs.readFileSync("lib/server/secFactCodec.ts", "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const load = (extractSrc) => lift(`${fieldsSrc}\n${fxSrc}\n${currencySrc}\n${extractSrc}\n${codecSrc}`);
const X = await load(extractRaw);
const REV = X.SEC_FIELD_KEYS.indexOf("revenue");

const M = 1e6;
const CONTRACT = "RevenueFromContractWithCustomerExcludingAssessedTax";
const row = (start, end, val, fp) => ({ start, end, val, accn: "0000000000-26-000001", fy: 2025, fp, form: fp === "FY" ? "10-K" : "10-Q", filed: "2026-02-15" });
/** FY2025 (calendar) as filed: Q1 3M, Q2 3M + 6M, Q3 3M + 9M, the year, and Q1 2026 so the year is not the newest period. */
const year = ([q1, q2, q3, fy], q1next) => [
  row("2025-01-01", "2025-03-31", q1, "Q1"),
  row("2025-04-01", "2025-06-30", q2, "Q2"), row("2025-01-01", "2025-06-30", q1 + q2, "Q2"),
  row("2025-07-01", "2025-09-30", q3, "Q3"), row("2025-01-01", "2025-09-30", q1 + q2 + q3, "Q3"),
  row("2025-01-01", "2025-12-31", fy, "FY"),
  row("2026-01-01", "2026-03-31", q1next, "Q1"),
];
const payload = (tags) => ({
  cik: 1, entityName: "Fixture",
  facts: { "us-gaap": Object.fromEntries(Object.entries(tags).map(([tag, rows]) => [tag, { units: { USD: rows } }])) },
});
const q4Of = (mod, facts) => {
  const r = mod.extractCompanyFacts("FIX", facts);
  const q = r.quarters.find((p) => p.end === "2025-12-31");
  return { cell: q?.values?.[REV] ?? null, r };
};

// OXY-shaped (CODE-A #205: Q4 $1,658M vs $5,886M mean). The contract line's
// year is narrower than its quarters; `Revenues` is the filer's own total and
// its Q4 is normal. The Q1 2026 figures agree, so the total-over-contract rule
// (#192) does not swap concepts and this rule is what decides.
// OXY's nine months (original 10-Q) against quarters restated by later
// filings: only 3M quarters, the 9M and the year, so nothing re-derives them.
const restated = ([q1, q2, q3, nine, fy], q1next) => [
  row("2025-01-01", "2025-03-31", q1, "Q1"), row("2025-04-01", "2025-06-30", q2, "Q2"),
  row("2025-07-01", "2025-09-30", q3, "Q3"), row("2025-01-01", "2025-09-30", nine, "Q3"),
  row("2025-01-01", "2025-12-31", fy, "FY"), row("2026-01-01", "2026-03-31", q1next, "Q1"),
];
const CASES = {
  OXY: { [CONTRACT]: restated([5000 * M, 5900 * M, 6100 * M, 19300 * M, 21000 * M], 5200 * M) },
  TOTAL: { [CONTRACT]: year([5500 * M, 5900 * M, 6258 * M, 19316 * M], 5600 * M), Revenues: year([5700 * M, 6100 * M, 6400 * M, 24300 * M], 5650 * M) },
  FIX: { [CONTRACT]: year([2000 * M, 2150 * M, 2306 * M, 1832 * M], 2100 * M) },
  LUMPY: { [CONTRACT]: year([10 * M, 12 * M, 11 * M, 36 * M], 9 * M) },
  BOTH_LOW: { [CONTRACT]: year([10 * M, 12 * M, 11 * M, 36 * M], 9 * M), Revenues: year([11 * M, 13 * M, 12 * M, 39 * M], 9.2 * M) },
  NORMAL: { [CONTRACT]: year([100 * M, 110 * M, 120 * M, 455 * M], 105 * M), Revenues: year([102 * M, 112 * M, 122 * M, 463 * M], 106 * M) },
};

console.log("1. the extractor: withheld where the filer's own figures prove the scope mismatch, kept otherwise");
const out = {};
for (const [sym, tags] of Object.entries(CASES)) out[sym] = q4Of(X, payload(tags));
check("TOTAL (COF/CNA-shaped): the contract-line Q4 ($1,658M) is withheld, value null",
  out.TOTAL.cell?.derived === "withheld" && out.TOTAL.cell?.val === null, JSON.stringify(out.TOTAL.cell && { val: out.TOTAL.cell.val, d: out.TOTAL.cell.derived, tag: out.TOTAL.cell.tag }));
check("...and a note says why", out.TOTAL.r.notes.some((n) => /2025-12-31.*Revenues gives.*scope mismatch/.test(n)));
check("OXY-shaped: Q4 $1,700M with nine months $19,300M against quarters summing $17,000M is withheld",
  out.OXY.cell?.derived === "withheld" && out.OXY.cell?.val === null, JSON.stringify(out.OXY.cell && { val: out.OXY.cell.val, d: out.OXY.cell.derived }));
check("...and its note names the nine months", out.OXY.r.notes.some((n) => /2025-12-31.*nine months 19300000000 differ.*17000000000/.test(n)));
check("FIX-shaped: a negative derived Q4 (−$4,624M) is withheld",
  out.FIX.cell?.derived === "withheld" && out.FIX.cell?.val === null, JSON.stringify(out.FIX.cell && { val: out.FIX.cell.val, d: out.FIX.cell.derived }));
check("LUMPY: a small Q4 with no second total stays as filed arithmetic ($3M)",
  out.LUMPY.cell?.derived === "differenced" && out.LUMPY.cell?.val === 3 * M, JSON.stringify(out.LUMPY.cell && { val: out.LUMPY.cell.val, d: out.LUMPY.cell.derived }));
check("BOTH_LOW: a small Q4 the total confirms stays ($3M)",
  out.BOTH_LOW.cell?.derived === "differenced" && out.BOTH_LOW.cell?.val === 3 * M, JSON.stringify(out.BOTH_LOW.cell && { val: out.BOTH_LOW.cell.val, d: out.BOTH_LOW.cell.derived }));
check("NORMAL: a run-rate Q4 is untouched ($125M)",
  out.NORMAL.cell?.derived === "differenced" && out.NORMAL.cell?.val === 125 * M);
check("the other quarters and the year are untouched (TOTAL Q3 $6,258M, FY $19,316M)",
  out.TOTAL.r.quarters.find((p) => p.end === "2025-09-30")?.values?.[REV]?.val === 6258 * M &&
  out.TOTAL.r.years.find((p) => p.end === "2025-12-31")?.values?.[REV]?.val === 19316 * M);

console.log("\n2. stored and read back");
{
  const set = X.encodeFactSet(out.OXY.r);
  const q = set.quarters.find((p) => p.e === "2025-12-31");
  check("the codec stores the cell as \"W\" with a null value", q?.d?.[REV] === "W" && q?.v?.[REV] === null, `${q?.d?.[REV]} ${q?.v?.[REV]}`);
  const back = X.cell(q, "revenue");
  check("the codec reads \"W\" back as withheld, value null", back.derived === "withheld" && back.val === null, JSON.stringify(back));
}

console.log("\n3. the page");
{
  const viewSrc = readCodeOnly("lib/server/secEarningsView.ts");
  const cards = readCodeOnly("app/stock/[symbol]/earnings/SecEarningsCards.tsx");
  check("derivationNote has a withheld sentence, hedged", /case "withheld":\s*return "Not shown:[^"]*suggest the annual and quarterly revenue lines cover different scopes/.test(viewSrc));
  check("CellValue renders a withheld cell as Not reported with its note on tap",
    /cell\.derived === "withheld"[\s\S]{0,80}ReasonedValue text=\{NOT_REPORTED\} reason=\{cell\.derivedNote\}/.test(cards));
}

console.log("\n4. the pure verdict, and mutations of it");
{
  const V = X.q4RevenueScope;
  check("negative", V(-1, [10, 10, 10]) === "negative");
  check("low + normal total", V(3, [10, 10, 10], { q4: 9, siblings: [10, 10, 10] }) === "scope");
  check("low, no total", V(3, [10, 10, 10]) === null);
  check("low + low total", V(3, [10, 10, 10], { q4: 3, siblings: [10, 10, 10] }) === null);
  check("at the floor exactly is kept", V(4, [10, 10, 10], { q4: 9, siblings: [10, 10, 10] }) === null);
  check("fewer than three siblings: no judgement", V(3, [10, 10], { q4: 9, siblings: [10, 10, 10] }) === null);
  check("low, nine months off the quarters by 10%", V(3, [10, 10, 10], null, 33) === "quarters");
  check("low, nine months within 2% of the quarters", V(3, [10, 10, 10], null, 30.5) === null);
  check("normal Q4, nine months off: not judged", V(9, [10, 10, 10], null, 33) === null);

  const src = extractRaw;
  const mut = async (name, from, to, probe) => {
    if (!src.includes(from)) { check(`mutant "${name}" applies`, false, "anchor moved"); return; }
    const Y = await load(src.replace(from, to));
    // A mutant that throws is caught too: the extraction would fail.
    let held; try { held = await probe(Y); } catch { held = false; }
    check(`mutant caught: ${name}`, !held);
  };
  const lumpyKept = (Y) => q4Of(Y, payload(CASES.LUMPY)).cell?.val === 3 * M;
  const bothLowKept = (Y) => q4Of(Y, payload(CASES.BOTH_LOW)).cell?.val === 3 * M;
  const fixWithheld = (Y) => q4Of(Y, payload(CASES.FIX)).cell?.derived === "withheld";
  const oxyWithheld = (Y) => q4Of(Y, payload(CASES.OXY)).cell?.derived === "withheld";
  const totalWithheld = (Y) => q4Of(Y, payload(CASES.TOTAL)).cell?.derived === "withheld";
  await mut("no second total required", 'if (total && Number.isFinite(total.q4)) {', 'if (true) { if (!total) return "scope";', lumpyKept);
  await mut("the total's own Q4 not tested", 'total.q4 >= DERIVED_Q4_FLOOR * tm) return "scope";', 'true) return "scope";', bothLowKept);
  await mut("negative check removed", 'if (q4 < 0) return "negative";', "", fixWithheld);
  await mut("the pass never writes", 'm.set("revenue", { ...q4, val: null, derived: "withheld" });', "", totalWithheld);
  await mut("the nine-month proof removed", 'if (nine != null && Number.isFinite(nine) && nine > 0 && Math.abs(nine - 3 * m) > NINE_MONTHS_TOLERANCE * nine) return "quarters";', "", oxyWithheld);
  await mut("the nine-month proof with no tolerance", "Math.abs(nine - 3 * m) > NINE_MONTHS_TOLERANCE * nine", "Math.abs(nine - 3 * m) >= 0", lumpyKept);
}

console.log(failures === 0 ? "\nq4-revenue-scope: all checks passed" : `\nq4-revenue-scope: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
