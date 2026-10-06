// The due names RENDERED, and read as a reader reads them.
//
// ── WHY RENDER RATHER THAN READ THE SOURCE ────────────────────────────────
// check-due-strip-state.mjs already proves resolveDueStrip picks the right
// state, and check-due-inputs.mjs proves the producer builds the right inputs.
// Neither proves a reader is shown the right sentence: a component can hold a
// correct DueStripState and print the wrong branch, or quietly paraphrase the
// copy, and both files would stay green. So this renders the SHIPPED component
// to markup and asserts on the visible text.
//
// ── SINCE THE WEEK GRID (#552 COWORK #179) ────────────────────────────────
// The separate "Due to report" box is gone. Its names lead the "This week"
// column of "Coming up" (EarningsComingUp), under "Period ended, not filed
// yet", as plain rows (logo, ticker, name); the per-row label went with the
// chips on 2026-10-06. The heading is not shown when there are none (the
// owner's "Remove … when it's empty"). An UNREADABLE record is not empty, and still says so in its own
// sentence: the two empties must never render the same.
//
// ── THE PROPERTY THAT MATTERS IS A NEGATIVE ONE ───────────────────────────
// lib/server/dueToReport.ts exists because two routes to a real forward
// calendar were measured and both failed. So the due group must never read as
// a forecast, and "never" is asserted by scanning the rendered group for
// forecast vocabulary rather than by trusting the constants to stay as written.
// `expectedOn` gets its own assertion: it is for ORDERING only.
//
//   node scripts/check-earnings-due-strip.mjs
import { register } from "node:module";

// THE SHIPPED .tsx, through the render hooks measure-reading-size uses.
register("./lib/tsx-render-hooks.mjs", import.meta.url);
import fs from "node:fs";
import path from "node:path";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const SRC = "app/earnings-calendar/EarningsComingUp.tsx";
const PAGE = path.join(ROOT, "app/earnings-calendar/page.tsx");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const C = await import(`../${SRC}`);
const D = await import("../lib/server/dueStripState.ts");
const m = { ...D, ...C };

/** Markup with tags removed and entities decoded — what a reader actually reads. */
const visibleText = (markup) =>
  markup
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&mdash;/g, "—").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();

/** The card with this due state (and no estimates), and its due group alone. */
const render = (state) => {
  const markup = renderToStaticMarkup(React.createElement(C.default, { due: state, expected: { kind: "none" }, today: "2026-09-22" }));
  // THE DUE PART OF "THIS WEEK": its heading and its rows, up to the estimates.
  const group = (markup.match(/<p class="cuSub" data-group="due">[\s\S]*?<\/ul>/) ?? [""])[0];
  const unavailable = (markup.match(/<p class="cuLine" data-due-unavailable="">[\s\S]*?<\/p>/) ?? [""])[0];
  return { markup, text: visibleText(markup), group, groupText: visibleText(group), unavailable: visibleText(unavailable) };
};

// The REAL production entry, as relay 35723254896 read it off the live store.
const MU = {
  symbol: "MU", periodEnd: "2026-08-27", dueFrom: "2026-09-15",
  expectedOn: "2026-09-19", daysOutstanding: 26,
};

console.log("\n1. THE LISTED BRANCH SHOWS THE ROW, IN THE MODULE'S OWN WORDS");
const listed = render({ kind: "listed", entries: [MU], coverage: 0.84 });
{
  check("the group heading renders", listed.groupText.includes(m.DUE_GROUP_HEADING), m.DUE_GROUP_HEADING);
  check("it leads the 'This week' column", /data-col="w0"[\s\S]*?<\/div><\/div><p class="cuSub" data-group="due">/.test(listed.markup));
  check("the symbol renders", /data-row="MU" data-due=""/.test(listed.group) && listed.groupText.includes("MU"));
  check("the row links to the symbol's earnings page", listed.group.includes('href="/stock/MU/earnings"'));
  // THE ROW LABEL WENT WITH THE CHIPS (COWORK #179, 2026-10-06): dueRowLabel
  // stays in dueStripState.ts; the heading says what the rows are.
  check("no day is printed on a due row (period end, due-from, outstanding)",
    !/27 Aug|2026-08-27|days outstanding/.test(listed.groupText));
  check("the unavailable sentence does not appear", !listed.text.includes(m.DUE_STRIP_UNAVAILABLE));
}

console.log("\n2. THE TWO EMPTIES RENDER DIFFERENTLY — THE WHOLE POINT");
const none = render({ kind: "none-outstanding", coverage: 0.84 });
const unavail = render({ kind: "unavailable", reason: "no-results-dates" });
{
  check("'none outstanding': the group is not shown (owner, COWORK #170)",
    none.group === "" && !/data-group="due"/.test(none.markup));
  check("...and NOT the gap-on-our-side claim", !none.text.includes(m.DUE_STRIP_UNAVAILABLE));
  check("'unavailable' prints the gap-on-our-side claim", unavail.unavailable === m.DUE_STRIP_UNAVAILABLE);
  // THE ASSERTION THIS SECTION EXISTS FOR. Both are an empty list; rendering
  // them the same is the lie dueStripState was built to stop.
  check("the two empties are DIFFERENT rendered text", none.text !== unavail.text);
}

console.log("\n3. IT NEVER READS AS A FORECAST");
{
  const FORECAST = [
    /\bwill report\b/i, /\bexpected to report\b/i, /\bnext up\b/i,
    /\bupcoming\b/i, /\bforecast/i, /\bdue on\b/i,
    /\bwe expect\b/i, /\breports? on\b/i, /~/,
  ];
  for (const { name, text } of [{ name: "listed", text: listed.groupText }, { name: "unavailable", text: unavail.unavailable }]) {
    const hits = FORECAST.filter((re) => re.test(text)).map(String);
    check(`the ${name} due text uses no forecast vocabulary`, text.length > 0 && hits.length === 0, hits.join(" "));
  }
  // ── expectedOn IS THE TRAP ────────────────────────────────────────────
  const withDistinct = render({ kind: "listed", entries: [{ ...MU, expectedOn: "2027-03-14" }], coverage: 0.84 });
  check("expectedOn is NOT rendered anywhere, text or markup, in any form",
    !/2027-03-14|14 Mar 2027|~14 Mar/.test(withDistinct.markup));
  check("dueFrom is not rendered either (also not a promise to a reader)",
    !/2027-04-15|15 Apr/.test(render({ kind: "listed", entries: [{ ...MU, dueFrom: "2027-04-15" }], coverage: 0.84 }).markup));
}

console.log("\n4. THE COPY IS THE MODULE'S, NOT THIS COMPONENT'S");
{
  const src = fs.readFileSync(SRC, "utf8");
  for (const name of ["DUE_STRIP_UNAVAILABLE"]) {
    check(`it imports ${name} rather than restating it`, new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from "@/lib/server/dueStripState"`).test(src));
  }
  const code = readCodeOnly(SRC).replace(/<style>[\s\S]*?<\/style>/g, "");
  check("the unavailable sentence is not restated as a literal", !code.includes("cannot be listed right now"));
}

console.log("\n5. THE PAGE WIRES IT, AND ON TODAY");
{
  const page = fs.readFileSync(PAGE, "utf8");
  check("the page renders the Coming up card with the due state",
    /<EarningsComingUp\s[^>]*due=\{forward\.due\}/.test(page));
  check("fed from the combined forward producer", page.includes("getCalendarForwardSections"));
  // The strip answers "outstanding AS OF NOW": the Eastern today, never a
  // browsed date (there is none to browse any more).
  check("called with today's Eastern date",
    /getForwardSections\(today\)/.test(page) && /const today = easternDate\(new Date\(\)\);/.test(page));
  // ── THE META DESCRIPTION IS A CLAIM GOOGLE QUOTES ─────────────────────
  const promises = /estimated to report next/.test(page);
  check("the description's 'estimated to report next' has a renderer behind it",
    promises && /<EarningsComingUp\s/.test(page));
}

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
