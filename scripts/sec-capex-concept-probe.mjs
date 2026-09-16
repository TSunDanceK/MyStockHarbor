// TWO CONCEPTS FOR ONE LINE: WHAT THE SAME-CONCEPT RULE COSTS, AND WHETHER THE
// TWO CONCEPTS ARE EVEN THE SAME MEASURE — both measured, neither argued.
//
// `capex` resolves from a two-entry chain — PaymentsToAcquirePropertyPlantAnd-
// Equipment and PaymentsToAcquireProductiveAssets — and sec-capex-blast reported
// 23 of 119 SYMBOLS resolving it from more than one of them across their
// periods. That run answered "how many filers mix". It did not answer the two
// questions a ruling on the mixing needs:
//
//   1. HOW MANY DERIVED QUARTERS DOES THE SAME-CONCEPT RULE NULL? The rule
//      refuses to subtract a YTD frame filed under one concept from a YTD frame
//      filed under another. Every refusal is a cell that does not render, and
//      "the rule is correct" is not a reason to ship it without knowing the
//      number.
//
//   2. WHERE A FILER PUBLISHES BOTH CONCEPTS FOR THE SAME PERIOD, HOW FAR APART
//      ARE THEY? If they agree to the cent they are two spellings of one line
//      and preferring either is safe. If one is 40% larger it is a different
//      measure, and a column that takes whichever the filer happened to use is
//      reporting two things under one heading.
//
// ── THE COUNT IS MEASURED TWICE, BY TWO ROUTES THAT CAN DISAGREE ──────────
// The extractor records a note for every refusal, so counting notes answers
// question 1 from the extractor's own bookkeeping. But a note is a claim that
// something was refused, not evidence a value would otherwise have existed —
// if the code ever recorded a note on a path that produces nothing either way,
// the count would overstate. So the probe ALSO runs the shipped extractor with
// the same-concept test mutated out and counts the quarters that gain a capex
// value. Two routes to one number; the probe prints both and says so loudly if
// they differ, because a silent agreement is worth nothing if disagreement
// would also have been silent.
//
// ── AND THE PERCENTAGE IS READ OFF RAW ROWS, NOT OFF RESOLVED CELLS ───────
// Resolution picks ONE concept per period, so by the time a value reaches a
// cell the other reading is gone. Question 2 is about the pair, so it reads
// rowsForField's candidates directly and compares the two concepts on the
// periods that carry both.
//
// Read-only: no credential, no store, no writes. Needs the network.
//
//   SYMBOLS="GEV,KTOS,AAPL" node scripts/sec-capex-concept-probe.mjs
//   (no SYMBOLS: the frozen dump's analysis universe, capped by LIMIT)
import fs from "node:fs";
import path from "node:path";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; capex concept spread)";
const FIELD = process.env.FIELD || "capex";
const LIMIT = Number(process.env.LIMIT || 120);
/**
 * The line above which two concepts stop being two spellings of one measure.
 *
 * NOT A PASS MARK. The probe has no authority to rule that a 7% gap is
 * acceptable; it prints every symbol over the line so the ruling is made on
 * named filers and real numbers. The default is the figure the brief set.
 */
const SPREAD_ALERT_PCT = Number(process.env.SPREAD_ALERT_PCT || 5);

const strip = (f) =>
  fs.readFileSync(f, "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
    .replace(/^export \* from "\.\/[^"]+";$/gm, "");
const fieldsSrc = fs.readFileSync("lib/server/secFields.ts", "utf8");
const extractSrc = strip("lib/server/secExtract.ts");
const codecSrc = strip("lib/server/secFactCodec.ts");

const sec = await lift([fieldsSrc, extractSrc, codecSrc].join("\n"));

// THE MUTANT: the same-concept test removed and NOTHING ELSE. Built by string
// replacement against the shipped source that was just lifted, so the two runs
// differ by exactly one condition. If the anchor text ever moves, this aborts
// rather than silently measuring two identical extractors and reporting that
// the rule costs nothing.
const ANCHOR = "if (prior.best.tag !== f.best.tag) {";
if (!extractSrc.includes(ANCHOR)) {
  console.error(
    `FATAL: the same-concept test is not where this probe expects it ` +
      `(looked for \`${ANCHOR}\`). Refusing to run: an unapplied mutation would ` +
      `report that the rule nulls nothing, which is the answer that gets it shipped.`
  );
  process.exit(2);
}
const mixed = await lift(
  [fieldsSrc, extractSrc.replace(ANCHOR, "if (false) {"), codecSrc].join("\n")
);

const tickSrc = readCodeOnly("lib/server/secTickerMap.ts");
const tick = await lift(
  [grabFunction(tickSrc, "padCik"), grabFunction(tickSrc, "parseTickerFile")].join("\n") +
    "\nexport { parseTickerFile, padCik };"
);

const { SEC_FIELDS, rowsForField, newer } = sec;
const field = SEC_FIELDS.find((f) => f.key === FIELD);
if (!field) { console.error(`FATAL: no field "${FIELD}"`); process.exit(2); }
if (field.chain.length < 2) {
  console.error(`FATAL: ${FIELD}'s chain has one entry — there is no second concept to compare`);
  process.exit(2);
}
console.log(`${FIELD} chain: [${field.chain.join(", ")}]`);
console.log(`spread alert at ${SPREAD_ALERT_PCT}%\n`);

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
console.log(`${targets.length} SYMBOLS (source: ${SYMBOLS.length ? "SYMBOLS input" : "frozen dump universe"})\n`);

const { map: tickerMap } = tick.parseTickerFile(
  fs.readFileSync("data/sec/company-tickers.json", "utf8")
);

const idx = SEC_FIELDS.findIndex((f) => f.key === FIELD);
const capexOf = (period) => period?.values?.[idx]?.val ?? null;

/**
 * Every period key that carries BOTH concepts, with one value per concept.
 *
 * RESTATEMENTS COLLAPSED WITHIN A CONCEPT FIRST, by the shipped `newer`. Two
 * filings of the same concept for the same period are one reading at two ages,
 * and comparing an old filing of A against a new filing of B would report a
 * restatement as a concept disagreement.
 */
const bothConcepts = (facts) => {
  const byPeriod = new Map();
  for (const c of rowsForField(facts, field)) {
    if (c.row.val === null || c.row.val === undefined) continue;
    const k = `${c.row.start ?? ""}..${c.row.end}`;
    let m = byPeriod.get(k);
    if (!m) { m = new Map(); byPeriod.set(k, m); }
    const key = `${c.ns}|${c.tag}`;
    const prev = m.get(key);
    if (!prev || newer(c.row, prev.row) === c.row) m.set(key, c);
  }
  const out = [];
  for (const [k, m] of byPeriod) {
    if (m.size < 2) continue;
    const entries = [...m.entries()];
    // EVERY PAIR, not just the first two: a chain could grow a third entry and
    // taking entries[0] vs entries[1] would quietly stop measuring the rest.
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [ka, a] = entries[i];
        const [kb, b] = entries[j];
        const scale = Math.max(Math.abs(a.row.val), Math.abs(b.row.val));
        // A PAIR OF ZEROES IS AGREEMENT, NOT A DIVISION BY ZERO. Reported as
        // 0% rather than skipped, so "both filed, identical" is visible.
        const pct = scale === 0 ? 0 : (Math.abs(a.row.val - b.row.val) / scale) * 100;
        out.push({ period: k, a: ka, b: kb, va: a.row.val, vb: b.row.val, pct });
      }
    }
  }
  return out;
};

const rows = [];
const tally = { noCik: 0, failed: 0, singleConcept: 0, noCapex: 0 };

for (const symbol of targets) {
  const cik = tickerMap.get(symbol)?.cik;
  if (!cik) { tally.noCik++; continue; }
  let facts;
  try {
    if (process.env.FACTS_DIR) {
      facts = JSON.parse(fs.readFileSync(`${process.env.FACTS_DIR}/CIK${cik}.json`, "utf8"));
    } else {
      const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
        headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" },
      });
      if (!res.ok) { tally.failed++; continue; }
      facts = await res.json();
    }
  } catch { tally.failed++; continue; }

  const shipped = sec.extractCompanyFacts(symbol, facts);
  const loose = mixed.extractCompanyFacts(symbol, facts);

  // ROUTE 1 — the extractor's own refusals.
  const notes = (shipped.notes ?? []).filter((n) => n.startsWith(`${FIELD} `));

  // ROUTE 2 — quarters that gain a value once the test is mutated out. Matched
  // BY PERIOD END so the two runs line up on periods, not on array position:
  // the mutant emits quarters the shipped run does not, which shifts indices.
  const gained = (a, b) => {
    const A = new Map((a.quarters ?? []).map((q) => [q.end, capexOf(q)]));
    const B = new Map((b.quarters ?? []).map((q) => [q.end, capexOf(q)]));
    const out = [];
    for (const [end, v] of B) if (v !== null && (A.get(end) ?? null) === null) out.push(end);
    return out;
  };
  const nulled = gained(shipped, loose);

  // ── AND THE SAME COMPARISON WITH RETENTION TURNED OFF ────────────────────
  //
  // THE FIRST RUN OF THIS PROBE REPORTED 6 AGAINST 43 AND THE CROSS-CHECK
  // CAUGHT IT. Both numbers were right and they answer different questions.
  // extractCompanyFacts slices to SEC_QUARTER_WINDOW before returning, so a
  // refusal on a frame from 2014 is recorded in `notes` and then falls off the
  // end of the retention window — it never was a stored cell and losing it
  // costs nothing. `notes` counts every refusal the extractor ever makes;
  // `nulled` counts the ones that reach the store.
  //
  // Running the pair again with the window opened wide separates the two, so
  // the report can give the cost AND the total rather than picking one and
  // hoping. If these still disagree, the retention theory is wrong and
  // something else is going on.
  const WIDE = { quarters: 100000, years: 100000, instants: 100000 };
  const nulledAllTime = gained(
    sec.extractCompanyFacts(symbol, facts, WIDE),
    mixed.extractCompanyFacts(symbol, facts, WIDE)
  );

  const pairs = bothConcepts(facts);

  // ── WHICH OF THOSE PERIODS ACTUALLY RENDER ───────────────────────────────
  //
  // A 99% disagreement on a 2017 quarter is a different fact from a 99%
  // disagreement on the newest one. The first run listed 14 SYMBOLS over the
  // line and every worst case was dated 2011–2022 — which is either "these
  // concepts diverge badly and it is live" or "they diverged years ago and
  // nothing on the page can see it", and the output gave no way to tell.
  // Reporting the headline without this would have handed a ruling to the
  // owner with the one qualification it turns on left out.
  //
  // MATCHED ON PERIOD END against the periods the SHIPPED extraction keeps,
  // after its retention slice. A pair on an end that survives is a pair on a
  // row a reader can see.
  const storedEnds = new Set([
    ...(shipped.quarters ?? []).map((q) => q.end),
    ...(shipped.years ?? []).map((y) => y.end),
  ]);
  const livePairs = pairs.filter((x) => storedEnds.has(x.period.split("..")[1]));
  const conceptsSeen = new Set();
  for (const q of [...(shipped.quarters ?? []), ...(shipped.years ?? [])]) {
    const t = q.values?.[idx]?.tag;
    if (t) conceptsSeen.add(t);
  }
  if (!conceptsSeen.size && !pairs.length) { tally.noCapex++; continue; }
  if (conceptsSeen.size < 2 && !pairs.length && !nulled.length) { tally.singleConcept++; continue; }

  rows.push({
    symbol,
    concepts: [...conceptsSeen],
    nulled,
    nulledAllTime,
    notes: notes.length,
    pairs,
    livePairs,
    maxPct: pairs.length ? Math.max(...pairs.map((p) => p.pct)) : null,
    maxLivePct: livePairs.length ? Math.max(...livePairs.map((p) => p.pct)) : null,
  });
  await new Promise((r) => setTimeout(r, 120));
}

const read = targets.length - tally.noCik - tally.failed;
console.log("=".repeat(76));
console.log(`READ ${read} SYMBOLS of ${targets.length} (${tally.noCik} no CIK, ${tally.failed} fetch failed)`);
console.log(`${rows.length} SYMBOLS touch more than one ${FIELD} concept; ` +
  `${tally.singleConcept} resolve from one throughout; ${tally.noCapex} have no ${FIELD} at all\n`);

// ── 1. WHAT THE RULE NULLS ────────────────────────────────────────────────
const totalNulled = rows.reduce((a, r) => a + r.nulled.length, 0);
const totalNotes = rows.reduce((a, r) => a + r.notes, 0);
console.log(`1. DERIVED QUARTERS THE SAME-CONCEPT RULE NULLS: ${totalNulled}`);
console.log(`   across ${rows.filter((r) => r.nulled.length).length} SYMBOLS\n`);
for (const r of rows.filter((x) => x.nulled.length).sort((a, b) => b.nulled.length - a.nulled.length)) {
  console.log(`   ${r.symbol.padEnd(6)} ${String(r.nulled.length).padStart(2)} quarter(s): ${r.nulled.slice(0, 8).join(" ")}${r.nulled.length > 8 ? " …" : ""}`);
}
if (!totalNulled) console.log("   (none — no filer on this sample has a mid-year concept change)");

// THE TWO ROUTES, COMPARED OUT LOUD — AND RETENTION IS WHY THEY DIFFER.
const totalAllTime = rows.reduce((a, r) => a + r.nulledAllTime.length, 0);
console.log(`\n   ALL-TIME, retention off: ${totalAllTime} quarter(s) refused across ` +
  `${rows.filter((r) => r.nulledAllTime.length).length} SYMBOLS.`);
console.log(`   CROSS-CHECK: the extractor recorded ${totalNotes} refusal note(s).`);
if (totalAllTime !== totalNotes) {
  console.log(
    `   >> THE TWO ROUTES DISAGREE by ${Math.abs(totalAllTime - totalNotes)} WITH RETENTION OFF, ` +
      `which retention cannot explain. A note is recorded per refused FRAME and a nulled ` +
      `quarter is a period END that gained a value, so with no window to slice them they ` +
      `should match. At least one of these is not counting what this report says it is — ` +
      `read the per-symbol lists before quoting either number.`
  );
} else {
  console.log(`   Both routes agree once retention is off, so the ${totalNotes - totalNulled} ` +
    `extra note(s) are refusals on frames too old to be stored under the current window. ` +
    `THE COST THAT REACHES A PAGE IS ${totalNulled}, not ${totalNotes}.`);
}

// ── 2. HOW FAR APART THE TWO CONCEPTS ARE ─────────────────────────────────
const withPairs = rows.filter((r) => r.pairs.length).sort((a, b) => b.maxPct - a.maxPct);
console.log(`\n2. PERIODS PUBLISHING BOTH CONCEPTS — max difference per SYMBOL`);
console.log(`   ${withPairs.length} SYMBOLS file both concepts for at least one period\n`);
for (const r of withPairs) {
  const worst = r.pairs.reduce((a, b) => (b.pct > a.pct ? b : a));
  const live = r.maxLivePct === null
    ? "no such period is still stored"
    : `${r.maxLivePct.toFixed(2)}% on ${r.livePairs.length} still-stored period(s)`;
  console.log(
    `   ${r.symbol.padEnd(6)} max ${r.maxPct.toFixed(2).padStart(7)}%  ` +
      `(${r.pairs.length} period(s) carry both; worst ${worst.period}: ` +
      `${worst.a.split("|")[1]} ${worst.va} vs ${worst.b.split("|")[1]} ${worst.vb})` +
      `\n          IN WINDOW: ${live}`
  );
}
if (!withPairs.length) {
  // AND A ZERO HERE IS A FINDING, NOT A CLEAN BILL. If no filer ever publishes
  // both concepts for one period, the question "are they the same measure"
  // has no evidence either way from this sample — it is unanswered, not
  // answered yes.
  console.log(`   (none — no filer on this sample publishes both concepts for the same period.`);
  console.log(`    That leaves the "are they the same measure" question UNANSWERED by this run,`);
  console.log(`    not answered in the affirmative. A ruling needs a filer that files both.)`);
}

const over = withPairs.filter((r) => r.maxPct > SPREAD_ALERT_PCT);
console.log(`\n   OVER ${SPREAD_ALERT_PCT}%, ALL TIME: ${over.length} SYMBOLS`);
if (over.length) {
  console.log(`   ${over.map((r) => `${r.symbol} ${r.maxPct.toFixed(1)}%`).join(", ")}`);
} else if (withPairs.length) {
  console.log(`   (none — every filer that files both agrees within ${SPREAD_ALERT_PCT}% on every shared period)`);
}

// THE ONE THAT DECIDES ANYTHING TODAY. A spread on a period that rolled out of
// the retention window is a fact about 2017, not about the page.
const overLive = withPairs.filter((r) => (r.maxLivePct ?? -1) > SPREAD_ALERT_PCT);
console.log(`\n   OVER ${SPREAD_ALERT_PCT}% ON A PERIOD THAT IS STILL STORED: ${overLive.length} SYMBOLS`);
if (overLive.length) {
  console.log(`   ${overLive.map((r) => `${r.symbol} ${r.maxLivePct.toFixed(1)}%`).join(", ")}`);
  console.log(`   >> These are live. On these filers the two concepts are not the same measure ` +
    `and a rendered cell today depends on which one is taken.`);
} else {
  console.log(`   (none — every spread above the line is on a period that has rolled out of the`);
  console.log(`    retention window, so no rendered cell today turns on the choice. It is still a`);
  console.log(`    real divergence between the two concepts; it is simply not visible on the page.)`);
}
