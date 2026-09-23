// THE FILING JOB (#535 COWORK #10, trigger B per COWORK #12).
//
// The schedule IS the staleness promise, so it is run, not read:
//   1. runMode: every hour during the catch-up; 04 and 16 UTC nightly; every
//      even hour in reporting season; idle otherwise. Worst case, a due
//      filer's filing is read within 2 hours in season.
//   2. pickCandidates: recorded lags first, then the due list, then (nightly
//      and catch-up only) the daily index's new filers and the never-checked
//      sweep; a season run never sweeps.
//   3. the caps: 60 fills, <= 5 SEC requests a second, a budget inside the
//      function limit.
//   4. isDueNow, the due-list rule.
//   5. wiring: the cron, the state hash (never the manifest), the catch-up
//      ending itself, and sec-facts keeping a filled period from the set.
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift, grabFunction } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const SRC = fs.readFileSync("lib/server/secFilingJob.ts", "utf8");
const constant = (name) => SRC.match(new RegExp(`export const ${name}[^=]*= [\\s\\S]*?;\\n`))?.[0];
const J = await lift([
  constant("FILING_JOB_NIGHTLY_HOURS"),
  constant("REPORTING_SEASONS"),
  constant("FILING_JOB_FILLS_PER_RUN"),
  constant("FILING_JOB_PACE_MS"),
  constant("FILING_JOB_BUDGET_MS"),
  grabFunction(SRC, "inReportingSeason"),
  grabFunction(SRC, "runMode"),
  grabFunction(SRC, "pickCandidates"),
].join("\n").replace(/export const/g, "const") +
  "\nexport { runMode, inReportingSeason, pickCandidates, FILING_JOB_FILLS_PER_RUN, FILING_JOB_PACE_MS, FILING_JOB_BUDGET_MS };");

console.log("1. the schedule");
const at = (iso) => new Date(iso);
check("the catch-up acts every hour", [0, 1, 7, 13, 23].every((h) => J.runMode(at(`2026-09-24T${String(h).padStart(2, "0")}:40:00Z`), false) === "catch-up"));
check("off season: only 04 and 16 UTC act, as the nightly sweep",
  Array.from({ length: 24 }, (_, h) => J.runMode(at(`2026-09-24T${String(h).padStart(2, "0")}:40:00Z`), true))
    .every((m, h) => (h === 4 || h === 16 ? m === "nightly" : m === "idle")));
{
  const modes = Array.from({ length: 24 }, (_, h) => J.runMode(at(`2026-08-04T${String(h).padStart(2, "0")}:40:00Z`), true));
  check("in season: every even hour acts (04 and 16 as the nightly sweep), odd hours idle",
    modes.every((m, h) => (h === 4 || h === 16 ? m === "nightly" : h % 2 === 0 ? m === "season" : m === "idle")),
    modes.join(","));
  const acting = modes.map((m, h) => (m === "idle" ? null : h)).filter((h) => h !== null);
  const gaps = acting.map((h, i) => ((acting[(i + 1) % acting.length] - h + 24) % 24) || 24);
  check("in season the longest gap between runs is 2 hours — the worst-case staleness for a due filer", Math.max(...gaps) === 2, `gaps ${gaps.join(",")}`);
}
check("the season windows are the ruled ones",
  ["2026-01-20", "2026-02-28", "2026-04-15", "2026-05-15", "2026-07-15", "2026-08-14", "2026-10-15", "2026-11-14"].every(J.inReportingSeason) &&
    !["2026-01-19", "2026-03-01", "2026-06-01", "2026-09-23", "2026-12-15"].some(J.inReportingSeason));

console.log("\n2. who a run checks");
const NOW = Date.parse("2026-08-04T10:40:00Z");
const H = 3_600_000;
const entries = [
  ["LAG", { cik: "1", lastFiled: "20260801" }],
  ["NOTICE", { cik: "2", lastFiled: "20260801" }],
  ["DUE", { cik: "3", lastFiled: "20260501" }],
  ["DUEFRESH", { cik: "4", lastFiled: "20260501" }],
  ["NEWFILE", { cik: "5", lastFiled: "20260803" }],
  ["NEVER", { cik: "6", lastFiled: "20260802" }],
  ["QUIET", { cik: "7", lastFiled: "20260501" }],
  ["NOCIK", { cik: null, lastFiled: "20260803" }],
  ["GONE", { cik: "9", delisted: true, lastFiled: "20260803" }],
];
const state = new Map([
  ["LAG", { c: NOW - 30 * H, lag: { accn: "a", reportDate: "2026-06-30", kind: "filled" } }],
  ["NOTICE", { c: NOW - 30 * H, lag: { accn: "b", reportDate: "2026-06-30", kind: "notice" } }],
  ["DUE", { c: NOW - 3 * H }],
  ["DUEFRESH", { c: NOW - 1 * H }],
  ["NEWFILE", { c: Date.parse("2026-08-02T04:40:00Z") }],
  ["QUIET", { c: NOW - 30 * H }],
]);
const due = new Set(["DUE", "DUEFRESH"]);
const names = (mode) => J.pickCandidates(mode, entries, state, due, NOW).map((c) => c.symbol);
check("nightly: lag, then due, then the index's new filer, then the never-checked", JSON.stringify(names("nightly")) === JSON.stringify(["LAG", "DUE", "NEWFILE", "NEVER"]), names("nightly").join(","));
check("a season run checks lags and the due list only — no sweep", JSON.stringify(names("season")) === JSON.stringify(["LAG", "DUE"]), names("season").join(","));
check("a notice-only lag waits a week, not a day", !names("nightly").includes("NOTICE"));
check("a due filer checked under 2 hours ago is not re-read", !names("season").includes("DUEFRESH"));
check("no CIK and delisted are never candidates", !names("catch-up").some((s) => s === "NOCIK" || s === "GONE"));
check("idle checks nobody", names("idle").length === 0);

console.log("\n3. the caps");
check("60 fills a run", J.FILING_JOB_FILLS_PER_RUN === 60);
check("SEC at <= 5 requests a second", 1000 / J.FILING_JOB_PACE_MS <= 5, `${1000 / J.FILING_JOB_PACE_MS}/s`);
const ROUTE = readCodeOnly("app/api/jobs/sec-filings/route.ts");
const maxDuration = Number(ROUTE.match(/export const maxDuration = (\d+);/)?.[1]);
check("the budget sits inside the function limit with room for the state write", J.FILING_JOB_BUDGET_MS <= (maxDuration - 45) * 1000, `${J.FILING_JOB_BUDGET_MS}ms vs ${maxDuration}s`);
check("every SEC request goes through the one paced gate",
  (ROUTE.match(/await fetch\(/g) ?? []).length === 1 && /lastAt \+ FILING_JOB_PACE_MS - Date\.now\(\)/.test(ROUTE));
check("the loop stops at the fill cap and the budget", /tally\.filled \+ tally\.notice >= FILING_JOB_FILLS_PER_RUN/.test(ROUTE) && /Date\.now\(\) - started > FILING_JOB_BUDGET_MS/.test(ROUTE));

console.log("\n4. the due rule");
{
  const DUE = fs.readFileSync("lib/server/secFilingDue.ts", "utf8");
  const D = await lift(grabFunction(DUE, "isDueNow"));
  check("due, expected within 7 days, and an estimate already past are due",
    D.isDueNow({ kind: "due" }) && D.isDueNow({ kind: "expected", band: "d0_7" }) && D.isDueNow({ kind: "no-estimate", reason: "estimate-in-past" }));
  check("later bands and other refusals wait for the nightly sweep",
    !D.isDueNow({ kind: "expected", band: "d8_21" }) && !D.isDueNow({ kind: "no-estimate", reason: "thin-history" }) && !D.isDueNow({ kind: "beyond-window" }));
}

console.log("\n5. wiring");
const vercel = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
check("the cron fires hourly at :40", vercel.crons.some((c) => c.path === "/api/jobs/sec-filings" && c.schedule === "40 * * * *"));
check("the job never writes the manifest; its state is its own hash",
  !/writeManifest/.test(ROUTE) && /await writeFilingState\(updates\)/.test(ROUTE));
check("the catch-up ends itself only after a run got through every candidate",
  /if \(mode === "catch-up" && stoppedBy === "done"\) await markCatchUpDone\(\);/.test(ROUTE));
check("the flush follows the write", ROUTE.indexOf("revalidatePath(`/stock/${symbol}`)") > ROUTE.indexOf("if (!(await writeFactSet(out.set))) throw"));
const FACTS = readCodeOnly("app/api/jobs/sec-facts/route.ts");
check("sec-facts no longer reads filings itself", !/fetchFilingInstance|const filingFill = \{/.test(FACTS));
check("...and keeps a filled period by the set's own stamp until the feed carries it",
  /const keepFilled = Boolean\(prior\?\.ff && freshNewest < prior\.ff\.reportDate\);/.test(FACTS) &&
    /const keepNotice = Boolean\(prior\?\.lg && freshNewest < prior\.lg\.reportDate\);/.test(FACTS));

if (failures) {
  console.log(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nThe filing job's schedule and caps hold.");
