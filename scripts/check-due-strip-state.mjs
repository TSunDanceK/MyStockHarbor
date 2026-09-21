// The due strip's three states, RUN rather than reasoned about.
//
// The assertion that matters is not that an empty list renders -- it is that the
// TWO empties render differently. "We looked and nothing is outstanding" and
// "we have nothing to look in" are the same array length and opposite claims,
// and only one of them is true today, because the stage 1 backfill has not run
// and every lastResultsDate is null.
//
//   node scripts/check-due-strip-state.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const SRC = path.join(process.cwd(), "lib/server/dueStripState.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const js = ts.transpileModule(fs.readFileSync(SRC, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const m = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

const entry = (symbol, daysOutstanding = 12) => ({
  symbol, periodEnd: "2026-06-30", dueFrom: "2026-08-01",
  expectedOn: "2026-08-05", daysOutstanding,
});

console.log("\n1. The two empties are not the same state");
{
  // The normal state of this page TODAY: manifest reads fine, holds nothing.
  const s = m.resolveDueStrip({ universeSize: 700, withResultsDate: 0, manifestRead: true, entries: [] });
  check("an unpopulated manifest is UNAVAILABLE, not 'none outstanding'",
    s.kind === "unavailable" && s.reason === "no-results-dates", JSON.stringify(s));

  const t = m.resolveDueStrip({ universeSize: 700, withResultsDate: 690, manifestRead: true, entries: [] });
  check("a populated manifest with nothing due IS 'none outstanding'",
    t.kind === "none-outstanding", JSON.stringify(t));

  check("and those two are different kinds", s.kind !== t.kind);
}

console.log("\n2. A failed read is not an empty one");
{
  const s = m.resolveDueStrip({ universeSize: 700, withResultsDate: 690, manifestRead: false, entries: [] });
  check("manifestRead=false is UNAVAILABLE even with full coverage behind it",
    s.kind === "unavailable" && s.reason === "manifest-unread", JSON.stringify(s));
}

console.log("\n3. The zero denominator is answered before the division, not by it");
{
  // 0/0 is NaN, and every comparison against NaN is false -- so a floor test
  // alone would fall THROUGH to "none outstanding" on a completely empty
  // manifest. This is the case that makes the guard load-bearing.
  const s = m.resolveDueStrip({ universeSize: 0, withResultsDate: 0, manifestRead: true, entries: [] });
  check("an empty universe is UNAVAILABLE, not a silent NaN",
    s.kind === "unavailable", JSON.stringify(s));
  check("and it never reports a NaN coverage", !("coverage" in s) || Number.isFinite(s.coverage));
}

console.log("\n4. The coverage floor gates the UNIVERSAL claim only");
{
  const thin = { universeSize: 700, withResultsDate: 70, manifestRead: true };
  const empty = m.resolveDueStrip({ ...thin, entries: [] });
  check("10% coverage cannot claim the market is quiet",
    empty.kind === "unavailable", JSON.stringify(empty));

  const listed = m.resolveDueStrip({ ...thin, entries: [entry("AAPL")] });
  check("but 10% coverage CAN say these named symbols have not filed",
    listed.kind === "listed" && listed.entries.length === 1, JSON.stringify(listed));
  check("— because that claim is existential, not universal", true);
}

console.log("\n5. Coverage is reported beside every state that has one");
{
  const s = m.resolveDueStrip({ universeSize: 700, withResultsDate: 350, manifestRead: true, entries: [entry("MSFT")] });
  check("a listed state carries its denominator-derived coverage", s.coverage === 0.5, String(s.coverage));
}

console.log("\n6. The copy is present tense about the record, never a forecast");
{
  const strings = {
    DUE_STRIP_HEADING: m.DUE_STRIP_HEADING,
    DUE_STRIP_INTRO: m.DUE_STRIP_INTRO,
    DUE_STRIP_NONE_OUTSTANDING: m.DUE_STRIP_NONE_OUTSTANDING,
    DUE_STRIP_UNAVAILABLE: m.DUE_STRIP_UNAVAILABLE,
    dueRowLabel: m.dueRowLabel(entry("NVDA", 9)),
  };
  // "will report" / "expected to report" / "reports on" are the forecast
  // phrasings dueToReport.ts's header rules out by name.
  const FORECAST = /will report|expected to report|expects to report|reports on|due to announce|scheduled to report/i;
  for (const [name, text] of Object.entries(strings)) {
    check(`${name} carries no forecast phrasing`, !FORECAST.test(text), text.slice(0, 72));
  }
  check("the row says results have not yet been FILED",
    /have not yet been filed/i.test(strings.dueRowLabel), strings.dueRowLabel);
  check("the unavailable copy names it as our gap, not a quiet market",
    /not a quiet market/i.test(m.DUE_STRIP_UNAVAILABLE));
  check("the intro says outright it is not a forecast",
    /not a forecast/i.test(m.DUE_STRIP_INTRO));
}

console.log("\n7. The row label does not leak expectedOn as a date");
{
  const e = entry("TSM", 3);
  const label = m.dueRowLabel(e);
  check("expectedOn is for ordering and is never rendered",
    !label.includes(e.expectedOn), label);
  const one = m.dueRowLabel(entry("KO", 1));
  check("singular reads '1 day outstanding', not '1 days'",
    /\b1 day outstanding\b/.test(one) && !/1 days/.test(one), one);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED\n` : "\nALL CHECKS PASSED\n");
process.exit(failures ? 1 : 0);
