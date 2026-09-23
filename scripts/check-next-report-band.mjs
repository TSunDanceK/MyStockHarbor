// No ESTIMATED next-report date reaches /stock/[symbol] or /stock/[symbol]/earnings.
//
// ── THE OWNER DECISION THIS FILE ENFORCES (2026-09-23) ────────────────────
// The next-expected-earnings estimate uses the 30-day band wording EVERYWHERE,
// the /earnings-calendar search's wording (#513). Before this, two places on
// the stock pages printed estimateNextReport's exact output:
//
//   /stock/TSLA            Earnings snapshot tile   "NEXT EARNINGS · 22 Oct 2026 ·
//                                                    Estimated from its last 15 reports"
//   /stock/AVAV/earnings   "Next expected earnings date" card
//                                                   "Expected in December 2026."
//
// and the earnings card fell back to FMP's calendar day when the filer's own
// record had not been read. Both now answer through
// lib/server/symbolOutlook.ts (outlookFrom -> expectedToReport), the same
// function and the same sentences as the search.
//
// ── WHAT IS RENDERED, AND WHAT IS SCANNED ─────────────────────────────────
// Both components are RENDERED with react-dom/server, fed through the shipped
// module graph from stored records for which estimateNextReport really returns
// a DATE (2026-10-22) and a MONTH (2026-10). The reader-visible text is then
// scanned for every date shape -- ISO days, ISO months, "22 Oct 2026", and any
// month name -- AFTER removing the filed facts the page is allowed to date:
// the last reported day and the period ends (the record's own events, its next
// period end, and the snapshot's period). Everything left that looks like a
// date is an estimate, and fails.
//
// ── THE MUTANTS ARE THE PROOF ─────────────────────────────────────────────
// A date scan that passes proves nothing unless a date would have been
// caught. So the scan is also run against:
//   M1  the OLD tile (its formatter and its mapping off `rec.next`, verbatim)
//   M2  the OLD earnings card (its JSX and its view off `rec.next` / FMP, verbatim)
//   M3  the NEW components with a date slipped into the shared headline
//   M4  outlookForEarningsCard hiding the card instead of refusing, on the
//       FMP-with-no-record branch
//   M5  the page and snapshot wiring put back onto `rec.next`
// and each MUST fail it. A mutant that survives fails this check.
//
//   node scripts/check-next-report-band.mjs
import fs from "node:fs";
import path from "node:path";
import { loadOutlookGraph } from "./lib/outlook-module.mjs";
import { once } from "./lib/render-snapshot.mjs";
import { readCodeOnly } from "./lib/source-code.mjs";
import {
  loadSnapshot, loadCard, loadOldCard, tileText as renderTile, cardText, oldCardText,
} from "./lib/next-report-render.mjs";
import { oldTileNext, oldTileMutation, oldCardView } from "./lib/next-report-legacy.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// ── Fixtures: stored records, as the store writes them (newest first) ─────
const DAY = 86_400_000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const QUARTER_ENDS = [
  "2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30", "2025-06-30", "2025-03-31",
  "2024-12-31", "2024-09-30", "2024-06-30", "2024-03-31", "2023-12-31", "2023-09-30",
];
const ev = (periodEnd, announcedOn) => ({
  periodEnd, announcedOn, basis: "8-K item 2.02", accession: `acc-${periodEnd}`,
  timing: "after-close", form: "8-K", items: "2.02", eventDate: announcedOn,
});
const events = (lags) =>
  QUARTER_ENDS.map((end, i) => ev(end, iso(Date.parse(end) + lags[i % lags.length] * DAY)));

const g = await loadOutlookGraph();
const SR = await import(path.join(g.dir, "secReportDates.mjs"));

/** A record whose stored `next` is what estimateNextReport REALLY returns. */
function record(symbol, lags, nextPeriodEnd = "2026-09-30") {
  const evs = events(lags);
  return {
    symbol, cik: "1", at: "", nextPeriodEnd, events: evs,
    next: SR.estimateNextReport(evs, nextPeriodEnd, "Large accelerated filer"),
  };
}

const DATED = record("TSLA", [22]);                 // estimateNextReport -> 2026-10-22
const MONTHLY = record("AVAV", [20, 29, 22, 27]);   // estimateNextReport -> month 2026-10
// A period that ended with nothing filed: the filed-fact "due" answer.
const OVERDUE = { ...record("ABBV", [22], "2026-06-30"), events: events([22]).slice(1) };

console.log("\n0. THE FIXTURES REALLY CARRY AN ESTIMATED DATE AND MONTH");
check("the dated record's estimate is a DATE", DATED.next.kind === "date", JSON.stringify(DATED.next));
check("the monthly record's estimate is a MONTH", MONTHLY.next.kind === "month", JSON.stringify(MONTHLY.next));

// Every shape a date can be printed in on these pages.
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const gb = (d) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
  .format(new Date(`${d}T00:00:00Z`));
const monthWords = (ym) => `${MONTHS_LONG[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const shapes = (d) => (d.length === 7 ? [d, monthWords(d)] : [d, gb(d), monthWords(d.slice(0, 7))]);

/** The estimate the OLD code would have printed, in every shape it could take. */
const estimateShapes = (rec) =>
  rec.next.kind === "date" ? shapes(rec.next.date) : rec.next.kind === "month" ? shapes(rec.next.month) : [];

/** Filed facts: dates of documents that exist, and the period ends they cover. */
function filedFacts(rec, extra = []) {
  const days = new Set(extra.filter(Boolean));
  if (rec) {
    for (const e of rec.events) { days.add(e.announcedOn); days.add(e.periodEnd); }
    if (rec.nextPeriodEnd) days.add(rec.nextPeriodEnd);
  }
  return [...days].flatMap((d) => [d, gb(d)]);
}

const ISO_DAY = /\b\d{4}-\d{2}-\d{2}\b/;
const ISO_MONTH = /\b\d{4}-\d{2}\b/;
const GB_DAY = /\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec) \d{4}\b/;
const MONTH_NAME = new RegExp(`\\b(${MONTHS_LONG.join("|")}|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\\b`);

/**
 * THE SCAN. Returns the problems, empty when clean.
 *
 * Filed facts are removed first (longest first, so "30 Sep 2026" goes before
 * any shorter overlap), then anything date-shaped left over is an estimate.
 * The estimate's own shapes are also looked for by name, so a fixture whose
 * estimate happened to coincide with a filed fact could not hide it.
 */
function scan(text, rec, extraFacts = []) {
  const problems = [];
  for (const s of rec ? estimateShapes(rec) : []) {
    if (text.includes(s)) problems.push(`the estimate itself: "${s}"`);
  }
  let rest = text;
  for (const f of filedFacts(rec, extraFacts).sort((a, b) => b.length - a.length)) rest = rest.split(f).join(" ");
  for (const [name, re] of [["ISO day", ISO_DAY], ["ISO month", ISO_MONTH], ["day-month-year", GB_DAY], ["month name", MONTH_NAME]]) {
    const m = rest.match(re);
    if (m) problems.push(`${name} "${m[0]}"`);
  }
  return problems;
}

// ── The renderers ─────────────────────────────────────────────────────────
const snapshotFixture = JSON.parse(fs.readFileSync("data/sec/factset-fixture-TSLA.json", "utf8"));

const tileText = (S, symbol, nextReport) => renderTile(S, symbol, nextReport, snapshotFixture);

const read = (rec) => ({ ok: true, rec });
const CASES = [
  { name: "dated record, 2026-09-22", rec: DATED, today: "2026-09-22" },
  { name: "monthly record, 2026-09-22", rec: MONTHLY, today: "2026-09-22" },
  { name: "monthly record, 2026-10-01", rec: MONTHLY, today: "2026-10-01" },
  { name: "overdue record, 2026-09-22", rec: OVERDUE, today: "2026-09-22" },
];

/** Run every case through a graph + tile + card; return the scan problems per case. */
async function runAll({ graph = g, S, C }) {
  const out = [];
  for (const c of CASES) {
    const outlook = graph.mod.outlookFromRead(c.rec.symbol, read(c.rec), c.today);
    const tile = tileText(S, c.rec.symbol, graph.mod.compactOutlook(outlook));
    const card = cardText(C, graph.mod.outlookForEarningsCard(c.rec.symbol, read(c.rec), false, c.today));
    out.push({
      c, outlook, tile, card,
      tileProblems: scan(tile.text, c.rec, tile.facts),
      cardProblems: scan(card, c.rec),
    });
  }
  return out;
}

const S = await loadSnapshot();
const C = await loadCard();

console.log("\n1. NEITHER COMPONENT PRINTS AN ESTIMATED DATE OR MONTH");
const shipped = await runAll({ S, C });
for (const r of shipped) {
  check(`tile, ${r.c.name}: no estimated date`, r.tileProblems.length === 0, r.tileProblems.join("; "));
  check(`card, ${r.c.name}: no estimated date`, r.cardProblems.length === 0, r.cardProblems.join("; "));
}
// NOT VACUOUS: the fixtures produced every forward answer the band can give.
const kinds = new Set(shipped.map((r) => r.outlook.kind));
check("the cases cover expected, beyond-window and due",
  ["expected", "beyond-window", "due"].every((k) => kinds.has(k)), [...kinds].join(","));

console.log("\n2. THE SEARCH, THE CARD AND THE TILE SAY THE SAME SENTENCE");
for (const r of shipped) {
  const o = r.outlook;
  check(`${r.c.name}: the card carries the search's headline`, r.card.includes(o.headline), o.headline);
  check(`${r.c.name}: the tile carries the search's headline`, r.tile.text.includes(o.headline));
  if (o.hedge) {
    check(`${r.c.name}: the hedge is on the card AND in the tile's small line`,
      r.card.includes(o.hedge) && r.tile.text.includes(o.hedge));
  } else {
    check(`${r.c.name}: a filed-fact answer carries no estimate hedge`, o.kind === "due" || o.kind === "unavailable");
  }
}
{
  const dated = shipped[0];
  check("the dated record reads as the band, in #513's words",
    dated.outlook.kind === "expected" && /expected to report in roughly 22 to 30 days/.test(dated.card), dated.outlook.headline);
  check("the monthly record, before its window, reads 'not expected to report in the next 30 days'",
    /not expected to report in the next 30 days/.test(shipped[1].card) && /not expected to report in the next 30 days/.test(shipped[1].tile.text));
  check("a due filer keeps its filed-fact wording (dueRowLabel), period end and all",
    shipped[3].outlook.kind === "due" && /^Period ended 2026-06-30 · results have not yet been filed/.test(shipped[3].outlook.headline) &&
      shipped[3].card.includes(shipped[3].outlook.headline));
}

console.log("\n3. REFUSALS ARE NAMED, AND FMP'S DATE NEVER STANDS IN");
{
  const fmpOnly = g.mod.outlookForEarningsCard("NEWCO", { ok: true, rec: null }, true, "2026-09-22");
  check("a calendar entry with no SEC record renders the card…", fmpOnly !== null);
  check("…as the no-record refusal, not a date",
    fmpOnly?.kind === "no-estimate" && fmpOnly.reason === "no-record" && /no SEC filing record/.test(fmpOnly.hedge ?? ""),
    JSON.stringify(fmpOnly));
  check("the card function is never handed the calendar's date (its third argument is a boolean)",
    /hasCalendarEntry: boolean/.test(readCodeOnly("lib/server/symbolOutlook.ts")));
  const nothing = g.mod.outlookForEarningsCard("NEWCO", { ok: true, rec: null }, false, "2026-09-22");
  check("no record and no calendar entry: no card, as before", nothing === null);
  const down = g.mod.outlookFromRead("TSLA", { ok: false }, "2026-09-22");
  check("an unreadable store says so, and is NOT 'no SEC filing record'",
    down.kind === "unavailable" && /gap on our side/.test(down.headline));
  const thin = g.mod.outlookFromRead("THIN", read({ ...DATED, events: DATED.events.slice(0, 4) }), "2026-09-22");
  check("a thin history is a named refusal on both", thin.kind === "no-estimate" && thin.reason === "thin-history");
  // THE ACCURACY BAR IS THE SEARCH'S. An irregular filer whose estimateNextReport
  // would still return a month is refused, not banded.
  const wild = g.mod.outlookFromRead("WILD", read(record("WILD", [5, 60, 10, 90, 3, 80])), "2026-09-22");
  check("a filer below the per-filer precision bar is refused by name",
    wild.kind === "no-estimate" && wild.reason === "below-precision-bar", `${wild.kind}/${wild.reason}`);
}

console.log("\n4. THE PAGES ARE WIRED TO THE BAND, NOT TO `rec.next`");
function wiringProblems(page, snap) {
  const p = [];
  if (!/outlookForEarningsCard\(/.test(page)) p.push("earnings page does not call outlookForEarningsCard");
  if (!/<NextReportCard outlook=\{nextReport\} \/>/.test(page)) p.push("earnings page does not render NextReportCard");
  if (/secDates\.next\b|secDates\?\.next\b|next\.date\s*,\s*time|nextReport\.date|monthName\(/.test(page)) p.push("earnings page reads rec.next / FMP's date");
  if (!/compactOutlook\(outlookFromRead\(clean, read, today\)\)/.test(snap)) p.push("snapshot does not use compactOutlook(outlookFromRead(...))");
  if (/dates\??\.next\b/.test(snap)) p.push("snapshot reads dates.next");
  return p;
}
const PAGE = readCodeOnly("app/stock/[symbol]/earnings/page.tsx");
const SNAP = readCodeOnly("lib/server/secEarningsSnapshot.ts");
const wiring = wiringProblems(PAGE, SNAP);
check("page and snapshot route through symbolOutlook", wiring.length === 0, wiring.join("; "));
check("the tile formats no date for the next report",
  !/nextReport\.(date|month)|formatPlainDate\(n\./.test(readCodeOnly("app/components/LatestEarningsCard.tsx")));

// ── MUTANTS ───────────────────────────────────────────────────────────────
console.log("\n5. MUTANTS: EACH MUST FAIL THE SCAN (a survivor fails this check)");
const bit = (label, problems) =>
  check(`${label} is caught`, problems.length > 0, problems.length ? problems.slice(0, 2).join("; ") : "SURVIVED");

// M1 — THE OLD TILE: its formatter, its sub-line, and its mapping off
// `rec.next` (scripts/lib/next-report-legacy.mjs). This is the path that
// printed "22 Oct 2026" on /stock/TSLA.
{
  const S1 = await loadSnapshot(oldTileMutation);
  const t1 = tileText(S1, "TSLA", oldTileNext(DATED));
  bit("M1a old tile on the dated record (\"22 Oct 2026\")", scan(t1.text, DATED, t1.facts));
  const t2 = tileText(S1, "AVAV", oldTileNext(MONTHLY));
  bit("M1b old tile on the monthly record (\"2026-10\")", scan(t2.text, MONTHLY, t2.facts));
}

// M2 — THE OLD EARNINGS CARD: its JSX, fed its old view off `rec.next` and,
// on the no-record branch, FMP's calendar day.
{
  const Old = await loadOldCard();
  const render = (rec, fmp) => oldCardText(Old, oldCardView(rec, fmp), "X");
  bit("M2a old card on the dated record (\"2026-10-22\")", scan(render(DATED), DATED));
  bit("M2b old card on the monthly record (\"Expected in October 2026\")", scan(render(MONTHLY), MONTHLY));
  bit("M2c old card's FMP branch with no SEC record (\"2026-10-29\")", scan(render(null, "2026-10-29"), null));
}

// M3 — THE NEW COMPONENTS, with a day slipped into the SHARED headline. Proves
// the scan reads what the new path renders, not just what the old one did.
{
  const g3 = await loadOutlookGraph({
    patch: {
      "lib/server/symbolOutlook.ts": once(
        "headline: outlookBandLabel(symbol, row.band),",
        "headline: outlookBandLabel(symbol, row.band) + ' Around ' + new Date(Date.parse(today) + row.daysAway * 86400000).toISOString().slice(0, 10) + '.',",
      ),
    },
  });
  const r3 = await runAll({ graph: g3, S, C });
  bit("M3a a dated headline on the tile", r3[0].tileProblems);
  bit("M3b a dated headline on the card", r3[0].cardProblems);
  g3.cleanup();
}

// M4 — the FMP-with-no-record branch HIDES the card instead of refusing.
{
  const g4 = await loadOutlookGraph({
    patch: {
      "lib/server/symbolOutlook.ts": once(
        "if (read.ok && !read.rec && !hasCalendarEntry) return null;",
        "if (read.ok && !read.rec) return null;",
      ),
    },
  });
  const o = g4.mod.outlookForEarningsCard("NEWCO", { ok: true, rec: null }, true, "2026-09-22");
  check("M4 a hidden card on the FMP-only branch is caught (the refusal is required)",
    !(o?.kind === "no-estimate" && o.reason === "no-record"), o === null ? "hidden -> caught" : "SURVIVED");
  g4.cleanup();
}

// M5 — the wiring put back onto `rec.next`.
{
  const oldPage = PAGE.replace("outlookForEarningsCard(", "legacyNext(") + "\nconst d = secDates.next.date;";
  bit("M5a earnings page reading secDates.next", wiringProblems(oldPage, SNAP));
  const oldSnap = SNAP.replace("compactOutlook(outlookFromRead(clean, read, today))", "(dates?.next.kind === \"date\" ? dates.next : null)");
  bit("M5b snapshot reading dates.next", wiringProblems(PAGE, oldSnap));
}

g.cleanup();
console.log(failures ? `\n${failures} FAILED\n` : "\nall passed\n");
process.exit(failures ? 1 : 0);
