// Guards the failure mode #330 actually had: a field added to SOME hops of a
// chain and not others.
//
// #330 introduced oversoldIndicators/overboughtIndicators and wired them into
// CompositeResult, OversoldCandidate, OverboughtCandidate and takeTop's
// destructure -- four places -- but not SignalRecord. SignalRecord is the
// UNIVERSE path (every analyzed symbol); the section items are only each
// category's top 20. So the Signals column populated for ~20 rows a page and
// was blank for the rest, which reads as "these stocks have no signals" rather
// than "this field never reached this path".
//
// tsc cannot catch that. Every hop is optional, so a missing one is not a type
// error -- it is silently `undefined` all the way to a muted cell.
//
//   node scripts/check-signals-plumbing.mjs
//
// Two things are checked: that every hop of the chain carries the fields, and
// that the consumer's selection expression behaves (real expression, extracted
// by AST -- claude/traps/two-validators-for-one-value.md).
//
// EXTENDED for the same bug's third appearance. /best-trend-score-stocks
// rendered `4/4 trend checks` -- a bare count -- with a dashed Signals column
// beside it, because that column reads the composite's oversold/overbought
// lists and a trend leader is normally neither. The four trend booleans were
// computed for every symbol and discarded at the same object literal #330 had
// missed. So the trend chain gets the same hop-by-hop treatment, and the
// selection rule is now page-aware and exercised in BOTH modes.
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const BUILDER = "lib/server/pickersBuilder.ts";
const PAGE = "app/components/PickerResultPage.tsx";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// Comments stripped: this file's own explanation names the fields, and matching
// prose would report the plumbing as present when it is not
// (claude/traps/grep-finds-the-comment-not-the-code.md).
// Comments stripped with the real tokeniser, and guarded -- see scripts/lib/source-code.mjs.
const codeOf = (src, file) => stripComments(src, { file, dropLines: true });

const builder = codeOf(read(BUILDER), BUILDER);
const page = codeOf(read(PAGE), PAGE);

console.log("\n=== 1. Every hop of the chain carries both fields ===\n");

// The producer builds them, the record type declares them, the push populates
// them, the consumer's mirror type declares them. Miss any one and the column
// is blank with a green build.
const sfB = ts.createSourceFile(BUILDER, read(BUILDER), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const typeMembers = (sf, typeName) => {
  let members = null;
  const visit = (node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === typeName && ts.isTypeLiteralNode(node.type)) {
      members = node.type.members.map((m) => m.name?.getText(sf)).filter(Boolean);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return members;
};

const sfP = ts.createSourceFile(PAGE, read(PAGE), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

for (const field of ["oversoldIndicators", "overboughtIndicators"]) {
  const compositeMembers = typeMembers(sfB, "CompositeResult") ?? [];
  const recordMembers = typeMembers(sfB, "SignalRecord") ?? [];
  const pageRecordMembers = typeMembers(sfP, "SignalRecord") ?? [];

  check(`${field}: on CompositeResult (producer)`, compositeMembers.includes(field));
  check(`${field}: on pickersBuilder SignalRecord (the hop #330 missed)`, recordMembers.includes(field));
  check(
    `${field}: populated in signalRecords.push`,
    new RegExp(`${field}\\s*:\\s*comp\\?\\.${field}`).test(builder)
  );
  check(`${field}: on PickerResultPage's SignalRecord mirror`, pageRecordMembers.includes(field));
}

// The trend chain, same shape. The producer computes the booleans, the record
// type declares them, the push populates them, the page mirrors them -- and the
// SECTION item carries the derived list too, because /best-trend-score-stocks
// renders 36 rows from the universe while the section holds only the top 20. A
// fix applied to just the section item would populate ~20 rows and dash the
// rest, which is #330's own failure shape a third time.
const recordMembersB = typeMembers(sfB, "SignalRecord") ?? [];
const pageRecordMembersP = typeMembers(sfP, "SignalRecord") ?? [];
check("trendChecks: on pickersBuilder SignalRecord", recordMembersB.includes("trendChecks"));
check("trendChecks: on PickerResultPage's SignalRecord mirror", pageRecordMembersP.includes("trendChecks"));
check(
  "trendChecks: populated in signalRecords.push from the real trendScore",
  /trendChecks:\s*trendScore\s*\n?\s*\?\s*\{[\s\S]{0,320}?macdBullish:\s*trendScore\.macdBullish/.test(builder)
);
check(
  "trendChecks: absent when trendScore is null, rather than four falses",
  /trendChecks:\s*trendScore[\s\S]{0,400}?:\s*undefined/.test(builder),
  "buildTrendScoreFromHistory returns null under 220 closes"
);
check(
  "the trend SECTION item also carries firedIndicators",
  /trendLeaders\.push\(\{[\s\S]{0,600}?firedIndicators:\s*trendIndicatorsFrom\(trendScore\)/.test(builder)
);
check(
  "...from the SAME derivation the page uses, not a second copy",
  (builder.match(/function trendIndicatorsFrom\s*\(/g) ?? []).length === 1 &&
    /import \{[^}]*trendIndicatorsFrom[^}]*\} from "@\/lib\/server\/pickersBuilder"/.test(page),
  "one definition in the builder, imported by the page"
);
check(
  "/best-trend-score-stocks DECLARES signalsFrom: \"trend\"",
  /signalsFrom:\s*"trend"/.test(
    codeOf(read("app/best-trend-score-stocks/page.tsx"), "app/best-trend-score-stocks/page.tsx")
  ),
  "without it the column silently falls back to the composite and dashes every row"
);

// All THREE branches of buildEntries that build entries from signalRecords feed
// the same grid and the same Signals column. The universe branch was fixed
// first and the other two were left blank, which is the same partial-plumbing
// shape as #330 one level down -- so the count is asserted, not just presence.
const firedCallSites = (page.match(/firedIndicators:\s*firedIndicatorsFor\(record,\s*signalsSource\)/g) ?? []).length;
check(
  "all three signalRecords branches set firedIndicators, all page-aware",
  firedCallSites === 3,
  `${firedCallSites} call site(s)`
);
check(
  "they share ONE selection rule rather than three copies",
  /function firedIndicatorsFor\s*\(/.test(page) && !/firedIndicators:\s*record\.oversold/.test(page),
  "firedIndicatorsFor"
);
check(
  "the source is resolved ONCE, not re-derived per branch",
  (page.match(/config\.signalsFrom\s*\?\?/g) ?? []).length === 1,
  "three copies of the default is the same divergence risk one hop up"
);

// ------------------------------------------------- 2. the selection expression
console.log("\n=== 2. The shared selection rule, extracted from the source ===\n");

const fnNamed = (sf, name) => {
  let out = null;
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) out = node.getText(sf);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
};

const fn = fnNamed(sfP, "firedIndicatorsFor");
// The trend branch DELEGATES to the builder's derivation, so extracting the
// selection rule alone would leave that branch calling an undefined function
// and every trend assertion below would throw rather than measure. The real
// derivation is pulled in beside it -- both functions as they actually ship.
const trendFn = fnNamed(sfB, "trendIndicatorsFrom");

if (!fn || !trendFn) {
  console.error(
    `FAIL: could not extract ${!fn ? "firedIndicatorsFor" : "trendIndicatorsFrom"} — measuring nothing.`
  );
  process.exit(1);
}
console.log(
  `    ${fn.split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("/*")).join(" ").replace(/\s+/g, " ")}\n`
);

const js = ts.transpileModule(`${trendFn}\n${fn}\nexport const pick = firedIndicatorsFor;\nexport const trend = trendIndicatorsFrom;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
}).outputText;
const { pick, trend } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

const OS = ["RSI(14)", "Bollinger(20,2)"];
const OB = ["EMA20", "MACD(12,26,9)"];

check("oversold row shows the oversold list", JSON.stringify(pick({ oversold: true, oversoldIndicators: OS, overboughtIndicators: OB }, "composite")) === JSON.stringify(OS));
check("overbought row shows the overbought list", JSON.stringify(pick({ overbought: true, oversoldIndicators: OS, overboughtIndicators: OB }, "composite")) === JSON.stringify(OB));
// Not normally both; if the composite says so, green wins, matching
// pickIsGreenOverallSignal's precedence.
check("both flags -> oversold wins (green precedence)", JSON.stringify(pick({ oversold: true, overbought: true, oversoldIndicators: OS, overboughtIndicators: OB }, "composite")) === JSON.stringify(OS));

// THE POINT OF POINT 4. undefined, not []. The grid renders MUTED for both, but
// an empty array says "measured, found none" where undefined says "no fired
// checks to report" -- and a future consumer that prints a count would turn the
// first into a false "0 signals".
check("neither flag -> undefined, NOT []", pick({ oversoldIndicators: OS, overboughtIndicators: OB }, "composite") === undefined);
check("oversold with no list stays undefined", pick({ oversold: true }, "composite") === undefined);

// ---------------------------------------------------------- the trend branch
// THE BUG ITSELF, as an assertion. A trend leader with all four checks firing
// and neither composite flag set: the old rule returned undefined here, which
// is exactly what a dashed Signals column beside "4/4 trend checks" was.
const ALL4 = { priceAboveMA200: true, priceAboveMA50: true, ma50AboveMA200: true, macdBullish: true };
check(
  "composite mode on a pure trend leader -> undefined (the bug, pinned)",
  pick({ trendChecks: ALL4 }, "composite") === undefined,
  "the default rule genuinely has nothing to say about this row"
);
check(
  "trend mode on the same row -> all four, strongest first",
  JSON.stringify(pick({ trendChecks: ALL4 }, "trend")) ===
    JSON.stringify(["Price > MA200", "MA50 > MA200", "Price > MA50", "MACD(12,26,9) > 0"])
);
check(
  "trend mode reports only what fired",
  JSON.stringify(pick({ trendChecks: { ...ALL4, priceAboveMA50: false, macdBullish: false } }, "trend")) ===
    JSON.stringify(["Price > MA200", "MA50 > MA200"])
);
// The order is the score's own weighting (18/18/12/12), not declaration order.
// Asserted because "strongest first" is a claim the column makes.
check(
  "MA50 > MA200 outranks Price > MA50, matching the score weights",
  JSON.stringify(trend({ priceAboveMA200: false, priceAboveMA50: true, ma50AboveMA200: true, macdBullish: false })) ===
    JSON.stringify(["MA50 > MA200", "Price > MA50"])
);
// Same rule as the composite side, one level down: undefined, never [].
check("trend mode, nothing fired -> undefined NOT []", trend({ priceAboveMA200: false, priceAboveMA50: false, ma50AboveMA200: false, macdBullish: false }) === undefined);
check("trend mode, never computed -> undefined", pick({}, "trend") === undefined);
// A trend page must not silently fall back to the composite lists: the two
// measure different things and a row showing RSI(14) under a trend heading is
// a wrong answer, not a partial one.
check(
  "trend mode never leaks the composite lists",
  pick({ oversold: true, oversoldIndicators: OS }, "trend") === undefined
);

console.log("\n=== 3. A count never STANDS IN for names ===\n");
// NARROWED, DELIBERATELY, and the distinction is the whole point.
//
// This section used to assert "the grid never prints a count", because of the
// third appearance of the #330 bug: /best-trend-score-stocks rendered
// `4/4 trend checks` -- a bare count -- precisely BECAUSE the names never
// reached that path. The count was the symptom of broken plumbing, standing in
// for data the column could not get.
//
// The Signals column IS a count now, of screener membership, with the qualifying
// names on the element's title. That is the opposite situation: the names are
// present and one hover away. So what must be forbidden is a count with no names
// behind it -- not the digits themselves.
//
// NOTE ON THE SOURCE. This column reads `reasons` (screener membership), not
// `firedIndicators` (the composite's oversold/overbought indicator names). The
// hop-by-hop assertions in sections 1 and 2 above still guard firedIndicators,
// which is right -- it still feeds the cards -- but it is no longer what this
// column displays.
//
// The old assertion also matched on the exact ternary the cell happened to use,
// which is a shape test wearing a behaviour test's label: rewriting the same
// logic as an if-statement failed it while changing nothing a reader sees.
const grid = codeOf(read("app/components/PickerResultsGrid.tsx"), "app/components/PickerResultsGrid.tsx");
const signalsCell = grid.slice(
  grid.indexOf('const signals: Col = {'),
  grid.indexOf("\n    };", grid.indexOf('const signals: Col = {'))
);

check(
  "the Signals cell was found",
  signalsCell.length > 0,
  "an empty slice would pass the assertions below without reading any code"
);
check(
  "an empty or absent list renders MUTED, not a zero",
  /MUTED/.test(signalsCell) && !/>\s*0\s*</.test(signalsCell),
  "an absence is not a zero -- the unfiltered All Stocks view can genuinely match no condition, and a 0 there would claim it was measured and came out empty"
);
check(
  "the count has the qualifying names behind it",
  /title=\{reasons\.join/.test(signalsCell),
  "the #330 failure was a count with nothing behind it; the names on hover are what make this a summary rather than a substitute"
);
check(
  "the count is of screener membership, not indicator names",
  /reasons\.length/.test(signalsCell) && !/firedIndicators/.test(signalsCell),
  "firedIndicators is populated only for stocks the composite flagged overbought or oversold, so on most pages it is a different question from the one the column heading asks"
);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
