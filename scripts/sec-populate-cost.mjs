// What one symbol actually COSTS to populate, so the per-run allowance is sized
// against a measurement rather than a guess.
//
// WHY THIS EXISTS. SEC_POPULATE_PER_RUN was set to 40 from the wire estimate in
// the brief -- "~150 KB typical, AAPL's is ~10 MB" -- and 40 once a day against
// 754 CIK-bearing symbols is NINETEEN DAYS of "not loaded yet" across the site.
// SEC allows 10 requests a SECOND with no daily cap, so the allowance may be an
// order of magnitude below the binding constraint. May be: the estimate it came
// from was never measured end to end, and the answer decides whether the page
// ships before or after a drain.
//
// MEASURES WHAT THE JOB DOES, IN THE ORDER THE JOB DOES IT: fetch companyfacts,
// parse, extract, encode a fact set. Sequential and paced exactly as the route
// paces it, because a concurrent measurement would describe a job that does not
// exist.
//
// THREE CONSTRAINTS, AND THE SMALLEST ONE WINS:
//   1. maxDuration    300s per invocation.
//   2. SEC's rate     10 req/s stated; the route paces at 8.
//   3. REDIS WRITES   one SET per CHANGED symbol. Writes are already 76% of the
//                     command count on this account, so a large allowance is a
//                     recurring bill, not just a longer run. Reported, because
//                     it is the constraint the other two do not show.
//
//   node scripts/sec-populate-cost.mjs <dumpDir>
import fs from "node:fs";
import path from "node:path";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";
import { lookupBySpelling } from "./lib/symbol-spellings.mjs";

const DIR = path.resolve(process.argv[2] ?? "step0-dump");
const SAMPLE = Number(process.env.SAMPLE ?? 40);
const UA =
  process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; populate cost probe)";

// The route's own pacing constant, read from the route rather than retyped.
const ROUTE = readCodeOnly("app/api/jobs/sec-facts/route.ts");
const MIN_GAP_MS = Number((ROUTE.match(/MIN_GAP_MS = (\d+)/) ?? [])[1] ?? 125);
const MAX_DURATION = Number((ROUTE.match(/maxDuration = (\d+)/) ?? [])[1] ?? 300);
const CURRENT_POPULATE = Number((ROUTE.match(/SEC_POPULATE_PER_RUN = (\d+)/) ?? [])[1] ?? 0);
const CURRENT_REVERIFY = Number((ROUTE.match(/SEC_REVERIFY_PER_RUN = (\d+)/) ?? [])[1] ?? 0);
console.log(
  `route constants: MIN_GAP_MS=${MIN_GAP_MS} maxDuration=${MAX_DURATION}s ` +
    `populate=${CURRENT_POPULATE}/run reverify=${CURRENT_REVERIFY}/run`
);

const strip = (f) =>
  fs.readFileSync(f, "utf8")
    .replace(/^import[\s\S]*?from\s*"\.\/[^"]+";$/gm, "")
    .replace(/^export \* from "\.\/[^"]+";$/gm, "");
const sec = await lift(
  [
    fs.readFileSync("lib/server/secFields.ts", "utf8"),
    strip("lib/server/secExtract.ts"),
    strip("lib/server/fxRates.ts"),
    strip("lib/server/secCurrency.ts"),
    strip("lib/server/secFactCodec.ts"),
  ].join("\n")
);
const tickSrc = readCodeOnly("lib/server/secTickerMap.ts");
const tick = await lift(
  [grabFunction(tickSrc, "padCik"), grabFunction(tickSrc, "parseTickerFile")].join("\n") +
    "\nexport { parseTickerFile };"
);

// A REAL SAMPLE, NOT THE FIVE PROBE SYMBOLS. Those are four semiconductor names
// and a satellite company; their filings are not the universe's size
// distribution, and the allowance has to survive the universe.
const { map } = tick.parseTickerFile(fs.readFileSync("data/sec/company-tickers.json", "utf8"));
// `dumpUniverse` IS THE KEY, and the first run guessed `symbols` and got zero.
// The FATAL floor below is what turned that into a two-minute failure instead
// of a plausible-looking measurement over three symbols -- the same guard that
// caught the PAYERS default on the window fixture.
const universe = JSON.parse(fs.readFileSync(path.join(DIR, "universe.json"), "utf8"));
const symbols = (universe.dumpUniverse ?? []).map(String);
if (symbols.length < 100) {
  console.error(
    `FATAL: universe.json yielded ${symbols.length} symbols. Keys present: ` +
      `${Object.keys(universe).join(", ")}`
  );
  process.exit(2);
}
// THROUGH THE SPELLING HELPER, because the universe writes BRK.B and the ticker
// file writes BRK-B -- the exact defect this session fixed in seedManifest. A
// probe that measured only the symbols a plain get() happens to resolve would
// quietly exclude every dual-class name from the sample.
const cikOf = (s) => lookupBySpelling(map, s)?.value?.cik ?? null;
const withCik = symbols.filter((s) => cikOf(s));
if (withCik.length < 100) {
  console.error(`FATAL: only ${withCik.length} of ${symbols.length} symbols resolved a CIK — the map is wrong.`);
  process.exit(2);
}
// Evenly spaced through the sorted universe rather than the first N: the first
// N alphabetically is not a size sample, it is a sample of companies whose
// names begin with A.
const step = Math.max(1, Math.floor(withCik.length / SAMPLE));
const picked = withCik.sort().filter((_, i) => i % step === 0).slice(0, SAMPLE);
console.log(`universe ${symbols.length}, with CIK ${withCik.length}, sampling ${picked.length} evenly spaced\n`);

let lastAt = 0;
const rows = [];
for (const symbol of picked) {
  const wait = Math.max(0, lastAt + MIN_GAP_MS - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const cik = cikOf(symbol);
  const t0 = Date.now();
  try {
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
      headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" },
    });
    if (!res.ok) { rows.push({ symbol, error: `HTTP ${res.status}` }); continue; }
    const text = await res.text();
    const tFetch = Date.now() - t0;
    const t1 = Date.now();
    const facts = JSON.parse(text);
    const out = sec.extractCompanyFacts(symbol, facts);
    const stored = sec.encodeFactSet(out);
    const tWork = Date.now() - t1;
    rows.push({
      symbol, bytes: text.length, tFetch, tWork, total: tFetch + tWork,
      stored: JSON.stringify(stored).length,
      quarters: out.quarters.length, instants: out.instants.length,
    });
  } catch (err) {
    rows.push({ symbol, error: String(err?.message ?? err) });
  }
}

const ok = rows.filter((r) => !r.error);
const failed = rows.filter((r) => r.error);
const pct = (arr, p) => arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))];
const totals = ok.map((r) => r.total);
const bytes = ok.map((r) => r.bytes);
const storedSizes = ok.map((r) => r.stored);

console.log(`${"symbol".padEnd(8)}${"wire".padStart(10)}${"fetch".padStart(8)}${"work".padStart(7)}${"total".padStart(8)}${"stored".padStart(9)}  q/i`);
for (const r of rows) {
  if (r.error) { console.log(`${r.symbol.padEnd(8)}  ERROR ${r.error}`); continue; }
  console.log(
    `${r.symbol.padEnd(8)}${(r.bytes / 1024).toFixed(0).padStart(8)}KB${String(r.tFetch).padStart(7)}ms${String(r.tWork).padStart(6)}ms${String(r.total).padStart(7)}ms${(r.stored / 1024).toFixed(1).padStart(7)}KB  ${r.quarters}/${r.instants}`
  );
}

const sum = totals.reduce((a, b) => a + b, 0);
const mean = sum / ok.length;
console.log(`\nfetched ${ok.length}, failed ${failed.length}`);
console.log(`wire   p50 ${(pct(bytes, 0.5) / 1024).toFixed(0)}KB  p90 ${(pct(bytes, 0.9) / 1024).toFixed(0)}KB  max ${(Math.max(...bytes) / 1024 / 1024).toFixed(1)}MB  total ${(bytes.reduce((a, b) => a + b, 0) / 1024 / 1024).toFixed(1)}MB`);
console.log(`time   p50 ${pct(totals, 0.5)}ms  p90 ${pct(totals, 0.9)}ms  max ${Math.max(...totals)}ms  mean ${mean.toFixed(0)}ms`);
console.log(`stored p50 ${(pct(storedSizes, 0.5) / 1024).toFixed(1)}KB  p90 ${(pct(storedSizes, 0.9) / 1024).toFixed(1)}KB  max ${(Math.max(...storedSizes) / 1024).toFixed(1)}KB`);

// THE ANSWER, DERIVED RATHER THAN ASSERTED. Each constraint is stated with the
// number it comes from, so raising the allowance later means re-reading this
// rather than re-arguing it.
const perSymbol = Math.max(mean, MIN_GAP_MS);
const byDuration = Math.floor((MAX_DURATION * 0.8 * 1000) / perSymbol);
const byRate = Math.floor((MAX_DURATION * 0.8) * (1000 / MIN_GAP_MS));
console.log(`\nCEILINGS, at a 20% safety margin on the ${MAX_DURATION}s budget:`);
console.log(`  by wall time   ${byDuration} symbols/run   (${perSymbol.toFixed(0)}ms each, mean; the pace gap is ${MIN_GAP_MS}ms)`);
console.log(`  by SEC's rate  ${byRate} symbols/run   (the route's own ${(1000 / MIN_GAP_MS).toFixed(1)} req/s)`);
console.log(`  BINDING        ${Math.min(byDuration, byRate)} symbols/run`);
const universeSize = withCik.length;
for (const n of [CURRENT_POPULATE, 100, 200, Math.min(byDuration, byRate)]) {
  if (!n) continue;
  console.log(`  at ${String(n).padStart(4)}/run: ${(universeSize / n).toFixed(1)} days to drain ${universeSize} symbols, ${n} Redis SETs/run worst case`);
}
console.log(
  `\nREDIS IS THE CONSTRAINT THE OTHER TWO DO NOT SHOW: one SET per CHANGED symbol.\n` +
  `Only the FIRST pass writes every symbol; after that a set is rewritten only when\n` +
  `its contentHash moves, which is a filing event. So the write cost is a one-off\n` +
  `${universeSize} SETs spread over the drain, then roughly the daily filing count.`
);
