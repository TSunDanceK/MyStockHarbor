// "Due to report" — k swept, attribution rules compared, cap cuts, residue traced.
//
// THE CONSTRUCT. A symbol is DUE on day D when its most recent completed fiscal
// period P has ended, no results filing for P has been observed, and
// D >= P + medianLag(symbol) - k.
//
// THE MEDIAN LAG IS CAUSAL, AND THAT IS THE WHOLE VALIDITY OF THE FALSE-NEGATIVE
// NUMBER. Entry time E for (symbol, P) uses only lags whose results filing landed
// BEFORE P ended. A full-history median would let the simulation place an entry
// date informed by the very filing it is scored against.
//
// ── THE EXTRACTED FACT SET IS WRITTEN OUT, AND THAT IS NOT HOUSEKEEPING ────
// The first run of this probe discarded its inputs, so three follow-up re-slices
// that needed no new information still cost a second full pass over ~700
// symbols. The same thing happened to the cadence probe a day earlier, which
// printed aggregates and kept no per-symbol errors. Twice is a pattern, so the
// fact set now lands in data/sec/due-sweep-facts.json, which relay.yml already
// uploads. A probe that cannot be re-sliced without re-fetching is a probe whose
// cost is paid again for every question asked of it.
//
// READ-ONLY: submissions endpoint only, no document fetching, plus a frozen dump
// for the universe and market caps. No Redis, no FMP, no writes to anything live.
import fs from "node:fs";
import path from "node:path";

const DUMP = process.argv[2] || process.env.DUMP_DIR || "";
const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (contact@mystockharbor.com)";
const HEADERS = { "user-agent": UA, accept: "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SPACING_MS = 110;
const DAY = 86_400_000;
const K_VALUES = [3, 5, 7, 10, 14];
const CAP_CUTS = [20, 50, 100];
const CAP_KS = [3, 5, 7];
const MIN_PRIOR_LAGS = 3;
// READ FROM SOURCE, NEVER PINNED. This probe held a third copy of the horizon
// while two modules held the other two; the copy that was deleted with
// secResultsDate.ts was one of them. A pinned probe constant silently measures
// a bound the code no longer uses, and agrees with itself while doing it.
const HORIZON_SRC = fs.readFileSync(new URL("../lib/server/secReportDates.ts", import.meta.url), "utf8");
const HORIZON_M = /MAX_PERIOD_TO_ANNOUNCEMENT_DAYS = (\d+)/.exec(HORIZON_SRC);
if (!HORIZON_M) {
  console.error("FATAL: MAX_PERIOD_TO_ANNOUNCEMENT_DAYS not found in secReportDates.ts.");
  console.error("Refusing to fall back to a pinned 120 -- a probe measuring a bound the code");
  console.error("does not use reports a confident wrong number.");
  process.exit(2);
}
const MAX_ATTRIBUTION_DAYS = Number(HORIZON_M[1]);
const HISTORY_WANTED_DAYS = 3 * 365;
const OUTLIER_DAYS = 10;

if (!DUMP) { console.error("FATAL: no dump directory. Dispatch the relay with a run_id."); process.exit(2); }
const readJson = (n) => { const f = path.join(DUMP, n); if (!fs.existsSync(f)) return null; try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

const universeDoc = readJson("universe.json");
if (!universeDoc) { console.error("FATAL: universe.json missing from the dump."); process.exit(1); }
const analysis = [...new Set((universeDoc.pickersSymbolsKey ?? []).map((s) => String(s).toUpperCase()))];
if (analysis.length < 100) {
  console.error(`FATAL: analysis universe read ${analysis.length} symbols from pickersSymbolsKey — too short to score list size against.`);
  process.exit(1);
}

// Market caps, for the cap cuts.
const marketCap = new Map();
{
  const raw = readJson("price-pool.json")?.value ?? {};
  for (const [sym, v] of Object.entries(raw)) {
    let e = v; if (typeof e === "string") { try { e = JSON.parse(e); } catch { e = null; } }
    const mc = Number(e?.marketCap);
    if (Number.isFinite(mc) && mc > 0) marketCap.set(sym.toUpperCase(), mc);
  }
}

const tickersRaw = JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8"));
const cikByTicker = new Map();
for (const [cik, , ticker] of tickersRaw.data ?? []) if (ticker) cikByTicker.set(String(ticker).toUpperCase(), String(cik).padStart(10, "0"));

console.log(`[due] analysis universe ${analysis.length} · with a pool cap ${analysis.filter((s) => marketCap.has(s)).length}`);
console.log("");

let reqs = 0, bytes = 0, ms = 0;
const fetchFailures = [];
async function getJson(url) {
  const t0 = Date.now(); reqs++;
  try {
    const res = await fetch(url, { headers: HEADERS });
    const text = await res.text();
    ms += Date.now() - t0; bytes += text.length; await sleep(SPACING_MS);
    if (!res.ok) { fetchFailures.push({ url, why: `HTTP ${res.status}` }); return null; }
    try { return JSON.parse(text); } catch (e) { fetchFailures.push({ url, why: `bad JSON: ${e.message}` }); return null; }
  } catch (e) { ms += Date.now() - t0; await sleep(SPACING_MS); fetchFailures.push({ url, why: `network: ${e.message}` }); return null; }
}

const parse = (d) => (d ? Date.parse(`${d}T00:00:00.000Z`) : NaN);
const days = (a, b) => Math.round((a - b) / DAY);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
const quantile = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]; };
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");
const iso = (t) => new Date(t).toISOString().slice(0, 10);

function rows(block) {
  const n = block?.accessionNumber?.length ?? 0; const out = [];
  for (let i = 0; i < n; i++) out.push({ accn: block.accessionNumber[i], form: block.form?.[i] ?? "", filingDate: block.filingDate?.[i] ?? "", reportDate: block.reportDate?.[i] ?? "", items: block.items?.[i] ?? "" });
  return out;
}

const NOW = Date.now();
const WINDOW_START = NOW - 365 * DAY;
const symbols = [];
const c = { fetched: 0, fetchFailed: 0, noCik: 0, paged: 0, shortHistory: 0, withPeriodEnds: 0, withEight: 0, unmatchedLoose: 0, matchedLoose: 0 };

for (const symbol of analysis) {
  const cik = cikByTicker.get(symbol);
  if (!cik) { c.noCik++; continue; }
  const body = await getJson(`https://data.sec.gov/submissions/CIK${cik}.json`);
  if (!body) { c.fetchFailed++; continue; }
  c.fetched++;

  let all = rows(body?.filings?.recent ?? {});
  const oldest = all.reduce((m, r) => Math.min(m, parse(r.filingDate) || Infinity), Infinity);
  if (Number.isFinite(oldest) && oldest > NOW - HISTORY_WANTED_DAYS * DAY) {
    let pages = 0;
    for (const f of body?.filings?.files ?? []) { if (pages >= 2) break; const p = await getJson(`https://data.sec.gov/submissions/${f.name}`); pages++; if (p) all = all.concat(rows(p)); }
    if (pages) c.paged++;
    const o2 = all.reduce((m, r) => Math.min(m, parse(r.filingDate) || Infinity), Infinity);
    if (Number.isFinite(o2) && o2 > NOW - HISTORY_WANTED_DAYS * DAY) c.shortHistory++;
  }

  const formSet = new Set(all.map((r) => r.form));
  const isFpi = (formSet.has("20-F") || formSet.has("40-F")) && !formSet.has("10-Q");
  const category = body?.category ?? "";
  // Form mix, for the residue trace: what does this filer actually file?
  const formMix = [...formSet].filter((f) => /^(10-[QK]|20-F|40-F|6-K|8-K)/.test(f)).sort();

  let periodEnds = [];
  const periods = []; // { P, candidates:[{R, items}] }  -- FPI periods carry exactly one

  if (isFpi) {
    const seen = new Set();
    const sixK = all.filter((r) => r.form === "6-K" && !seen.has(r.accn) && seen.add(r.accn))
      .filter((r) => r.reportDate && r.filingDate)
      .filter((r) => days(parse(r.filingDate), parse(r.reportDate)) >= 20);
    const byPeriod = new Map();
    for (const r of sixK) { const cur = byPeriod.get(r.reportDate); if (!cur || parse(r.filingDate) < parse(cur.filingDate)) byPeriod.set(r.reportDate, r); }
    let lastEnd = null;
    for (const r of [...byPeriod.values()].sort((a, b) => parse(a.reportDate) - parse(b.reportDate))) {
      const p = parse(r.reportDate);
      if (lastEnd !== null) { const gap = days(p, lastEnd); if (gap < 55) continue; if (gap > 200) { lastEnd = p; continue; } }
      lastEnd = p; periodEnds.push(p);
      periods.push({ P: p, candidates: [{ R: parse(r.filingDate), items: "" }] });
    }
  } else {
    periodEnds = [...new Set(all.filter((r) => /^10-[QK]/.test(r.form) && r.reportDate).map((r) => r.reportDate))]
      .map(parse).filter(Number.isFinite).sort((a, b) => a - b);
    const seen = new Set();
    const results = all.filter((r) => r.form === "8-K" && String(r.items).includes("2.02") && r.filingDate)
      .filter((r) => !seen.has(r.accn) && seen.add(r.accn))
      .map((r) => ({ R: parse(r.filingDate), items: String(r.items) }))
      .filter((r) => Number.isFinite(r.R)).sort((a, b) => a.R - b.R);
    for (let i = 0; i < periodEnds.length; i++) {
      const P = periodEnds[i];
      const nextP = periodEnds[i + 1] ?? Infinity;
      const candidates = results.filter((r) => r.R > P && r.R <= Math.min(nextP, P + MAX_ATTRIBUTION_DAYS * DAY));
      periods.push({ P, candidates });
    }
  }

  if (periodEnds.length) c.withPeriodEnds++;
  symbols.push({ symbol, isFpi, category, formMix, periodEnds, periods, deadline: /large accelerated/i.test(category) ? 40 : 45, marketCap: marketCap.get(symbol) ?? null });
}

console.log(`[due] requests ${reqs} · ${(bytes / 1048576).toFixed(1)} MB · mean ${reqs ? Math.round(ms / reqs) : 0}ms · failures ${fetchFailures.length}`);

// ── PERSIST THE FACT SET ───────────────────────────────────────────────────
try {
  fs.mkdirSync("data/sec", { recursive: true });
  fs.writeFileSync("data/sec/due-sweep-facts.json", JSON.stringify({
    extractedAt: new Date().toISOString(), windowStart: iso(WINDOW_START), windowEnd: iso(NOW),
    symbols: symbols.map((s) => ({
      symbol: s.symbol, isFpi: s.isFpi, category: s.category, formMix: s.formMix, marketCap: s.marketCap,
      periods: s.periods.map((p) => ({ P: iso(p.P), candidates: p.candidates.map((x) => ({ R: iso(x.R), items: x.items })) })),
    })),
  }));
  console.log(`[due] fact set written: data/sec/due-sweep-facts.json (${(fs.statSync("data/sec/due-sweep-facts.json").size / 1048576).toFixed(1)} MB) — re-slices need no refetch`);
} catch (e) { console.log(`[due] WARN could not write the fact set: ${e.message}`); }
console.log("");

// ── ATTRIBUTION MODES ──────────────────────────────────────────────────────
//   loose      the FIRST 2.02 after P                      (the original rule)
//   strict     the first 2.02 that ALSO carries 9.01       (may resolve to none)
//   corrected  strict where it resolves, else loose        (never newly strands)
const hasBoth = (items) => /\b2\.02\b/.test(items) && /\b9\.01\b/.test(items);
function pick(period, mode) {
  const cs = period.candidates;
  if (!cs.length) return null;
  if (mode === "loose") return cs[0];
  const strict = cs.filter((x) => hasBoth(x.items));
  if (mode === "strict") return strict[0] ?? null;
  return strict[0] ?? cs[0];
}
function pairsFor(s, mode) {
  const out = [];
  for (const p of s.periods) { const chosen = pick(p, mode); if (chosen) out.push({ P: p.P, R: chosen.R, lag: days(chosen.R, p.P) }); }
  return out;
}

// ── 2. THE 9.01 QUESTION ───────────────────────────────────────────────────
const multi = { total: 0, strictOne: 0, strictAmbiguous: 0, strictZero: 0, looseOutlier: 0, correctedOutlier: 0, scored: 0, changed: 0 };
for (const s of symbols) {
  if (s.isFpi) continue; // 6-K carries no items field; the rule does not apply
  const medLoose = median(pairsFor(s, "loose").map((p) => p.lag));
  const medCorr = median(pairsFor(s, "corrected").map((p) => p.lag));
  for (const p of s.periods) {
    if (p.candidates.length <= 1) continue;
    multi.total++;
    const strict = p.candidates.filter((x) => hasBoth(x.items));
    if (strict.length === 1) multi.strictOne++;
    else if (strict.length > 1) multi.strictAmbiguous++;
    else multi.strictZero++;
    const l = pick(p, "loose"), k2 = pick(p, "corrected");
    if (l && k2 && l.R !== k2.R) multi.changed++;
    if (medLoose != null && l) { multi.scored++; if (Math.abs(days(l.R, p.P) - medLoose) > OUTLIER_DAYS) multi.looseOutlier++; }
    if (medCorr != null && k2 && Math.abs(days(k2.R, p.P) - medCorr) > OUTLIER_DAYS) multi.correctedOutlier++;
  }
}

// ── The simulation ─────────────────────────────────────────────────────────
function buildIntervals(k, mode, allowed) {
  const intervals = []; let fn = 0; const dwells = []; const residues = [];
  for (const s of symbols) {
    if (allowed && !allowed.has(s.symbol)) continue;
    const pairs = pairsFor(s, mode);
    for (let i = 0; i < s.periodEnds.length; i++) {
      const P = s.periodEnds[i];
      const nextP = s.periodEnds[i + 1] ?? Infinity;
      const pair = pairs.find((p) => p.P === P);
      const R = pair?.R ?? null;
      const horizonEnd = Math.min(R ?? Infinity, nextP, NOW);
      if (horizonEnd < WINDOW_START || P > NOW) continue;
      const priorLags = pairs.filter((p) => p.R < P).map((p) => p.lag);
      if (priorLags.length < MIN_PRIOR_LAGS) continue;
      const E = P + (Math.round(median(priorLags)) - k) * DAY;
      const exit = R ?? Math.min(nextP, NOW);
      if (R != null && R < E) { fn++; continue; }
      if (R != null) dwells.push(days(R, Math.max(E, P)));
      if (exit > E) {
        intervals.push({ symbol: s.symbol, start: E, end: exit, P, deadline: s.deadline });
        if (R == null) residues.push({ symbol: s.symbol, P, end: exit, lenDays: days(exit, E), formMix: s.formMix, isFpi: s.isFpi, nextGapDays: Number.isFinite(nextP) ? days(nextP, P) : null });
      }
    }
  }
  return { intervals, fn, dwells, residues };
}

const allDays = []; for (let t = WINDOW_START; t <= NOW; t += DAY) allDays.push(t);
const weekStart = (t) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - d.getUTCDay()); };
const filingsPerWeek = new Map();
for (const s of symbols) for (const p of pairsFor(s, "loose")) { if (p.R < WINDOW_START || p.R > NOW) continue; const w = weekStart(p.R); filingsPerWeek.set(w, (filingsPerWeek.get(w) ?? 0) + 1); }
const weeks = [...new Set(allDays.map(weekStart))].sort((a, b) => a - b);
const wc = weeks.map((w) => filingsPerWeek.get(w) ?? 0);
const peakCut = quantile(wc, 0.75), quietCut = quantile(wc, 0.25);
// PEAK IS DEFINED ON THE FULL UNIVERSE AND HELD FIXED ACROSS EVERY CELL. A
// top-20 cut has its own seasonality, but re-deriving peak per subset would make
// the cells incomparable -- each would be scored against a different calendar.
const isPeak = (w) => (filingsPerWeek.get(w) ?? 0) >= peakCut;
const isQuiet = (w) => (filingsPerWeek.get(w) ?? 0) <= quietCut;
const peakDays = allDays.filter((t) => isPeak(weekStart(t)));
const quietDays = allDays.filter((t) => isQuiet(weekStart(t)));

function measure(k, mode, allowed) {
  const { intervals, fn, dwells, residues } = buildIntervals(k, mode, allowed);
  const byDay = new Map(); const overdue = [];
  for (const t of allDays) {
    let n = 0, o = 0;
    for (const iv of intervals) if (t >= iv.start && t < iv.end) { n++; if (t > iv.P + iv.deadline * DAY) o++; }
    byDay.set(t, n); overdue.push(o);
  }
  const at = (ts) => ts.map((t) => byDay.get(t) ?? 0);
  const daily = at(allDays);
  return {
    med: median(daily), p90: quantile(daily, 0.9), max: Math.max(...daily, 0),
    peakMed: median(at(peakDays)), peakMax: Math.max(...at(peakDays), 0),
    quietMed: median(at(quietDays)),
    fn, fnRate: fn / Math.max(1, fn + dwells.length), scored: fn + dwells.length,
    dwellMed: median(dwells), dwellP90: quantile(dwells, 0.9),
    overMed: median(overdue), overP90: quantile(overdue, 0.9), overMax: Math.max(...overdue, 0),
    residues,
  };
}

for (const s of symbols) { const p = pairsFor(s, "loose"); c.matchedLoose += p.length; c.unmatchedLoose += s.periodEnds.length - p.length; if (p.length >= 8) c.withEight++; }

const capRanked = symbols.filter((s) => s.marketCap != null).sort((a, b) => b.marketCap - a.marketCap);
const topN = (n) => new Set(capRanked.slice(0, n).map((s) => s.symbol));

// ── Report ─────────────────────────────────────────────────────────────────
console.log(`
================================================================
DUE-TO-REPORT RE-SLICES — ${new Date().toISOString()}
window ${iso(WINDOW_START)} .. ${iso(NOW)} · universe ${analysis.length}
================================================================

COUNTERS
  fetched OK ${c.fetched} · FAILED ${c.fetchFailed} · no CIK ${c.noCik} · paged ${c.paged} · still short of 3y ${c.shortHistory}
  symbols with usable period ends ${c.withPeriodEnds} · with >= 8 results ${c.withEight}
  filings matched (loose) ${c.matchedLoose} · periods unmatched ${c.unmatchedLoose} (${pct(c.unmatchedLoose, c.matchedLoose + c.unmatchedLoose)})
  symbols with a pool market cap ${capRanked.length} of ${symbols.length}
  peak = >= ${peakCut} filings/wk · quiet = <= ${quietCut} · peak weeks ${weeks.filter(isPeak).length}

────────────────────────────────────────────────────────────────
2. DOES 2.02 AND 9.01 RESOLVE THE AMBIGUITY?
────────────────────────────────────────────────────────────────
  multi-candidate periods (domestic)   ${multi.total}
  resolve to EXACTLY ONE under strict  ${multi.strictOne}  (${pct(multi.strictOne, multi.total)})
  still ambiguous (>1 carry both)      ${multi.strictAmbiguous}  (${pct(multi.strictAmbiguous, multi.total)})
  resolve to ZERO (rule too strict)    ${multi.strictZero}  (${pct(multi.strictZero, multi.total)})
  periods where the pick CHANGED       ${multi.changed}

  lag-outlier rate among the chosen filing, same denominator (${multi.scored}):
    loose (the 51.5% baseline)         ${multi.looseOutlier}  (${pct(multi.looseOutlier, multi.scored)})
    corrected (strict, else loose)     ${multi.correctedOutlier}  (${pct(multi.correctedOutlier, multi.scored)})

────────────────────────────────────────────────────────────────
1. MARKET-CAP CUTS — peak median / peak max / false-negative rate
   peak weeks fixed on the FULL universe so cells stay comparable
────────────────────────────────────────────────────────────────`);

for (const mode of ["loose", "corrected"]) {
  console.log(`\nattribution = ${mode}\n`);
  console.log(`| universe | k=3 peak med / max / FN | k=5 peak med / max / FN | k=7 peak med / max / FN |`);
  console.log(`|---|---|---|---|`);
  for (const cut of [...CAP_CUTS, null]) {
    const allowed = cut ? topN(cut) : null;
    const cells = CAP_KS.map((k) => { const m = measure(k, mode, allowed); return `${m.peakMed} / ${m.peakMax} / ${pct(m.fn, m.scored)}`; });
    console.log(`| ${cut ? `top ${cut}` : `all ${symbols.length}`} | ${cells.join(" | ")} |`);
  }
}

console.log(`
────────────────────────────────────────────────────────────────
FULL k SWEEP UNDER THE CORRECTED ATTRIBUTION
────────────────────────────────────────────────────────────────

| k | list med | p90 | max | peak med | peak max | quiet med | false-neg | dwell med | dwell p90 | overdue med | overdue max |
|---|---|---|---|---|---|---|---|---|---|---|---|`);
let residueSample = [];
for (const k of K_VALUES) {
  const m = measure(k, "corrected", null);
  if (k === 7) residueSample = m.residues;
  console.log(`| ${k} | ${m.med} | ${m.p90} | ${m.max} | ${m.peakMed} | ${m.peakMax} | ${m.quietMed} | ${pct(m.fn, m.scored)} | ${m.dwellMed} | ${m.dwellP90} | ${m.overMed} | ${m.overMax} |`);
}

console.log(`
────────────────────────────────────────────────────────────────
3. THE LONG RESIDUES — symbols that entered and never cleared (k=7)
────────────────────────────────────────────────────────────────
  unmatched-period intervals in window ${residueSample.length}

| symbol | period end | days on list | gap to next period end | FPI | forms filed |
|---|---|---|---|---|---|`);
for (const r of [...residueSample].sort((a, b) => b.lenDays - a.lenDays).slice(0, 25)) {
  console.log(`| ${r.symbol} | ${iso(r.P)} | ${r.lenDays} | ${r.nextGapDays ?? "none — no next period end"} | ${r.isFpi ? "yes" : "no"} | ${r.formMix.join(" ")} |`);
}
const annualish = residueSample.filter((r) => r.nextGapDays == null || r.nextGapDays > 200);
console.log(`
  intervals whose next period end is >200d away (or absent): ${annualish.length} of ${residueSample.length} (${pct(annualish.length, residueSample.length)})
  longest residue overall: ${Math.max(...residueSample.map((r) => r.lenDays), 0)} days
  = whether the 198-day tail is annual-filer shaped, measured rather than assumed.

NOT A PRODUCT DECISION. Numbers only.
================================================================
`);
