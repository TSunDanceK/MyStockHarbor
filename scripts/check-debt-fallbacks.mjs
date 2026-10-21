// TOTAL DEBT FROM THE FILERS' OWN COMBINED CONCEPTS (audit r3: CVX, TRV, O, HIMS).
//
// Pinned on each filer's newest balance sheet as filed: the new chain entries
// resolve, a combined long-term figure is netted against the short-term line
// it contains (so short + long = the filer's own total), and a disjoint
// short-term line is added as filed. A mutation that drops the netting is
// caught by TRV's double count.
import fs from "node:fs";
import { lift } from "./lib/earnings-plan.mjs";

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
const load = (src) => lift(`${fieldsSrc}\n${fxSrc}\n${currencySrc}\n${src}`);
const X = await load(extractRaw);
const LT = X.SEC_FIELD_KEYS.indexOf("longTermDebt"), ST = X.SEC_FIELD_KEYS.indexOf("shortTermDebt");
const M = 1e6;
const inst = (end, v, form, filed, accn) => ({ end, val: v * M, form, fy: 2026, fp: "Q2", filed, accn });
const facts = (tags) => ({ cik: 1, entityName: "Fixture", facts: { "us-gaap": Object.fromEntries(Object.entries(tags).map(([t, rows]) => [t, { units: { USD: rows } }])) } });
const at = (ex, end) => ex.instants.find((p) => p.end === end);
const total = (ex, end) => { const p = at(ex, end); const l = p?.values?.[LT]?.val ?? null, s = p?.values?.[ST]?.val ?? null; return l === null ? null : (s ?? 0) + l; };
const near = (a, b) => a !== null && Math.abs(a - b * M) < 1;

console.log("1. the four filers");
const CVX = facts({
  LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities: [inst("2026-06-30", 36674, "10-Q", "2026-08-06", "cvx-q2")],
  ShortTermBorrowings: [inst("2026-06-30", 401, "10-Q", "2026-08-06", "cvx-q2")],
});
check("CVX: 36,674 (incl. current maturities) + 401 short-term borrowings = 37,075", near(total(X.extractCompanyFacts("CVX", CVX), "2026-06-30"), 37075), String(total(X.extractCompanyFacts("CVX", CVX), "2026-06-30")));
const TRV = facts({
  DebtLongtermAndShorttermCombinedAmount: [inst("2025-12-31", 9267, "10-K", "2026-02-12", "trv-k")],
  DebtCurrent: [inst("2025-12-31", 300, "10-K", "2026-02-12", "trv-k")],
});
const t = X.extractCompanyFacts("TRV", TRV);
check("TRV: the combined 9,267 is the total (its 300 current is inside it, not added)", near(total(t, "2025-12-31"), 9267), String(total(t, "2025-12-31")));
check("...long-term reads 8,967, computed", near(at(t, "2025-12-31")?.values?.[LT]?.val ?? null, 8967) && at(t, "2025-12-31")?.values?.[LT]?.derived === "computed");
const TRVQ = facts({ DebtLongtermAndShorttermCombinedAmount: [inst("2026-09-30", 9813, "10-Q", "2026-10-16", "trv-q3")], Assets: [inst("2026-09-30", 140000, "10-Q", "2026-10-16", "trv-q3")] });
check("TRV's 10-Q: 9,813 with no short-term line", near(total(X.extractCompanyFacts("TRV", TRVQ), "2026-09-30"), 9813));
const O = facts({
  NotesPayable: [inst("2026-06-30", 25091.6, "10-Q", "2026-08-06", "o-q2")],
  CommercialPaper: [inst("2026-06-30", 1400, "10-Q", "2026-08-06", "o-q2")],
  Assets: [inst("2026-06-30", 69000, "10-Q", "2026-08-06", "o-q2")],
});
check("O: notes 25,091.6 + commercial paper 1,400 = 26,491.6", near(total(X.extractCompanyFacts("O", O), "2026-06-30"), 26491.6), String(total(X.extractCompanyFacts("O", O), "2026-06-30")));
const HIMS = facts({ ConvertibleDebtNoncurrent: [inst("2026-06-30", 1365.3, "10-Q", "2026-08-10", "hims-q2")], Assets: [inst("2026-06-30", 2900, "10-Q", "2026-08-10", "hims-q2")] });
check("HIMS: convertible notes 1,365.3", near(total(X.extractCompanyFacts("HIMS", HIMS), "2026-06-30"), 1365.3));

console.log("\n2. what must stay");
const PLAIN = facts({ LongTermDebtNoncurrent: [inst("2026-06-30", 5000, "10-Q", "2026-08-01", "p")], LongTermDebtCurrent: [inst("2026-06-30", 500, "10-Q", "2026-08-01", "p")] });
check("an ordinary noncurrent + current filer adds as filed (5,500)", near(total(X.extractCompanyFacts("PLN", PLAIN), "2026-06-30"), 5500));
const BOTH = facts({ LongTermDebtNoncurrent: [inst("2026-06-30", 5000, "10-Q", "2026-08-01", "b")], DebtLongtermAndShorttermCombinedAmount: [inst("2026-06-30", 5600, "10-Q", "2026-08-01", "b")] });
check("a filer with a noncurrent line keeps it over the combined fallback", near(at(X.extractCompanyFacts("BTH", BOTH), "2026-06-30")?.values?.[LT]?.val ?? null, 5000));

const ODD = facts({
  Assets: [inst("2025-12-31", 100, "10-K", "2026-03-01", "k")],
  ConvertibleDebtNoncurrent: [inst("2025-12-31", 10, "10-K", "2026-03-01", "k"), inst("2026-01-16", 12, "8-K", "2026-01-20", "e")],
});
const odd = X.extractCompanyFacts("ODD", ODD);
check("a date only a fallback filed (ONDS 2026-01-16) opens no balance-sheet column", !at(odd, "2026-01-16") && near(at(odd, "2025-12-31")?.values?.[LT]?.val ?? null, 10));

const ZTS = facts({
  Assets: [inst("2025-06-30", 14000, "10-Q", "2025-08-05", "z1"), inst("2026-06-30", 15000, "10-Q", "2026-08-05", "z2")],
  ShortTermBorrowings: [inst("2025-06-30", 1350, "10-Q", "2025-08-05", "z1")],
  CommercialPaper: [inst("2025-06-30", 0, "10-Q", "2025-08-05", "z1"), inst("2026-06-30", 0, "10-Q", "2026-08-05", "z2")],
});
const z = X.extractCompanyFacts("ZTS", ZTS);
check("ZTS: a fallback on the newest period does not displace the filed 1,350 borrowings", near(at(z, "2025-06-30")?.values?.[ST]?.val ?? null, 1350), String(at(z, "2025-06-30")?.values?.[ST]?.val));
check("...and, filing a primary line, takes no fallback on the date it misses", at(z, "2026-06-30")?.values?.[ST]?.val == null);
const CVXB = facts({
  Assets: [inst("2025-12-31", 250000, "10-K", "2026-02-20", "ck"), inst("2026-06-30", 255000, "10-Q", "2026-08-06", "cq")],
  LongTermDebtAndCapitalLeaseObligations: [inst("2025-12-31", 20135, "10-K", "2026-02-20", "ck")],
  LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities: [inst("2025-12-31", 24541, "10-K", "2026-02-20", "ck"), inst("2026-06-30", 36674, "10-Q", "2026-08-06", "cq")],
});
check("CVX: on a date both are filed, the primary noncurrent figure wins (20,135)", near(at(X.extractCompanyFacts("CVX", CVXB), "2025-12-31")?.values?.[LT]?.val ?? null, 20135));

const AAT = facts({
  Assets: [inst("2025-12-31", 3000, "10-K", "2026-02-10", "a1"), inst("2026-03-31", 3000, "10-Q", "2026-05-01", "a2")],
  LongTermDebt: [inst("2025-12-31", 1700, "10-K", "2026-02-10", "a1")],
  NotesPayable: [inst("2025-12-31", 75, "10-K", "2026-02-10", "a1"), inst("2026-03-31", 75, "10-Q", "2026-05-01", "a2")],
});
const aat = X.extractCompanyFacts("AAT", AAT);
check("AAT: a filer with a primary long-term line never reads a fallback (Q1 stays empty, not 75)", at(aat, "2026-03-31")?.values?.[LT]?.val == null && near(at(aat, "2025-12-31")?.values?.[LT]?.val ?? null, 1700));
const CVXK = facts({
  Assets: [inst("2025-12-31", 250000, "10-K", "2026-02-20", "ck"), inst("2026-06-30", 255000, "10-Q", "2026-08-06", "cq")],
  LongTermDebtAndCapitalLeaseObligations: [inst("2025-12-31", 20135, "10-K", "2026-02-20", "ck")],
  LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities: [inst("2026-06-30", 36674, "10-Q", "2026-08-06", "cq")],
});
check("CVX: the same figure tagged the other way still fills its 10-Q date", near(at(X.extractCompanyFacts("CVX", CVXK), "2026-06-30")?.values?.[LT]?.val ?? null, 36674));

console.log("\n3. mutation");
{
  const a = extractRaw.replace("if (inside !== \"all\" && !inside.includes(st.tag)) continue;", "continue;");
  check("the mutation is applied", a !== extractRaw);
  check("MUTATION: netting off → TRV double-counts its 300 (9,567), caught", near(total((await load(a)).extractCompanyFacts("TRV", TRV), "2025-12-31"), 9567));
}
{
  const a = extractRaw.replace("instantCells.delete(end);", "");
  check("the second mutation is applied", a !== extractRaw);
  check("MUTATION: fallback-only dates kept → ODD's 2026-01-16 column appears, caught", !!at((await load(a)).extractCompanyFacts("ODD", ODD), "2026-01-16"));
}
{
  const a = extractRaw.replace("return primary.length ? primary : cands;", "return cands;");
  check("the third mutation is applied", a !== extractRaw);
  check("MUTATION: fallbacks compete with primaries → CVX's 10-K reads the newer concept's 24,541, caught", near((await load(a)).extractCompanyFacts("CVX", CVXB).instants.find((p) => p.end === "2025-12-31")?.values?.[LT]?.val ?? null, 24541));
}
{
  const a = extractRaw.replace("if (!primaryTags.size) return rows;", "return rows;");
  check("the fourth mutation is applied", a !== extractRaw);
  check("MUTATION: filer-level gate off → AAT's Q1 reads 75, caught", near((await load(a)).extractCompanyFacts("AAT", AAT).instants.find((p) => p.end === "2026-03-31")?.values?.[LT]?.val ?? null, 75));
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
