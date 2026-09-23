// EARNINGS PAGE ROUND 2 — rendered, on the filer the brief was written about.
//
//   c. AVAV tags only TOTAL equity (incl. noncontrolling interests); the
//      balance sheet shows it under that label instead of "Not reported".
//      Total liabilities is not tagged at all and says so in those words.
//   d. Interest expense and other income, where no concept this page reads is
//      tagged, say "Not found in the filing's tagged data" — not "Not
//      reported", which stays the page's word for real absences (Q4 EPS).
//   g. The trend card adds ONE hedged line when typical sits >50 points above
//      latest (AVAV: +133.3% vs +5.7%).
//
// Each rule is re-rendered from broken source to show the assertion can fail.
import fs from "node:fs";
import { loadCards, html, visibleText, React } from "./lib/render-cards.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const fixture = (sym) => JSON.parse(fs.readFileSync(`data/sec/factset-fixture-${sym}.json`, "utf8"));

const M = await loadCards();
const AVAV = fixture("AVAV");
const AAPL = fixture("AAPL");
const vAvav = M.buildSecEarningsView(AVAV);
const vAapl = M.buildSecEarningsView(AAPL);
const card = (mod, C, view) => visibleText(html(React.createElement(mod[C], { view })));
const NOT_FOUND = "Not found in the filing’s tagged data";

const underMutation = async (name, from, to, probe) => {
  let src = null;
  const mod = await loadCards((all) => { src = all; return all.replace(from, to); });
  if (!src.includes(from)) { check(`mutation "${name}" could not be applied`, false, from.slice(0, 70)); return; }
  let holds;
  try { holds = probe(mod); } catch { holds = false; }
  check(`MUTATION "${name}" breaks the assertion`, !holds,
    holds ? "the property still held with the rule removed — the assertion proves nothing" : "");
};

console.log("\nc. the balance sheet on AVAV");
{
  const t = card(M, "SecBalanceSheetCard", vAvav);
  check("total equity is shown under its own label, with the filed figure",
    /Total equity \(incl\. noncontrolling interests\).*\$4\.40B/.test(t) && !/Shareholders' equity/.test(t), t.slice(-420));
  check("total liabilities says the tags do not carry it",
    new RegExp(`Total liabilities ${NOT_FOUND}`).test(t));
  check("a filer with the parent-only figure keeps the plain label (AAPL)",
    /Shareholders' equity/.test(card(M, "SecBalanceSheetCard", vAapl)) &&
      !/incl\. noncontrolling/.test(card(M, "SecBalanceSheetCard", vAapl)));
  await underMutation("fallback to total equity removed",
    "const useTotal = parent.val === null && total.val !== null;", "const useTotal = false;",
    (mod) => /\$4\.40B/.test(card(mod, "SecBalanceSheetCard", mod.buildSecEarningsView(AVAV))));
}

console.log("\nd. the income statement on AVAV (fixture predates any chain change)");
{
  const t = card(M, "SecIncomeStatementCard", vAvav);
  check("interest expense and other income say where the gap is",
    new RegExp(`Interest expense ${NOT_FOUND}`).test(t) && new RegExp(`Other income / expense ${NOT_FOUND}`).test(t), t);
  check("other absent lines keep 'Not reported' (the shared word is unchanged)",
    /Other operating expense Not reported/.test(t) && /Less: noncontrolling interest Not reported/.test(t));
  await underMutation("tag-gap copy dropped from the income statement",
    "TAG_GAP_LINES.has(c.key) ? NOT_IN_TAGGED_DATA : NOT_REPORTED", "NOT_REPORTED",
    (mod) => card(mod, "SecIncomeStatementCard", mod.buildSecEarningsView(AVAV)).includes(`Interest expense ${NOT_FOUND}`));
}

console.log("\ng. the trend card's skew line");
{
  const LINE = "The typical figure is lifted by a run of unusually large quarters; the latest may be the better guide to the current pace.";
  const t = card(M, "SecTrendSummaryCard", vAvav);
  check("AVAV (+133.3% typical, +5.7% latest) carries exactly one hedged line",
    t.split(LINE).length === 2, t);
  check("AAPL does not", !card(M, "SecTrendSummaryCard", vAapl).includes("unusually large"));
  await underMutation("skew line not rendered",
    "{t.skewNote ? <p className=\"earningsDataNote\">{t.skewNote}</p> : null}", "",
    (mod) => card(mod, "SecTrendSummaryCard", mod.buildSecEarningsView(AVAV)).includes(LINE));
}

console.log(failures ? `\n${failures} assertion(s) failed.\n` : "\nRound 2 holds.\n");
process.exit(failures ? 1 : 0);
