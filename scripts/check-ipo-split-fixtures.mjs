// Behavioural fixtures for buildSecIpoTables(). NO NETWORK.
//
// WHY THIS EXISTS RATHER THAN MORE SOURCE-REGEX CHECKS. check-ipo-exclusions.mjs
// asserts that the RULES ARE WRITTEN. It cannot assert that they FIRE. The
// difference stopped being academic when the seed's own funnel reported:
//
//     − withdrawn RW/AW after amendment     0
//
// That is plausible -- already-listed now runs first and eats most of the input
// -- and it is also exactly what a broken filter looks like. By the argument in
// claude/traps/a-filter-that-matches-nothing-looks-correct.md, a count of zero
// from live data is not evidence either way, and NOTHING in this repo proved the
// withdrawal filter could exclude anything at all.
//
// So: synthetic records, one per rule, each with its own negative control. A
// filter that cannot be shown to fire has not been tested; a filter that cannot
// be shown to LEAVE THINGS ALONE has not been tested either.
//
//   node --experimental-strip-types --import ./scripts/lib/register-ts.mjs \
//        scripts/check-ipo-split-fixtures.mjs
//   (Node >= 24 needs no --experimental-strip-types)
import { buildSecIpoTables } from "../lib/server/ipoSecSource.ts";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const NOW = new Date("2026-09-15T00:00:00Z");
const d = (offsetDays) =>
  new Date(NOW.getTime() + offsetDays * 86400000).toISOString().slice(0, 10);

const TERMS = {
  priceRangeLow: 14,
  priceRangeHigh: 16,
  sharesOffered: 10_000_000,
  exchange: "Nasdaq Global Market",
  proposedSymbol: "TEST",
};

/** A live upper-table candidate: terms set 5 days ago, nothing else. */
const base = (over = {}) => ({
  cik: "9000001",
  company: "Fixture Operating Co Inc.",
  sic: "7372",
  filings: [{ form: "S-1/A", date: d(-5) }],
  terms: { ...TERMS },
  ...over,
});

const EMPTY_MAP = new Map();
const run = (records, listed = EMPTY_MAP) => buildSecIpoTables(records, listed, 90, NOW);

console.log("\nbuildSecIpoTables — behavioural fixtures\n");

// ── The control that makes every other case meaningful ────────────────────
{
  const { upcoming } = run([base()]);
  check(
    "CONTROL: a clean candidate IS included",
    upcoming.length === 1 && upcoming[0].company === "Fixture Operating Co Inc.",
    `${upcoming.length} row(s) — if this fails, every exclusion below passes for the wrong reason`
  );
}

// ── RW / AW. THE ONE THE LIVE FUNNEL COULD NOT PROVE. ─────────────────────
{
  const withdrawnAfter = base({
    filings: [{ form: "S-1/A", date: d(-20) }, { form: "RW", date: d(-3) }],
  });
  const { upcoming, funnel } = run([withdrawnAfter]);
  check(
    "RW dated AFTER the amendment EXCLUDES the row",
    upcoming.length === 0 && funnel.droppedWithdrawn === 1,
    `rows=${upcoming.length} droppedWithdrawn=${funnel.droppedWithdrawn} — the live seed reported 0 and could not show this fires`
  );
}
{
  const awAfter = base({
    filings: [{ form: "S-1/A", date: d(-20) }, { form: "AW", date: d(-19) }],
  });
  const { upcoming } = run([awAfter]);
  check("AW is treated as a withdrawal too, not just RW", upcoming.length === 0);
}
{
  // THE NEGATIVE CONTROL, and it is a real measured case: Kepler amended
  // 2026-08-24 carrying an RW of 2026-05-19, Akari amended 2026-06-26 with an RW
  // of 2026-05-21. Those withdraw an EARLIER registration; the live deal stands.
  const withdrawnBefore = base({
    filings: [{ form: "RW", date: d(-40) }, { form: "S-1/A", date: d(-5) }],
  });
  const { upcoming, funnel } = run([withdrawnBefore]);
  check(
    "RW dated BEFORE the amendment does NOT exclude it",
    upcoming.length === 1 && funnel.droppedWithdrawn === 0,
    "a withdrawal only withdraws what came before it — 'has a withdrawal anywhere' deletes live deals"
  );
}
{
  // Same day. An RW filed the same day as the amendment is a withdrawal of it.
  const sameDay = base({
    filings: [{ form: "S-1/A", date: d(-5) }, { form: "RW", date: d(-5) }],
  });
  check("RW on the SAME DAY as the amendment excludes it", run([sameDay]).upcoming.length === 0);
}

// ── The staleness cap ─────────────────────────────────────────────────────
{
  const stale = base({ filings: [{ form: "S-1/A", date: d(-46) }] });
  const fresh = base({ filings: [{ form: "S-1/A", date: d(-45) }] });
  check("terms older than the 45-day cap are excluded", run([stale]).upcoming.length === 0);
  check("terms exactly AT the cap are kept (the boundary is inclusive)", run([fresh]).upcoming.length === 1);
}

// ── Already listed (classes a and c) ──────────────────────────────────────
{
  const listed = new Map([["9000001", { symbol: "OLD", exchange: "Nasdaq" }]]);
  const { upcoming, funnel } = run([base()], listed);
  check(
    "a filer present in the ticker map is excluded from the UPPER table",
    upcoming.length === 0 && funnel.droppedAlreadyListed === 1,
    "removes 141 of 187 on live data — the single largest class"
  );
}
{
  // The wrong-direction join would look up a CIK in a symbol-keyed map and always
  // miss. This fixture fails if anyone reintroduces that.
  const symbolKeyedByMistake = new Map([["OLD", { symbol: "OLD", exchange: "Nasdaq" }]]);
  check(
    "a map keyed the WRONG way does not accidentally exclude",
    run([base()], symbolKeyedByMistake).upcoming.length === 1,
    "documents the failure mode rather than hiding it: nothing matches, everything survives"
  );
}

// ── The entity filter (class b) ───────────────────────────────────────────
{
  const etf = base({ cik: "9000002", company: "Bitwise NEAR ETF", sic: "6199" });
  check("SIC 6199 + a fund name is excluded", run([etf]).upcoming.length === 0);
}
{
  const fintech = base({ cik: "9000003", company: "Acme Payments Inc.", sic: "6199" });
  check(
    "SIC 6199 + an ORDINARY name is KEPT",
    run([fintech]).upcoming.length === 1,
    "a blanket 6199 exclusion would delete legitimate fintech IPOs"
  );
}
{
  const reit = base({ cik: "9000004", company: "Pinecrest Realty Trust", sic: "6798" });
  check(
    "a REIT named '... Trust' is KEPT",
    run([reit]).upcoming.length === 1,
    "a name-only rule would delete it; the conjunction saves it from the other side"
  );
}
{
  // THE RULE THAT MUST NOT BE BROKEN. A SPAC IPO is a real IPO.
  const spac = base({ cik: "9000005", company: "Dune Acquisition Corp III", sic: "6770" });
  check(
    "a SPAC (SIC 6770) is KEPT even with 'Acquisition' in the name",
    run([spac]).upcoming.length === 1,
    "7 of 53 genuine upcoming IPOs in the measured window are blank checks"
  );
}

// ── The lower table's follow-on test ──────────────────────────────────────
{
  const followOn = {
    cik: "9000006",
    company: "Seasoned Issuer Inc.",
    sic: "2836",
    filings: [{ form: "424B4", date: d(-10) }],
    terms: { ...TERMS },
  };
  const { recent, funnel } = run([followOn]);
  check(
    "a 424B with NO 8-A12B is excluded from the LOWER table",
    recent.length === 0 && funnel.droppedFollowOn === 1 && funnel.followOnNoExchangeOnly === 1,
    "Aveanna, ABVC, Laser Photonics and Aptevo all rendered as 'Recent IPOs' before this"
  );
}
{
  const realIpo = {
    cik: "9000007",
    company: "Genuine Listing Corp",
    sic: "2836",
    filings: [{ form: "8-A12B", date: d(-11) }, { form: "424B4", date: d(-10) }],
    terms: { ...TERMS },
  };
  const { recent } = run([realIpo]);
  check(
    "a 424B WITH an 8-A12B is included",
    recent.length === 1,
    "the pair is the listing event; neither half alone identifies an IPO"
  );
}
{
  const old = {
    cik: "9000008",
    company: "Listed Five Weeks Ago Corp",
    sic: "2836",
    filings: [{ form: "8-A12B", date: d(-36) }, { form: "424B4", date: d(-35) }],
    terms: { ...TERMS },
  };
  check("a 424B older than 30 days is outside the recent window", run([old]).recent.length === 0);
}

// ── The periodic-report cross-check ───────────────────────────────────────
{
  // Alliance Laundry's shape: IPO'd Oct 2025, so by Aug 2026 it has a 10-K and
  // 10-Qs. Its 8-A12B sits 10 months back and is INVISIBLE to a 90-day window --
  // which is exactly why the 8-A12B test alone could not catch it.
  const seasoned = {
    cik: "9000009",
    company: "Alliance Laundry Shape Inc.",
    sic: "3580",
    filings: [
      { form: "10-K", date: d(-70) },
      { form: "10-Q", date: d(-40) },
      { form: "S-1", date: d(-12) },
      { form: "424B4", date: d(-10) },
    ],
    terms: { ...TERMS },
  };
  const { recent, funnel } = run([seasoned]);
  check(
    "prior 10-K/10-Q marks the offering a follow-on, and BOTH tests agree",
    recent.length === 0 && funnel.followOnBothAgree === 1,
    "Alliance Laundry: its 8-A12B is 10 months before the window, so the 8-A test " +
      "fires too — the periodic report is what makes the verdict independent of it"
  );
}
{
  // Wellchange's shape: a foreign private issuer. The 6-K is conclusive on its
  // own -- only an issuer already registered under the Exchange Act files one.
  const fpi = {
    cik: "9000010",
    company: "Wellchange Shape Ltd",
    sic: "7372",
    filings: [
      { form: "20-F", date: d(-60) },
      { form: "6-K", date: d(-25) },
      { form: "F-1", date: d(-20) },
      { form: "424B4", date: d(-10) },
    ],
    terms: { ...TERMS },
  };
  check("a prior 6-K marks a foreign issuer's offering a follow-on", run([fpi]).recent.length === 0);
}
{
  // A periodic report AFTER the 424B does not make it a follow-on -- a brand-new
  // issuer files its first 10-Q soon after listing.
  const newIssuer = {
    cik: "9000011",
    company: "Just Listed Corp",
    sic: "2836",
    filings: [
      { form: "8-A12B", date: d(-12) },
      { form: "424B4", date: d(-10) },
      { form: "10-Q", date: d(-2) },
    ],
    terms: { ...TERMS },
  };
  check(
    "a periodic report AFTER the 424B does NOT mark it a follow-on",
    run([newIssuer]).recent.length === 1,
    "the comparison is strictly before the prospectus date"
  );
}
{
  // The disagreement case, surfaced rather than resolved away.
  const disagrees = {
    cik: "9000012",
    company: "Both Signals Corp",
    sic: "2836",
    filings: [
      { form: "8-A12B", date: d(-50) },
      { form: "10-Q", date: d(-20) },
      { form: "424B4", date: d(-10) },
    ],
    terms: { ...TERMS },
  };
  const { recent, funnel } = run([disagrees]);
  check(
    "8-A12B in window BUT prior periodic reports is flagged separately",
    funnel.followOnPriorReportingOnly === 1 && recent.length === 0,
    "a reporting company registering a class — surfaced, not averaged away"
  );
}

// ── Sort order: both descending, for different reasons ────────────────────
{
  const rows = [
    base({ cik: "1", company: "Oldest", filings: [{ form: "S-1/A", date: d(-30) }] }),
    base({ cik: "2", company: "Newest", filings: [{ form: "S-1/A", date: d(-2) }] }),
    base({ cik: "3", company: "Middle", filings: [{ form: "S-1/A", date: d(-15) }] }),
  ];
  const { upcoming } = run(rows);
  check(
    "UPPER is sorted most-recently-amended FIRST",
    upcoming.map((r) => r.company).join(",") === "Newest,Middle,Oldest",
    `got ${upcoming.map((r) => r.company).join(",")} — ascending would put the stalest filing at the top`
  );
}

// ── Identity ──────────────────────────────────────────────────────────────
{
  const noTicker = base({ terms: { ...TERMS, proposedSymbol: null } });
  const { upcoming } = run([noTicker]);
  check(
    "a row with no proposed ticker still has an identity",
    upcoming.length === 1 && upcoming[0].symbol === null && upcoming[0].cik === "9000001",
    "identity is the CIK; the upper table's rows frequently have no ticker (11 of 20 live)"
  );
}

console.log(
  failures === 0
    ? "\nEvery rule fires, and every rule leaves the control alone.\n"
    : `\n${failures} fixture(s) FAILED.\n`
);
process.exit(failures === 0 ? 0 : 1);
