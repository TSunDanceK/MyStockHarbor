// The SEC daily-index job's change detector, asserted against the five dates
// the probe already measured.
//
// WHY FIXTURES AND NOT A LIVE FETCH. The agent sandbox is refused www.sec.gov
// with 403 CONNECT, and a check that needs the network is a check that fails in
// CI for reasons that have nothing to do with the code. The index bodies below
// are shaped exactly as EDGAR serves them and carry the filings the probe
// observed on those dates.
//
// A CHECK THAT CAN PRODUCE ITS OWN EXPECTED VALUE IS NOT A CHECK.
//
// Three instances in one day, all of which reported PASS while testing nothing:
//
//   1. §17's fixture was built from the same 281 and 127 it then asserted, with
//      forms dealt by a modulo-5 round robin. It reproduced its own typed-in
//      loop bounds and was reported as a replay of a real EDGAR window.
//   2. scripts/listing-venue-diff.mjs would have agreed with itself had it
//      reimplemented parseTickerFile instead of LIFTING it -- a capture that
//      parses with its own code is not evidence about the shipped parser.
//   3. scripts/check-taxonomy-reference.mjs imported its generator, whose
//      top-level write re-ran at import: it regenerated data/taxonomy.json and
//      then compared the file to itself. It passed forever and detected nothing.
//
// THE REMEDY, generally: the subject must be produced by something the check
// cannot influence, and the check must be shown to FAIL. For (3) that was an
// entry-point guard on the generator's write, verified by corrupting the file
// and watching the assertion go red. An assertion never observed failing is an
// assertion of unknown value.
//
// Ask of every new check: could this pass if the code under test were deleted?
//
// STRIPPED SOURCE vs RAW SOURCE, AND WHICH TO READ.
//
//   An assertion about BEHAVIOUR reads readCodeOnly() -- comments stripped --
//   so a rule named in a comment cannot satisfy a check about the code. That is
//   the trap this repo has a doc for (grep-finds-the-comment-not-the-code).
//
//   An assertion about a COMMENT reads the raw file. Several checks here verify
//   that a REASON WAS RECORDED -- a spec citation, a cost argument, a note of
//   what was considered and rejected -- because the defects being guarded
//   shipped precisely when nothing said why. Those must read raw.
//
// Reading the stripped copy for one of those failed exactly as it should have,
// and it will again: when a check asserts a reason is present, reach for
// fs.readFileSync, not readCodeOnly.
//
// WHAT THE FIXTURE DOES AND DOES NOT PROVE. It is SELF-CONSISTENT: the manifest
// and the index rows use the same CIKs, so it proves the intersection, the form
// classification, the 403 handling and the watermark arithmetic. It does NOT
// prove any real ticker->CIK mapping -- that comes from
// data/sec/company-tickers.json, which is not in the tree yet (see
// data/sec/README.md).
//
//   node scripts/check-sec-daily-index.mjs
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const INDEX_SRC = read("lib/server/secDailyIndex.ts");
const MANIFEST_SRC = read("lib/server/secManifest.ts");
const ROUTE_SRC = read("app/api/jobs/sec-daily-index/route.ts");
const TICKER_SRC = read("lib/server/secTickerMap.ts");

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
    // Lifted from source, not re-declared in a prelude. §17b re-derives the
    // pre-fix gate from these two, so a hand-written copy would be testing the
    // copy rather than the shipped predicate.
    grabFunction(INDEX_SRC, "isRereadOnlyForm"),
    grabFunction(INDEX_SRC, "accessionFrom"), grabFunction(INDEX_SRC, "parseDailyIndex"),
    grabFunction(INDEX_SRC, "looksLikeMissingIndex"), grabFunction(INDEX_SRC, "intersect"),
  ].join("\n") +
    "\nexport { quarterOf, dailyIndexUrl, addDays, isWeekend, latestProcessableDate, isAmendment, isPeriodicForm, isRereadOnlyForm, accessionFrom, parseDailyIndex, looksLikeMissingIndex, intersect };",
  `const PERIODIC_FORMS = ["10-Q","10-K","20-F","6-K"];
   const REREAD_ONLY_FORMS = ["8-K"];
   const DISSEMINATION_CLOSE_MINUTES_ET = 22*60;
   let __ET = { minutesOfDay: 23*60 };
   const getEasternParts = () => __ET;
   globalThis.__setET = (m) => { __ET = { minutesOfDay: m }; };`
);

const man = await lift(
  [grabFunction(MANIFEST_SRC, "emptyEntry"), grabFunction(MANIFEST_SRC, "emptyManifest"),
   grabFunction(MANIFEST_SRC, "seedManifest"), grabFunction(MANIFEST_SRC, "symbolsByCik"),
   grabFunction(MANIFEST_SRC, "mapChangeThreshold"), grabFunction(MANIFEST_SRC, "reconcileCiks"),
   grabFunction(MANIFEST_SRC, "reconcileDelistings"), grabFunction(MANIFEST_SRC, "reconcileExchanges"),
   grabFunction(MANIFEST_SRC, "exchangeHistogram"), grabFunction(MANIFEST_SRC, "secRereadQueue")].join("\n") +
    "\nexport { emptyEntry, emptyManifest, seedManifest, symbolsByCik, mapChangeThreshold, reconcileCiks, reconcileDelistings, reconcileExchanges, exchangeHistogram, secRereadQueue };",
  // THE TRANSITIVE CALLEE, AND IT FAILED AT RUN TIME FIRST. grabFunction lifts
  // ONE body and does not follow imports, so seedManifest's lookupBySpelling
  // threw ReferenceError the moment it was called. The helper's REAL source is
  // injected rather than a stand-in: a hand-written stub here would be a second
  // implementation of the exact thing the helper exists to keep single, and the
  // check would then pass against a spelling rule the app does not use.
  fs.readFileSync(path.join(ROOT, "lib/symbolSpellings.mjs"), "utf8")
    .replace(/^export /gm, "") +
    "\nconst SEC_SCORE_VERSION = 1;\nconst DELIST_REFRESHES = 3;\nconst SEC_REREAD_DRAIN_PER_RUN = 40;"
);

const tick = await lift(
  [grabFunction(TICKER_SRC, "padCik"), grabFunction(TICKER_SRC, "parseTickerFile"),
   grabFunction(TICKER_SRC, "validateTickerMap"), grabFunction(TICKER_SRC, "hashTickerMap")].join("\n") +
    "\nexport { padCik, parseTickerFile, validateTickerMap, hashTickerMap };",
  `import crypto from "node:crypto";
   const MIN_EXPECTED_TICKERS = 5000;
   const SENTINEL_TICKERS = ["AAPL","MU","PLAB"];`
);

const route = await lift(
  grabFunction(ROUTE_SRC, "applyFilings") + "\nexport { applyFilings };",
  `const isPeriodicForm = (f) => ["10-Q","10-K","20-F","6-K"].includes(String(f).trim().toUpperCase().replace(/\\/A$/, ""));
   const isRereadOnlyForm = (f) => ["8-K"].includes(String(f).trim().toUpperCase().replace(/\\/A$/, ""));`
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
  ["AAPL", { cik: "0000320193", exchange: "Nasdaq" }],
  ["ARM", { cik: "0001973239", exchange: "Nasdaq" }],
  ["MU", { cik: "0000723125", exchange: "Nasdaq" }],
  ["PLAB", { cik: "0000810136", exchange: "Nasdaq" }],
  ["ASTS", { cik: "0001780312", exchange: "Nasdaq" }],
]);

const manifest = man.emptyManifest();
const seed = man.seedManifest(manifest, [...FIXTURE_CIK.keys()], FIXTURE_CIK, true);
console.log("\n3. Seeding");
check("seeds the universe once", seed.seeded && seed.symbols === 5, `${seed.symbols} symbols`);
check("every symbol has a CIK", seed.withCik === 5 && seed.withoutCik.length === 0);
check("reseeding is idempotent and adds nothing", man.seedManifest(manifest, [...FIXTURE_CIK.keys()], FIXTURE_CIK, true).seeded === false);
// ── THE DOTTED TICKER, WHICH HAD NO CIK AND THEREFORE NO PAGE ──────────────
//
// `cikByTicker.get(symbol)` alone gave BRK.B nothing: the universe spells it
// with a DOT and SEC's exchange file with a DASH. A symbol with no CIK is
// invisible to the daily index, never enters the re-read queue, and can never
// be populated -- so its page reads "not loaded yet" forever with no error
// anywhere to say why.
//
// REAL SPELLINGS FROM THE COMMITTED TICKER FILE, not invented ones: BRK-B,
// BF-B and MKC-V are how data/sec/company-tickers.json actually writes them,
// and all three are absent under the dotted form the universe uses.
const DOTTED = new Map([
  ["BRK-B", { cik: "0001067983", exchange: "NYSE" }],
  ["BF-B", { cik: "0000014693", exchange: "NYSE" }],
  ["MKC-V", { cik: "0000063754", exchange: "NYSE" }],
  ["AAPL", { cik: "0000320193", exchange: "Nasdaq" }],
]);
const dotManifest = man.emptyManifest();
const dotSeed = man.seedManifest(dotManifest, ["BRK.B", "BF.B", "MKC.V", "AAPL"], DOTTED, true);
check("a DOTTED universe ticker resolves to the DASHED map entry's CIK",
  dotManifest.symbols["BRK.B"]?.cik === "0001067983",
  dotManifest.symbols["BRK.B"]?.cik ?? "no CIK — the defect this asserts against");
check("...and so do the other two dotted forms in the universe",
  dotManifest.symbols["BF.B"]?.cik === "0000014693" &&
    dotManifest.symbols["MKC.V"]?.cik === "0000063754");
check("none of the four lands in withoutCik", dotSeed.withoutCik.length === 0,
  dotSeed.withoutCik.join(", "));
// The manifest keeps the UNIVERSE's spelling as its key, not the map's -- the
// rest of the pipeline joins on that, and rewriting it here would move the
// problem rather than fix it.
check("the manifest is keyed by the universe's spelling, not the ticker file's",
  "BRK.B" in dotManifest.symbols && !("BRK-B" in dotManifest.symbols));
// An undotted symbol genuinely absent from the map must still report absent:
// the helper widens the search, it does not invent a hit.
check("a symbol absent under EVERY spelling still reports no CIK",
  man.seedManifest(man.emptyManifest(), ["NOSUCH"], DOTTED, true).withoutCik.join() === "NOSUCH");

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

// ── 7b. The committed data file is actually usable ─────────────────────────
//
// It landed with a stray "#" at byte 0 and did not parse. That failed loudly --
// loadTickerMap reports present:false -- but "the fallback is broken" is only
// discovered on the day the fetch fails, which is the worst day to discover it.
// Asserted here so the committed copy is checked on every run of the suite.
console.log("\n7b. The committed ticker file");
const TICKER_PATH = "data/sec/company-tickers.json";
if (!fs.existsSync(path.join(ROOT, TICKER_PATH))) {
  check(`${TICKER_PATH} is present`, false, "not committed yet — see data/sec/README.md");
} else {
  const rawTicker = read(TICKER_PATH);
  check("it starts with '{' — no stray prefix byte", rawTicker[0] === "{", JSON.stringify(rawTicker.slice(0, 3)));
  let parsedTicker = null;
  let tickerShape = null;
  try { ({ map: parsedTicker, shape: tickerShape } = tick.parseTickerFile(rawTicker)); } catch (err) { parsedTicker = err.message; }
  check("it parses through the real loader's parser", parsedTicker instanceof Map,
    parsedTicker instanceof Map ? `${parsedTicker.size} tickers, shape=${tickerShape}` : String(parsedTicker).slice(0, 100));
  if (parsedTicker instanceof Map) {
    const v = tick.validateTickerMap(parsedTicker);
    check("it passes the same validation the refresh applies", v.ok, v.reason ?? `${parsedTicker.size} tickers`);
    check("the five probe symbols resolve",
      ["AAPL", "ARM", "MU", "PLAB", "ASTS"].every((x) => parsedTicker.has(x)),
      ["AAPL", "ARM", "MU", "PLAB", "ASTS"].map((x) => `${x}=${parsedTicker.get(x) ?? "MISSING"}`).join(" "));
    check("CIKs are stored padded to ten digits",
      [...parsedTicker.values()].every((v) => /^\d{10}$/.test(v.cik)));
    // BOTH SHAPES ARE READABLE and the committed copy may be either while the
    // swap to company_tickers_exchange.json is in flight. The check states
    // which one is in the tree rather than asserting a shape the repo may not
    // have yet -- and says plainly when exchange data is therefore absent.
    const withEx = [...parsedTicker.values()].filter((v) => v.exchange).length;
    if (tickerShape === "fields+data") {
      check("exchange is carried for effectively every symbol",
        withEx >= parsedTicker.size * 0.9, `${withEx} of ${parsedTicker.size}`);
      const hist = {};
      for (const v of parsedTicker.values()) hist[v.exchange ?? "(none)"] = (hist[v.exchange ?? "(none)"] ?? 0) + 1;
      check("the observed venues are the documented ones",
        ["Nasdaq", "NYSE", "OTC"].some((x) => hist[x] > 0),
        Object.entries(hist).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(" "));
    } else {
      check("LEGACY shape in the tree: no exchange column, and it is reported as such",
        tickerShape === "legacy-object" && withEx === 0,
        "company_tickers_exchange.json has not been committed yet — exchange reads (unknown) until it is, and nothing pretends otherwise");
    }
    // THE FIXTURE IS NO LONGER MERELY SELF-CONSISTENT. It was written with
    // invented CIKs because the file was not in the tree; now that it is, the
    // acceptance window above is asserted against the real mapping, so a wrong
    // CIK in the fixture can no longer make the test pass for the wrong reason.
    const fixtureMismatch = [...FIXTURE_CIK.entries()].filter(([sym, v]) => parsedTicker.get(sym)?.cik !== v.cik);
    check("the acceptance fixture's CIKs match the committed file exactly",
      fixtureMismatch.length === 0,
      fixtureMismatch.length ? fixtureMismatch.map(([s, v]) => `${s}: fixture ${v.cik} vs real ${parsedTicker.get(s)?.cik}`).join(" | ") : "all five");
  }
}

// ── 8. The ticker map is a seed and fallback, not the source of truth ───────
console.log("\n8. Ticker map refresh");
const bigMap = (extra = {}) => {
  const m = new Map();
  for (let i = 0; i < 6000; i++) m.set(`T${i}`, { cik: String(i).padStart(10, "0"), exchange: "Nasdaq" });
  for (const t of ["AAPL", "MU", "PLAB"]) m.set(t, { cik: "0000000001", exchange: "Nasdaq" });
  for (const [k, v] of Object.entries(extra)) m.set(k, v);
  return m;
};
check("a full map validates", tick.validateTickerMap(bigMap()).ok);
const shortMap = new Map([["AAPL", { cik: "0000000001", exchange: "Nasdaq" }]]);
check("a SHORT payload is rejected, not adopted", tick.validateTickerMap(shortMap).ok === false,
  tick.validateTickerMap(shortMap).reason);
const noSentinel = bigMap();
noSentinel.delete("AAPL");
check("a map missing a sentinel ticker is rejected", tick.validateTickerMap(noSentinel).ok === false,
  tick.validateTickerMap(noSentinel).reason);
const badCik = bigMap();
badCik.set("AAPL", { cik: "not-a-cik", exchange: "Nasdaq" });
check("a malformed CIK is rejected", tick.validateTickerMap(badCik).ok === false, tick.validateTickerMap(badCik).reason);
check("rejection happens BEFORE any invalidation could be computed from it",
  /validateTickerMap/.test(TICKER_SRC) && TICKER_SRC.indexOf("const valid = validateTickerMap(map)") < TICKER_SRC.indexOf("lastChangedAt: base.contentChanged"),
  "a truncated payload would otherwise read as thousands of symbols changing CIK");
const e = (cik, exchange = "Nasdaq") => ({ cik, exchange });
check("the same mapping hashes the same regardless of insertion order",
  tick.hashTickerMap(new Map([["A", e("1")], ["B", e("2")]])) === tick.hashTickerMap(new Map([["B", e("2")], ["A", e("1")]])));
check("a changed CIK hashes differently",
  tick.hashTickerMap(new Map([["A", e("1")]])) !== tick.hashTickerMap(new Map([["A", e("2")]])));
check("a changed EXCHANGE also hashes differently",
  tick.hashTickerMap(new Map([["A", e("1", "NYSE")]])) !== tick.hashTickerMap(new Map([["A", e("1", "Nasdaq")]])),
  "a hash ignoring exchange would report the file unchanged on the one refresh where the column moved");
check("CIKs are padded to ten digits", tick.padCik(320193) === "0000320193" && tick.padCik("0000320193") === "0000320193");
check("the refresh records which source answered", /source: "redis"/.test(TICKER_SRC) && /"committed-file"/.test(TICKER_SRC));
check("Last-Modified is stored so the real change cadence is measurable",
  /lastModified/.test(TICKER_SRC) && /lastChangedAt/.test(TICKER_SRC));
check("a 304 is treated as unchanged rather than as a failure", /notModified/.test(TICKER_SRC));

// ── 8b. The exchange file shape, read by column NAME ────────────────────────
console.log("\n8b. company_tickers_exchange.json");
const EX_FILE = JSON.stringify({
  fields: ["cik", "name", "ticker", "exchange"],
  data: [
    [1045810, "NVIDIA CORP", "NVDA", "Nasdaq"],
    [320193, "Apple Inc.", "AAPL", "Nasdaq"],
    [19617, "JPMORGAN CHASE & CO", "JPM", "NYSE"],
    [1750, "AAR CORP", "AIR", "NYSE"],
    [99999, "SOME OTC CO", "OTCX", "OTC"],
    [88888, "NO VENUE CO", "NOVEN", ""],
  ],
});
const ex = tick.parseTickerFile(EX_FILE);
check("the fields+data shape is recognised", ex.shape === "fields+data", ex.shape);
check("ticker -> cik is read by column name", ex.map.get("AAPL").cik === "0000320193", ex.map.get("AAPL")?.cik);
check("exchange is carried through", ex.map.get("JPM").exchange === "NYSE" && ex.map.get("NVDA").exchange === "Nasdaq");
check("an empty exchange becomes null, not an empty string", ex.map.get("NOVEN").exchange === null);
check("all three observed venues parse", ["Nasdaq", "NYSE", "OTC"].every((v) => [...ex.map.values()].some((e) => e.exchange === v)));

// COLUMN ORDER IS NOT ASSUMED. A positional read would file every exchange
// under `name` the day SEC inserts a column.
const REORDERED = JSON.stringify({
  fields: ["ticker", "exchange", "cik", "name"],
  data: [["AAPL", "Nasdaq", 320193, "Apple Inc."]],
});
const reord = tick.parseTickerFile(REORDERED);
check("a REORDERED fields array still reads correctly",
  reord.map.get("AAPL").cik === "0000320193" && reord.map.get("AAPL").exchange === "Nasdaq",
  JSON.stringify(reord.map.get("AAPL")));
let threw = null;
try { tick.parseTickerFile(JSON.stringify({ fields: ["name", "exchange"], data: [["x", "y"]] })); } catch (err) { threw = err.message; }
check("a file missing a required column throws rather than returning an empty map", !!threw, String(threw).slice(0, 80));

// The legacy shape is still readable, and says so.
const LEGACY = JSON.stringify({ "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." } });
const leg = tick.parseTickerFile(LEGACY);
check("the legacy object-of-objects shape still parses", leg.shape === "legacy-object" && leg.map.get("AAPL").cik === "0000320193");
check("...with exchange null rather than invented", leg.map.get("AAPL").exchange === null,
  "the legacy file has no exchange column; null is the honest value");
let junkThrew = null;
try { tick.parseTickerFile("#" + LEGACY); } catch (err) { junkThrew = err.message; }
check("junk before the first { is still NOT tolerated", !!junkThrew,
  "a lenient parse reading a corrupted file as data is the trap this pipeline avoids");

// ── 8c. An exchange change is not an invalidation ───────────────────────────
console.log("\n8c. Exchange is a field copy, not a reconciliation");
const xm = man.emptyManifest();
man.seedManifest(xm, ["AAPL", "JPM"], new Map([
  ["AAPL", { cik: "0000320193", exchange: "Nasdaq" }],
  ["JPM", { cik: "0000019617", exchange: "NYSE" }],
]), true);
check("exchange is carried from the FIRST write", xm.symbols.AAPL.exchange === "Nasdaq" && xm.symbols.JPM.exchange === "NYSE");
for (const sym of ["AAPL", "JPM"]) Object.assign(xm.symbols[sym], { contentHash: "filings", lastAccession: "0000000000-26-000001", needsReverify: false });

// JPM moves NYSE -> Nasdaq. CIK unchanged.
const movedVenue = new Map([
  ["AAPL", { cik: "0000320193", exchange: "Nasdaq" }],
  ["JPM", { cik: "0000019617", exchange: "Nasdaq" }],
]);
const xr = man.reconcileExchanges(xm, movedVenue, { sourceHasExchangeColumn: true });
check("the venue move is recorded", xr.updated.length === 1 && xr.updated[0].symbol === "JPM", JSON.stringify(xr.updated));
check("the field is updated", xm.symbols.JPM.exchange === "Nasdaq");
check("NOTHING is invalidated — filings, accession and hash all survive",
  xm.symbols.JPM.contentHash === "filings" && xm.symbols.JPM.lastAccession === "0000000000-26-000001" &&
  xm.symbols.JPM.needsReverify === false,
  "only a CIK change means the data might belong to somebody else");
check("the CIK reconciliation sees no change at all", man.reconcileCiks(xm, movedVenue).changes.length === 0,
  "exchange must not inherit the invalidation path");

// A map with no exchange column must not blank a known venue.
const blanked = new Map([
  ["AAPL", { cik: "0000320193", exchange: null }],
  ["JPM", { cik: "0000019617", exchange: null }],
]);
const br = man.reconcileExchanges(xm, blanked, { sourceHasExchangeColumn: false });
check("a source with NO exchange column writes nothing at all",
  xm.symbols.AAPL.exchange === "Nasdaq" && xm.symbols.JPM.exchange === "Nasdaq" &&
  br.sourceHasExchangeColumn === false && br.filled === 0 && br.updated.length === 0,
  "the legacy file parses every exchange as null; treating those as observations would blank the whole universe");

// The histogram the bars negotiation needs.
const hm = man.emptyManifest();
man.seedManifest(hm, ["A", "B", "C", "D", "E"], new Map([
  ["A", { cik: "0000000001", exchange: "Nasdaq" }],
  ["B", { cik: "0000000002", exchange: "Nasdaq" }],
  ["C", { cik: "0000000003", exchange: "NYSE" }],
  ["D", { cik: "0000000004", exchange: "OTC" }],
  ["E", { cik: "0000000005", exchange: null }],
]), true);
const hist = man.exchangeHistogram(hm);
check("the histogram counts the UNIVERSE by venue",
  hist.Nasdaq === 2 && hist.NYSE === 1 && hist.OTC === 1 && hist["(unknown)"] === 1, JSON.stringify(hist));
check("...sorted with the largest venue first", Object.keys(hist)[0] === "Nasdaq");
check("...and unknown is a bucket, not a silent drop",
  Object.values(hist).reduce((a, b) => a + b, 0) === 5,
  "the NYSE slice is the population that loses price history if bars go Nasdaq-only");

// ── 8d. Five exchange values, and a blank is one of them ───────────────────
console.log("\n8d. Blank is an answer, not a gap");
// MEASURED over the real file 2026-09-13:
//   Nasdaq 4,367 · NYSE 3,299 · OTC 2,500 · (blank) 216 · CBOE 44  = 10,426
const FIVE = JSON.stringify({
  fields: ["cik", "name", "ticker", "exchange"],
  data: [
    [1, "A CORP", "AA", "Nasdaq"], [2, "B CORP", "BB", "NYSE"],
    [3, "C CORP", "CC", "OTC"], [4, "D CORP", "DD", "CBOE"],
    [5, "E CORP", "EE", ""],
  ],
});
const five = tick.parseTickerFile(FIVE);
check("CBOE parses as a venue like any other", five.map.get("DD").exchange === "CBOE");
check("a blank cell parses to null", five.map.get("EE").exchange === null);
check("a blank row is still IN the map — it is not dropped", five.map.has("EE"),
  "dropping it would make the filer look absent, and absence starts a delisting clock");

const fm = man.emptyManifest();
man.seedManifest(fm, ["AA", "BB", "CC", "DD", "EE", "ZZ"], five.map, true);
const fr = man.reconcileExchanges(fm, five.map, { sourceHasExchangeColumn: true });
check("the blank row is counted as a recorded answer, not a failure",
  fr.noVenueRecorded === 1 && fr.sourceHasExchangeColumn === true, JSON.stringify({ noVenueRecorded: fr.noVenueRecorded }));
check("...and is marked exchangeKnown", fm.symbols.EE.exchangeKnown === true && fm.symbols.EE.exchange === null);
check("a symbol the map never carried is NOT marked known", fm.symbols.ZZ.exchangeKnown !== true && fm.symbols.ZZ.exchange === null);
const fh = man.exchangeHistogram(fm);
check("the histogram separates (none recorded) from (unknown)",
  fh["(none recorded)"] === 1 && fh["(unknown)"] === 1, JSON.stringify(fh));
check("...and all five real venues appear",
  fh.Nasdaq === 1 && fh.NYSE === 1 && fh.OTC === 1 && fh.CBOE === 1, JSON.stringify(fh));
check("nothing treats a blank exchange as suspicious",
  tick.validateTickerMap(new Map([...five.map, ...Array.from({ length: 6000 }, (_, i) => [`F${i}`, { cik: String(i).padStart(10, "0"), exchange: "" }]),
    ["AAPL", { cik: "0000320193", exchange: null }], ["MU", { cik: "0000723125", exchange: null }], ["PLAB", { cik: "0000810136", exchange: null }]])).ok === true,
  "validation looks at CIKs and counts; a venue-less filer is still a filer");

// ── 8e. The refused-spike escape hatch ──────────────────────────────────────
console.log("\n8e. Override");
const ovSyms = Array.from({ length: 200 }, (_, i) => `O${i}`);
const ovCik = new Map(ovSyms.map((x, i) => [x, { cik: String(i).padStart(10, "0"), exchange: "Nasdaq" }]));
const ovMan = man.emptyManifest();
man.seedManifest(ovMan, ovSyms, ovCik, true);
for (const x of ovSyms) ovMan.symbols[x].contentHash = "filings";
const ovShift = new Map(ovSyms.map((x, i) => [x, { cik: String(i + 700000).padStart(10, "0"), exchange: "Nasdaq" }]));
check("without the override, a spike still refuses", man.reconcileCiks(ovMan, ovShift).applied === false);
check("...and nothing was touched", ovMan.symbols.O0.contentHash === "filings");
const ovRes = man.reconcileCiks(ovMan, ovShift, { override: true });
check("WITH the override, the same spike applies", ovRes.applied === true && ovRes.changes.length === 200);
check("...and the invalidation really happens", ovMan.symbols.O0.contentHash === null && ovMan.symbols.O0.cik === "0000700000");
const dlMan = man.emptyManifest();
man.seedManifest(dlMan, ovSyms, ovCik, true);
check("the delisting guard has the same override",
  man.reconcileDelistings(dlMan, new Map(), { override: true }).applied === true &&
  man.reconcileDelistings(man.emptyManifest(), new Map()).applied === true);
check("the override is NAMED at the guard so it is findable",
  /\?applyMapChanges=1/.test(MANIFEST_SRC),
  "an escape hatch nobody can find is the same as not having one");

// ── 9. A CIK change is an invalidation, never a merge ───────────────────────
console.log("\n9. CIK reassignment");
const reMan = man.emptyManifest();
man.seedManifest(reMan, ["AAPL", "ARM", "MU", "PLAB", "ASTS"], FIXTURE_CIK, true);
// Give every symbol some stored history to lose.
for (const sym of Object.keys(reMan.symbols)) {
  Object.assign(reMan.symbols[sym], {
    lastAccession: "0000000000-26-000001", lastFiled: "20260910",
    contentHash: "deadbeef", verifiedAt: 1, needsReverify: false,
  });
}
const moved = new Map(FIXTURE_CIK);
moved.set("PLAB", { cik: "0009999999", exchange: "Nasdaq" }); // reassigned
const res = man.reconcileCiks(reMan, moved);
check("one CIK change is detected", res.changes.length === 1 && res.changes[0].symbol === "PLAB", JSON.stringify(res.changes));
check("...and it is applied", res.applied === true && res.suspectedMapShapeChange === false);
check("...carrying BOTH CIKs for investigation",
  res.changes[0].previousCik === "0000810136" && res.changes[0].newCik === "0009999999");
check("the stored fact set is DISCARDED, not merged",
  reMan.symbols.PLAB.contentHash === null && reMan.symbols.PLAB.lastAccession === null &&
  reMan.symbols.PLAB.lastFiled === null && reMan.symbols.PLAB.verifiedAt === null,
  JSON.stringify(reMan.symbols.PLAB));
check("...and it is re-enqueued", reMan.symbols.PLAB.needsReverify === true);
check("the new CIK is adopted", reMan.symbols.PLAB.cik === "0009999999");
check("every OTHER symbol is untouched",
  ["AAPL", "ARM", "MU", "ASTS"].every((s) => reMan.symbols[s].contentHash === "deadbeef"));
// The enqueue must carry its own provenance. Leaving reverifyReason at whatever
// the symbol last filed claims a source for a fact set that was just discarded,
// and leaving enqueuedAt unset drops the entry to the BACK of the drain.
check("...tagged as a CIK change, not as whatever it last filed",
  reMan.symbols.PLAB.reverifyReason === "cik-change",
  JSON.stringify(reMan.symbols.PLAB));
check("...with a fresh enqueue timestamp",
  typeof reMan.symbols.PLAB.enqueuedAt === "number" && reMan.symbols.PLAB.enqueuedAt > 0,
  String(reMan.symbols.PLAB.enqueuedAt));
// A symbol whose history was thrown away has NOTHING to serve, so it outranks a
// symbol that still has last quarter's numbers on disk. Ordered against an
// amendment enqueued long BEFORE it, so this can only pass on rank, not on age.
const ckMan = man.emptyManifest();
man.seedManifest(ckMan, ["AAPL", "PLAB"], FIXTURE_CIK, true);
Object.assign(ckMan.symbols.AAPL, {
  needsReverify: true, reverifyReason: "amendment", enqueuedAt: 1,
  contentHash: "deadbeef", lastAccession: "0000320193-26-000001",
});
const ckMoved = new Map(FIXTURE_CIK);
ckMoved.set("PLAB", { cik: "0009999999", exchange: "Nasdaq" });
man.reconcileCiks(ckMan, ckMoved);
const ckQueue = man.secRereadQueue(ckMan);
check("an invalidated symbol drains BEFORE an older amendment",
  ckQueue.length === 2 && ckQueue[0].symbol === "PLAB" && ckQueue[0].reason === "cik-change" &&
  ckQueue[1].symbol === "AAPL" && ckQueue[1].reason === "amendment",
  ckQueue.map((x) => `${x.symbol}:${x.reason}@${x.enqueuedAt}`).join(" "));
check("...and it is queued with a real timestamp, not a null that sorts first by accident",
  typeof ckQueue[0].enqueuedAt === "number" && ckQueue[0].enqueuedAt >= ckQueue[1].enqueuedAt);

// Absence is not reassignment.
const gapMan = man.emptyManifest();
man.seedManifest(gapMan, ["AAPL", "PLAB"], FIXTURE_CIK, true);
gapMan.symbols.PLAB.contentHash = "keepme";
const gapRes = man.reconcileCiks(gapMan, new Map([["AAPL", { cik: "0000320193", exchange: "Nasdaq" }]]));
check("a symbol ABSENT from the map is left alone, not wiped",
  gapMan.symbols.PLAB.contentHash === "keepme" && gapRes.absentFromMap === 1,
  "the fallback map is smaller than the live one; clearing on absence would wipe the store");

// A null CIK being filled is not a reassignment.
const fillMan = man.emptyManifest();
man.seedManifest(fillMan, ["AAPL"], new Map(), false);
const fillRes = man.reconcileCiks(fillMan, FIXTURE_CIK);
check("filling a null CIK is a fill, not an invalidation",
  fillRes.filled === 1 && fillRes.changes.length === 0 && fillMan.symbols.AAPL.cik === "0000320193");

// ── 10. THE SPIKE GUARD — the destructive case ──────────────────────────────
console.log("\n10. A spike refuses to apply");
check("the threshold scales with the universe but never below 5",
  man.mapChangeThreshold(5) === 5 && man.mapChangeThreshold(700) === 7 && man.mapChangeThreshold(10000) === 100);
const spikeSyms = Array.from({ length: 200 }, (_, i) => `S${i}`);
const spikeCik = new Map(spikeSyms.map((s, i) => [s, { cik: String(i).padStart(10, "0"), exchange: "Nasdaq" }]));
const spikeMan = man.emptyManifest();
man.seedManifest(spikeMan, spikeSyms, spikeCik, true);
for (const s of spikeSyms) spikeMan.symbols[s].contentHash = "precious";
// Every symbol's CIK moves at once -- the shape of a changed map source.
const shifted = new Map(spikeSyms.map((s, i) => [s, { cik: String(i + 500000).padStart(10, "0"), exchange: "Nasdaq" }]));
const spikeRes = man.reconcileCiks(spikeMan, shifted);
check("200 changes are DETECTED", spikeRes.changes.length === 200);
check("...and NONE are applied", spikeRes.applied === false && spikeRes.suspectedMapShapeChange === true);
check("...no fact set was discarded", spikeSyms.every((s) => spikeMan.symbols[s].contentHash === "precious"));
check("...the previous CIKs stand", spikeMan.symbols.S0.cik === "0000000000", spikeMan.symbols.S0.cik);
check("...and the reason names the map source, not the market",
  /map source changed shape/.test(spikeRes.note), spikeRes.note?.slice(0, 80));
check("a run at exactly the threshold still applies",
  (() => {
    const syms = Array.from({ length: 700 }, (_, i) => `X${i}`);
    const base = new Map(syms.map((s, i) => [s, { cik: String(i).padStart(10, "0"), exchange: "Nasdaq" }]));
    const m2 = man.emptyManifest();
    man.seedManifest(m2, syms, base, true);
    const next = new Map(base);
    for (let i = 0; i < 7; i++) next.set(`X${i}`, { cik: String(i + 900000).padStart(10, "0"), exchange: "Nasdaq" });
    return man.reconcileCiks(m2, next).applied === true;
  })(),
  "7 of 700 is the threshold; a real reassignment must not be blocked");

// ── 10b. Absence is a probable delisting, not a reassignment ────────────────
console.log("\n10b. Delisting");
const dl = (syms) => {
  const m = man.emptyManifest();
  const cik = new Map(syms.map((x, i) => [x, { cik: String(i).padStart(10, "0"), exchange: "NYSE" }]));
  man.seedManifest(m, syms, cik, true);
  for (const x of syms) m.symbols[x].contentHash = "filings";
  return { m, cik };
};
const { m: dm, cik: dcik } = dl(["AAPL", "ARM", "MU", "PLAB", "ASTS"]);
const without = (map, drop) => new Map([...map].filter(([k]) => k !== drop));

const r1 = man.reconcileDelistings(dm, without(dcik, "PLAB"));
check("first absence records notInTickerMapSince", dm.symbols.PLAB.notInTickerMapSince !== null && dm.symbols.PLAB.absentRefreshCount === 1);
check("...but does NOT mark delisted", dm.symbols.PLAB.delisted === false);
check("...and clears nothing — the filings stay", dm.symbols.PLAB.contentHash === "filings" && dm.symbols.PLAB.cik !== null,
  "absence is not reassignment");
check("...reported as newly absent", r1.newlyAbsent.length === 1 && r1.applied === true);

man.reconcileDelistings(dm, without(dcik, "PLAB"));
check("second refresh still absent: count 2, still not delisted",
  dm.symbols.PLAB.absentRefreshCount === 2 && dm.symbols.PLAB.delisted === false);

const firstSeen = dm.symbols.PLAB.notInTickerMapSince;
const r3 = man.reconcileDelistings(dm, without(dcik, "PLAB"));
check("THIRD consecutive refresh marks it delisted",
  dm.symbols.PLAB.delisted === true && dm.symbols.PLAB.absentRefreshCount === 3, JSON.stringify(r3.newlyDelisted));
check("...notInTickerMapSince still points at the FIRST absence, not the third",
  dm.symbols.PLAB.notInTickerMapSince === firstSeen);
check("...and the filings are STILL there — never deleted on absence",
  dm.symbols.PLAB.contentHash === "filings" && dm.symbols.PLAB.cik !== null,
  "delisted data is the best record of what that company filed");
check("...no other symbol was touched",
  ["AAPL", "ARM", "MU", "ASTS"].every((x) => dm.symbols[x].delisted === false && dm.symbols[x].absentRefreshCount === 0));

man.reconcileDelistings(dm, dcik);
check("reappearance clears the flag, the counter AND the timestamp",
  dm.symbols.PLAB.delisted === false && dm.symbols.PLAB.absentRefreshCount === 0 && dm.symbols.PLAB.notInTickerMapSince === null,
  "a symbol missing for one refresh was missed, not delisted");

// A blink must not accumulate a strike.
const { m: bm, cik: bcik } = dl(["AAPL", "PLAB"]);
man.reconcileDelistings(bm, without(bcik, "PLAB"));
man.reconcileDelistings(bm, bcik);
man.reconcileDelistings(bm, without(bcik, "PLAB"));
man.reconcileDelistings(bm, without(bcik, "PLAB"));
check("absence must be CONSECUTIVE — a reappearance resets the clock",
  bm.symbols.PLAB.absentRefreshCount === 2 && bm.symbols.PLAB.delisted === false,
  "2 strikes after the reset, not 3");

// ── 10b-ii. A reticker is a rename, not a delisting ────────────────────────
console.log("\n10b-ii. Reticker vs delisting");
// MEASURED 2026-09-13 in the committed ticker file: BK is absent and CIK
// 1390777 is present as BNY; EQR is absent and CIK 906107 is present as VMRK.
// EA and WBS have no row under any ticker.
const rt = man.emptyManifest();
const rtSeed = new Map([
  ["BK", { cik: "0001390777", exchange: "NYSE" }],
  ["EQR", { cik: "0000906107", exchange: "NYSE" }],
  ["EA", { cik: "0000712515", exchange: "Nasdaq" }],
  ["AAPL", { cik: "0000320193", exchange: "Nasdaq" }],
]);
man.seedManifest(rt, ["BK", "EQR", "EA", "AAPL"], rtSeed, true);
for (const x of ["BK", "EQR", "EA", "AAPL"]) rt.symbols[x].contentHash = "filings";
// The map a week later: BK -> BNY, EQR -> VMRK, EA gone entirely.
const later = new Map([
  ["BNY", { cik: "0001390777", exchange: "NYSE" }],
  ["BNY-PK", { cik: "0001390777", exchange: "NYSE" }],
  ["VMRK", { cik: "0000906107", exchange: "NYSE" }],
  ["AAPL", { cik: "0000320193", exchange: "Nasdaq" }],
]);
const rtRes = man.reconcileDelistings(rt, later);
check("BK is classified as a RETICKER, not an absence",
  rtRes.retickered.some((r) => r.symbol === "BK" && r.nowTicker === "BNY"), JSON.stringify(rtRes.retickered));
check("...preferring the ordinary share over the preferred (BNY, not BNY-PK)",
  rtRes.retickered.find((r) => r.symbol === "BK")?.nowTicker === "BNY");
check("EQR -> VMRK likewise", rtRes.retickered.some((r) => r.symbol === "EQR" && r.nowTicker === "VMRK"));
check("neither starts a delisting clock",
  rt.symbols.BK.notInTickerMapSince === null && rt.symbols.EQR.absentRefreshCount === 0 &&
  rt.symbols.BK.delisted === false && rt.symbols.EQR.delisted === false);
check("...and they can never reach newlyDelisted", rtRes.newlyDelisted.length === 0);
check("the migration is recorded on the entry", rt.symbols.BK.retickeredTo === "BNY" && rt.symbols.EQR.retickeredTo === "VMRK");
check("filings are retained through a rename", rt.symbols.BK.contentHash === "filings" && rt.symbols.EQR.contentHash === "filings");
check("EA — CIK in the manifest, absent from the map entirely — DOES start the clock",
  rtRes.newlyAbsent.includes("EA") && rt.symbols.EA.absentRefreshCount === 1,
  "a CIK that appears nowhere is the delisting case");
// READ THROUGH THE SHARED SCANNER. The comments in that module NAME these
// tickers as the worked example, and a raw-source regex would match the prose
// and report a hardcoded table that does not exist.
check("no hardcoded successor table exists in the manifest CODE",
  !/\bBNY\b|\bVMRK\b|\bWBS\b/.test(readCodeOnly("lib/server/secManifest.ts")),
  "the successor is derived from the map's own CIK index, not from a September 2026 table");

// A symbol that NEVER resolved has no identity to trace.
const nc = man.emptyManifest();
man.seedManifest(nc, ["WBS", "AAPL"], new Map([["AAPL", { cik: "0000320193", exchange: "Nasdaq" }]]), true);
const ncRes = man.reconcileDelistings(nc, new Map([["AAPL", { cik: "0000320193", exchange: "Nasdaq" }]]));
check("a no-CIK symbol is 'unresolvable', not 'newly absent'",
  ncRes.unresolvable.includes("WBS") && !ncRes.newlyAbsent.includes("WBS"), JSON.stringify(ncRes.unresolvable));
check("...and gets NO delisting clock",
  nc.symbols.WBS.notInTickerMapSince === null && nc.symbols.WBS.absentRefreshCount === 0 && nc.symbols.WBS.delisted === false,
  "absence from the ticker file is not proof of deregistration, and with no CIK there is even less evidence");

// A reticker that reverts clears the marker.
man.reconcileDelistings(rt, rtSeed);
check("a symbol reappearing under its original ticker clears retickeredTo", rt.symbols.BK.retickeredTo === null);

// ── 10c. The partial-map guard ──────────────────────────────────────────────
console.log("\n10c. A valid-but-partial map marks nobody delisted");
const partialSyms = Array.from({ length: 200 }, (_, i) => `P${i}`);
const { m: pm, cik: pcik } = dl(partialSyms);
// Passes the 5,000-ticker floor elsewhere, yet drops most of OUR universe.
const partial = new Map([...pcik].slice(0, 20));
const pr = man.reconcileDelistings(pm, partial);
check("180 newly absent are DETECTED", pr.newlyAbsent.length === 180);
check("...and NOTHING is applied", pr.applied === false && pr.suspectedPartialMap === true);
check("...no absence timestamp was recorded at all",
  partialSyms.every((x) => pm.symbols[x].notInTickerMapSince === null && pm.symbols[x].absentRefreshCount === 0),
  "recording it would delist them all three refreshes later");
check("...and the reason names the map, not the market", /map is partial/.test(pr.note), pr.note?.slice(0, 70));
check("the delisting guard uses the SAME threshold as CIK reconciliation",
  pr.threshold === man.mapChangeThreshold(200));

// The guard must not jam on a steady state of genuinely delisted names.
const { m: sm, cik: scik } = dl(Array.from({ length: 700 }, (_, i) => `Q${i}`));
const dropped = Array.from({ length: 20 }, (_, i) => `Q${i}`);
let steady = new Map(scik);
for (const d of dropped) steady.delete(d);
// First refresh: 20 newly absent against a threshold of 7 -> blocked, correctly.
check("20 vanishing at once is blocked", man.reconcileDelistings(sm, steady).applied === false);
// Now the realistic shape: a few at a time, already-absent ones staying absent.
const { m: tm, cik: tcik } = dl(Array.from({ length: 700 }, (_, i) => `R${i}`));
let live = new Map(tcik);
let everApplied = true;
for (let round = 0; round < 6; round++) {
  for (let k = 0; k < 3; k++) live.delete(`R${round * 3 + k}`);
  if (!man.reconcileDelistings(tm, live).applied) everApplied = false;
}
check("a few delistings a refresh, accumulating, never jams the guard", everApplied === true,
  "guarding on the STANDING absent set instead of the newly absent one would jam after the first few");
check("...and they do reach delisted", tm.symbols.R0.delisted === true, `R0 count=${tm.symbols.R0.absentRefreshCount}`);

// ── 11. The job wires it in the right order ─────────────────────────────────
console.log("\n11. Job ordering");
// Compared at the CALL SITES, not the import list -- both names appear in the
// import block and its order says nothing about execution order.
// Guard the anchors themselves: a stale anchor returns -1, and -1 is less than
// every real index, so an ordering assertion built on one passes for the wrong
// reason. Both sides are asserted present before they are compared.
check("the ordering anchors still exist in the route",
  routeCode.includes(": reconcileCiks(manifest, tickers.map, {") &&
  routeCode.includes("= symbolsByCik(manifest)") &&
  routeCode.includes("= await resolveTickerMap()"),
  "a stale anchor makes the two ordering checks below vacuous");
check("the ticker map is reconciled BEFORE the index is intersected",
  routeCode.indexOf(": reconcileCiks(manifest, tickers.map, {") < routeCode.indexOf("= symbolsByCik(manifest)"),
  "a symbol whose CIK moved must match on the new CIK the same run, not a day later");
check("the ticker map is resolved before it is reconciled against",
  routeCode.indexOf("= await resolveTickerMap()") < routeCode.indexOf(": reconcileCiks(manifest, tickers.map, {"));
check("fact sets are discarded only when the changes were APPLIED",
  /cikChanges\?\.applied && cikChanges\.changes\.length/.test(routeCode));
check("a suspected map shape change makes the run NOT ok",
  /suspectedMapShapeChange \?\? false\)/.test(routeCode));
check("delisting is gated on a SUCCESSFUL REFRESH, not on every run",
  /refreshSucceeded && tickers\.source === "redis"/.test(routeCode),
  "counted per refresh; counting per run would delist after three days rather than three weeks");
check("a suspected partial map also makes the run NOT ok",
  /suspectedPartialMap \?\? false\)/.test(routeCode));
check("the job accepts ?key= as well as the Bearer header",
  /guardDebugRequest\(req\)/.test(routeCode) && /Bearer \$\{secret\}/.test(routeCode),
  "a header cannot be typed into an address bar; the cron path is unchanged");
check("a valid Bearer never reaches the key guard",
  routeCode.indexOf("if (!secret || auth === `Bearer ${secret}`) return null;") <
    routeCode.indexOf("return guardDebugRequest(req);"),
  "otherwise the scheduler records key failures against its own IP and locks itself out");
check("the override reaches BOTH reconciliations",
  /reconcileCiks\(manifest, tickers\.map, \{ override: applyMapChanges \}\)/.test(routeCode) &&
  /override: applyMapChanges \}\)/.test(routeCode));
check("the exchange column flag is passed from the resolved shape",
  /sourceHasExchangeColumn: tickers\.shape === "fields\+data"/.test(routeCode));
check("exchange is reconciled on every run with a map, not gated on a refresh",
  /tickers\.source === "none"\s*\?\s*null\s*:\s*reconcileExchanges\(/.test(routeCode),
  "a field copy with no destructive branch has nothing to guard");
check("the exchange histogram reaches the job output",
  /exchangeHistogram: exchanges\?\.histogram/.test(routeCode));
check("the Redis budget is stated as three, not still claiming two",
  /redisCommands: dryRun \|\| inspectionOnly \? 2 : 3/.test(routeCode), "manifest GET + tickers GET + manifest SET");

// ── 12. The manifest is BOUNDED — the pre-merge question ───────────────────
//
// 1,441 filing rows in four days is ~90,000 a year. The manifest is one key with
// no TTL, read and written every run, so if filings ACCUMULATED in it the value
// would grow without bound and the GET/SET would become the dominant cost of
// every run including no-ops. The property that makes it safe is that every
// write is an ASSIGNMENT, never an append -- asserted here rather than believed.
console.log("\n12. Manifest size is independent of filing volume");
const applySrc = grabFunction(ROUTE_SRC, "applyFilings");
check("applyFilings never pushes onto an entry field",
  !/entry\.[A-Za-z]+\.push\(/.test(applySrc) && !/entry\.[A-Za-z]+ = \[\s*\.\.\.entry\./.test(applySrc),
  "an append would make the value grow with every filing forever");
check("the only array field is REPLACED, not extended",
  /entry\.ambiguousSameDayFilings =\s*\n?\s*sameDay\.length > 1/.test(applySrc),
  "same-day accessions, overwritten each run and bounded by one day's filings for one symbol");
// Asserted precisely: it is never assigned INTO the manifest, and it does
// appear in the response. A proximity regex matched the surrounding code and
// said the opposite.
check("the per-day filing list is never assigned into the manifest",
  !/manifest\.[A-Za-z]+\s*=\s*filingsBySymbol/.test(routeCode) &&
  !/symbols\[[^\]]+\][^=]*=\s*filingsBySymbol/.test(routeCode) &&
  !new RegExp("entry\\.[A-Za-z]+\\s*=\\s*filingsBySymbol").test(routeCode),
  "filingsBySymbol is response-only");
check("...and it IS in the response, where the volume is free",
  /\n\s*filingsBySymbol,/.test(routeCode));

// Measured at the real universe size, worst case, every field populated.
const sizeAt = (n, full) => {
  const syms = {};
  for (let i = 0; i < n; i++) {
    syms["SYM" + i] = full
      ? { cik: String(1000000 + i).padStart(10, "0"), exchange: "Nasdaq", exchangeKnown: true,
          lastAccession: "0001973239-26-000012", lastFiled: "20260911", contentHash: "a".repeat(64),
          nextExpected: "2026-11-04", nextExpectedSource: "announcement", verifiedAt: 1789400000000,
          needsReverify: true, scoreVersion: 1, reverifyReason: "periodic-report",
          lastAmendment: { accession: "0000723125-26-000050", form: "10-Q/A", filed: "20260912" },
          ambiguousSameDayFilings: ["a", "b", "c"], notInTickerMapSince: null, absentRefreshCount: 0,
          delisted: false, retickeredTo: null }
      : man.emptyEntry(String(1000000 + i).padStart(10, "0"), "Nasdaq");
  }
  return JSON.stringify({ ...man.emptyManifest(), symbols: syms }).length;
};
const worst = sizeAt(696, true);
check("worst-case manifest at 696 symbols stays well inside Upstash's 10 MB ceiling",
  worst < 1048576, `${(worst / 1024).toFixed(0)} KB (${((worst / 10485760) * 100).toFixed(1)}% of the ceiling)`);
check("size scales with SYMBOLS, not with filings",
  Math.abs(sizeAt(1392, true) / worst - 2) < 0.05,
  "doubling the universe doubles it; a year of filings does not change it at all");

// ── 13. Absence no longer feeds the failure counter ────────────────────────
console.log("\n13. Absent is not a failure");
check("absent increments the ABSENCE counter, not the failure counter",
  /consecutiveAbsent \+= 1;/.test(routeCode) &&
  !/outcome === "absent"[\s\S]{0,200}consecutive \+= 1/.test(routeCode),
  "measured: a Saturday-only run took consecutiveIndexFailures 0 -> 1");
check("a parse resets BOTH counters", /consecutive = 0;\s*\n\s*consecutiveAbsent = 0;/.test(routeCode));
check("a real failure still increments the failure counter",
  /outcome: "failed"[\s\S]{0,400}/.test(routeCode) && /consecutive \+= 1;/.test(routeCode));
check("a long absence run is still caught, separately and far looser",
  /IMPLAUSIBLE_ABSENCE_RUN = 10/.test(routeCode) && /absenceImplausible/.test(routeCode),
  "a block answering with a small body would otherwise read as holidays forever");
check("an implausible absence run makes the job NOT ok", /!absenceImplausible &&/.test(routeCode));

// ── 14. from/to does not mutate the watermark ──────────────────────────────
console.log("\n14. A range walk is inspection, not a write");
check("from/to alone is inspection-only", /const inspectionOnly = explicitRange && !persistRange;/.test(routeCode),
  "measured: a from/to run rewound the persisted watermark 20260912 -> 20260911");
check("...so nothing is written", /dryRun \|\| inspectionOnly \? false : await writeManifest/.test(routeCode));
check("...and the response says so rather than leaving it to be inferred",
  /watermarkMoved:/.test(routeCode) && /rangeNote:/.test(routeCode));
check("&persist=1 opts back in", /persistRange = url\.searchParams\.get\("persist"\) === "1"/.test(routeCode));

// ── 15. 6-K is recorded as unconfirmed, without narrowing the form set ─────
console.log("\n15. 6-K stays in, but is marked unconfirmed");
const six = man.emptyManifest();
man.seedManifest(six, ["ARM", "INTU", "MU"], FIXTURE_CIK.size ? new Map([
  ["ARM", { cik: "0001973239", exchange: "Nasdaq" }],
  ["INTU", { cik: "0000896878", exchange: "Nasdaq" }],
  ["MU", { cik: "0000723125", exchange: "Nasdaq" }],
]) : new Map(), true);
route.applyFilings(six, [
  { symbol: "ARM", form: "6-K", filed: "20260911", accession: "0001973239-26-000012", amendment: false },
  { symbol: "INTU", form: "10-K", filed: "20260911", accession: "0000896878-26-000030", amendment: false },
  { symbol: "MU", form: "10-Q/A", filed: "20260911", accession: "0000723125-26-000050", amendment: true },
]);
check("6-K still counts as periodic — ARM reports its quarter through one",
  six.symbols.ARM.lastAccession === "0001973239-26-000012" && six.symbols.ARM.needsReverify === true,
  "narrowing the form set would silently lose ARM's quarterly numbers");
check("...but is marked UNCONFIRMED so step 3 can check before downloading 272 KB",
  six.symbols.ARM.reverifyReason === "unconfirmed", six.symbols.ARM.reverifyReason);
check("a 10-K is a periodic-report, worth a full read", six.symbols.INTU.reverifyReason === "periodic-report");
check("an amendment outranks both", six.symbols.MU.reverifyReason === "amendment");
check("the form set is unchanged — 6-K and 20-F are still periodic",
  idx.isPeriodicForm("6-K") && idx.isPeriodicForm("20-F"));

// ── 16. 8-K enqueues a re-read but is not a period report ──────────────────
console.log("\n16. 8-K, and the re-read queue");
const q = man.emptyManifest();
man.seedManifest(q, ["ARM", "INTU", "MU", "KO", "PG"], new Map([
  ["ARM", { cik: "0001973239", exchange: "Nasdaq" }],
  ["INTU", { cik: "0000896878", exchange: "Nasdaq" }],
  ["MU", { cik: "0000723125", exchange: "Nasdaq" }],
  ["KO", { cik: "0000021344", exchange: "NYSE" }],
  ["PG", { cik: "0000080424", exchange: "NYSE" }],
]), true);
route.applyFilings(q, [
  { symbol: "KO", form: "8-K", filed: "20260911", accession: "0000021344-26-000044", amendment: false },
  { symbol: "ARM", form: "6-K", filed: "20260911", accession: "0001973239-26-000012", amendment: false },
  { symbol: "INTU", form: "10-K", filed: "20260911", accession: "0000896878-26-000030", amendment: false },
  { symbol: "MU", form: "10-Q/A", filed: "20260911", accession: "0000723125-26-000050", amendment: true },
]);
check("an 8-K enqueues a re-read", q.symbols.KO.needsReverify === true && q.symbols.KO.reverifyReason === "unconfirmed");
check("...but does NOT become lastAccession — it is not the quarter",
  q.symbols.KO.lastAccession === null && q.symbols.KO.lastFiled === null,
  "Item 4.02 arrives on an 8-K, so it must trigger a read; recording it as the latest periodic filing would claim a report that does not exist");
check("a symbol with no filing is not enqueued", q.symbols.PG.needsReverify === false);
check("everything enqueued carries a timestamp",
  [q.symbols.KO, q.symbols.ARM, q.symbols.INTU, q.symbols.MU].every((e) => typeof e.enqueuedAt === "number"));

const queue = man.secRereadQueue(q);
check("the queue orders amendment -> report -> unconfirmed",
  queue.map((x) => x.symbol).slice(0, 2).join(",") === "MU,INTU",
  queue.map((x) => `${x.symbol}:${x.reason}`).join(" "));
check("...with the 6-K and 8-K last", queue.slice(2).every((x) => x.reason === "unconfirmed"));
check("the queue is capped", man.secRereadQueue(q, 2).length === 2);
check("a symbol with no CIK is never queued — there is nothing to fetch",
  (() => { const m = man.emptyManifest(); man.seedManifest(m, ["ZZ"], new Map(), true);
    m.symbols.ZZ.needsReverify = true; return man.secRereadQueue(m).length === 0; })());
check("the queue needs NO extra Redis — it is read off the manifest",
  !/redis\./i.test(grabFunction(MANIFEST_SRC, "secRereadQueue") ?? ""),
  "a separate structure would add commands to every run against a budget of three");

// The evidence must stay attached to the decision.
const manifestCode = readCodeOnly("lib/server/secManifest.ts");
check("the measured reason for having NO conditional check is recorded in the source",
  /Last-Modified ABSENT, ETag ABSENT/.test(MANIFEST_SRC) && /23 of 23|0 of 25/.test(MANIFEST_SRC),
  "so nobody adds an If-Modified-Since later and reads the silence as success");
check("the drain size names its own measurement",
  /JSON\.parse median 21 ms|182 MB\/s/.test(MANIFEST_SRC) &&
  /SEC_REREAD_DRAIN_PER_RUN = Math\.max\(150/.test(manifestCode),
  "the literal 40 is gone; the value is now derived from the measured peak");
check("no isXBRL discriminator was built", !/isXBRL/.test(manifestCode) && !/isXBRL/.test(readCodeOnly("app/api/jobs/sec-daily-index/route.ts")),
  "it over-triggers on ARM and under-triggers on HSBC; no threshold fixes both");

// ── 17. Noise does not queue a multi-MB read ───────────────────────────────
//
// Reproduces the reported window shape: 281 symbols touched, 127 with a
// financial form, 154 whose only filings are noise -- and a quarter of those
// noise filings AMENDED, which is the case the taxonomy had no word for.
console.log("\n17. Only financial forms queue");
//
// THIS IS A UNIT TEST OF THE GATE. IT IS NOT A REPLAY OF ANY WINDOW.
//
// It used to claim to reproduce 20260908-11, and it did not. It built 281
// synthetic symbols and dealt the first 127 forms from a modulo-5 round robin,
// ["10-Q","10-K","6-K","8-K","20-F"][i % 5], which yields exactly 77
// periodic-report and 50 unconfirmed -- not because EDGAR looks like that, but
// because three of those five forms are periodic and two are not. The live route
// over the real window returns { unconfirmed: 119, periodic-report: 6,
// amendment: 2 }: 6-K dominates, exactly as this repo's own measurement says
// ("6-K is 89% of the periodic signal"). The totals matched only because 281 and
// 127 were typed in as loop bounds. A fixture reverse-engineered from the answer
// cannot be evidence about what produced the answer.
//
// So the counts here are deliberately small and the forms deliberately chosen:
// this section answers "does each form class queue, and with which reason", and
// nothing about how often each form occurs. Section 17b replays the real window.
const GATE_CASES = [
  // form, queues?, reason
  ["10-Q", true, "periodic-report"],
  ["10-K", true, "periodic-report"],
  ["20-F", true, "periodic-report"],
  ["6-K", true, "unconfirmed"],   // periodic FORM, but usually not a report
  ["8-K", true, "unconfirmed"],   // Item 4.02 lives here, so it must queue
  ["10-Q/A", true, "amendment"],
  ["10-K/A", true, "amendment"],
  ["8-K/A", true, "amendment"],
  ["6-K/A", true, "amendment"],
  ["4", false, null],
  ["4/A", false, null],           // THE DEFECT: an amended Form 4 carries no numbers
  ["144", false, null],
  ["144/A", false, null],
  ["424B2", false, null],
  ["FWP", false, null],
  ["SCHEDULE 13D/A", false, null],
  ["SCHEDULE 13G/A", false, null],
];
{
  const syms = GATE_CASES.map((_, i) => "G" + i);
  const cik = new Map(syms.map((x, i) => [x, { cik: String(i + 1).padStart(10, "0"), exchange: "NYSE" }]));
  const m = man.emptyManifest();
  man.seedManifest(m, syms, cik, true);
  route.applyFilings(
    m,
    GATE_CASES.map((c, i) => ({
      symbol: "G" + i,
      form: c[0],
      filed: "20260911",
      accession: "g" + i,
      amendment: c[0].toUpperCase().endsWith("/A"),
    }))
  );
  const wrong = GATE_CASES.map((c, i) => ({ form: c[0], want: c, got: m.symbols["G" + i] }))
    .filter((x) => x.got.needsReverify !== x.want[1] || (x.got.reverifyReason ?? null) !== x.want[2]);
  check("every form class queues, or does not, with the reason the route assigns",
    wrong.length === 0,
    wrong.map((x) => `${x.form}: wanted ${x.want[1]}/${x.want[2]} got ${x.got.needsReverify}/${x.got.reverifyReason}`).join("; ") ||
      `${GATE_CASES.length} form classes checked`);
  check("an amended Form 4 does NOT queue a companyfacts read",
    m.symbols.G10.needsReverify === false && m.symbols.G10.reverifyReason === null,
    "the pre-fix gate matched any /A, so 4/A queued as 'amendment' — the highest rank");
  check("...and neither does an amended 13D/13G",
    m.symbols.G15.needsReverify === false && m.symbols.G16.needsReverify === false);
  check("everything that queues carries a timestamp",
    GATE_CASES.every((c, i) => !c[1] || typeof m.symbols["G" + i].enqueuedAt === "number"));
  check("every queued reason is one the taxonomy names",
    Object.values(m.symbols).filter((e) => e.needsReverify)
      .every((e) => ["amendment", "periodic-report", "unconfirmed", "cik-change"].includes(e.reverifyReason)));
}

// THE SYNTHETIC FORMS ABOVE ARE THE ONES THE GATE MUST SEPARATE, and that list
// is derived from the shipped constants rather than retyped -- a form added to
// PERIODIC_FORMS with no case here would otherwise go untested.
{
  const covered = new Set(GATE_CASES.map((c) => c[0].toUpperCase().replace(/\/A$/, "")));
  const declared = [
    ...(readCodeOnly("lib/server/secDailyIndex.ts").match(/PERIODIC_FORMS = \[([^\]]+)\]/)?.[1] ?? "")
      .split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean),
    ...(readCodeOnly("lib/server/secDailyIndex.ts").match(/REREAD_ONLY_FORMS = \[([^\]]+)\]/)?.[1] ?? "")
      .split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean),
  ];
  check("every declared periodic / re-read form has a case above",
    declared.length > 0 && declared.every((f) => covered.has(f.toUpperCase())),
    `declared: ${declared.join(", ")}`);
}

// ── 17b. The REAL window, replayed through the route ───────────────────────
//
// THIS IS THE SECTION §17 PRETENDED TO BE. The rows below are the actual
// filings SEC published for 20260908-11, captured by scripts/sec-window-fixture.mjs
// (relay run 34833712268) with every parser lifted from the shipped modules,
// and carried back through the relay-capture payload route. They are replayed
// through the route's own applyFilings, so the reverifyReason values here are
// the ones step 3 will dispatch on.
console.log("\n17b. The real 20260908-11 window");
{
  const fxPath = "data/sec/window-fixture-20260908-11.json";
  const fx = JSON.parse(fs.readFileSync(fxPath, "utf8"));

  // INTEGRITY FIRST. This fixture travelled through a job log as base64, and a
  // single substituted character survived every structural check on the first
  // attempt -- right line count, right byte count, right row shapes, wrong
  // data. Only a hash caught it. So the hash is re-checked here, on every run,
  // over the same canonical form the capture hashed.
  const compact = fx.filings.map((f) => `${f.symbol}|${f.form}|${f.filed}|${f.accession}`).join("\n");
  const digest = crypto.createHash("sha256").update(compact, "utf8").digest("hex");
  check("the fixture still hashes to what the capture emitted",
    digest === fx.provenance.payloadSha256,
    `${digest.slice(0, 16)}… vs recorded ${String(fx.provenance.payloadSha256).slice(0, 16)}…`);
  check("...and carries the row count it claims",
    fx.filings.length === fx.provenance.rows && fx.filings.length === 2008, `${fx.filings.length} rows`);

  const syms = [...new Set(fx.filings.map((f) => f.symbol))];
  const cik = new Map(syms.map((x, i) => [x, { cik: String(i + 1).padStart(10, "0"), exchange: "NYSE" }]));
  const m = man.emptyManifest();
  man.seedManifest(m, syms, cik, true);
  route.applyFilings(m, fx.filings);

  const hist = {};
  let queued = 0;
  for (const e of Object.values(m.symbols)) {
    if (!e.needsReverify) continue;
    queued++;
    hist[e.reverifyReason ?? "(null)"] = (hist[e.reverifyReason ?? "(null)"] ?? 0) + 1;
  }

  // THE FINDING THAT KILLED THE OLD §17. Its synthetic fixture produced
  // { periodic-report: 77, unconfirmed: 50 } from a modulo-5 round robin. A real
  // week is nothing like that: 6-K and 8-K dominate and genuine period reports
  // are single digits, which is what "6-K is 89% of the periodic signal" means
  // in practice.
  //
  // ASSERTED EXACTLY, NOT AS A SHAPE. The fixture is frozen and its sha256 is
  // checked above, so these counts are deterministic -- there is no reason to
  // accept a band. A tolerance here would pass through a material drift in
  // applyFilings, which is the one thing this section exists to catch. The
  // shape assertions below are a SECOND layer, not a substitute.
  check("the queue is exactly what the route makes of the real window",
    queued === 123 && hist.unconfirmed === 113 && hist["periodic-report"] === 8 && hist.amendment === 2,
    `${queued} queued ${JSON.stringify(hist)}`);
  // The live run over the same four days, 2026-09-14, against the LIVE 696-symbol
  // manifest universe rather than this frozen dump's 700:
  //
  //     live      281 matched symbols   1,441 rows   127 queued
  //                 { unconfirmed: 119, periodic-report: 6, amendment: 2 }
  //     fixture   291 matched symbols   2,008 rows   123 queued
  //                 { unconfirmed: 113, periodic-report: 8, amendment: 2 }
  //
  // amendment agrees exactly and the shape agrees; the rest is a MEMBERSHIP
  // difference, not drift -- the deltas run opposite ways (ten more symbols,
  // four fewer queued), so neither set contains the other. It is decomposed by
  // scripts/window-fixture-diff.mjs, which needs the live matched-symbol list.
  // Recorded as a dated delta beside the exact counts, never as a reason to
  // loosen them.
  check("unconfirmed DOMINATES the queue — a real week is 6-K, not 10-Q",
    hist.unconfirmed > 0.8 * queued,
    `${JSON.stringify(hist)} of ${queued} queued`);
  check("...and genuine period reports are single digits, not 77",
    (hist["periodic-report"] ?? 0) < 10,
    "the old synthetic fixture claimed 77; the window contains " + (hist["periodic-report"] ?? 0));
  check("every queued reason is one the taxonomy names",
    Object.keys(hist).every((r) => ["amendment", "periodic-report", "unconfirmed", "cik-change"].includes(r)),
    JSON.stringify(hist));

  // THE 4/A DEFECT, MEASURED ON REAL ROWS. The pre-fix gate matched any form
  // ending /A. Re-derived here from the shipped predicates rather than restated.
  const post = new Set(Object.entries(m.symbols).filter(([, e]) => e.needsReverify).map(([x]) => x));
  const pre = new Set();
  for (const f of fx.filings) {
    if (idx.isPeriodicForm(f.form) || idx.isRereadOnlyForm(f.form) || f.amendment) pre.add(f.symbol);
  }
  const added = [...pre].filter((x) => !post.has(x)).sort();
  check("the narrowed gate queues exactly 123 where the pre-fix one queued 130",
    post.size === 123 && pre.size === 130, `${post.size} vs ${pre.size}`);
  check("...and the seven it drops are the seven the live run named",
    added.join(" ") === "BEN CRL DOCU DT GS RSG VTRS",
    added.join(" ") + " — reached from a different universe and a separate capture");
  check("...and every symbol it drops filed NOTHING that carries numbers",
    added.every((sym) =>
      fx.filings.filter((f) => f.symbol === sym)
        .every((f) => !idx.isPeriodicForm(f.form) && !idx.isRereadOnlyForm(f.form))),
    added.join(" ") || "none");
  check("no symbol queues on an amended Form 4 alone",
    !added.some((sym) => post.has(sym)),
    "4/A, 144/A and SCHEDULE 13D/A are not financial statements");
}

// ── 17c. The 100 guaranteed slots are actually in the manifest ─────────────
//
// THIS ASSERTION IS AS MUCH THE FIX AS THE UNION IS.
//
// The defect it guards was silent by construction: the job seeded from
// readDynamicUniverse() alone, so JPM and C had no manifest entry, and a symbol
// with no entry can never be matched by intersect() against the daily index.
// The cron ran green forever while /stock/JPM/earnings stayed empty. No
// counter, no warning, nothing to notice -- which is exactly the shape that
// needs a test rather than a comment.
//
// It is also NOT a two-symbol problem. readDynamicUniverse filters on a 14-day
// ENTRY_MAX_AGE_MS over a rolling score-ranked pool, so which preset name is
// missing changes week to week. Asserting the whole list is the only version of
// this check that keeps working.
console.log("\n17c. PRESET_UNIVERSE is guaranteed a manifest entry");
{
  // Read from the shipped list, never retyped: a name added to PRESET_UNIVERSE
  // must be covered by this check the moment it lands.
  const presetSrc = readCodeOnly("lib/server/presetUniverse.ts");
  const preset = [...new Set([...presetSrc.matchAll(/"([A-Z][A-Z0-9.-]{0,6})"/g)].map((m) => m[1]))];
  check("the preset list is read from source and is the ~100 it claims to be",
    preset.length >= 90 && preset.length <= 110, `${preset.length} symbols`);
  check("...and it still contains the two the live manifest was missing",
    preset.includes("JPM") && preset.includes("C"),
    "JPM and C — named so a regression says which guarantee broke");

  // A dynamic pool that has aged BOTH of them out, which is the live condition
  // that produced the defect.
  const dynamic = ["AAPL", "MSFT", "NVDA", "GS", "BMO", "MER-PK"];
  const universe = [...new Set([...preset, ...dynamic])];
  const cikMap = new Map(universe.map((sym, i) => [sym, { cik: String(i + 1).padStart(10, "0"), exchange: "NYSE" }]));
  const m = man.emptyManifest();
  man.seedManifest(m, universe, cikMap, true);
  const missing = preset.filter((sym) => !m.symbols[sym]);
  check("every PRESET_UNIVERSE symbol has a manifest entry after seeding",
    missing.length === 0, missing.join(" ") || `all ${preset.length} present`);
  check("...including JPM and C when the dynamic pool has aged them out",
    Boolean(m.symbols.JPM) && Boolean(m.symbols.C),
    "the live pool had both absent; the union is what puts them back");

  // AND THE ROUTE MUST ACTUALLY BUILD THAT UNION. The check above proves
  // seedManifest keeps what it is handed; this proves the route hands it the
  // right thing, which is the half that was broken.
  const routeCode = readCodeOnly("app/api/jobs/sec-daily-index/route.ts");
  // THE RAW SOURCE TOO, DELIBERATELY. routeCode is readCodeOnly()'d -- comments
  // stripped -- which is right for every assertion about BEHAVIOUR and exactly
  // wrong for the ones below about a COMMENT. See this file's header.
  const routeRaw = fs.readFileSync("app/api/jobs/sec-daily-index/route.ts", "utf8");
  check("the route seeds from PRESET_UNIVERSE ∪ the dynamic pool",
    /new Set\(\[\s*\.\.\.PRESET_UNIVERSE,\s*\.\.\.\(await readDynamicUniverse\(\)\)/.test(routeCode),
    "the union is the fix; seedManifest cannot add what it is never given");
  check("...and does NOT slice it by ANALYSIS_UNIVERSE_CAP",
    !/ANALYSIS_UNIVERSE_CAP/.test(routeCode),
    "that cap bounds ANALYSIS — a history fetch and indicator pass per symbol. " +
      "Detection is one daily-index request at any size, and the per-symbol cost " +
      "that does scale is governed by SEC_REREAD_DRAIN_PER_RUN");
  check("the reason is recorded at the seed call, not just in a findings doc",
    /sec-pipeline-spec-2026-09-13\.md §7/.test(routeRaw) && /guaranteed a slot/.test(routeRaw),
    "the cap shipped because nothing said why it was there");

  // THE THIRD INPUT. dynamicUniverseCache's header names three sources bounded
  // by ANALYSIS_UNIVERSE_CAP; the seed unions two. Asserted, not trusted: the
  // third is covered only because pickersBuilder writes promoted names INTO the
  // pool. If that call is ever removed or its source changed, the seed silently
  // loses an input again -- the same shape as the defect above.
  const buildersCode = readCodeOnly("lib/server/pickersBuilder.ts");
  check("popular-search promotions reach the pool, so the seed's two inputs cover three",
    /addToDynamicUniverse\(\s*popularSearchSymbols,\s*"search"/.test(buildersCode),
    "pickersBuilder persists them; readDynamicUniverse then returns them");
  check("...and the seed records that it considered the third input",
    /popular-search promotions/.test(routeRaw) && /addToDynamicUniverse/.test(routeRaw),
    "this class of bug survives because nothing writes down what was considered");

  // THE PRECEDENT. The same defect happened one layer up and is documented in
  // pickersBuilder. Asserted so that warning cannot be deleted while the code it
  // warns about still exists.
  const buildersRaw = fs.readFileSync("lib/server/pickersBuilder.ts", "utf8");
  check("pickersBuilder still carries the concat-then-slice warning this repeats",
    /NOT concat-then-slice/.test(buildersRaw) && /sliced the mega-caps off/.test(buildersRaw),
    "PRESET appended then cut to the cap dropped AAPL/NVDA from the screener — the same bug, one layer up");

  // SIZE, because uncapping is only safe if the bound is asserted rather than
  // asserted-once-and-forgotten. 100 presets on top of 696 is the worst case.
  const grown = sizeAt(796, true);
  check("the unioned manifest stays well inside Upstash's 10 MB ceiling",
    grown < 1048576,
    `${(grown / 1024).toFixed(0)} KB at 796 symbols (${((grown / 10485760) * 100).toFixed(1)}% of the ceiling)`);
}

// ── 17d. The run is observable without a key ───────────────────────────────
//
// The FIRST automated run (04:00:16 UTC 2026-09-15, 200, dpl_B6UF7eCd8tcq)
// printed nothing at all. recordJobRun writes behind CACHE_HEALTH_KEY and the
// cron caller discards the response body, so there was no way to tell whether
// it had walked a date, parsed an index or done nothing whatsoever.
//
// A daily job returning 200 while doing nothing is indistinguishable from one
// working. That is the failure this whole pipeline is built against, and it was
// unobservable on its own first run.
console.log("\n17d. The summary reaches the platform log");
{
  const raw = fs.readFileSync("app/api/jobs/sec-daily-index/route.ts", "utf8");
  check("the summary is console.logged, not only recorded behind a key",
    /console\.log\("\[sec-daily-index\]", JSON\.stringify\(\{ ok, \.\.\.summary \}\)\)/.test(raw),
    "warm-stock-data's pattern: console.log(\"[warm-stock-data]\", JSON.stringify(result))");
  check("...and it is emitted AFTER recordJobRun, so both carry the same object",
    raw.indexOf('recordJobRun("sec-daily-index", ok, summary)') <
      raw.indexOf('console.log("[sec-daily-index]", JSON.stringify({ ok, ...summary }))'));
  check("the refusal paths log too — a silent 503 looks like the job never fired",
    (raw.match(/console\.log\("\[sec-daily-index\]", JSON\.stringify\(\{ ok: false/g) ?? []).length === 2,
    "SEC_USER_AGENT missing, and manifest unreadable");
  // THE PREFIX IS THE HOUSE CONVENTION, not a free choice: the platform log is
  // grepped by it, and warm-stock-data, warm-earnings and the rest all use it.
  check("the prefix matches the job name exactly",
    !/console\.log\("\[sec[- ]daily[- ]?index/.test(raw.replace(/\[sec-daily-index\]/g, "")),
    "one spelling, so a grep for the job name finds every line it emits");
}

// ── 18. The drain clears the busiest day of the year ───────────────────────
console.log("\n18. Drain sized on peak, not on the quiet month");
const PEAK_SHARE = 0.0935, CAP = 700, BG = 32;
const peak = Math.ceil(CAP * PEAK_SHARE) + BG;
const drain = Math.max(150, Math.ceil(peak * 1.5));
check("the peak is REUSED from earningsPlan, not re-derived here",
  /EARNINGS_PEAK_DAY_SHARE/.test(MANIFEST_SRC) && /from "\.\/earningsPlan"/.test(MANIFEST_SRC),
  "it carries its own provenance, witnesses and a check that re-derives it");
check("the drain exceeds peak inflow with margin", drain > peak && drain / peak >= 1.4,
  `${drain}/run against ${peak}/day peak = ${(drain / peak).toFixed(2)}x`);
check("...so the queue SHRINKS on the worst day of the year",
  drain - peak > 0, `${drain - peak} symbols drained beyond inflow, every day of the cycle`);
check("the constant is derived, so a bigger universe moves it",
  /Math\.ceil\(ANALYSIS_UNIVERSE_CAP \* EARNINGS_PEAK_DAY_SHARE\)/.test(MANIFEST_SRC),
  "typing 150 would go stale the next time the universe grows");
check("150 sequential reads fit the function budget",
  drain * 0.4 < 240, `~${Math.round(drain * 0.4)}s of round-trips inside 300s`);
check("...and stay under SEC's 10 req/s", drain / (drain * 0.4) <= 10, `~${(1 / 0.4).toFixed(1)} req/s`);

// ── 19. The manifest is read in exactly one place ──────────────────────────
//
// PRE-MERGE PROPERTY: 417 KB is free once a day and ruinous per visitor. This
// asserts it stays that way rather than being true today by accident.
console.log("\n19. Nothing on a render path touches the manifest");
const readers = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) { walk(rel); continue; }
    if (!/\.(ts|tsx)$/.test(e.name)) continue;
    if (rel === "lib/server/secManifest.ts") continue;
    const src = readCodeOnly(rel);
    if (/readManifest|writeManifest|SEC_MANIFEST_KEY|secRereadQueue/.test(src)) readers.push(rel);
  }
};
walk("app"); walk("lib");
check("only job routes touch the manifest", readers.every((r) => r.startsWith("app/api/jobs/")),
  readers.join(", ") || "none");
// NAMED, NOT COUNTED. "Exactly one file" was right while sec-daily-index was the
// only job; step 3's population path is a second, and a bare count would have to
// be bumped to 2 and would then wave through a third. The property is WHICH
// files, so a new reader -- especially a render path -- still has to be added
// here deliberately.
const ALLOWED_MANIFEST_READERS = [
  "app/api/jobs/sec-daily-index/route.ts",
  // Step 3. It reads the manifest to build its two queues and writes it back
  // once with the contentHash and verifiedAt it filled. Still a job, still once
  // a day, still nowhere near a render.
  "app/api/jobs/sec-facts/route.ts",
];
check("...and they are exactly the two job routes that are supposed to",
  readers.length === ALLOWED_MANIFEST_READERS.length &&
    readers.every((r) => ALLOWED_MANIFEST_READERS.includes(r)),
  readers.join(", "));
check("no .tsx file references it at all", !readers.some((r) => r.endsWith(".tsx")),
  "a page importing it would pull 417 KB into a render");
check("the manifest module is not imported by any page or component",
  !readers.some((r) => r.startsWith("app/") && !r.startsWith("app/api/")));

// ── 20. The cold path cannot eat the universe's budget ─────────────────────
console.log("\n20. Separate budgets, universe guaranteed");
check("the off-universe cold fetch has its OWN constant",
  /SEC_COLD_FETCH_DRAIN_PER_RUN/.test(MANIFEST_SRC));
check("...distinct from the universe drain",
  !/SEC_COLD_FETCH_DRAIN_PER_RUN = SEC_REREAD_DRAIN_PER_RUN/.test(readCodeOnly("lib/server/secManifest.ts")),
  "one allowance would let a cold burst starve the earnings-season refresh");
check("...and smaller, so a cold burst starves itself first",
  (() => { const m = readCodeOnly("lib/server/secManifest.ts").match(/SEC_COLD_FETCH_DRAIN_PER_RUN = (\d+)/); return m && Number(m[1]) < 150; })());
check("the priority inversion is named where the constant is",
  /priority inversion/.test(MANIFEST_SRC) && /nobody asked for/.test(MANIFEST_SRC));
check("the ADR overlap is recorded as UNRESOLVED, not assumed",
  /does NOT establish that FPI interim results appear/.test(MANIFEST_SRC) && /OVER-estimate/.test(MANIFEST_SRC),
  "and the direction of the error is named, which is what makes it safe to leave open");

console.log(
  failures === 0
    ? "\nGate behaviour verified against the route itself. Window composition is section 17b's.\n"
    : `\n${failures} assertion(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
