// AUDIT R3 LOW-PRIORITY ITEMS: LIN's share-based pay and CVX's revenue basis.
//
// LIN files its share-based pay only as AllocatedShareBasedCompensationExpense
// (the note line), so the cash-flow chain read "Not reported"; it is now the
// last fallback, and a filer that files the add-back keeps it. CVX's revenue
// line is "Sales and other operating revenues", which the page now says on the
// income statement's revenue row and in the five-year card.
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
const load = (fields) => lift(`${fields}\n${fxSrc}\n${currencySrc}\n${extractRaw}`);
const X = await load(fieldsSrc);
const SBC = X.SEC_FIELD_KEYS.indexOf("shareBasedCompensation");
const M = 1e6;
const dur = (start, end, v) => ({ start, end, val: v * M, form: "10-K", fy: 2025, fp: "FY", filed: "2026-02-20", accn: "k", frame: "CY2025" });
const facts = (tags) => ({ cik: 1, entityName: "Fixture", facts: { "us-gaap": Object.fromEntries(Object.entries(tags).map(([t, rows]) => [t, { units: { USD: rows } }])) } });
const fy = (ex) => ex.years.find((p) => p.end === "2025-12-31")?.values?.[SBC]?.val ?? null;
const base = { Revenues: [dur("2025-01-01", "2025-12-31", 33000)], NetIncomeLoss: [dur("2025-01-01", "2025-12-31", 6800)] };

console.log("1. share-based pay");
const LIN = facts({ ...base, AllocatedShareBasedCompensationExpense: [dur("2025-01-01", "2025-12-31", 164)] });
check("LIN: the note line 164M is read when no add-back is filed", fy(X.extractCompanyFacts("LIN", LIN)) === 164 * M, String(fy(X.extractCompanyFacts("LIN", LIN))));
const BOTH = facts({ ...base, ShareBasedCompensation: [dur("2025-01-01", "2025-12-31", 170)], AllocatedShareBasedCompensationExpense: [dur("2025-01-01", "2025-12-31", 164)] });
check("a filer with the cash-flow add-back keeps it (170M)", fy(X.extractCompanyFacts("BTH", BOTH)) === 170 * M);
const MIXED = facts({
  ...base,
  ShareBasedCompensation: [dur("2024-01-01", "2024-12-31", 150)],
  AllocatedShareBasedCompensationExpense: [dur("2025-01-01", "2025-12-31", 164)],
});
const OLDLIN = facts({
  ...base,
  ShareBasedCompensation: [dur("2022-01-01", "2022-12-31", 120)],
  AllocatedShareBasedCompensationExpense: [dur("2022-01-01", "2022-12-31", 118), dur("2025-01-01", "2025-12-31", 164)],
});
const ol = X.extractCompanyFacts("LIN", OLDLIN);
const fyOf = (ex, end) => ex.years.find((p) => p.end === end)?.values?.[SBC]?.val ?? null;
check("LIN: switched concepts after 2022, so FY2025 reads the note line (164M)", fyOf(ol, "2025-12-31") === 164 * M);
check("...and FY2022 keeps the add-back it filed (120M, not the note line's 118M)", fyOf(ol, "2022-12-31") === 120 * M);
check("a filer that files the add-back in current history never reads the note line (FY2025 stays empty)", fy(X.extractCompanyFacts("MIX", MIXED)) === null);
{
  const mut = extractRaw.replace("if (!newestFallback || (newestFallback <= yearAfter && !annualAfter)) return primary;", "");
  check("the filer-level mutation is applied", mut !== extractRaw);
  const Y = await lift(`${fieldsSrc}\n${fxSrc}\n${currencySrc}\n${mut}`);
  check("MUTATION: per-period fallback → MIX FY2025 reads 164M, caught", fy(Y.extractCompanyFacts("MIX", MIXED)) === 164 * M);
}
{
  const mut = fieldsSrc.replace('"ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"', '"ShareBasedCompensation"');
  check("the mutation is applied", mut !== fieldsSrc);
  check("MUTATION: fallback dropped → LIN reads nothing, caught", fy((await load(mut)).extractCompanyFacts("LIN", LIN)) === null);
}

console.log("\n2. CVX revenue basis");
const viewSrc = fs.readFileSync("lib/server/secEarningsView.ts", "utf8");
const cardsSrc = fs.readFileSync("app/stock/[symbol]/earnings/SecEarningsCards.tsx", "utf8");
check("REVENUE_BASIS_NOTES names CVX's line", /CVX: "Sales and other operating revenues, excluding other income"/.test(viewSrc));
check("the income statement's revenue row carries it as its sub-line", /c\.key === "revenue" && revenueBasis \? \{ \.\.\.c, sub: revenueBasis \}/.test(viewSrc));
check("the view exposes it", /revenueBasis,\n/.test(viewSrc) && /revenueBasis: string \| null;/.test(viewSrc));
check("the five-year card says it", /view\.revenueBasis \? <> Revenue: /.test(cardsSrc));

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
