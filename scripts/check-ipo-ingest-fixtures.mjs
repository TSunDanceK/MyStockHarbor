// Behavioural fixtures for the daily IPO ingest. NO NETWORK, NO REDIS.
//
// WHY THESE AND NOT MORE SOURCE-REGEX CHECKS. check-ipo-exclusions.mjs asserts
// the rules are WRITTEN; check-ipo-split-fixtures.mjs asserts they FIRE. This
// file is about the layer underneath both: what ends up in a record at all.
// Every mistake available here produces a plausible number and an emptier page,
// which is the shape claude/traps/a-filter-that-matches-nothing-looks-
// correct.md is named after.
//
// The four that would ship silently:
//
//   1. An EFFECT notice read as a 424B4. Wellchange Holdings has no 424B4 on
//      its record; accession 9999999995-26-002778 is EDGAR's own notice that a
//      registration went effective. The first seed run counted it as a final
//      prospectus twice over, and every count stayed reasonable.
//
//   2. A filer's history taken from the accumulated days rather than its own
//      submissions. A company filing a 424B4 today, whose 8-A12B was filed
//      three weeks ago on a day nobody was watching that CIK, reads as "no
//      8-A12B in window" -- a REAL IPO dropped as a follow-on, landing in the
//      same funnel bucket as the genuine ones.
//
//   3. CIK padding. The daily index pads nothing, submissions.json pads to ten.
//      A record keyed on one spelling and merged against the other grows a
//      duplicate filer per day while every table stays believable.
//
//   4. Terms taken from the wrong filing. submissions.recent is newest-first,
//      so an index-order scan that keeps the LAST match keeps the OLDEST one --
//      last month's price range rather than this week's.
//
//   node scripts/check-ipo-ingest-fixtures.mjs
import "./lib/register-ts-here.mjs";

const {
  EDGAR_GENERATED_ACCESSION,
  IPO_OFFERING_FORMS,
  IPO_PERIODIC_FORMS,
  filerFromSubmissions,
  pickCoverDocument,
  touchedFilersIn,
} = await import("../lib/server/ipoIngest.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const WINDOW_START = "2026-06-17";

/** An index row as parseDailyIndex() produces one. */
const row = (over = {}) => ({
  cik: "2089447",
  company: "FIXTURE HOLDINGS INC",
  form: "424B4",
  filed: "20260915",
  file: "edgar/data/2089447/0002089447-26-000012.txt",
  accession: "0002089447-26-000012",
  ...over,
});

console.log("\nipoIngest — what gets into a record, and what must not\n");

// ── 1. EDGAR-generated notices ───────────────────────────────────────────
{
  const rows = [
    row(),
    row({ cik: "2091521", company: "WELLCHANGE HOLDINGS", accession: "9999999995-26-002778" }),
  ];
  const { filers, noticesSkipped } = touchedFilersIn(rows);
  check(
    "an EDGAR-generated accession is NOT read as a company filing",
    !filers.has("2091521") && noticesSkipped === 1,
    "9999999995-* is an EFFECT notice; Wellchange has no 424B4 on its record, " +
      "and the count of these is reported per run so a category that should be " +
      "small being large is visible rather than plausible"
  );
  check(
    "and the real filing beside it is still kept",
    filers.has("2089447"),
    "a notice filter that also ate real rows would be the mirror failure"
  );
}
{
  // NEGATIVE CONTROL. A filter that matches everything looks identical to one
  // that matches the right thing, from the count alone.
  const { filers, noticesSkipped } = touchedFilersIn([row(), row({ cik: "1000001" })]);
  check(
    "nothing is skipped when no notice is present",
    noticesSkipped === 0 && filers.size === 2,
    "the exclusion must be about the accession prefix, not about being strict"
  );
}
{
  const { filers } = touchedFilersIn([
    row({ form: "10-Q" }),
    row({ cik: "1000002", form: "8-K" }),
    row({ cik: "1000003", form: "S-1/A" }),
  ]);
  check(
    "only offering forms make a filer interesting",
    filers.size === 1 && filers.has("1000003"),
    "a 10-Q or an 8-K from a company with no offering is not this page's business; " +
      "collecting them market-wide would mean a record per public company in America"
  );
}
{
  const { filers } = touchedFilersIn([
    row({ cik: "0002089447", form: "8-A12B", company: "FIXTURE HOLDINGS" }),
    row({ cik: "2089447", form: "424B4", company: "FIXTURE HOLDINGS INC" }),
  ]);
  check(
    "a padded and an unpadded CIK are ONE filer",
    filers.size === 1 && filers.get("2089447")?.forms.length === 2,
    "the daily index pads nothing and submissions.json pads to ten — two entries " +
      "here means a duplicate filer per day, with every table still believable"
  );
  check(
    "and the longer company name is the one carried",
    filers.get("2089447")?.company === "FIXTURE HOLDINGS INC",
    "EDGAR truncates some names; mergeIpoRecords prefers the longer spelling, " +
      "which it can only do if both reach it"
  );
}
{
  check(
    "the two form sets are disjoint",
    ![...IPO_OFFERING_FORMS].some((f) => IPO_PERIODIC_FORMS.has(f)),
    "a form in both would be collected twice and counted once, or vice versa, " +
      "depending on which test ran first"
  );
  check(
    "8-A12B is in the offering set",
    IPO_OFFERING_FORMS.has("8-A12B"),
    "it is the LISTING event and the whole basis of the follow-on test — dropping " +
      "it as 'not an offering form' would read every real IPO as a follow-on"
  );
  check(
    "RW and AW are in the offering set",
    IPO_OFFERING_FORMS.has("RW") && IPO_OFFERING_FORMS.has("AW"),
    "a withdrawal that is never collected is a withdrawal that never fires"
  );
}

// ── 2. A filer's history comes from its OWN submissions ──────────────────
console.log("");
const submissions = (over = {}) => ({
  name: "Fixture Holdings Incorporated",
  sic: "7372",
  filings: {
    recent: {
      // NEWEST FIRST, exactly as SEC serves it. The last entry is deliberately
      // OUTSIDE the window, so the prune has something real to remove rather
      // than passing on an input that could never have failed it.
      form: ["424B4", "S-1/A", "8-A12B", "10-Q", "S-1", "10-K"],
      filingDate: [
        "2026-09-15",
        "2026-09-08",
        "2026-08-25",
        "2026-07-20",
        "2026-07-02",
        "2026-05-01",
      ],
      accessionNumber: [
        "0002089447-26-000012",
        "0002089447-26-000011",
        "0002089447-26-000009",
        "0002089447-26-000006",
        "0002089447-26-000004",
        "0002089447-26-000001",
      ],
    },
  },
  ...over,
});

{
  const touched = { cik: "2089447", company: "FIXTURE HOLDINGS INC", forms: ["424B4"] };
  const built = filerFromSubmissions(touched, submissions(), WINDOW_START);
  const forms = built.record.filings.map((f) => f.form);
  check(
    "the 8-A12B filed three weeks BEFORE the day walked is on the record",
    forms.includes("8-A12B"),
    "this is the whole reason the history comes from submissions rather than from " +
      "accumulated days: on the day that 8-A12B was filed nothing was watching this " +
      "CIK, so a day-at-a-time build never sees it and drops a real IPO as a follow-on"
  );
  check(
    "so is the S-1 from July, and the 10-Q",
    forms.includes("S-1") && forms.includes("10-Q"),
    "the periodic report is the free second discriminator and arrives in the same read"
  );
  check(
    "the 10-K from BEFORE windowStart is pruned",
    !forms.includes("10-K") && !built.record.filings.some((f) => f.date < WINDOW_START),
    "windowStart is the prune boundary and validateStored refuses a document that " +
      "carries anything older — and this filer HAS one outside the window, so the " +
      "assertion is not passing on an input that could never fail it"
  );
  check(
    "SIC is carried through",
    built.record.sic === "7372",
    "a null SIC silently disables the entity filter for that filer"
  );
  check(
    "the longer of the two company names wins",
    built.record.company === "Fixture Holdings Incorporated"
  );
  check(
    "terms are left null for the caller to fill",
    built.record.terms === null,
    "a record is not the place a cover gets parsed; mergeIpoRecords treats null as " +
      "'not known this run', never as a deletion"
  );
}
{
  const touched = { cik: "2089447", company: "FIXTURE HOLDINGS INC", forms: ["424B4"] };
  const built = filerFromSubmissions(touched, submissions(), WINDOW_START);
  check(
    "the NEWEST terms-bearing filing is the one chosen",
    built.termsFiling?.date === "2026-09-15" && built.termsFiling?.form === "424B4",
    `got ${built.termsFiling?.form}@${built.termsFiling?.date} — submissions.recent is ` +
      `newest-first, so keeping the last match keeps the OLDEST one and the page ` +
      `shows last month's price range for this week's deal`
  );
}
{
  // 8-A12B, RW and AW carry no price. Fetching their covers is pure spend.
  const noTerms = submissions({
    filings: {
      recent: {
        form: ["8-A12B", "RW"],
        filingDate: ["2026-09-10", "2026-09-01"],
        accessionNumber: ["0002089447-26-000020", "0002089447-26-000019"],
      },
    },
  });
  const built = filerFromSubmissions(
    { cik: "2089447", company: "X", forms: ["8-A12B"] },
    noTerms,
    WINDOW_START
  );
  check(
    "a filer with no terms-bearing filing asks for no cover",
    built.termsFiling === null,
    "8-A12B, RW and AW decide membership and carry no price — a cover fetch for " +
      "one is two wasted requests against a paced budget"
  );
  check(
    "but it still gets a record",
    built.record.filings.length === 2,
    "the 8-A12B is what the follow-on test reads; a filer dropped for having no " +
      "terms would take its own listing evidence with it"
  );
}
{
  const withNotice = submissions({
    filings: {
      recent: {
        form: ["424B4", "424B4"],
        filingDate: ["2026-09-16", "2026-09-15"],
        accessionNumber: ["9999999995-26-002778", "0002089447-26-000012"],
      },
    },
  });
  const built = filerFromSubmissions(
    { cik: "2089447", company: "X", forms: ["424B4"] },
    withNotice,
    WINDOW_START
  );
  check(
    "the notice filter applies to submissions.json too, not just the daily index",
    built.record.filings.length === 1 && built.termsFiling?.date === "2026-09-15",
    "the same EFFECT notice appears in both sources; excluding it in one place only " +
      "means the rule holds until the other source is the one that saw it first"
  );
}
{
  // TRUNCATION NEEDS TWO THINGS, and the first live run is why. The flag
  // originally tested only "the oldest filing in recent is inside the window"
  // and fired for 15 of 198 filers on relay run 35580719192 — every one a CIK
  // in the 21xxxxx range, i.e. a registrant created this year whose whole
  // history begins inside a 90-day window because it did not exist before it.
  // Nothing was cut off. SEC's `filings.files` overflow pages are what tell the
  // two apart, so both fixtures below are the same `recent` with and without
  // them.
  const shortRecent = {
    recent: {
      form: ["424B4"],
      filingDate: ["2026-09-15"],
      accessionNumber: ["0002089447-26-000012"],
    },
  };
  const cutOff = filerFromSubmissions(
    { cik: "1", company: "X", forms: ["424B4"] },
    submissions({ filings: { ...shortRecent, files: [{ name: "CIK0000000001-submissions-001.json" }] } }),
    WINDOW_START
  );
  check(
    "a history cut off inside the window, WITH overflow pages, is FLAGGED",
    cutOff.historyTruncated === true,
    "an 8-A12B just outside a truncation reads as a follow-on and deletes a real " +
      "IPO from the page with no symptom"
  );
  const youngFiler = filerFromSubmissions(
    { cik: "1", company: "X", forms: ["424B4"] },
    submissions({ filings: { ...shortRecent, files: [] } }),
    WINDOW_START
  );
  check(
    "the SAME short history with NO overflow pages is NOT flagged",
    youngFiler.historyTruncated === false,
    "a company incorporated this year has no older filings to be cut off from — " +
      "flagging it fired on 8% of a healthy live run, and an alarm that cries " +
      "wolf is worse than no alarm"
  );
  const full = filerFromSubmissions(
    { cik: "1", company: "X", forms: ["424B4"] },
    submissions({ filings: { ...submissions().filings, files: [{ name: "more.json" }] } }),
    WINDOW_START
  );
  check(
    "and a history that DOES reach past windowStart is not flagged either",
    full.historyTruncated === false,
    "overflow pages alone mean nothing; it is only truncation when the window is " +
      "not covered"
  );
}
{
  const empty = filerFromSubmissions({ cik: "1", company: "X", forms: ["S-1"] }, {}, WINDOW_START);
  check(
    "an empty submissions payload yields an empty record rather than throwing",
    empty.record.filings.length === 0 && empty.record.sic === null,
    "the caller decides what a failed read means; a throw here would lose the " +
      "whole run's other filers"
  );
}

// ── 3. Which document is the prospectus ──────────────────────────────────
console.log("");
{
  const index = JSON.stringify({
    directory: {
      item: [
        { name: "R1.htm", size: "9000000" },
        { name: "ex-99.htm", size: "4000" },
        { name: "prospectus424b4.htm", size: "820000" },
        { name: "filing.txt", size: "999999999" },
      ],
    },
  });
  check(
    "the largest .htm that is not an R<n>.htm is the cover",
    pickCoverDocument(index) === "prospectus424b4.htm",
    "R<n>.htm are XBRL viewer fragments and are routinely the largest files in the " +
      "directory; .txt is the whole submission including every exhibit"
  );
  check(
    "a malformed index yields null, not a throw",
    pickCoverDocument("not json") === null,
    "one filer's odd directory must not end the run"
  );
  check(
    "a directory with no .htm yields null",
    pickCoverDocument(JSON.stringify({ directory: { item: [{ name: "a.txt", size: "1" }] } })) === null
  );
}

// ── 4. The accession pattern itself ──────────────────────────────────────
console.log("");
{
  check(
    "the notice pattern is anchored at the start",
    EDGAR_GENERATED_ACCESSION.test("9999999995-26-002778") &&
      !EDGAR_GENERATED_ACCESSION.test("0009999999995-26-000001"),
    "unanchored, it would match a real accession that merely contains the digits"
  );
}

console.log(
  failures === 0
    ? "\nEvery ingest rule fires, and every negative control is left alone.\n"
    : `\n${failures} fixture(s) FAILED.\n`
);
process.exit(failures === 0 ? 0 : 1);
