// PHASE 0: does Stooq adjust for dividends the way FMP does?
//
// THIS RUNS BEFORE ANY INGEST IS WRITTEN, because the answer changes how the A5
// diff must be read rather than whether the migration proceeds.
//
// FMP's historical-price-eod/full serves ADJUSTED closes. Stooq is widely
// understood to serve SPLIT-adjusted but not DIVIDEND-adjusted prices. If that
// holds here, every moving average on every dividend payer shifts, and the
// WEEKLY MA200 picker is the most exposed because it reaches back five years.
// A5 would then show section changes that are CORRECT rather than defects, and
// that has to be known before anyone reads the diff.
//
// THE METHOD. Align Stooq's close against the SAME SYMBOL AND DATE in the frozen
// dump (run 34690240239, dumpedAt 2026-09-12T11:08:18.572Z) and look at the
// RATIO stooq/frozen over time:
//
//   flat at ~1.0 throughout          -> same methodology. Best case.
//   drifts monotonically going back  -> dividend adjustment differs. Expected case.
//   steps only at a few dates        -> split handling differs at those dates.
//
// THE CONTROL IS WHAT MAKES IT CONCLUSIVE, not the drift itself. High-dividend
// payers are compared against non-payers: if KO/XOM/T drift and GOOGL/BRK.B do
// not, the drift is dividends and nothing else. Drift on a non-payer would mean
// something else is going on and the dividend story is wrong.
//
// WHY IT RUNS IN ACTIONS. stooq.com answers 403 CONNECT from the agent sandbox
// (re-tested 2026-09-12T13:01Z, policy denial, not retried), and the frozen dump
// lives as an Actions artifact whose download redirects to a blob host the
// sandbox also cannot reach. A runner has both.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import readline from "node:readline";

const DIR = path.resolve(process.argv[2] ?? "step0-dump");
const UA =
  process.env.STOOQ_USER_AGENT ??
  "MyStockHarbor/1.0 (+https://www.mystockharbor.com; data-provider evaluation)";

// Payers first, non-payers second -- the split is the control, so it is declared
// as data rather than inferred from the ticker.
const PAYERS = (process.env.PAYERS ?? "KO,XOM,T").split(",").map((s) => s.trim()).filter(Boolean);
const NONPAYERS = (process.env.NONPAYERS ?? "GOOGL,BRK.B").split(",").map((s) => s.trim()).filter(Boolean);
const ALL = [...PAYERS, ...NONPAYERS];

const isPayer = (sym) => PAYERS.includes(sym);

// ── STOOQ SPELLING: THE THIRD CONVENTION ─────────────────────────────────────
// The repo stores BRK.B. FMP wants BRK-B (measured: its screener rows are dashed).
// Stooq wants lowercase with a .us suffix, and its treatment of the class
// separator is exactly what this probe needs to establish rather than assume --
// so candidates are TRIED IN ORDER and the one that returns real CSV is reported.
const stooqCandidates = (sym) => {
  const base = sym.toLowerCase();
  const out = [`${base}.us`];
  if (sym.includes(".")) {
    out.push(`${base.replace(/\./g, "-")}.us`); // brk-b.us
    out.push(`${base.replace(/\./g, "")}.us`); // brkb.us
  }
  return out;
};

const EXPECTED_HEADER = "Date,Open,High,Low,Close,Volume";

/**
 * THE PARSER IS STRICT ON PURPOSE. An earlier build of this site was served HTML
 * where it expected CSV and carried on parsing it, so the failure surfaced as
 * wrong numbers rather than an error. Anything that is not the exact expected
 * header is a throw with the first 200 characters attached, so the log says what
 * actually came back.
 */
function parseStooqCsv(text, label) {
  const head = text.slice(0, 200).replace(/\s+/g, " ");
  if (/^\s*</.test(text)) {
    throw new Error(`${label}: got HTML, not CSV — "${head}"`);
  }
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) throw new Error(`${label}: empty response`);
  if (lines[0].trim() !== EXPECTED_HEADER) {
    // "Exceeded the daily hits limit", "No data", a redirect page -- all land here.
    throw new Error(
      `${label}: first line is not the expected CSV header. Got "${lines[0].trim()}" — "${head}"`
    );
  }
  const rows = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const [date, open, high, low, close, volume] = line.split(",");
    const c = Number(close);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(c)) continue;
    rows.push({
      date,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: c,
      volume: Number(volume),
    });
  }
  if (rows.length < 50) {
    throw new Error(`${label}: only ${rows.length} parseable rows — not a usable series`);
  }
  return rows;
}

async function fetchStooq(sym) {
  const errors = [];
  for (const candidate of stooqCandidates(sym)) {
    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(candidate)}&i=d`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) {
        errors.push(`${candidate}: HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      const rows = parseStooqCsv(text, candidate);
      return { candidate, rows, url };
    } catch (e) {
      errors.push(String(e?.message ?? e));
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return { candidate: null, rows: null, errors };
}

// ── The frozen side ──────────────────────────────────────────────────────────
async function frozenSeries(symbols) {
  const p = path.join(DIR, "history-bars.ndjson.gz");
  if (!fs.existsSync(p)) {
    console.error(`FATAL: no history-bars.ndjson.gz under ${DIR} — nothing to compare against.`);
    process.exit(1);
  }
  const want = new Set(symbols);
  const out = new Map();
  const rl = readline.createInterface({
    input: fs.createReadStream(p).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row?._meta || !row?.symbol) continue;
      if (!want.has(String(row.symbol))) continue;
      const daily = Array.isArray(row?.entry?.daily) ? row.entry.daily : [];
      out.set(String(row.symbol), daily);
    } catch {
      // a truncated final line is not worth failing the probe over
    }
  }
  return out;
}

const pct = (n) => (Number.isFinite(n) ? `${(n * 100).toFixed(3)}%` : "n/a");

console.log("PHASE 0 — Stooq vs the frozen FMP bars: adjustment methodology");
console.log(`dump dir     ${DIR}`);
console.log(`payers       ${PAYERS.join(", ")}`);
console.log(`non-payers   ${NONPAYERS.join(", ")}  <- the control`);

const frozen = await frozenSeries(ALL);
const results = {};

for (const sym of ALL) {
  console.log(`\n── ${sym} ${isPayer(sym) ? "(dividend payer)" : "(NON-payer, control)"} ──`);
  const fz = frozen.get(sym) ?? [];
  if (!fz.length) {
    console.log(`  SKIP: no frozen series in the dump for ${sym}`);
    results[sym] = { error: "no frozen series" };
    continue;
  }
  const got = await fetchStooq(sym);
  if (!got.rows) {
    console.log(`  STOOQ FETCH FAILED, all spellings tried:`);
    for (const e of got.errors) console.log(`    ${e}`);
    results[sym] = { error: "stooq fetch failed", attempts: got.errors };
    continue;
  }
  console.log(`  stooq spelling that worked: ${got.candidate}  (${got.rows.length} rows)`);
  console.log(
    `  frozen ${fz[0]?.date}..${fz[fz.length - 1]?.date} (${fz.length} bars) · ` +
      `stooq ${got.rows[0]?.date}..${got.rows[got.rows.length - 1]?.date}`
  );

  // Align on DATE. A date present in one and not the other is a PRESENCE
  // difference and belongs in the other bucket -- it is counted, not ratioed.
  const stooqByDate = new Map(got.rows.map((r) => [r.date, r]));
  const pairs = [];
  let frozenOnly = 0;
  for (const bar of fz) {
    const s = stooqByDate.get(bar.date);
    if (!s) {
      frozenOnly++;
      continue;
    }
    if (!Number.isFinite(bar.close) || bar.close === 0) continue;
    pairs.push({
      date: bar.date,
      ratioClose: s.close / bar.close,
      ratioHigh:
        Number.isFinite(bar.high) && bar.high ? s.high / bar.high : null,
      ratioLow: Number.isFinite(bar.low) && bar.low ? s.low / bar.low : null,
    });
  }
  const stooqOnly = got.rows.filter((r) => !fz.some((b) => b.date === r.date)).length;

  if (pairs.length < 50) {
    console.log(`  only ${pairs.length} aligned dates — too few to judge methodology`);
    results[sym] = { error: "insufficient overlap", aligned: pairs.length };
    continue;
  }

  // THE SHAPE OF THE RATIO OVER TIME is the whole answer. Reported at buckets
  // rather than as one average, because an average of a drifting series hides
  // exactly the drift this probe exists to find.
  const newest = pairs[pairs.length - 1];
  const bucketAt = (yearsBack) => {
    const target = new Date(newest.date);
    target.setUTCFullYear(target.getUTCFullYear() - yearsBack);
    const iso = target.toISOString().slice(0, 10);
    let best = null;
    for (const p of pairs) if (p.date <= iso) best = p;
    return best;
  };
  const buckets = [
    ["newest", newest],
    ["1y back", bucketAt(1)],
    ["2y back", bucketAt(2)],
    ["3y back", bucketAt(3)],
    ["5y back", bucketAt(5)],
  ];
  console.log(`  aligned ${pairs.length} dates · frozen-only ${frozenOnly} · stooq-only ${stooqOnly}`);
  console.log(`  ratio stooq/frozen (close), by age:`);
  for (const [label, p] of buckets) {
    if (!p) {
      console.log(`    ${label.padEnd(9)} —`);
      continue;
    }
    console.log(
      `    ${label.padEnd(9)} ${p.date}  ${p.ratioClose.toFixed(6)}  (${pct(p.ratioClose - 1)} from parity)`
    );
  }

  // STEP DETECTION. A methodology difference in DIVIDENDS drifts smoothly; a
  // difference in SPLIT handling steps at one date and holds. Distinguishing them
  // decides whether the fix is an adjustment factor or a corporate-action table.
  const steps = [];
  for (let i = 1; i < pairs.length; i++) {
    const rel = pairs[i].ratioClose / pairs[i - 1].ratioClose;
    if (Math.abs(rel - 1) > 0.02) {
      steps.push({ date: pairs[i].date, jump: rel, from: pairs[i - 1].ratioClose, to: pairs[i].ratioClose });
    }
  }
  const ratios = pairs.map((p) => p.ratioClose);
  const minR = Math.min(...ratios);
  const maxR = Math.max(...ratios);
  const spread = maxR - minR;
  const monotonicity = (() => {
    // Fraction of consecutive steps moving the same direction as the overall
    // drift. Near 1.0 means smooth drift; near 0.5 means noise.
    const overall = Math.sign(ratios[0] - ratios[ratios.length - 1]);
    if (overall === 0) return 0;
    let same = 0;
    for (let i = 1; i < ratios.length; i++) {
      if (Math.sign(ratios[i - 1] - ratios[i]) === overall) same++;
    }
    return same / (ratios.length - 1);
  })();

  const hiRatios = pairs.map((p) => p.ratioHigh).filter(Number.isFinite);
  const loRatios = pairs.map((p) => p.ratioLow).filter(Number.isFinite);
  const meanAbsDev = (arr) =>
    arr.length ? arr.reduce((a, b) => a + Math.abs(b - 1), 0) / arr.length : null;
  const maxAbsDev = (arr) => (arr.length ? Math.max(...arr.map((b) => Math.abs(b - 1))) : null);

  console.log(`  ratio spread across the series: ${spread.toFixed(6)}  (min ${minR.toFixed(6)}, max ${maxR.toFixed(6)})`);
  console.log(`  monotonic fraction: ${monotonicity.toFixed(3)}  (1.0 = smooth drift, ~0.5 = noise)`);
  console.log(`  steps >2% between adjacent bars: ${steps.length}`);
  for (const s of steps.slice(0, 8)) {
    console.log(`    ${s.date}  x${s.jump.toFixed(4)}  (${s.from.toFixed(4)} -> ${s.to.toFixed(4)})`);
  }
  // HIGH AND LOW TOO, NOT JUST CLOSE. The pattern builders read high and low, so
  // a close-only comparison would clear a source that is wrong where the
  // bull-flag and descending-triangle detectors actually look.
  console.log(
    `  high: mean |dev| ${pct(meanAbsDev(hiRatios))} · max ${pct(maxAbsDev(hiRatios))}  ` +
      `(${hiRatios.length} pairs)`
  );
  console.log(
    `  low : mean |dev| ${pct(meanAbsDev(loRatios))} · max ${pct(maxAbsDev(loRatios))}  ` +
      `(${loRatios.length} pairs)`
  );

  results[sym] = {
    payer: isPayer(sym),
    stooqSpelling: got.candidate,
    stooqRows: got.rows.length,
    frozenBars: fz.length,
    frozenRange: [fz[0]?.date, fz[fz.length - 1]?.date],
    aligned: pairs.length,
    frozenOnly,
    stooqOnly,
    ratioNewest: newest.ratioClose,
    buckets: buckets.map(([label, p]) => ({ label, date: p?.date ?? null, ratio: p?.ratioClose ?? null })),
    ratioMin: minR,
    ratioMax: maxR,
    ratioSpread: spread,
    monotonicFraction: monotonicity,
    steps,
    highMeanAbsDev: meanAbsDev(hiRatios),
    highMaxAbsDev: maxAbsDev(hiRatios),
    lowMeanAbsDev: meanAbsDev(loRatios),
    lowMaxAbsDev: maxAbsDev(loRatios),
  };
}

// ── THE VERDICT, and it rests on the CONTRAST rather than on any one series ───
console.log(`\n══ VERDICT ══`);
const ok = Object.entries(results).filter(([, r]) => !r.error);
if (ok.length < 2) {
  console.log("  INCONCLUSIVE — fewer than two symbols produced a comparison.");
  console.log("  Do not proceed to the ingest on this; the failures above are the finding.");
} else {
  const payerSpreads = ok.filter(([, r]) => r.payer).map(([, r]) => r.ratioSpread);
  const nonSpreads = ok.filter(([, r]) => !r.payer).map(([, r]) => r.ratioSpread);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const payerAvg = avg(payerSpreads);
  const nonAvg = avg(nonSpreads);
  console.log(`  mean ratio spread — payers ${payerAvg?.toFixed(6) ?? "n/a"} (n=${payerSpreads.length}) · non-payers ${nonAvg?.toFixed(6) ?? "n/a"} (n=${nonSpreads.length})`);
  const FLAT = 0.005; // 0.5% across five years is not a methodology difference
  const allFlat = ok.every(([, r]) => r.ratioSpread < FLAT);
  const payersDrift = payerAvg != null && payerAvg >= FLAT;
  const nonPayersFlat = nonAvg != null && nonAvg < FLAT;
  const smooth = ok.filter(([, r]) => r.payer).every(([, r]) => r.monotonicFraction > 0.8);

  if (allFlat) {
    console.log("  FLAT AGREEMENT — same methodology. Best case: A5 differences are");
    console.log("  about Stooq's data quality, not about adjustment.");
  } else if (payersDrift && nonPayersFlat && smooth) {
    console.log("  DIVIDEND ADJUSTMENT DIFFERS. Payers drift smoothly, non-payers do not.");
    console.log("  CONSEQUENCE: every MA on every dividend payer shifts, weekly MA200 most");
    console.log("  of all (5-year reach). A5 section changes on payers are CORRECT, not");
    console.log("  defects. The owner must be told this BEFORE reading the A5 diff.");
  } else if (payersDrift && nonPayersFlat) {
    console.log("  PAYERS DIFFER FROM NON-PAYERS, but the drift is not smooth — check the");
    console.log("  step list above. Could be split handling rather than dividends.");
  } else {
    console.log("  MIXED / UNEXPECTED — non-payers also differ, so this is not a dividend");
    console.log("  story. Read the per-symbol steps before concluding anything.");
  }
}

const outPath = path.join(DIR, "PHASE0-ADJUSTMENT.json");
fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), payers: PAYERS, nonPayers: NONPAYERS, results }, null, 2));
console.log(`\nwrote ${path.relative(process.cwd(), outPath)}`);
