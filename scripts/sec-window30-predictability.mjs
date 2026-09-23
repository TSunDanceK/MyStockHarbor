// DOES A 30-DAY WINDOW SURVIVE WHAT AN EXACT DATE DID NOT?
//
// ── THE QUESTION, AND WHY IT IS NOT THE ONE ALREADY ANSWERED ──────────────
// The day-level forward calendar was measured and killed:
//
//   cadence prediction from filing history   2 of 48 filers landed inside
//                                            their OWN p90 band +/-2 days
//   8-K scheduling announcements             0 of 276 fell in the 14-28 day
//                                            band a calendar would need
//
// Nobody measured the COARSER version. "Reports on 14 October" and "expected to
// report in the next 30 days" are different claims, and a predictor can fail the
// first badly while passing the second. This measures the second.
//
// SAME METHOD, DIFFERENT SCORE. The pairing, the lag arithmetic and the
// walk-forward are lifted in shape from sec-results-date-predictability.mjs so
// the two are comparable line for line. Only the scoring changes.
//
// ── A ROLLING WINDOW, NOT CALENDAR-MONTH BUCKETS ──────────────────────────
// A company due 3 October should already be listed on 28 September. A
// fixed-month bucket drops it precisely when it is most useful, and would score
// as a failure something a reader would call correct. So the unit of evaluation
// is a DAY D, and the claim under test is "this filer reports within [D, D+30]".
//
// ── THE THREE NUMBERS, AND WHY THE THIRD IS THE ONLY HONEST ONE ───────────
//
//   BAND HIT       |predicted - actual| <= 30. Easy to read, and generous: it
//                  asks whether the truth is near our estimate, not whether a
//                  reader looking on a given day is told the truth.
//
//   LISTING-DAY    Over every day D we WOULD list the filer (predicted in
//   PRECISION      [D, D+30]), how often the actual date really is in [D, D+30].
//                  This is what a reader experiences. It equals
//                  max(0, 31 - |error|) / 31 per prediction: a 10-day error is
//                  not "a hit", it is two thirds of a hit.
//
//   BASELINE       AND IT IS THE POINT. A filer reporting quarterly is inside
//                  SOME 30-day forward window about a third of the time, so a
//                  predictor that lists EVERY filer EVERY day scores ~33%
//                  precision while knowing nothing. Any headline that is not
//                  compared against this is unreadable. Computed per filer from
//                  its OWN actual dates, not assumed.
//
// A FAILED FETCH IS REPORTED AS A FAILURE, never as an absence -- a symbol whose
// submissions call 403s and a symbol that genuinely files no 2.02 look identical
// in a count of "symbols with no results dates", and only one is a fact about
// the filer.
//
//   relay task: window30  (read-only, uncredentialled, needs a step 0 dump)
import fs from "node:fs";
import path from "node:path";
import { emitPayload } from "./lib/relay-capture.mjs";

const DUMP = process.argv[2] || process.env.DUMP_DIR || "";
if (!DUMP) {
  console.error("FATAL: no dump directory. Dispatch the relay with a run_id carrying a step 0 dump.");
  process.exit(2);
}

const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (contact@mystockharbor.com)";
const HEADERS = { "user-agent": UA, accept: "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86_400_000;
const SPACING_MS = 130;         // ~7.7/s against SEC's published 10/s
const WINDOW_DAYS = 30;
const WINDOW_SPAN = WINDOW_DAYS + 1; // [D, D+30] inclusive

// ── THE FULL UNIVERSE, NOT A SAMPLE ───────────────────────────────────────
// The day-level probe ran 60 hand-picked symbols. That was right for a
// feasibility read and wrong for a ship/don't-ship one: a sample chosen by a
// human is a sample chosen for recognisability, and recognisable companies file
// more regularly than the tail. This walks the analysis universe the site
// actually covers.
const universeDoc = JSON.parse(fs.readFileSync(path.join(DUMP, "universe.json"), "utf8"));
const UNIVERSE = [...new Set((universeDoc.pickersSymbolsKey ?? []).map((s) => String(s).toUpperCase()))];
if (UNIVERSE.length < 100) {
  console.error(`FATAL: universe read ${UNIVERSE.length} symbols — too short to be the analysis universe.`);
  process.exit(1);
}

const TICKERS_FILE = "data/sec/company-tickers.json";
if (!fs.existsSync(TICKERS_FILE)) {
  console.error(`FATAL: ${TICKERS_FILE} is missing on this ref.`);
  process.exit(1);
}
const tickersRaw = JSON.parse(fs.readFileSync(TICKERS_FILE, "utf8"));
const cikByTicker = new Map();
for (const row of tickersRaw.data ?? []) {
  const [cik, , ticker] = row;
  if (ticker) cikByTicker.set(String(ticker).toUpperCase(), String(cik).padStart(10, "0"));
}

console.log(`[w30] universe: ${UNIVERSE.length} symbols · window: ${WINDOW_DAYS}d rolling · UA ${JSON.stringify(UA)}`);

async function getJson(url) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: HEADERS });
    const text = await res.text();
    const ms = Date.now() - t0;
    if (!res.ok) return { ok: false, status: res.status, ms, bytes: text.length, error: `HTTP ${res.status}` };
    try { return { ok: true, ms, bytes: text.length, body: JSON.parse(text) }; }
    catch (e) { return { ok: false, ms, bytes: text.length, error: `unparseable JSON: ${e.message}` }; }
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, bytes: 0, error: `network: ${e.message}` };
  }
}

function rows(block) {
  const n = block?.accessionNumber?.length ?? 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      accn: block.accessionNumber[i], form: block.form?.[i] ?? "",
      filingDate: block.filingDate?.[i] ?? "", reportDate: block.reportDate?.[i] ?? "",
      items: block.items?.[i] ?? "",
    });
  }
  return out;
}

const parse = (d) => (d ? Date.parse(`${d}T00:00:00.000Z`) : NaN);
const days = (a, b) => Math.round((a - b) / DAY);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");

// ── Per-symbol collection. Pairing identical to the day-level probe. ──────
const results = [];
const fetchFailures = [];
let totalBytes = 0, totalRequests = 0, noCik = 0, pagedSymbols = 0;
const t0run = Date.now();

for (const symbol of UNIVERSE) {
  const cik = cikByTicker.get(symbol);
  if (!cik) { noCik++; continue; }

  const res = await getJson(`https://data.sec.gov/submissions/CIK${cik}.json`);
  totalRequests++; totalBytes += res.bytes ?? 0;
  await sleep(SPACING_MS);
  if (!res.ok) { fetchFailures.push({ symbol, why: res.error }); continue; }

  const body = res.body;
  let all = rows(body?.filings?.recent ?? {});
  const forms = new Set(all.map((r) => r.form));
  const isFpi = (forms.has("20-F") || forms.has("40-F")) && !forms.has("10-Q");

  // PAGING IS CAPPED HARDER THAN THE DAY-LEVEL PROBE, because this runs 700
  // symbols rather than 60 and the relay job has 30 minutes. Symbols that hit
  // the cap are COUNTED and reported, so a thin history caused by the cap is
  // visible rather than read as a fact about the filer.
  const countResults = (rs) => isFpi
    ? rs.filter((r) => r.form === "6-K").length
    : rs.filter((r) => r.form === "8-K" && String(r.items).includes("2.02")).length;
  // RECHECK_THIN lifts the cap, so a filer excluded for thin history can be
  // re-measured and the exclusion attributed to the FILER rather than to this
  // script's own budget. Two different facts; one of them is ours.
  const PAGE_CAP = process.env.RECHECK_THIN ? 10 : 2;
  let pagesRead = 0;
  for (const f of body?.filings?.files ?? []) {
    if (countResults(all) >= 12 || pagesRead >= PAGE_CAP) break;
    const pres = await getJson(`https://data.sec.gov/submissions/${f.name}`);
    totalRequests++; totalBytes += pres.bytes ?? 0; pagesRead++;
    await sleep(SPACING_MS);
    if (pres.ok) all = all.concat(rows(pres.body ?? {}));
  }
  if (pagesRead) pagedSymbols++;

  let pairs = [];
  if (isFpi) {
    const seen = new Set();
    const sixK = all
      .filter((r) => r.form === "6-K" && !seen.has(r.accn) && seen.add(r.accn))
      .filter((r) => r.reportDate && r.filingDate)
      .filter((r) => days(parse(r.filingDate), parse(r.reportDate)) >= 20);
    const byPeriod = new Map();
    for (const r of sixK) {
      const cur = byPeriod.get(r.reportDate);
      if (!cur || parse(r.filingDate) < parse(cur.filingDate)) byPeriod.set(r.reportDate, r);
    }
    const ordered = [...byPeriod.values()].sort((a, b) => parse(a.reportDate) - parse(b.reportDate));
    let lastEnd = null;
    for (const r of ordered) {
      const p = parse(r.reportDate);
      if (lastEnd !== null) {
        const gap = days(p, lastEnd);
        if (gap < 55) continue;
        if (gap > 200) { lastEnd = p; continue; } // history gap: re-anchor, do not reject
      }
      lastEnd = p;
      pairs.push({ periodEnd: r.reportDate, resultsDate: r.filingDate, lag: days(parse(r.filingDate), p) });
    }
  } else {
    const periodEnds = [...new Set(
      all.filter((r) => /^10-[QK]/.test(r.form) && r.reportDate).map((r) => r.reportDate)
    )].map(parse).filter(Number.isFinite).sort((a, b) => a - b);
    const seen = new Set();
    const eight = all
      .filter((r) => r.form === "8-K" && String(r.items).includes("2.02"))
      .filter((r) => r.filingDate && !seen.has(r.accn) && seen.add(r.accn));
    const byDay = new Map();
    for (const r of eight) if (!byDay.has(r.filingDate)) byDay.set(r.filingDate, r);
    for (const r of [...byDay.values()].sort((a, b) => parse(a.filingDate) - parse(b.filingDate))) {
      const R = parse(r.filingDate);
      let P = null;
      for (const p of periodEnds) if (p <= R && days(R, p) <= 120) { if (P === null || p > P) P = p; }
      if (P === null) continue;
      pairs.push({ periodEnd: new Date(P).toISOString().slice(0, 10), resultsDate: r.filingDate, lag: days(R, P) });
    }
    const byPeriod = new Map();
    for (const p of pairs) if (!byPeriod.has(p.periodEnd)) byPeriod.set(p.periodEnd, p);
    pairs = [...byPeriod.values()].sort((a, b) => parse(a.periodEnd) - parse(b.periodEnd));
  }

  results.push({ symbol, isFpi, pairs, pagesRead, cappedPaging: pagesRead >= PAGE_CAP });
  if (results.length % 50 === 0) {
    console.log(`[w30] ${results.length}/${UNIVERSE.length} symbols · ${totalRequests} requests · ${((Date.now() - t0run) / 1000).toFixed(0)}s`);
  }
}

console.log(`\n[w30] collected ${results.length} symbols · ${noCik} with no CIK · ${fetchFailures.length} fetch failures · ${pagedSymbols} needed extra pages`);
console.log(`[w30] ${totalRequests} requests · ${(totalBytes / 1048576).toFixed(1)} MB · ${((Date.now() - t0run) / 1000).toFixed(0)}s wall`);
if (fetchFailures.length) {
  const why = {};
  for (const f of fetchFailures) why[f.why] = (why[f.why] ?? 0) + 1;
  console.log(`[w30] failure reasons: ${JSON.stringify(why)}`);
}

// ── Walk-forward, same shape as the day-level probe ───────────────────────
const MIN_USABLE = 8;
const SEED = 3;
const included = results.filter((r) => r.pairs.length >= MIN_USABLE);
const excluded = results.filter((r) => r.pairs.length < MIN_USABLE);

const preds = [];
for (const r of included) {
  for (let n = SEED; n < r.pairs.length; n++) {
    const hist = r.pairs.slice(0, n).map((p) => p.lag);
    const next = r.pairs[n];
    const predicted = parse(next.periodEnd) + Math.round(median(hist)) * DAY;
    preds.push({
      symbol: r.symbol, isFpi: r.isFpi,
      error: days(predicted, parse(next.resultsDate)), // + = predicted late
    });
  }
}

// ── Scoring ───────────────────────────────────────────────────────────────
//
// overlap(|e|) = the number of days D on which BOTH "we list it" and "it really
// does report within 30 days" hold. The two intervals are [predicted-30,
// predicted] and [actual-30, actual], each WINDOW_SPAN days long, offset by e.
const overlapDays = (e) => Math.max(0, WINDOW_SPAN - Math.abs(e));

const score = (xs) => {
  if (!xs.length) return null;
  const abs = xs.map((p) => Math.abs(p.error)).sort((a, b) => a - b);
  const within = (k) => xs.filter((p) => Math.abs(p.error) <= k).length;
  const listingDays = xs.reduce((s, p) => s + overlapDays(p.error), 0);
  return {
    n: xs.length,
    symbols: new Set(xs.map((p) => p.symbol)).size,
    medAbs: median(abs),
    p90: abs[Math.min(abs.length - 1, Math.ceil(0.9 * abs.length) - 1)],
    band30: within(30), band21: within(21), band14: within(14), band7: within(7),
    // The reader-facing figure: listing-days correct over listing-days shown.
    listingPrecision: listingDays / (xs.length * WINDOW_SPAN),
    zeroOverlap: xs.filter((p) => overlapDays(p.error) === 0).length,
  };
};

const all = score(preds);
const dom = score(preds.filter((p) => !p.isFpi));
const fpi = score(preds.filter((p) => p.isFpi));

// ── THE BASELINE, computed rather than assumed ────────────────────────────
// "List every filer every day." Its precision is, per filer, the fraction of
// days on which that filer genuinely reports within the next 30 days: the union
// of [A-30, A] over its actual dates, divided by the span those dates cover.
let baseCoveredDays = 0, baseSpanDays = 0;
for (const r of included) {
  const acts = r.pairs.map((p) => parse(p.resultsDate)).filter(Number.isFinite).sort((a, b) => a - b);
  if (acts.length < 2) continue;
  const span = days(acts[acts.length - 1], acts[0]);
  if (span <= 0) continue;
  // Union of the per-date windows, merged so overlapping windows are not
  // double-counted (a filer reporting twice inside 30 days would otherwise
  // score above 100%).
  const iv = acts.map((a) => [a - WINDOW_DAYS * DAY, a]).sort((x, y) => x[0] - y[0]);
  let covered = 0, curS = iv[0][0], curE = iv[0][1];
  for (const [s, e] of iv.slice(1)) {
    if (s <= curE) curE = Math.max(curE, e);
    else { covered += days(curE, curS) + 1; curS = s; curE = e; }
  }
  covered += days(curE, curS) + 1;
  baseCoveredDays += covered;
  baseSpanDays += span;
}
const baseline = baseSpanDays ? baseCoveredDays / baseSpanDays : null;

// ── Report ────────────────────────────────────────────────────────────────
const line = (name, s) => {
  if (!s) { console.log(`  ${name.padEnd(10)} (no predictions)`); return; }
  console.log(
    `  ${name.padEnd(10)} n=${String(s.n).padStart(5)} over ${String(s.symbols).padStart(3)} filers · ` +
    `medAbs=${String(s.medAbs).padStart(4)}d p90=${String(s.p90).padStart(4)}d`
  );
  console.log(
    `             band: <=7d ${pct(s.band7, s.n).padStart(6)} · <=14d ${pct(s.band14, s.n).padStart(6)} · ` +
    `<=21d ${pct(s.band21, s.n).padStart(6)} · <=30d ${pct(s.band30, s.n).padStart(6)}`
  );
  console.log(
    `             LISTING-DAY PRECISION ${(s.listingPrecision * 100).toFixed(1)}% · ` +
    `predictions with ZERO usable overlap: ${s.zeroOverlap} (${pct(s.zeroOverlap, s.n)})`
  );
};

console.log(`\n=== 30-DAY ROLLING WINDOW, FULL UNIVERSE ===\n`);
console.log(`filers with >=${MIN_USABLE} usable periods: ${included.length} of ${results.length} collected`);
console.log(`filers excluded for thin history: ${excluded.length} (${pct(excluded.length, results.length)})`);
{
  // NAMED, NOT COUNTED. "5 hit the cap" cannot be acted on; five symbols can.
  const capped = excluded.filter((r) => r.cappedPaging);
  console.log(`  of those, ${capped.length} hit the paging cap — thin history may be the CAP, not the filer`);
  if (capped.length) {
    console.log(`  CAPPED, BY NAME: ${capped.map((r) => `${r.symbol}(${r.pairs.length} usable, ${r.pagesRead}p)`).join(" ")}`);
    console.log(`  Re-run with RECHECK_THIN=1 to lift the cap and attribute each one.`);
  }
  console.log(`  page cap this run: ${process.env.RECHECK_THIN ? 10 : 2}${process.env.RECHECK_THIN ? "  (RECHECK_THIN)" : ""}`);
  // THE OTHER 76 ARE NOT THE CAP. Printed so "thin history" is a population
  // with names rather than a number that excuses itself.
  const notCapped = excluded.filter((r) => !r.cappedPaging);
  console.log(`  thin WITHOUT hitting the cap: ${notCapped.length} — ${notCapped.slice(0, 25).map((r) => `${r.symbol}(${r.pairs.length})`).join(" ")}${notCapped.length > 25 ? " …" : ""}`);
}
console.log("");
line("ALL", all);
line("domestic", dom);
line("FPI", fpi);

console.log(`\n=== THE BASELINE THAT MAKES THOSE NUMBERS READABLE ===\n`);
console.log(`  "list every filer every day, knowing nothing": ${baseline == null ? "n/a" : `${(baseline * 100).toFixed(1)}%`} listing-day precision`);
console.log(`  (union of [actual-30, actual] over each filer's own results dates, merged, across ${baseCoveredDays} of ${baseSpanDays} filer-days)`);
if (baseline != null && all) {
  const lift = all.listingPrecision - baseline;
  console.log(`\n  LIFT OVER BASELINE: ${(lift * 100).toFixed(1)} points (${(all.listingPrecision * 100).toFixed(1)}% vs ${(baseline * 100).toFixed(1)}%)`);
  console.log(`  A predictor that cannot beat the baseline by a wide margin is a predictor`);
  console.log(`  whose output a reader could reproduce by assuming everyone reports soon.`);
}

console.log(`\n=== HOW FAR OFF THE MISSES ARE ===\n`);
{
  const misses = preds.filter((p) => Math.abs(p.error) > WINDOW_DAYS).map((p) => Math.abs(p.error)).sort((a, b) => a - b);
  console.log(`  predictions outside +/-${WINDOW_DAYS}d: ${misses.length} of ${preds.length} (${pct(misses.length, preds.length)})`);
  if (misses.length) {
    console.log(`  their |error|: median ${median(misses)}d · p90 ${misses[Math.ceil(0.9 * misses.length) - 1]}d · max ${misses[misses.length - 1]}d`);
    const buckets = { "31-45": 0, "46-60": 0, "61-90": 0, "91-180": 0, "180+": 0 };
    for (const e of misses) {
      if (e <= 45) buckets["31-45"]++; else if (e <= 60) buckets["46-60"]++;
      else if (e <= 90) buckets["61-90"]++; else if (e <= 180) buckets["91-180"]++; else buckets["180+"]++;
    }
    console.log(`  ${Object.entries(buckets).map(([k, v]) => `${k}d: ${v}`).join(" · ")}`);
  }
  // CONCENTRATED OR SPREAD? A tail in 5 filers is a per-symbol suppression rule;
  // a tail spread across 200 is a property of the method.
  const byS = new Map();
  for (const p of preds) if (Math.abs(p.error) > WINDOW_DAYS) byS.set(p.symbol, (byS.get(p.symbol) ?? 0) + 1);
  console.log(`  spread across ${byS.size} of ${all?.symbols ?? 0} filers`);
  console.log(`  worst: ${[...byS.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([s, n]) => `${s}(${n})`).join(" ")}`);
}

console.log(`\n=== PER-FILER, BECAUSE A PAGE DEGRADES PER SYMBOL ===\n`);
{
  // The aggregate answers "are predictions good". A page shows or hides a
  // SYMBOL, so what decides the feature is how many filers are individually
  // good enough on their own history.
  const byFiler = new Map();
  for (const p of preds) {
    if (!byFiler.has(p.symbol)) byFiler.set(p.symbol, []);
    byFiler.get(p.symbol).push(p);
  }
  const rows = [...byFiler.entries()].map(([symbol, xs]) => ({
    symbol, n: xs.length,
    precision: xs.reduce((s, p) => s + overlapDays(p.error), 0) / (xs.length * WINDOW_SPAN),
    worst: Math.max(...xs.map((p) => Math.abs(p.error))),
  }));
  const at = (t) => rows.filter((r) => r.precision >= t).length;
  console.log(`  filers scored: ${rows.length}`);
  for (const t of [0.5, 0.6, 0.7, 0.8, 0.9]) {
    console.log(`    listing-day precision >= ${(t * 100).toFixed(0)}%: ${at(t)} filers (${pct(at(t), rows.length)})`);
  }
  console.log(`  filers whose WORST prediction still overlapped at all: ${rows.filter((r) => r.worst <= WINDOW_DAYS).length} (${pct(rows.filter((r) => r.worst <= WINDOW_DAYS).length, rows.length)})`);
}

emitPayload("window30", JSON.stringify({
  at: new Date().toISOString(), windowDays: WINDOW_DAYS,
  universe: UNIVERSE.length, collected: results.length,
  included: included.length, excluded: excluded.length,
  fetchFailures: fetchFailures.length, noCik,
  all, dom, fpi, baseline,
}, null, 2));
