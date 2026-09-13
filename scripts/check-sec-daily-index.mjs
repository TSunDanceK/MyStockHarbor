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
   grabFunction(MANIFEST_SRC, "seedManifest"), grabFunction(MANIFEST_SRC, "symbolsByCik"),
   grabFunction(MANIFEST_SRC, "mapChangeThreshold"), grabFunction(MANIFEST_SRC, "reconcileCiks"),
   grabFunction(MANIFEST_SRC, "reconcileDelistings")].join("\n") +
    "\nexport { emptyEntry, emptyManifest, seedManifest, symbolsByCik, mapChangeThreshold, reconcileCiks, reconcileDelistings };",
  "const SEC_SCORE_VERSION = 1;\nconst DELIST_REFRESHES = 3;"
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
  try { parsedTicker = tick.parseTickerFile(rawTicker); } catch (err) { parsedTicker = err.message; }
  check("it parses through the real loader's parser", parsedTicker instanceof Map,
    parsedTicker instanceof Map ? `${parsedTicker.size} tickers` : String(parsedTicker).slice(0, 100));
  if (parsedTicker instanceof Map) {
    const v = tick.validateTickerMap(parsedTicker);
    check("it passes the same validation the refresh applies", v.ok, v.reason ?? `${parsedTicker.size} tickers`);
    check("the five probe symbols resolve",
      ["AAPL", "ARM", "MU", "PLAB", "ASTS"].every((x) => parsedTicker.has(x)),
      ["AAPL", "ARM", "MU", "PLAB", "ASTS"].map((x) => `${x}=${parsedTicker.get(x) ?? "MISSING"}`).join(" "));
    check("CIKs are stored padded to ten digits",
      [...parsedTicker.values()].every((c) => /^\d{10}$/.test(c)));
    // THE FIXTURE IS NO LONGER MERELY SELF-CONSISTENT. It was written with
    // invented CIKs because the file was not in the tree; now that it is, the
    // acceptance window above is asserted against the real mapping, so a wrong
    // CIK in the fixture can no longer make the test pass for the wrong reason.
    const fixtureMismatch = [...FIXTURE_CIK.entries()].filter(([sym, cik]) => parsedTicker.get(sym) !== cik);
    check("the acceptance fixture's CIKs match the committed file exactly",
      fixtureMismatch.length === 0,
      fixtureMismatch.length ? fixtureMismatch.map(([s, c]) => `${s}: fixture ${c} vs real ${parsedTicker.get(s)}`).join(" | ") : "all five");
  }
}

// ── 8. The ticker map is a seed and fallback, not the source of truth ───────
console.log("\n8. Ticker map refresh");
const bigMap = (extra = {}) => {
  const m = new Map();
  for (let i = 0; i < 6000; i++) m.set(`T${i}`, String(i).padStart(10, "0"));
  for (const t of ["AAPL", "MU", "PLAB"]) m.set(t, "0000000001");
  for (const [k, v] of Object.entries(extra)) m.set(k, v);
  return m;
};
check("a full map validates", tick.validateTickerMap(bigMap()).ok);
check("a SHORT payload is rejected, not adopted", tick.validateTickerMap(new Map([["AAPL", "1"]])).ok === false,
  tick.validateTickerMap(new Map([["AAPL", "1"]])).reason);
const noSentinel = bigMap();
noSentinel.delete("AAPL");
check("a map missing a sentinel ticker is rejected", tick.validateTickerMap(noSentinel).ok === false,
  tick.validateTickerMap(noSentinel).reason);
check("rejection happens BEFORE any invalidation could be computed from it",
  /validateTickerMap/.test(TICKER_SRC) && TICKER_SRC.indexOf("const valid = validateTickerMap(map)") < TICKER_SRC.indexOf("lastChangedAt: base.contentChanged"),
  "a truncated payload would otherwise read as thousands of symbols changing CIK");
check("the same mapping hashes the same regardless of insertion order",
  tick.hashTickerMap(new Map([["A", "1"], ["B", "2"]])) === tick.hashTickerMap(new Map([["B", "2"], ["A", "1"]])));
check("a changed mapping hashes differently",
  tick.hashTickerMap(new Map([["A", "1"]])) !== tick.hashTickerMap(new Map([["A", "2"]])));
check("CIKs are padded to ten digits", tick.padCik(320193) === "0000320193" && tick.padCik("0000320193") === "0000320193");
check("the refresh records which source answered", /source: "redis"/.test(TICKER_SRC) && /"committed-file"/.test(TICKER_SRC));
check("Last-Modified is stored so the real change cadence is measurable",
  /lastModified/.test(TICKER_SRC) && /lastChangedAt/.test(TICKER_SRC));
check("a 304 is treated as unchanged rather than as a failure", /notModified/.test(TICKER_SRC));

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
moved.set("PLAB", "0009999999"); // reassigned
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

// Absence is not reassignment.
const gapMan = man.emptyManifest();
man.seedManifest(gapMan, ["AAPL", "PLAB"], FIXTURE_CIK, true);
gapMan.symbols.PLAB.contentHash = "keepme";
const gapRes = man.reconcileCiks(gapMan, new Map([["AAPL", "0000320193"]]));
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
const spikeCik = new Map(spikeSyms.map((s, i) => [s, String(i).padStart(10, "0")]));
const spikeMan = man.emptyManifest();
man.seedManifest(spikeMan, spikeSyms, spikeCik, true);
for (const s of spikeSyms) spikeMan.symbols[s].contentHash = "precious";
// Every symbol's CIK moves at once -- the shape of a changed map source.
const shifted = new Map(spikeSyms.map((s, i) => [s, String(i + 500000).padStart(10, "0")]));
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
    const base = new Map(syms.map((s, i) => [s, String(i).padStart(10, "0")]));
    const m2 = man.emptyManifest();
    man.seedManifest(m2, syms, base, true);
    const next = new Map(base);
    for (let i = 0; i < 7; i++) next.set(`X${i}`, String(i + 900000).padStart(10, "0"));
    return man.reconcileCiks(m2, next).applied === true;
  })(),
  "7 of 700 is the threshold; a real reassignment must not be blocked");

// ── 10b. Absence is a probable delisting, not a reassignment ────────────────
console.log("\n10b. Delisting");
const dl = (syms) => {
  const m = man.emptyManifest();
  const cik = new Map(syms.map((x, i) => [x, String(i).padStart(10, "0")]));
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
check("the ticker map is reconciled BEFORE the index is intersected",
  routeCode.indexOf(": reconcileCiks(manifest, tickers.map)") < routeCode.indexOf("= symbolsByCik(manifest)"),
  "a symbol whose CIK moved must match on the new CIK the same run, not a day later");
check("the ticker map is resolved before it is reconciled against",
  routeCode.indexOf("= await resolveTickerMap()") < routeCode.indexOf(": reconcileCiks(manifest, tickers.map)"));
check("fact sets are discarded only when the changes were APPLIED",
  /cikChanges\?\.applied && cikChanges\.changes\.length/.test(routeCode));
check("a suspected map shape change makes the run NOT ok",
  /suspectedMapShapeChange \?\? false\)/.test(routeCode));
check("delisting is gated on a SUCCESSFUL REFRESH, not on every run",
  /refreshSucceeded && tickers\.source === "redis"/.test(routeCode),
  "counted per refresh; counting per run would delist after three days rather than three weeks");
check("a suspected partial map also makes the run NOT ok",
  /suspectedPartialMap \?\? false\)/.test(routeCode));
check("the Redis budget is stated as three, not still claiming two",
  /redisCommands: dryRun \? 2 : 3/.test(routeCode), "manifest GET + tickers GET + manifest SET");

console.log(
  failures === 0
    ? "\nThe change detector reproduces the measured window.\n"
    : `\n${failures} assertion(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
