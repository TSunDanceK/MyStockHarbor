// What the ticker search actually says, for real symbols, against the live
// filing record.
//
// ── WHAT THIS ADDS THAT THE CHECK CANNOT ──────────────────────────────────
// check-symbol-outlook.mjs proves the rules on fixtures. It cannot tell you
// that the store holds enough history for NVDA to earn a band, or which of the
// four answers a reader searching a household name gets today. That is a
// question about PRODUCTION DATA, and the answer changes daily.
//
// It runs the SHIPPED module graph -- the same loader the check uses, so the
// code measured here is the code that renders -- against records read straight
// out of Upstash, and prints every sentence verbatim. A claim about what the
// page says is only worth as much as the bytes it printed.
//
// Read-only. Issues GETs against Redis; writes nothing.
//   relay task: write-symbol-outlook   (credentialled for the READ; no writes)
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { loadOutlookGraph } from "./lib/outlook-module.mjs";

const redis = Redis.fromEnv();
const TODAY = process.env.TODAY || new Date().toISOString().slice(0, 10);
const PREFIX = "msh:sec:reportdates:v1";

const cut = JSON.parse(fs.readFileSync("data/due-strip.json", "utf8")).symbols;
// The cut is what the two SECTIONS rank. A SEARCH has no cut, so a handful of
// names a reader would plausibly type are added -- including ones deliberately
// outside it, to see what the refusal sentences look like in the wild.
const EXTRA = ["NVDA", "TSLA", "MU", "PLTR", "SOFI", "RIVN", "NKE", "FDX", "ASML", "BABA", "ZZZZ"];
const symbols = [...new Set([...cut, ...EXTRA])];

const g = await loadOutlookGraph();
const { outlookFrom } = g.mod;

const records = new Map();
for (const symbol of symbols) {
  const raw = await redis.get(`${PREFIX}:${symbol}`);
  records.set(symbol, raw && typeof raw === "object" ? raw : null);
}

console.log(`\nTODAY=${TODAY}  symbols=${symbols.length}  cut=${cut.length}  extra=${EXTRA.length}\n`);

const answers = symbols.map((s) => outlookFrom(s, records.get(s), TODAY));
const byKind = {};
for (const a of answers) {
  byKind[a.kind] ??= [];
  byKind[a.kind].push(a);
}

console.log("── KIND DISTRIBUTION ─────────────────────────────────────────");
for (const [kind, list] of Object.entries(byKind)) {
  console.log(`  ${kind.padEnd(14)} ${String(list.length).padStart(3)}  ${list.map((a) => a.symbol).join(" ")}`);
}
const reasons = {};
for (const a of byKind["no-estimate"] ?? []) (reasons[a.reason] ??= []).push(a.symbol);
console.log("\n── REFUSALS, BY NAMED REASON ─────────────────────────────────");
for (const [r, list] of Object.entries(reasons)) {
  console.log(`  ${r.padEnd(20)} ${String(list.length).padStart(3)}  ${list.join(" ")}`);
}

console.log("\n── EVERY SENTENCE, VERBATIM ──────────────────────────────────");
for (const a of answers) {
  console.log(`\n  [${a.kind}] ${a.headline}`);
  if (a.hedge) console.log(`      ${a.hedge}`);
  for (const line of a.evidence) console.log(`      · ${line}`);
}

// ── THE CANARY. It refuses to call a run good on count alone. ─────────────
const ISO = /\d{4}-\d{2}-\d{2}/;
const MONTH = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}\b/i;
const problems = [];
for (const a of answers) {
  const estimated = a.kind === "expected" || a.kind === "beyond-window";
  if (estimated) {
    for (const s of [a.headline, a.hedge ?? ""]) {
      if (ISO.test(s) || MONTH.test(s)) problems.push(`${a.symbol}: a DATE in an estimated sentence — "${s}"`);
    }
    if (!a.hedge) problems.push(`${a.symbol}: an estimate with no hedge`);
  }
  if (a.kind === "due" && a.hedge) problems.push(`${a.symbol}: a filed fact carrying an estimate's hedge`);
  if (a.kind === "no-estimate" && !a.reason) problems.push(`${a.symbol}: an unnamed refusal`);
}
// A run in which NOTHING produced an estimate proves the pipeline is silent,
// not that it is honest, and would otherwise pass every assertion above
// vacuously.
if (!(byKind.expected ?? []).length && !(byKind["beyond-window"] ?? []).length) {
  problems.push("NO ESTIMATE OF ANY KIND was produced — the date scan proved nothing this run.");
}
if (!records.size || [...records.values()].every((r) => !r)) {
  problems.push("EVERY record read back empty — this measured the store being unreachable, not the producer.");
}

// ── RAW EVENTS, ON REQUEST ────────────────────────────────────────────────
// The sweep prints the SENTENCE; this prints the filings underneath it. It
// exists because two of the six in-window estimates in relay 35763454309 quote
// medians a reader would not believe -- TSLA "usually reports 2 days after a
// period ends", ABBV "4 days" -- and the hypothesis (an Item 2.02 that is not
// the results release, kept because reportEvents takes the EARLIEST 2.02 per
// period) is checkable against the stored accessions rather than arguable.
//   dispatch with symbols=TSLA,ABBV,GE
const dump = (process.env.SYMBOLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (dump.length) {
  console.log("\n── RAW EVENTS ────────────────────────────────────────────────");
  for (const symbol of dump) {
    const rec = records.get(symbol) ?? (await redis.get(`${PREFIX}:${symbol}`));
    console.log(`\n  ${symbol}  next=${JSON.stringify(rec?.next ?? null)}  nextPeriodEnd=${rec?.nextPeriodEnd ?? null}`);
    for (const e of (rec?.events ?? []).slice(0, 8)) {
      const lag = Math.round(
        (Date.parse(`${e.announcedOn}T00:00:00Z`) - Date.parse(`${e.periodEnd}T00:00:00Z`)) / 86_400_000,
      );
      console.log(`      period ${e.periodEnd}  announced ${e.announcedOn}  lag ${String(lag).padStart(3)}  ` +
        `${e.form ?? "?"} items=${e.items ?? "?"}  ${e.basis ?? "?"}  ${e.accession ?? "?"}`);
    }
  }
}

console.log("\n── CANARY ────────────────────────────────────────────────────");
if (problems.length) {
  for (const p of problems) console.log(`  PROBLEM  ${p}`);
} else {
  console.log("  clean: every estimate hedged, no date in any estimated sentence,");
  console.log("  every refusal named, and at least one real estimate produced.");
}
g.cleanup();
process.exit(problems.length ? 1 : 0);
