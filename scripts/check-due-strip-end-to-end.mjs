// THE DUE STRIP, END TO END: a submissions history goes through the REAL record
// builder (buildReportDatesRecord -> pairing -> pendingResults with the
// early-2.02 guard) and the resulting record through the REAL dueInputFrom.
//
// Why this exists (review of #520): check-due-inputs R fed dueInputFrom a TSLA
// record with `pending: null` typed in by hand, which assumes the claim under
// test -- that TSLA's delivery 8-K never becomes pending. Here the pending comes
// out of the builder.
//
//   node scripts/check-due-strip-end-to-end.mjs
import ts from "typescript";
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

/** One declaration's source, found by the TS parser. */
const decl = (file, name) => {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true);
  const n = sf.statements.find((s) =>
    (ts.isFunctionDeclaration(s) && s.name?.text === name) ||
    (ts.isVariableStatement(s) && s.declarationList.declarations.some((d) => d.name.getText(sf) === name)));
  if (!n) throw new Error(`${name} not found in ${file}`);
  return n.getText(sf).replace(/^export /, "");
};

const RD = readCodeOnly("lib/server/secReportDates.ts").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
  .replace(/export (const|function|type)/g, "$1");
const STORE_LIMIT = decl("lib/server/secReportDatesStore.ts", "STORED_EVENT_LIMIT");
const BUILDER = decl("lib/server/secReportDatesWrite.ts", "buildReportDatesRecord");
const GUARD = "  if (looksLikeEarlyNonResults(daysBetween(periodEnd, latest.announcedOn), pattern)) return null;\n";
if (!RD.includes(GUARD)) { console.error("FATAL: the pendingResults guard line moved"); process.exit(2); }
const loadBuilder = (mutate = (s) => s) => lift(mutate(RD) + "\n" + STORE_LIMIT + "\n" + BUILDER +
  "\nexport { buildReportDatesRecord };", "", "buildReportDatesRecord");
const DUE = await lift(decl("lib/server/dueInputs.ts", "ANNUAL_WHEN_UNKNOWN") + "\n" +
  decl("lib/server/dueInputs.ts", "dueInputFrom") + "\nexport { dueInputFrom };", "", "dueInputFrom");
const B = await loadBuilder();

const DAY = 86_400_000;
const plus = (iso, d) => new Date(Date.parse(iso) + d * DAY).toISOString().slice(0, 10);
// A filing row: `at` is ET noon-ish, so the ET date is the ISO date.
const row = (form, reportDate, filed, items) => ({ form, reportDate, filed, items });
const subsOf = (rows, category = "Large accelerated filer") => ({
  category,
  filings: { recent: {
    accessionNumber: rows.map((_, i) => `0000000000-26-${String(i).padStart(6, "0")}`),
    form: rows.map((r) => r.form),
    items: rows.map((r) => r.items ?? ""),
    reportDate: rows.map((r) => r.reportDate),
    filingDate: rows.map((r) => r.filed),
    acceptanceDateTime: rows.map((r) => `${r.filed}T16:00:00.000Z`),
  } },
});
const setOf = (quarters, years) => ({ quarters: quarters.map((e) => ({ e })), years: years.map((e) => ({ e })) });

// ── TSLA: delivery 2.02 at lag 2, results 2.02 at ~23, 10-Q/10-K the day after ──
const TQ = ["2024-09-30", "2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"];
const tRows = [];
for (const p of TQ) {
  const annual = p.endsWith("12-31");
  tRows.push(row("8-K", plus(p, 2), plus(p, 2), "2.02,9.01"));
  tRows.push(row("8-K", plus(p, annual ? 28 : 22), plus(p, annual ? 28 : 22), "2.02,9.01"));
  tRows.push(row(annual ? "10-K" : "10-Q", p, plus(p, annual ? 29 : 23)));
}
// The CURRENT period's delivery numbers: Q3 2026, filed Oct 2 at lag 2.
tRows.push(row("8-K", "2026-10-02", "2026-10-02", "2.02,9.01"));
const tSet = setOf(TQ, ["2024-12-31", "2025-12-31"]);
const TODAY_T = "2026-10-03";

console.log("\n1. TSLA: a current-period delivery 8-K does NOT mark Q3 results as filed");
const tsla = B.buildReportDatesRecord("TSLA", "1318605", tSet, subsOf(tRows), TODAY_T, `${TODAY_T}T04:20:00.000Z`);
check("the builder derives TSLA's early non-results pattern from the pairing",
  tsla.earlyNonResults?.earlyLagDays === 2 && tsla.earlyNonResults.periods >= 2, JSON.stringify(tsla.earlyNonResults));
check("pending stays NULL after the Oct 2 delivery 8-K", tsla.pending === null, JSON.stringify(tsla.pending));
check("the record is still for Q3 (2026-09-30), dated on the results habit",
  tsla.nextPeriodEnd === "2026-09-30" && tsla.next.kind === "date" && tsla.next.medianLagDays >= 20,
  `${tsla.nextPeriodEnd} ${JSON.stringify(tsla.next)}`);
const tIn = DUE.dueInputFrom("TSLA", tsla);
check("...so TSLA stays a due input for the period", "input" in tIn && tIn.input.periodEnd === "2026-09-30", JSON.stringify(tIn));

console.log("\n2. control: MU files its results at its normal lag -> pending -> 'results-filed'");
// MU: fiscal quarters on the last Thursday; one 2.02 a quarter at lag 30, the
// 10-Q ten days later. The current quarter (2026-08-27) is not in the fact set
// yet, and its 2.02 lands Sep 23 -- lag 27, early for MU, before the estimate.
const MQ = ["2024-08-29", "2024-11-28", "2025-02-27", "2025-05-29", "2025-08-28", "2025-11-27", "2026-02-26", "2026-05-28"];
const mRows = [];
for (const p of MQ) {
  const annual = p.startsWith("2024-08") || p.startsWith("2025-08");
  mRows.push(row("8-K", plus(p, 30), plus(p, 30), "2.02,9.01"));
  mRows.push(row(annual ? "10-K" : "10-Q", p, plus(p, annual ? 45 : 40)));
}
mRows.push(row("8-K", "2026-09-23", "2026-09-23", "2.02,9.01"));
const mSet = setOf(MQ, ["2024-08-29", "2025-08-28"]);
const TODAY_M = "2026-09-24";
const mu = B.buildReportDatesRecord("MU", "723125", mSet, subsOf(mRows), TODAY_M, `${TODAY_M}T04:20:00.000Z`);
check("MU has no early pattern (one 2.02 a quarter)", mu.earlyNonResults === null, JSON.stringify(mu.earlyNonResults));
check("pending names the quarter just announced", mu.pending?.periodEnd === "2026-08-27" && mu.pending?.announcedOn === "2026-09-23",
  JSON.stringify(mu.pending));
check("the record is still for that quarter (the estimate had not passed)", mu.nextPeriodEnd === "2026-08-27",
  `${mu.nextPeriodEnd} ${JSON.stringify(mu.next)}`);
const mIn = DUE.dueInputFrom("MU", mu);
check("...so MU is skipped as 'results-filed' -- off the strip the day after filing",
  mIn.skip === "results-filed", JSON.stringify(mIn));

console.log("\n3. mutation: the guard's effect on pending");
const noGuard = await loadBuilder((s) => s.replace(GUARD, ""));
const tslaNoGuard = noGuard.buildReportDatesRecord("TSLA", "1318605", tSet, subsOf(tRows), TODAY_T, `${TODAY_T}T04:20:00.000Z`);
check("MUTATION: without the guard, the delivery 8-K becomes Q3's pending results",
  tslaNoGuard.pending?.announcedOn === "2026-10-02", JSON.stringify(tslaNoGuard.pending));
check("MUTATION: ...and TSLA is taken off the due strip as 'results-filed'",
  DUE.dueInputFrom("TSLA", tslaNoGuard).skip === "results-filed");
check("the mutation leaves the MU control unchanged (the guard is not what MU relies on)",
  noGuard.buildReportDatesRecord("MU", "723125", mSet, subsOf(mRows), TODAY_M, `${TODAY_M}T04:20:00.000Z`).pending?.periodEnd === "2026-08-27");

console.log(failures ? `\n${failures} CHECK(S) FAILED\n` : "\nALL CHECKS PASSED\n");
process.exit(failures ? 1 : 0);
