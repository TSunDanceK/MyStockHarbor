// REPORT DATES: the properties that are arithmetic, run rather than read.
//
// The timezone, the date agreement and the backtest need EDGAR and the store,
// so they live in scripts/sec-report-dates-probe.mjs and run on the relay. What
// is left here is what can be decided from the functions alone — and the
// session mapping is the one that matters most, because it is what makes a
// timing misclassification harmless instead of wrong.
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
      " TIMING_WORDING, REGULAR_SPREAD_DAYS, REGULARITY_WINDOW, daysBetween, median, deadlineDays, runEstimator, sameQuarterLastYear, PRIMARY_ESTIMATOR };" +
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
  check("...and it is the EARLIEST, not the amendment",
    out.find((e) => e.periodEnd === "2026-06-30")?.announcedOn === "2026-07-30",
    `${out.find((e) => e.periodEnd === "2026-06-30")?.announcedOn}`);
  check("the other period survives", out.length === 2, `${out.length} events`);
  check("an 8-K without item 2.02 is not an earnings announcement",
    m.reportEvents(subs([{ form: "8-K", items: "5.02", event: "2026-07-30", accepted: "2026-07-30T20:30:00.000Z" }]), PERIODS).length === 0);
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

console.log(
  failures ? `\n${failures} assertion(s) failed.` : "\nSession mapping, wording, dedupe and the gate hold.\n"
);
process.exit(failures ? 1 : 0);
