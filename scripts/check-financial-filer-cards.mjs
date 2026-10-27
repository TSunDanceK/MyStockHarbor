// A BANK'S OR INSURER'S CASH AND BALANCE CARDS (audit r3: WFC, PNC, CB, RY).
//
// With `financial`, the balance-sheet card drops its "net debt / net cash"
// lead and chart, and the cash card drops its cash-versus-profit lead, the
// operating-cash-flow share of net income (RY's 271%) and the conversion
// chart; each says why in one note. Without it, both cards are unchanged.
// Pinned on AAPL's fixture, which shows every one of those lines, plus a
// mutation per card. The flag's source is checked too: the earnings page
// passes isBankOrInsurer(sicProfileFor(symbol).industry) to both cards.
import fs from "node:fs";
import { loadCards, html, visibleText, React } from "./lib/render-cards.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const el = React.createElement;
const M = await loadCards();
const view = M.buildSecEarningsView(JSON.parse(fs.readFileSync("data/sec/factset-fixture-AAPL.json", "utf8")));
const text = (node) => visibleText(html(node));

console.log("1. an ordinary filer is unchanged");
const cash0 = text(el(M.SecCashQualityCard, { view })), bal0 = text(el(M.SecBalanceSheetCard, { view }));
check("the cash card leads with cash against profit", /reported profit/.test(cash0), cash0.slice(0, 200));
check("the balance card leads with net cash or net debt", /net (cash|debt) of/.test(bal0));
check("no financial-filer note", !cash0.includes(M.FINANCIAL_FILER_NOTE) && !bal0.includes(M.FINANCIAL_FILER_NOTE));

console.log("\n2. a bank or insurer");
const cashF = text(el(M.SecCashQualityCard, { view, financial: true })), balF = text(el(M.SecBalanceSheetCard, { view, financial: true }));
check("no cash-versus-profit lead", !/reported profit/.test(cashF));
check("the operating-cash-flow share reads not meaningful", /not meaningful for a bank or insurer/.test(cashF));
check("no conversion chart", !html(el(M.SecCashQualityCard, { view, financial: true })).includes("data-conversion-chart"));
check("no net-cash / net-debt lead", !/net (cash|debt) of/.test(balF), balF.slice(0, 300));
check("no cash-against-debt chart", !html(el(M.SecBalanceSheetCard, { view, financial: true })).includes("data-balance-chart"));
check("both cards say why", cashF.includes(M.FINANCIAL_FILER_NOTE) && balF.includes(M.FINANCIAL_FILER_NOTE));

console.log("\n3. the page passes the flag to both cards");
const page = fs.readFileSync("app/stock/[symbol]/earnings/page.tsx", "utf8");
check("computed from isBankOrInsurer(sicProfileFor(...).industry)", /isBankOrInsurer\(sicProfileFor\(clean\)\?\.industry\)/.test(page));
check("passed to SecCashQualityCard and SecBalanceSheetCard",
  /<SecCashQualityCard view=\{secView\} financial=\{financialFiler\} \/>/.test(page) && /<SecBalanceSheetCard view=\{secView\} financial=\{financialFiler\} \/>/.test(page));

console.log("\n4. mutations");
{
  const A = "const lead = financial ? null : cashLead(ocf, ni);", B = "const pos = financial ? null : netPosition(b.netCash);";
  const src = fs.readFileSync("app/stock/[symbol]/earnings/SecEarningsCards.tsx", "utf8");
  check("both mutation anchors are in the shipped card source", src.includes(A) && src.includes(B));
  const Ma = await loadCards((u) => u.replace(A, "const lead = cashLead(ocf, ni);"));
  check("MUTATION: cash lead kept → caught", /reported profit/.test(text(el(Ma.SecCashQualityCard, { view, financial: true }))));
  const Mb = await loadCards((u) => u.replace(B, "const pos = netPosition(b.netCash);"));
  check("MUTATION: net-debt lead kept → caught", /net (cash|debt) of/.test(text(el(Mb.SecBalanceSheetCard, { view, financial: true }))));
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
