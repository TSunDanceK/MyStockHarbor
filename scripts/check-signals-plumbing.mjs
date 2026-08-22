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
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

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
const codeOf = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

const builder = codeOf(read(BUILDER));
const page = codeOf(read(PAGE));

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

check(
  "consumer reads them in the universe branch",
  /firedIndicators:\s*record\.oversold/.test(page),
  "buildEntries preset/allSymbols entry literal"
);

// ------------------------------------------------- 2. the selection expression
console.log("\n=== 2. Which list a row shows, extracted from the source ===\n");

let expr = null;
const findFired = (node) => {
  if (
    ts.isPropertyAssignment(node) &&
    node.name.getText(sfP) === "firedIndicators" &&
    /record\.oversold/.test(node.initializer.getText(sfP))
  ) {
    expr = node.initializer.getText(sfP);
  }
  ts.forEachChild(node, findFired);
};
findFired(sfP);

if (!expr) {
  console.error("FAIL: could not find the universe branch's firedIndicators expression — measuring nothing.");
  process.exit(1);
}
console.log(`    ${expr.replace(/\s+/g, " ")}\n`);

const js = ts.transpileModule(`export const pick = (record) => (${expr});`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
}).outputText;
const { pick } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

const OS = ["RSI(14)", "Bollinger(20,2)"];
const OB = ["EMA20", "MACD(12,26,9)"];

check("oversold row shows the oversold list", JSON.stringify(pick({ oversold: true, oversoldIndicators: OS, overboughtIndicators: OB })) === JSON.stringify(OS));
check("overbought row shows the overbought list", JSON.stringify(pick({ overbought: true, oversoldIndicators: OS, overboughtIndicators: OB })) === JSON.stringify(OB));
// Not normally both; if the composite says so, green wins, matching
// pickIsGreenOverallSignal's precedence.
check("both flags -> oversold wins (green precedence)", JSON.stringify(pick({ oversold: true, overbought: true, oversoldIndicators: OS, overboughtIndicators: OB })) === JSON.stringify(OS));

// THE POINT OF POINT 4. undefined, not []. The grid renders MUTED for both, but
// an empty array says "measured, found none" where undefined says "no fired
// checks to report" -- and a future consumer that prints a count would turn the
// first into a false "0 signals".
check("neither flag -> undefined, NOT []", pick({ oversoldIndicators: OS, overboughtIndicators: OB }) === undefined);
check("oversold with no list stays undefined", pick({ oversold: true }) === undefined);

console.log("\n=== 3. The grid never prints a count ===\n");
const grid = codeOf(read("app/components/PickerResultsGrid.tsx"));
check(
  "Signals cell renders MUTED when absent or empty",
  /e\.firedIndicators\?\.length\s*\?/.test(grid) && /MUTED/.test(grid)
);
check("no '0 signals' style rendering anywhere", !/signals?["'`\s]*\}?\s*<\/|\bsignals\b.*\.length\s*\}/i.test(grid.replace(/key:\s*"signals"|label:\s*"Signals"/g, "")));

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
