// REPORT DATES: the properties that are arithmetic, run rather than read.
//
// The timezone, the date agreement and the backtest need EDGAR and the store,
// so they live in scripts/sec-report-dates-probe.mjs and run on the relay. What
// is left here is what can be decided from the functions alone — and the
// session mapping is the one that matters most, because it is what makes a
// timing misclassification harmless instead of wrong.
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const SRC = readCodeOnly("lib/server/secReportDates.ts").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const load = (mutate = (s) => s, nonce = 0) =>
  lift(
    mutate(SRC).replace(/export (const|function|type)/g, "$1") +
      "\nexport { reportEvents, estimateNextReport, parseAcceptanceEt, timingFor, reactionDate," +
      " TIMING_WORDING, REGULAR_SPREAD_DAYS, REGULARITY_WINDOW, daysBetween, median, deadlineDays, runEstimator, sameQuarterLastYear, PRIMARY_ESTIMATOR, estimateUpcoming, nextPeriodEndFrom, periodAnniversary, reactionBarLabels, reportedLabel, latestResultsAnnouncement, pendingResults, snapPeriodEnd," +
      " resultsPairing, earlyNonResultsPattern, looksLikeEarlyNonResults, periodicReportDates };" +
      `\n// nonce ${nonce}`
  );
const m = await load();

console.log("\n1. the reaction session — the reason a timing mistake is survivable");

// THE PROPERTY, STATED AS THE OWNER STATED IT: an after-close filing on D and a
// before-open filing on D+1 are the same trading session, and must select it.
check("after-close on D and before-open on D+1 select the SAME session",
  m.reactionDate({ announcedOn: "2026-07-30", timing: "after-close" }) ===
    m.reactionDate({ announcedOn: "2026-07-31", timing: "before-open" }),
  `${m.reactionDate({ announcedOn: "2026-07-30", timing: "after-close" })} vs ` +
    `${m.reactionDate({ announcedOn: "2026-07-31", timing: "before-open" })}`);
check("...and during-market on D+1 selects it too",
  m.reactionDate({ announcedOn: "2026-07-31", timing: "during-market" }) === "2026-07-31",
  "before-open and during-market are digested by the same close, which is why " +
    "confusing those two cannot move the measurement");
check("only after-close advances the session",
  m.reactionDate({ announcedOn: "2026-07-31", timing: "after-close" }) === "2026-08-01" &&
    m.reactionDate({ announcedOn: "2026-07-31", timing: "before-open" }) === "2026-07-31");
// A MONTH AND YEAR BOUNDARY, because +1 day by string arithmetic is where this
// would break silently.
check("the +1 crosses a month end", m.reactionDate({ announcedOn: "2026-07-31", timing: "after-close" }) === "2026-08-01");
check("...and a year end", m.reactionDate({ announcedOn: "2026-12-31", timing: "after-close" }) === "2027-01-01");

{
  // MUTATION: during-market treated as after-close, which is the mistake a
  // wrong timezone would produce in bulk.
  const mut = await load((s) => s.replace('if (event.timing !== "after-close") return event.announcedOn;',
    'if (event.timing === "before-open") return event.announcedOn;'), 1);
  check("the mutation actually applied",
    mut.reactionDate({ announcedOn: "2026-07-31", timing: "during-market" }) === "2026-08-01");
  check("MUTATION: a during-market release would be measured on the wrong session",
    mut.reactionDate({ announcedOn: "2026-07-31", timing: "during-market" }) !==
      m.reactionDate({ announcedOn: "2026-07-31", timing: "during-market" }));
}

console.log("\n2. the wording describes the FILING, not the announcement");

for (const [k, v] of Object.entries(m.TIMING_WORDING)) {
  check(`${k} names the SEC filing`, /filed with the SEC/.test(v), v);
}
// THE CLAIM THIS MUST NOT MAKE. "Reported after close" asserts the press
// release time, which nothing here observes — only when a document reached
// EDGAR, which is at or after it.
check("nothing says 'reported'",
  !Object.values(m.TIMING_WORDING).some((v) => /\breported\b/i.test(v)),
  Object.values(m.TIMING_WORDING).find((v) => /\breported\b/i.test(v)) ?? "none");

console.log("\n3. the period is MATCHED, never read off the filing");

const subs = (rows) => ({
  filings: {
    recent: {
      accessionNumber: rows.map((r, i) => `a${i}`),
      form: rows.map((r) => r.form),
      items: rows.map((r) => r.items ?? null),
      reportDate: rows.map((r) => r.event),
      acceptanceDateTime: rows.map((r) => r.accepted),
    },
  },
});
// The stored fact set's real period ends.
const PERIODS = new Set(["2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30"]);

{
  // ── THE REGRESSION THIS EXISTS FOR ────────────────────────────────────
  // An Item 2.02 8-K's reportDate is the DATE OF THE EVENT — the results
  // release — not the quarter it covers. Reading it as a period end makes the
  // reporting lag announcement-minus-announcement: zero by construction, which
  // is what a backtest then reports as a perfect model.
  const out = m.reportEvents(
    subs([{ form: "8-K", items: "2.02,9.01", event: "2026-07-30", accepted: "2026-07-30T20:30:00.000Z" }]),
    PERIODS
  );
  check("an 8-K event date is kept as eventDate, not as the period",
    out[0]?.eventDate === "2026-07-30", `${out[0]?.eventDate}`);
  check("...and the period is the newest STORED end that had already passed",
    out[0]?.periodEnd === "2026-06-30", `${out[0]?.periodEnd}`);
  check("...so the reporting lag is real, not zero",
    m.daysBetween(out[0].periodEnd, out[0].announcedOn) === 30,
    `${m.daysBetween(out[0].periodEnd, out[0].announcedOn)} days — a lag of 0 is the ` +
      `identity that made a backtest report 0d median error across 103 filers`);
  // AND IT REFUSES rather than reaching for the nearest period.
  const stale = m.reportEvents(
    subs([{ form: "8-K", items: "2.02", event: "2027-06-01", accepted: "2027-06-01T20:30:00.000Z" }]),
    PERIODS
  );
  check("an announcement with no stored period within the window gets none",
    stale[0]?.periodEnd === null,
    `${stale[0]?.periodEnd} — 336 days past the newest stored end is not a match`);
}

console.log("\n3b. one event per period, earliest wins");
{
  const out = m.reportEvents(subs([
    { form: "8-K", items: "2.02,9.01", event: "2026-07-30", accepted: "2026-07-30T20:30:00.000Z" },
    { form: "8-K/A", items: "2.02", event: "2026-07-30", accepted: "2026-08-04T20:30:00.000Z" },
    { form: "8-K", items: "2.02", event: "2026-07-30", accepted: "2026-07-30T20:30:00.000Z" },
    { form: "8-K", items: "2.02", event: "2026-04-29", accepted: "2026-04-29T20:30:00.000Z" },
  ]), PERIODS);
  check("three filings for one period collapse to one event",
    out.filter((e) => e.periodEnd === "2026-06-30").length === 1,
    `${out.filter((e) => e.periodEnd === "2026-06-30").length}`);
  check("...and with no 10-Q on file to pair against, it is the EARLIEST, not the amendment",
    out.find((e) => e.periodEnd === "2026-06-30")?.announcedOn === "2026-07-30",
    `${out.find((e) => e.periodEnd === "2026-06-30")?.announcedOn}`);
  check("the other period survives", out.length === 2, `${out.length} events`);
  check("an 8-K without item 2.02 is not an earnings announcement",
    m.reportEvents(subs([{ form: "8-K", items: "5.02", event: "2026-07-30", accepted: "2026-07-30T20:30:00.000Z" }]), PERIODS).length === 0);
}

console.log("\n3d. a period's results are the LATEST 2.02 on or before its 10-Q/10-K");

// ── THE MISPICK, AS A FIXTURE ────────────────────────────────────────────
// Tesla's shape: delivery numbers under Item 2.02 two days after quarter end,
// results ~three weeks later, the 10-Q a day after that. Earliest-wins stored
// lag 2 over every period with a spread of 0 -- regular, and wrong.
// Plus the two things plain latest-wins would get wrong: a 2.02 filed AFTER
// the 10-Q (a restatement), and an 8-K/A inside the window.
const TSLA_ROWS = [
  { form: "8-K", items: "2.02,9.01", event: "2025-10-02", accepted: "2025-10-02T13:05:00.000Z" },
  { form: "8-K", items: "2.02,9.01", event: "2025-10-22", accepted: "2025-10-22T20:10:00.000Z" },
  { form: "10-Q", event: "2025-09-30", accepted: "2025-10-23T21:00:00.000Z" },
  { form: "8-K", items: "2.02,9.01", event: "2026-01-02", accepted: "2026-01-02T14:00:00.000Z" },
  { form: "8-K", items: "2.02,9.01", event: "2026-01-28", accepted: "2026-01-28T21:05:00.000Z" },
  { form: "10-K", event: "2025-12-31", accepted: "2026-01-29T22:00:00.000Z" },
  { form: "8-K", items: "2.02,9.01", event: "2026-04-02", accepted: "2026-04-02T13:10:00.000Z" },
  { form: "8-K", items: "2.02,9.01", event: "2026-04-22", accepted: "2026-04-22T20:10:00.000Z" },
  { form: "10-Q", event: "2026-03-31", accepted: "2026-04-23T21:00:00.000Z" },
  { form: "8-K", items: "2.02,9.01", event: "2026-07-02", accepted: "2026-07-02T13:10:00.000Z" },
  { form: "8-K", items: "2.02,9.01", event: "2026-07-22", accepted: "2026-07-22T20:10:00.000Z" },
  { form: "8-K/A", items: "2.02,9.01", event: "2026-07-22", accepted: "2026-07-23T13:00:00.000Z" },
  { form: "10-Q", event: "2026-06-30", accepted: "2026-07-23T21:00:00.000Z" },
  { form: "8-K", items: "2.02", event: "2026-08-10", accepted: "2026-08-10T20:00:00.000Z" },
];
const TSLA_PERIODS = new Set(["2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30"]);
const lagsFor = (mod, rows, periods) =>
  mod.reportEvents(subs(rows), periods)
    .filter((e) => e.periodEnd)
    .map((e) => mod.daysBetween(e.periodEnd, e.announcedOn));
{
  const lags = lagsFor(m, TSLA_ROWS, TSLA_PERIODS);
  check("every paired period keeps the RESULTS release, not the delivery 8-K",
    JSON.stringify(lags) === JSON.stringify([22, 22, 28, 22]),
    `lags ${JSON.stringify(lags)} (earliest-wins stored [2,2,2,2])`);
  const q2 = m.reportEvents(subs(TSLA_ROWS), TSLA_PERIODS).find((e) => e.periodEnd === "2026-06-30");
  check("a 2.02 filed AFTER the 10-Q is kept out of the pick",
    q2?.announcedOn === "2026-07-22", `${q2?.announcedOn} — 2026-08-10 is a restatement, not the release`);
  check("...and so is an 8-K/A inside the window while the original is there",
    q2?.form === "8-K", `${q2?.form} ${q2?.announcedOn}`);
  const pairing = m.resultsPairing(subs(TSLA_ROWS), TSLA_PERIODS);
  check("every period with a 10-Q/10-K on file is paired",
    pairing.periods.length === 4 && pairing.periods.every((p) => p.rule === "paired"),
    pairing.periods.map((p) => `${p.periodEnd}:${p.rule}`).join(" "));
  check("the 10-K pairs as well as the 10-Q",
    pairing.periods.find((p) => p.periodEnd === "2025-12-31")?.periodicFiledOn === "2026-01-29");

  // A 10-Q FILED THE SAME DAY AS THE RELEASE: on or before, not strictly before.
  const sameDay = lagsFor(m, [
    { form: "8-K", items: "2.02", event: "2026-07-01", accepted: "2026-07-01T13:00:00.000Z" },
    { form: "8-K", items: "2.02,9.01", event: "2026-07-28", accepted: "2026-07-28T20:05:00.000Z" },
    { form: "10-Q", event: "2026-06-30", accepted: "2026-07-28T20:30:00.000Z" },
  ], new Set(["2026-06-30"]));
  check("a release filed the same day as the 10-Q is inside the window", sameDay[0] === 28, `${sameDay}`);

  // THE FAST FILER, CONTROL: ORCL genuinely reports around ten days after its
  // quarter. One 2.02 per period, paired, untouched -- and no pattern.
  const ORCL_ROWS = [
    { form: "8-K", items: "2.02,9.01", event: "2026-06-10", accepted: "2026-06-10T20:05:00.000Z" },
    { form: "10-K", event: "2026-05-31", accepted: "2026-06-20T20:00:00.000Z" },
    { form: "8-K", items: "2.02,9.01", event: "2026-03-10", accepted: "2026-03-10T20:05:00.000Z" },
    { form: "10-Q", event: "2026-02-28", accepted: "2026-03-12T20:00:00.000Z" },
    { form: "8-K", items: "2.02,9.01", event: "2025-12-10", accepted: "2025-12-10T21:05:00.000Z" },
    { form: "10-Q", event: "2025-11-30", accepted: "2025-12-12T21:00:00.000Z" },
  ];
  const ORCL_PERIODS = new Set(["2026-05-31", "2026-02-28", "2025-11-30"]);
  check("control: a genuinely fast filer keeps its ~10-day lags",
    JSON.stringify(lagsFor(m, ORCL_ROWS, ORCL_PERIODS)) === JSON.stringify([10, 10, 10]),
    JSON.stringify(lagsFor(m, ORCL_ROWS, ORCL_PERIODS)));
  check("...and has no early non-results pattern",
    m.earlyNonResultsPattern(m.resultsPairing(subs(ORCL_ROWS), ORCL_PERIODS).periods) === null);

  const pattern = m.earlyNonResultsPattern(pairing.periods);
  check("the pattern is DERIVED from the pairing: 4 of 4 periods, early 2d vs results 22d",
    pattern?.periods === 4 && pattern?.ofPaired === 4 && pattern?.earlyLagDays === 2 && pattern?.resultsLagDays === 22,
    JSON.stringify(pattern));
  check("one early 2.02 is an incident, not a habit",
    m.earlyNonResultsPattern(m.resultsPairing(subs(TSLA_ROWS.filter((r) =>
      !["2025-10-02", "2026-01-02", "2026-04-02"].includes(r.event))), TSLA_PERIODS).periods) === null);

  // ── MUTATIONS OF THE PAIRING RULE ──────────────────────────────────────
  const noPair = await load((src) => src.replace(
    "const filedOn = periodEnd ? periodic.get(periodEnd) ?? null : null;",
    "const filedOn = null as string | null;"), 31);
  check("MUTATION: pairing disabled (earliest-wins) stores TSLA's delivery lag",
    JSON.stringify(lagsFor(noPair, TSLA_ROWS, TSLA_PERIODS)) === JSON.stringify([2, 2, 2, 2]) &&
      JSON.stringify(lagsFor(noPair, TSLA_ROWS, TSLA_PERIODS)) !== JSON.stringify(lagsFor(m, TSLA_ROWS, TSLA_PERIODS)),
    `${JSON.stringify(lagsFor(noPair, TSLA_ROWS, TSLA_PERIODS))} — the checks above see it`);
  const noBound = await load((src) => src.replace(
    'e.basis === "8-K item 2.02" && e.announcedOn <= filedOn',
    'e.basis === "8-K item 2.02"'), 32);
  check("MUTATION: dropping the on-or-before-the-10-Q bound picks the restatement",
    noBound.reportEvents(subs(TSLA_ROWS), TSLA_PERIODS).find((e) => e.periodEnd === "2026-06-30")?.announcedOn === "2026-08-10",
    "which is option 4's failure mode, and why the bound is the rule");
  const withAmend = await load((src) => src.replace(
    'const originals = before.filter((e) => e.form === "8-K");',
    'const originals = before;'), 33);
  check("MUTATION: letting an 8-K/A compete inside the window picks the amendment",
    withAmend.reportEvents(subs(TSLA_ROWS), TSLA_PERIODS).find((e) => e.periodEnd === "2026-06-30")?.form === "8-K/A");
}

console.log("\n3e. the CURRENT period, which has no 10-Q yet, is judged by the filer's own past");
{
  const events = m.reportEvents(subs(TSLA_ROWS), TSLA_PERIODS);
  const pattern = m.earlyNonResultsPattern(m.resultsPairing(subs(TSLA_ROWS), TSLA_PERIODS).periods);
  const cadence = m.nextPeriodEndFrom([...TSLA_PERIODS], []);
  // latestResultsAnnouncement's shape: unplaced, periodEnd null.
  const latestOf = (on, timing) => ({
    periodEnd: null, eventDate: on, announcedOn: on, announcedAt: "08:00", timing,
    form: "8-K", items: "2.02,9.01", accession: `l${on}`, basis: "8-K item 2.02",
  });
  const delivery = latestOf("2026-10-02", "before-open");
  const results = latestOf("2026-10-21", "after-close");

  check("the Q3 delivery 8-K does NOT mark Q3's results as filed",
    m.pendingResults(events, delivery, cadence, "2026-10-03", pattern) === null,
    JSON.stringify(m.pendingResults(events, delivery, cadence, "2026-10-03", pattern)));
  const real = m.pendingResults(events, results, cadence, "2026-10-22", pattern);
  check("...while the real Q3 release, three weeks later, does",
    real?.periodEnd === "2026-09-30" && real?.announcedOn === "2026-10-21", JSON.stringify(real));
  check("control: with no pattern, an early 2.02 is still a release (ORCL-fast is not suspect)",
    m.pendingResults(events, delivery, cadence, "2026-10-03", null)?.announcedOn === "2026-10-02");
  check("the judgement is the filer's own midpoint, not a day count",
    m.looksLikeEarlyNonResults(11, pattern) && !m.looksLikeEarlyNonResults(12, pattern) &&
      !m.looksLikeEarlyNonResults(2, { ...pattern, earlyLagDays: 1, resultsLagDays: 3 }),
    "TSLA 2 vs 22 -> below 12 is early; a filer at 1 vs 3 is judged at 2");

  // ...AND DOES NOT DROP IT FROM THE DUE LIST. estimateUpcoming rolls to the
  // next period once the estimate has passed; on the old 2-day lag that
  // happened on Oct 3 and TSLA left the due strip before reporting anything.
  const up = m.estimateUpcoming(events, cadence, "Large accelerated filer", "2026-10-03");
  check("on Oct 3 the period estimated for is still Q3, not Q4",
    up.periodEnd === "2026-09-30" && up.estimate.kind === "date" && up.estimate.medianLagDays === 22,
    `${up.periodEnd} ${JSON.stringify(up.estimate)}`);

  const noGuard = await load((src) => src.replace(
    "  if (looksLikeEarlyNonResults(daysBetween(periodEnd, latest.announcedOn), pattern)) return null;\n", ""), 34);
  check("MUTATION: without the guard the delivery 8-K is announced as Q3's results",
    noGuard.pendingResults(events, delivery, cadence, "2026-10-03", pattern)?.announcedOn === "2026-10-02");
  const noPair = await load((src) => src.replace(
    "const filedOn = periodEnd ? periodic.get(periodEnd) ?? null : null;",
    "const filedOn = null as string | null;"), 35);
  const upOld = noPair.estimateUpcoming(noPair.reportEvents(subs(TSLA_ROWS), TSLA_PERIODS), cadence, "Large accelerated filer", "2026-10-03");
  check("MUTATION: on earliest-wins TSLA has rolled to Q4 by Oct 3 — dropped from the due list",
    upOld.periodEnd === "2026-12-31", `${upOld.periodEnd}`);
  const oneIsHabit = await load((src) => src.replace(
    "export const EARLY_PATTERN_MIN_PERIODS = 2;", "export const EARLY_PATTERN_MIN_PERIODS = 1;"), 36);
  check("MUTATION: a single incident counted as a habit flags the filer",
    oneIsHabit.earlyNonResultsPattern(oneIsHabit.resultsPairing(subs(TSLA_ROWS.filter((r) =>
      !["2025-10-02", "2026-01-02", "2026-04-02"].includes(r.event))), TSLA_PERIODS).periods) !== null);
}

console.log("\n3f. EVERY rewritten record drains the queue — the one-off filers included");
{
  // The predicate, lifted from the store (it is pure; the Redis client is not).
  const storeSrc = readCodeOnly("lib/server/secReportDatesStore.ts");
  const start = storeSrc.indexOf("export function pairingRewriteDone(");
  const body = start === -1 ? "" : storeSrc.slice(start, storeSrc.indexOf("\n}\n", start) + 2);
  check("pairingRewriteDone is in the store", Boolean(body));
  const done = (await lift(body.replace(/export function/, "function")
    .replace(/: StoredReportDates \| null/, "").replace(/: boolean/, "") + "\nexport { pairingRewriteDone };"))
    .pairingRewriteDone;

  // The record exactly as the cron writes it, through the JSON round trip
  // Upstash puts it through. ORCL's shape: paired, no early pattern -- one of
  // the 125. TSLA's shape: the 84.
  const ORCL_ROWS = [
    { form: "8-K", items: "2.02,9.01", event: "2026-06-10", accepted: "2026-06-10T20:05:00.000Z" },
    { form: "10-K", event: "2026-05-31", accepted: "2026-06-20T20:00:00.000Z" },
    { form: "8-K", items: "2.02,9.01", event: "2026-03-10", accepted: "2026-03-10T20:05:00.000Z" },
    { form: "10-Q", event: "2026-02-28", accepted: "2026-03-12T20:00:00.000Z" },
  ];
  const ONE_OFF = TSLA_ROWS.filter((r) => !["2025-10-02", "2026-01-02", "2026-04-02"].includes(r.event));
  const written = (mod, rows, periods) => JSON.parse(JSON.stringify({
    symbol: "X", events: mod.reportEvents(subs(rows), periods),
    earlyNonResults: mod.earlyNonResultsPattern(mod.resultsPairing(subs(rows), periods).periods),
  }));
  const oneOff = written(m, ONE_OFF, TSLA_PERIODS);
  check("a one-off filer (one mispicked period, no pattern) writes earlyNonResults: null",
    oneOff.earlyNonResults === null && "earlyNonResults" in oneOff, JSON.stringify(oneOff.earlyNonResults));
  check("...and that record is DONE — it leaves the queue", done(oneOff) === true);
  check("a filer with no early 2.02 at all is done too",
    done(written(m, ORCL_ROWS, new Set(["2026-05-31", "2026-02-28"]))) === true);
  check("a repeat filer (the 84) is done", done(written(m, TSLA_ROWS, TSLA_PERIODS)) === true);
  check("a record written BEFORE the pairing (no key) is not done — it is queued",
    done({ symbol: "X", events: [] }) === false);
  check("no record (never written, or unreadable) is queued", done(null) === false);

  // MUTATION: the pattern returns undefined instead of null for a filer
  // without one. JSON drops the key, the record never looks done, and every
  // one-off filer is rewritten on every run for ever.
  const undef = await load((src) => src.replace(
    "  if (early.length < EARLY_PATTERN_MIN_PERIODS) return null;",
    "  if (early.length < EARLY_PATTERN_MIN_PERIODS) return undefined as unknown as null;"), 37);
  check("MUTATION: undefined in place of null leaves the one-off filer queued forever",
    done(written(undef, ONE_OFF, TSLA_PERIODS)) === false,
    "so the null is load-bearing and asserted above");
  // MUTATION: the drain tested on the VALUE, not the key.
  const byValue = (rec) => rec !== null && typeof rec === "object" && Boolean(rec.earlyNonResults);
  check("MUTATION: a drain on the value requeues every one-off filer",
    byValue(oneOff) === false && done(oneOff) === true);
}

console.log("\n3c. THE BUG CLASS: a filing's reported date is never a period end");

// ── WHY THIS HAS ITS OWN SECTION ─────────────────────────────────────────
// The defect it guards shipped once and was invisible: reading the 8-K's
// "Date of Report (Date of earliest event reported)" as the fiscal period end
// makes every reporting lag announcement-minus-announcement — ZERO by
// construction — and a backtest built on it reported a 0-day median error
// across 103 filers, which reads as a triumph.
//
// NOTHING ABOUT THAT FAILS. No exception, no empty column, no wrong-looking
// number on a page. Only the lags collapsing to zero gives it away, so that is
// what this asserts, and the mutation restores the bug to prove the assertion
// can see it.
{
  // The two dates DIFFER by construction: period ends 06-30, announced 07-30.
  const rows = [
    { form: "8-K", items: "2.02", event: "2026-07-30", accepted: "2026-07-30T20:30:00.000Z" },
    { form: "8-K", items: "2.02", event: "2026-04-29", accepted: "2026-04-29T20:30:00.000Z" },
    { form: "8-K", items: "2.02", event: "2026-01-28", accepted: "2026-01-28T21:30:00.000Z" },
    { form: "8-K", items: "2.02", event: "2025-10-29", accepted: "2025-10-29T20:30:00.000Z" },
  ];
  const lagsOf = (mod) =>
    mod.reportEvents(subs(rows), PERIODS)
      .filter((e) => e.periodEnd)
      .map((e) => mod.daysBetween(e.periodEnd, e.announcedOn));

  const good = lagsOf(m);
  check("every lag is the real gap from the matched period end",
    good.length >= 3 && good.every((d) => d >= 20 && d <= 45),
    `lags ${JSON.stringify(good)} — a real quarterly reporting lag`);
  check("...and not one of them is zero",
    good.every((d) => d !== 0),
    `${good.filter((d) => d === 0).length} zero lag(s) — zero is the signature of the bug`);

  // MUTATION: read the filing's own reported date as the period, which is the
  // defect verbatim.
  const bug = await load(
    (src) => src.replace(
      "    let periodEnd: string | null = null;",
      "    let periodEnd: string | null = eventDate;\n    if (false)"
    ),
    2
  );
  const bugged = lagsOf(bug);
  check("the read-the-report-date mutation actually applied",
    JSON.stringify(bugged) !== JSON.stringify(good), `${JSON.stringify(bugged)}`);
  check("MUTATION: reading the reported date as the period collapses every lag to 0",
    bugged.length > 0 && bugged.every((d) => d === 0),
    `${JSON.stringify(bugged)} — this is what produced a 0-day median error across 103 filers`);
}

console.log("\n4. the regularity gate");

const ev = (period, accepted, basis = "8-K item 2.02") => ({
  periodEnd: period, eventDate: accepted, announcedOn: accepted, announcedAt: "16:30",
  timing: "after-close", form: "8-K", items: "2.02", accession: `x${period}${accepted}`, basis,
});
{
  // Four lags of 30, 31, 30, 32 — a spread of 2, comfortably regular.
  const regular = [
    ev("2026-06-30", "2026-07-30"), ev("2026-03-31", "2026-05-01"),
    ev("2025-12-31", "2026-01-30"), ev("2025-09-30", "2025-11-01"),
  ];
  const r = m.estimateNextReport(regular, "2026-09-30", "Large accelerated filer");
  check("a regular filer gets a DATE", r.kind === "date", `${r.kind} ${r.date ?? r.reason ?? ""}`);
  // THE PRIMARY CARRIES IT WHEN IT CAN. 2025-09-30 sits 365 days before the
  // target period end, so the same quarter a year ago exists and A — the
  // estimator chosen by the measured table — is what produced the date.
  check("...from the PRIMARY estimator, because the same quarter exists a year back",
    r.kind === "date" && r.estimator === m.PRIMARY_ESTIMATOR,
    `estimator ${r.estimator}, primary ${m.PRIMARY_ESTIMATOR}`);
  // A AND B ARE NOT THE SAME ARITHMETIC and this fixture separates them: the
  // year-ago quarter ended 2025-09-30 and was announced 2025-11-01, a lag of
  // 32. A holds the LAG (2026-09-30 + 32 = 2026-11-01); B holds the CALENDAR
  // POSITION (2025-11-01 + 364 = 2026-10-31). A day apart, so a check that
  // expected one would pass on the other only by accident.
  check("A holds the lag from period end, B holds the weekday",
    m.runEstimator("A", regular, "2026-09-30") === "2026-11-01" &&
      m.runEstimator("B", regular, "2026-09-30") === "2026-10-31",
    `A ${m.runEstimator("A", regular, "2026-09-30")}, B ${m.runEstimator("B", regular, "2026-09-30")}`);
  check("...and the shipped date is the primary's own arithmetic",
    r.kind === "date" && r.date === m.runEstimator(m.PRIMARY_ESTIMATOR, regular, "2026-09-30"),
    `${r.date}`);
  check("...and the spread that earned it travels with it",
    r.kind === "date" && r.spreadDays <= m.REGULAR_SPREAD_DAYS, `spread ${r.spreadDays}`);

  // ── THE DOCUMENTED FALLBACK ────────────────────────────────────────────
  // A and B both need the same quarter a year ago. A filer whose stored history
  // SKIPS that quarter — no matched event for 2025-09-30 — has nothing for them
  // to work from, and C must carry it rather than the estimate vanishing.
  const gapped = [
    ev("2026-06-30", "2026-07-30"), ev("2026-03-31", "2026-05-01"),
    ev("2025-12-31", "2026-01-30"), ev("2025-06-30", "2025-07-30"),
  ];
  check("no same-quarter event a year ago: A and B have no input",
    m.runEstimator("A", gapped, "2026-09-30") === null &&
      m.runEstimator("B", gapped, "2026-09-30") === null,
    `A ${m.runEstimator("A", gapped, "2026-09-30")}, B ${m.runEstimator("B", gapped, "2026-09-30")}`);
  const g = m.estimateNextReport(gapped, "2026-09-30", "Large accelerated filer");
  check("...so the estimate falls back to C rather than disappearing",
    g.kind === "date" && g.estimator === "C" && g.date === "2026-10-30",
    `${g.kind} ${g.date ?? ""} estimator ${g.estimator} — median lag 30 on 2026-09-30`);

  // Lags 20, 40, 25, 55 — a spread of 35, and spanning two months.
  const irregular = [
    ev("2026-06-30", "2026-07-20"), ev("2026-03-31", "2026-05-10"),
    ev("2025-12-31", "2026-01-25"), ev("2025-09-30", "2025-11-24"),
  ];
  const ir = m.estimateNextReport(irregular, "2026-09-30", "Large accelerated filer");
  check("an irregular filer gets NO date", ir.kind !== "date", `${ir.kind}: ${ir.reason ?? ir.month ?? ""}`);

  // Three events only.
  const thin = regular.slice(0, 3);
  const t = m.estimateNextReport(thin, "2026-09-30", "Large accelerated filer");
  check("fewer than four prior announcements gets nothing",
    t.kind === "none", `${t.kind}: ${t.reason ?? ""}`);

  // 6-K events, however regular, are refused: the selection rule is positional.
  const sixK = regular.map((e) => ({ ...e, basis: "6-K near period end" }));
  const sk = m.estimateNextReport(sixK, "2026-09-30", "Large accelerated filer");
  check("a 6-K history earns no estimate at all",
    sk.kind === "none", `${sk.kind}: ${sk.reason ?? ""} — the weakest evidence must not carry the most specific claim`);

  // ── NO MATCHED PERIOD END, NO DATE ─────────────────────────────────────
  // All three estimators are arithmetic on a period end and the deadline that
  // caps them is measured from one. A filer whose next period end could not be
  // matched gets silence, not a date computed off the announcement.
  const n = m.estimateNextReport(regular, null, "Large accelerated filer");
  check("an unmatched next period end yields no date at all",
    n.kind === "none", `${n.kind}: ${n.reason ?? n.date ?? ""}`);

  // The clamp.
  const slow = [
    ev("2026-06-30", "2026-09-15"), ev("2026-03-31", "2026-06-16"),
    ev("2025-12-31", "2026-03-17"), ev("2025-09-30", "2025-12-16"),
  ];
  const c = m.estimateNextReport(slow, "2026-09-30", "Large accelerated filer");
  check("a lag past the statutory deadline is clamped to it",
    c.kind === "date" && c.clamped && c.date === "2026-11-09",
    `${c.kind} ${c.date ?? ""} clamped=${c.clamped} — 40 days after 2026-09-30`);
}

console.log("\n4b. \"next expected\" is never a date that has already passed");

// ── THE DEFECT, CAUGHT ON THE FIRST SEEDED PREVIEW ───────────────────────
// ABT rendered "Next expected earnings date: 2026-07-18" on a page read in
// September. The estimate was CORRECT for the quarter it was computed for —
// and that quarter had already been reported. The stored fact set lags the
// filings by design, so one cadence step past its newest period can be behind
// today, and a past date under "next expected" is worse than no date: nothing
// fails, and a reader cannot tell it from a date the company missed.
{
  // A filer whose stored facts stop two quarters back, exactly the shape a
  // fact set has between an announcement and the 10-Q that follows it.
  const stale = [
    ev("2026-03-31", "2026-04-16"), ev("2025-12-31", "2026-01-16"),
    ev("2025-09-30", "2025-10-16"), ev("2025-06-30", "2025-07-16"),
  ];
  const cadence = m.nextPeriodEndFrom(
    ["2026-03-31", "2025-12-31", "2025-09-30", "2025-06-30"], []
  );
  check("the cadence is read from the filer's own period spacing",
    cadence && cadence.stepDays >= 89 && cadence.stepDays <= 93, `${cadence?.stepDays}`);

  // UNROLLED, this is the bug: one step past 2026-03-31 is 2026-06-30, whose
  // announcement lands in July — three months before the day it is read.
  const raw = m.estimateNextReport(stale, cadence.end, "Large accelerated filer");
  check("the unrolled estimate really is in the past",
    raw.kind === "date" && raw.date < "2026-09-16", `${raw.date} — this is what shipped`);

  const rolled = m.estimateUpcoming(stale, cadence, "Large accelerated filer", "2026-09-16");
  check("rolled forward, the estimate is on or after today",
    rolled.estimate.kind === "date" && rolled.estimate.date >= "2026-09-16",
    `${rolled.estimate.date ?? rolled.estimate.reason}`);
  check("...and it is the NEXT unreported period, not an arbitrary future one",
    rolled.periodEnd === "2026-09-30",
    `${rolled.periodEnd} — one period past the newest whose announcement has passed`);
  // AND IT DOES NOT ROLL FOREVER. A filer with a strange cadence must not hang
  // a render; after eight steps it says nothing instead.
  check("the roll is bounded",
    /for \(let i = 0; i < 8; i\+\+\)/.test(readCodeOnly("lib/server/secReportDates.ts")),
    "an unbounded roll is a hang on a page render");

  // ── THE TWO FILER CALENDARS, WHICH +365 GETS WRONG FOR BOTH SOMETIMES ──
  check("a month-end quarter's anniversary is the same month end",
    m.periodAnniversary("2025-09-30") === "2026-09-30" &&
      m.periodAnniversary("2025-02-28") === "2026-02-28",
    `${m.periodAnniversary("2025-09-30")} / ${m.periodAnniversary("2025-02-28")}`);
  check("...including across a leap year, where +365 would miss",
    m.periodAnniversary("2027-02-28") === "2028-02-29",
    `${m.periodAnniversary("2027-02-28")} — February 2028 has 29 days`);
  check("a 52/53-week quarter's anniversary preserves the WEEKDAY",
    m.periodAnniversary("2026-06-27") === "2027-06-26",
    `${m.periodAnniversary("2026-06-27")} — AAPL's June quarter, 364 days on`);

  // A MONTH THAT HAS PASSED is the same mistake in a coarser unit.
  const irregularStale = [
    ev("2026-03-31", "2026-04-05"), ev("2025-12-31", "2026-01-25"),
    ev("2025-09-30", "2025-10-04"), ev("2025-06-30", "2025-07-24"),
  ];
  const mo = m.estimateUpcoming(irregularStale, cadence, "Large accelerated filer", "2026-09-16");
  check("a month-only estimate is never a month already gone",
    mo.estimate.kind !== "month" || mo.estimate.month >= "2026-09",
    `${mo.estimate.kind} ${mo.estimate.month ?? mo.estimate.reason ?? ""}`);

  // THE CLOCK IS AN ARGUMENT. A function that reads Date.now() cannot be given
  // a date to test against, and this whole section is a date to test against.
  check("today is passed in, never read from the clock",
    !/Date\.now\(\)|new Date\(\)/.test(
      (readCodeOnly("lib/server/secReportDates.ts").match(/function estimateUpcoming[\s\S]*?\n\}/) ?? [""])[0]
    ));
}

console.log("\n4c. every reaction bar carries the PAGE'S OWN label, and they are distinct");

// ── THE LABEL MAP ITSELF, WHICH THE LAST ROUND'S FIXTURE ASSUMED AWAY ────
//
// WHY THE "LATEST BAR EQUALS THE SNAPSHOT" ASSERTION PASSED ON A BROKEN PAGE.
// It was given a hand-written Map of one label per period end — a model of the
// map, not the code that builds it. The defect was entirely in the BUILDING:
// quarters and years were merged with years last, so on a filer whose 10-Qs
// carry twelve-month comparatives every quarter end was overwritten by an
// annual entry. AMZN rendered "FY2025 (05/01) · FY2025 (07/31) · FY2025
// (10/30)" and the assertion could not see it, because the fixture had already
// decided what the map contained.
//
// So the map is now built by the shipped function, from a set shaped like the
// filer that broke it.
// ── ONE PRELUDE FOR BOTH CODEC LIFTS ────────────────────────────────────────
//
// secFactCodec reads SEC_QUARTER_WINDOW, SEC_YEAR_WINDOW and SEC_LABEL_VERSION
// from secExtract, and secExtract reads the currency decision, which reads the
// rate selectors. Stripping imports left all three constants free: the lifts
// here only call reactionPeriodLabels and periodLabel, which never touch them,
// so nothing failed — until assertLiftIsClosed refused an open lift outright.
//
// One value, used twice, so the mutation lift below cannot drift from the
// unmutated one it is compared against.
const stripImports = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const CODEC_PRELUDE = [
  readCodeOnly("lib/server/secFields.ts"),
  stripImports("lib/server/secExtract.ts"),
  stripImports("lib/server/fxRates.ts"),
  stripImports("lib/server/secCurrency.ts"),
].join("\n");

const codec = await lift(
  [
    CODEC_PRELUDE,
    stripImports("lib/server/secFactCodec.ts"),
    "export { reactionPeriodLabels, periodLabel };",
  ].join("\n"),
  "",
  "secFactCodec"
);
{
  const q = (e, fp, fy) => ({ e, s: null, fp, fy, a: null, f: null, v: [], d: "" });
  // AMZN-SHAPED: real quarters, plus the twelve-month comparatives its 10-Qs
  // carry, which land in `years` with ends on QUARTER ends.
  const amzn = {
    quarters: [q("2026-06-30", "Q2", 2026), q("2026-03-31", "Q1", 2026),
      q("2025-12-31", "Q4", 2025), q("2025-09-30", "Q3", 2025)],
    years: [q("2026-06-30", "FY", 2026), q("2026-03-31", "FY", 2026),
      q("2025-12-31", "FY", 2025), q("2025-09-30", "FY", 2025)],
  };
  const labels = codec.reactionPeriodLabels(amzn);
  check("a twelve-month comparative never takes a quarter end's label",
    labels.get("2026-06-30") === "Q2 FY2026" && labels.get("2026-03-31") === "Q1 FY2026",
    `${labels.get("2026-06-30")} / ${labels.get("2026-03-31")} — "FY2026" is what AMZN rendered`);
  check("...on every end the two lists share",
    [...labels.values()].every((l) => /^Q[1-4] FY\d{4}$/.test(l)), [...labels.values()].join(" · "));

  // AND THE COLLISION SUFFIX IS THE TELL. Matched correctly there is nothing to
  // break, so a "(MM/DD)" on this filer means the map is wrong again.
  const bars = [
    { periodEnd: "2025-09-30", announcedOn: "2025-10-30" },
    { periodEnd: "2025-12-31", announcedOn: "2026-02-05" },
    { periodEnd: "2026-03-31", announcedOn: "2026-05-01" },
    { periodEnd: "2026-06-30", announcedOn: "2026-07-31" },
  ];
  const amznBars = m.reactionBarLabels(bars, (e) => labels.get(e));
  check("AMZN's bars carry no collision suffix at all",
    !amznBars.some((l) => /\(\d{2}\/\d{2}\)/.test(l)), amznBars.join(" · "));
  check("...and the latest is the quarter the snapshot names",
    amznBars[amznBars.length - 1] === "Q2 FY2026", amznBars.join(" · "));

  // THE MUTATION: years last, which is what shipped.
  const yearsWin = await lift(
    [
      CODEC_PRELUDE,
      stripImports("lib/server/secFactCodec.ts")
        // THE ORIGINAL INLINE CONSTRUCTION, restored exactly: one loop over
        // quarters then years, years last, no guard and no Q4 rule.
        .replace("    if (!p.e || out.has(p.e)) continue;", "    if (!p.e) continue;")
        .replace("    out.set(p.e, reportsQuarters && p.fy ? `Q4 FY${p.fy}` : periodLabel(p));",
                 "    out.set(p.e, periodLabel(p));"),
      "export { reactionPeriodLabels };\n// years win",
    ].join("\n")
  );
  const broken = m.reactionBarLabels(bars, (e) => yearsWin.reactionPeriodLabels(amzn).get(e));
  check("MUTATION: letting the annual entry win reproduces the rendered defect",
    broken.some((l) => /\(\d{2}\/\d{2}\)/.test(l)) && broken.some((l) => /^FY\d{4}/.test(l)),
    broken.join(" · "));

  // ── AN ANNUAL PERIOD IS THE FOURTH QUARTER'S REPORT ────────────────────
  // On the reaction card only. A bar reading "FY2025" beside "Q3 FY2025"
  // implies a different KIND of event; it is the same event.
  const withYearEnd = {
    quarters: [q("2025-09-30", "Q3", 2025), q("2025-06-30", "Q2", 2025)],
    years: [q("2025-12-31", "FY", 2025)],
  };
  check("a year end with no quarter frame reads Q4, not FY",
    codec.reactionPeriodLabels(withYearEnd).get("2025-12-31") === "Q4 FY2025",
    `${codec.reactionPeriodLabels(withYearEnd).get("2025-12-31")}`);
  check("...but a filer that publishes NO quarters keeps FY",
    codec.reactionPeriodLabels({ quarters: [], years: [q("2025-12-31", "FY", 2025)] })
      .get("2025-12-31") === "FY2025",
    "for an annual filer the year IS the story, and Q4 would be a claim it never made");
  check("the SNAPSHOT's own labeller is untouched",
    codec.periodLabel(q("2025-12-31", "FY", 2025)) === "FY2025",
    "only the reaction card names an announcement; the five-year card names a period");
}

// ── THREE DEFECTS, ALL VISIBLE ON ONE PREVIEW, ALL ONE CAUSE ─────────────
// The bars were labelled by the CALENDAR quarter of an announcement date:
//   AAPL's latest bar read "Q2 26" under a snapshot calling it Q3 FY2026
//   AAP carried "Q4 23" twice
//   AAP and ABEV showed "Q3 26" for a quarter that had not ended
// An announcement names the quarter it FALLS IN, not the one it reports on,
// and two announcements can fall in one.
{
  // The stored fact set's own labels — the vocabulary the rest of the page uses.
  const STORED = new Map([
    ["2026-06-27", "Q3 FY2026"], ["2026-03-28", "Q2 FY2026"],
    ["2025-12-27", "Q1 FY2026"], ["2025-09-27", "Q4 FY2025"],
  ]);
  const at = (end, on) => ({ periodEnd: end, announcedOn: on });
  const rows = [
    at("2025-09-27", "2025-10-30"), at("2025-12-27", "2026-01-29"),
    at("2026-03-28", "2026-04-30"), at("2026-06-27", "2026-07-30"),
  ];
  const labels = m.reactionBarLabels(rows, (e) => STORED.get(e));
  check("every bar takes the STORED period's label, not a calendar quarter",
    labels.join("|") === "Q4 FY2025|Q1 FY2026|Q2 FY2026|Q3 FY2026", labels.join("|"));
  check("the LATEST bar matches what the snapshot calls the same filing",
    labels[labels.length - 1] === STORED.get("2026-06-27"),
    `${labels[labels.length - 1]} — "Q2 26" under a Q3 FY2026 snapshot is what shipped`);
  check("no two bars share a label",
    new Set(labels).size === labels.length, labels.join(" "));
  // AND THE CALENDAR READING WOULD HAVE DISAGREED on every one of them, so
  // these are not passing on a coincidence.
  const calendarish = rows.map((r) => {
    const d = new Date(`${r.announcedOn}T00:00:00Z`);
    return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${String(d.getUTCFullYear()).slice(-2)}`;
  });
  check("...and the calendar-of-the-announcement reading differs on every bar",
    calendarish.every((c, i) => c !== labels[i]), calendarish.join("|"));

  // A BAR WITH NO MATCHED PERIOD MAKES NO FISCAL CLAIM.
  const fallback = m.reactionBarLabels(
    [at(null, "2026-08-20"), at(null, "2026-05-21")], () => undefined
  );
  check("an unmatched bar says when it was reported, not which quarter",
    fallback.join("|") === "Reported Aug 2026|Reported May 2026", fallback.join("|"));
  check("...and never names a quarter at all",
    !fallback.some((l) => /^Q[1-4]\b/.test(l)));

  // TWO ANNOUNCEMENTS IN ONE MONTH would collide, and a chart with two bars
  // named the same thing cannot be read.
  const collide = m.reactionBarLabels(
    [at(null, "2026-08-04"), at(null, "2026-08-27")], () => undefined
  );
  check("a collision on the fallback path is broken by the day",
    new Set(collide).size === 2, collide.join(" | "));

  // NO LABEL FOR A PERIOD THE FACT SET DOES NOT HOLD. A period is only stored
  // once it is FILED, so "never label a quarter that has not ended" follows
  // from never inventing a label for an unknown period.
  const future = m.reactionBarLabels([at("2026-09-30", "2026-08-20")], (e) => STORED.get(e));
  check("a period the fact set does not hold gets NO quarter label",
    future[0] === "Reported Aug 2026",
    `${future[0]} — 2026-09-30 has not been filed, so there is nothing to name it`);
}

console.log("\n4d. announced, but not yet in the SEC data feed");

// ── THE CASE, MEASURED ───────────────────────────────────────────────────
// ABT announced its June quarter on 2026-07-16 and filed the 10-Q on
// 2026-07-28. Seven weeks later companyfacts carried NO duration frame ending
// 2026-06-30 — every tag, no filter, its newest end was 2026-03-31. The page
// said "Most recent quarter filed: Q1 FY2026" and was correct; a reader who
// knows ABT reported in July reads it as broken.
{
  const placed = [
    ev("2026-03-31", "2026-04-16"), ev("2025-12-31", "2026-01-22"),
    ev("2025-09-30", "2025-10-15"), ev("2025-06-30", "2025-07-17"),
  ];
  const cadence = m.nextPeriodEndFrom(
    ["2026-03-31", "2025-12-31", "2025-09-30", "2025-06-30"], []
  );
  const july = { ...ev("2026-06-30", "2026-07-16"), periodEnd: null };

  const p = m.pendingResults(placed, july, cadence, "2026-09-16");
  check("an announcement newer than the placed one is pending",
    p?.periodEnd === "2026-06-30" && p?.announcedOn === "2026-07-16",
    JSON.stringify(p));
  check("...and the quarter is SNAPPED to the year-ago anniversary, not the median step",
    m.snapPeriodEnd(placed, cadence.end) === "2026-06-30",
    `${m.snapPeriodEnd(placed, cadence.end)} — the stepped date is only used to find it`);

  // ── THE ORDERING IS THE TEST, AND IT MUST NOT FIRE ON A NORMAL FILER ───
  const uptodate = m.pendingResults(placed, ev("2026-03-31", "2026-04-16"), cadence, "2026-09-16");
  check("a filer whose newest announcement is already on the page shows nothing",
    uptodate === null, JSON.stringify(uptodate));
  check("...nor does one announcing a quarter TODAY",
    m.pendingResults(placed, { ...july, announcedOn: "2026-09-16" }, cadence, "2026-09-16") === null,
    "companyfacts was never going to carry it yet, and saying so on the day is noise");
  check("...nor one whose derived quarter has not ended",
    m.pendingResults(placed, { ...july, announcedOn: "2026-07-16" }, cadence, "2026-05-01") === null,
    "a quarter that has not finished cannot have been reported");
  check("no cadence, no claim about which quarter",
    m.pendingResults(placed, july, null, "2026-09-16") === null,
    "the notice names a quarter, so a quarter has to be known");
  check("no placed 8-K history, no baseline to be newer than",
    m.pendingResults([], july, cadence, "2026-09-16") === null);

  // ── 8-K ONLY, AND NOT AN AMENDMENT ────────────────────────────────────
  const feed = (rows) => ({ filings: { recent: {
    accessionNumber: rows.map((_, i) => `a${i}`),
    form: rows.map((r) => r.form),
    items: rows.map((r) => r.items ?? null),
    reportDate: rows.map((r) => r.event),
    acceptanceDateTime: rows.map((r) => r.accepted),
  } } });
  check("a 6-K is never the pending announcement",
    m.latestResultsAnnouncement(feed([
      { form: "6-K", event: "2026-06-30", accepted: "2026-07-16T20:30:00.000Z" },
    ])) === null,
    "a 6-K carries no item codes and is selected positionally — too weak for this claim");
  check("an 8-K/A is not either",
    m.latestResultsAnnouncement(feed([
      { form: "8-K/A", items: "2.02", event: "2026-07-16", accepted: "2026-07-16T20:30:00.000Z" },
    ])) === null,
    "an amendment re-announces a period already announced");
  check("an 8-K without item 2.02 is not either",
    m.latestResultsAnnouncement(feed([
      { form: "8-K", items: "5.02", event: "2026-07-16", accepted: "2026-07-16T20:30:00.000Z" },
    ])) === null);
  check("the newest qualifying 8-K IS it, with no period matching at all",
    (() => {
      const got = m.latestResultsAnnouncement(feed([
        { form: "8-K", items: "2.02", event: "2026-04-16", accepted: "2026-04-16T10:30:00.000Z" },
        { form: "8-K", items: "2.02,9.01", event: "2026-07-16", accepted: "2026-07-16T10:30:00.000Z" },
      ]));
      return got?.announcedOn === "2026-07-16" && got?.periodEnd === null;
    })(),
    "matching is what discards it inside reportEvents; this reader must not match");

  // ── THE MUTATION: compare period ends instead of announcement dates ────
  // The ordering test is the whole design. Comparing the derived period against
  // the stored one would fire on any filer whose cadence points past its newest
  // stored quarter — which is every filer, most of the time.
  {
    const mut = await load((src) => src.replace(
      "  if (latest.announcedOn <= newestPlaced.announcedOn) return null;",
      "  if (false) return null;"), 7);
    check("MUTATION: dropping the ordering test fires on an up-to-date filer",
      mut.pendingResults(placed, ev("2026-03-31", "2026-04-16"), cadence, "2026-09-16") !== null,
      "every filer would carry the notice, which makes it mean nothing");
  }
}

console.log("\n5. the page is wired to the filings, not to the calendar");

// SOURCE-LEVEL, because the page is a server component that reads Redis and
// fetches FMP — lifting it would mean stubbing both, and the stubs are where a
// check like this quietly stops testing the real thing.
{
  const page = readCodeOnly("app/stock/[symbol]/earnings/page.tsx");

  // ── THE FMP CALL IS SKIPPED, NOT IGNORED ───────────────────────────────
  // An ignored fetch still spends the daily limit, which is the cost this step
  // exists to remove.
  check("the /earnings call is conditional on the SEC record being empty",
    /secEvents\.length\s*\?\s*Promise\.resolve\(null\)\s*:\s*fetchFmpJson/.test(page),
    "the FMP call must be behind the SEC record, not merely unused");

  // ── THE LABEL COMES FROM THE PERIOD, NOT THE ANNOUNCEMENT ──────────────
  // THE DEFECT THIS GUARDS: a quarter ending 30 June announced 30 July was
  // labelled from the announcement, so it read "Q3" — the quarter AFTER the one
  // the bar measures. Every bar on the chart named the wrong quarter, and
  // nothing about that fails.
  check("...and the session comes from the filing timing",
    /e\.timing === "after-close" \? "amc" : "bmo"/.test(page),
    "after-close is the only timing that advances the session");

  // ── THE NEXT REPORT IS THE 30-DAY BAND, NOT estimateNextReport's DAY ───
  // SUPERSEDED 2026-09-23 (owner decision): the card used to print the day
  // ("Estimated from {clean}'s own past reporting pattern ... free to break
  // the pattern") or the month ("Expected in November 2026"). It now renders
  // the /earnings-calendar search's answer; the rendered-output proof, with
  // mutants, is scripts/check-next-report-band.mjs. What stays here is only
  // that the old day/month path is gone from the page source.
  check("the next-report card is the search's outlook, not estimateNextReport's day",
    /outlookForEarningsCard\(/.test(page) && !/secDates\??\.next\b/.test(page) && !/monthName\(/.test(page));

  // ── ONE VOCABULARY FOR THE WHOLE PAGE ──────────────────────────────────
  // The bars were labelled by the CALENDAR quarter of a date while every other
  // card used the filer's own fiscal label: AAPL's latest bar read "Q2 26"
  // under a snapshot calling the same filing Q3 FY2026, AAP showed "Q4 23"
  // twice, and both showed a quarter that had not ended.
  check("a bar's label is the STORED period's label, looked up by matched period end",
    /reactionBarLabels\(barRows, \(end\) => storedLabels\.get\(end\)\)/.test(page),
    "a calendar quarter of the announcement is what shipped");
  check("...and the map is built by the SHIPPED function, not inline on the page",
    /reactionPeriodLabels\(cold\.set\)/.test(page) &&
      !/storedLabels\.set\(/.test(page),
    "an inline merge on the page is what let years overwrite quarters, unseen by any check");
  check("BOTH paths go through the one labeller, so neither can drift",
    (page.match(/reactionBarLabels\(/g) ?? []).length === 1 &&
      /periodEnd: null, announcedOn: row\.date, row/.test(page),
    "the FMP path had its own labeller, which is what put Q4 23 on two bars");
  check("the page defines no quarter-from-a-date labeller at all any more",
    !/function quarterLabel/.test(page) && !/function displayQuarterLabel/.test(page),
    "leaving it in leaves the defect one call site away");

  // ── THE REFUSAL IS RENDERED, NOT LEFT BLANK ────────────────────────────
  // On AAP the card did not render at all — indistinguishable from a symbol
  // with no SEC data. The refusal is now the outlook's NAMED one (thin
  // history, below the accuracy bar, no record...), rendered by NextReportCard
  // whenever the record was read; check-next-report-band.mjs renders it.
  check("the card renders whatever the outlook says, refusals included",
    /\{nextReport \? <NextReportCard outlook=\{nextReport\} \/> : null\}/.test(page),
    "a blank cannot be told from 'we never looked'");

  // ── THE TIMING WORDING RULE REACHES THE EXPLANATORY COPY TOO ───────────
  // THE COPY MOVED to ReactionCharts.tsx and was cut to one line (owner review
  // of AVAV, round 2); it still names the filing, never a release time.
  const reactionSrc = readCodeOnly("app/stock/[symbol]/earnings/ReactionCharts.tsx");
  check("the reaction explanation describes the FILING, not a release",
    /Close-to-close move around each results filing\. After-close filings are measured/.test(reactionSrc) &&
      !/released before market open/.test(page + reactionSrc),
    "'released before market open' asserts a press-release time nothing here observes");

  // ── THE CRON WRITES IT, AND MATCHES RATHER THAN READS ──────────────────
  const job = readCodeOnly("app/api/jobs/sec-facts/route.ts");
  // ── THE PAIRING REWRITE: LISTED, GATED, SELF-DRAINING ──────────────────
  const list = JSON.parse(fs.readFileSync("data/sec/report-dates-rewrite.json", "utf8"));
  check("the rewrite list is committed and names TSLA and ABBV",
    Array.isArray(list.symbols) && list.symbols.includes("TSLA") && list.symbols.includes("ABBV"),
    `${list.symbols?.length} symbols`);
  const rw = readCodeOnly("app/api/jobs/sec-report-dates-rewrite/route.ts");
  const builder = readCodeOnly("lib/server/secReportDatesWrite.ts");
  check("...and its own route queues it, drained by pairingRewriteDone",
    /reportDatesRewrite\.symbols/.test(rw) && /pairingRewriteDone\(records\[i\]\)/.test(rw) &&
      /rewriteQueue\(listed, done,/.test(rw));
  check("...NOT inside sec-facts, whose report-dates block sits behind a 300s timeout",
    !/reportDatesRewrite/.test(job));
  check("both routes write through the ONE builder, and it through the one gated writer",
    /buildAndWriteReportDates\(symbol, cik, set, subs, todayIso\)/.test(job) &&
      /buildAndWriteReportDates\(symbol, cik, set, subs, todayIso\)/.test(rw) &&
      (builder.match(/writeReportDates\(/g) ?? []).length === 1 &&
      !/writeReportDates\(/.test(job) && !/writeReportDates\(/.test(rw));
  check("...and the write passes earlyNonResults straight through, never omitted or coerced",
    /\n\s*earlyNonResults,\n\s*\};/.test(builder) &&
      /const ok = await writeReportDates\(rec\);/.test(builder) &&
      /const earlyNonResults = earlyNonResultsPattern\(pairing\.periods\);/.test(builder));
  check("the pending-results guard is handed the pattern at the write site",
    /latestResultsAnnouncement\(subs\), cadence, todayIso, earlyNonResults/.test(builder));
  {
    const q = await lift(readCodeOnly("lib/server/secReportDatesWrite.ts")
      .slice(readCodeOnly("lib/server/secReportDatesWrite.ts").indexOf("export function rewriteQueue("))
      .replace(/: readonly string\[\]|: ReadonlySet<string>|: string\[\]/g, "") + "\nexport { rewriteQueue };");
    const got = q.rewriteQueue(["AA", "TSLA", "BB", "ABBV", "CC"], new Set(["BB"]), new Set(["TSLA", "ABBV"]));
    check("the rewrite queue is cut-first, drops done records, keeps list order otherwise",
      JSON.stringify(got) === JSON.stringify(["TSLA", "ABBV", "AA", "CC"]), JSON.stringify(got));
  }
  check("the cron passes the STORED period ends into the matcher",
    /resultsPairing\(subs, new Set\(\[\.\.\.quarterEnds, \.\.\.yearEnds\]\)\)/.test(builder),
    "period ends must come from the fact set, never from the filing");
  check("...and only stores events whose period was matched",
    /\.filter\(\(e\) => e\.periodEnd\)/.test(builder));
  check("...and stamps the symbol even when it found no events",
    /if \(entry\) entry\.reportDatesAt = Date\.now\(\);/.test(job),
    "or a filer with no Item 2.02 history is re-fetched every day forever");
  // THE RATE GATE IS SHARED. SEC's limit is per requester; two fetchers each
  // spacing their own calls would between them double the measured rate.
  // ── THE NOTICE ─────────────────────────────────────────────────────────
  const cards = readCodeOnly("app/stock/[symbol]/earnings/SecEarningsCards.tsx");
  check("the notice names the quarter, the date, and blames the FEED",
    /Results for the quarter ended/.test(cards) &&
      /The SEC has not yet published the figures in its\s+data feed/.test(cards),
    "it must not read as a claim about the company's filing");
  check("...and asserts nothing about what the results were",
    !/beat|missed|estimate|consensus/i.test(
      (cards.match(/Results for the quarter ended[\s\S]{0,400}/) ?? [""])[0]
    ));
  check("the page reads it from the stored record, never deriving it on a render",
    /pendingResults: secDates\?\.pending \?\? null/.test(page) &&
      !/latestResultsAnnouncement/.test(page),
    "deriving it needs submissions, and a render has no business fetching EDGAR");
  check("the cron computes it from the submissions payload already in hand",
    /pendingResults\(\s*\n?\s*events, latestResultsAnnouncement\(subs\), cadence, todayIso/.test(builder),
    "a second fetch for a notice would double this phase's SEC cost");

  check("the cron rolls the estimate past what has already been reported",
    /const cadence = nextPeriodEndFrom\(quarterEnds, yearEnds\);/.test(builder) &&
      /estimateUpcoming\(\s*\n?\s*events, cadence, subs\.category, todayIso\s*\n?\s*\)/.test(builder) &&
      !/estimateNextReport\(/.test(builder),
    "estimateNextReport alone would store a date already in the past");
  check("...and the notice reads the SAME cadence, so the two cannot disagree",
    (builder.match(/const cadence = nextPeriodEndFrom/g) ?? []).length === 1,
    "two derivations would let the estimate and the notice name different quarters");
  // THREE FETCHERS, ONE GATE since 2026-09-23 (#535 COWORK #6): the filing-
  // folder read joined companyfacts and submissions on the same `lastAt`.
  check("every SEC fetcher shares one rate gate",
    (job.match(/lastAt \+ MIN_GAP_MS - Date\.now\(\)/g) ?? []).length === 2 &&
      !/let lastAt2|const lastAt2/.test(job),
    "a second gate would let the two endpoints double the request rate");
}

console.log(
  failures ? `\n${failures} assertion(s) failed.` : "\nSession mapping, wording, dedupe, the gate and the page wiring hold.\n"
);
process.exit(failures ? 1 : 0);
