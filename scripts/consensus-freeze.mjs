// STAGE 0 — freeze the analyst-consensus series before the FMP key dies.
//
// WHAT IS IRREPLACEABLE, AND WHY IT IS THE ONLY THING ON THE PAGE THAT IS.
// Everything else /earnings-calendar shows can be re-derived from public filings
// forever. The estimate/actual pairs cannot: consensus traces to I/B/E/S and
// Zacks, and the survey (claude/consensus-and-adjusted-eps-survey-2026-09-13.md)
// established there is no free, cleanly-licensed source at any tier -- Finnhub
// publishes a $3,500/month plan that is STILL marked personal use.
//
// AND IT IS ON A 24-HOUR TTL. pickersBuilder.ts:546 sets
// EARNINGS_CACHE_TTL_SECONDS = 60*60*24 on msh:pickers:earnings:v1:<SYM>. So the
// series does not decay slowly when the key lapses -- it is gone within a day.
// That is what makes this blocking and irreversible rather than merely urgent.
//
// NO NETWORK, NO REDIS. Reads the frozen Step 0 dump's earnings-rows.json, which
// already holds the full series, and distils it to the consensus fields alone.
// The dump is the capture; this is what makes the capture PERMANENT and small
// enough to commit.
//
//   node scripts/consensus-freeze.mjs <dumpDir>            measure only
//   SYMBOLS=consensus-freeze  ... emits the payload for transcription
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { emitPayload } from "./lib/relay-capture.mjs";

const DUMP = process.argv[2] || process.env.DUMP_DIR || "";
if (!DUMP) { console.error("FATAL: no dump directory. Dispatch the relay with a run_id."); process.exit(2); }

const file = path.join(DUMP, "earnings-rows.json");
if (!fs.existsSync(file)) {
  console.error(`FATAL: ${file} is missing. Without it there is nothing to freeze, and`);
  console.error("reporting an empty freeze as success is exactly the failure this project keeps paying for.");
  process.exit(1);
}
const doc = JSON.parse(fs.readFileSync(file, "utf8"));
const values = doc?.values ?? {};

// THE DUE-STAMP CONTAMINATION, AGAIN. msh:pickers:earnings:v1: carries three key
// families and an older dump folds `due:<SYM>` in as if it were a ticker. Those
// are timestamp strings, not row arrays, so they are dropped here by shape --
// and counted, because a silent drop is how a coverage figure goes wrong.
let notARowArray = 0;
const series = {};
let rows = 0, withEps = 0, withRev = 0, withEither = 0;
let minDate = null, maxDate = null;

for (const [key, v] of Object.entries(values)) {
  if (key.startsWith("due:") || key === "queue") { notARowArray++; continue; }
  let arr = v;
  if (typeof arr === "string") { try { arr = JSON.parse(arr); } catch { arr = null; } }
  if (!Array.isArray(arr)) { notARowArray++; continue; }

  const kept = [];
  for (const r of arr) {
    const date = typeof r?.date === "string" ? r.date.slice(0, 10) : "";
    if (!date) continue;
    const ea = Number.isFinite(r?.epsActual) ? r.epsActual : null;
    const ee = Number.isFinite(r?.epsEstimated) ? r.epsEstimated : null;
    const ra = Number.isFinite(r?.revenueActual) ? r.revenueActual : null;
    const re = Number.isFinite(r?.revenueEstimated) ? r.revenueEstimated : null;
    // A row with no estimate AND no actual carries nothing that cannot be
    // re-derived from filings, so it is not part of what must be frozen.
    if (ea == null && ee == null && ra == null && re == null) continue;
    rows++;
    if (ee != null) withEps++;
    if (re != null) withRev++;
    if (ee != null || re != null) withEither++;
    if (!minDate || date < minDate) minDate = date;
    if (!maxDate || date > maxDate) maxDate = date;
    // Compact by construction: arrays, not objects, and nulls preserved.
    kept.push([date, ea, ee, ra, re]);
  }
  if (kept.length) series[key] = kept.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

const symbols = Object.keys(series).length;
const payload = JSON.stringify({
  _: "FMP analyst-consensus freeze. Columns: [date, epsActual, epsEstimated, revenueActual, revenueEstimated].",
  source: "msh:pickers:earnings:v1:<SYM> (24h TTL) via Step 0 dump",
  dumpedAt: doc?.dumpedAt ?? null,
  frozenAt: new Date().toISOString(),
  columns: ["date", "epsActual", "epsEstimated", "revenueActual", "revenueEstimated"],
  symbols, rows,
  series,
});
const gz = zlib.gzipSync(Buffer.from(payload, "utf8"), { level: 9 });

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");
console.log(`
================================================================
STAGE 0 — CONSENSUS FREEZE, MEASURED
================================================================
  source dump                 ${file}
  dumpedAt                    ${doc?.dumpedAt ?? "(absent)"}

  keys in the dataset         ${Object.keys(values).length}
  not a row array (dropped)   ${notARowArray}   <- due-stamps / queue, by shape
  symbols with a series       ${symbols}
  rows carrying any figure    ${rows}
  rows with an EPS estimate   ${withEps}  (${pct(withEps, rows)})
  rows with a revenue estimate ${withRev}  (${pct(withRev, rows)})
  rows with either estimate   ${withEither}  (${pct(withEither, rows)})
  date range                  ${minDate ?? "—"} .. ${maxDate ?? "—"}

  compact JSON                ${(payload.length / 1048576).toFixed(2)} MB
  gzipped                     ${(gz.length / 1048576).toFixed(2)} MB
  = whether this is committable as a permanent archive, measured not guessed.

  THE ESTIMATE COLUMNS ARE THE IRREPLACEABLE HALF. Actuals can be re-derived
  from filings; estimates cannot. ${withEither} of ${rows} rows carry one.
================================================================
`);

if (!rows) {
  console.error("FATAL: the extract is EMPTY. That is a failed freeze, not a small one.");
  console.error(`Examined ${Object.keys(values).length} keys and kept 0 rows. Check that the dump's`);
  console.error("earnings-rows dataset was populated at capture time before treating this as done.");
  process.exit(1);
}

try {
  fs.mkdirSync("data/consensus", { recursive: true });
  fs.writeFileSync("data/consensus/fmp-consensus-freeze.json", payload);
  fs.writeFileSync("data/consensus/fmp-consensus-freeze.json.gz", gz);
  console.log(`[freeze] written to data/consensus/ — the relay uploads these as artifacts`);
} catch (e) { console.log(`[freeze] WARN could not write: ${e.message}`); }

emitPayload("consensus-freeze", payload);
