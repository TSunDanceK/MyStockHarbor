// SIC-CHANGE NOTICES (#552, COWORK #3): the sec-filings job flags a filer whose
// SEC SIC code moved since data/sec/registrants.json. Flag only.
//
//   1. sicChangeOf, RUN on real registrant rows: same code → null; a moved
//      code → a notice; a missing code on either side → null (a gap is not a
//      move); the dot/dash spelling reaches the row. MUTATION: the equality
//      test removed, so every filer is flagged every run.
//   2. The cost rule, read from the code: the comparison reuses the one
//      submissions fetch checkAndFill already makes, and the route writes all
//      of a run's changes in ONE call after the loop, never inside it.
//      MUTATION: the write moved into the loop.
//
//   node scripts/check-sic-change-notice.mjs
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift, grabFunction } from "./lib/earnings-plan.mjs";
import { lookupSpellingIn } from "../lib/symbolSpellings.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (src, from, to) => {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`mutation anchor matched ${n} times: ${from.slice(0, 60)}`);
  return src.replace(from, to);
};

const SRC = fs.readFileSync("lib/server/secSicChange.ts", "utf8");
globalThis.__lookupSpellingIn = lookupSpellingIn;
const load = (src) => lift([
  "const lookupSpellingIn = globalThis.__lookupSpellingIn;",
  "const REGISTRANTS = {};",
  // `code` is a const arrow, so it is read out of the source as-is.
  src.match(/^const code = [\s\S]*?^};$/m)?.[0] ?? "",
  grabFunction(src, "sicChangeOf"),
  "export { sicChangeOf };",
].join("\n"));
const rows = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;

console.log("1. sicChangeOf, on real registrant rows");
{
  const M = await load(SRC);
  const aaplSic = rows.AAPL.sic;
  check("same code → no notice", M.sicChangeOf("AAPL", { sic: aaplSic }, rows) === null);
  check("SEC's numeric form of the same code → no notice", M.sicChangeOf("AAPL", { sic: Number(aaplSic) }, rows) === null);
  const moved = M.sicChangeOf("AAPL", { sic: "7372", sicDescription: "Services-Prepackaged Software" }, rows);
  check("a moved code → a notice naming both codes",
    moved?.symbol === "AAPL" && moved.was === aaplSic && moved.now === "7372" && moved.description === "Services-Prepackaged Software",
    JSON.stringify(moved));
  check("no SIC in the submissions → no notice", M.sicChangeOf("AAPL", {}, rows) === null && M.sicChangeOf("AAPL", { sic: "" }, rows) === null);
  check("a symbol with no registrant row → no notice", M.sicChangeOf("ZZZZNOTREAL", { sic: "7372" }, rows) === null);
  check("BRK.B reaches the BRK-B row", M.sicChangeOf("BRK.B", { sic: rows["BRK-B"].sic }, rows) === null &&
    M.sicChangeOf("BRK.B", { sic: "9999" }, rows)?.was === rows["BRK-B"].sic);
  const Mm = await load(once(SRC, "if (!was || !now || was === now) return null;", "if (!was || !now) return null;"));
  check("MUTATION: without the equality test every filer is flagged", Mm.sicChangeOf("AAPL", { sic: aaplSic }, rows) !== null);
}

console.log("\n2. the cost rule");
const JOB = readCodeOnly("lib/server/secFilingJob.ts");
check("checkAndFill fetches submissions ONCE and hands the same payload to both uses",
  (JOB.match(/fetch\.submissions\(/g) ?? []).length === 1 && /const sicChange = sicChangeOf\(symbol, subs\)/.test(JOB) &&
    /newestPeriodicFiling\(subs\)/.test(JOB));
const ROUTE_FILE = "app/api/jobs/sec-filings/route.ts";
const writesOnceAfterLoop = (route) => {
  const loopStart = route.indexOf("for (const { symbol, cik } of candidates)");
  const loopEnd = route.indexOf("const stateWritten = await writeFilingState(updates);");
  const call = route.indexOf("await recordSicChanges(");
  return loopStart > 0 && loopEnd > loopStart && call > loopEnd && (route.match(/recordSicChanges\(/g) ?? []).length === 1 &&
    /if \(out\.sicChange\) sicChanges\.push\(out\.sicChange\);/.test(route.slice(loopStart, loopEnd));
};
const ROUTE = readCodeOnly(ROUTE_FILE);
check("the route collects inside the loop and writes ONCE after it", writesOnceAfterLoop(ROUTE));
check("...and reports the count in the run summary", /sicChanged,/.test(ROUTE));
check("recordSicChanges writes nothing for an empty run, and one HSET otherwise",
  /changes\.length === 0\) return 0;/.test(readCodeOnly("lib/server/secSicChange.ts")) &&
    (readCodeOnly("lib/server/secSicChange.ts").match(/redis\.hset\(/g) ?? []).length === 1);
{
  const mutated = once(ROUTE, "if (out.sicChange) sicChanges.push(out.sicChange);",
    "if (out.sicChange) await recordSicChanges([out.sicChange], today);");
  check("MUTATION: a write inside the loop fails the cost rule", !writesOnceAfterLoop(mutated));
}

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
