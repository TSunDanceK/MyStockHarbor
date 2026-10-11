// THE GRID'S DAY INDEX (#535 COWORK #18 §3): which companies announced
// results on which day, mirrored from the report-dates records.
//   1. an 8-K 2.02 event and a `pending` announcement count; a 6-K does not
//      (COWORK #23 rule C) — MUTATION: the 6-K exclusion removed;
//   2. the inversion admits only the symbols it is told to;
//   3. every record write mirrors into it, only after the record is stored;
//      the rewrite job backfills it once, below a threshold.
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift, grabFunction } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const SRC = readCodeOnly("lib/server/secResultsDays.ts");
const load = (mutate = (s) => s) => lift(
  [grabFunction(mutate(SRC), "resultsDaysOf"), grabFunction(SRC, "symbolsByDay")].join("\n").replace(/export function/g, "function") +
  "\nexport { resultsDaysOf, symbolsByDay };");
const R = await load();

const rec = {
  events: [
    { announcedOn: "2026-07-30", form: "8-K" },
    { announcedOn: "2026-05-01", form: "6-K" },
    { announcedOn: "2026-04-29", form: "8-K" },
  ],
  pending: { announcedOn: "2026-09-23", periodEnd: "2026-08-27", timing: "after-close" },
};
console.log("1. what counts");
const days = R.resultsDaysOf(rec);
check("8-K events and the pending announcement, newest first", JSON.stringify(days) === JSON.stringify(["2026-09-23", "2026-07-30", "2026-04-29"]), JSON.stringify(days));
check("a 6-K is not listed as reported results", !days.includes("2026-05-01"));
check("no record, no days", R.resultsDaysOf(null).length === 0);
{
  const M = await load((s) => s.replace('if (typeof e.form === "string" && e.form.startsWith("6-K")) continue;', ""));
  check("MUTATION: without the exclusion the 6-K day comes back", M.resultsDaysOf(rec).includes("2026-05-01"));
}

console.log("\n2. the inversion");
const by = R.symbolsByDay(new Map([["MU", ["2026-09-23"]], ["OTC1", ["2026-09-23"]], ["AAPL", ["2026-07-30"]]]), (s) => s !== "OTC1");
check("day -> admitted symbols only", JSON.stringify(by.get("2026-09-23")) === JSON.stringify(["MU"]) && JSON.stringify(by.get("2026-07-30")) === JSON.stringify(["AAPL"]));

console.log("\n3. the writers");
const w = readCodeOnly("lib/server/secReportDatesWrite.ts");
check("buildAndWriteReportDates mirrors the record, only once it is stored",
  /const ok = await writeReportDates\(rec\);\s*if \(ok\) await recordResultsDays\(symbol, rec\);/.test(w));
const job = readCodeOnly("app/api/jobs/sec-report-dates-rewrite/route.ts");
check("the rewrite job backfills below the threshold, once",
  /indexed !== null && indexed < RESULTS_DAYS_BACKFILL_BELOW\s*\? await backfillResultsDays\(SEC_REPORT_DATES_PREFIX\)/.test(job));
check("the index is written behind the preview gate", (SRC.match(/if \(!canWriteSecState\(\)\)/g) ?? []).length === 2);

if (failures) {
  console.log(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nThe day index lists 8-K results and today's announcements, never a 6-K.");
