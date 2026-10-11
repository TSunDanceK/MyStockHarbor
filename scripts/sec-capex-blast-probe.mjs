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
// shipped extractor is run against the same payload with the chain MINUS THE
// ENTRIES THE EDIT ADDED, then run again with the chain as it ships. Two
// readings of one payload by one extractor, so any difference is the chain and
// nothing else. A probe that compares today's output against a figure written
// down last week is comparing two runs of different code.
//
// `DROP` names those entries. The default — everything after the first — is
// right only for a chain that went from one entry to two, which is capex and
// is NOT shortTermInvestments; see the DROP docblock below.
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
//   FIELD=shortTermInvestments DROP=<the concept the edit added> node ...
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
  strip("lib/server/fxRates.ts"),
  strip("lib/server/secCurrency.ts"),
  strip("lib/server/secFactCodec.ts"),
].join("\n"));
const tickSrc = readCodeOnly("lib/server/secTickerMap.ts");
const tick = await lift(
  [grabFunction(tickSrc, "padCik"), grabFunction(tickSrc, "parseTickerFile")].join("\n") +
    "\nexport { parseTickerFile, padCik };"
);
const { SEC_FIELDS, extractCompanyFacts, encodeFactSet, valueOf, rowsForField, resolve } = sec;

const field = SEC_FIELDS.find((f) => f.key === FIELD);
if (!field) { console.error(`FATAL: no field "${FIELD}"`); process.exit(2); }
const shippedChain = [...field.chain];

/**
 * WHICH ENTRIES THE ADDITION INTRODUCED — named, not assumed to be "everything
 * after the first".
 *
 * That default is right for `capex`, whose chain went from one entry to two.
 * It is WRONG for `shortTermInvestments`, whose chain already had five when the
 * VRT concept was appended: truncating to the first entry would measure "what
 * do four other concepts contribute", which is a real question and not the one
 * being asked. The BEFORE run has to be the chain minus exactly what the edit
 * added, so the edit is what is named.
 */
const DROP = (process.env.DROP || "").split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
const unknown = DROP.filter((t) => !shippedChain.includes(t));
if (unknown.length) {
  console.error(`FATAL: DROP names ${unknown.join(", ")}, not in ${FIELD}'s chain [${shippedChain.join(", ")}]`);
  process.exit(2);
}
const beforeChain = DROP.length
  ? shippedChain.filter((t) => !DROP.includes(t))
  : shippedChain.slice(0, 1);
if (beforeChain.length === shippedChain.length) {
  console.error(`FATAL: before and after are the same chain — nothing was added, so there is no before`);
  process.exit(2);
}
if (!beforeChain.length) {
  console.error(`FATAL: DROP empties the chain; the BEFORE run would read nothing and every symbol would look like a gain`);
  process.exit(2);
}
console.log(`${FIELD}: before = [${beforeChain.join(", ")}]`);
console.log(`${FIELD}: after  = [${shippedChain.join(", ")}]`);
console.log(`${FIELD}: the edit under measurement adds ${shippedChain.filter((t) => !beforeChain.includes(t)).join(", ")}`);

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

/**
 * Every period's value for one field, keyed so the two runs line up exactly.
 *
 * INSTANTS INCLUDED, and leaving them out was a real bug in this probe rather
 * than a tidy-up. It read quarters and years only, which is every
 * duration-cumulative field and NO balance-sheet field — so pointing it at
 * `shortTermInvestments` to measure the VRT addition would have compared two
 * empty maps and reported "same" for every symbol. A measurement instrument
 * that cannot see the thing it is aimed at is worse than none: it produces a
 * clean bill of health.
 */
const readField = (set) => {
  const out = new Map();
  for (const [bucket, periods] of [["q", set.quarters], ["y", set.years], ["i", set.instants]]) {
    for (const p of periods ?? []) out.set(`${bucket}:${p.e}`, valueOf(p, FIELD));
  }
  return out;
};

/**
 * WHICH CONCEPT WON, PER PERIOD — because a column that means one thing on some
 * of a filer's periods and another thing on the rest is its own defect.
 *
 * This is the VRT fair-value-twin concern, one level along. There the worry was
 * two concepts for the SAME period, where taking whichever appeared first makes
 * the column mean different things on different SYMBOLS. Here it is two
 * concepts across ONE filer's periods, which makes a single column mean
 * different things down its own length.
 *
 * IT IS NOT AUTOMATICALLY WRONG, and saying so would be the easy dishonest
 * answer. Per-period resolution exists precisely so AAPL's revenue can be
 * `Revenues` before 2018 and `RevenueFromContractWithCustomer...` after it —
 * the filer changed its own presentation and the column follows. The question
 * is whether the two concepts MEAN the same thing, which is a judgement made on
 * a printed list, so this prints the list rather than returning a verdict.
 *
 * THE CONCRETE HARM IS SEPARATE AND IS COUNTED SEPARATELY: a tag change WITHIN
 * one fiscal year's frame ladder blocks the differencing outright — the
 * extractor refuses to subtract across it and records why. That is not a
 * question of meaning, it is a cell that does not render, and it comes out of
 * the extractor's own notes rather than from anything re-derived here.
 */
const conceptsPerPeriod = (facts) => {
  const byPeriod = new Map();
  for (const c of rowsForField(facts, field)) {
    const k = `${c.row.start ?? ""}..${c.row.end}`;
    const list = byPeriod.get(k);
    if (list) list.push(c); else byPeriod.set(k, [c]);
  }
  const tags = new Map();
  for (const [, cands] of byPeriod) {
    const best = resolve(cands);
    if (!best) continue;
    tags.set(best.tag, (tags.get(best.tag) ?? 0) + 1);
  }
  return tags;
};

const tally = { gained: [], changed: [], same: 0, empty: 0, noCik: 0, failed: 0, mixed: [], blocked: [] };

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

  setChain(beforeChain);
  const before = readField(encodeFactSet(extractCompanyFacts(symbol, facts)));
  setChain(shippedChain);
  const after = readField(encodeFactSet(extractCompanyFacts(symbol, facts)));

  const tags = conceptsPerPeriod(facts);
  if (tags.size > 1) {
    tally.mixed.push(`${symbol} ${[...tags].map(([t, n]) => `${t}x${n}`).join(" + ")}`);
  }
  // FROM THE EXTRACTOR'S OWN NOTES, not re-derived. A mid-year tag change is
  // the case where the two concepts actually cost a rendered cell.
  const afterSet = encodeFactSet(extractCompanyFacts(symbol, facts));
  for (const n of afterSet.notes ?? []) {
    if (n.startsWith(`${FIELD} `)) tally.blocked.push(`${symbol} ${n.slice(FIELD.length + 1)}`);
  }

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

console.log(`\nMIXED CONCEPTS — one filer resolving ${FIELD} from more than one concept across its periods: ${tally.mixed.length} SYMBOLS`);
for (const line of tally.mixed.slice(0, 30)) console.log(`  ${line}`);
if (tally.mixed.length > 30) console.log(`  … and ${tally.mixed.length - 30} more`);
if (!tally.mixed.length) console.log(`  (none — every filer resolves ${FIELD} from a single concept throughout)`);

// ── AND A ZERO HERE MEANS NOTHING ON AN INSTANT FIELD ────────────────────
// Instants are NEVER differenced — that is structural, not incidental — so
// this count is necessarily 0 for a balance-sheet field however badly its
// concepts are mixed. Printed as "not applicable" rather than as 0, because a
// zero in a risk column reads as reassurance, and a metric that cannot fire is
// the same decorative failure as an assertion nothing can break.
const DIFFERENCED = field.kind === "duration-cumulative";
console.log(`\nBLOCKED BY A MID-YEAR TAG CHANGE — the case where two concepts cost a rendered cell: ${DIFFERENCED ? tally.blocked.length : "n/a"}`);
if (!DIFFERENCED) {
  console.log(`  (not applicable — ${FIELD} is ${field.kind}, and an instant is never differenced, so this can never fire)`);
} else {
  for (const line of tally.blocked.slice(0, 20)) console.log(`  ${line}`);
  if (tally.blocked.length > 20) console.log(`  … and ${tally.blocked.length - 20} more`);
  if (!tally.blocked.length) console.log(`  (none — no ${FIELD} differencing was refused for a tag change on this sample)`);
}

console.log(`\nsame ${tally.same} SYMBOLS · still empty both ways ${tally.empty} SYMBOLS`);
// THE HEADLINE IS THE RISK, NOT THE WIN. A run with gains and no changes is the
// result this addition claims; a single CHANGED symbol is the thing to look at
// before anything merges, however many symbols gained.
console.log(
  tally.changed.length
    ? `\n>> ${tally.changed.length} SYMBOLS had a capex figure MOVE. Read them before merging.`
    : `\n>> No filer's existing ${FIELD} figure moved. The addition is additive on this sample.`
);
