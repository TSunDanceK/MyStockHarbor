// "Due to report" — simulated over the past 12 months, k swept, full universe.
//
// THE CONSTRUCT. A symbol is DUE on day D when its most recent completed fiscal
// period P has ended, no results filing for P has been observed, and
// D >= P + medianLag(symbol) - k.
//
// THE MEDIAN LAG IS CAUSAL, AND THAT IS THE WHOLE VALIDITY OF THE FALSE-NEGATIVE
// NUMBER. Entry time E for (symbol, P) uses only lags whose results filing landed
// BEFORE P ended. Using the full-history median would let the simulation place an
// entry date informed by the very filing it is being scored against, and the
// false-negative rate -- the share of filings that landed before the symbol ever
// appeared -- would come out flattering and meaningless.
//
// ATTRIBUTION RULE: the FIRST 8-K carrying item 2.02 after period end P is the
// results release for P. For foreign private issuers, 6-K instead, deduplicated
// on accn and preferring one whose reportDate is a quarter end (ARM files them in
// same-day pairs).
//
// THE KNOWN FAILURE MODE IS COUNTED, NOT ASSUMED AWAY. A company filing an
// unrelated item 2.02 between P and its real release drops off the list early.
// Two counters bound it: periods with MORE THAN ONE candidate 2.02 before the
// next period end (the population at risk), and periods where the first
// candidate's lag is a large outlier against that symbol's own median (the
// likely mis-attribution).
//
// READ-ONLY: submissions endpoint only, no document fetching, plus a frozen dump
// for the universe. No Redis, no FMP, no writes.
import fs from "node:fs";
import path from "node:path";

const DUMP = process.argv[2] || process.env.DUMP_DIR || "";
const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (contact@mystockharbor.com)";
const HEADERS = { "user-agent": UA, accept: "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SPACING_MS = 110; // ~9/sec, inside SEC's published 10/sec
const DAY = 86_400_000;
const K_VALUES = [3, 5, 7, 10, 14];
const MIN_PRIOR_LAGS = 3;   // fewer than this and the symbol has no prediction
const MAX_ATTRIBUTION_DAYS = 120; // a results filing further out than this is not P's
const HISTORY_WANTED_DAYS = 3 * 365;

if (!DUMP) { console.error("FATAL: no dump directory. Dispatch the relay with a run_id."); process.exit(2); }
const readJson = (n) => { const f = path.join(DUMP, n); if (!fs.existsSync(f)) return null; try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

// ── The universe: the ANALYSIS universe, not the dump union ────────────────
// step0-analyse-dump's own distinction: the union is what the dump swept, the
// analysis universe (the pickers symbol list) is what renders. List size is a
// product question about what renders, so it is scored against that.
const universeDoc = readJson("universe.json");
if (!universeDoc) { console.error("FATAL: universe.json missing from the dump."); process.exit(1); }
const analysis = [...new Set((universeDoc.pickersSymbolsKey ?? []).map((s) => String(s).toUpperCase()))];
if (analysis.length < 100) {
  console.error(
    `FATAL: the analysis universe read ${analysis.length} symbols from pickersSymbolsKey. ` +
      `That is not the ~700-symbol list this measures, and scoring list size against a ` +
      `short universe would understate every figure. Use a dump whose pickers symbol key was live.`
  );
  process.exit(1);
}

const tickersRaw = JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8"));
const cikByTicker = new Map();
for (const [cik, , ticker] of tickersRaw.data ?? []) if (ticker) cikByTicker.set(String(ticker).toUpperCase(), String(cik).padStart(10, "0"));

console.log(`[due] analysis universe       ${analysis.length}`);
console.log(`[due] resolved to a CIK       ${analysis.filter((s) => cikByTicker.has(s)).length}`);
console.log(`[due] user-agent              ${JSON.stringify(UA)}`);
console.log("");

// ── Fetch ──────────────────────────────────────────────────────────────────
let reqs = 0, bytes = 0, ms = 0;
const fetchFailures = [];
async function getJson(url) {
  const t0 = Date.now(); reqs++;
  try {
    const res = await fetch(url, { headers: HEADERS });
    const text = await res.text();
    ms += Date.now() - t0; bytes += text.length;
    await sleep(SPACING_MS);
    if (!res.ok) { fetchFailures.push({ url, why: `HTTP ${res.status}` }); return null; }
    try { return JSON.parse(text); } catch (e) { fetchFailures.push({ url, why: `bad JSON: ${e.message}` }); return null; }
  } catch (e) {
    ms += Date.now() - t0; await sleep(SPACING_MS);
    fetchFailures.push({ url, why: `network: ${e.message}` });
    return null;
  }
}

const parse = (d) => (d ? Date.parse(`${d}T00:00:00.000Z`) : NaN);
const days = (a, b) => Math.round((a - b) / DAY);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
const quantile = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]; };
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");

function rows(block) {
  const n = block?.accessionNumber?.length ?? 0;
  const out = [];
  for (let i = 0; i < n; i++) out.push({
    accn: block.accessionNumber[i], form: block.form?.[i] ?? "",
    filingDate: block.filingDate?.[i] ?? "", reportDate: block.reportDate?.[i] ?? "",
    items: block.items?.[i] ?? "",
  });
  return out;
}

// ── Per-symbol extraction ──────────────────────────────────────────────────
const NOW = Date.now();
const WINDOW_START = NOW - 365 * DAY;
const symbols = [];
const counters = {
  fetched: 0, fetchFailed: 0, noCik: 0,
  paged: 0, shortHistory: 0,
  withPeriodEnds: 0, withEightResults: 0,
  matchedFilings: 0, unmatchedFilings: 0,
  periodsWithMultipleCandidates: 0, periodsFirstCandidateOutlier: 0,
  simulated: 0, excludedTooFewLags: 0,
};

for (const symbol of analysis) {
  const cik = cikByTicker.get(symbol);
  if (!cik) { counters.noCik++; continue; }

  const body = await getJson(`https://data.sec.gov/submissions/CIK${cik}.json`);
  if (!body) { counters.fetchFailed++; continue; }
  counters.fetched++;

  let all = rows(body?.filings?.recent ?? {});
  // PAGE ONLY WHEN THE RECENT BLOCK IS TOO SHALLOW. A heavy filer exhausts 1,000
  // filings in months, and a 12-month simulation needs prior lags from before it.
  const oldest = all.reduce((m, r) => Math.min(m, parse(r.filingDate) || Infinity), Infinity);
  if (Number.isFinite(oldest) && oldest > NOW - HISTORY_WANTED_DAYS * DAY) {
    let pages = 0;
    for (const f of body?.filings?.files ?? []) {
      if (pages >= 2) break;
      const p = await getJson(`https://data.sec.gov/submissions/${f.name}`);
      pages++;
      if (p) all = all.concat(rows(p));
    }
    if (pages) counters.paged++;
    const o2 = all.reduce((m, r) => Math.min(m, parse(r.filingDate) || Infinity), Infinity);
    if (Number.isFinite(o2) && o2 > NOW - HISTORY_WANTED_DAYS * DAY) counters.shortHistory++;
  }

  const forms = new Set(all.map((r) => r.form));
  const isFpi = (forms.has("20-F") || forms.has("40-F")) && !forms.has("10-Q");
  const category = body?.category ?? "";

  let periodEnds = [];
  let pairs = [];      // { P, R, lag }
  let unmatched = 0;

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
        if (gap > 200) { lastEnd = p; continue; }
      }
      lastEnd = p;
      periodEnds.push(p);
      pairs.push({ P: p, R: parse(r.filingDate), lag: days(parse(r.filingDate), p) });
    }
  } else {
    periodEnds = [...new Set(all.filter((r) => /^10-[QK]/.test(r.form) && r.reportDate).map((r) => r.reportDate))]
      .map(parse).filter(Number.isFinite).sort((a, b) => a - b);

    const seen = new Set();
    const results = all
      .filter((r) => r.form === "8-K" && String(r.items).includes("2.02") && r.filingDate)
      .filter((r) => !seen.has(r.accn) && seen.add(r.accn))
      .map((r) => parse(r.filingDate)).filter(Number.isFinite).sort((a, b) => a - b);

    for (let i = 0; i < periodEnds.length; i++) {
      const P = periodEnds[i];
      const nextP = periodEnds[i + 1] ?? Infinity;
      // THE ATTRIBUTION RULE: first 2.02 after P, inside the attribution window.
      const candidates = results.filter((R) => R > P && R <= Math.min(nextP, P + MAX_ATTRIBUTION_DAYS * DAY));
      if (!candidates.length) { unmatched++; continue; }
      if (candidates.length > 1) counters.periodsWithMultipleCandidates++;
      pairs.push({ P, R: candidates[0], lag: days(candidates[0], P), nCandidates: candidates.length });
    }
  }

  if (periodEnds.length) counters.withPeriodEnds++;
  if (pairs.length >= 8) counters.withEightResults++;
  counters.matchedFilings += pairs.length;
  counters.unmatchedFilings += unmatched;

  // THE EARLY-DROP PROXY. Among periods that had more than one candidate, how
  // often is the chosen (first) one a large outlier against this symbol's own
  // median lag? That is the shape of picking an unrelated 2.02.
  const med = median(pairs.map((p) => p.lag));
  if (med != null) {
    for (const p of pairs) {
      if ((p.nCandidates ?? 1) > 1 && Math.abs(p.lag - med) > 10) counters.periodsFirstCandidateOutlier++;
    }
  }

  symbols.push({ symbol, isFpi, category, periodEnds, pairs, deadline: /large accelerated/i.test(category) ? 40 : 45 });
}

console.log(`[due] requests ${reqs} · ${(bytes / 1048576).toFixed(1)} MB · mean ${reqs ? Math.round(ms / reqs) : 0}ms · failures ${fetchFailures.length}`);
console.log("");

// ── Build the due-intervals per k ──────────────────────────────────────────
//
// One interval per (symbol, period): [E, exit). E is the entry date from the
// CAUSAL median; exit is the results filing, or the next period end / window end
// when the filing never arrived -- a period whose filing is never attributed
// keeps the symbol on the list, which is exactly the "never clears" risk and is
// measured rather than suppressed.
function buildIntervals(k) {
  const intervals = [];
  const falseNegatives = [];
  const dwells = [];
  let considered = 0, excluded = 0;

  for (const s of symbols) {
    for (let i = 0; i < s.periodEnds.length; i++) {
      const P = s.periodEnds[i];
      const nextP = s.periodEnds[i + 1] ?? Infinity;
      const pair = s.pairs.find((p) => p.P === P);
      const R = pair?.R ?? null;

      // Only periods whose activity touches the 12-month window matter.
      const horizonEnd = Math.min(R ?? Infinity, nextP, NOW);
      if (horizonEnd < WINDOW_START) continue;
      if (P > NOW) continue;

      // CAUSAL: lags whose filing landed strictly before this period ended.
      const priorLags = s.pairs.filter((p) => p.R < P).map((p) => p.lag);
      considered++;
      if (priorLags.length < MIN_PRIOR_LAGS) { excluded++; continue; }

      const E = P + (Math.round(median(priorLags)) - k) * DAY;
      const exit = R ?? Math.min(nextP, NOW);

      if (R != null && R < E) {
        // Filed before the symbol ever appeared on the list.
        falseNegatives.push({ symbol: s.symbol, P, R, E });
        continue;
      }
      if (R != null) dwells.push(days(R, Math.max(E, P)));
      if (exit > E) intervals.push({ symbol: s.symbol, start: E, end: exit, P, deadline: s.deadline });
    }
  }
  return { intervals, falseNegatives, dwells, considered, excluded };
}

// Weekly buckets over the window.
const weekStart = (t) => { const d = new Date(t); const dow = d.getUTCDay(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow); };
const allDays = [];
for (let t = WINDOW_START; t <= NOW; t += DAY) allDays.push(t);

// SEASONALITY IS DERIVED FROM THE DATA, NOT FROM THE CALENDAR. Weeks are ranked
// by how many attributed results filings landed in them; peak = top quartile,
// quiet = bottom quartile. A calendar guess would bake in an assumption about
// when earnings season is, which is the kind of thing this file exists to avoid.
const filingsPerWeek = new Map();
for (const s of symbols) for (const p of s.pairs) {
  if (p.R < WINDOW_START || p.R > NOW) continue;
  const w = weekStart(p.R);
  filingsPerWeek.set(w, (filingsPerWeek.get(w) ?? 0) + 1);
}
const weeks = [...new Set(allDays.map(weekStart))].sort((a, b) => a - b);
const weekCounts = weeks.map((w) => filingsPerWeek.get(w) ?? 0);
const peakCut = quantile(weekCounts, 0.75);
const quietCut = quantile(weekCounts, 0.25);
const isPeakWeek = (w) => (filingsPerWeek.get(w) ?? 0) >= peakCut;
const isQuietWeek = (w) => (filingsPerWeek.get(w) ?? 0) <= quietCut;

const results = [];
for (const k of K_VALUES) {
  const { intervals, falseNegatives, dwells, considered, excluded } = buildIntervals(k);
  if (k === K_VALUES[0]) { counters.simulated = considered; counters.excludedTooFewLags = excluded; }

  // Daily list size and overdue count.
  const daily = [], dailyOverdue = [], byDay = new Map();
  for (const t of allDays) {
    let n = 0, over = 0;
    for (const iv of intervals) {
      if (t >= iv.start && t < iv.end) { n++; if (t > iv.P + iv.deadline * DAY) over++; }
    }
    daily.push(n); dailyOverdue.push(over); byDay.set(t, n);
  }
  const peakDays = allDays.filter((t) => isPeakWeek(weekStart(t)));
  const quietDays = allDays.filter((t) => isQuietWeek(weekStart(t)));
  const at = (ts) => ts.map((t) => byDay.get(t) ?? 0);

  const matchedInWindow = symbols.flatMap((s) => s.pairs).filter((p) => p.R >= WINDOW_START && p.R <= NOW).length;

  results.push({
    k,
    all: { med: median(daily), p90: quantile(daily, 0.9), max: Math.max(...daily) },
    peak: { med: median(at(peakDays)), p90: quantile(at(peakDays), 0.9), max: Math.max(...at(peakDays), 0) },
    quiet: { med: median(at(quietDays)), p90: quantile(at(quietDays), 0.9), max: Math.max(...at(quietDays), 0) },
    fnCount: falseNegatives.length,
    fnRate: falseNegatives.length / Math.max(1, falseNegatives.length + dwells.length),
    dwellMed: median(dwells), dwellP90: quantile(dwells, 0.9), dwellN: dwells.length,
    overMed: median(dailyOverdue), overP90: quantile(dailyOverdue, 0.9), overMax: Math.max(...dailyOverdue),
    overShare: median(dailyOverdue) / Math.max(1, median(daily)),
    intervals: intervals.length,
    matchedInWindow,
    weekly: weeks.map((w) => ({ w, n: Math.max(...allDays.filter((t) => weekStart(t) === w).map((t) => byDay.get(t) ?? 0), 0), filings: filingsPerWeek.get(w) ?? 0 })),
  });
}

// ── Report, printed last ───────────────────────────────────────────────────
const iso = (t) => new Date(t).toISOString().slice(0, 10);
console.log(`
================================================================
"DUE TO REPORT" — k SWEPT, 12 MONTHS SIMULATED — ${new Date().toISOString()}
window ${iso(WINDOW_START)} .. ${iso(NOW)} · universe ${analysis.length} (analysis, not the dump union)
================================================================

ATTRIBUTION COUNTERS — so any zero or surprise below can be blamed correctly

  symbols in analysis universe        ${analysis.length}
  no CIK in the ticker file           ${counters.noCik}
  submissions fetched OK              ${counters.fetched}
  submissions FAILED                  ${counters.fetchFailed}${counters.fetchFailed ? `  (first: ${fetchFailures[0]?.why})` : ""}
  needed extra history pages          ${counters.paged}
  STILL short of 3y history after     ${counters.shortHistory}   <- their early lags are unknown
  symbols with usable period ends     ${counters.withPeriodEnds}
  symbols with >= 8 usable results    ${counters.withEightResults}
  filings matched to a period         ${counters.matchedFilings}
  periods with NO filing matched      ${counters.unmatchedFilings}  (${pct(counters.unmatchedFilings, counters.matchedFilings + counters.unmatchedFilings)})
  (symbol, period) pairs considered   ${counters.simulated}
  excluded: fewer than ${MIN_PRIOR_LAGS} prior lags    ${counters.excludedTooFewLags}  (${pct(counters.excludedTooFewLags, counters.simulated)})

  THE ATTRIBUTION RULE'S OWN FAILURE MODE, COUNTED
  periods with >1 candidate 2.02      ${counters.periodsWithMultipleCandidates}
  of those, first is a lag outlier    ${counters.periodsFirstCandidateOutlier}  (${pct(counters.periodsFirstCandidateOutlier, counters.periodsWithMultipleCandidates)})
  = the early-drop population. The first figure is the population at risk; the
  second is where the chosen filing looks wrong against the symbol's own median.

SEASONALITY SPLIT, derived from filings-per-week rather than the calendar
  weeks in window ${weeks.length} · peak = >= ${peakCut} filings/wk · quiet = <= ${quietCut} filings/wk
  peak weeks ${weeks.filter(isPeakWeek).length} · quiet weeks ${weeks.filter(isQuietWeek).length}
`);

for (const r of results) {
  console.log(`
─────────────────────────────────────────────────────────────────
k = ${r.k} days
─────────────────────────────────────────────────────────────────
A. LIST SIZE (symbols simultaneously due)

| segment | median | p90 | max |
|---|---|---|---|
| all weeks | ${r.all.med} | ${r.all.p90} | ${r.all.max} |
| peak weeks | ${r.peak.med} | ${r.peak.p90} | ${r.peak.max} |
| quiet weeks | ${r.quiet.med} | ${r.quiet.p90} | ${r.quiet.max} |

B. FALSE NEGATIVES (filed before the symbol ever entered the list)
   ${r.fnCount} of ${r.fnCount + r.dwellN} scored filings = ${pct(r.fnCount, r.fnCount + r.dwellN)}

C. DWELL (days on the list before filing, n=${r.dwellN})
   median ${r.dwellMed}  ·  p90 ${r.dwellP90}

D. OVERDUE (past ${"40d large-accelerated / 45d otherwise"})
   median ${r.overMed}  ·  p90 ${r.overP90}  ·  max ${r.overMax}
   overdue as a share of the median list  ${(r.overShare * 100).toFixed(1)}%`);
}

console.log(`

WEEKLY LIST SIZE (k = 7), peak/quiet marked — the seasonality shape

| week | filings landed | list size (max in wk) | |
|---|---|---|---|`);
for (const wk of results.find((r) => r.k === 7).weekly) {
  const tag = isPeakWeek(wk.w) ? "PEAK" : isQuietWeek(wk.w) ? "quiet" : "";
  console.log(`| ${iso(wk.w)} | ${wk.filings} | ${wk.n} | ${tag} |`);
}

console.log(`
NOT A PRODUCT DECISION. Numbers only.
================================================================
`);
