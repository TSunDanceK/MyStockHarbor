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
    // DIAGNOSTICS, NOT JUST A COUNT. XOM came back with "only 2 distinct quarters"
    // and that is a symptom with several possible causes -- rows without start/end,
    // annual-only reporting, or a day-window that is too tight. Reporting how many
    // rows existed and how many survived each filter turns the next investigation
    // into reading a number instead of re-deriving it.
    const withPeriod = usd.filter((r) => r?.start && r?.end && typeof r.val === "number").length;
    return {
      eps: null,
      quarters: quarters.length,
      note:
        `only ${quarters.length} distinct quarters — ${usd.length} rows in the unit, ` +
        `${withPeriod} with start+end, ${byPeriod.size} in a 60-120 day frame`,
    };
  }
  const eps = quarters.reduce((sum, q) => sum + q.val, 0);
  return { eps, quarters: 4, periods: quarters.map((q) => `${q.start}..${q.end}`), note: null };
}

/**
 * Most recently filed common shares outstanding — with the two ways this silently
 * produces a WRONG NUMBER rather than no number, both found by running it.
 *
 * THE FIRST RUN RETURNED 941,481 SHARES FOR BRK.B, AS OF 2011-04-29. Berkshire
 * class B has roughly 1.3 billion; 941,481 is a Class A-shaped figure fifteen
 * years stale. It was not reported as a failure — the fetch succeeded, so the run
 * printed "WITHIN THRESHOLD — dataset usable" while carrying a number that would
 * have put a mega-cap's marketCap out by three orders of magnitude. A threshold
 * that counts FETCH success and calls that data quality is the fail-open shape
 * this repo keeps shipping.
 *
 * MULTI-CLASS FILERS ARE AMBIGUOUS, NOT MERELY AWKWARD. companyfacts flattens
 * each class into its own row, so a dual-class company yields several rows sharing
 * one `end` date with different `val`s, and nothing in the row says which class it
 * is. Picking the newest by `filed` therefore picks a class at random. There is no
 * safe guess, so this REFUSES rather than choosing: an ambiguous symbol is a
 * failure with a stated reason, which a human can act on, instead of a plausible
 * number nobody re-checks.
 *
 * STALENESS IS THE SECOND GUARD, and it is independent. A share count from 2011 is
 * wrong even when it is unambiguous, and a company that stopped filing is exactly
 * the case where the newest row is old.
 */
const MAX_SHARES_AGE_DAYS = Number(process.env.SEC_MAX_SHARES_AGE_DAYS ?? 400);

function sharesOutstanding(facts) {
  const candidates = [
    ["dei:EntityCommonStockSharesOutstanding", facts?.dei?.EntityCommonStockSharesOutstanding],
    ["us-gaap:CommonStockSharesOutstanding", facts?.["us-gaap"]?.CommonStockSharesOutstanding],
  ].filter(([, node]) => node);

  for (const [concept, node] of candidates) {
    const rows = (node?.units?.shares ?? []).filter(
      (r) => typeof r?.val === "number" && r.val > 0 && r.end
    );
    if (!rows.length) continue;

    const newestEnd = rows.map((r) => r.end).sort().at(-1);
    const atNewest = rows.filter((r) => r.end === newestEnd);
    const distinctVals = new Set(atNewest.map((r) => r.val));

    if (distinctVals.size > 1) {
      return {
        shares: null,
        asOf: newestEnd,
        concept,
        reject: `multi-class: ${distinctVals.size} different share counts share end=${newestEnd} ` +
          `(${[...distinctVals].join(", ")}) — companyfacts does not say which class, so any pick is a guess`,
      };
    }

    const best = atNewest.sort((a, b) => String(b.filed ?? "").localeCompare(String(a.filed ?? "")))[0];
    const ageDays = (Date.now() - Date.parse(best.end)) / 86400000;
    if (Number.isFinite(ageDays) && ageDays > MAX_SHARES_AGE_DAYS) {
      return {
        shares: null,
        asOf: best.end,
        concept,
        reject: `stale: share count as of ${best.end} is ${Math.round(ageDays)} days old ` +
          `(limit ${MAX_SHARES_AGE_DAYS})`,
      };
    }
    return { shares: best.val, asOf: best.end, filed: best.filed ?? null, concept, reject: null };
  }
  return { shares: null, asOf: null, concept: null, reject: "no shares-outstanding concept found" };
}

// ── THE CROSS-CHECK, and why the frozen dump is the right yardstick ──────────
// The multi-class and staleness guards above are structural: they catch the two
// ways the extraction is KNOWN to go wrong. A magnitude check catches the ways it
// is not yet known to go wrong, which is the category BRK.B fell into before it
// was diagnosed.
//
// The frozen dump holds FMP's marketCap per symbol and the cached daily series.
// shares x last close should land near FMP's figure; an order-of-magnitude
// disagreement means the share count is a different class, a different unit, or a
// different company. Per the standing rule, the frozen bars are ground truth for
// COMPARISON, not for CORRECTNESS -- so a mismatch is reported as "these two
// disagree and the SEC value is not safe to use unreviewed", never as "FMP is
// right and SEC is wrong".
const MAGNITUDE_LOW = Number(process.env.SEC_XCHECK_LOW ?? 0.5);
const MAGNITUDE_HIGH = Number(process.env.SEC_XCHECK_HIGH ?? 2);

function loadFrozen(dir) {
  const out = { marketCap: new Map(), lastClose: new Map(), available: false };
  try {
    const fundPath = path.join(dir, "fundamentals.json");
    if (fs.existsSync(fundPath)) {
      const vals = JSON.parse(fs.readFileSync(fundPath, "utf8"))?.values ?? {};
      for (const [sym, row] of Object.entries(vals)) {
        if (typeof row?.marketCap === "number" && row.marketCap > 0) out.marketCap.set(sym, row.marketCap);
      }
      out.available = out.marketCap.size > 0;
    }
  } catch (e) {
    console.log(`  (frozen fundamentals unreadable: ${String(e?.message ?? e)})`);
  }
  return out;
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

const frozen = loadFrozen(OUT_DIR);
console.log(
  frozen.available
    ? `\ncross-check: ${frozen.marketCap.size} frozen FMP marketCap values available`
    : `\ncross-check: UNAVAILABLE — no frozen fundamentals in ${OUT_DIR}. The magnitude ` +
      `guard cannot run, and that is reported per symbol rather than passing silently.`
);

// Last close per symbol, read out of the frozen series rather than fetched.
const lastClose = new Map();
{
  const barsPath = path.join(OUT_DIR, "history-bars.ndjson.gz");
  if (fs.existsSync(barsPath)) {
    const zlib = await import("node:zlib");
    const readline = await import("node:readline");
    const want = new Set(
      (SYMBOL_ARG ? SYMBOL_ARG.split(",") : []).map((x) => x.trim().toUpperCase()).filter(Boolean)
    );
    const rl = readline.createInterface({
      input: fs.createReadStream(barsPath).pipe(zlib.createGunzip()),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (row?._meta || !row?.symbol) continue;
        const sym = String(row.symbol);
        if (want.size && !want.has(sym)) continue;
        const daily = Array.isArray(row?.entry?.daily) ? row.entry.daily : [];
        const close = daily[daily.length - 1]?.close;
        if (typeof close === "number" && close > 0) lastClose.set(sym, close);
      } catch {
        // a truncated final line is not worth failing the ingest over
      }
    }
  }
}

const rows = {};
const failures = [];
const rejected = [];
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

    // A STRUCTURAL REJECTION IS A FAILURE, NOT A NULL COLUMN. The first run
    // recorded BRK.B as extracted-with-a-null and reported 0% failures; the whole
    // point of the guards is that the run stops calling that a success.
    if (shares.reject) {
      rejected.push({ symbol, reason: shares.reject });
      console.log(`  ${symbol.padEnd(7)} REJECTED — ${shares.reject}`);
      continue;
    }

    // The magnitude cross-check. Only possible where both a frozen marketCap and a
    // frozen last close exist; where they do not, that is SAID rather than passed.
    const close = lastClose.get(symbol) ?? lastClose.get(symbol.replace(/\./g, "-"));
    const fmpCap = frozen.marketCap.get(symbol) ?? frozen.marketCap.get(symbol.replace(/\./g, "-"));
    let xcheck = { ran: false, note: "no frozen marketCap or close for this symbol" };
    if (typeof close === "number" && typeof fmpCap === "number" && shares.shares) {
      const implied = shares.shares * close;
      const ratio = implied / fmpCap;
      const ok = ratio >= MAGNITUDE_LOW && ratio <= MAGNITUDE_HIGH;
      xcheck = { ran: true, impliedMarketCap: implied, frozenMarketCap: fmpCap, ratio, ok };
      if (!ok) {
        const reason =
          `magnitude: shares x last close = ${implied.toExponential(3)} vs frozen FMP ` +
          `marketCap ${fmpCap.toExponential(3)} (ratio ${ratio.toFixed(4)}, band ` +
          `${MAGNITUDE_LOW}-${MAGNITUDE_HIGH}). The two sources disagree; the SEC share ` +
          `count is not safe to use unreviewed. This does NOT establish which is right`;
        rejected.push({ symbol, reason });
        console.log(`  ${symbol.padEnd(7)} REJECTED — ${reason}`);
        continue;
      }
    }

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
      sharesConcept: shares.concept,
      crossCheck: xcheck,
      // NO RAW FACTS. One companyfacts document is 3.79 MB parsed (AAPL), a third
      // of Upstash's 10 MB per-request ceiling, so storing it would fail any batch
      // write -- and the repo's fail-open handlers would swallow that error.
    };
    console.log(
      `  ${symbol.padEnd(7)} shares ${shares.shares ?? "—"} (as of ${shares.asOf ?? "—"}) · ` +
        `EPS ${eps.eps?.toFixed(2) ?? "—"} over ${eps.quarters}q${eps.note ? ` [${eps.note}]` : ""}` +
        (xcheck.ran ? ` · xcheck ratio ${xcheck.ratio.toFixed(3)} OK` : ` · xcheck not run`)
    );
  } catch (e) {
    failures.push({ symbol, reason: String(e?.message ?? e) });
    console.log(`  ${symbol.padEnd(7)} FAIL — ${String(e?.message ?? e)}`);
  }
}

const elapsed = (Date.now() - started) / 1000;
const attempted = symbols.length;
const ok = Object.keys(rows).length;
// THE THRESHOLD NOW MEASURES USABLE OUTPUT, NOT SUCCESSFUL FETCHES. The first run
// scored 0% failures while emitting a fifteen-year-stale share count for a
// mega-cap, because a 200 response counted as a success. A rejected value is a
// symbol this run did not deliver, and it belongs in the numerator.
const unusable = failures.length + rejected.length;
const ratio = attempted ? unusable / attempted : 0;

console.log(`\n══ RESULT ══`);
console.log(`  attempted        ${attempted}`);
console.log(`  extracted        ${ok}`);
console.log(`  fetch failures   ${failures.length}`);
console.log(`  REJECTED values  ${rejected.length}  <- passed the fetch, failed a sanity guard`);
console.log(`  unusable total   ${unusable}  (${(ratio * 100).toFixed(1)}% of attempted)`);
console.log(`  elapsed          ${elapsed.toFixed(1)}s  (${(attempted / Math.max(elapsed, 0.001)).toFixed(1)} req/s effective)`);
const withEps = Object.values(rows).filter((r) => r.trailingDilutedEps != null).length;
const withShares = Object.values(rows).filter((r) => r.sharesOutstanding != null).length;
console.log(`  with shares      ${withShares} of ${ok}`);
console.log(`  with 4q EPS      ${withEps} of ${ok}`);

for (const f of failures) console.log(`  FAILED   ${f.symbol}: ${f.reason}`);
for (const r of rejected) console.log(`  REJECTED ${r.symbol}: ${r.reason}`);

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
      rejected,
      unusable,
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
