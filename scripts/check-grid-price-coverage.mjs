// THE FIFTH REASON, AND THE THREE THINGS THE CUTOVER MUST NOT HAVE BROKEN.
//
// ── WHY THE CALL SITES ARE ASSERTED, NOT JUST THE MODULE ──────────────────
// This build has now lost a correct signal to an unread call site twice:
// #483 shipped getMonthVisibility and FullDayEarnings.complete and NOTHING in
// lib/ or app/ read either for weeks, and classifySecurityName was nearly
// reused for a question it had never been measured against. Both would have
// passed every module-level test that existed.
//
// So the sections below read the PAGE, not only the modules it imports.
//
//   node scripts/check-grid-price-coverage.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "lib/server/gridPriceCoverage.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const SOURCE = fs.readFileSync(SRC, "utf8");
const build = async (src) => {
  const js = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
};
const m = await build(SOURCE);

const underMutation = async (name, from, to, probe) => {
  if (!SOURCE.includes(from)) {
    check(`mutation "${name}" could not be applied`, false, `source no longer contains: ${from.slice(0, 60)}`);
    return;
  }
  let stillHolds;
  try { stillHolds = await probe(await build(SOURCE.replace(from, to))); } catch { stillHolds = false; }
  check(`MUTATION "${name}" breaks the assertion`, !stillHolds,
    stillHolds ? "the property still held with the rule removed — the assertion above proves nothing" : "");
};

const PAGE = fs.readFileSync(path.join(ROOT, "app/earnings-calendar/page.tsx"), "utf8");
const LIST = fs.readFileSync(path.join(ROOT, "app/earnings-calendar/EarningsDayList.tsx"), "utf8");
const CAL = fs.readFileSync(path.join(ROOT, "lib/server/earningsCalendar.ts"), "utf8");

console.log("\n1. THE RULE");
{
  check("a symbol in the price pool is covered",
    m.priceCoverage({ fromPricePool: true }) === "covered");
  check("one outside it is NOT, and the reason names the bar source",
    m.priceCoverage({ fromPricePool: false }) === "outside-bar-universe");
  check("only a covered row shows price cells",
    m.showsPriceCells("covered") === true &&
      m.showsPriceCells("outside-bar-universe") === false);
}

console.log("\n2. IT IS NOT A FIFTH TIER OF THE OTHER FOUR");
{
  // The four market-cap refusals are claims about a figure we HAVE. This is a
  // claim that there is nothing to refuse. Folding it into that ladder would
  // let "we never had it" read as a judgement about data we do have.
  const words = m.PRICE_COVERAGE_NOTE;
  check("the note says the figures are NOT COLLECTED, not that they are missing",
    /not collected/i.test(words) && /rather than missing/i.test(words),
    words);
  check("...and it makes no claim about the companies themselves",
    !/no earnings|not profitable|too small|unimportant/i.test(words));
  check("the module does not import the valuation refusals",
    !/secValuation|ValuationRefusal/.test(SOURCE),
    "ranking this against them in code is what the separation exists to prevent");
}

console.log("\n3. THE CALL SITES — the part that regressed twice before");
{
  check("the data layer stamps coverage onto every row",
    /priceCoverage: priceCoverage\(\{ fromPricePool:/.test(CAL),
    "a rule nobody calls is indistinguishable from no rule");
  check("...off the pool hit, not a second universe test",
    /fromPricePool: Boolean\(quote\?\.usOk\)/.test(CAL),
    "two producers for one fact is claude/traps/two-validators-for-one-value.md");
  // SUPERSEDED 2026-09-23 (owner ruling, #535 COWORK #23): on the SEC-fed
  // grid an off-pool row shows "—" in both cells, and the note says once what
  // the dash means. Pinned the other way round now.
  check("an off-pool row shows a dash in both cells (owner ruling, COWORK #23)",
    /\{ key: "price", label: "Price", fmt: \(i\) => formatPrice\(i\.price\) \}/.test(LIST) &&
      /\{ key: "marketCap", label: "Market Cap", fmt: \(i\) => formatCompact\(i\.marketCap\) \}/.test(LIST) &&
      /return value !== null \? `\$\$\{value\.toFixed\(2\)\}` : "—";/.test(LIST));
  check("...and the note explains the dash, once",
    /A dash marks companies outside that set/.test(fs.readFileSync("lib/server/gridPriceCoverage.ts", "utf8")));
  check("the page prints the note only when a row is actually blank",
    /items\.some\(\(i\) => i\.priceCoverage === "outside-bar-universe"\)/.test(PAGE),
    "a standing note on a fully-covered day explains a gap that is not there");
}

console.log("\n4. (a) THE FAILURE-VS-ABSENCE DISTINCTION SURVIVED THE CUTOVER");
{
  check("the page still imports the day-state resolver",
    /from "@\/lib\/server\/calendarDayState"/.test(PAGE));
  check("...still feeds it getMonthVisibility, #483's signal",
    /monthVisibility: getMonthVisibility\(/.test(PAGE),
    "this is the signal that sat unread for weeks");
  check("...and still feeds it the completeness flag",
    /complete: dateComplete/.test(PAGE));
  check("the bare emptiness test has NOT come back",
    !/dayData\.usListedCount\s*>\s*0\s*\?/.test(PAGE),
    "`usListedCount > 0 ? quiet : quiet` is the exact line that undid #483");
}

console.log("\n5. (b) THE DUE STRIP'S STATIC LIST IS THE PERMANENT MECHANISM");
{
  const gen = fs.readFileSync(path.join(ROOT, "scripts/due-strip-universe.mjs"), "utf8");
  check("the generator states it is permanent",
    /PERMANENT, NOT AN INTERIM/i.test(gen));
  check("no lingering 'replaced by live ranking' language",
    !/replaces this file with a live ranking/i.test(gen),
    "stage 5 is closed; language implying otherwise sends a future session to build it");
  // PER LINE, AND EXCLUDING THE PROHIBITION ITSELF. The first form of this
  // check spanned lines and matched the file's own instruction -- "Do not
  // reintroduce a TODO pointing at a live ranking" -- reporting the sentence
  // that forbids the thing as the thing. A check that cannot tell a rule from
  // its violation is worse than none, because it goes red on the fix.
  const todoAtLiveRanking = gen.split("\n").filter(
    (ln) => /\bTODO\b/.test(ln) && /live ranking/i.test(ln) && !/not reintroduce/i.test(ln)
  );
  check("no TODO pointing at a live ranking",
    todoAtLiveRanking.length === 0,
    todoAtLiveRanking.join(" | "));
  check("the payload note tells a regenerator it is permanent",
    /list is PERMANENT/i.test(gen),
    "the note travels with the data, which is what a future reader actually opens");
}

console.log("\n6. THE MUTANTS");
{
  await underMutation(
    "cutover: coverage inverted (off-universe rows claim to have prices)",
    'return inputs.fromPricePool ? "covered" : "outside-bar-universe";',
    'return "covered";',
    (mm) => mm.priceCoverage({ fromPricePool: false }) === "outside-bar-universe"
  );
  await underMutation(
    "cutover: uncovered rows render their cells anyway",
    'return coverage === "covered";',
    "return true;",
    (mm) => mm.showsPriceCells("outside-bar-universe") === false
  );
  // The note's WORDS are the deliverable, not merely its presence: "not
  // collected for them" and "missing for those companies" are opposite claims
  // and only one is true.
  await underMutation(
    "cutover: the note blames the companies instead of the coverage",
    "\"for them here, rather than missing for those companies.\";",
    "\"for them because they are too small to track.\";",
    (mm) => /rather than missing/i.test(mm.PRICE_COVERAGE_NOTE)
  );
}

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}`);
process.exit(failures ? 1 : 0);
