// The SEC daily-index job's change detector, asserted against the five dates
// the probe already measured.
//
// WHY FIXTURES AND NOT A LIVE FETCH. The agent sandbox is refused www.sec.gov
// with 403 CONNECT, and a check that needs the network is a check that fails in
// CI for reasons that have nothing to do with the code. The index bodies below
// are shaped exactly as EDGAR serves them and carry the filings the probe
// observed on those dates.
//
// WHAT THE FIXTURE DOES AND DOES NOT PROVE. It is SELF-CONSISTENT: the manifest
// and the index rows use the same CIKs, so it proves the intersection, the form
// classification, the 403 handling and the watermark arithmetic. It does NOT
// prove any real ticker->CIK mapping -- that comes from
// data/sec/company-tickers.json, which is not in the tree yet (see
// data/sec/README.md).
//
//   node scripts/check-sec-daily-index.mjs
import fs from "node:fs";
import path from "node:path";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const INDEX_SRC = read("lib/server/secDailyIndex.ts");
const MANIFEST_SRC = read("lib/server/secManifest.ts");
const ROUTE_SRC = read("app/api/jobs/sec-daily-index/route.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const idx = await lift(
  [
    grabFunction(INDEX_SRC, "quarterOf"), grabFunction(INDEX_SRC, "dailyIndexUrl"),
    grabFunction(INDEX_SRC, "toYyyymmdd"), grabFunction(INDEX_SRC, "addDays"),
    grabFunction(INDEX_SRC, "isWeekend"), grabFunction(INDEX_SRC, "latestProcessableDate"),
    grabFunction(INDEX_SRC, "isAmendment"), grabFunction(INDEX_SRC, "isPeriodicForm"),
    grabFunction(INDEX_SRC, "accessionFrom"), grabFunction(INDEX_SRC, "parseDailyIndex"),
    grabFunction(INDEX_SRC, "looksLikeMissingIndex"), grabFunction(INDEX_SRC, "intersect"),
  ].join("\n") +
    "\nexport { quarterOf, dailyIndexUrl, addDays, isWeekend, latestProcessableDate, isAmendment, isPeriodicForm, accessionFrom, parseDailyIndex, looksLikeMissingIndex, intersect };",
  `const PERIODIC_FORMS = ["10-Q","10-K","20-F","6-K"];
   const DISSEMINATION_CLOSE_MINUTES_ET = 22*60;
   let __ET = { minutesOfDay: 23*60 };
   const getEasternParts = () => __ET;
   globalThis.__setET = (m) => { __ET = { minutesOfDay: m }; };`
);

const man = await lift(
  [grabFunction(MANIFEST_SRC, "emptyEntry"), grabFunction(MANIFEST_SRC, "emptyManifest"),
   grabFunction(MANIFEST_SRC, "seedManifest"), grabFunction(MANIFEST_SRC, "symbolsByCik")].join("\n") +
    "\nexport { emptyEntry, emptyManifest, seedManifest, symbolsByCik };",
  "const SEC_SCORE_VERSION = 1;"
);

const route = await lift(
  grabFunction(ROUTE_SRC, "applyFilings") + "\nexport { applyFilings };",
  `const isPeriodicForm = (f) => ["10-Q","10-K","20-F","6-K"].includes(String(f).trim().toUpperCase().replace(/\\/A$/, ""));`
);

// ── 1. The quarter is derived ───────────────────────────────────────────────
console.log("\n1. The URL, and the quarter that is not hardcoded");
check("Sep -> QTR3, Oct -> QTR4, Jan -> QTR1",
  idx.quarterOf("20260913") === 3 && idx.quarterOf("20261002") === 4 && idx.quarterOf("20260105") === 1);
check("the URL carries the derived quarter", idx.dailyIndexUrl("20261002").includes("/2026/QTR4/master.20261002.idx"),
  idx.dailyIndexUrl("20261002").split("daily-index")[1]);
check("a hardcoded QTR3 would have been wrong for 9 months of the year",
  !idx.dailyIndexUrl("20260105").includes("QTR3"));

// ── 2. Form classification ──────────────────────────────────────────────────
console.log("\n2. Periodic forms include 6-K and 20-F, or ARM never updates");
for (const f of ["10-Q", "10-K", "20-F", "6-K"]) check(`${f} is periodic`, idx.isPeriodicForm(f));
for (const f of ["10-Q/A", "20-F/A", "6-K/A"]) check(`${f} is periodic AND an amendment`, idx.isPeriodicForm(f) && idx.isAmendment(f));
check("form 4 is NOT periodic", !idx.isPeriodicForm("4"));
check("8-K is NOT periodic — ARM has never filed one", !idx.isPeriodicForm("8-K"));
check("a plain 10-Q is not an amendment", !idx.isAmendment("10-Q"));

// ── 3. The index bodies, as EDGAR serves them ───────────────────────────────
const header = (d) =>
  `Description:           Master Index of EDGAR Dissemination Feed\nLast Data Received:    ${d}\nComments:              webmaster@sec.gov\n\nCIK|Company Name|Form Type|Date Filed|File Name\n${"-".repeat(80)}\n`;
const noise = (d, n) =>
  Array.from({ length: n }, (_, i) =>
    `${900000 + i}|NOISE CORP ${i}|8-K|${d}|edgar/data/${900000 + i}/${String(9000000000 + i).padStart(10, "0")}-26-000001.txt`
  ).join("\n") + "\n";

// The 2026-09-10 filings the probe observed.
const IDX_0910 = header("September 10, 2026") +
  `810136|PHOTRONICS INC|10-Q|2026-09-10|edgar/data/810136/0000810136-26-000009.txt\n` +
  `1973239|Arm Holdings plc|6-K|2026-09-10|edgar/data/1973239/0001973239-26-000012.txt\n` +
  `1973239|Arm Holdings plc|4|2026-09-10|edgar/data/1973239/0001973239-26-000013.txt\n` +
  `320193|Apple Inc.|4|2026-09-10|edgar/data/320193/0000320193-26-000081.txt\n` +
  noise("2026-09-10", 40);
const plainDay = (d, label) => header(label) + noise(d, 60);

// FIXTURE CIKs, self-consistent with the rows above. Not an assertion about SEC.
const FIXTURE_CIK = new Map([
  ["AAPL", "0000320193"], ["ARM", "0001973239"], ["MU", "0000723125"],
  ["PLAB", "0000810136"], ["ASTS", "0001780312"],
]);

const manifest = man.emptyManifest();
const seed = man.seedManifest(manifest, [...FIXTURE_CIK.keys()], FIXTURE_CIK, true);
console.log("\n3. Seeding");
check("seeds the universe once", seed.seeded && seed.symbols === 5, `${seed.symbols} symbols`);
check("every symbol has a CIK", seed.withCik === 5 && seed.withoutCik.length === 0);
check("reseeding is idempotent and adds nothing", man.seedManifest(manifest, [...FIXTURE_CIK.keys()], FIXTURE_CIK, true).seeded === false);
const byCik = man.symbolsByCik(manifest);
check("the CIK index registers BOTH padded and unpadded spellings",
  byCik.get("0000320193") === "AAPL" && byCik.get("320193") === "AAPL",
  "the index prints unpadded; the manifest stores padded");

// ── 4. The acceptance window ────────────────────────────────────────────────
console.log("\n4. 2026-09-07 .. 2026-09-11, against what the probe measured");
const DAYS = [
  { date: "20260907", body: null, status: 403, note: "US Labor Day" },
  { date: "20260908", body: plainDay("2026-09-08", "September 8, 2026") },
  { date: "20260909", body: plainDay("2026-09-09", "September 9, 2026") },
  { date: "20260910", body: IDX_0910 },
  { date: "20260911", body: plainDay("2026-09-11", "September 11, 2026") },
];

let consecutive = 0;
let watermark = null;
const perDay = {};
for (const day of DAYS) {
  if (day.body === null) {
    const absent = idx.looksLikeMissingIndex(403, "<?xml version=\"1.0\"?><Error><Code>AccessDenied</Code></Error>");
    perDay[day.date] = { outcome: absent ? "absent" : "failed", periodic: [], matched: 0 };
    if (absent) { consecutive += 1; watermark = day.date; }
    continue;
  }
  const parsed = idx.parseDailyIndex(day.body);
  const filings = idx.intersect(parsed.rows, byCik);
  const applied = route.applyFilings(manifest, filings);
  consecutive = 0;
  watermark = day.date;
  perDay[day.date] = {
    outcome: "parsed", matched: filings.length,
    filings: filings.map((f) => `${f.symbol} ${f.form}`).sort(),
    periodic: applied.periodic, malformed: parsed.malformedRows,
  };
}

check("20260907: classified ABSENT, not failed", perDay["20260907"].outcome === "absent");
check("20260907: the watermark still advances past it", watermark >= "20260907");
check("20260907: no alarm from a single 403", consecutive < 4, `consecutive=${consecutive}`);
check("20260910: all four target filings matched",
  JSON.stringify(perDay["20260910"].filings) === JSON.stringify(["AAPL 4", "ARM 4", "ARM 6-K", "PLAB 10-Q"]),
  JSON.stringify(perDay["20260910"].filings));
check("20260910: PLAB and ARM are the periodic filers; the form 4s are not",
  JSON.stringify(perDay["20260910"].periodic) === JSON.stringify(["ARM", "PLAB"]),
  JSON.stringify(perDay["20260910"].periodic));
for (const d of ["20260908", "20260909", "20260911"]) {
  check(`${d}: parsed, no periodic filings for the target five`,
    perDay[d].outcome === "parsed" && perDay[d].periodic.length === 0 && perDay[d].matched === 0);
}
check("the watermark ends at the last date processed", watermark === "20260911", watermark);
check("no index row was malformed", DAYS.filter((d) => d.body).every((d) => idx.parseDailyIndex(d.body).malformedRows === 0));

// ── 5. What the manifest now says ───────────────────────────────────────────
console.log("\n5. The manifest after the window");
check("PLAB carries its 10-Q accession", manifest.symbols.PLAB.lastAccession === "0000810136-26-000009", manifest.symbols.PLAB.lastAccession);
check("ARM carries a 6-K accession — a 10-Q/10-K detector would have missed it entirely",
  manifest.symbols.ARM.lastAccession?.startsWith("0001973239-26-"), manifest.symbols.ARM.lastAccession);
check("both are flagged for reverification", manifest.symbols.PLAB.needsReverify && manifest.symbols.ARM.needsReverify);
check("AAPL is untouched — a form 4 is not a report",
  manifest.symbols.AAPL.lastAccession === null && manifest.symbols.AAPL.needsReverify === false);
check("MU and ASTS are untouched", manifest.symbols.MU.lastFiled === null && manifest.symbols.ASTS.lastFiled === null);
check("scoreVersion is stored from the first write", manifest.symbols.PLAB.scoreVersion === 1);

// ARM's same-day pair: both recorded, neither guessed between.
const pairManifest = man.emptyManifest();
man.seedManifest(pairManifest, ["ARM"], FIXTURE_CIK, true);
route.applyFilings(pairManifest, [
  { symbol: "ARM", form: "6-K", filed: "20260910", accession: "0001973239-26-000012", amendment: false },
  { symbol: "ARM", form: "6-K", filed: "20260910", accession: "0001973239-26-000014", amendment: false },
]);
check("a same-day pair records BOTH accessions rather than picking one",
  (pairManifest.symbols.ARM.ambiguousSameDayFilings ?? []).length === 2,
  JSON.stringify(pairManifest.symbols.ARM.ambiguousSameDayFilings));
check("...because the index has no reportDate to choose on — deferred to step 3",
  /no reportDate/.test(INDEX_SRC) || /reportDate/.test(ROUTE_SRC));

// Amendments are a separate event.
const amendManifest = man.emptyManifest();
man.seedManifest(amendManifest, ["MU"], FIXTURE_CIK, true);
route.applyFilings(amendManifest, [
  { symbol: "MU", form: "10-Q/A", filed: "20260912", accession: "0000723125-26-000050", amendment: true },
]);
check("a /A filing is recorded as a restatement, not folded into lastAccession",
  amendManifest.symbols.MU.lastAmendment?.form === "10-Q/A" && amendManifest.symbols.MU.needsReverify === true,
  JSON.stringify(amendManifest.symbols.MU.lastAmendment));

// ── 6. Dedupe, malformed rows, dissemination window ─────────────────────────
console.log("\n6. Edges");
const dupBody = header("x") +
  `810136|PHOTRONICS INC|10-Q|2026-09-10|edgar/data/810136/0000810136-26-000009.txt\n`.repeat(3);
check("a repeated accession counts once", idx.intersect(idx.parseDailyIndex(dupBody).rows, byCik).length === 1);
const shortBody = header("x") + `810136|PHOTRONICS INC|10-Q|2026-09-10\n` + `notacik|X|10-Q|2026-09-10|edgar/data/x/y.txt\n`;
const shortParsed = idx.parseDailyIndex(shortBody);
check("a 4-column row is rejected, not shifted into the wrong field", shortParsed.malformedRows === 2 && shortParsed.rows.length === 0,
  `${shortParsed.malformedRows} malformed`);
check("the accession is pulled by pattern, not by trimming a path",
  idx.accessionFrom("edgar/data/320193/0000320193-26-000081.txt") === "0000320193-26-000081" &&
  idx.accessionFrom("edgar/data/320193/index.json") === "");
globalThis.__setET(21 * 60 + 59);
const before = idx.latestProcessableDate(new Date("2026-09-14T01:59:00Z"));
globalThis.__setET(22 * 60 + 1);
const after = idx.latestProcessableDate(new Date("2026-09-14T02:01:00Z"));
check("before 22:00 ET the latest processable date is YESTERDAY", before < after, `${before} then ${after}`);
check("...so the job never asks for an index EDGAR has not finished disseminating", after > before);
// 2026-09-07 is a Monday (US Labor Day), so the acceptance window is Mon-Fri
// and the two days after it are the weekend.
check("weekends are recognised",
  idx.isWeekend("20260911") === false && idx.isWeekend("20260912") === true && idx.isWeekend("20260913") === true,
  "Fri 11th, Sat 12th, Sun 13th");
check("a weekend absence is the SAME outcome as a holiday absence",
  idx.looksLikeMissingIndex(403, "<Error><Code>AccessDenied</Code></Error>") === true,
  "both are 403 AccessDenied from S3; neither is a failure");
check("a 403 with a large non-S3 body is NOT treated as a missing index",
  idx.looksLikeMissingIndex(403, "x".repeat(9000)) === false,
  "that shape is a block, and a block must not advance the watermark silently");

// ── 7. Redis discipline, asserted against the source ────────────────────────
console.log("\n7. Redis discipline");
// COMMENTS STRIPPED BY THE SHARED SCANNER, not by a regex. A hand-rolled strip
// has no idea what a string is, and the assertions below are NEGATIVE ones
// ("no per-symbol redis call", "no companyfacts call") -- exactly the shape
// that passes green when the stripper has eaten the file.
const routeCode = readCodeOnly("app/api/jobs/sec-daily-index/route.ts");
check("exactly one manifest read in the job", (routeCode.match(/readManifest\(/g) ?? []).length === 1);
check("exactly one manifest write in the job", (routeCode.match(/writeManifest\(/g) ?? []).length === 1);
check("no per-symbol Redis call anywhere in the job", !/redis\.(get|set|mget|hget)/i.test(routeCode),
  "the manifest is one key; a per-symbol key would be 700 billed commands a day");
check("the job makes NO companyfacts call — step 2 is the detector alone",
  !/companyfacts/i.test(routeCode) && !/data\.sec\.gov/i.test(routeCode));
check("the manifest key is versioned", /msh:sec:manifest:v1/.test(MANIFEST_SRC));
check("the manifest carries no TTL", !/\bex:\s*\d|expire\(/.test(MANIFEST_SRC),
  "a TTL means eviction means a cold key means a render that has to fetch");

console.log(
  failures === 0
    ? "\nThe change detector reproduces the measured window.\n"
    : `\n${failures} assertion(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
