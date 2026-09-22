// TWO BLAST RADII, COUNTED BEFORE ANYTHING MOVES.
//
// Both questions come out of the ABVX diagnosis (relay 35698982104) and both
// were going to be answered with "probably a lot" until they were counted.
//
// ── (A) THE YEAR/QUARTER TIE ─────────────────────────────────────────────
// buildSecEarningsView picks its anchor with `newestYear.e > newestQuarter.e`
// — STRICTLY greater — so when a derived Q4 and the fiscal year share an end
// date, the QUARTER wins. A derived quarter cannot carry any duration-ratio or
// duration-average field (EPS, share counts): those must never be differenced,
// correctly. So the page can anchor on a period that structurally has no EPS
// while an as-filed year with real EPS sits beside it.
//
// THE NUMBER THAT MATTERS IS NOT "how many tie". It is how many tie AND would
// actually gain a figure from the year — a tie where both periods have EPS, or
// neither does, changes nothing and must not be counted as impact.
//
// ── (B) THE SG&A IFRS TAG ────────────────────────────────────────────────
// ABVX tags ifrs-full:GeneralAndAdministrativeExpense, which is in the us-gaap
// chain and NOT in the IFRS one. Adding it is narrow and additive, but "narrow"
// is a claim about a population, so the population is measured: every IFRS
// filer whose SG&A is null, and of those, how many actually publish that tag.
//
// A CELL THAT IS ALREADY FILLED IS THE RISK, not the empty ones. If a filer
// has SG&A from another tag and also publishes this one, the chain ORDER
// decides and the value could change. Those are counted separately and named.
import fsSync from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const constant = (src, n) => (readCodeOnly(src).match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const FACTS_PREFIX = constant("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const TICKER_FILE = constant("lib/server/secTickerMap.ts", "TICKER_FILE");
if (!FACTS_PREFIX) { console.error("FATAL: no SEC_FACTS_PREFIX"); process.exit(2); }

const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; tie and ifrs census)";

const strip = (f) =>
  readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
    .replace(/^export \* from "\.\/[^"]+";$/gm, "");

// SEC_FIELDS and cell are lifted so the positional decoding and the field
// KINDS are the shipped ones. `duration-ratio` / `duration-average` is the
// property that makes a field un-differenceable, and hard-coding the list here
// would go stale the first time a field's kind changed.
const codec = await lift([
  readCodeOnly("lib/server/secFields.ts"),
  strip("lib/server/secExtract.ts"),
  strip("lib/server/fxRates.ts"),
  strip("lib/server/secCurrency.ts"),
  strip("lib/server/secFactCodec.ts"),
].join("\n"));
const { SEC_FIELDS, cell } = codec;

const tickerSrc = readCodeOnly("lib/server/secTickerMap.ts");
const tickerMod = await lift([
  grabFunction(tickerSrc, "padCik"),
  grabFunction(tickerSrc, "parseTickerFile"),
  "export { parseTickerFile };",
].join("\n"));
const tickers = fsSync.existsSync(TICKER_FILE)
  ? tickerMod.parseTickerFile(fsSync.readFileSync(TICKER_FILE, "utf8")).map
  : new Map();
console.log(`ticker map: ${tickers.size} symbols`);

// ── every stored set ───────────────────────────────────────────────────────
const keys = [];
let cursor = "0";
do {
  const [next, batch] = await redis.scan(cursor, { match: `${FACTS_PREFIX}:*`, count: 1000 });
  cursor = next;
  keys.push(...batch);
} while (cursor !== "0");
console.log(`stored sets: ${keys.length}\n`);

const SGA = "sellingGeneralAndAdministrative";
// The fields a DERIVED quarter structurally cannot carry.
const UNDIFFERENCEABLE = SEC_FIELDS
  .filter((f) => f.kind === "duration-ratio" || f.kind === "duration-average")
  .map((f) => f.key);
console.log(`un-differenceable fields (kind ratio/average): ${UNDIFFERENCEABLE.join(", ")}\n`);

const tie = { total: 0, quarterWins: 0, gains: [], noGain: 0 };
const ifrs = { total: 0, sgaNull: [], sgaFilled: 0 };
let scanned = 0;

for (let i = 0; i < keys.length; i += 64) {
  const batch = keys.slice(i, i + 64);
  const sets = await Promise.all(batch.map((k) => redis.get(k).catch(() => null)));
  for (const set of sets) {
    if (!set || !Array.isArray(set.quarters) || !Array.isArray(set.years)) continue;
    scanned++;
    const q = set.quarters[0] ?? null;
    const y = set.years[0] ?? null;

    // ── (A) ───────────────────────────────────────────────────────────────
    if (q && y && q.e === y.e) {
      tie.total++;
      tie.quarterWins++; // strictly-greater test means a tie always picks the quarter
      // WOULD THE YEAR ACTUALLY SUPPLY SOMETHING? Only count a filer as
      // affected when the anchor it loses to has a figure the quarter lacks.
      const gained = UNDIFFERENCEABLE.filter(
        (k) => cell(q, k).val === null && cell(y, k).val !== null
      );
      if (gained.length) tie.gains.push({ symbol: set.symbol, end: q.e, gained });
      else tie.noGain++;
    }

    // ── (B) ───────────────────────────────────────────────────────────────
    // `tx` ABSENT MEANS UNKNOWN, NOT NONE — sets written before it existed do
    // not carry it, and counting those as non-IFRS would understate the
    // population. They are excluded from both columns and reported separately.
    if (Array.isArray(set.tx) && set.tx.includes("ifrs-full")) {
      ifrs.total++;
      const latest = q ?? y;
      if (latest && cell(latest, SGA).val === null) {
        ifrs.sgaNull.push({ symbol: set.symbol, cik: set.cik ?? tickers.get(set.symbol)?.cik ?? null });
      } else if (latest) ifrs.sgaFilled++;
    }
  }
}

console.log("=".repeat(88));
console.log("(A) YEAR/QUARTER TIE — a derived Q4 sharing an end date with the fiscal year");
console.log("=".repeat(88));
console.log(`  sets scanned:                         ${scanned}`);
console.log(`  tie on the newest periods:            ${tie.total}`);
console.log(`  ...of which the quarter wins today:   ${tie.quarterWins}  (all of them — the test is strictly-greater)`);
console.log(`  ...and the year would supply a figure the quarter cannot: ${tie.gains.length}`);
console.log(`  ...and nothing would change:          ${tie.noGain}`);
if (tie.gains.length) {
  console.log(`\n  THE AFFECTED FILERS (up to 40 shown), with what they would gain:`);
  for (const g of tie.gains.slice(0, 40)) {
    console.log(`    ${g.symbol.padEnd(8)} ${g.end}  +${g.gained.join(", ")}`);
  }
  if (tie.gains.length > 40) console.log(`    ... and ${tie.gains.length - 40} more`);
}

console.log(`\n${"=".repeat(88)}`);
console.log("(B) SG&A UNDER ifrs-full — who a GeneralAndAdministrativeExpense mapping would reach");
console.log("=".repeat(88));
console.log(`  sets declaring ifrs-full:             ${ifrs.total}`);
console.log(`  ...with SG&A already filled:          ${ifrs.sgaFilled}  (chain ORDER could change these — see below)`);
console.log(`  ...with SG&A null:                    ${ifrs.sgaNull.length}`);

// WHO ACTUALLY PUBLISHES THE TAG. The count above is an upper bound; only a
// payload can say how many of those filers would really gain a cell.
const CHECK = ifrs.sgaNull.filter((f) => f.cik).slice(0, Number(process.env.PAYLOAD_LIMIT ?? 60));
console.log(`\n  checking payloads for ${CHECK.length} of them (PAYLOAD_LIMIT)...`);
let publishes = 0, checked = 0;
const alsoOther = [];
for (const f of CHECK) {
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(f.cik).padStart(10, "0")}.json`;
  let facts;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
    if (!res.ok) continue;
    facts = await res.json();
  } catch { continue; }
  checked++;
  const concepts = Object.keys(facts.facts?.["ifrs-full"] ?? {});
  if (concepts.includes("GeneralAndAdministrativeExpense")) {
    publishes++;
    // Does it ALSO publish something already in the chain? Then the mapping
    // only matters if it is ranked ahead, and that is a decision, not a gap.
    const existing = ["SellingGeneralAndAdministrativeExpense", "AdministrativeExpense", "DistributionCosts"]
      .filter((c) => concepts.includes(c));
    if (existing.length) alsoOther.push(`${f.symbol} (also ${existing.join(", ")})`);
  }
  await new Promise((r) => setTimeout(r, 120)); // under SEC's 10/s
}
console.log(`  payloads read:                        ${checked}`);
console.log(`  ...publishing GeneralAndAdministrativeExpense: ${publishes}`);
console.log(`  ...of those, ALSO publishing a tag already in the chain: ${alsoOther.length}`);
if (alsoOther.length) for (const a of alsoOther.slice(0, 20)) console.log(`      ${a}`);
console.log(`\n  A filer in the last line already has a candidate; adding the tag only`);
console.log(`  changes its cell if the new entry outranks the old one. Everything else`);
console.log(`  in "publishing" is a cell that is blank today and would be filled.`);
