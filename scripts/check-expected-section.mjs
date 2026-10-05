// The "expected to report" section: the estimator, the bars that gate it, and
// the words a reader actually sees.
//
// ── THE PROPERTY THIS FILE EXISTS FOR IS A NEGATIVE ONE ───────────────────
// A day-level forward calendar was measured and killed twice (2 of 48 filers
// inside their own p90 band; 0 of 276 8-K scheduling announcements). This
// section ships the COARSER claim the measurement did support -- and the one
// way to betray that measurement is to render a specific day. Every date-shaped
// thing in the rendered markup is therefore checked, not just the ones this
// file expects to be there.
//
// The second property is that the SUPPRESSION IS REAL. "FPIs are held to a
// higher bar" is a sentence in a docblock until something proves a filer at 75%
// is admitted when domestic and refused when foreign.
//
//   node scripts/check-expected-section.mjs
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const transpile = (src, fileName = "m.ts", jsx = false) =>
  ts.transpileModule(src, {
    fileName,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      ...(jsx ? { jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react" } : {}),
    },
  }).outputText;

const stripImports = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");

const m = await import(
  `data:text/javascript;base64,${Buffer.from(transpile(stripImports("lib/server/expectedToReport.ts"))).toString("base64")}`
);

// ── Fixtures. Events are stored NEWEST FIRST, as the store writes them. ───
const ev = (periodEnd, announcedOn, basis = "8-K item 2.02") => ({
  periodEnd, announcedOn, basis, accession: "x", timing: null, form: "8-K", items: "2.02", eventDate: announcedOn,
});
const DAY = 86_400_000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
/** n quarters of history with a constant lag, newest first. */
const history = (n, lag, basis = "8-K item 2.02", jitter = () => 0) => {
  const out = [];
  let end = Date.parse("2026-06-30T00:00:00Z");
  for (let i = 0; i < n; i++) {
    out.push(ev(iso(end), iso(end + (lag + jitter(i)) * DAY), basis));
    end -= 91 * DAY;
  }
  return out;
};
const rec = (over = {}) => ({
  symbol: "X", cik: "1", at: "", nextPeriodEnd: "2026-08-27",
  next: { kind: "none", reason: "" }, events: history(12, 30), ...over,
});
const TODAY = "2026-09-22";

console.log("\n1. LAGS ARE READ FROM THE FILER'S OWN EVENTS, BOTH BASES");
{
  const dom = m.lagsFrom(history(8, 30));
  check("domestic lags come out at the stored lag", dom.lags.every((l) => l === 30) && dom.lags.length === 8);
  check("and it is not flagged FPI", dom.isFpi === false);

  // THE WIDENING THAT MAKES 74 FILERS POSSIBLE. secReportDates counts only
  // "8-K item 2.02", which is why eight FPIs are absent from the due strip.
  const fpi = m.lagsFrom(history(8, 40, "6-K near period end"));
  check("a 6-K filer's lags ARE read here", fpi.lags.length === 8);
  check("and it IS flagged FPI, which is what selects the higher bar", fpi.isFpi === true);

  // ORDER IS LOAD-BEARING. Stored newest-first; the walk-forward needs oldest
  // first. Reversing it silently inverts every prediction.
  // history() builds NEWEST first with the jitter growing by index, so the
  // OLDEST event carries the LARGEST lag. Oldest-first output therefore starts
  // large and ends small; stored order would be the reverse. Asserted against
  // the fixture's own construction rather than against a remembered shape.
  const rising = m.lagsFrom(history(8, 20, "8-K item 2.02", (i) => i * 2));
  check("lags come back OLDEST first, not in stored order",
    rising.lags[0] === 34 && rising.lags[rising.lags.length - 1] === 20,
    JSON.stringify(rising.lags));

  check("a negative lag (announced before its own period ended) is dropped",
    m.lagsFrom([ev("2026-06-30", "2026-06-01")]).lags.length === 0);
  check("a lag past every statutory deadline is dropped",
    m.lagsFrom([ev("2026-01-01", "2026-12-31")]).lags.length === 0);
}

console.log("\n2. PRECISION IS THE MEASUREMENT'S OWN SCORE, NOT A NEW ONE");
{
  check("a filer with fewer than the minimum periods is not scored at all",
    m.filerPrecision([30, 30, 30, 30, 30, 30, 30]) === null);
  const perfect = m.filerPrecision(Array(12).fill(30));
  check("a perfectly regular filer scores 1.0", perfect?.precision === 1);

  // A 10-DAY ERROR IS TWO THIRDS OF A HIT, not a whole one and not a miss.
  // That is the difference between this and a "<=30 days" band count, and it
  // is the reason the 70% bar means what the measurement says it means.
  const lags = [...Array(11).fill(30), 40];
  const s = m.filerPrecision(lags);
  const expected = ((s.predictions - 1) * 31 + (31 - 10)) / (s.predictions * 31);
  check("a 10-day error scores as partial overlap, not pass/fail",
    Math.abs(s.precision - expected) < 1e-9, `${s.precision.toFixed(4)} vs ${expected.toFixed(4)}`);

  const wild = m.filerPrecision([...Array(8).fill(30), 200, 5, 180, 2]);
  check("an irregular filer scores far lower", wild.precision < 0.7, `${wild?.precision.toFixed(3)}`);
}

console.log("\n3. THE FPI BAR IS APPLIED, NOT MERELY DOCUMENTED");
{
  // ONE HISTORY, TWO BASES. The ONLY difference between these two filers is
  // the form they file on, so anything that differs in the verdict is the bar.
  const jitter = (i) => [0, 9, 0, 9, 0, 9, 0, 9, 0, 9, 0, 9][i] ?? 0;
  const domRec = rec({ events: history(12, 30, "8-K item 2.02", jitter) });
  const fpiRec = rec({ events: history(12, 30, "6-K near period end", jitter) });

  const domScore = m.filerPrecision(m.lagsFrom(domRec.events).lags).precision;
  const fpiScore = m.filerPrecision(m.lagsFrom(fpiRec.events).lags).precision;
  check("the two fixtures score identically (only the basis differs)",
    Math.abs(domScore - fpiScore) < 1e-9, `${domScore.toFixed(3)}`);
  check("and that score sits BETWEEN the two bars — otherwise this proves nothing",
    domScore >= m.PRECISION_BAR_DOMESTIC && domScore < m.PRECISION_BAR_FPI,
    `${domScore.toFixed(3)} vs domestic ${m.PRECISION_BAR_DOMESTIC} / FPI ${m.PRECISION_BAR_FPI}`);

  const d = m.expectedFrom("DOM", domRec, TODAY, new Set());
  const f = m.expectedFrom("FPI", fpiRec, TODAY, new Set());
  check("the DOMESTIC filer is admitted", "row" in d, JSON.stringify(d));
  check("the FOREIGN filer with the SAME history is refused by the higher bar",
    "skip" in f && f.skip === "below-precision-bar", JSON.stringify(f));
  check("the FPI bar really is the higher of the two",
    m.PRECISION_BAR_FPI > m.PRECISION_BAR_DOMESTIC);
}

console.log("\n4. THE DUE STRIP WINS, SO NOTHING IS LISTED TWICE");
{
  const r = rec();
  const free = m.expectedFrom("MU", r, TODAY, new Set());
  const taken = m.expectedFrom("MU", r, TODAY, new Set(["MU"]));
  check("a symbol not in the due strip can be listed", "row" in free);
  check("the SAME symbol is refused once the due strip has it",
    "skip" in taken && taken.skip === "already-due");
}

console.log("\n5. BANDING, AND NOTHING OUTSIDE THE WINDOW");
{
  // nextPeriodEnd + medianLag - today decides the band, so the period end is
  // moved rather than the lag: that is the arithmetic the page actually does.
  const at = (daysAway) => {
    const end = iso(Date.parse(`${TODAY}T00:00:00Z`) + (daysAway - 30) * DAY);
    return m.expectedFrom("X", rec({ nextPeriodEnd: end, events: history(12, 30) }), TODAY, new Set());
  };
  check("0 days away lands in the first band", at(0).row?.band === "d0_7");
  check("7 days away is still the first band", at(7).row?.band === "d0_7");
  check("8 days away crosses into the second", at(8).row?.band === "d8_21");
  check("21 is the second band's last day", at(21).row?.band === "d8_21");
  check("22 crosses into the third", at(22).row?.band === "d22_30");
  check("30 is the last day in the window", at(30).row?.band === "d22_30");
  // THE TWO OUT-OF-WINDOW ANSWERS ARE NAMED SEPARATELY, and the section drops
  // both identically -- which is exactly why they were one skip until a
  // per-symbol reader needed to tell "reports in seven weeks" from "our
  // estimate already passed". Asserted here so a later merge cannot quietly
  // put them back together.
  check("31 days away is BEYOND the window", at(31).skip === "beyond-window");
  check("a date already past is a different skip — that is the due strip's business",
    at(-1).skip === "estimate-in-past");
  check("and the two are not the same name", at(31).skip !== at(-1).skip);
  check("the bands cover 0..30 with no gap",
    m.EXPECTED_BANDS.map((b) => b.maxDays).join() === "7,21,30");
}

console.log("\n6. EVERY SYMBOL IS A ROW OR A NAMED SKIP");
{
  const records = new Map([
    ["GOOD", rec()],
    ["THIN", rec({ events: history(4, 30) })],
    ["NOEND", rec({ nextPeriodEnd: null })],
    ["GONE", null],
  ]);
  const cut = ["GOOD", "THIN", "NOEND", "GONE"];
  const built = m.buildExpected(cut, records, TODAY, new Set());
  check("only the constructible one is a row",
    built.rows.length === 1 && built.rows[0].symbol === "GOOD");
  check("thin history is named", built.skipped["thin-history"].join() === "THIN");
  check("a missing period end is named", built.skipped["no-period-end"].join() === "NOEND");
  check("a missing record is named", built.skipped["no-record"].join() === "GONE");
  const accounted = built.rows.length + Object.values(built.skipped).reduce((n, xs) => n + xs.length, 0);
  check("rows + every skip bucket == the cut, exactly", accounted === cut.length, `${accounted}/${cut.length}`);
  check("`considered` is the CUT's size, not the row count — the denominator the page states",
    built.considered === cut.length);
}

// ── The render ────────────────────────────────────────────────────────────
// SINCE THE WEEK PAGE (#552 COWORK #170) the estimates render as compact chips
// in "Coming up" (EarningsComingUp), grouped by calendar week, the evidence
// behind a tap. The SHIPPED component is rendered through its real imports.
(await import("node:module")).register("./lib/tsx-render-hooks.mjs", import.meta.url);
const C = { ...(await import("../lib/server/expectedCopy.ts")), ...(await import("../app/earnings-calendar/EarningsComingUp.tsx")) };

const visible = (markup) => markup
  .replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&apos;/g, "'")
  .replace(/&quot;/g, '"').replace(/&mdash;/g, "—").replace(/&ldquo;|&rdquo;/g, '"')
  .replace(/\s+/g, " ").trim();
const render = (state) => {
  const markup = renderToStaticMarkup(React.createElement(C.default, { expected: state, due: { kind: "none-outstanding", coverage: 1 }, today: TODAY }));
  return { markup, text: visible(markup) };
};
const ROW = {
  symbol: "MU", band: "d0_7", daysAway: 4, periodEnd: "2026-11-27",
  medianLagDays: 26, fromPeriods: 12, precision: 0.91, isFpi: false,
  lastReportedOn: "2026-09-23", lastReportedPeriodEnd: "2026-08-27",
};

console.log("\n7. THE ESTIMATE IS A MARKED APPROXIMATION, NEVER A BARE DATE");
{
  // THE OWNER'S PICK (COWORK #170) replaced "Expected in about 4 days" with
  // "~26 Sep" on a chip, under a line saying each one is a week, not a day.
  // What this file keeps asserting is the honesty of that: the estimate's
  // date never appears without its "~", never as an ISO date, and the line
  // that qualifies it is always on the card.
  const r = render({ kind: "listed", rows: [ROW], considered: 50 });
  const estimated = iso(Date.parse(`${TODAY}T00:00:00Z`) + ROW.daysAway * DAY);
  check("the week heading renders", r.text.includes("This week"));
  check("the chip carries the approximate date", r.text.includes("MU ~26 Sep"));
  const bare = (r.text.match(/26 Sep/g) ?? []).length, marked = (r.text.match(/~26 Sep/g) ?? []).length;
  check("the estimated date appears ONLY with its '~'", bare === marked && marked === 1, `${marked} marked of ${bare}`);
  check("the estimated date never appears as an ISO date", !r.markup.includes(estimated), estimated);
  check("the line under the title says it is a week, not a day", r.text.includes(C.COMING_UP_LINE) && /a week, not a day/.test(C.COMING_UP_LINE));
  const FORECAST = [/\bwill report\b/i, /\bnext up\b/i, /\breports on\b/i, /\bconfirmed\b/i];
  check("no forecast vocabulary", !FORECAST.some((re) => re.test(r.text)));
  check("the line says the dates are estimated and not announced",
    /estimated from each company/i.test(r.text) && /aren't announced dates/i.test(r.text));
}

console.log("\n8. THE EVIDENCE, THE DENOMINATOR, AND THE TWO EMPTIES");
{
  const r = render({ kind: "listed", rows: [ROW], considered: 50 });
  check("the filer's own habit renders WITH its sample size (behind the tap)",
    r.text.includes(C.habitLabel(ROW.medianLagDays, ROW.fromPeriods)));
  check("...and that label carries the period count, not just the lag",
    /over its last 12 periods/.test(r.text));
  check("the period the report would cover renders", r.text.includes("For the period ending 27 Nov 2026"));
  check("the last filing on record renders", r.text.includes(ROW.lastReportedOn));
  check("the evidence is behind a native tap, in the server HTML",
    /<details class="cuChip" data-chip="MU"><summary>[\s\S]*?<\/summary><div class="cuBody">[\s\S]*Usually reports/.test(r.markup));
  check("the chip links to the symbol's earnings page", r.markup.includes('href="/stock/MU/earnings"'));
  check("the coverage line names BOTH shown and considered",
    r.text.includes("Showing 1 of the 50"), C.coverageLabel(1, 50));

  const none = render({ kind: "none" });
  const un = render({ kind: "unavailable" });
  check("'nothing clears the bar' is a claim about our confidence",
    none.text.includes(C.EXPECTED_NONE) && !none.text.includes(C.EXPECTED_UNAVAILABLE));
  check("'unavailable' is a claim about US, and a different sentence",
    un.text.includes(C.EXPECTED_UNAVAILABLE) && !un.text.includes(C.EXPECTED_NONE));
  check("the two empties render differently", none.text !== un.text);
  check("both keep the title and the line",
    none.text.includes(C.COMING_UP_TITLE) && un.text.includes(C.COMING_UP_LINE));
}

console.log("\n9. THE PAGE: LADDER ORDER, THE TICKER'S REMOVAL, AND THE PLACEHOLDER");
{
  const page = fs.readFileSync(path.join(ROOT, "app/earnings-calendar/page.tsx"), "utf8");
  const search = fs.readFileSync(path.join(ROOT, "app/earnings-calendar/EarningsTickerSearch.tsx"), "utf8");
  const cu = fs.readFileSync(path.join(ROOT, "app/earnings-calendar/EarningsComingUp.tsx"), "utf8");

  check("the page renders the estimates", /<EarningsComingUp\s[^>]*expected=\{forward\.expected\}/.test(page));
  check("fed from the combined forward read", page.includes("getCalendarForwardSections"));
  check("on TODAY (Eastern), never a browsed date",
    /getForwardSections\(today\)/.test(page) && !/getForwardSections\(selected/.test(page));

  // THE LADDER IS AN ORDERING CLAIM: filed (the week) → outstanding (the due
  // group) → expected (the weeks), strongest first.
  check("the week's filed results come BEFORE Coming up in the page",
    page.indexOf("<EarningsWeek ") > 0 && page.indexOf("<EarningsWeek ") < page.indexOf("<EarningsComingUp "));
  check("...and inside Coming up the due group comes BEFORE the estimate weeks",
    cu.indexOf('data-group="due"') > 0 && cu.indexOf('data-group="due"') < cu.indexOf("data-group={w.key}"));

  check("EarningsUpcomingTicker is not rendered", !/<EarningsUpcomingTicker/.test(page));
  check("...and not imported", !/^import .*EarningsUpcomingTicker/m.test(page));
  check("...but the note explaining the removal survives",
    /"Next up"/.test(page) && /Today/.test(page));
  check("...and its component file is deleted",
    !fs.existsSync(path.join(ROOT, "app/earnings-calendar/EarningsUpcomingTicker.tsx")));
  check("...and its loader is gone with it", !/getUpcomingTickerItems/.test(page));

  const ph = (search.match(/placeholder="([^"]*)"/) ?? [])[1] ?? "";
  const aria = (search.match(/aria-label="([^"]*)"/) ?? [])[1] ?? "";
  check("the search input promises no next earnings date",
    !/next earnings date/i.test(ph) && !/next earnings date/i.test(aria), `${ph} | ${aria}`);
  check("the memo guard is on the forward sections now", /FORWARD_MEMO_MS/.test(page));
}

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
