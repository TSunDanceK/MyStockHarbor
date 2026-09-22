// The due strip RENDERED, and read as a reader reads it.
//
// ── WHY RENDER RATHER THAN READ THE SOURCE ────────────────────────────────
// check-due-strip-state.mjs already proves resolveDueStrip picks the right
// state, and check-due-inputs.mjs proves the producer builds the right inputs.
// Neither proves a reader is shown the right sentence: a component can hold a
// correct DueStripState and print the wrong branch, or quietly paraphrase the
// copy, and both files would stay green. So this renders the SHIPPED component
// to markup and asserts on the visible text.
//
// ── THE PROPERTY THAT MATTERS IS A NEGATIVE ONE ───────────────────────────
// lib/server/dueToReport.ts exists because two routes to a real forward
// calendar were measured and both failed -- cadence prediction landed 2 of 48
// filers inside their own p90 band, 8-K scheduling announcements 0 of 276. So
// the strip must never read as a forecast, and "never" is asserted by scanning
// the rendered text for forecast vocabulary rather than by trusting the
// constants to stay as written.
//
// `expectedOn` gets its own assertion. It is the one field on DueEntry that
// looks renderable and is not: both source modules say in writing that it is
// for ORDERING only. A date pill showing it would look completely normal.
//
//   node scripts/check-earnings-due-strip.mjs
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { readCodeOnly } from "./lib/source-code.mjs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "app/earnings-calendar/EarningsDueStrip.tsx");
const PAGE = path.join(ROOT, "app/earnings-calendar/page.tsx");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// next/link and TickerLogo as the smallest things that behave: an <a> and a
// <span> are what any assertion here reads. Declared as source because the
// modules are concatenated into ONE unit -- there is no import to satisfy,
// only a name that has to exist.
const SHIMS = `
const Link = ({ href, children, ...rest }) => <a href={href} {...rest}>{children}</a>;
const TickerLogo = ({ symbol }) => <span data-logo={symbol} />;
`;

const strip = (f) =>
  fs.readFileSync(path.join(ROOT, f), "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");

const unit = [
  SHIMS,
  // The COPY MODULE ITSELF, not a copy of its strings. If this check declared
  // its own expected sentences it would pass while the page rendered something
  // else entirely -- the assertion has to travel through the same constants the
  // component imports.
  strip("lib/server/dueStripState.ts"),
  strip("app/earnings-calendar/EarningsDueStrip.tsx").replace(/export default function/, "export function"),
].join("\n");

const js = ts.transpileModule(unit, {
  fileName: "strip.tsx",
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    jsx: ts.JsxEmit.ReactJSX,
    jsxImportSource: "react",
  },
}).outputText;

// A REAL PATH, NOT a data: URL -- the emitted module imports "react/jsx-runtime",
// a bare specifier, and Node resolves those against the IMPORTING file.
const tmp = `scripts/.check-due-strip-${process.pid}.mjs`;
fs.writeFileSync(tmp, js);
let m;
try {
  m = await import(`${ROOT}/${tmp}?t=${Date.now()}`);
} finally {
  fs.rmSync(tmp, { force: true });
}

/** Markup with tags removed and entities decoded — what a reader actually reads. */
const visibleText = (markup) =>
  markup
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&mdash;/g, "—").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();

const render = (state) => {
  const markup = renderToStaticMarkup(React.createElement(m.default ?? m.EarningsDueStrip, { state }));
  return { markup, text: visibleText(markup) };
};

// The REAL production entry, as relay 35723254896 read it off the live store.
const MU = {
  symbol: "MU", periodEnd: "2026-08-27", dueFrom: "2026-09-15",
  expectedOn: "2026-09-19", daysOutstanding: 26,
};

console.log("\n1. THE LISTED BRANCH SHOWS THE ROW, IN THE MODULE'S OWN WORDS");
const listed = render({ kind: "listed", entries: [MU], coverage: 0.84 });
{
  check("the heading renders", listed.text.includes(m.DUE_STRIP_HEADING), m.DUE_STRIP_HEADING);
  check("the intro renders verbatim", listed.text.includes(m.DUE_STRIP_INTRO));
  check("the symbol renders", listed.text.includes("MU"));
  check("the row label is dueRowLabel's, character for character",
    listed.text.includes(m.dueRowLabel(MU)), m.dueRowLabel(MU));
  check("the period end appears", listed.text.includes("2026-08-27"));
  check("the days outstanding appear", /26 days outstanding/.test(listed.text));
  check("the row links to the symbol's earnings page",
    listed.markup.includes('href="/stock/MU/earnings"'));
  check("neither empty-state sentence appears",
    !listed.text.includes(m.DUE_STRIP_NONE_OUTSTANDING) &&
    !listed.text.includes(m.DUE_STRIP_UNAVAILABLE));
}

console.log("\n2. THE TWO EMPTIES RENDER DIFFERENTLY — THE WHOLE POINT");
const none = render({ kind: "none-outstanding", coverage: 0.84 });
const unavail = render({ kind: "unavailable", reason: "no-results-dates" });
{
  check("'none outstanding' prints the market claim",
    none.text.includes(m.DUE_STRIP_NONE_OUTSTANDING));
  check("and NOT the gap-on-our-side claim",
    !none.text.includes(m.DUE_STRIP_UNAVAILABLE));
  check("'unavailable' prints the gap-on-our-side claim",
    unavail.text.includes(m.DUE_STRIP_UNAVAILABLE));
  check("and NOT the quiet-market claim",
    !unavail.text.includes(m.DUE_STRIP_NONE_OUTSTANDING));
  // THE ASSERTION THIS SECTION EXISTS FOR. Both are an empty list; rendering
  // them the same is the lie dueStripState was built to stop, and it is a lie
  // no reader can detect.
  check("the two empties are DIFFERENT rendered text", none.text !== unavail.text);
  check("both still carry the heading and intro",
    none.text.includes(m.DUE_STRIP_HEADING) && unavail.text.includes(m.DUE_STRIP_INTRO));
  // Rendered unconditionally: hiding the strip when there is nothing to list
  // collapses both empties back into the same silence.
  check("neither empty renders as nothing at all",
    none.markup.length > 0 && unavail.markup.length > 0);
}

console.log("\n3. IT NEVER READS AS A FORECAST");
{
  // Scanned rather than trusted. A constant can be edited; this fails when the
  // rendered words start predicting, whoever wrote them.
  const FORECAST = [
    /\bwill report\b/i, /\bexpected to report\b/i, /\bnext up\b/i,
    /\bupcoming\b/i, /\bforecast/i, /\bdue on\b/i,
    /\bwe expect\b/i, /\breports? on\b/i,
  ];
  // THE INTRO IS EXCLUDED, AND ONLY THE INTRO. It legitimately contains the
  // word "forecast" -- in the sentence that says this is NOT one -- so scanning
  // the raw text flags the disclaimer as the offence. The first version did
  // exactly that and failed all three branches. Removing the constant (rather
  // than loosening the pattern) keeps the scan strict everywhere else: a second
  // "forecast" anywhere outside that one sentence still fails.
  const outsideIntro = (text) => text.split(m.DUE_STRIP_INTRO).join(" ");
  for (const { name, text } of [
    { name: "listed", text: listed.text },
    { name: "none-outstanding", text: none.text },
    { name: "unavailable", text: unavail.text },
  ]) {
    const scanned = outsideIntro(text);
    check(`the ${name} branch's intro is present and removed for this scan`,
      scanned !== text);
    const hits = FORECAST.filter((re) => re.test(scanned)).map(String);
    check(`the ${name} branch uses no forecast vocabulary`, hits.length === 0, hits.join(" "));
  }
  // The intro's own disclaimer has to survive, since it is the sentence that
  // tells a reader what the rest of the strip is.
  check("the intro still says it is not a forecast",
    /not a forecast/i.test(listed.text));

  // ── expectedOn IS THE TRAP ────────────────────────────────────────────
  // It is the one DueEntry field that looks renderable and is not. Both
  // dueToReport.ts and dueStripState.ts say in writing that it is for ORDERING
  // only, and a date pill showing it would look entirely normal.
  const withDistinct = render({
    kind: "listed",
    entries: [{ ...MU, expectedOn: "2027-03-14" }],
    coverage: 0.84,
  });
  check("expectedOn is NOT rendered anywhere, text or markup",
    !withDistinct.text.includes("2027-03-14") && !withDistinct.markup.includes("2027-03-14"));
  check("dueFrom is not rendered either (also not a promise to a reader)",
    !render({ kind: "listed", entries: [{ ...MU, dueFrom: "2027-04-15" }], coverage: 0.84 })
      .text.includes("2027-04-15"));
}

console.log("\n4. THE COPY IS THE MODULE'S, NOT THIS COMPONENT'S");
{
  const src = fs.readFileSync(SRC, "utf8");
  for (const name of [
    "DUE_STRIP_HEADING", "DUE_STRIP_INTRO",
    "DUE_STRIP_NONE_OUTSTANDING", "DUE_STRIP_UNAVAILABLE", "dueRowLabel",
  ]) {
    check(`it imports ${name} rather than restating it`, src.includes(name));
  }
  // A component that hardcodes a sentence passes every assertion above while
  // the constants rot beside it. The copy rule is the deliverable; it has to
  // live where a check can reach it.
  //
  // SCOPED, because the first version was not and matched its own JSX. It read
  // every quote character in the file, including the backticks around the
  // stylesheet and the quotes in JSX attributes, and reported a ternary plus a
  // className as "hardcoded prose". A check that flags correct code is a check
  // someone deletes.
  //
  // So: comments out, the <style> block out (it is CSS, not copy), then only
  // ordinary '...' / "..." literals, and a candidate counts only if it reads as
  // a SENTENCE -- four or more space-separated words of two-plus letters.
  // COMMENTS COME OFF THROUGH readCodeOnly, NOT A LOCAL REGEX. The first
  // version rolled its own `//` and `/* */` strip and check-comment-stripper
  // failed the run by name: "a harness that rolls its own regex again is a
  // harness outside the guard". That guard exists because #483 shipped a
  // hand-rolled stripper that let a check's own NEGATIVE assertions pass
  // vacuously -- the precise failure mode this file is full of.
  const code = readCodeOnly("app/earnings-calendar/EarningsDueStrip.tsx")
    .replace(/<style>[\s\S]*?<\/style>/g, "");
  const quoted = [...code.matchAll(/(?:"([^"\n]{25,})"|'([^'\n]{25,})')/g)]
    .map((x) => x[1] ?? x[2])
    .filter((t) => (t.match(/\b[A-Za-z]{2,}\b/g) ?? []).length >= 4)
    .filter((t) => !/[{}<>;=]/.test(t));
  check("no prose sentence is hardcoded in the component", quoted.length === 0, quoted.join(" | "));
}

console.log("\n5. THE PAGE WIRES IT, AND ON TODAY RATHER THAN THE BROWSED DATE");
{
  const page = fs.readFileSync(PAGE, "utf8");
  check("the page renders EarningsDueStrip", /<EarningsDueStrip\s/.test(page));
  check("fed from getDueStripState", page.includes("getDueStripState("));
  // `selectedDate` would make the strip answer "who was outstanding on the day
  // you are browsing" -- and on a future date, a forecast.
  check("called with todayDate, never selectedDate",
    /getDueStripState\(todayDate\)/.test(page) && !/getDueStripState\(selectedDate\)/.test(page));
  check("rendered unconditionally, not behind an entries-length test",
    !/entries\.length\s*[>&]/.test(page.slice(page.indexOf("<EarningsDueStrip") - 200,
      page.indexOf("<EarningsDueStrip") + 80)));

  // ── THE META DESCRIPTION IS A CLAIM GOOGLE QUOTES ─────────────────────
  // It has promised "the largest companies whose results are not yet on file"
  // since #501, on a page that rendered no such thing. This check is what ties
  // the sentence to the component: if the strip is ever removed, the page is
  // overclaiming again and this fails.
  const promises = /largest companies whose results are not yet on file/.test(page);
  check("PAGE_DESCRIPTION's due-strip promise now has a renderer behind it",
    promises && /<EarningsDueStrip\s/.test(page),
    promises ? "" : "the description no longer makes the promise — check it was retired deliberately");
}

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
