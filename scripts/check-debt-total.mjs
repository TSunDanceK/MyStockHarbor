// TOTAL DEBT ONLY WITH A LONG-TERM LINE (#552 COWORK #192 ruling B).
//
// ORCL's newest balance sheet carries its current notes and no undimensioned
// long-term line; the old "whichever exists" sum read "Total debt $7.6B"
// against roughly $130B. Pinned on AAPL's fixture:
//   BOTH LINES   total = short + long, no short-only line
//   SHORT ONLY   (long-term removed from every instant) total withheld, the
//                card names the missing long-term line and shows the current
//                line as "Short-term debt"
// plus a mutation: the old sum restored, and the short-only total reappears.
import fs from "node:fs";
import { loadCards, html, visibleText, React } from "./lib/render-cards.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const AAPL = JSON.parse(fs.readFileSync("data/sec/factset-fixture-AAPL.json", "utf8"));
const NEW = "const totalDebt = ltd === null ? null : (std ?? 0) + ltd;";
const OLD = "const totalDebt = std === null && ltd === null ? null : (std ?? 0) + (ltd ?? 0);";

async function run(M) {
  const { SEC_FIELD_INDEX } = M;
  const LTD = SEC_FIELD_INDEX.longTermDebt, STD = SEC_FIELD_INDEX.shortTermDebt;
  const shortOnly = structuredClone(AAPL);
  for (const p of shortOnly.instants) { if (p.v[LTD] != null) p.v[LTD] = null; }
  const both = M.buildSecEarningsView(AAPL).balance;
  const only = M.buildSecEarningsView(shortOnly).balance;
  const inst = shortOnly.instants.find((p) => p.e === only.asOf);
  return { both, only, std: inst?.v?.[STD] ?? null, card: visibleText(html(React.createElement(M.SecBalanceSheetCard, { view: M.buildSecEarningsView(shortOnly) }))) };
}

const M = await loadCards();
if (!M.SEC_FIELD_INDEX) M.SEC_FIELD_INDEX = (await import("../lib/server/secFields.ts")).SEC_FIELD_INDEX;
const r = await run(M);
console.log("1. both lines on the balance sheet");
check("total = short + long, and no short-only line", typeof r.both.totalDebt === "number" && r.both.totalDebt > 0 && r.both.shortTermDebtOnly === null, JSON.stringify({ t: r.both.totalDebt, s: r.both.shortTermDebtOnly }));

console.log("\n2. a current line alone (ORCL's shape)");
check("the fixture has a current line to show", typeof r.std === "number" && r.std > 0, String(r.std));
check("total debt is withheld, naming the missing long-term line", r.only.totalDebt === null && /long-term debt/.test(r.only.totalDebtMissing ?? ""), JSON.stringify({ t: r.only.totalDebt, m: r.only.totalDebtMissing }));
check("net cash is withheld with it", r.only.netCash === null);
check("the current line travels as shortTermDebtOnly", r.only.shortTermDebtOnly === r.std);
check("the card says 'Short-term debt', never a total built from it", /Short-term debt/.test(r.card) && !/Total debt \$/.test(r.card), r.card.slice(0, 200));

console.log("\n3. mutation");
{
  const src = fs.readFileSync("lib/server/secEarningsView.ts", "utf8");
  check("the anchor is present once", src.split(NEW).length === 2);
  const MM = await loadCards((s) => s.replace(NEW, OLD));
  if (!MM.SEC_FIELD_INDEX) MM.SEC_FIELD_INDEX = M.SEC_FIELD_INDEX;
  const m = await run(MM);
  check("MUTATION: the old sum reads the current line as the total (caught)", m.only.totalDebt === r.std, String(m.only.totalDebt));
}

if (failures) { console.log(`\n${failures} assertion(s) failed.`); process.exit(1); }
console.log("\nALL CHECKS PASSED");
