// FUNDS AND CENSUS-NAMED NOTES: SHOWN AS WHAT THEY ARE, NEVER COLD-FILLED
// (#552 COWORK #151).
//
// The SEC seed gate (lib/server/secSeedGate.ts) refuses funds and trusts (SPY,
// GLD, IBIT) and the notes the listing census names (SOMN), but the stock
// page's cold path asked only the extraction gate, which admits them. So with
// their stored sets deleted their pages would read "not yet read", go noindex,
// and the first visit would cold-fill the same set back. Pinned here, RUN on
// the shipped secColdFetch with no Redis (offline):
//   1. SPY, GLD and IBIT resolve to not-shown/fund; SOMN to not-shown/security
//      naming its issuer (SO); none is ever cold-filled (not-eligible);
//   2. STRK (a derivative) keeps its own not-issuer-equity card; AAPL is
//      untouched (pending, and refused only for the missing User-Agent);
//   3. a fund is never "awaiting" a read, so its pages stay indexable — also
//      in the sitemap's bulk test and the queue;
//   4. the card's words, the scorer's sentence (the stock page's tile) and
//      the earnings page's branch.
// A mutation for each.
//
//   node scripts/check-sec-not-shown.mjs
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { loadCards, html, visibleText, React } from "./lib/render-cards.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (from, to) => (src) => {
  if (src.split(from).length !== 2) throw new Error(`mutation anchor must match once: ${from.slice(0, 60)}`);
  return src.replace(from, to);
};

const FILE = "lib/server/secColdFetch.ts";
const RAW = fs.readFileSync(FILE, "utf8");
async function load(mutate = (s) => s) {
  const src = mutate(RAW);
  if (src === RAW) return import(`../${FILE}`);
  const tmp = `lib/server/.check-not-shown-${process.pid}-${Math.random().toString(36).slice(2)}.ts`;
  fs.writeFileSync(tmp, src);
  try { return await import(`../${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
}

const RULES = {
  "SPY, GLD and IBIT are not-shown funds": async (C) => {
    for (const s of ["SPY", "GLD", "IBIT"]) {
      const r = await C.resolveFactSetForRender(s);
      if (r.status !== "not-shown" || r.kind !== "fund") return false;
    }
    return true;
  },
  "SOMN is a not-shown security, pointing at its issuer (SO)": async (C) => {
    const r = await C.resolveFactSetForRender("SOMN");
    return r.status === "not-shown" && r.kind === "security" && r.primary === "SO";
  },
  "none of them is ever cold-filled": async (C) => {
    for (const s of ["SPY", "GLD", "IBIT", "SOMN"]) if ((await C.fillColdSymbol(s)) !== "not-eligible") return false;
    return true;
  },
  "STRK keeps its own derivative card; AAPL is untouched": async (C) => {
    const strk = await C.resolveFactSetForRender("STRK");
    const aapl = await C.resolveFactSetForRender("AAPL");
    return strk.status === "not-issuer-equity" && strk.reason === "derivative-of-issuer"
      && aapl.status === "pending" && (await C.fillColdSymbol("AAPL")) === "unavailable";
  },
  "a fund is never awaiting a read (indexable), in the page test, the sitemap's and the queue": async (_C, src) =>
    /if \(!cik \|\| !admitSymbolForExtraction\(clean, cik\)\.admit \|\| secSeedRefusal\(clean, cik\)\) return false;\s*return \(await factSetExists\(clean\)\) === false;/.test(src)
    && /Boolean\(cik && admitSymbolForExtraction\(s, cik\)\.admit && !secSeedRefusal\(s, cik\)\) && presence\.exists\.get\(s\) === false/.test(src)
    && /if \(!cik \|\| !admitSymbolForExtraction\(clean, cik\)\.admit \|\| secSeedRefusal\(clean, cik\)\) return false;\s*if \(\(await factSetExists\(clean\)\) !== false\) return false;/.test(src),
};

const C0 = await load();
const SRC0 = readCodeOnly(FILE);
console.log("1–3. the cold path");
for (const [name, rule] of Object.entries(RULES)) {
  let ok = false; try { ok = Boolean(await rule(C0, SRC0)); } catch (e) { console.log(`    ${e?.message ?? e}`); }
  check(name, ok);
}

console.log("\n4. the words and the page");
const M = await loadCards();
const fund = visibleText(html(React.createElement(M.SecNotShownCard, { symbol: "SPY", kind: "fund", primary: null })));
const sec = html(React.createElement(M.SecNotShownCard, { symbol: "SOMN", kind: "security", primary: "SO" }));
const WORDS = {
  fund: "SEC filing figures aren't shown for funds and trusts. Their filings describe the fund, not a company's earnings.",
  security: "SEC filing figures aren't shown for this security. Its filings describe the issuer, not this security.",
};
check("the fund card says what it is, in the ruled words, and links to the stock page",
  fund.includes("SPY is a fund or trust") && fund.includes(WORDS.fund) && /stock page/.test(fund) && !/not yet read|being prepared/i.test(fund));
check("the security card's words, and a link to the issuer's results",
  visibleText(sec).includes(WORDS.security) && /href="\/stock\/SO\/earnings"/.test(sec));
const score = readCodeOnly("lib/server/secEarningsScore.ts");
check("the stock page's tile says the same (the scorer's sentence equals the card's)",
  score.includes(`"${WORDS.fund}"`) && score.includes(`"${WORDS.security}"`) && /if \(cold\.status === "not-shown"\)/.test(score));
const page = readCodeOnly("app/stock/[symbol]/earnings/page.tsx");
check("the earnings page draws the card for not-shown, ahead of the derivative card",
  /data\.cold\.status === "not-shown" \? \(\s*<SecNotShownCard symbol=\{clean\} kind=\{data\.cold\.kind\} primary=\{data\.cold\.primary\} \/>/.test(page)
  && page.indexOf('data.cold.status === "not-shown"') < page.indexOf('data.cold.status === "not-issuer-equity"'));

console.log("\nmutants: each must break a rule");
const MUTANTS = [
  ["funds resolve as before (pending)", once('if (seed === "etf") return { status: "not-shown", kind: "fund", primary: null };', "")],
  ["the census notes resolve as before", once('if (seed) return { status: "not-shown", kind: "security", primary: nonEquityListingOf(clean)?.primary ?? null };', "")],
  ["a fund cold-filled again", once("if (secSeedRefusal(clean, cik)) return \"not-eligible\";", "")],
  ["a fund awaiting a read again (noindex)", once("if (!cik || !admitSymbolForExtraction(clean, cik).admit || secSeedRefusal(clean, cik)) return false;\n  return (await factSetExists(clean)) === false;", "if (!cik || !admitSymbolForExtraction(clean, cik).admit) return false;\n  return (await factSetExists(clean)) === false;")],
  ["the sitemap counting funds as awaiting", once("admitSymbolForExtraction(s, cik).admit && !secSeedRefusal(s, cik))", "admitSymbolForExtraction(s, cik).admit)")],
  ["the new check placed before the derivative test (STRK loses its card)", (s) => {
    const block = s.slice(s.indexOf("  // 1c. THE SEC SEED GATE'S OTHER ARMS"), s.indexOf("  // 2. THE STORE, AND NOTHING AFTER IT."));
    const anchor = "  const kind = admitSymbolForExtraction(clean, cik);\n  if (!kind.admit) {";
    if (!block || s.split(anchor).length !== 2) throw new Error("move mutation anchor");
    return s.replace(block, "").replace(anchor, block + anchor);
  }],
];
for (const [label, mutate] of MUTANTS) {
  let bites = false;
  try {
    const src = mutate(RAW);
    const C = await load(() => src);
    for (const rule of Object.values(RULES)) {
      let ok = false;
      try { ok = Boolean(await rule(C, src)); } catch { ok = false; }
      if (!ok) { bites = true; break; }
    }
  } catch (e) { console.log(`    ${e.message}`); }
  check(`MUTATION: ${label} → caught`, bites);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
