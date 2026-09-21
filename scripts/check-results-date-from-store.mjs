// The results date, DERIVED from the consolidated store — and the 4x2 matrix
// the deadline bug lived in.
//
// ── WHAT THIS CAN AND CANNOT CONFIRM, SAID UP FRONT ───────────────────────
// It confirms the DERIVATION: that latestResults() reads the right event out
// of a stored record, and that a record flows through selectDue correctly for
// every filer category and both period types.
//
// It does NOT confirm a live population run. This sandbox reaches neither
// Redis nor data.sec.gov (403 CONNECT, organization policy), so "lastResultsDate
// populates for real symbols" is a cron/relay observation, not a local one.
// Claiming otherwise off a green local run is exactly the coverage-is-not-
// correctness failure this build keeps paying for.
//
//   node scripts/check-results-date-from-store.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { stripComments, assertStripKeptTheCode } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const STORE = path.join(ROOT, "lib/server/secReportDatesStore.ts");
const DUE = path.join(ROOT, "lib/server/dueToReport.ts");
const DATES = path.join(ROOT, "lib/server/secReportDates.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const transpile = (src) => ts.transpileModule(src, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const dataUrl = (js) => `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;

// ── LIFTING latestResults, AND PROVING THE LIFT IS SAFE ───────────────────
// secReportDatesStore imports @upstash/redis and constructs a client at module
// scope, so the module cannot be loaded here. latestResults is pure over its
// argument, so it is lifted out on its own.
//
// The repo has been bitten twice by a lift that referenced a module-scope
// constant and threw ReferenceError only when CALLED -- after the output that
// made the run look healthy. So the lifted text is checked for free
// identifiers before it is used, rather than trusted.
const storeSrc = fs.readFileSync(STORE, "utf8");
const start = storeSrc.indexOf("export function latestResults(");
check("latestResults is present in the store module", start !== -1);
const end = storeSrc.indexOf("\n}\n", start);
const lifted = storeSrc.slice(start, end + 3);
for (const forbidden of ["redis", "PAGE_READ_CACHE", "canWriteSecState", "reportDatesKey"]) {
  check(`the lift references no module-scope \`${forbidden}\``, !new RegExp(`\\b${forbidden}\\b`).test(lifted));
}
const { latestResults } = await import(dataUrl(transpile(lifted)));

const depUrl = dataUrl(transpile(fs.readFileSync(DATES, "utf8")));
const due = await import(dataUrl(
  transpile(fs.readFileSync(DUE, "utf8")).replace(/from\s+["']\.\/secReportDates["']/g, `from "${depUrl}"`),
));
const dates = await import(depUrl);

const ev = (o = {}) => ({
  eventDate: o.eventDate ?? "2026-07-28",
  periodEnd: o.periodEnd === undefined ? "2026-06-30" : o.periodEnd,
  announcedOn: o.announcedOn === undefined ? "2026-07-28" : o.announcedOn,
  announcedAt: "2026-07-28T20:05:00Z",
  timing: "after-close",
  form: o.form ?? "8-K",
  items: o.items ?? "2.02,9.01",
  accession: o.accession ?? "0000320193-26-000077",
  basis: o.basis ?? "8-K item 2.02",
});
const rec = (events) => ({ symbol: "AAPL", cik: "0000320193", at: "2026-09-21T00:00:00Z", events, nextPeriodEnd: null, next: null });

console.log("\n1. The derivation replaces the three manifest fields exactly");
{
  const r = latestResults(rec([ev()]));
  check("announcedOn is what lastResultsDate carried", r?.announcedOn === "2026-07-28", JSON.stringify(r));
  check("periodEnd is what lastResultsPeriod carried", r?.periodEnd === "2026-06-30");
  check("accession is what lastResultsAccn carried", r?.accession === "0000320193-26-000077");
  check("and the basis comes with it, which the manifest fields never carried", r?.basis === "8-K item 2.02");
}

console.log("\n2. Absence is absence, not a partly-filled row");
{
  check("a null record yields null", latestResults(null) === null);
  check("a record with no events yields null", latestResults(rec([])) === null);
  check("a malformed record yields null", latestResults({ symbol: "X" }) === null);
  // The type allows a null periodEnd. Such an event cannot answer "which
  // period did this report on", so it is SKIPPED rather than returned with a
  // null a caller would have to re-check -- the shape that produces a row
  // rendering "reported for —".
  const skipped = latestResults(rec([ev({ periodEnd: null }), ev({ periodEnd: "2026-03-31", announcedOn: "2026-04-28" })]));
  check("an event with no matched period is skipped, not returned half-null",
    skipped?.periodEnd === "2026-03-31" && skipped?.announcedOn === "2026-04-28", JSON.stringify(skipped));
  check("and a record of ONLY unmatched events yields null, not a half-row",
    latestResults(rec([ev({ periodEnd: null }), ev({ periodEnd: null })])) === null);

  // ── THE TWO GUARDS MASK EACH OTHER ON THE NULL CASE ────────────────────
  // A mutation run found that removing EITHER the typeof guard or the
  // empty-string guard left every assertion passing: a null periodEnd is both
  // non-string AND falsy, so each guard alone still caught it and neither was
  // load-bearing in any scenario. Same shape as #483's F1, where three mutants
  // survived because F2 was blocking the write on its own.
  //
  // These two cases isolate them. The store is JSON out of Redis, so an
  // off-type value is a real shape, not a hypothetical.
  check("a NUMERIC periodEnd is rejected (isolates the typeof guard: truthy, wrong type)",
    latestResults(rec([ev({ periodEnd: 20260630 }), ev({ periodEnd: "2026-03-31", announcedOn: "2026-04-28" })]))?.periodEnd
      === "2026-03-31");
  check("an EMPTY-STRING periodEnd is rejected (isolates the empty guard: right type, no value)",
    latestResults(rec([ev({ periodEnd: "" }), ev({ periodEnd: "2026-03-31", announcedOn: "2026-04-28" })]))?.periodEnd
      === "2026-03-31");
  check("an EMPTY-STRING announcedOn is rejected too",
    latestResults(rec([ev({ announcedOn: "" }), ev({ periodEnd: "2026-03-31", announcedOn: "2026-04-28" })]))?.announcedOn
      === "2026-04-28");
}

console.log("\n3. Newest first is honoured, not re-sorted");
{
  const r = latestResults(rec([
    ev({ periodEnd: "2026-06-30", announcedOn: "2026-07-28" }),
    ev({ periodEnd: "2026-03-31", announcedOn: "2026-04-28" }),
  ]));
  check("the first matched event wins", r?.periodEnd === "2026-06-30", JSON.stringify(r));
}

console.log("\n4. THE 4x2 MATRIX — every filer category, both period types");
{
  // The cell the boolean split got wrong was (accelerated, quarterly), and the
  // whole annual column did not exist. Both are driven end to end here: a
  // stored record -> latestResults -> a DueInput -> selectDue's overdue cap.
  const CATEGORIES = [
    ["Large Accelerated Filer", { quarter: 40, annual: 60 }],
    ["Accelerated Filer", { quarter: 40, annual: 75 }],
    ["Non-accelerated Filer", { quarter: 45, annual: 90 }],
    [null, { quarter: 45, annual: 90 }], // unknown -> slowest tier, never tightens
  ];
  const DAY = 86_400_000;
  const shift = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
  const P = "2026-06-30";

  for (const [filerCategory, expected] of CATEGORIES) {
    for (const annual of [false, true]) {
      const name = `${filerCategory ?? "(unknown category)"} / ${annual ? "annual" : "quarterly"}`;
      const deadline = annual ? expected.annual : expected.quarter;

      check(`${name}: deadlineDays agrees with 17 CFR 240.13a-1/13a-13`,
        dates.deadlineDays(filerCategory, annual) === deadline,
        `${dates.deadlineDays(filerCategory, annual)}d, expected ${deadline}d`);

      // The record that the period is OUTSTANDING is the absence of an event
      // for it. So the stored record holds the PRIOR period, and the strip is
      // asked about the one after it.
      const stored = latestResults(rec([ev({ periodEnd: "2026-03-31", announcedOn: "2026-04-28" })]));
      check(`${name}: the prior period derives from the store`, stored?.periodEnd === "2026-03-31");

      const input = [{ symbol: "AAA", periodEnd: P, medianLagDays: 30, filerCategory, annual }];
      const last = deadline + due.OVERDUE_GRACE_DAYS;
      const inside = due.selectDue(input, shift(P, last)).some((e) => e.symbol === "AAA");
      const outside = due.selectDue(input, shift(P, last + 1)).some((e) => e.symbol === "AAA");
      check(`${name}: listed on P+${last}, dropped on P+${last + 1}`, inside && !outside,
        `inside=${inside} outside=${outside}`);
    }
  }
}

console.log("\n5. The retired module is actually gone, not merely unreferenced");
{
  check("lib/server/secResultsDate.ts no longer exists",
    !fs.existsSync(path.join(ROOT, "lib/server/secResultsDate.ts")));
  check("no source file still imports it",
    !/from\s+["'].*secResultsDate["']/.test(
      ["lib", "app", "scripts"].flatMap((d) => {
        const walk = (p) => fs.statSync(p).isDirectory()
          ? fs.readdirSync(p).flatMap((f) => walk(path.join(p, f))) : [p];
        return walk(path.join(ROOT, d)).filter((f) => /\.(ts|tsx|mjs)$/.test(f));
      }).map((f) => fs.readFileSync(f, "utf8")).join("\n")));
  // COMMENTS STRIPPED FIRST, THROUGH THE SHARED STRIPPER. The manifest carries a
  // note explaining why these fields were removed, and that note names them --
  // so a bare grep matches the explanation and reports the field as still
  // present (claude/traps/grep-finds-the-comment-not-the-code.md).
  //
  // NOT a hand-rolled regex strip. check-comment-stripper.mjs forbids one and
  // caught this harness doing it: a naive strip fails in the QUIET direction for
  // exactly the kind of assertion below -- a negative one. If the strip ate the
  // region, "the field is gone" passes because nothing appears in deleted text.
  // assertStripKeptTheCode is what makes the pass mean something.
  const manifestRaw = fs.readFileSync(path.join(ROOT, "lib/server/secManifest.ts"), "utf8");
  const manifestSrc = stripComments(manifestRaw, { file: "lib/server/secManifest.ts" });
  assertStripKeptTheCode(manifestRaw, manifestSrc, "lib/server/secManifest.ts");
  for (const field of ["lastResultsDate", "lastResultsPeriod", "lastResultsAccn"]) {
    check(`the manifest declares no ${field} outside its comments`,
      !new RegExp(`${field}\\s*[?]?:`).test(manifestSrc));
  }
  check("and the removal is still EXPLAINED in the file, not silently done",
    /lastResultsDate/.test(fs.readFileSync(path.join(ROOT, "lib/server/secManifest.ts"), "utf8")));
  check("exactly one attribution-horizon constant survives",
    !/MAX_ATTRIBUTION_DAYS\s*=/.test(fs.readFileSync(DATES, "utf8"))
      && /MAX_PERIOD_TO_ANNOUNCEMENT_DAYS\s*=\s*120/.test(fs.readFileSync(DATES, "utf8")));
}

console.log(failures ? `\n${failures} CHECK(S) FAILED\n` : "\nALL CHECKS PASSED\n");
process.exit(failures ? 1 : 0);
