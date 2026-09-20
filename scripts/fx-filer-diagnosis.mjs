// WHY RYAAY (EUR) AND ABEV (BRL) DID NOT CONVERT WHILE CNI (CAD) DID.
//
// Two candidate causes, and they are distinguishable only by looking at the
// real payloads and the real series — which is why this runs on a runner:
// data.sec.gov and fred.stlouisfed.org are both 403 CONNECT from the sandbox.
//
//   A. THE CURRENCY DECISION. `reportingCurrency` returns "USD" if ANY money
//      row anywhere is USD-tagged. A foreign filer that publishes a handful of
//      convenience-translation or legacy USD rows would be forced onto the USD
//      path, its home-currency lines refused, and the page would show exactly
//      the "reports in EUR" block the owner is still seeing.
//
//   B. THE SERIES. DEXUSEU and DEXCAUS were measured. DEXBZUS was NOT — the
//      BRL entry in FRED_SERIES was written from the same naming pattern and
//      never tested, so it may not exist or may not serve.
//
// A and B predict the SAME visible symptom and have completely different fixes,
// so this prints both for all three filers rather than confirming one.
//
// THE SHIPPED FUNCTIONS ARE LIFTED, not re-implemented: the question is what
// the deployed code decides, and a transcription would answer for a copy.
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor fx diagnosis";
const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const mod = await lift(
  [
    fs.readFileSync("lib/server/secFields.ts", "utf8"),
    strip("lib/server/fxRates.ts"),
    strip("lib/server/secCurrency.ts"),
    strip("lib/server/secExtract.ts"),
  ].join("\n")
);

// ── THE TICKER FILE IS THE fields/data SHAPE, AND COLUMNS ARE READ BY NAME ──
//
// The first run of this probe assumed the LEGACY {cik_str, ticker} shape and
// reported "no CIK in the ticker file" for all three filers — a wrong answer
// that looked like a finding about the filers rather than about the reader.
//
// secTickerMap.parseTickerFile is the shipped reader and is NOT lifted here
// because it imports @upstash/redis, which the read-only relay job deliberately
// does not install. So the shape is read directly, by COLUMN NAME rather than
// by position, which is the rule that parser's own docblock gives: a positional
// read is one column insertion away from filing every exchange under `name`.
const tickerFile = JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8"));
const cikBySymbol = (() => {
  const out = new Map();
  const fields = tickerFile.fields;
  const rows = tickerFile.data;
  if (!Array.isArray(fields) || !Array.isArray(rows)) {
    throw new Error("company-tickers.json is not the fields/data shape this probe reads");
  }
  const idx = (name) => fields.findIndex((f) => String(f).toLowerCase() === name);
  const iCik = idx("cik");
  const iTicker = idx("ticker");
  if (iCik === -1 || iTicker === -1) throw new Error(`missing cik/ticker column in ${fields.join(",")}`);
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const t = String(row[iTicker] ?? "").trim().toUpperCase();
    // FIRST WINS, as the shipped parser does: dual-class names share one CIK.
    if (t && !out.has(t)) out.set(t, String(row[iCik]).padStart(10, "0"));
  }
  return out;
})();
const cikOf = (sym) => cikBySymbol.get(sym) ?? null;

const SYMS = (process.env.SYMBOLS || "RYAAY,CNI,ABEV").split(/[,\s]+/).filter(Boolean);

console.log("=".repeat(76));
console.log("A. WHAT THE SHIPPED reportingCurrency DECIDES, AND FROM WHAT EVIDENCE");
console.log("=".repeat(76));

const MONEY_UNITS = new Set(["USD", "USD/shares"]);
for (const sym of SYMS) {
  const cik = cikOf(sym);
  if (!cik) { console.log(`\n${sym}: no CIK in the ticker file`); continue; }
  const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
    headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" },
  });
  if (!res.ok) { console.log(`\n${sym}: companyfacts HTTP ${res.status}`); continue; }
  const facts = await res.json();

  // THE SAME WALK reportingCurrency DOES, but printing the histogram it reduces
  // to a single answer. The answer alone cannot distinguish "no USD present"
  // from "three USD rows out of nine hundred".
  const counts = new Map();
  const usdWitness = [];
  for (const field of mod.SEC_FIELDS) {
    if (!MONEY_UNITS.has(field.unit)) continue;
    const sources = [{ ns: field.taxonomy, chain: field.chain }];
    if (field.ifrsChain?.length) sources.push({ ns: "ifrs-full", chain: field.ifrsChain });
    for (const { ns, chain } of sources) {
      for (const tag of chain) {
        const units = facts.facts?.[ns]?.[tag]?.units;
        if (!units) continue;
        for (const [unit, rows] of Object.entries(units)) {
          const code = unit.split("/")[0];
          if (!/^[A-Z]{3}$/.test(code)) continue;
          counts.set(code, (counts.get(code) ?? 0) + (rows?.length ?? 0));
          // WHICH TAGS CARRY THE USD, because "any USD wins" is only a defect
          // if the USD is incidental. If a filer really is majority-USD the
          // rule is doing its job.
          if (code === "USD" && usdWitness.length < 8) {
            usdWitness.push(`${ns}|${tag} x${rows?.length ?? 0}`);
          }
        }
      }
    }
  }
  const decided = mod.reportingCurrency(facts);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\n${sym}  (CIK ${cik})`);
  console.log(`  money rows by unit: ${sorted.map(([c, n]) => `${c}=${n} (${((n / total) * 100).toFixed(1)}%)`).join("  ")}`);
  console.log(`  reportingCurrency() decided: ${decided ?? "null -> falls back to USD"}`);
  if ((counts.get("USD") ?? 0) > 0 && sorted[0][0] !== "USD") {
    console.log(`  *** "ANY USD WINS" MISFIRED: USD is ${counts.get("USD")} of ${total} rows ` +
      `(${(((counts.get("USD") ?? 0) / total) * 100).toFixed(1)}%) but outranks ${sorted[0][0]} at ${sorted[0][1]}.`);
    console.log(`      USD carried by: ${usdWitness.join(", ")}`);
  }
  // AND WHAT THE EXTRACTION THEN PRODUCES, which is what the page sees.
  const ex = mod.extractCompanyFacts(sym, facts);
  console.log(`  extraction: currency=${ex.reportingCurrency} quarters=${ex.quarters.length} ` +
    `years=${ex.years.length} instants=${ex.instants.length} refusedUnits=${JSON.stringify(ex.refusedUnits)}`);
  // WHAT A PLURALITY RULE WOULD DECIDE, printed beside it so the proposed fix
  // carries a measured before/after rather than an argument.
  console.log(`  a plurality rule (most rows wins, USD on a tie) would decide: ${sorted[0][0]}`);
}

console.log("\n" + "=".repeat(76));
console.log("B. DOES FRED ACTUALLY SERVE EACH SERIES THE ADAPTER NAMES");
console.log("=".repeat(76));
// EVERY entry in FRED_SERIES, not the two that were measured. An id written
// from a naming pattern and never fetched is a guess with a plausible shape.
const SERIES = { EUR: "DEXUSEU", GBP: "DEXUSUK", CAD: "DEXCAUS", JPY: "DEXJPUS", CHF: "DEXSZUS", BRL: "DEXBZUS" };
for (const [ccy, id] of Object.entries(SERIES)) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=2019-01-01&coed=2026-12-31`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/csv" } });
    const body = await r.text();
    const isCsv = !/^\s*<!DOCTYPE|^\s*<html/i.test(body) && /^[A-Za-z_]+,[A-Za-z0-9_]+/.test(body.trim().split("\n")[0] ?? "");
    const rows = isCsv ? body.trim().split("\n").slice(1).map((l) => l.split(",")) : [];
    const numeric = rows.filter(([, v]) => v && v.trim() !== "." && Number.isFinite(Number(v)));
    console.log(`\n${ccy}  ${id}`);
    console.log(`  HTTP ${r.status} ct=${r.headers.get("content-type")} csv=${isCsv} rows=${rows.length} numeric=${numeric.length}`);
    if (numeric.length) {
      console.log(`  range ${numeric[0][0]} = ${numeric[0][1]}  ..  ${numeric[numeric.length - 1][0]} = ${numeric[numeric.length - 1][1]}`);
    } else {
      console.log(`  *** NO USABLE DATA — head: ${body.slice(0, 160).replace(/\s+/g, " ")}`);
    }
  } catch (e) {
    console.log(`\n${ccy}  ${id}\n  FETCH FAILED: ${e?.message ?? e}`);
  }
}
