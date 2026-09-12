// Re-analyse a Step 0 dump. READS THE ARTEFACT, NEVER REDIS.
//
// WHY THIS IS SEPARATE FROM THE DUMP. The 2026-09-12T11:08:18Z dump is the
// canonical freeze and must not be re-taken to answer a question about it -- the
// profile dataset is on a 30-day TTL with only ~50 of 651 refreshed, so a second
// dump is a DIFFERENT and strictly worse snapshot. Every question about what was
// frozen has to be answered from the frozen files.
//
// It also cannot be answered from this sandbox: api.github.com is reachable but
// the artifact download redirects to productionresultssa13.blob.core.windows.net,
// which the egress policy denies. A runner can fetch it; this session cannot. So
// the analysis runs where the artefact is.
//
// WHAT IT FIXES, and the defect is in the ORIGINAL REPORT rather than the dump.
// The dump scored every dataset against ONE union denominator of 912 -- the union
// of the symbols key (700), the dynamic zset (696) and the history-key scan (863).
// That is wrong in both directions at once:
//
//   * screener-fundamentals read 286.1% and earnings-rows 136.3%, because their
//     natural population is SCREENER_LIMIT = 3,000, not the analysis universe.
//     A percentage over 100 is the report announcing its own broken denominator.
//   * profile read 71.4%, which UNDERSTATES or OVERSTATES the thing actually
//     asked depending on where the gaps fall. The question was never "what
//     fraction of a union" -- it was "what fraction of the symbols that appear on
//     picker pages have an industry", and that denominator is the 700-symbol
//     ANALYSIS UNIVERSE. 651 mostly inside the 700 means a cosmetic fallback;
//     261 gaps concentrated in the 700 is much worse than 71.4% suggests.
//
// So every dataset is reported against THREE denominators, each labelled: the
// analysis universe (what renders), the dataset's own key count (what exists),
// and the union (what the dump swept). A single number cannot carry all three.
//
// Usage:  node scripts/step0-analyse-dump.mjs <dumpDir> [SYM,SYM,...]

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import readline from "node:readline";

const DIR = path.resolve(process.argv[2] ?? "step0-dump");
// Symbols worth answering by name. The four from historyStaleNewestSymbols plus
// the two renames, because "is it still in the universe" is the question that
// decides eviction and it has never been answerable from a log.
const LOOKUP = (process.argv[3] ?? "EA,WBS,EQR,MRSH,FISV,MMC,FI")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

const readJson = (name) => {
  const p = path.join(DIR, name);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    console.warn(`  ! ${name} did not parse: ${String(e?.message ?? e)}`);
    return null;
  }
};

const pct = (n, d) => (d > 0 ? Number(((n / d) * 100).toFixed(1)) : null);
const fmtPct = (v) => (v == null ? "   n/a" : `${String(v).padStart(5)}%`);

// ── The populations ──────────────────────────────────────────────────────────
const universe = readJson("universe.json");
if (!universe) {
  console.error(`FAIL: no universe.json in ${DIR} — nothing to analyse.`);
  process.exit(1);
}

// THE ANALYSIS UNIVERSE, and this is the denominator the product question wants.
// msh:pickers:v10:symbols is written by the builder and bounded by
// ANALYSIS_UNIVERSE_CAP, so it is exactly "the symbols a build looked at".
const analysis = new Set((universe.pickersSymbolsKey ?? []).map(String));
const unionAll = new Set((universe.dumpUniverse ?? []).map(String));
const zsetScores = new Map(
  (universe.dynamicUniverseScores ?? []).map((r) => [String(r.symbol), Number(r.score)])
);

// THE RENDERED POPULATION, tighter still: the symbols that are actually IN the
// payload the picker pages read. Present separately from the analysis universe
// because a build can look at a symbol and not emit a record for it.
const payload = readJson("pickers-payload.json");
const rendered = new Set(
  (payload?.signalRecords ?? []).map((r) => String(r?.symbol ?? "")).filter(Boolean)
);

console.log(`Step 0 dump analysis — ${DIR}`);
console.log(`dumpedAt (from the artefact)  ${universe.dumpedAt ?? "unknown"}`);
console.log(`\nPOPULATIONS, and why there is more than one`);
console.log(`  analysis universe (msh:pickers:v10:symbols) ${analysis.size}   <- what a build looked at`);
console.log(`  rendered records  (payload signalRecords)    ${rendered.size}   <- what picker pages show`);
console.log(`  dynamic zset      (msh:dynamic-universe:v2)  ${zsetScores.size}`);
console.log(`  union the dump swept                         ${unionAll.size}`);

// ── Per-dataset symbol sets ──────────────────────────────────────────────────
async function historySymbols() {
  const p = path.join(DIR, "history-bars.ndjson.gz");
  if (!fs.existsSync(p)) return new Set();
  const out = new Set();
  const rl = readline.createInterface({
    input: fs.createReadStream(p).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row?._meta) continue;
      if (row?.symbol) out.add(String(row.symbol));
    } catch {
      // a truncated final line is not worth failing the analysis over
    }
  }
  return out;
}

const keysOf = (name) => {
  const j = readJson(name);
  return new Set(Object.keys(j?.values ?? {}));
};

// Profile is special: presence of a KEY is not presence of an INDUSTRY, which was
// the whole point of the value count. Recompute it here from the values so this
// analysis does not inherit the dump's own summary.
const nonEmpty = (v) =>
  typeof v === "string" &&
  v.trim() !== "" &&
  !["-", "n/a", "na", "null", "none", "unknown"].includes(v.trim().toLowerCase());

const profileJson = readJson("profile.json");
const profileValues = profileJson?.values ?? {};
const withIndustry = new Set(
  Object.entries(profileValues)
    .filter(([, v]) => nonEmpty(v?.industry))
    .map(([s]) => s)
);

const datasets = {
  history: await historySymbols(),
  fundamentals: keysOf("fundamentals.json"),
  "profile (key present)": new Set(Object.keys(profileValues)),
  "profile (industry non-empty)": withIndustry,
  "screener-fundamentals": keysOf("screener-fundamentals.json"),
  "earnings-rows": keysOf("earnings-rows.json"),
  stockdata: keysOf("stockdata.json"),
};

const analystJson = readJson("analyst-columns.json");
datasets["analyst columns (>=1 value)"] = new Set(Object.keys(analystJson?.rows ?? {}));

const inter = (a, b) => {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
};

// ── THE TABLE, with every denominator named ──────────────────────────────────
console.log(`\nCOVERAGE, against three denominators rather than one`);
console.log(
  `  ${"dataset".padEnd(30)}${"own keys".padStart(9)}` +
    `${"of analysis".padStart(13)}${"of rendered".padStart(13)}${"of union".padStart(10)}`
);
console.log(`  ${"-".repeat(30)}${"-".repeat(45)}`);

const rows = {};
for (const [name, set] of Object.entries(datasets)) {
  const inAnalysis = inter(set, analysis);
  const inRendered = inter(set, rendered);
  const inUnion = inter(set, unionAll);
  rows[name] = {
    ownKeys: set.size,
    inAnalysis,
    pctOfAnalysis: pct(inAnalysis, analysis.size),
    inRendered,
    pctOfRendered: pct(inRendered, rendered.size),
    pctOfUnion: pct(inUnion, unionAll.size),
  };
  console.log(
    `  ${name.padEnd(30)}${String(set.size).padStart(9)}` +
      `${fmtPct(rows[name].pctOfAnalysis).padStart(13)}` +
      `${fmtPct(rows[name].pctOfRendered).padStart(13)}` +
      `${fmtPct(rows[name].pctOfUnion).padStart(10)}`
  );
}

// ── THE HEADLINE, RE-CUT ─────────────────────────────────────────────────────
const industryInAnalysis = inter(withIndustry, analysis);
const industryInRendered = inter(withIndustry, rendered);
const missingInAnalysis = [...analysis].filter((s) => !withIndustry.has(s)).sort();
const outsideAnalysis = [...withIndustry].filter((s) => !analysis.has(s)).sort();

console.log(`\n══ THE HEADLINE, AGAINST THE DENOMINATOR THE QUESTION MEANT ══`);
console.log(`  industry present, of the ${analysis.size} ANALYSIS universe   ${industryInAnalysis}  (${pct(industryInAnalysis, analysis.size)}%)`);
console.log(`  industry present, of the ${rendered.size} RENDERED records    ${industryInRendered}  (${pct(industryInRendered, rendered.size)}%)`);
console.log(`  industry present, total keys anywhere              ${withIndustry.size}`);
console.log(`  ANALYSIS-universe symbols with NO industry         ${missingInAnalysis.length}`);
console.log(`  industry keys OUTSIDE the analysis universe        ${outsideAnalysis.length}  <- cached but not rendered`);
const verdict =
  pct(industryInAnalysis, analysis.size) >= 90
    ? "FALLBACK IS COSMETIC — the gaps are almost entirely outside what renders."
    : pct(industryInAnalysis, analysis.size) >= 70
      ? "FALLBACK IS REAL BUT BOUNDED — decide a per-symbol rule before the swap."
      : "WORSE THAN THE UNION FIGURE SUGGESTED — the gaps are concentrated in what renders.";
console.log(`  ${verdict}`);
if (missingInAnalysis.length) {
  console.log(`  first 40 missing: ${missingInAnalysis.slice(0, 40).join(", ")}`);
}

// ── TARGETED SYMBOL LOOKUP ───────────────────────────────────────────────────
// The capability historyStaleNewestSymbols has never had: answer "where is this
// symbol, across every dataset" without a per-symbol investigation.
console.log(`\nSYMBOL LOOKUP`);
const newestBar = readJson("history-newest-bar.json")?.value ?? {};
const lookupOut = {};
for (const sym of LOOKUP) {
  const where = [];
  if (analysis.has(sym)) where.push("analysis");
  if (rendered.has(sym)) where.push("rendered");
  if (zsetScores.has(sym)) where.push(`zset(score ${zsetScores.get(sym)})`);
  const stamp = newestBar[sym] ?? newestBar[sym?.toUpperCase()] ?? null;
  const row = {
    inAnalysisUniverse: analysis.has(sym),
    inRenderedPayload: rendered.has(sym),
    dynamicZsetScore: zsetScores.has(sym) ? zsetScores.get(sym) : null,
    hasBars: datasets.history.has(sym),
    hasProfileKey: Object.prototype.hasOwnProperty.call(profileValues, sym),
    hasNonEmptyIndustry: withIndustry.has(sym),
    industry: nonEmpty(profileValues[sym]?.industry) ? profileValues[sym].industry : null,
    newestBarStamp: stamp,
  };
  lookupOut[sym] = row;
  console.log(
    `  ${sym.padEnd(6)} ${where.length ? where.join(" + ") : "NOT IN ANY UNIVERSE"}` +
      ` | bars ${row.hasBars ? "yes" : "no "} | industry ${row.industry ?? "-"}` +
      (stamp ? ` | newestBar ${stamp}` : "")
  );
}

// ── WRITE IT BESIDE THE DUMP ─────────────────────────────────────────────────
const out = {
  analysedAt: new Date().toISOString(),
  dumpDir: path.basename(DIR),
  dumpedAt: universe.dumpedAt ?? null,
  note:
    "Re-analysis of a frozen Step 0 dump. Reads the artefact only, never Redis, so " +
    "it describes the snapshot it was given rather than the cache as it is now.",
  populations: {
    analysisUniverse: analysis.size,
    renderedRecords: rendered.size,
    dynamicZset: zsetScores.size,
    unionSwept: unionAll.size,
  },
  headline: {
    question: "What fraction of the symbols that appear on picker pages have an industry?",
    industryOfAnalysisUniverse: industryInAnalysis,
    pctOfAnalysisUniverse: pct(industryInAnalysis, analysis.size),
    industryOfRenderedRecords: industryInRendered,
    pctOfRenderedRecords: pct(industryInRendered, rendered.size),
    industryKeysAnywhere: withIndustry.size,
    analysisUniverseMissingIndustry: missingInAnalysis.length,
    industryKeysOutsideAnalysisUniverse: outsideAnalysis.length,
    verdict,
    missingSymbols: missingInAnalysis,
  },
  coverage: rows,
  symbolLookup: lookupOut,
};
const outPath = path.join(DIR, "ANALYSIS.json");
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`\nwrote ${path.relative(process.cwd(), outPath)}`);
