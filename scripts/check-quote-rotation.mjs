// Proves the quote stage's resume-and-wrap actually covers the whole universe,
// and that the old behaviour did not.
//
// THE BUG. fetchQuoteFundamentals walks the universe in order and returns the
// moment awaitFmpCapacity exhausts the shared 90s budget. It always started at
// index 0, so every run re-fetched the same head of the list and the tail
// beyond the cut was never covered -- not slowly, never. Measured 2026-08-22:
// quotesFetched 357 of 755 with waitedMs 90000, the entire budget spent, every
// day, on the same 357 symbols.
//
// Raising the cron cadence WITHOUT this would simply redo that head more often,
// which is why the offset had to land first.
//
//   node scripts/check-quote-rotation.mjs
//
// Like the other two check-* scripts, this does not test a copy: it extracts
// the real rotateFrom and advanceOffset from lib/server/fundamentalsCache.ts by
// AST and runs those (claude/traps/two-validators-for-one-value.md).
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "lib/server/fundamentalsCache.ts");
const source = fs.readFileSync(SRC, "utf8");
const sf = ts.createSourceFile(SRC, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const WANTED = ["rotateFrom", "advanceOffset"];
const found = new Map();
for (const st of sf.statements) {
  if (ts.isFunctionDeclaration(st) && st.name && WANTED.includes(st.name.text)) {
    found.set(st.name.text, st.getText(sf));
  }
}
for (const name of WANTED) {
  if (!found.has(name)) {
    console.error(`FAIL: could not find ${name} in ${path.relative(ROOT, SRC)} — this script is measuring nothing.`);
    process.exit(1);
  }
}

const js = ts.transpileModule(
  `${found.get("rotateFrom")}\n${found.get("advanceOffset")}\nexport { rotateFrom, advanceOffset };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }
).outputText;
const { rotateFrom, advanceOffset } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
);

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// The real shape: 755 symbols, ~357 reachable per run.
const UNIVERSE = Array.from({ length: 755 }, (_, i) => `S${String(i).padStart(3, "0")}`);
const PER_RUN = 357;

// ------------------------------------------------------- A. the old behaviour
console.log("\n=== A. CONTROL: always restarting at 0 (the shipped behaviour) ===\n");
{
  const seen = new Set();
  for (let run = 0; run < 20; run++) for (const s of UNIVERSE.slice(0, PER_RUN)) seen.add(s);
  console.log(`    after 20 runs: ${seen.size} of ${UNIVERSE.length} symbols ever quoted`);
  console.log(`    never reached: ${UNIVERSE.length - seen.size} (indices ${PER_RUN}..${UNIVERSE.length - 1})\n`);
  check("20 runs still leave the tail completely uncovered", seen.size === PER_RUN);
  check("the uncovered count matches the live gap", UNIVERSE.length - seen.size === 398);
}

// ------------------------------------------------------- B. rotation
console.log("=== B. Rotation: same budget, offset carried between runs ===\n");
{
  let offset = 0;
  const seen = new Set();
  let runsToFullCoverage = null;
  for (let run = 1; run <= 10; run++) {
    const rotated = rotateFrom(UNIVERSE, offset);
    const covered = rotated.slice(0, PER_RUN);
    covered.forEach((s) => seen.add(s));
    const next = advanceOffset(offset, PER_RUN, UNIVERSE.length);
    if (run <= 4) {
      console.log(
        `    run ${run}: offset ${String(offset).padStart(3)} -> ${String(next).padStart(3)}` +
          `  first=${covered[0]} last=${covered[covered.length - 1]}  cumulative ${seen.size}/${UNIVERSE.length}`
      );
    }
    if (seen.size === UNIVERSE.length && runsToFullCoverage === null) runsToFullCoverage = run;
    offset = next;
  }
  console.log();
  check("every symbol quoted at least once", seen.size === UNIVERSE.length, `${seen.size}/${UNIVERSE.length}`);
  check("full coverage inside ceil(755/357) = 3 runs", runsToFullCoverage === 3, `took ${runsToFullCoverage}`);
}

// ------------------------------------------------------- C. no gaps, ever
console.log("\n=== C. No symbol is ever skipped, across awkward budgets ===\n");
for (const budget of [1, 7, 50, 356, 357, 754, 755, 900]) {
  let offset = 0;
  const seen = new Set();
  const runs = Math.ceil(UNIVERSE.length / Math.min(budget, UNIVERSE.length)) + 2;
  for (let r = 0; r < runs; r++) {
    rotateFrom(UNIVERSE, offset).slice(0, budget).forEach((s) => seen.add(s));
    offset = advanceOffset(offset, budget, UNIVERSE.length);
  }
  check(`budget ${String(budget).padStart(3)}/run reaches all 755 within ${runs} runs`, seen.size === UNIVERSE.length, `${seen.size}/755`);
}

// ------------------------------------------------------- D. starved run
console.log("\n=== D. A starved run must not move the cursor ===\n");
{
  const offset = 400;
  check("consumed 0 leaves the offset put", advanceOffset(offset, 0, UNIVERSE.length) === 400);
  check("negative consumed likewise", advanceOffset(offset, -5, UNIVERSE.length) === 400);
  check("NaN consumed likewise", advanceOffset(offset, NaN, UNIVERSE.length) === 400);
  // If a starved run DID advance, this window would be skipped by everyone.
  let off = 400;
  const seen = new Set();
  for (let r = 0; r < 5; r++) {
    const consumed = r === 0 ? 0 : PER_RUN; // first run starved
    rotateFrom(UNIVERSE, off).slice(0, consumed).forEach((s) => seen.add(s));
    off = advanceOffset(off, consumed, UNIVERSE.length);
  }
  check("a starved first run costs coverage but never a permanent hole", seen.size === UNIVERSE.length, `${seen.size}/755`);
}

// ------------------------------------------------------- E. corrupted offset
console.log("\n=== E. A corrupted Redis value cannot break the walk ===\n");
check("offset far past the end wraps", rotateFrom(UNIVERSE, 999_999)[0] === UNIVERSE[999_999 % 755]);
check("negative offset normalises", rotateFrom(UNIVERSE, -1)[0] === UNIVERSE[754]);
check("fractional offset floors", rotateFrom(UNIVERSE, 2.9)[0] === UNIVERSE[2]);
check("offset 0 returns the list unrotated", rotateFrom(UNIVERSE, 0)[0] === UNIVERSE[0]);
check("rotation is a permutation, never a truncation", rotateFrom(UNIVERSE, 300).length === 755);
check("rotation loses no symbol", new Set(rotateFrom(UNIVERSE, 300)).size === 755);
check("empty universe is safe", rotateFrom([], 5).length === 0 && advanceOffset(3, 10, 0) === 0);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
