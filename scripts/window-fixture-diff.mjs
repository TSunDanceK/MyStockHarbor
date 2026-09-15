// Decompose the gap between the committed window fixture and a live run.
//
// WHY THIS EXISTS. The fixture and the live run over the SAME four days report:
//
//     fixture   291 matched symbols   2,008 rows   123 queued
//     live      281 matched symbols   1,441 rows   127 queued
//
// and the deltas run OPPOSITE ways: the fixture has ten MORE symbols but four
// FEWER queued. That is not a size difference. If the fixture's symbol set were
// a superset of the live one it could not queue fewer, so there are live
// symbols that queue and are absent from the fixture entirely.
//
// Totals that disagree do not say which one is wrong -- the same rule
// listing-venue-diff.mjs is built around. So this emits the SYMMETRIC
// DIFFERENCE, both directions, with each symbol's form list, rather than a
// reconciled headline.
//
// WHAT IT NEEDS. The live side: the matched symbols from the live run, which
// the job reports as filingsBySymbol. Pass them as a file (one symbol per line,
// or a JSON array, or the filingsBySymbol object itself) via --live=<path>.
// Without it the script reports the fixture side in full and says plainly which
// half of the answer is missing, rather than inferring the other half.
import fs from "node:fs";

const FIXTURE = "data/sec/window-fixture-20260908-11.json";
const liveArg = process.argv.find((a) => a.startsWith("--live="));
const fx = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));

const bySymbol = new Map();
for (const f of fx.filings) {
  if (!bySymbol.has(f.symbol)) bySymbol.set(f.symbol, []);
  bySymbol.get(f.symbol).push(f);
}
const formsOf = (sym) => {
  const h = {};
  for (const f of bySymbol.get(sym) ?? []) h[f.form] = (h[f.form] ?? 0) + 1;
  return Object.entries(h).sort((a, b) => b[1] - a[1]).map(([k, n]) => (n > 1 ? `${k}x${n}` : k)).join(" ");
};

console.log(`WINDOW FIXTURE DIFF — ${fx.window.from}..${fx.window.to}`);
console.log(`fixture: ${fx.filings.length} rows, ${bySymbol.size} symbols, from ${fx.universeSource}`);

// ── Dedup, ruled out rather than assumed ─────────────────────────────────────
// One of the two shapes that fit a row inflation without a symbol inflation is
// a capture that does not dedupe the way intersect() does. Measured here so the
// candidate is closed with a number instead of an argument.
const keys = new Set(fx.filings.map((f) => `${f.symbol}:${f.accession}`));
console.log(
  `\ndedup: ${fx.filings.length} rows, ${keys.size} distinct (symbol, accession) — ` +
    (keys.size === fx.filings.length
      ? "NO duplicates, so row inflation is not a dedup failure"
      : `${fx.filings.length - keys.size} DUPLICATES: the capture is not deduping like intersect()`)
);

// ── Concentration, which is the other shape ──────────────────────────────────
// Structured-note and preferred issuers file by the hundred. If the extra rows
// are concentrated in a few such names, a handful of universe-membership
// differences explains the row gap without anything being wrong.
const perSymbol = [...bySymbol.entries()].map(([s, rows]) => [s, rows.length]).sort((a, b) => b[1] - a[1]);
console.log(`\nheaviest filers in the fixture:`);
for (const [sym, n] of perSymbol.slice(0, 12)) {
  console.log(`  ${String(n).padStart(4)}  ${sym.padEnd(8)} ${formsOf(sym).slice(0, 70)}`);
}
const top5 = perSymbol.slice(0, 5).reduce((a, [, n]) => a + n, 0);
console.log(
  `  top 5 = ${top5} of ${fx.filings.length} rows (${((top5 / fx.filings.length) * 100).toFixed(0)}%) — ` +
    `membership differences among heavy filers move the row count far more than the symbol count`
);

if (!liveArg) {
  console.log(
    `\n── THE LIVE SIDE IS MISSING, AND IS NOT INFERRED ──\n` +
      `  Re-run with --live=<path> holding the live run's matched symbols\n` +
      `  (filingsBySymbol keys: a JSON array, a JSON object, or one symbol per line).\n` +
      `  Until then only half the symmetric difference exists. Reporting the\n` +
      `  fixture's 291 as though the live 281 were a subset is precisely the\n` +
      `  subtract-the-totals error this repo keeps finding.`
  );
  const out = "window-fixture-symbols.txt";
  fs.writeFileSync(out, perSymbol.map(([s, n]) => `${s}\t${n}\t${formsOf(s)}`).join("\n") + "\n");
  console.log(`\n  wrote ${out} — all ${perSymbol.length} fixture symbols with row counts and form lists,\n` +
    `  so the live side can be diffed against it directly.`);
  process.exit(0);
}

// ── The symmetric difference ─────────────────────────────────────────────────
const raw = fs.readFileSync(liveArg.slice("--live=".length), "utf8").trim();
let live;
if (raw.startsWith("{")) live = Object.keys(JSON.parse(raw));
else if (raw.startsWith("[")) live = JSON.parse(raw).map(String);
else live = raw.split(/[\s,]+/).filter(Boolean);
live = [...new Set(live.map((s) => s.toUpperCase()))];

const F = new Set(bySymbol.keys());
const L = new Set(live);
const onlyFixture = [...F].filter((s) => !L.has(s)).sort();
const onlyLive = [...L].filter((s) => !F.has(s)).sort();

console.log(`\n── SYMMETRIC DIFFERENCE ──`);
console.log(`  fixture ${F.size} symbols · live ${L.size} symbols · shared ${F.size - onlyFixture.length}`);

const rowsIn = (list) => list.reduce((a, s) => a + (bySymbol.get(s)?.length ?? 0), 0);
console.log(`\n  IN FIXTURE, NOT LIVE — ${onlyFixture.length} symbols, ${rowsIn(onlyFixture)} rows:`);
for (const s of onlyFixture) console.log(`    ${s.padEnd(9)} ${String(bySymbol.get(s).length).padStart(4)}  ${formsOf(s)}`);

console.log(`\n  IN LIVE, NOT FIXTURE — ${onlyLive.length} symbols (no form list: these rows were never captured):`);
console.log(`    ${onlyLive.join(" ") || "(none)"}`);

// THE ARITHMETIC HAS TO CLOSE, or the decomposition is incomplete and says so.
console.log(
  `\n  row accounting: ${fx.filings.length} fixture rows − ${rowsIn(onlyFixture)} (fixture-only) = ` +
    `${fx.filings.length - rowsIn(onlyFixture)} shared rows.`
);
console.log(
  onlyLive.length
    ? `  The live total must equal that plus whatever the ${onlyLive.length} live-only symbols filed.\n` +
      `  If it does not, something beyond membership differs and the gap is NOT decomposed.`
    : `  No live-only symbols: the live set is a subset, and the row gap is entirely\n` +
      `  the ${onlyFixture.length} fixture-only symbols above.`
);
