// The ticker search's answer, asserted on the exact bytes a reader receives.
//
// ── THE PROPERTY THIS FILE EXISTS FOR ─────────────────────────────────────
// /earnings-calendar's search used to say "NVDA next reports on Nov 18, 2026"
// from FMP's calendar: a specific day, stated as fact, with no hedge. Two
// measurements in this repo say no specific day is supportable (2 of 48 filers
// inside their own p90 band; 0 of 276 8-K scheduling announcements). The one
// way to undo this change is for a day to creep back into that sentence, so
// EVERY estimated string the route can emit is scanned for date-shaped content
// -- not just the ones this file expects to be wrong.
//
// ── AND THE SECOND: A FILED FACT OUTRANKS AN ESTIMATE ─────────────────────
// A company whose period ended with nothing filed is "outstanding", a fact
// about the public record. The estimator will happily describe the same company
// as "expected to report within the next 7 days", which is softer, forward-
// looking, and wrong about what we actually know. The precedence is asserted on
// a fixture that is deliberately BOTH, so flipping the order changes the answer
// rather than changing nothing.
//
// The panel itself is a client component behind an async state transition, so
// there is no markup to render here the way check-expected-section renders its
// server component. That is exactly why the sentences are composed in lib/ and
// handed to the client finished: the reader-visible bytes are assertable at the
// producer. The component is checked for WIRING only, and the two halves are
// named separately below so nobody mistakes one for the other.
//
//   node scripts/check-symbol-outlook.mjs
import { loadOutlookGraph, withStore } from "./lib/outlook-module.mjs";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const g = await loadOutlookGraph();
const { outlookFrom, getSymbolOutlook } = g.mod;
const { dueRowLabel } = g.due;
const { PRECISION_BAR_DOMESTIC, PRECISION_BAR_FPI, filerPrecision } = g.expected;

const DAY = 86_400_000;
const TODAY = "2026-09-22";
const T = Date.parse(`${TODAY}T00:00:00Z`);
const iso = (t) => new Date(t).toISOString().slice(0, 10);

const ev = (periodEnd, announcedOn, basis = "8-K item 2.02") => ({
  periodEnd, announcedOn, basis, accession: "x", timing: null, form: "8-K", items: "2.02", eventDate: announcedOn,
});
/** n periods at `lag` days, newest first, as the store writes them. */
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
  symbol: "X", cik: "1", at: "", nextPeriodEnd: iso(T + 8 * DAY),
  next: { kind: "none", reason: "" }, events: history(12, 30), ...over,
});
/** A record whose estimate lands exactly `daysAway` from today. */
const at = (daysAway, over = {}) =>
  rec({ nextPeriodEnd: iso(T + (daysAway - 30) * DAY), ...over });

console.log("\n1. FOUR ANSWERS, AND NONE OF THEM IS A DATE");
{
  const due = outlookFrom("DUE", rec({
    nextPeriodEnd: iso(T - 30 * DAY),
    next: { kind: "date", medianLagDays: 30 },
  }), TODAY);
  const exp = outlookFrom("EXP", at(5), TODAY);
  const far = outlookFrom("FAR", at(45), TODAY);
  const none = outlookFrom("NONE", null, TODAY);

  check("a period ended with nothing filed reads as DUE", due.kind === "due", due.kind);
  check("an estimate inside 30 days reads as EXPECTED", exp.kind === "expected", exp.kind);
  check("an estimate past 30 days reads as BEYOND-WINDOW", far.kind === "beyond-window", far.kind);
  check("no record at all reads as NO-ESTIMATE", none.kind === "no-estimate", none.kind);
  check("...with the reason named, not counted", none.reason === "no-record", String(none.reason));
  check("all four headlines differ",
    new Set([due, exp, far, none].map((o) => o.headline)).size === 4);
}

console.log("\n2. THE FILED FACT OUTRANKS THE ESTIMATE");
{
  // BOTH AT ONCE, deliberately: period ended 30 days ago, median lag 30, so
  // the estimator's own answer for this record is "0 days away" -- band d0_7,
  // "expected to report within the next 7 days". If the due branch ever stops
  // running first, this fixture starts answering with the softer sentence.
  const both = rec({ nextPeriodEnd: iso(T - 30 * DAY), next: { kind: "date", medianLagDays: 30 } });
  const got = outlookFrom("BOTH", both, TODAY);
  const asEstimate = g.expected.expectedFrom("BOTH", both, TODAY, new Set());
  check("the fixture really is both — the estimator alone would band it",
    Boolean(asEstimate.row) && asEstimate.row.band === "d0_7");
  check("...and the answer given is the RECORD's, not the estimate's", got.kind === "due");

  // BYTE-IDENTICAL to the strip's own row label. Two sentences for one state is
  // how the search and the strip start disagreeing about the same company.
  const entry = {
    symbol: "BOTH", periodEnd: iso(T - 30 * DAY),
    dueFrom: iso(T - 7 * DAY), expectedOn: TODAY, daysOutstanding: 30,
  };
  check("the due headline is dueRowLabel's own output, not a paraphrase",
    got.headline === dueRowLabel(entry), got.headline);
  check("and it carries NO hedge — it is not an estimate", got.hedge === null);
}

console.log("\n3. THE BANDS ARE THE SENTENCE, AND THE EDGES ARE WHERE THEY SAY");
{
  const say = (d) => outlookFrom("X", at(d), TODAY).headline;
  check("0 days -> the 7-day sentence", say(0) === g.copy.outlookBandLabel("X", "d0_7"), say(0));
  check("7 is still the first band", say(7) === say(0));
  check("8 crosses into the second", say(8) === g.copy.outlookBandLabel("X", "d8_21"), say(8));
  check("21 is the second band's last day", say(21) === say(8));
  check("22 crosses into the third", say(22) === g.copy.outlookBandLabel("X", "d22_30"), say(22));
  check("30 is the last day inside the window", say(30) === say(22));
  check("31 leaves the window entirely",
    outlookFrom("X", at(31), TODAY).kind === "beyond-window");
  check("the three band sentences are three different sentences",
    new Set([say(0), say(8), say(22)]).size === 3);
}

console.log("\n4. NO DATE-SHAPED THING IN ANY ESTIMATED SENTENCE");
{
  // The scan runs over the headline AND the hedge of every estimated answer the
  // module can produce, at every band edge -- not over a sample this file
  // chose. `evidence` is excluded ON PURPOSE and checked separately in §7: its
  // dates are filed documents, which are facts.
  const estimated = [0, 1, 7, 8, 21, 22, 30, 31, 45, 120]
    .map((d) => outlookFrom("X", at(d), TODAY))
    .filter((o) => o.kind === "expected" || o.kind === "beyond-window");
  check("the sweep really produced both estimated kinds",
    new Set(estimated.map((o) => o.kind)).size === 2, `${estimated.length} answers`);

  const ISO = /\d{4}-\d{2}-\d{2}/;
  const MONTH = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}\b/i;
  // The only numbers a band sentence may contain are the band edges themselves.
  const VOCAB = new Set(["7", "8", "21", "22", "30"]);
  let dated = [];
  let strayNumber = [];
  for (const o of estimated) {
    for (const s of [o.headline, o.hedge ?? ""]) {
      if (ISO.test(s) || MONTH.test(s)) dated.push(s);
      for (const n of s.match(/\d+/g) ?? []) if (!VOCAB.has(n)) strayNumber.push(`${n} in "${s}"`);
    }
  }
  check("no ISO date and no 'Nov 18' in any estimated sentence", dated.length === 0, dated.join(" | "));
  check("no number beyond the band edges 7/8/21/22/30", strayNumber.length === 0, strayNumber.join(" | "));

  // A CONTROL. The scanner must be able to see a date, or the two passes above
  // prove only that it is blind.
  check("...and the scanner is not blind — it sees a planted date",
    ISO.test("expected on 2026-11-18") && MONTH.test("next reports on Nov 18, 2026"));
}

console.log("\n5. EVERY ESTIMATE CARRIES ITS HEDGE, AND ONLY FACTS GO BARE");
{
  const hedged = [outlookFrom("X", at(3), TODAY), outlookFrom("X", at(60), TODAY)];
  check("both estimated kinds carry the hedge verbatim",
    hedged.every((o) => o.hedge === g.copy.OUTLOOK_HEDGE));
  check("the hedge names the method and denies the announcement",
    /filing history/.test(g.copy.OUTLOOK_HEDGE) &&
    /not announced by the company/.test(g.copy.OUTLOOK_HEDGE) &&
    /not a confirmed date/.test(g.copy.OUTLOOK_HEDGE), g.copy.OUTLOOK_HEDGE);

  const bare = outlookFrom("DUE", rec({
    nextPeriodEnd: iso(T - 30 * DAY), next: { kind: "date", medianLagDays: 30 },
  }), TODAY);
  check("the filed-record answer carries none — it is not an estimate", bare.hedge === null);
  check("and a refusal's hedge is its REASON, not the estimate hedge",
    outlookFrom("X", null, TODAY).hedge !== g.copy.OUTLOOK_HEDGE);
}

console.log("\n6. THE FPI BAR IS HIGHER, THROUGH THIS PATH TOO");
{
  // The fixture PROVES ITSELF first. A filer sitting between the two bars is
  // the only kind that can tell them apart, and a fixture that drifts out of
  // that gap would leave §6 asserting nothing while still printing PASS.
  const jitter = (i) => (i % 2 ? 10 : 0);
  const lags = g.expected.lagsFrom(history(12, 30, "8-K item 2.02", jitter)).lags;
  const p = filerPrecision(lags);
  check("the fixture sits strictly between the two bars",
    p.precision >= PRECISION_BAR_DOMESTIC && p.precision < PRECISION_BAR_FPI,
    `${p.precision.toFixed(3)} in [${PRECISION_BAR_DOMESTIC}, ${PRECISION_BAR_FPI})`);

  // Same dates, same lags, same everything but the filing form.
  const shaky = (basis) => at(10, { events: history(12, 30, basis, jitter) });
  const dom = outlookFrom("DOM", shaky("8-K item 2.02"), TODAY);
  const fpi = outlookFrom("FPI", shaky("6-K near period end"), TODAY);
  check("a domestic filer at that precision IS shown", dom.kind === "expected", dom.kind);
  check("the same history on a 6-K basis is REFUSED", fpi.kind === "no-estimate", fpi.kind);
  check("...for the named reason, not a generic one", fpi.reason === "below-precision-bar", String(fpi.reason));

  // And the widening that makes FPIs reachable at all still holds: a 6-K filer
  // good enough for the higher bar is shown, not structurally excluded.
  const goodFpi = outlookFrom("FPIOK", at(10, { events: history(12, 30, "6-K near period end") }), TODAY);
  check("a 6-K filer that clears 0.8 IS shown — the basis is not an exclusion",
    goodFpi.kind === "expected", goodFpi.kind);
}

console.log("\n7. THE EVIDENCE IS FILED FACTS AND SAMPLE SIZES");
{
  const o = outlookFrom("X", at(10), TODAY);
  check("the habit line carries its sample size",
    o.evidence.some((l) => /over its last 12 periods/.test(l)), o.evidence.join(" | "));
  check("the period the report would cover is stated",
    o.evidence.some((l) => l.startsWith("For the period ending ")));
  check("the last filing on record is stated, with its date",
    o.evidence.some((l) => /^Last reported \d{4}-\d{2}-\d{2}/.test(l)));
  check("a record with no events offers no invented evidence",
    outlookFrom("X", at(10, { events: [] }), TODAY).evidence.every((l) => !/Last reported/.test(l)));

  // ── THE HABIT LINE COMES FROM THE SAME MEDIAN THE DECISION USED ─────────
  // Relay 35763134385 printed ANET with a beyond-window answer and NO habit
  // line: the decision used the filer's own lags while the evidence read the
  // store's `next.medianLagDays`, which is refused for an irregular filer. Two
  // medians over two event sets, one of which could be absent while the other
  // was not.
  const far = outlookFrom("X", at(60), TODAY);
  check("a beyond-window answer explains itself with the SAME habit",
    far.evidence.some((l) => /Usually reports 30 days after a period ends, over its last 12 periods/.test(l)),
    far.evidence.join(" | "));
  check("...even when the store's own estimate is not a dated one",
    outlookFrom("X", at(60, { next: { kind: "month", month: "2026-12" } }), TODAY)
      .evidence.some((l) => /Usually reports 30 days/.test(l)));
  check("and it prints no period end — that would hand back the arithmetic",
    far.evidence.every((l) => !/For the period ending/.test(l)));

  // The sample size counts USABLE lags, not stored events. An announcement
  // dated before its own period end is dropped from the median; quoting it in
  // "over its last N periods" would overstate the evidence behind the number.
  const withJunk = at(10, { events: [...history(12, 30), ev("2026-03-31", "2026-03-01")] });
  check("the sample size counts the lags the median used, not the raw events",
    outlookFrom("X", withJunk, TODAY).evidence.some((l) => /over its last 12 periods/.test(l)),
    `${withJunk.events.length} events stored`);
}

console.log("\n8. EVERY REFUSAL IS NAMED, AND THE NAMES SAY WHOSE GAP IT IS");
{
  const REASONS = ["no-record", "no-period-end", "thin-history", "below-precision-bar", "estimate-in-past"];
  const labels = REASONS.map((r) => g.copy.outlookReasonLabel(r));
  check("every reason has its own sentence", new Set(labels).size === REASONS.length);
  check("no reason falls through to undefined", labels.every((l) => typeof l === "string" && l.length > 10));

  const got = {
    "no-record": outlookFrom("X", null, TODAY),
    "no-period-end": outlookFrom("X", at(10, { nextPeriodEnd: null }), TODAY),
    "thin-history": outlookFrom("X", at(10, { events: history(4, 30) }), TODAY),
    "estimate-in-past": outlookFrom("X", at(-5), TODAY),
  };
  for (const [want, o] of Object.entries(got)) {
    check(`${want} is reported as itself`, o.kind === "no-estimate" && o.reason === want, String(o.reason));
  }
  // THE DISTINCTION THIS WHOLE PAGE IS BUILT ON. "We have never read this
  // filer" and "we cannot read anything right now" are different owners, and
  // they were one skip until a per-symbol reader needed them apart.
  check("a past estimate is NOT reported as thin history",
    got["estimate-in-past"].reason !== "thin-history");
}

console.log("\n9. AN OUTAGE IS NOT AN ABSENCE");
{
  const records = new Map([["NVDA", at(10)]]);
  withStore(records, ["AAPL", "MSFT"]);
  const healthy = await getSymbolOutlook("NVDA", TODAY);
  check("with the store healthy, a real record answers", healthy.kind === "expected", healthy.kind);

  // THE ONE THAT MATTERS: the record is still in the map. Only the health
  // probe fails. readReportDates cannot distinguish a miss from a failed GET,
  // so without the probe this renders "we have no filing record for NVDA"
  // during an outage.
  withStore(records, null);
  const down = await getSymbolOutlook("NVDA", TODAY);
  check("with the universe unreadable, the SAME record answers 'unavailable'",
    down.kind === "unavailable", down.kind);
  check("...and says it is a gap on our side", /gap on our side/.test(down.headline));
  check("...which is NOT the same sentence as 'no record for this company'",
    down.headline !== outlookFrom("NVDA", null, TODAY).headline);

  withStore(new Map(), ["AAPL"]);
  const missing = await getSymbolOutlook("NVDA", TODAY);
  check("a healthy store with no record for the symbol says no-record",
    missing.kind === "no-estimate" && missing.reason === "no-record");
}

console.log("\n10. THE SEARCH COMPONENT IS WIRED TO THIS AND NOT TO FMP");
{
  const src = readCodeOnly("app/earnings-calendar/EarningsTickerSearch.tsx");
  check("it fetches the outlook route", src.includes("/api/earnings-outlook/"));
  check("...and no longer fetches the FMP-backed earnings route",
    !src.includes("/api/stock-earnings/"));
  check("nextEarningsDate is gone from the component entirely",
    !src.includes("nextEarningsDate"));
  check("'next reports on' is gone", !/next reports on/.test(src));
  // A DATE FORMATTER IN THIS FILE IS THE REGRESSION. The band arrives as a
  // finished sentence; anything here that can turn a value into a day is the
  // first half of putting the old claim back.
  check("no date formatter survives in the component",
    !/toLocaleDateString|formatDate/.test(src));
  check("the headline, the hedge and the evidence are all rendered",
    src.includes("info.headline") && src.includes("info.hedge") && src.includes("info.evidence"));
  check("the loading line promises no date", !/next earnings date/i.test(src));
  // COUNTED, NOT PRESENT. There are TWO ways the lookup fails to produce an
  // answer -- a thrown fetch and a body without a headline -- and asserting
  // presence let a mutant that emptied one of them pass on the strength of the
  // other. Same failure source-code.mjs records for marker counts.
  const fallbacks = src.split("unreachable(result.symbol)").length - 1;
  check("BOTH failure paths still say something, rather than rendering empty",
    fallbacks === 2, `${fallbacks} of 2`);
}

console.log("\n11. THE ROUTE KEEPS THE DISTINCTION ITS SIBLING CANNOT");
{
  const src = readCodeOnly("app/api/earnings-outlook/[symbol]/route.ts");
  check("it calls the producer", src.includes("getSymbolOutlook"));
  check("an unreadable record leaves as 503, not a 200 that reads as empty",
    src.includes('outlook.kind === "unavailable" ? 503 : 200'));
  check("the bot guard is in place, as on its siblings", src.includes("isUnwantedBot"));
  check("today is UTC, the boundary every stored date is measured against",
    src.includes('new Date().toISOString().slice(0, 10)'));
  check("and no cache header was added along with the 503",
    !/revalidate|s-maxage|Cache-Control/.test(src));
}

g.cleanup();
console.log(failures ? `\n${failures} CHECK(S) FAILED\n` : "\nALL CHECKS PASSED\n");
process.exit(failures ? 1 : 0);
