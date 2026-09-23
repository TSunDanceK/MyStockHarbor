// sec-facts CANNOT TIME OUT: it spends against a wall-clock budget, reserves a
// share for report dates, bounds every fetch, and always reaches the manifest
// write. (Production: 504 at 300s on 2026-09-21 and 09-22, last recorded run
// 2026-09-20; relay 35778314028 measured the cause -- SEC_LABEL_VERSION 3->4
// in #479 and a chains change in #500/#504 made all 785 populated sets stale,
// so rewindow borrowed slack up to 525 companyfacts fetches a run.)
//
//   node scripts/check-sec-facts-budget.mjs
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const src = readCodeOnly("lib/server/jobBudget.ts");
const B = await lift(src.replace(/export (const|function|type)/g, "$1") +
  "\nexport { makeJobBudget, JOB_BUDGET_MS, REPORT_DATES_RESERVE_MS, FETCH_TIMEOUT_MS };");

console.log("\n1. the budget, on a fake clock");
{
  let t = 1_000_000;
  const b = B.makeJobBudget(240_000, 60_000, () => t);
  check("both phases open at the start", b.factsOpen() && b.datesOpen());
  t += 179_999;
  check("the fact-set phase is still open just before total - reserve", b.factsOpen());
  t += 1;
  check("...and closes at total - reserve (180s), leaving report dates open",
    !b.factsOpen() && b.datesOpen(), `elapsed ${b.elapsedMs()}ms`);
  t += 60_000;
  check("report dates close at the total (240s)", !b.datesOpen(), `elapsed ${b.elapsedMs()}ms`);
}

console.log("\n2. the numbers leave room inside Vercel's 300s");
{
  // THE WORST SYMBOL: started just before the facts phase closes, it can take
  // one companyfacts fetch plus two FX fetches (FRED, then ECB) at the timeout
  // each. After the 240s total nothing new starts, so the ceiling is the later
  // of (facts close + worst symbol) and (total + one submissions fetch).
  const factsClose = B.JOB_BUDGET_MS - B.REPORT_DATES_RESERVE_MS;
  const worst = Math.max(factsClose + 3 * B.FETCH_TIMEOUT_MS, B.JOB_BUDGET_MS + B.FETCH_TIMEOUT_MS);
  check("the worst case, every fetch hanging to its timeout, still ends inside 300s",
    worst < 290_000, `max(${factsClose} + 3 x ${B.FETCH_TIMEOUT_MS}, ${B.JOB_BUDGET_MS} + ${B.FETCH_TIMEOUT_MS}) = ${worst}ms`);
  check("report dates get a real share, not a remainder", B.REPORT_DATES_RESERVE_MS >= 30_000 &&
    B.REPORT_DATES_RESERVE_MS < B.JOB_BUDGET_MS);
}

console.log("\n3. the route spends it");
const route = readCodeOnly("app/api/jobs/sec-facts/route.ts");
const fx = readCodeOnly("lib/server/fxRates.ts");
const factsLoop = route.slice(route.indexOf("for (const { symbol, reason } of work) {"));
check("the fact-set loop checks factsOpen before taking a symbol",
  /for \(const \{ symbol, reason \} of work\) \{\s*if \(!budget\.factsOpen\(\)\)/.test(route));
check("the report-dates loop checks datesOpen before taking a symbol",
  /for \(const \[i, symbol\] of datesQueue\.entries\(\)\) \{\s*if \(!budget\.datesOpen\(\)\)/.test(route));
check("a stopped loop BREAKS to the manifest write, never returns early",
  !/budget\.(factsOpen|datesOpen)\(\)\)\s*\{?\s*return/.test(route) &&
    route.indexOf("await writeManifest(manifest)") > route.indexOf("budget.datesOpen()") &&
    route.indexOf("await recordJobRun(\"sec-facts\", summary.ok, summary)") > route.indexOf("await writeManifest(manifest)"));
check("the budget starts before the manifest read",
  route.indexOf("const budget = makeJobBudget();") !== -1 &&
    route.indexOf("const budget = makeJobBudget();") < route.indexOf("await readManifest()"));
// TWO again since the filing-folder read moved to its own job (#535 COWORK
// #10/#12): companyfacts and submissions. The filing job's one gate is bounded
// the same way, asserted below.
check("both SEC fetches are bounded",
  (route.match(/signal: AbortSignal\.timeout\(FETCH_TIMEOUT_MS\)/g) ?? []).length === 2);
check("the filing job's SEC fetch is bounded too, through its one rate gate",
  (fs.readFileSync("app/api/jobs/sec-filings/route.ts", "utf8").match(/signal: AbortSignal\.timeout\(FETCH_TIMEOUT_MS\)/g) ?? []).length === 1);
check("both FX fetches (FRED, ECB) are bounded",
  (fx.match(/signal: AbortSignal\.timeout\(FX_FETCH_TIMEOUT_MS\)/g) ?? []).length === 2 &&
    Number((fx.match(/const FX_FETCH_TIMEOUT_MS = ([\d_]+);/) ?? [])[1]?.replace(/_/g, "")) <= B.FETCH_TIMEOUT_MS);
check("the summary reports per-phase time and what was deferred",
  ["phaseFactsMs", "phaseReportDatesMs", "phaseManifestWriteMs", "factsDeferred", "reportDatesDeferred", "elapsedMs"]
    .every((k) => route.includes(`${k}:`)));
void factsLoop;

console.log("\n4. mutations of the route text are seen");
{
  const mutants = [
    ["the facts check removed", route.replace("if (!budget.factsOpen()) {", "if (false) {"),
      (r) => /for \(const \{ symbol, reason \} of work\) \{\s*if \(!budget\.factsOpen\(\)\)/.test(r)],
    ["report dates sharing the facts deadline", route.replace("if (!budget.datesOpen())", "if (!budget.factsOpen())"),
      (r) => /for \(const \[i, symbol\] of datesQueue\.entries\(\)\) \{\s*if \(!budget\.datesOpen\(\)\)/.test(r)],
    ["a fetch left unbounded", route.replace(", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)", ""),
      (r) => (r.match(/signal: AbortSignal\.timeout\(FETCH_TIMEOUT_MS\)/g) ?? []).length === 3],
  ];
  for (const [name, mutated, assertion] of mutants) {
    check(`MUTATION caught: ${name}`, mutated !== route && !assertion(mutated));
  }
}

console.log(failures ? `\n${failures} CHECK(S) FAILED\n` : "\nALL CHECKS PASSED\n");
process.exit(failures ? 1 : 0);
