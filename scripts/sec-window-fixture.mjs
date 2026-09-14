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
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";
import { emitPayload } from "./lib/relay-capture.mjs";

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
    // TRANSITIVE CALLEES, AND THEY ARE NOT OPTIONAL. grabFunction lifts ONE
    // function body; it does not follow calls. dailyIndexUrl calls quarterOf and
    // addDays calls toYyyymmdd, and omitting either fails at RUN time with a
    // ReferenceError -- after the fetches have started, on a runner, minutes
    // later. The smoke test below exists because of exactly that.
    grabFunction(idxSrc, "quarterOf"),
    grabFunction(idxSrc, "toYyyymmdd"),
    grabFunction(idxSrc, "dailyIndexUrl"),
    grabFunction(idxSrc, "parseDailyIndex"),
    grabFunction(idxSrc, "intersect"),
    grabFunction(idxSrc, "looksLikeMissingIndex"),
    grabFunction(idxSrc, "addDays"),
    grabFunction(manSrc, "symbolsByCik"),
    grabFunction(tickSrc, "padCik"),
    grabFunction(tickSrc, "parseTickerFile"),
  ].join("\n") +
    "\nexport { accessionFrom, isAmendment, quarterOf, toYyyymmdd, dailyIndexUrl, " +
    "parseDailyIndex, intersect, looksLikeMissingIndex, addDays, symbolsByCik, parseTickerFile };"
);

// SMOKE-TEST THE LIFT BEFORE TOUCHING THE NETWORK.
//
// A lifted module can be missing a transitive callee and still import cleanly --
// the ReferenceError only fires when that line executes. Without this, the first
// dispatch spent a runner, a dump download and a compiler install to discover
// that dailyIndexUrl could not build a URL. These calls are pure and cost
// nothing, so the failure happens in the first second instead of the third
// minute.
{
  const failures = [];
  const expectUrl = `https://www.sec.gov/Archives/edgar/daily-index/2026/QTR3/master.20260908.idx`;
  try {
    const got = sec.dailyIndexUrl("20260908");
    if (got !== expectUrl) failures.push(`dailyIndexUrl -> ${got}`);
  } catch (e) {
    failures.push(`dailyIndexUrl threw: ${String(e?.message ?? e)}`);
  }
  try {
    if (sec.addDays("20260911", 1) !== "20260912") failures.push("addDays");
  } catch (e) {
    failures.push(`addDays threw: ${String(e?.message ?? e)}`);
  }
  try {
    if (sec.isAmendment("4/A") !== true || sec.isAmendment("10-Q") !== false) failures.push("isAmendment");
    if (sec.accessionFrom("edgar/data/1/0000320193-26-000001.txt") !== "0000320193-26-000001")
      failures.push("accessionFrom");
  } catch (e) {
    failures.push(`form helpers threw: ${String(e?.message ?? e)}`);
  }
  if (failures.length) {
    console.error(`FATAL: the lifted module is incomplete or wrong — ${failures.join("; ")}`);
    console.error("A transitive callee is probably missing: grabFunction lifts one body and does not follow calls.");
    process.exit(2);
  }
  console.log("lift smoke test: ok");
}

console.log(`SEC WINDOW FIXTURE — ${FROM}..${TO}`);

// ── The universe ─────────────────────────────────────────────────────────────
//
// THERE IS NO OVERRIDE INPUT, AND THAT IS A DELIBERATE REMOVAL.
//
// It was first on SYMBOLS, which relay-capture.mjs claims as the payload
// SELECTOR -- so asking for the payload would have replaced the universe with
// the string "window-fixture". Moving it to PAYERS looked safe and was worse:
// relay.yml DEFAULTS that input to "KO,XOM,T". Run 34831201608 therefore
// captured a universe of three symbols, matched two filings, wrote a
// well-formed fixture and exited 0 -- exactly the silent substitution the move
// was meant to prevent.
//
// EVERY input relay.yml forwards carries a default, so no forwarded input can
// mean "the caller did not ask". The universe comes from the dump and nowhere
// else. A live-universe run, if ever needed, needs its own unambiguous input.
//
// The live run intersected the LIVE manifest universe and this intersects the
// frozen dump's, so the two differ by a few symbols. That is reported, never
// smoothed: a check must not assert a count this capture did not produce.
const uniPath = path.join(DIR, "universe.json");
if (!fs.existsSync(uniPath)) {
  console.error(`FATAL: no universe.json in ${DIR}.`);
  process.exit(2);
}
const universe = [...new Set((JSON.parse(fs.readFileSync(uniPath, "utf8"))?.pickersSymbolsKey ?? []).map(String))];
console.log(`universe: ${DIR}/universe.json — ${universe.length} symbols (FROZEN dump)`);

// A FLOOR, BECAUSE THE FAILURE ABOVE EXITED 0.
//
// A capture over a handful of symbols produces a small, well-formed, useless
// fixture that nothing downstream can distinguish from a quiet week. The dump's
// analysis universe is ~700, so anything under 100 means it was substituted,
// truncated, or read from the wrong key -- not that the market was quiet.
const UNIVERSE_FLOOR = 100;
if (universe.length < UNIVERSE_FLOOR) {
  console.error(
    `FATAL: universe is ${universe.length} symbols, under the floor of ${UNIVERSE_FLOOR}. ` +
      `The dump's analysis universe is ~700, so this is a substituted or truncated universe, ` +
      `not a small one. Refusing to write a fixture that would look valid.`
  );
  process.exit(2);
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
      universeSource: `${DIR}/universe.json (frozen dump)`,
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

// ── GET IT BACK INTO THE REPO ────────────────────────────────────────────────
// The artifact this job uploads is for a human with a browser: the download API
// redirects to *.blob.core.windows.net, which the agent sandbox refuses with
// 403 CONNECT (re-confirmed today, after relay-capture.mjs had already recorded
// it). stdout is the only route back, so the payload is emitted LAST, byte
// accounted, in the compact one-line-per-filing form applyFilings needs.
const compact = filings.map((f) => `${f.symbol}|${f.form}|${f.filed}|${f.accession}`).join("\n");
console.log(
  `\npayload sha256: ${crypto.createHash("sha256").update(compact, "utf8").digest("hex")}  ` +
    `(${filings.length} lines) — verify after reassembly, because a payload short by its ` +
    `last rows still parses`
);
emitPayload("window-fixture", compact);
