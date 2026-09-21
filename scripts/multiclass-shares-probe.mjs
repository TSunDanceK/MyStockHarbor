// Can a multi-class filer's shares actually be split BY CLASS from companyfacts?
//
// ── WHY THIS RUNS BEFORE THE GROUPING IS BUILT ────────────────────────────
// BUILD-BRIEF §5 prescribes: "group tickers by CIK and compute the sum of each
// class's shares times THAT CLASS'S OWN CLOSE, assigning the group total to
// every ticker in it."
//
// That requires knowing which share count belongs to which class. And
// lib/server/secFields.ts already records, from measurement, that it does not:
//
//   "companyfacts publishes the default-context series only, so a multi-class
//    filer's several rows arrive with the same end, the same accn and nothing
//    to tell them apart. There is no class label to read, so the extractor
//    refuses to pick."
//
// Those two cannot both be acted on. Either the brief's formula is not
// computable from this source, or the extractor's note is too pessimistic.
// Building the grouping on the wrong one of those produces a market cap that
// is plausible and wrong -- BRK.A and BRK.B differ by roughly 1,500x in price,
// so pairing the wrong count with the wrong close is not a rounding error.
//
// ── WHAT IS MEASURED ──────────────────────────────────────────────────────
// For each known multi-class filer, every dei:EntityCommonStockSharesOutstanding
// row on the newest accession, with its full context. Three questions:
//
//   1. HOW MANY rows per accession? One means either a single total or one
//      class silently standing in for all; several means per-class rows exist.
//   2. Do the rows carry ANYTHING distinguishing -- a segment, a member, a
//      label, anything beyond end/accn/val?
//   3. Does the SUM, or any single row, match the company's publicly known
//      total shares? That is the check on whether one row is already the total.
//
// Question 3 is the one that decides the build, and it is answered by
// arithmetic against a figure the probe does NOT supply -- printed for the
// owner to compare, not asserted here, because a "known total" hardcoded into
// a probe is a number reverse-engineered from the expected answer.
//
//   relay task: multiclass-shares   (read-only, uncredentialled, no dump)
import { emitPayload } from "./lib/relay-capture.mjs";

const UA =
  process.env.PROBE_USER_AGENT ??
  "MyStockHarbor/1.0 (+https://www.mystockharbor.com; provider evaluation)";

// Multi-class pairs with a shared CIK, from data/sec/company-tickers.json.
const GROUPS = [
  { cik: "0001652044", tickers: ["GOOGL", "GOOG"], name: "Alphabet" },
  { cik: "0001067983", tickers: ["BRK-A", "BRK-B"], name: "Berkshire Hathaway" },
  { cik: "0001308161", tickers: ["FOXA", "FOX"], name: "Fox" },
  { cik: "0001336917", tickers: ["UAA", "UA"], name: "Under Armour" },
  { cik: "0000320193", tickers: ["AAPL"], name: "Apple (single class, control)" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, body: await res.json() };
}

const results = [];

for (const g of GROUPS) {
  await sleep(300);
  const facts = await getJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${g.cik}.json`);
  if (!facts.ok) {
    results.push({ ...g, verdict: "UNRESOLVED", why: `companyfacts ${facts.status}` });
    continue;
  }
  const units = facts.body?.facts?.dei?.EntityCommonStockSharesOutstanding?.units;
  if (!units) {
    results.push({ ...g, verdict: "NO COVER TAG", note: "dei:EntityCommonStockSharesOutstanding absent entirely" });
    continue;
  }

  const rows = [];
  for (const [unit, list] of Object.entries(units)) {
    for (const r of list) rows.push({ unit, ...r });
  }
  // Newest accession only: an older filing's row count says nothing about how
  // the CURRENT one is shaped, and mixing accessions would invent a multi-row
  // appearance out of a single-row filer's history.
  rows.sort((a, b) => String(b.end).localeCompare(String(a.end)) || String(b.accn).localeCompare(String(a.accn)));
  const newestAccn = rows[0]?.accn;
  const onNewest = rows.filter((r) => r.accn === newestAccn);

  // EVERY KEY PRESENT, not a chosen subset. The question is whether ANYTHING
  // distinguishes the rows, so the probe must not pre-select the fields it
  // expects to find -- that is how "nothing distinguishes them" gets concluded
  // from a projection that dropped the distinguishing field.
  const keysSeen = [...new Set(onNewest.flatMap((r) => Object.keys(r)))].sort();
  const distinguishing = keysSeen.filter((k) => {
    const vals = new Set(onNewest.map((r) => JSON.stringify(r[k])));
    return vals.size > 1;
  });

  const vals = onNewest.map((r) => r.val).filter((v) => typeof v === "number");
  const sum = vals.reduce((a, b) => a + b, 0);

  results.push({
    ...g,
    accn: newestAccn,
    end: onNewest[0]?.end,
    rowsOnNewestAccession: onNewest.length,
    keysPresent: keysSeen,
    keysThatDiffer: distinguishing,
    values: vals,
    sum,
    verdict:
      onNewest.length === 1
        ? "ONE ROW — no per-class split available on this accession"
        : distinguishing.filter((k) => k !== "val").length > 0
          ? `SEVERAL ROWS, distinguishable by: ${distinguishing.filter((k) => k !== "val").join(", ")}`
          : "SEVERAL ROWS, DISTINGUISHABLE ONLY BY VALUE — no class label",
  });
}

console.log("\n=== MULTI-CLASS COVER SHARES ===");
for (const r of results) {
  console.log(`\n${r.name} (${r.tickers?.join("/")})`);
  console.log(`  ${r.verdict}`);
  if (r.values) console.log(`  values: ${r.values.join(", ")}   sum: ${r.sum}`);
  if (r.keysThatDiffer) console.log(`  keys that differ across rows: ${r.keysThatDiffer.join(", ") || "(none)"}`);
}
console.log(
  "\nTO DECIDE THE BUILD: compare each sum, and each single value, against the" +
  "\ncompany's publicly known total shares outstanding. If ONE ROW already equals" +
  "\nthe total, the brief's per-class formula is unnecessary. If several rows sum" +
  "\nto it but carry no class label, the formula is NOT COMPUTABLE from this source."
);

emitPayload("multiclass-shares", JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
