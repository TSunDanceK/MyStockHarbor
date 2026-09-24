// THE FISCAL YEAR-END ANCHOR (#552 COWORK #30, QXO): a duration ending after
// its own filing date is not that filing's period. QXO's FY2023 10-K tagged
// an OperatingLeaseExpense row for 2025-05-01..2026-04-30; as the accession's
// latest end it became the "year end", every quarter was labelled off 30
// April and every December year was filtered out.
//
//   1. On a QXO-shaped payload through the shipped fiscalYearOffset and
//      extractor: the anchor is the 10-K's own 31 December, the years are
//      kept and the June quarter is Q2. MUTATION: the guard removed → the
//      30 April anchor, no years, June labelled Q1.
//   2. A row ending ON its filing date is still admitted (the guard is
//      strictly "after").
//
//   node scripts/check-sec-fy-anchor.mjs
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const EXTRACT = strip("lib/server/secExtract.ts");
const GUARD = "if (r.filed && r.end > r.filed) continue;";
if (EXTRACT.split(GUARD).length !== 2) throw new Error("guard anchor not found exactly once");
const load = (x) => lift([readCodeOnly("lib/server/secFields.ts"), x, strip("lib/server/fxRates.ts"), strip("lib/server/secCurrency.ts"),
  "export { extractCompanyFacts, fiscalYearOffset };"].join("\n"));

const r = (start, end, val, form, fy, fp, accn, filed) => ({ start, end, val, form, fy, fp, accn, filed });
const K23 = "0001185185-24-000237", K24 = "0001628280-25-009626", K25 = "0001628280-26-012601";
const Q = (y, q) => `q-${y}-${q}`;
const ni = [
  r("2023-01-01", "2023-12-31", 10, "10-K", 2023, "FY", K23, "2024-03-14"),
  r("2024-01-01", "2024-12-31", 12, "10-K", 2024, "FY", K24, "2025-03-04"),
  r("2025-01-01", "2025-12-31", 14, "10-K", 2025, "FY", K25, "2026-02-27"),
  r("2025-01-01", "2025-03-31", 3, "10-Q", 2025, "Q1", Q(2025, 1), "2025-05-01"),
  r("2025-04-01", "2025-06-30", 3, "10-Q", 2025, "Q2", Q(2025, 2), "2025-08-01"),
  r("2025-07-01", "2025-09-30", 4, "10-Q", 2025, "Q3", Q(2025, 3), "2025-11-01"),
  r("2026-01-01", "2026-03-31", 4, "10-Q", 2026, "Q1", Q(2026, 1), "2026-05-01"),
  r("2026-04-01", "2026-06-30", 5, "10-Q", 2026, "Q2", Q(2026, 2), "2026-08-01"),
];
const facts = (futureEnd) => ({ cik: 1236275, facts: { "us-gaap": {
  NetIncomeLoss: { units: { USD: ni } },
  // THE MIS-TAGGED ROW, in the FY2023 10-K, ending after that filing.
  OperatingLeaseExpense: { units: { USD: [r("2025-05-01", futureEnd, 1, "10-K", 2023, "FY", K23, "2024-03-14")] } },
} } });
const shape = (x) => ({ years: x.years.length, june: x.quarters.find((p) => p.end === "2026-06-30")?.fp ?? null });

const M = await load(EXTRACT);
console.log("1. a row ending after its filing is not the filing's period");
{
  const n = M.fiscalYearOffset(facts("2026-04-30"), null);
  const s = shape(M.extractCompanyFacts("QXO", facts("2026-04-30")));
  check("anchor = the newest 10-K's own 31 December", n.yearEnd === "2025-12-31", JSON.stringify(n));
  check("years kept, June 2026 is Q2", s.years >= 3 && s.june === "Q2", JSON.stringify(s));
  const Mm = await load(EXTRACT.replace(GUARD, ""));
  const nm = Mm.fiscalYearOffset(facts("2026-04-30"), null);
  const sm = shape(Mm.extractCompanyFacts("QXO", facts("2026-04-30")));
  check("MUTATION: guard removed → the 30 April anchor, no years, June labelled Q1 (QXO as stored)",
    nm.yearEnd === "2026-04-30" && sm.years === 0 && sm.june === "Q1", `${JSON.stringify(nm)} ${JSON.stringify(sm)}`);
}
console.log("\n2. a row ending ON its filing date still counts");
{
  const onFiling = { cik: 1, facts: { "us-gaap": { NetIncomeLoss: { units: { USD: [r("2025-03-15", "2026-03-14", 1, "10-K", 2025, "FY", "x", "2026-03-14")] } } } } };
  check("end === filed is admitted", M.fiscalYearOffset(onFiling, null).yearEnd === "2026-03-14");
}
console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
