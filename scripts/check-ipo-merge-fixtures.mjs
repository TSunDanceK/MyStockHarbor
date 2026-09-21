// Behavioural fixtures for the ingest merge and prune. NO NETWORK, NO REDIS.
//
// These are the rules whose failure is invisible. An append-only window does not
// degrade -- it works every day until the value exceeds Upstash's size ceiling
// and the write fails outright, on whatever commit happens to be deploying that
// week. A null SIC overwriting a known one silently disables the entity filter
// for that filer. Neither shows up on the page until it is a problem.
//
//   node --experimental-strip-types --import ./scripts/lib/register-ts.mjs \
//        scripts/check-ipo-merge-fixtures.mjs
import {
  mergeIpoRecords,
  resolveWatermark,
  validateStored,
  windowStartFor,
  MAX_STORED_RECORDS,
} from "../lib/server/ipoRecordMerge.ts";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const NOW = new Date("2026-09-15T00:00:00Z");
const d = (n) => new Date(NOW.getTime() + n * 86400000).toISOString().slice(0, 10);
const START = windowStartFor(NOW);

const rec = (over = {}) => ({
  cik: "1000001",
  company: "Fixture Co",
  sic: "7372",
  filings: [{ form: "S-1/A", date: d(-5) }],
  terms: { priceRangeLow: 14, priceRangeHigh: 16, sharesOffered: 1000, exchange: "Nasdaq", proposedSymbol: "FIX" },
  ...over,
});

console.log("\nipoRecordMerge — merge, prune, and the rules that fail silently\n");

// ── The prune. Constraint 2: part of the write, not a later cleanup. ──────
{
  const old = rec({ filings: [{ form: "S-1", date: d(-200) }] });
  const doc = mergeIpoRecords([old], [], START, NOW.getTime());
  check(
    "a filer whose every filing is outside the window is DROPPED ENTIRELY",
    doc.records.length === 0,
    "keeping an empty shell grows the document forever while rendering nothing — " +
      "append-only wearing a different hat"
  );
}
{
  const mixed = rec({
    filings: [
      { form: "S-1", date: d(-200) },
      { form: "S-1/A", date: d(-5) },
    ],
  });
  const doc = mergeIpoRecords([mixed], [], START, NOW.getTime());
  check(
    "filings older than windowStart are pruned, the filer is kept",
    doc.records.length === 1 && doc.records[0].filings.length === 1 && doc.records[0].filings[0].date === d(-5)
  );
}
{
  // The window must not grow across repeated runs. This is the append-only bug.
  let carried = [rec({ filings: [{ form: "S-1/A", date: d(-89) }] })];
  for (let day = 0; day < 10; day++) {
    const at = new Date(NOW.getTime() + day * 86400000);
    carried = mergeIpoRecords(carried, [], windowStartFor(at), at.getTime()).records;
  }
  check(
    "a record ages OUT of the window as the window moves",
    carried.length === 0,
    "10 days of merging with no new input must retire a filing that started 89 days old"
  );
}

// ── The merge. Constraint 3: seed and daily produce the same shape. ───────
{
  const existing = [rec({ filings: [{ form: "S-1", date: d(-20) }] })];
  const incoming = [rec({ filings: [{ form: "S-1/A", date: d(-2) }] })];
  const doc = mergeIpoRecords(existing, incoming, START, NOW.getTime());
  check(
    "filings union rather than replace",
    doc.records.length === 1 && doc.records[0].filings.length === 2,
    `got ${doc.records[0]?.filings.length} — a daily run carrying only today's filings must not erase the window`
  );
}
{
  const dupA = rec({ filings: [{ form: "S-1/A", date: d(-5) }] });
  const dupB = rec({ filings: [{ form: "S-1/A", date: d(-5) }] });
  const doc = mergeIpoRecords([dupA], [dupB], START, NOW.getTime());
  check(
    "the same filing seen twice is stored once",
    doc.records[0].filings.length === 1,
    "re-running the seed must be idempotent, not additive"
  );
}
{
  // A failed submissions read returns null. It must never overwrite a known SIC:
  // that would silently disable the entity filter for that filer, and the filter
  // is the one that keeps ETFs out of Upcoming IPOs.
  const known = rec({ sic: "6199" });
  const unknown = rec({ sic: null });
  check(
    "a null SIC does NOT overwrite a known one",
    mergeIpoRecords([known], [unknown], START, NOW.getTime()).records[0].sic === "6199",
    "a failed submissions read would otherwise disable the entity filter for that filer"
  );
  check(
    "a known SIC DOES fill in a previously null one",
    mergeIpoRecords([unknown], [known], START, NOW.getTime()).records[0].sic === "6199"
  );
}
{
  const withTerms = rec();
  const withoutTerms = rec({ terms: null });
  check(
    "null terms do NOT erase terms an earlier run parsed",
    mergeIpoRecords([withTerms], [withoutTerms], START, NOW.getTime()).records[0].terms !== null,
    "the cover parser is a heuristic; a run that could not parse must not delete a run that could"
  );
}
{
  const short = rec({ company: "ACME" });
  const long = rec({ company: "ACME Robotics Holdings Inc." });
  check(
    "the longer company name wins",
    mergeIpoRecords([short], [long], START, NOW.getTime()).records[0].company === "ACME Robotics Holdings Inc.",
    "EDGAR's index truncates some names; the longer spelling is the one a reader recognises"
  );
}

// ── The validator, which runs BEFORE the SET ─────────────────────────────
{
  const many = Array.from({ length: MAX_STORED_RECORDS + 1 }, (_, i) =>
    rec({ cik: String(2000000 + i) })
  );
  const doc = mergeIpoRecords(many, [], START, NOW.getTime());
  const v = validateStored(doc);
  check(
    "a document over the record ceiling is REFUSED before it is written",
    !v.ok && /ceiling/.test(v.reason ?? ""),
    "catching this after the SET means the stored value is already the problem"
  );
}
{
  const doc = mergeIpoRecords([rec()], [], START, NOW.getTime());
  check("a healthy document validates", validateStored(doc).ok);
  check(
    "the validator catches a filing older than windowStart",
    !validateStored({ ...doc, records: [{ ...doc.records[0], filings: [{ form: "S-1", date: d(-300) }] }] }).ok,
    "an independent check on the prune, not a restatement of it"
  );
}

// ── The watermark. Neither failure here raises anything. ─────────────────
{
  check(
    "a later date advances the watermark",
    resolveWatermark("20260910", "20260919") === "20260919"
  );
  check(
    "an EARLIER date does NOT rewind it",
    resolveWatermark("20260919", "20260910") === "20260919",
    "the refresh accepts a `from` override so the cold start can be driven by hand; " +
      "a replay that rewound the watermark would send the next scheduled run back " +
      "over days already covered, re-fetching every index and cover for nothing — " +
      "the defect sec-daily-index had to correct after a from/to run moved its own " +
      "watermark 20260912 -> 20260911"
  );
  check(
    "null incoming KEEPS the stored watermark",
    resolveWatermark("20260919", null) === "20260919",
    "incoming is null when every date in a run failed; storing that reads as " +
      "'never walked' on the next run, which is a 90-day cold start triggered by " +
      "one bad morning"
  );
  check(
    "undefined incoming keeps it too",
    resolveWatermark("20260919", undefined) === "20260919",
    "the caller may omit the field entirely — same meaning, and a check that only " +
      "covered null would miss it"
  );
  check(
    "a cold start takes the first date it walks",
    resolveWatermark(null, "20260919") === "20260919"
  );
  check(
    "and a cold start that walked nothing stays cold",
    resolveWatermark(null, null) === null,
    "null is 'never walked', which is a real state and not an error"
  );
}

// ── Determinism: the same inputs must give the same document ─────────────
{
  const a = mergeIpoRecords([rec({ cik: "3" }), rec({ cik: "1" })], [rec({ cik: "2" })], START, 1);
  const b = mergeIpoRecords([rec({ cik: "1" }), rec({ cik: "3" })], [rec({ cik: "2" })], START, 1);
  check(
    "output is ordered deterministically regardless of input order",
    JSON.stringify(a) === JSON.stringify(b),
    "two writers producing different byte orders would look like a change every day"
  );
}

console.log(
  failures === 0
    ? "\nMerge, prune and validation all hold.\n"
    : `\n${failures} fixture(s) FAILED.\n`
);
process.exit(failures === 0 ? 0 : 1);
