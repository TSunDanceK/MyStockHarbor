// WHAT IS ACTUALLY STORED FOR A SYMBOL — read from Redis, not rebuilt.
//
// ── WHY THIS EXISTS BESIDE sec-blank-cell-probe ──────────────────────────
// That probe rebuilds the set from a live companyfacts fetch, which means it
// never holds FX rates: extractCompanyFacts sets `cur` and the WRITE path
// fetches the rates separately. buildSecEarningsView then refuses any non-USD
// set with no rates (correctly — those figures are not dollars), so for a EUR,
// CAD or BRL filer it cannot reach the question at all. Measured on ABVX,
// relay 35631730238.
//
// This one reads the SET THE PAGE READS: one GET at SEC_FACTS_PREFIX:<SYMBOL>.
// No SEC fetch, no re-extraction, no second opinion about what is stored —
// which is the whole point, because the question is "why does the rendered
// page say Not reported", and the page renders this object.
//
// ── THE QUESTION IT ANSWERS ──────────────────────────────────────────────
// For a page full of "Not reported", there are three possibilities and they
// call for completely different fixes:
//
//   (a) THE SET HAS THE VALUE and the card is dropping it — a render bug.
//   (b) THE SET HAS NULL and the filer never tagged anything in our chain —
//       a coverage gap, fixed by widening the chain, IF the filer tags it
//       under a concept we do not list.
//   (c) THE SET HAS NULL and the filer reports the line as genuinely nil or
//       does not have it at all — no bug. A clinical-stage biotech with no
//       product has no revenue, and "Not reported" is then the WRONG WORD for
//       a true fact.
//
// (b) and (c) look identical on the page and identical in the stored set. What
// separates them is the raw payload, so this prints the stored value AND, for
// each null, every us-gaap/ifrs-full concept the filer actually tagged whose
// name looks like the missing line. That is the evidence, not the inference.
//
//   SYMBOLS="ABVX RYAAY" node scripts/sec-stored-set-probe.mjs
import fsSync from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();

const constant = (src, n) => (readCodeOnly(src).match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const FACTS_PREFIX = constant("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
if (!FACTS_PREFIX) { console.error("FATAL: could not read SEC_FACTS_PREFIX"); process.exit(2); }

const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; stored-set diagnosis)";

const strip = (f) =>
  readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
    .replace(/^export \* from "\.\/[^"]+";$/gm, "");

// SEC_FIELDS is lifted so the field ORDER matches the stored positional array.
// A hand-typed list here would silently mis-label every value the day a field
// is inserted — the positional encoding is exactly what makes that invisible.
const codec = await lift([
  readCodeOnly("lib/server/secFields.ts"),
  strip("lib/server/secExtract.ts"),
  strip("lib/server/fxRates.ts"),
  strip("lib/server/secCurrency.ts"),
  strip("lib/server/secFactCodec.ts"),
].join("\n"));
const { SEC_FIELDS, valueOf, cell } = codec;

// parseTickerFile is LIFTED, not reimplemented: company-tickers.json has two
// possible layouts and reading the wrong one reports "no CIK" for filers that
// have one — a wrong answer that reads as a finding about the company.
// padCik comes with it — the gate in source-code.mjs named it, which is the
// whole reason that gate exists: without it this would have thrown
// ReferenceError on the first symbol with a null CIK and nowhere else.
const tickerSrc = readCodeOnly("lib/server/secTickerMap.ts");
const tickerMod = await lift([
  grabFunction(tickerSrc, "padCik"),
  grabFunction(tickerSrc, "parseTickerFile"),
  "export { parseTickerFile };",
].join("\n"));
const TICKER_REDIS_KEY = constant("lib/server/secTickerMap.ts", "TICKER_REDIS_KEY");
const TICKER_FILE = constant("lib/server/secTickerMap.ts", "TICKER_FILE");
/**
 * THE MAP, WITH EVERY SOURCE REPORTED — never a silent empty one.
 *
 * The first version preferred Redis, wrapped the parse in `catch { return new
 * Map() }`, and printed "resolved NOTHING from the ticker map" for ABVX. ABVX
 * is in the committed file, row [1956827, "Abivax S.A.", "ABVX", "Nasdaq"], so
 * that was not a fact about ABVX — it was a swallowed error wearing the
 * costume of one, which is the same defect this probe exists to stop the page
 * committing. An empty map and a map without this symbol are different
 * answers and must not print the same.
 *
 * THE COMMITTED FILE IS TRIED FIRST because its shape is known and versioned;
 * Redis is the fallback, and whichever answers says so along with its row
 * count. A parse failure prints the error rather than returning empty.
 */
async function loadTickerMap() {
  const sources = [];
  if (fsSync.existsSync(TICKER_FILE)) {
    sources.push([`file ${TICKER_FILE}`, () => fsSync.readFileSync(TICKER_FILE, "utf8")]);
  }
  if (TICKER_REDIS_KEY) {
    sources.push([`redis ${TICKER_REDIS_KEY}`, async () => {
      const v = await redis.get(TICKER_REDIS_KEY);
      return v == null ? null : typeof v === "string" ? v : JSON.stringify(v);
    }]);
  }
  for (const [name, read] of sources) {
    let text;
    try { text = await read(); } catch (e) { console.log(`  ticker source ${name}: READ FAILED — ${e.message}`); continue; }
    if (!text) { console.log(`  ticker source ${name}: empty`); continue; }
    try {
      const { map, shape } = tickerMod.parseTickerFile(text);
      console.log(`  ticker source ${name}: ${map.size} symbols, shape=${shape}`);
      if (map.size) return map;
    } catch (e) {
      console.log(`  ticker source ${name}: PARSE FAILED — ${e.message}`);
    }
  }
  console.log("  ticker map: NO SOURCE PRODUCED ONE — a lookup miss below is this, not the filer");
  return new Map();
}

const SYMS = (process.env.SYMBOLS || "ABVX").split(/[,\s]+/).filter(Boolean);
const money = (v) =>
  v === null || v === undefined ? "—"
    : Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(2)}B`
    : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M`
    : String(v);

// The P&L lines the card calls "Full profit & loss", in its own order.
const PL = [
  "revenue", "costOfRevenue", "grossProfit", "researchAndDevelopment",
  "sellingGeneralAndAdministrative", "otherOperatingExpense", "operatingIncome",
  "interestExpense", "nonOperatingIncomeExpense", "preTaxIncome",
  "incomeTaxExpense", "netIncomeToNoncontrollingInterest", "netIncome",
  "epsBasic", "epsDiluted", "sharesDiluted",
];

// WORDS THAT WOULD APPEAR IN A CONCEPT NAME FOR EACH MISSING LINE. Deliberately
// loose: the job is to surface candidates a human then judges, not to decide.
const LOOKS_LIKE = {
  revenue: /revenue|sales|turnover/i,
  costOfRevenue: /costofsales|costofrevenue|costofgoods/i,
  grossProfit: /grossprofit/i,
  sellingGeneralAndAdministrative: /sellinggeneral|administrativeexpense|generalandadmin/i,
  epsBasic: /earningspershare.*basic|basic.*pershare/i,
  epsDiluted: /earningspershare.*dilut|dilut.*pershare/i,
  operatingIncome: /operatingincome|profitlossfromoperating/i,
  researchAndDevelopment: /researchanddevelopment/i,
};

for (const symbol of SYMS) {
  console.log(`\n${"=".repeat(94)}\n${symbol}`);
  const set = await redis.get(`${FACTS_PREFIX}:${symbol.toUpperCase()}`);
  if (!set) { console.log("  NO STORED SET — the page has never read this filer."); continue; }

  console.log(`  cik=${set.cik} entity=${set.entityName}`);
  console.log(`  extracted=${new Date(set.at).toISOString().slice(0, 19)}Z  cur=${set.cur ?? "USD"}` +
    `  fx=${set.fx ? `${set.fx.source} (${set.fx.applied?.length ?? 0} rates, ${set.fx.refused?.length ?? 0} refused)` : "absent"}`);
  console.log(`  namespaces(tx)=${set.tx ? set.tx.join(", ") : "ABSENT (written before tx existed)"}`);
  console.log(`  quarters=${set.quarters.length} years=${set.years.length} instants=${set.instants.length}`);

  const latest = set.quarters[0] ?? set.years[0] ?? null;
  if (!latest) { console.log("  no periods at all"); continue; }
  console.log(`\n  LATEST PERIOD  ${latest.fp ?? "?"} FY${latest.fy ?? "?"} ended ${latest.e}` +
    ` (filed ${latest.f ?? "?"}, accession ${latest.a ?? "?"})`);

  // ── WHAT THE PAGE WOULD RENDER, LINE BY LINE ────────────────────────────
  console.log(`\n  ${"line".padEnd(34)} ${"stored".padEnd(12)} code`);
  const missing = [];
  for (const key of PL) {
    const c = cell(latest, key);
    const code = c.derived ?? "-";
    console.log(`  ${key.padEnd(34)} ${money(c.val).padEnd(12)} ${code}`);
    if (c.val === null) missing.push(key);
  }

  // ── HOW MUCH OF THE WHOLE SET IS EMPTY ──────────────────────────────────
  const filled = SEC_FIELDS.filter((f) => valueOf(latest, f.key) !== null).length;
  console.log(`\n  COVERAGE  ${filled} of ${SEC_FIELDS.length} stored fields carry a value in this period`);

  if (!missing.length) { console.log("  nothing missing on the P&L — the blanks are elsewhere."); continue; }

  // ── (b) OR (c): ASK THE RAW PAYLOAD ─────────────────────────────────────
  //
  // The stored set cannot distinguish "the filer tagged this under a concept
  // we do not list" from "the filer does not report this line". Only the
  // payload can, so the payload is fetched — ONCE, for the concept NAMES, and
  // nothing here is re-extracted or compared against the stored numbers.
  // ── THE STORED CIK CAN BE NULL, AND ABVX'S IS ──────────────────────────
  //
  // MEASURED (relay 35698132753): the stored set carries entityName
  // "Abivax S.A." and cik=null. So the CIK is resolved from the ticker map
  // instead — the SAME parser the site uses, lifted, because this file has two
  // possible layouts and a hand-rolled reader of the legacy one already
  // reported "no CIK" for three filers that had one.
  //
  // A null stored CIK is worth reporting in its own right: it is what a
  // re-fetch would need.
  let cik = set.cik;
  if (!cik) {
    const map = await loadTickerMap();
    cik = map.get(symbol.toUpperCase())?.cik ?? null;
    console.log(`  NOTE  stored cik is null; resolved ${cik ?? "NOTHING"} from the ticker map`);
  }
  if (!cik) { console.log("  no CIK anywhere, cannot fetch the payload for concept names"); continue; }
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`;
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  if (!res.ok) { console.log(`  companyfacts HTTP ${res.status} — cannot name the concepts`); continue; }
  const facts = await res.json();
  const namespaces = Object.keys(facts.facts ?? {});
  console.log(`\n  PAYLOAD namespaces: ${namespaces.join(", ")}`);

  for (const key of missing) {
    const chain = SEC_FIELDS.find((f) => f.key === key)?.chain ?? [];
    const tagged = [];
    for (const ns of namespaces) {
      for (const concept of Object.keys(facts.facts[ns] ?? {})) {
        // THE UNIT KEY IS PART OF THE EVIDENCE, not decoration. A concept that
        // is tagged AND in chain and still stored null is not a coverage gap —
        // it is a lookup miss, and the unit is where those happen: a EUR filer
        // publishes per-share figures under "EUR/shares", and the field table
        // declares "USD/shares". See unitKeysFor. ABVX's EPS is exactly this
        // shape, so printing the concept without its units stops one question
        // short of the answer.
        const units = Object.keys(facts.facts[ns]?.[concept]?.units ?? {});
        const u = units.length ? ` {${units.join(", ")}}` : "";
        const ifrsChain = SEC_FIELDS.find((f) => f.key === key)?.ifrsChain ?? [];
        const inChain = chain.includes(concept) || ifrsChain.includes(concept);
        if (inChain) tagged.push(`${ns}:${concept}${u} [IN CHAIN — ${ifrsChain.includes(concept) ? "ifrs" : "us-gaap"}]`);
        else if (LOOKS_LIKE[key]?.test(concept)) tagged.push(`${ns}:${concept}${u}`);
      }
    }
    const declared = SEC_FIELDS.find((f) => f.key === key)?.unit ?? "?";
    console.log(`\n  ${key} — stored null (field declares unit "${declared}", set reports in ${set.cur ?? "USD"})`);
    if (!tagged.length) {
      console.log(`    THE FILER TAGS NOTHING THAT LOOKS LIKE THIS LINE.`);
      console.log(`    Not a coverage gap: there is no concept to add. Either the company does not`);
      console.log(`    report it, or it does not have it.`);
    } else {
      for (const t of tagged.slice(0, 12)) console.log(`    ${t}`);
      if (tagged.length > 12) console.log(`    ... and ${tagged.length - 12} more`);
    }
  }
}
