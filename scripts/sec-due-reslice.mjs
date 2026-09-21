// Re-slice the due-to-report simulation. NO NETWORK AT ALL.
//
// Reads data/sec/due-sweep-facts.json -- the fact set the sweep now persists --
// and recomputes against it. The whole point of writing that file was that a
// follow-up question should not cost another pass over ~700 symbols, and this is
// the first cash-in: the sweep's inputs were discarded twice before, and each
// re-slice paid the full fetch again.
//
// THIS SCRIPT MAKES NO REQUESTS. If the fact set is missing it fails loudly
// rather than falling back to fetching, because a "free" re-slice that quietly
// re-fetches is the same lie as a dump that reports absence it caused.
import fs from "node:fs";
import path from "node:path";

const DAY = 86_400_000;
const K = Number(process.env.RESLICE_K ?? 7);
const TOP_N = Number(process.env.RESLICE_TOP ?? 50);
const MIN_PRIOR_LAGS = 3;
const OUTLIER_DAYS = 10;
const CAP_DAYS = 30; // the proposed "past deadline + 30" expiry

// ── Find the fact set ──────────────────────────────────────────────────────
// The relay downloads the previous run's artifact into dump/, and that artifact
// was rooted at the workspace, so the file lands at dump/data/sec/... rather
// than where it was written. Search rather than assume the depth.
function findFacts(root) {
  const stack = [root, "data/sec", "."];
  const seen = new Set();
  while (stack.length) {
    const dir = stack.pop();
    if (!dir || seen.has(dir) || !fs.existsSync(dir)) continue;
    seen.add(dir);
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (seen.size < 4000) stack.push(p); continue; }
      if (e.name === "due-sweep-facts.json") return p;
    }
  }
  return null;
}
const DUMP = process.argv[2] || process.env.DUMP_DIR || "";
const factsPath = findFacts(DUMP ? path.resolve(DUMP, "..", "..") : "dump");
if (!factsPath) {
  console.error("FATAL: due-sweep-facts.json not found under the downloaded artifact.");
  console.error("This re-slice reads the persisted fact set and makes NO requests. Dispatch the");
  console.error("relay with run_id/artifact_name pointing at a sec-due-sweep run that wrote it.");
  process.exit(1);
}
const facts = JSON.parse(fs.readFileSync(factsPath, "utf8"));
console.log(`[reslice] fact set ${factsPath} · ${(fs.statSync(factsPath).size / 1048576).toFixed(1)} MB · extracted ${facts.extractedAt}`);
console.log(`[reslice] window ${facts.windowStart} .. ${facts.windowEnd} · symbols ${facts.symbols.length} · k=${K} · top ${TOP_N} by cap`);
console.log(`[reslice] requests made: 0`);
console.log("");

const parse = (d) => Date.parse(`${d}T00:00:00.000Z`);
const days = (a, b) => Math.round((a - b) / DAY);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");
const iso = (t) => new Date(t).toISOString().slice(0, 10);

const WINDOW_START = parse(facts.windowStart);
const NOW = parse(facts.windowEnd);

const symbols = facts.symbols.map((s) => ({
  ...s,
  deadline: /large accelerated/i.test(s.category ?? "") ? 40 : 45,
  periods: s.periods.map((p) => ({ P: parse(p.P), candidates: p.candidates.map((x) => ({ R: parse(x.R), items: x.items ?? "" })) })),
}));

const hasBoth = (items) => /\b2\.02\b/.test(items) && /\b9\.01\b/.test(items);
const pickCorrected = (p) => { const cs = p.candidates; if (!cs.length) return null; return cs.filter((x) => hasBoth(x.items))[0] ?? cs[0]; };
const pickLoose = (p) => p.candidates[0] ?? null;
const pairsFor = (s) => s.periods.map((p) => { const ch = pickCorrected(p); return ch ? { P: p.P, R: ch.R, lag: days(ch.R, p.P) } : null; }).filter(Boolean);

const capRanked = symbols.filter((s) => s.marketCap != null).sort((a, b) => b.marketCap - a.marketCap);
const top = new Set(capRanked.slice(0, TOP_N).map((s) => s.symbol));

// ── The intervals, same construct as the sweep ─────────────────────────────
function intervalsFor(allowed) {
  const out = [];
  for (const s of symbols) {
    if (allowed && !allowed.has(s.symbol)) continue;
    const pairs = pairsFor(s);
    const ends = s.periods.map((p) => p.P).sort((a, b) => a - b);
    for (let i = 0; i < ends.length; i++) {
      const P = ends[i];
      const nextP = ends[i + 1] ?? Infinity;
      const pair = pairs.find((p) => p.P === P);
      const R = pair?.R ?? null;
      if (Math.min(R ?? Infinity, nextP, NOW) < WINDOW_START || P > NOW) continue;
      const priorLags = pairs.filter((p) => p.R < P).map((p) => p.lag);
      if (priorLags.length < MIN_PRIOR_LAGS) continue;
      const E = P + (Math.round(median(priorLags)) - K) * DAY;
      const exit = R ?? Math.min(nextP, NOW);
      if (R != null && R < E) continue;         // false negative, never on the list
      if (exit <= E) continue;
      out.push({ symbol: s.symbol, P, E, exit, R, deadline: s.deadline, marketCap: s.marketCap });
    }
  }
  return out;
}

const ivTop = intervalsFor(top);
const ivAll = intervalsFor(null);

// An entry is OVERDUE-TOUCHING if it was still on the list past the statutory
// deadline. Duration counts only the days past that line, not total dwell.
function overdueOf(ivs) {
  return ivs
    .map((iv) => {
      const line = iv.P + iv.deadline * DAY;
      const end = Math.min(iv.exit, NOW);
      if (end <= line) return null;
      return { ...iv, line, overdueDays: days(end, Math.max(line, iv.E)), clearedByFiling: iv.R != null };
    })
    .filter(Boolean);
}
const odTop = overdueOf(ivTop);
const odAll = overdueOf(ivAll);

// ── Attribution ambiguity, restricted vs universe ──────────────────────────
function ambiguity(allowed) {
  let periodsWithCandidates = 0, multi = 0, outlierLoose = 0, outlierCorrected = 0, scored = 0;
  for (const s of symbols) {
    if (allowed && !allowed.has(s.symbol)) continue;
    if (s.isFpi) continue; // 6-K carries no items; the 9.01 rule cannot apply
    // EACH MODE IS SCORED AGAINST ITS OWN MEDIAN, as the sweep does. Testing the
    // loose pick against the corrected median would measure the difference
    // between the two rules rather than the outlier rate of either.
    const medL = median(s.periods.filter((p) => p.candidates.length).map((p) => days(pickLoose(p).R, p.P)));
    const medC = median(pairsFor(s).map((p) => p.lag));
    for (const p of s.periods) {
      if (!p.candidates.length) continue;
      periodsWithCandidates++;
      if (p.candidates.length <= 1) continue;
      multi++;
      scored++;
      const l = pickLoose(p), cch = pickCorrected(p);
      if (medL != null && l && Math.abs(days(l.R, p.P) - medL) > OUTLIER_DAYS) outlierLoose++;
      if (medC != null && cch && Math.abs(days(cch.R, p.P) - medC) > OUTLIER_DAYS) outlierCorrected++;
    }
  }
  return { periodsWithCandidates, multi, multiRate: multi / Math.max(1, periodsWithCandidates), outlierLoose, outlierCorrected, scored };
}
const ambTop = ambiguity(top);
const ambAll = ambiguity(null);

// ── Report ─────────────────────────────────────────────────────────────────
console.log(`
================================================================
OVERDUE AND ATTRIBUTION, RESTRICTED TO THE SHIPPED CUT
top ${TOP_N} by market cap · k = ${K} · corrected attribution · no requests
================================================================

THE SLICE
  symbols with a market cap        ${capRanked.length}
  top ${TOP_N} smallest cap in cut      ${capRanked[TOP_N - 1] ? `$${(capRanked[TOP_N - 1].marketCap / 1e9).toFixed(1)}B (${capRanked[TOP_N - 1].symbol})` : "—"}
  list intervals in window, top ${TOP_N}  ${ivTop.length}
  list intervals in window, all      ${ivAll.length}

1. OVERDUE ENTRIES WITHIN THE SHIPPED CUT, 12 months

  overdue entries, top ${TOP_N}           ${odTop.length}
  overdue entries, full universe    ${odAll.length}
  top-${TOP_N} share of all overdue       ${pct(odTop.length, odAll.length)}
`);

if (!odTop.length) {
  console.log(`  NONE. Measured, not assumed: ${ivTop.length} list intervals were examined over the
  12-month window and not one crossed its statutory deadline while still on the
  list. Every entry in the shipped cut cleared before the 40/45-day line.

  A badge that did not fire once in twelve months across the names it covers is a
  safeguard, not a routine state.`);
} else {
  console.log(`| symbol | period end | deadline day | days overdue | cleared by a filing? |`);
  console.log(`|---|---|---|---|---|`);
  for (const o of [...odTop].sort((a, b) => b.overdueDays - a.overdueDays)) {
    console.log(`| ${o.symbol} | ${iso(o.P)} | ${iso(o.line)} | ${o.overdueDays} | ${o.clearedByFiling ? "yes" : "no — still open at window end"} |`);
  }
  const durs = odTop.map((o) => o.overdueDays);
  console.log(`
  durations: median ${median(durs)} · max ${Math.max(...durs)} · total symbol-days ${durs.reduce((a, b) => a + b, 0)}
  distinct symbols: ${new Set(odTop.map((o) => o.symbol)).size} (${[...new Set(odTop.map((o) => o.symbol))].sort().join(" ")})`);
}

const wouldClear = odTop.filter((o) => o.overdueDays > CAP_DAYS);
const wouldLeave = odTop.filter((o) => o.overdueDays <= CAP_DAYS);
console.log(`
2. WHAT A "DEADLINE + ${CAP_DAYS} DAYS" CAP WOULD DO, top ${TOP_N}

  entries the cap would CLEAR early   ${wouldClear.length}${wouldClear.length ? `  (${wouldClear.map((o) => `${o.symbol} ${o.overdueDays}d`).join(", ")})` : ""}
  entries it would LEAVE untouched    ${wouldLeave.length}
  symbol-days removed from the list   ${wouldClear.reduce((a, o) => a + (o.overdueDays - CAP_DAYS), 0)}

  And the same cap against the FULL universe, for contrast:
  would clear ${odAll.filter((o) => o.overdueDays > CAP_DAYS).length} of ${odAll.length} · symbol-days removed ${odAll.filter((o) => o.overdueDays > CAP_DAYS).reduce((a, o) => a + (o.overdueDays - CAP_DAYS), 0)}

3. ATTRIBUTION AMBIGUITY — is the shipped cut's 3.0% solid or an upper bound?

| slice | periods with >=1 candidate | multi-candidate | multi rate | lag-outlier (loose) | lag-outlier (corrected) |
|---|---|---|---|---|---|
| top ${TOP_N} | ${ambTop.periodsWithCandidates} | ${ambTop.multi} | ${pct(ambTop.multi, ambTop.periodsWithCandidates)} | ${pct(ambTop.outlierLoose, ambTop.scored)} | ${pct(ambTop.outlierCorrected, ambTop.scored)} |
| full universe | ${ambAll.periodsWithCandidates} | ${ambAll.multi} | ${pct(ambAll.multi, ambAll.periodsWithCandidates)} | ${pct(ambAll.outlierLoose, ambAll.scored)} | ${pct(ambAll.outlierCorrected, ambAll.scored)} |

  If the top-${TOP_N} multi rate and outlier rate sit BELOW the universe figures, the
  ambiguity is concentrated in the tail and the shipped cut's false-negative rate
  is a measurement. If they sit at or above, that rate is carrying unresolved
  attribution error and is an UPPER BOUND on accuracy, not a measurement of it.

NOT A PRODUCT DECISION. Numbers only.
================================================================
`);
