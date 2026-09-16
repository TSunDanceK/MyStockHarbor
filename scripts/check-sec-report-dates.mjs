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
      " TIMING_WORDING, REGULAR_SPREAD_DAYS, REGULARITY_WINDOW, daysBetween, median, deadlineDays };" +
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

console.log("\n3. one event per period, earliest wins");

// An amendment and a duplicate index entry for the same period, plus a real
// prior quarter. Values are dates and nothing here asserts a figure.
const subs = (rows) => ({
  filings: {
    recent: {
      accessionNumber: rows.map((r, i) => `a${i}`),
      form: rows.map((r) => r.form),
      items: rows.map((r) => r.items ?? null),
      reportDate: rows.map((r) => r.period),
      acceptanceDateTime: rows.map((r) => r.accepted),
    },
  },
});
{
  const out = m.reportEvents(subs([
    { form: "8-K", items: "2.02,9.01", period: "2026-06-30", accepted: "2026-07-30T20:30:00.000Z" },
    { form: "8-K/A", items: "2.02", period: "2026-06-30", accepted: "2026-08-04T20:30:00.000Z" },
    { form: "8-K", items: "2.02", period: "2026-06-30", accepted: "2026-07-30T20:30:00.000Z" },
    { form: "8-K", items: "2.02", period: "2026-03-31", accepted: "2026-04-29T20:30:00.000Z" },
  ]));
  check("three filings for one period collapse to one event",
    out.filter((e) => e.periodEnd === "2026-06-30").length === 1,
    `${out.filter((e) => e.periodEnd === "2026-06-30").length}`);
  check("...and it is the EARLIEST, not the amendment",
    out.find((e) => e.periodEnd === "2026-06-30")?.announcedOn === "2026-07-30",
    `${out.find((e) => e.periodEnd === "2026-06-30")?.announcedOn} — the original is what the market reacted to`);
  check("the other period survives", out.length === 2, `${out.length} events`);
  check("an 8-K without item 2.02 is not an earnings announcement",
    m.reportEvents(subs([{ form: "8-K", items: "5.02", period: "2026-06-30", accepted: "2026-07-30T20:30:00.000Z" }])).length === 0);
}

console.log("\n4. the regularity gate");

const ev = (period, accepted, basis = "8-K item 2.02") => ({
  periodEnd: period, announcedOn: accepted, announcedAt: "16:30", timing: "after-close",
  form: "8-K", items: "2.02", accession: `x${period}${accepted}`, basis,
});
{
  // Four lags of 30, 31, 30, 32 — a spread of 2, comfortably regular.
  const regular = [
    ev("2026-06-30", "2026-07-30"), ev("2026-03-31", "2026-05-01"),
    ev("2025-12-31", "2026-01-30"), ev("2025-09-30", "2025-11-01"),
  ];
  const r = m.estimateNextReport(regular, "2026-09-30", "Large accelerated filer");
  check("a regular filer gets a DATE", r.kind === "date", `${r.kind} ${r.date ?? r.reason ?? ""}`);
  check("...and the spread that earned it travels with it",
    r.kind === "date" && r.spreadDays <= m.REGULAR_SPREAD_DAYS, `spread ${r.spreadDays}`);

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
