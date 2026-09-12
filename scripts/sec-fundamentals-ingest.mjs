// PHASE 5: pull fundamentals inputs from SEC XBRL, into an artifact.
//
// SCOPE, and it is narrower than "replace the fundamentals columns" on purpose.
// FundamentalsRow is {symbol, marketCap, peRatio, industry, sector, updatedAt}.
// Step 0 already established that industry AND sector are 699/700 covered from the
// union of the two FMP caches and are frozen in the dump, so they are not the
// urgent gap. What SEC uniquely provides is the two INPUTS the site currently buys:
//
//   marketCap = shares outstanding x last price   <- shares from SEC, price from the pool
//   peRatio   = last price / trailing diluted EPS  <- EPS from SEC, price from the pool
//
// So this extracts SHARES OUTSTANDING and TRAILING DILUTED EPS. Price stays local:
// it is already in the price pool, and pairing a fresh price with a filed share
// count is how marketCap is computed today.
//
// SECTOR AND INDUSTRY ARE DELIBERATELY NOT ATTEMPTED. SEC publishes a SIC code and
// description, not GICS sector/industry, and the site's pages are keyed on the
// latter -- /cheap-tech-stocks filters sector = "Technology", which SIC has no
// column for. Mapping SIC to the labels already in use is a taxonomy decision with
// visible consequences for which stocks appear on which page, so it is the owner's
// call, not a silent transformation inside an ingest.
//
// WRITES TO AN ARTIFACT, NOT TO REDIS. The relay's read-only job holds no Upstash
// credential by design, and the repo's Actions secret is the READ-ONLY token
// deliberately. Producing the dataset as a file proves the extraction and defers
// the write-token decision, which is the same shape Step 0 used for the backfill.
//
// PACED INSIDE THIS JOB. The rate limit belongs here and nowhere else: the render
// path must never reach the network after a swap, so there is no shared guard to
// extend. SEC asks for at most 10 requests a second with a declared User-Agent,
// and states that plainly rather than serving a challenge -- so the polite thing
// and the working thing coincide.
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = process.argv[2] || ".";
const SYMBOL_ARG = process.argv[3] ?? process.env.SYMBOLS ?? "";

// SEC's stated ceiling is 10/s. 8/s leaves headroom for the fact that the clock
// is ours and theirs is authoritative.
const REQS_PER_SEC = Number(process.env.SEC_REQS_PER_SEC ?? 8);
const MIN_GAP_MS = Math.ceil(1000 / REQS_PER_SEC);

// A DECLARED, CONTACTABLE User-Agent, which is what SEC's access policy asks for.
// Not a browser string: this IS automation and says so.
const UA =
  process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com)";

// Modelled on DEGRADED_BUILD_FAILURE_RATIO = 0.15 in pickersBuilder. FAIL LOUD is
// the point: fail-open is house style here and it is why the 09-05, 09-07 and
// 09-10 breaches were invisible.
const DEGRADED_FAILURE_RATIO = 0.15;

let lastRequestAt = 0;
async function paced(url, label) {
  const wait = Math.max(0, lastRequestAt + MIN_GAP_MS - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  // THE SAME STRICTNESS THAT CAUGHT STOOQ. A 200 carrying HTML is not data, and
  // parsing it as data is what produced wrong numbers on this site before.
  if (!ct.includes("json")) {
    const head = (await res.text()).slice(0, 200).replace(/\s+/g, " ");
    throw new Error(`${label}: expected JSON, got ${ct} — "${head}"`);
  }
  return res.json();
}

/**
 * TRAILING DILUTED EPS, summed over the four most recent distinct quarters.
 *
 * WHY NOT THE ANNUAL FIGURE. A 10-K EPS is up to twelve months stale, and a P/E
 * built on it misprices exactly the names that just moved -- which are the ones
 * the pickers surface. Four quarters is the standard trailing definition.
 *
 * WHY DISTINCT PERIODS MATTER. companyfacts repeats the same quarter across
 * amended filings and across 10-Q and 10-K frames, so a naive "last four entries"
 * can double-count one quarter and drop another. Keyed by {start,end} and taking
 * the most recently FILED value for each.
 */
function trailingDilutedEps(facts) {
  const node =
    facts?.["us-gaap"]?.EarningsPerShareDiluted ??
    facts?.["us-gaap"]?.EarningsPerShareBasicAndDiluted ??
    null;
  if (!node?.units) return { eps: null, quarters: 0, note: "no diluted EPS concept" };
  const usd = node.units["USD/shares"] ?? node.units["USD/share"] ?? null;
  if (!Array.isArray(usd)) return { eps: null, quarters: 0, note: "no USD/shares unit" };

  const byPeriod = new Map();
  for (const row of usd) {
    if (!row?.start || !row?.end || typeof row.val !== "number") continue;
    const days = (Date.parse(row.end) - Date.parse(row.start)) / 86400000;
    // Quarterly frames only. An annual row (~365d) summed with quarters would
    // count a year twice.
    if (!(days > 60 && days < 120)) continue;
    const key = `${row.start}..${row.end}`;
    const prev = byPeriod.get(key);
    if (!prev || String(row.filed ?? "") > String(prev.filed ?? "")) byPeriod.set(key, row);
  }
  const quarters = [...byPeriod.values()].sort((a, b) => (a.end < b.end ? 1 : -1)).slice(0, 4);
  if (quarters.length < 4) {
    return { eps: null, quarters: quarters.length, note: `only ${quarters.length} distinct quarters` };
  }
  const eps = quarters.reduce((sum, q) => sum + q.val, 0);
  return { eps, quarters: 4, periods: quarters.map((q) => `${q.start}..${q.end}`), note: null };
}

/** Most recently filed common shares outstanding. */
function sharesOutstanding(facts) {
  const candidates = [
    facts?.dei?.EntityCommonStockSharesOutstanding,
    facts?.["us-gaap"]?.CommonStockSharesOutstanding,
  ].filter(Boolean);
  for (const node of candidates) {
    const rows = node?.units?.shares;
    if (!Array.isArray(rows) || !rows.length) continue;
    const best = rows
      .filter((r) => typeof r?.val === "number" && r.val > 0)
      .sort((a, b) => String(b.filed ?? "").localeCompare(String(a.filed ?? "")))[0];
    if (best) return { shares: best.val, asOf: best.end ?? null, filed: best.filed ?? null };
  }
  return { shares: null, asOf: null, filed: null };
}

console.log("PHASE 5 — SEC fundamentals inputs (shares outstanding + trailing diluted EPS)");
console.log(`User-Agent: ${UA}`);
console.log(`pacing: <=${REQS_PER_SEC}/s (min gap ${MIN_GAP_MS}ms) · SEC's stated ceiling is 10/s`);

// ── The CIK map, which every companyfacts URL needs ──────────────────────────
const tickerMap = await paced(
  "https://www.sec.gov/files/company_tickers.json",
  "company_tickers.json"
);
const cikByTicker = new Map();
for (const row of Object.values(tickerMap)) {
  if (!row?.ticker || typeof row.cik_str !== "number") continue;
  // FIRST WINS. The file lists a company once per ticker, but dual-class names
  // appear as separate rows sharing one CIK, and overwriting would not change the
  // CIK -- so order does not matter here, and asserting that is cheaper than
  // wondering later.
  if (!cikByTicker.has(row.ticker)) cikByTicker.set(row.ticker, row.cik_str);
}
console.log(`CIK map: ${cikByTicker.size} tickers`);

// SEC SPELLS CLASS SHARES WITH A DASH TOO -- a fourth convention would have been
// the bad news here, and it is not: the file carries BRK-B, matching FMP's
// screener rather than the repo's hardcoded BRK.B. So the normalisation the
// fundamentals path already needs covers SEC as well, rather than needing its own.
for (const probe of ["BRK-B", "BRK.B", "BF-B", "BF.B"]) {
  console.log(`  spelling probe ${probe.padEnd(6)} ${cikByTicker.has(probe) ? `CIK ${cikByTicker.get(probe)}` : "absent"}`);
}

const symbols = SYMBOL_ARG
  ? SYMBOL_ARG.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
  : ["AAPL", "MSFT", "KO", "XOM", "BRK-B"];
console.log(`\nsymbols requested: ${symbols.length} — ${symbols.join(", ")}`);

const rows = {};
const failures = [];
const started = Date.now();

for (const symbol of symbols) {
  // The dot/dash normalisation, applied here rather than assumed: try the symbol
  // as given, then its dashed form, since the repo's lists carry dots.
  const cik = cikByTicker.get(symbol) ?? cikByTicker.get(symbol.replace(/\./g, "-"));
  if (!cik) {
    failures.push({ symbol, reason: "no CIK in SEC's ticker map" });
    console.log(`  ${symbol.padEnd(7)} SKIP — no CIK`);
    continue;
  }
  const padded = String(cik).padStart(10, "0");
  try {
    const doc = await paced(
      `https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`,
      `companyfacts ${symbol}`
    );
    const shares = sharesOutstanding(doc?.facts);
    const eps = trailingDilutedEps(doc?.facts);
    rows[symbol] = {
      symbol,
      cik,
      entityName: doc?.entityName ?? null,
      sharesOutstanding: shares.shares,
      sharesAsOf: shares.asOf,
      sharesFiled: shares.filed,
      trailingDilutedEps: eps.eps,
      epsQuarters: eps.quarters,
      epsPeriods: eps.periods ?? null,
      epsNote: eps.note,
      // NO RAW FACTS. One companyfacts document is 3.79 MB parsed (AAPL), a third
      // of Upstash's 10 MB per-request ceiling, so storing it would fail any batch
      // write -- and the repo's fail-open handlers would swallow that error.
    };
    console.log(
      `  ${symbol.padEnd(7)} shares ${shares.shares ?? "—"} (as of ${shares.asOf ?? "—"}) · ` +
        `EPS ${eps.eps?.toFixed(2) ?? "—"} over ${eps.quarters}q${eps.note ? ` [${eps.note}]` : ""}`
    );
  } catch (e) {
    failures.push({ symbol, reason: String(e?.message ?? e) });
    console.log(`  ${symbol.padEnd(7)} FAIL — ${String(e?.message ?? e)}`);
  }
}

const elapsed = (Date.now() - started) / 1000;
const attempted = symbols.length;
const ok = Object.keys(rows).length;
const ratio = attempted ? failures.length / attempted : 0;

console.log(`\n══ RESULT ══`);
console.log(`  attempted        ${attempted}`);
console.log(`  extracted        ${ok}`);
console.log(`  failed           ${failures.length}  (${(ratio * 100).toFixed(1)}%)`);
console.log(`  elapsed          ${elapsed.toFixed(1)}s  (${(attempted / Math.max(elapsed, 0.001)).toFixed(1)} req/s effective)`);
const withEps = Object.values(rows).filter((r) => r.trailingDilutedEps != null).length;
const withShares = Object.values(rows).filter((r) => r.sharesOutstanding != null).length;
console.log(`  with shares      ${withShares} of ${ok}`);
console.log(`  with 4q EPS      ${withEps} of ${ok}`);

for (const f of failures) console.log(`  FAILED ${f.symbol}: ${f.reason}`);

const outPath = path.join(OUT_DIR, "SEC-FUNDAMENTALS.json");
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      userAgent: UA,
      reqsPerSec: REQS_PER_SEC,
      attempted,
      extracted: ok,
      failures,
      failureRatio: ratio,
      elapsedSeconds: elapsed,
      rows,
    },
    null,
    2
  )
);
console.log(`\nwrote ${path.relative(process.cwd(), outPath)}`);

// FAIL LOUD. A run that silently produced a third of the dataset is the failure
// mode this repo has shipped before, so the exit code carries the verdict.
if (ratio > DEGRADED_FAILURE_RATIO) {
  console.error(
    `\nDEGRADED: ${(ratio * 100).toFixed(1)}% of symbols failed, over the ` +
      `${(DEGRADED_FAILURE_RATIO * 100).toFixed(0)}% threshold modelled on ` +
      `DEGRADED_BUILD_FAILURE_RATIO. Exiting non-zero so the run is not read as a success.`
  );
  process.exit(1);
}
console.log("\nWITHIN THRESHOLD — dataset usable.");
