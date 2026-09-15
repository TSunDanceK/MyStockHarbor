// HOW FAR THE CAPEX FALLBACK REACHES, AND WHAT IT DISTURBS — measured, not argued.
//
// ── THE QUESTION A CHAIN ADDITION OWES AN ANSWER TO ───────────────────────
// Adding a tag to a chain has two effects and only the first is the one asked
// for: cells that were null become numbers (the point), and cells that were
// numbers might become DIFFERENT numbers (the risk). The second is the one that
// ships a plausible wrong figure, and "resolution is rank-first so it cannot
// happen" is a claim about code, not a measurement of filers.
//
// The VRT short-term-investments addition went in unmeasured and the handoff
// says so plainly: "it is in the branch and nothing shows it does not disturb
// anything else. It should not merge on my word alone." This is that
// measurement, for the capex addition, and it is built so the same run answers
// it for any chain edit.
//
// ── ONE CODE PATH, RUN TWICE ──────────────────────────────────────────────
// BEFORE is not a remembered number and not a second implementation: the
// shipped extractor is run against the same payload with the capex chain
// TRUNCATED TO ITS FIRST ENTRY, then run again with the chain as it ships. Two
// readings of one payload by one extractor, so any difference is the chain and
// nothing else. A probe that compares today's output against a figure written
// down last week is comparing two runs of different code.
//
// Reports, per symbol:
//   GAINED    capex was null everywhere, now has values      — the intent
//   CHANGED   a period's capex value moved, or vanished      — the risk
//   same      identical before and after                     — the control
//
// ── AND CHANGED IS NOT DECORATIVE, WHICH HAD TO BE SHOWN RATHER THAN SAID ─
// Resolution is rank-first per period, so an APPENDED entry cannot displace a
// period the first entry already covers, and it is tempting to conclude the
// CHANGED column can never fire and is therefore worth nothing. There is
// exactly one path by which it can, and it goes through the DIFFERENCING
// rather than through resolve():
//
//   byLen keeps ONE frame per length per fiscal year, chosen by filing date.
//   A later-filed frame of the same length arriving under the NEW entry
//   displaces the one the old chain used — and because its END DATE differs,
//   the quarter that was differenced from the old frame does not merely change
//   value, it CEASES TO EXIST at that end date.
//
// Exercised against a payload built to contain precisely that: a Q2 carrying
// 300,000,000 before the append reported `q:2026-06-30 300000000 -> GONE`
// after it. A first attempt to demonstrate this by REVERSING the chain proved
// nothing and looked like it had — reversing moves the BEFORE run too, so both
// readings shift together and the probe correctly reported no change.
//
// Read-only: no credential, no store, no writes. Needs the network.
//
//   SYMBOLS="GEV,KTOS,AAPL" node scripts/sec-capex-blast-probe.mjs
//   (no SYMBOLS: the frozen dump's analysis universe, capped by LIMIT)
import fs from "node:fs";
import path from "node:path";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; capex blast radius)";
const FIELD = process.env.FIELD || "capex";
const LIMIT = Number(process.env.LIMIT || 120);

const strip = (f) =>
  fs.readFileSync(f, "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
    .replace(/^export \* from "\.\/[^"]+";$/gm, "");
const sec = await lift([
  fs.readFileSync("lib/server/secFields.ts", "utf8"),
  strip("lib/server/secExtract.ts"),
  strip("lib/server/secFactCodec.ts"),
].join("\n"));
const tickSrc = readCodeOnly("lib/server/secTickerMap.ts");
const tick = await lift(
  [grabFunction(tickSrc, "padCik"), grabFunction(tickSrc, "parseTickerFile")].join("\n") +
    "\nexport { parseTickerFile, padCik };"
);
const { SEC_FIELDS, extractCompanyFacts, encodeFactSet, valueOf } = sec;

const field = SEC_FIELDS.find((f) => f.key === FIELD);
if (!field) { console.error(`FATAL: no field "${FIELD}"`); process.exit(2); }
const shippedChain = [...field.chain];
if (shippedChain.length < 2) {
  console.error(`FATAL: ${FIELD}'s chain has ${shippedChain.length} entry — nothing was added, so there is no before`);
  process.exit(2);
}
console.log(`${FIELD}: before = [${shippedChain[0]}]`);
console.log(`${FIELD}: after  = [${shippedChain.join(", ")}]`);

// THE SWITCH IS THE ARRAY ITSELF, mutated in place between the two runs, so
// both readings go through the identical resolve/difference code.
const setChain = (entries) => { field.chain.length = 0; field.chain.push(...entries); };

const DIR = process.env.DUMP_DIR || "";
const fromDump = () => {
  if (!DIR) return [];
  try {
    const u = JSON.parse(fs.readFileSync(path.join(DIR, "universe.json"), "utf8"));
    return (u?.pickersSymbolsKey ?? []).map(String);
  } catch { return []; }
};
const SYMBOLS = (process.env.SYMBOLS || "").split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
const targets = (SYMBOLS.length ? SYMBOLS : fromDump()).slice(0, LIMIT);
if (!targets.length) {
  console.error("FATAL: no symbols — pass SYMBOLS or run with a dump that has universe.json");
  process.exit(2);
}
console.log(`\n${targets.length} SYMBOLS (source: ${SYMBOLS.length ? "SYMBOLS input" : "frozen dump universe"})\n`);

const { map: tickerMap } = tick.parseTickerFile(
  fs.readFileSync("data/sec/company-tickers.json", "utf8")
);

/** Every period's value for one field, keyed so the two runs line up exactly. */
const readField = (set) => {
  const out = new Map();
  for (const [bucket, periods] of [["q", set.quarters], ["y", set.years]]) {
    for (const p of periods) out.set(`${bucket}:${p.e}`, valueOf(p, FIELD));
  }
  return out;
};

const tally = { gained: [], changed: [], same: 0, empty: 0, noCik: 0, failed: 0 };

for (const symbol of targets) {
  const cik = tickerMap.get(symbol)?.cik;
  if (!cik) { tally.noCik++; continue; }
  let facts;
  try {
    if (process.env.FACTS_DIR) {
      // OFFLINE, and it says so once per run rather than per symbol. Same
      // escape hatch as sec-blank-cell-probe: the sandbox cannot reach
      // data.sec.gov, so the two-run logic is exercised against a payload
      // built to contain a known gain before a live run is trusted.
      facts = JSON.parse(fs.readFileSync(`${process.env.FACTS_DIR}/CIK${cik}.json`, "utf8"));
    } else {
      const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
        headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" },
      });
      if (!res.ok) { tally.failed++; continue; }
      facts = await res.json();
    }
  } catch { tally.failed++; continue; }

  setChain([shippedChain[0]]);
  const before = readField(encodeFactSet(extractCompanyFacts(symbol, facts)));
  setChain(shippedChain);
  const after = readField(encodeFactSet(extractCompanyFacts(symbol, facts)));

  const keys = [...new Set([...before.keys(), ...after.keys()])].sort().reverse();
  const filledBefore = keys.filter((k) => before.get(k) != null).length;
  const filledAfter = keys.filter((k) => after.get(k) != null).length;
  // A CHANGE IS A PERIOD THAT HAD A VALUE AND NOW HAS A DIFFERENT ONE. Null ->
  // number is a gain and is counted separately; conflating the two would let a
  // genuine overwrite hide inside the headline the change was asked for.
  const moved = keys.filter((k) => before.get(k) != null && after.get(k) !== before.get(k));

  if (moved.length) {
    const say = (k) => {
      const a = after.get(k);
      return `${k} ${before.get(k)} -> ${a == null ? "GONE" : a}`;
    };
    tally.changed.push(`${symbol} ${moved.length} period(s): ` +
      moved.slice(0, 3).map(say).join("; "));
  } else if (filledAfter > filledBefore) {
    tally.gained.push(`${symbol} ${filledBefore} -> ${filledAfter} of ${keys.length} periods`);
  } else if (filledAfter === 0) {
    tally.empty++;
  } else {
    tally.same++;
  }
  await new Promise((r) => setTimeout(r, 120));
}

const read = targets.length - tally.noCik - tally.failed;
console.log(`\n${"=".repeat(74)}`);
console.log(`READ ${read} SYMBOLS of ${targets.length} (${tally.noCik} no CIK, ${tally.failed} fetch failed)\n`);

console.log(`CHANGED — a period that already had a value now has a DIFFERENT one: ${tally.changed.length} SYMBOLS`);
for (const line of tally.changed) console.log(`  ${line}`);
if (!tally.changed.length) console.log(`  (none — every filer that already resolved resolves to the same figure)`);

console.log(`\nGAINED — periods that were null now carry a figure: ${tally.gained.length} SYMBOLS`);
for (const line of tally.gained.slice(0, 40)) console.log(`  ${line}`);
if (tally.gained.length > 40) console.log(`  … and ${tally.gained.length - 40} more`);

console.log(`\nsame ${tally.same} SYMBOLS · still empty both ways ${tally.empty} SYMBOLS`);
// THE HEADLINE IS THE RISK, NOT THE WIN. A run with gains and no changes is the
// result this addition claims; a single CHANGED symbol is the thing to look at
// before anything merges, however many symbols gained.
console.log(
  tally.changed.length
    ? `\n>> ${tally.changed.length} SYMBOLS had a capex figure MOVE. Read them before merging.`
    : `\n>> No filer's existing ${FIELD} figure moved. The addition is additive on this sample.`
);
