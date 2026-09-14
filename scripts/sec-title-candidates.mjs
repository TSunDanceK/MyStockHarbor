// Unresolved symbols -> candidate CIKs, matched on SEC's own `title`.
//
//   relay task "sec-titles"   (read-only job; no credentials referenced)
//
// ── WHAT QUESTION THIS ANSWERS, AND WHY IT IS NOT sec-symbol-status ────────
// sec-symbol-status asks "is this company alive", per symbol. That was never
// the question: relay run 47's misses are live mega-caps. The question is
// "what is this company called AT SEC", and answering it needs the WHOLE file
// in hand, matched exactly — which is what a runner has and an agent sandbox
// does not (www.sec.gov is refused here, 403 CONNECT).
//
// ONE PASS, NOT TEN DISPATCHES. Every unresolved symbol is matched against
// every row of company_tickers.json in the same run.
//
// ── THE RELIABILITY POINT THAT MOTIVATED THIS ─────────────────────────────
// Three of the ten were resolved by reading SEC's 220 KB file through a
// summarising model. The three HITS are good positive evidence. The seven NOT
// FOUNDs are NOT reliable negatives: truncation and genuine absence produce an
// identical answer, so nothing there says EA, AVB, EQR, K, WBS, NBN or TOWN are
// missing from SEC's file. This script exists so the negatives mean something —
// it holds the complete file and matches every row.
//
// ── IT PRINTS. IT DOES NOT APPLY. ─────────────────────────────────────────
// No fuzzy match is auto-applied and this script cannot write data/cik-map.json.
// Output is a CANDIDATE LIST, shaped as an array of records rather than a
// symbol -> CIK object, so it is not accidentally committable as a map. A human
// reads it, confirms, and commits only what is confirmed.
//
// Every proposed CIK is independently checkable, and this checks the top one
// for you: data.sec.gov/submissions/CIK##########.json is fetched for each
// leading candidate and its own `name`, `tickers` and `exchanges` are printed.
// That turns "a name matched" into "a name matched AND the filer's own record
// says so", which is the difference between a guess and a corroborated claim.
//
// See scripts/lib/sec-title-match.mjs for why name matching is legitimate here
// and correctly refused in lib/server/news/wireProvider.ts.
import fs from "node:fs";
import path from "node:path";
import { emitPayload } from "./lib/relay-capture.mjs";
import { rankCandidates } from "./lib/sec-title-match.mjs";

const DUMP_DIR = process.argv[2] || "";
const ROOT = process.cwd();
const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (contact@mystockharbor.com)";
const HEADERS = { "user-agent": UA, accept: "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const readJson = (p, fallback) => {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
};

// ─────────────────────────────────────────── who is unresolved, and what we call them
const cikMap = readJson(path.join(ROOT, "data/cik-map.json"), {});
const profile = readJson(path.join(ROOT, "data/static-profile.json"), { rows: {} });

let pickers = [];
if (DUMP_DIR && fs.existsSync(path.join(DUMP_DIR, "universe.json"))) {
  pickers = (readJson(path.join(DUMP_DIR, "universe.json"), {})?.pickersSymbolsKey ?? [])
    .map((s) => String(s).toUpperCase());
}
const universe = [...new Set([...pickers, ...Object.keys(profile.rows ?? {})])].sort();

// The dot/dash fallback is applied HERE TOO, or BRK.B would be reported as
// unresolved and a human would be asked to adjudicate a bug that is already
// fixed at the lookup (lib/server/news/secProvider.ts cikFor).
const resolved = (s) => Boolean(cikMap[s] ?? (s.includes(".") ? cikMap[s.replace(/\./g, "-")] : undefined));
const unresolved = universe.filter((s) => !resolved(s));

// ── COMPANY NAMES, FROM WHEREVER THE DUMP ACTUALLY KEEPS THEM ─────────────
// The field is not asserted in advance because this script cannot see a dump
// from the sandbox it was written in. Several plausible spellings are tried and
// the one that hit is REPORTED, so the log says what it read rather than
// leaving a silent empty-name pass to look like "no candidates found".
const NAME_FIELDS = ["companyName", "name", "longName", "securityName", "title"];
const NAME_SOURCES = ["screener-fundamentals.json", "fundamentals.json", "profile.json"];
const names = new Map();
const fieldHits = {};
for (const file of NAME_SOURCES) {
  const full = DUMP_DIR ? path.join(DUMP_DIR, file) : "";
  if (!full || !fs.existsSync(full)) continue;
  const values = readJson(full, {})?.values ?? {};
  for (const [key, value] of Object.entries(values)) {
    if (!value || typeof value !== "object") continue;
    const symbol = String(value.symbol ?? key.split(":").pop() ?? "").trim().toUpperCase();
    if (!symbol || names.has(symbol)) continue;
    for (const field of NAME_FIELDS) {
      const v = value[field];
      if (typeof v === "string" && v.trim()) {
        names.set(symbol, v.trim());
        fieldHits[`${file}:${field}`] = (fieldHits[`${file}:${field}`] ?? 0) + 1;
        break;
      }
    }
  }
}

console.log(`[titles] universe ${universe.length}, unresolved ${unresolved.length}`);
console.log(`[titles] name fields found: ${Object.entries(fieldHits).map(([k, n]) => `${k}=${n}`).join(", ") || "NONE"}`);
console.log(`[titles] unresolved: ${unresolved.join(", ")}`);

const withNames = unresolved.filter((s) => names.has(s));
const withoutNames = unresolved.filter((s) => !names.has(s));
if (withoutNames.length) {
  // NOT SILENT. A symbol with no name cannot be matched, and reporting it as
  // "no candidates" would be indistinguishable from "SEC does not have it" --
  // the exact ambiguity this script was built to remove.
  console.log(`[titles] NO NAME AVAILABLE, so not matchable (≠ absent at SEC): ${withoutNames.join(", ")}`);
}

// ───────────────────────────────────────────────────────────── SEC's whole file
const res = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: HEADERS });
console.log(`[titles] company_tickers.json: HTTP ${res.status}`);
if (!res.ok) {
  console.error("FATAL: company_tickers.json did not return 200 — nothing below is meaningful.");
  process.exit(1);
}
const rows = Object.values(await res.json()).map((r) => ({
  ticker: String(r?.ticker ?? "").toUpperCase(),
  cik: String(r?.cik_str ?? "").padStart(10, "0"),
  title: String(r?.title ?? ""),
}));
console.log(`[titles] SEC rows: ${rows.length}`);

// MEASURING-NOTHING GUARD. A file that parsed to nothing, or to rows without
// titles, would produce "no candidates for anybody" -- which reads exactly like
// a real negative result and is the fail-green shape this repo keeps getting
// bitten by. The known-good control is cheap: Fiserv must be findable.
const control = rows.filter((r) => /FISERV/i.test(r.title));
if (!rows.length || !control.length) {
  console.error(`FATAL: the SEC file is not usable — rows=${rows.length}, FISERV rows=${control.length}.`);
  process.exit(1);
}
console.log(`[titles] control: FISERV present as ${control.map((c) => `${c.ticker}/${c.cik}`).join(", ")}`);

// ──────────────────────────────────────────────────────────────── the matching
const report = [];
for (const symbol of withNames) {
  const ourName = names.get(symbol);
  const { candidates, ambiguous, topTier } = rankCandidates(ourName, rows);
  report.push({ symbol, ourName, topTier, ambiguous, candidates });

  console.log(`\n[titles] ${symbol} — our name: ${JSON.stringify(ourName)}`);
  if (!candidates.length) {
    console.log("    no candidate above the floor — a REAL negative, the file was searched in full");
    continue;
  }
  if (ambiguous) console.log("    AMBIGUOUS: more than one filer at the top tier — do not confirm from this alone");
  for (const c of candidates) {
    console.log(`    ${c.tier.padEnd(7)} score=${c.score.toFixed(2)} ${c.ticker.padEnd(8)} CIK ${c.cik}  ${c.title}`);
  }
}

// ───────────────────────────────────────── corroborate the leader, per symbol
// The filer's own record, so a name match is not the only evidence. Sequential
// with a pause: SEC's fair-access cap is 10 req/sec and this is at most a
// handful of requests.
console.log("\n[titles] corroboration — data.sec.gov/submissions for each leading candidate\n");
for (const entry of report) {
  const top = entry.candidates[0];
  if (!top) continue;
  try {
    const r = await fetch(`https://data.sec.gov/submissions/CIK${top.cik}.json`, { headers: HEADERS });
    if (!r.ok) { console.log(`    ${entry.symbol}: HTTP ${r.status} for CIK ${top.cik}`); continue; }
    const body = await r.json();
    const tickers = body?.tickers ?? [];
    entry.corroboration = {
      name: body?.name ?? null,
      tickers,
      exchanges: body?.exchanges ?? [],
      // The tell that this whole exercise is about: SEC's own record does NOT
      // carry our spelling, which is why the ticker join missed it.
      carriesOurSymbol: tickers.map((t) => String(t).toUpperCase()).includes(entry.symbol),
    };
    console.log(
      `    ${entry.symbol}: CIK ${top.cik} is "${body?.name}" — tickers ${JSON.stringify(tickers)} ` +
        `exchanges ${JSON.stringify(body?.exchanges ?? [])} ` +
        `(carries our "${entry.symbol}": ${entry.corroboration.carriesOurSymbol})`
    );
  } catch (err) {
    console.log(`    ${entry.symbol}: submissions fetch failed — ${String(err)}`);
  }
  await sleep(150);
}

// AN ARRAY, NOT AN OBJECT KEYED BY SYMBOL, on purpose: a symbol -> CIK object
// is committable as data/cik-map.json by a single copy-paste, and nothing in
// this pipeline should make that an easy mistake. Confirming a candidate is a
// deliberate edit, not a file move.
emitPayload("cik-candidates", JSON.stringify({
  generatedAt: new Date().toISOString(),
  note: "CANDIDATES, NOT A MAP. Review, confirm against the corroboration, then add confirmed entries to data/cik-map.json by hand.",
  unresolved,
  notMatchable: withoutNames,
  report,
}, null, 2));

console.log(`\n[titles] done — ${report.filter((r) => r.topTier === "exact").length} exact, ` +
  `${report.filter((r) => r.topTier === "subset").length} subset, ` +
  `${report.filter((r) => r.topTier === "partial").length} partial, ` +
  `${report.filter((r) => r.topTier === "none").length} with nothing above the floor.`);
