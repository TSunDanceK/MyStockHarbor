// The results date is the spine of both halves of /earnings-calendar, so its
// attribution is RUN against real filings rather than pattern-matched.
//
// Every claim here is about behaviour over inputs -- "strict falls back only on
// zero", "an FPI's same-day 6-K pair resolves to the period one", "a 52/53-week
// period end is read, never derived". A regex can see that 9.01 appears in the
// source; it cannot see which arm chose the filing.
//
// THE REAL FIXTURE IS LOAD-BEARING. scripts/fixtures/sec-submissions-mu.json is
// a live submissions payload, and MU is a 52/53-week filer whose quarter ended
// 2026-05-28 -- not a month end, not a calendar quarter. A synthetic fixture on
// tidy calendar dates would pass against date arithmetic that is wrong for a
// large share of real filers.
//
//   node scripts/check-sec-results-date.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "lib/server/secResultsDate.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const raw = fs.readFileSync(SRC, "utf8");
const js = ts.transpileModule(raw, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const m = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

const row = (o) => ({ accn: o.accn ?? `a${Math.random()}`, form: o.form, filingDate: o.filingDate ?? "", reportDate: o.reportDate ?? "", items: o.items ?? "" });

// ── 1. The real MU payload ─────────────────────────────────────────────────
console.log("\n1. A live submissions payload — MU, a 52/53-week filer");
{
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/fixtures/sec-submissions-mu.json"), "utf8"));
  const rows = m.flattenFilings(fixture?.filings?.recent);
  check("the column store flattens to rows", rows.length > 0, `${rows.length} filings`);
  check("MU is NOT classified as a foreign private issuer", m.isForeignPrivateIssuer(rows) === false);

  const ends = m.domesticPeriodEnds(rows);
  check("its period end is read off the filing, not derived", ends.includes("2026-05-28"), `ends: ${ends.join(" ")}`);
  check(
    "and it is NOT a month end or a calendar quarter",
    !/(-03-31|-06-30|-09-30|-12-31)$/.test("2026-05-28"),
    "28 May — arithmetic that assumes calendar quarters is wrong here"
  );

  const latest = m.latestResults(rows);
  check("the 2.02 + 9.01 8-K is attributed to it", latest?.periodEnd === "2026-05-28" && latest?.filed === "2026-06-24", JSON.stringify(latest));
  check("and it is chosen by the STRICT arm", latest?.rule === "strict");
  check(
    "the 5.02 + 9.01 8-K is NOT mistaken for a results release",
    latest?.filed !== "2026-08-26",
    "9.01 alone is an exhibit list — 2.02 is what makes it results"
  );
}

// ── 2. Strict falls back ONLY on zero ──────────────────────────────────────
console.log("\n2. The fallback fires on zero and never on one");
{
  const base = [row({ form: "10-Q", reportDate: "2026-03-31", filingDate: "2026-05-05" }), row({ form: "10-Q", reportDate: "2026-06-30", filingDate: "2026-08-05" })];
  // Two candidates, one carrying 9.01: strict resolves to ONE, so the loose
  // first-candidate must NOT be taken.
  const oneStrict = m.latestResults([
    ...base,
    row({ accn: "early", form: "8-K", filingDate: "2026-04-10", items: "2.02" }),
    row({ accn: "real", form: "8-K", filingDate: "2026-04-28", items: "2.02,9.01" }),
  ].filter((r) => r.reportDate !== "2026-06-30"));
  check("strict resolving to one is used, not the earlier loose candidate", oneStrict?.accn === "real", JSON.stringify(oneStrict));
  check("and it is labelled strict", oneStrict?.rule === "strict");

  // No candidate carries 9.01: strict resolves to ZERO, so loose applies.
  const zeroStrict = m.latestResults([
    base[0],
    row({ accn: "only", form: "8-K", filingDate: "2026-04-20", items: "2.02" }),
  ]);
  check("strict resolving to zero falls back to loose", zeroStrict?.accn === "only" && zeroStrict?.rule === "loose", JSON.stringify(zeroStrict));
}

// ── 3. The attribution ceiling ─────────────────────────────────────────────
console.log("\n3. A period with no release does not adopt the next period's");
{
  const rows = [
    row({ form: "10-Q", reportDate: "2026-03-31", filingDate: "2026-05-05" }),
    // Filed 150 days after the period end — beyond the ceiling.
    row({ accn: "late", form: "8-K", filingDate: "2026-08-28", items: "2.02,9.01" }),
  ];
  const all = m.attributeResults(rows);
  check("a filing past the attribution ceiling is not attributed", all.length === 0, `got ${all.length}`);
  check("MAX_ATTRIBUTION_DAYS is the bound and is exported", m.MAX_ATTRIBUTION_DAYS === 120, String(m.MAX_ATTRIBUTION_DAYS));
}

// ── 4. Foreign private issuers ─────────────────────────────────────────────
console.log("\n4. FPIs — 6-K, deduped on accn, same-day pairs resolved");
{
  const rows = [
    row({ form: "20-F", reportDate: "2026-03-31", filingDate: "2026-06-01" }),
    // ARM'S REAL SHAPE: a quarter-end report and an event notice filed on the
    // SAME DAY, both far enough from their own reportDate to survive the event
    // filter. The event carries the LATER date, which is why a "latest
    // reportDate wins" tiebreak picks the wrong one — it did, and this is the
    // case that caught it.
    row({ accn: "prior", form: "6-K", reportDate: "2025-09-30", filingDate: "2025-11-05" }),
    row({ accn: "quarter", form: "6-K", reportDate: "2025-12-31", filingDate: "2026-02-05" }),
    row({ accn: "event", form: "6-K", reportDate: "2026-01-10", filingDate: "2026-02-05" }),
    row({ accn: "next", form: "6-K", reportDate: "2026-03-31", filingDate: "2026-05-14" }),
  ];
  check("the form set alone classifies it as an FPI", m.isForeignPrivateIssuer(rows) === true);
  const all = m.attributeResults(rows);
  check("the same-day pair yields ONE period, not two", all.filter((r) => r.filed === "2026-02-05").length === 1, JSON.stringify(all.map((r) => r.periodEnd)));
  check("and the QUARTER END wins it, not the later event date", all.some((r) => r.periodEnd === "2025-12-31") && !all.some((r) => r.periodEnd === "2026-01-10"), JSON.stringify(all.map((r) => r.periodEnd)));

  // A 10-Q anywhere in the set means it is not an FPI, whatever else it files.
  check(
    "a filer with a 10-Q is domestic even carrying a 20-F",
    m.isForeignPrivateIssuer([...rows, row({ form: "10-Q", reportDate: "2026-03-31", filingDate: "2026-05-01" })]) === false
  );
  // ── A HOLE IN THE HISTORY RE-ANCHORS; IT DOES NOT REJECT THE REST ────────
  // This is the INFY failure, reproduced small. Treating an over-large gap as a
  // rejection leaves `last` pinned before the hole, so every later period is
  // measured against a stale anchor and fails too: INFY went from 121 raw 6-Ks
  // to 2 usable, and the whole FPI cohort read as "unpredictable" when it was
  // this filter. The distinguishing number is 4 versus 2.
  const withHole = m.attributeResults([
    row({ form: "20-F", reportDate: "2024-03-31", filingDate: "2024-06-01" }),
    row({ accn: "q1", form: "6-K", reportDate: "2024-03-31", filingDate: "2024-05-10" }),
    row({ accn: "q2", form: "6-K", reportDate: "2024-06-30", filingDate: "2024-08-10" }),
    // ── the hole: no 6-K carries a period end for a full year ──
    row({ accn: "q3", form: "6-K", reportDate: "2025-06-30", filingDate: "2025-08-10" }),
    row({ accn: "q4", form: "6-K", reportDate: "2025-09-30", filingDate: "2025-11-10" }),
    row({ accn: "q5", form: "6-K", reportDate: "2025-12-31", filingDate: "2026-02-10" }),
  ]);
  check(
    "periods after a year-long hole are still attributed",
    withHole.length === 4,
    `${withHole.length} of 4 — rejection instead of re-anchor yields 2: ${JSON.stringify(withHole.map((r) => r.periodEnd))}`
  );
  check(
    "specifically the two quarters that FOLLOW the hole",
    withHole.some((r) => r.periodEnd === "2025-09-30") && withHole.some((r) => r.periodEnd === "2025-12-31"),
    JSON.stringify(withHole.map((r) => r.periodEnd))
  );

  // An event 6-K filed the same day as its own reportDate is not a period report.
  const eventOnly = m.attributeResults([
    row({ form: "20-F", reportDate: "2026-03-31", filingDate: "2026-06-01" }),
    row({ accn: "ev", form: "6-K", reportDate: "2026-04-02", filingDate: "2026-04-02" }),
  ]);
  check("a same-day event 6-K is not treated as a period report", eventOnly.length === 0, JSON.stringify(eventOnly));
}

// ── 5. Absence is absence ──────────────────────────────────────────────────
console.log("\n5. Nothing attributable reports nothing, not a guess");
{
  check("no filings at all -> null", m.latestResults([]) === null);
  check(
    "period ends but no 2.02 anywhere -> null",
    m.latestResults([row({ form: "10-Q", reportDate: "2026-03-31", filingDate: "2026-05-05" })]) === null
  );
  // latestResults is the LAST of the series, not the first. With one period
  // attributed the two are indistinguishable, so this asserts over two.
  const twoPeriods = [
    row({ form: "10-Q", reportDate: "2026-03-31", filingDate: "2026-05-05" }),
    row({ form: "10-Q", reportDate: "2026-06-30", filingDate: "2026-08-05" }),
    row({ accn: "older", form: "8-K", filingDate: "2026-04-28", items: "2.02,9.01" }),
    row({ accn: "newer", form: "8-K", filingDate: "2026-07-29", items: "2.02,9.01" }),
  ];
  check("the whole series is returned, ascending", m.attributeResults(twoPeriods).map((r) => r.periodEnd).join(" ") === "2026-03-31 2026-06-30", JSON.stringify(m.attributeResults(twoPeriods).map((r) => r.periodEnd)));
  check("and latestResults takes the LAST of it, not the first", m.latestResults(twoPeriods)?.accn === "newer", JSON.stringify(m.latestResults(twoPeriods)));
  check(
    "an 8-K with items but no 2.02 -> null",
    m.latestResults([
      row({ form: "10-Q", reportDate: "2026-03-31", filingDate: "2026-05-05" }),
      row({ form: "8-K", filingDate: "2026-04-15", items: "5.02,9.01" }),
    ]) === null
  );
}

// ── 6. The manifest carries the fields ─────────────────────────────────────
console.log("\n6. The manifest entry carries the three fields");
{
  const mf = fs.readFileSync(path.join(ROOT, "lib/server/secManifest.ts"), "utf8");
  for (const f of ["lastResultsDate", "lastResultsPeriod", "lastResultsAccn"]) {
    check(`${f} is declared and initialised`, new RegExp(`${f}:\\s*string \\| null;`).test(mf) && new RegExp(`${f}: null,`).test(mf));
  }
}

console.log(failures ? `\n${failures} CHECK(S) FAILED\n` : "\nALL CHECKS PASSED\n");
process.exit(failures ? 1 : 0);
