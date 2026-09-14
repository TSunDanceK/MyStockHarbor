// CAPTURE THE REAL FILINGS FOR A DATE WINDOW, so a check can replay them.
//
// WHY THIS EXISTS. scripts/check-sec-daily-index.mjs §17 claimed to reproduce
// the 20260908-11 window. It did not. It built 281 synthetic symbols and handed
// the first 127 forms from a modulo-5 round robin:
//
//     ["10-Q", "10-K", "6-K", "8-K", "20-F"][i % 5]
//
// That yields exactly 77 periodic-report and 50 unconfirmed -- not because
// EDGAR looks like that, but because three of those five forms are periodic and
// two are not. The live route over the same window returns
// { unconfirmed: 119, periodic-report: 6, amendment: 2 }, which is what a real
// week looks like: 6-K dominates, and the repo's own measurement says so
// ("6-K is 89% of the periodic signal"). The totals agreed only because 281 and
// 127 were typed in as loop bounds.
//
// A fixture reverse-engineered from the answer cannot test the thing that
// produced the answer. Step 3 dispatches on reverifyReason, and §17 is the check
// asserting that field is right, so the fixture has to be real filings.
//
// WHY IT RUNS ON A RUNNER. The agent sandbox is refused www.sec.gov with
// 403 CONNECT. Read-only: no credential, no Redis, no write- prefix.
//
// EVERYTHING IS LIFTED FROM THE SHIPPED MODULES -- parseDailyIndex,
// accessionFrom, isAmendment, dailyIndexUrl, intersect, symbolsByCik,
// parseTickerFile. Nothing here reimplements a parser. A capture script with its
// own index parser would produce a fixture that agrees with itself and with
// nothing else.
import fs from "node:fs";
import path from "node:path";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

const UA =
  process.env.PROBE_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; window fixture capture)";
const FROM = process.env.WINDOW_FROM ?? "20260908";
const TO = process.env.WINDOW_TO ?? "20260911";
const OUT = process.env.FIXTURE_OUT ?? "data/sec/window-fixture.json";
const DIR = path.resolve(process.argv[2] ?? "step0-dump");

if (!/^\d{8}$/.test(FROM) || !/^\d{8}$/.test(TO) || FROM > TO) {
  console.error(`FATAL: bad window ${FROM}..${TO}. Expected YYYYMMDD, from <= to.`);
  process.exit(2);
}

const idxSrc = readCodeOnly("lib/server/secDailyIndex.ts");
const manSrc = readCodeOnly("lib/server/secManifest.ts");
const tickSrc = readCodeOnly("lib/server/secTickerMap.ts");
const sec = await lift(
  [
    grabFunction(idxSrc, "accessionFrom"),
    grabFunction(idxSrc, "isAmendment"),
    grabFunction(idxSrc, "dailyIndexUrl"),
    grabFunction(idxSrc, "parseDailyIndex"),
    grabFunction(idxSrc, "intersect"),
    grabFunction(idxSrc, "looksLikeMissingIndex"),
    grabFunction(idxSrc, "addDays"),
    grabFunction(manSrc, "symbolsByCik"),
    grabFunction(tickSrc, "padCik"),
    grabFunction(tickSrc, "parseTickerFile"),
  ].join("\n") +
    "\nexport { accessionFrom, isAmendment, dailyIndexUrl, parseDailyIndex, intersect, " +
    "looksLikeMissingIndex, addDays, symbolsByCik, parseTickerFile };"
);

console.log(`SEC WINDOW FIXTURE — ${FROM}..${TO}`);

// ── The universe ─────────────────────────────────────────────────────────────
// SYMBOLS wins; otherwise the frozen dump. The LIVE run intersected against the
// live manifest universe, so a dump-sourced universe can differ by a few
// symbols. That difference is REPORTED, never smoothed over: if the capture's
// matched-symbol count does not equal the live run's, the fixture describes a
// slightly different set and the check must say so rather than assert a number
// it did not produce.
const supplied = (process.env.SYMBOLS ?? "").split(/[,\s]+/).filter(Boolean).map((s) => s.toUpperCase());
let universe;
if (supplied.length) {
  universe = [...new Set(supplied)];
  console.log(`universe: SYMBOLS env — ${universe.length} symbols (the live set)`);
} else {
  const p = path.join(DIR, "universe.json");
  if (!fs.existsSync(p)) {
    console.error(`FATAL: no universe.json in ${DIR} and no SYMBOLS given.`);
    process.exit(2);
  }
  universe = [...new Set((JSON.parse(fs.readFileSync(p, "utf8"))?.pickersSymbolsKey ?? []).map(String))];
  console.log(`universe: ${DIR}/universe.json — ${universe.length} symbols (FROZEN dump)`);
}

// ── ticker -> CIK, through the shipped parser ────────────────────────────────
const tickRes = await fetch("https://www.sec.gov/files/company_tickers_exchange.json", {
  headers: { "User-Agent": UA },
});
if (!tickRes.ok) {
  console.error(`FATAL: ticker file HTTP ${tickRes.status}`);
  process.exit(2);
}
const { map: tickerMap, shape } = sec.parseTickerFile(await tickRes.text());
console.log(`ticker map: ${tickerMap.size} tickers, shape "${shape}"`);

// symbolsByCik takes a MANIFEST, so it is given one rather than having its
// padded/unpadded registration rule copied out of it.
const pseudoManifest = { symbols: {} };
let noCik = 0;
for (const s of universe) {
  const hit = tickerMap.get(s) ?? tickerMap.get(s.replace(/\./g, "-")) ?? tickerMap.get(s.replace(/-/g, "."));
  if (!hit) {
    noCik++;
    continue;
  }
  pseudoManifest.symbols[s] = { cik: hit.cik };
}
const bySymbolCik = sec.symbolsByCik(pseudoManifest);
console.log(`resolved: ${Object.keys(pseudoManifest.symbols).length} with a CIK, ${noCik} without`);

// ── Walk the window ──────────────────────────────────────────────────────────
const days = [];
const filings = [];
let totalDataRows = 0;
let totalMalformed = 0;
for (let d = FROM; d <= TO; d = sec.addDays(d, 1)) {
  const url = sec.dailyIndexUrl(d);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  const body = await res.text();
  if (!res.ok || sec.looksLikeMissingIndex(res.status, body)) {
    days.push({ date: d, outcome: "absent", status: res.status });
    console.log(`  ${d}  absent (HTTP ${res.status})`);
    continue;
  }
  const parsed = sec.parseDailyIndex(body);
  const matched = sec.intersect(parsed.rows, bySymbolCik);
  totalDataRows += parsed.dataRows;
  totalMalformed += parsed.malformedRows;
  days.push({
    date: d,
    outcome: "parsed",
    dataRows: parsed.dataRows,
    malformedRows: parsed.malformedRows,
    matched: matched.length,
  });
  console.log(`  ${d}  parsed ${parsed.dataRows} rows, ${parsed.malformedRows} malformed, ${matched.length} matched`);
  for (const f of matched) filings.push(f);
  // SEC asks for <= 10 req/s. Four days is four requests; the pause is courtesy.
  await new Promise((r) => setTimeout(r, 150));
}

const symbols = new Set(filings.map((f) => f.symbol));
console.log(`\ntotal: ${totalDataRows} index rows, ${totalMalformed} malformed, ${filings.length} matched filings, ${symbols.size} distinct symbols`);

// A form histogram, so the fixture's shape is visible without replaying it.
const formHist = {};
for (const f of filings) formHist[f.form] = (formHist[f.form] ?? 0) + 1;
const topForms = Object.entries(formHist).sort((a, b) => b[1] - a[1]).slice(0, 15);
console.log("\ntop forms in the window:");
for (const [form, n] of topForms) console.log(`  ${String(n).padStart(5)}  ${form}`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(
  OUT,
  JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      window: { from: FROM, to: TO },
      universeSource: supplied.length ? "SYMBOLS env (live set)" : `${DIR}/universe.json (frozen dump)`,
      universeSize: universe.length,
      resolvedWithCik: Object.keys(pseudoManifest.symbols).length,
      days,
      totals: {
        indexRows: totalDataRows,
        malformedRows: totalMalformed,
        matchedFilings: filings.length,
        distinctSymbols: symbols.size,
      },
      formHistogram: formHist,
      // The rows exactly as applyFilings consumes them.
      filings,
    },
    null,
    2
  )
);
console.log(`\nwrote ${OUT} — ${filings.length} real filing rows, ready for applyFilings.`);
