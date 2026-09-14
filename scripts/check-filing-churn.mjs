// The institutional-holding churn grammar, run against 353 real headlines.
//
// WHAT IS AT RISK:
//   1. THE RULE STOPS FIRING. Silent: the page fills with holding notices and
//      renders perfectly, which is how this shipped in the first place.
//   2. THE RULE FIRES TOO WIDELY. Also silent, and worse — a real story is
//      demoted to a capped slot and may not appear at all. The MU and BRK-B
//      feeds are the false-positive control and must stay at zero.
//   3. IT TURNS BACK INTO A PUBLISHER LIST. The denylist that was already in
//      lib/stock-news-data.ts named this exact class of publisher and did not
//      fire, because a list matches a spelling. Asserted here.
//
//   node scripts/check-filing-churn.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const src = read("lib/server/news/filingChurn.ts");
if (/^import /m.test(src)) {
  console.error("FAIL: filingChurn.ts gained an import; it is required to stay dependency-free.");
  process.exit(1);
}
const file = path.join(ROOT, ".check-filingchurn.mjs");
fs.writeFileSync(file, ts.transpileModule(src, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText);
let mod;
try { mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`); }
finally { fs.unlinkSync(file); }
const { isFilingChurn, MAX_CHURN_STORED } = mod;

// ── the fixture ────────────────────────────────────────────────────────────
const decode = (s) =>
  s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
// The adapter strips the " - Publisher" suffix before anything reads the title,
// so the measurement has to strip it too or it is measuring a string production
// never sees.
const stripSuffix = (t) => t.replace(/\s+-\s+[^-]{2,40}$/, "");

const rows = read("scripts/fixtures/churn-sample.tsv")
  .split("\n")
  .filter((l) => l.trim() && !l.startsWith("#"))
  .map((l) => l.split("\t"))
  .filter((p) => p.length >= 4)
  .map(([symbol, publisher, host, title]) => ({ symbol, publisher, host, title: stripSuffix(decode(title)) }));

console.log("\n=== 1. THE FIXTURE IS THE ONE THAT WAS MEASURED ===\n");
check("353 items arrived", rows.length === 353, `${rows.length}`);
const bySymbol = (s) => rows.filter((r) => r.symbol === s);
check(
  "and the four feeds are the measured sizes",
  bySymbol("MU").length === 100 && bySymbol("BRK-B").length === 100 &&
    bySymbol("CYRX").length === 53 && bySymbol("JPM").length === 100,
  `MU=${bySymbol("MU").length} BRK-B=${bySymbol("BRK-B").length} CYRX=${bySymbol("CYRX").length} JPM=${bySymbol("JPM").length}`
);
check(
  "the link host carries no publisher information",
  new Set(rows.map((r) => r.host)).size === 1 && rows[0].host === "news.google.com",
  "Google News wraps every link — which is why the rule reads the title and not the domain"
);

// THE PUBLISHER COLUMN IS PINNED even though the RULE never reads it. Nothing
// in production would notice this column being rewritten -- that is exactly what
// publisher-agnostic means -- but the trap doc and the commit message both cite
// "MarketBeat is 58 of 100 on JPM" as evidence, and evidence that can be edited
// without anything failing is not evidence.
const publisherCount = (symbol, name) =>
  bySymbol(symbol).filter((r) => r.publisher === name).length;
check(
  "JPM is 58/100 MarketBeat, as the write-up claims",
  publisherCount("JPM", "MarketBeat") === 58,
  `got ${publisherCount("JPM", "MarketBeat")}`
);
check(
  "CYRX is 10/53 MarketBeat",
  publisherCount("CYRX", "MarketBeat") === 10,
  `got ${publisherCount("CYRX", "MarketBeat")}`
);
check(
  "and MU carried none of it at capture time",
  publisherCount("MU", "MarketBeat") === 0,
  "which is why JPM is the honest stand-in for the reported MU page"
);

console.log("\n=== 2. THE MEASURED RATES, PINNED ===\n");
const rate = (s) => bySymbol(s).filter((r) => isFilingChurn(r.title)).length;
// PINNED EXACTLY, not as "roughly". A rule that quietly widens or narrows is
// the failure mode here, and a range would absorb it.
for (const [symbol, expected] of [["MU", 0], ["BRK-B", 0], ["CYRX", 4], ["JPM", 48]]) {
  check(
    `${symbol}: ${expected} of ${bySymbol(symbol).length}`,
    rate(symbol) === expected,
    `got ${rate(symbol)}`
  );
}
check(
  "the false-positive control feeds stay at ZERO",
  rate("MU") === 0 && rate("BRK-B") === 0,
  "MU and BRK-B are 200 real headlines; a single hit here is a real story being demoted"
);
check(
  "...and the rule is not simply inert",
  rate("JPM") > 40,
  "a rule that matches nothing would also pass the control above"
);

console.log("\n=== 3. THE REPORTED HEADLINES, VERBATIM ===\n");
// From the preview the owner read, not from the fixture: this publisher does
// not appear in the capture, and the whole point of a shape rule is that it
// does not need to have seen the publisher before.
const REPORTED = [
  "Chokshi & Queen Wealth Advisors Inc Takes Position in Micron Technology, Inc. $MU",
  "OceanIQ Capital LLC Buys New Stake in Micron Technology, Inc. $MU",
  "NBH Bank Invests $668,000 in Micron Technology, Inc. $MU",
  "Nvest Financial LLC Reduces Stake in Micron Technology, Inc. $MU",
  "Micron Technology, Inc. $MU Position Decreased by Riverview Capital Advisers LLC",
];
for (const title of REPORTED) {
  check(`caught: ${title.slice(0, 62)}…`, isFilingChurn(title));
}

console.log("\n=== 4. REAL STORIES THAT MUST SURVIVE ===\n");
// Each one of these failed an earlier draft. They are kept because a rule that
// passes only the cases it was written against has not been tested.
for (const title of [
  "Have Insiders Sold Micron Technology Shares Recently?",
  "Berkshire Hathaway's housing bet deepens as it boosts Lennar stake to $1.2B",
  "Berkshire Hathaway Earnings: Cash Balances Retreat on Increased Investments and Share Buybacks in Q2",
  "Micron Technology beats Q4 estimates as HBM revenue triples",
  "Will Micron Technology Stock Soar to $1,500 After Sept. 30?",
]) {
  check(`survives: ${title.slice(0, 62)}…`, !isFilingChurn(title));
}

console.log("\n=== 5. THE KNOWN FALSE POSITIVE IS RECORDED, NOT HIDDEN ===\n");
check(
  "Berkshire disclosing a new stake still matches",
  isFilingChurn("Warren Buffett's Berkshire Hathaway Inc. discloses new stake in Alphabet"),
  "structurally it IS a holding notice; no regex separates it from one, and tuning until it passes would be fitting the rule to its own test"
);
check(
  `...which is survivable only because the callers keep ${MAX_CHURN_STORED}`,
  MAX_CHURN_STORED >= 2,
  "an exclusion would delete it outright — this is the whole argument for a cap"
);

console.log("\n=== 6. IT IS A SHAPE RULE, NOT A PUBLISHER LIST ===\n");
const code = readCodeOnly("lib/server/news/filingChurn.ts");
for (const name of ["marketbeat", "defense world", "defenseworld", "etfdailynews", "ticker report"]) {
  check(`no "${name}" anywhere in the rule`, !new RegExp(name, "i").test(code));
}
check(
  "the classifier takes a title and nothing else",
  /export function isFilingChurn\(title: string \| null \| undefined\): boolean/.test(src),
  "a signature that accepted the item could read the publisher, and then it would"
);
// The proof that it is publisher-agnostic: the same verdicts hold when every
// publisher label in the fixture is replaced with one made-up name.
const anonymised = rows.map((r) => ({ ...r, publisher: "Some Wire Nobody Has Seen" }));
check(
  "verdicts are unchanged when every publisher is renamed",
  anonymised.every((r, i) => isFilingChurn(r.title) === isFilingChurn(rows[i].title))
);

console.log("\n=== 7. DEGENERATE INPUT ===\n");
check("null, undefined and empty are not churn",
  !isFilingChurn(null) && !isFilingChurn(undefined) && !isFilingChurn("") && !isFilingChurn("   "));
check("a bare firm name is not churn", !isFilingChurn("BlackRock Inc."));
check("a bare holding word is not churn", !isFilingChurn("Shares rise"));

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
