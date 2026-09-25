// WHICH 20-F / 40-F FILERS' CURRENCY VOTE IS A TIE ON FIELDS, AND WHAT TWO
// TIE-BREAK RULES WOULD DECIDE (#552 COWORK #50 / #53, the TSM vote). Reads only.
//
// Today (secCurrency.reportingCurrency): most FIELDS wins; USD takes any tie.
// TSM ties (TWD and USD convenience rows cover the same fields), so it reads
// the company's USD convenience rows and its TWD-only FY2025 20-F is locked out.
//   (a) on a tie, most ROWS wins, then USD;
//   (b) on a tie, the currency of the NEWEST ANNUAL PERIOD wins, then USD.
// For every filer where (a) or (b) differs from today: the newest FY revenue
// as today's vote reads it, and as the new currency reads it converted at the
// FX module's own average for that year (the conversion the site would do).
//
// THE SHIPPED reportingCurrency AND FX SOURCES ARE LIFTED, not re-implemented.
// Prints SEC values and public reference rates only. Uncredentialled.
//   relay task: currency-vote-census   (needsTypescript)
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; currency vote census)";
const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const mod = await lift([
  fs.readFileSync("lib/server/secFields.ts", "utf8"),
  strip("lib/server/fxRates.ts"),
  strip("lib/server/secCurrency.ts"),
  strip("lib/server/secExtract.ts"),
].join("\n"));

const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const ONLY = (process.env.SYMBOLS || "").split(/[,\s]+/).filter(Boolean);
const universe = Object.entries(REG)
  .filter(([s, r]) => (ONLY.length ? ONLY.includes(s) : process.env.ALL ? true : r.annualForm === "20-F" || r.annualForm === "40-F") && r.cik)
  .map(([s, r]) => [s, String(r.cik).padStart(10, "0")]);
// One CIK per filer: dual listings share it.
const byCik = new Map();
for (const [s, c] of universe) if (!byCik.has(c)) byCik.set(c, s);

let lastAt = 0;
const get = async (url) => {
  const wait = Math.max(0, lastAt + 125 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try { res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } }); }
    catch { res = { ok: false, status: 0 }; }
    if (res.status !== 503 && res.status !== 429 && res.status !== 0) return res;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  return { ok: false, status: 503 };
};

const MONEY = new Set(["USD", "USD/shares"]);
const isAnnual = (r) => r.start && r.end && (() => { const d = (Date.parse(r.end) - Date.parse(r.start)) / 86_400_000; return d >= 350 && d <= 380; })();
const moneySources = [];
for (const f of mod.SEC_FIELDS) {
  if (!MONEY.has(f.unit)) continue;
  moneySources.push({ key: f.key, ns: f.taxonomy, chain: f.chain });
  if (f.ifrsChain?.length) moneySources.push({ key: f.key, ns: "ifrs-full", chain: f.ifrsChain });
}
const revenueSources = moneySources.filter((s) => s.key === "revenue");

function tally(facts) {
  const fields = new Map(), rows = new Map(), newest = new Map();
  for (const { key, ns, chain } of moneySources) {
    for (const tag of chain) {
      for (const [unit, list] of Object.entries(facts.facts?.[ns]?.[tag]?.units ?? {})) {
        const c = unit.split("/")[0];
        if (!/^[A-Z]{3}$/.test(c) || !(list?.length)) continue;
        (fields.get(c) ?? fields.set(c, new Set()).get(c)).add(key);
        rows.set(c, (rows.get(c) ?? 0) + list.length);
        for (const r of list) if (isAnnual(r) && r.end > (newest.get(c) ?? "")) newest.set(c, r.end);
      }
    }
  }
  return { fields, rows, newest };
}

function newestRevenue(facts, ccy) {
  let best = null;
  for (const { ns, chain } of revenueSources) {
    for (const tag of chain) {
      for (const r of facts.facts?.[ns]?.[tag]?.units?.[ccy] ?? []) {
        if (isAnnual(r) && (!best || r.end > best.end)) best = { ...r };
      }
      if (best) return best; // first tag in the chain with a row, as the chain ranks
    }
  }
  return best;
}

const series = new Map();
async function toUsd(row, ccy) {
  if (!row) return null;
  if (ccy === "USD") return row.val;
  if (!series.has(ccy)) series.set(ccy, await mod.loadSeries(ccy, "2018-01-01", new Date().toISOString().slice(0, 10), mod.defaultSources()));
  const s = series.get(ccy);
  const avg = s ? mod.averageOver(s, row.start, row.end) : null;
  return avg ? row.val * avg.usdPerUnit : null;
}
const B = (v) => (v === null || v === undefined ? "n/a" : `$${(v / 1e9).toFixed(2)}B`);
const native = (r, c) => (r ? `${(r.val / 1e9).toFixed(1)}B ${c} FY${r.end.slice(0, 4)}` : "none");

let fetched = 0, failed = 0, ties = 0;
const flips = [];
const tieRows = [];
const fxCover = [];
for (const [cik, sym] of byCik) {
  const res = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
  if (!res.ok) { failed++; continue; }
  const facts = await res.json();
  fetched++;
  const today = mod.reportingCurrency(facts);
  const { fields, rows, newest } = tally(facts);
  if (fields.size < 2) continue;
  const top = Math.max(...[...fields.values()].map((s) => s.size));
  const tied = [...fields.keys()].filter((c) => fields.get(c).size === top).sort();
  if (tied.length < 2) continue;
  ties++;
  const pick = (score) => [...tied].sort((x, y) => {
    const d = score(y) - score(x);
    if (d) return d;
    if (x === "USD") return -1;
    if (y === "USD") return 1;
    return x < y ? -1 : 1;
  })[0];
  const a = pick((c) => rows.get(c) ?? 0);
  const b = pick((c) => Date.parse(newest.get(c) ?? "1900-01-01"));
  // (c): recency, then rows (then USD). THE SHIPPED FUNCTION on this branch is
  // the one that decides; this line is its expected answer, printed beside it.
  const cRule = [...tied].sort((x, y) => {
    const nx = newest.get(x) ?? "", ny = newest.get(y) ?? "";
    if (nx !== ny) return nx < ny ? 1 : -1;
    const d = (rows.get(y) ?? 0) - (rows.get(x) ?? 0);
    if (d) return d;
    if (x === "USD") return -1;
    if (y === "USD") return 1;
    return x < y ? -1 : 1;
  })[0];
  const shipped = today;
  const desc = tied.map((c) => `${c}:${fields.get(c).size}f/${rows.get(c)}r/newest ${newest.get(c) ?? "-"}`).join("  ");
  tieRows.push(`${sym.padEnd(6)} shipped ${shipped}  (a) ${a}  (b) ${b}  (c) ${cRule}${cRule !== shipped ? "  *** shipped != (c)" : ""}   ${desc}`);
  // FX COVERAGE for a non-USD (c) winner: each annual period in that currency
  // that the FX module can average (COWORK #55: the ECB cross for CNY/INR/KRW).
  if (cRule !== "USD") {
    const ends = new Map();
    for (const { ns, chain } of moneySources) for (const tag of chain)
      for (const r of facts.facts?.[ns]?.[tag]?.units?.[cRule] ?? []) if (isAnnual(r)) ends.set(r.end, r.start);
    const recent = [...ends].sort((x, y) => (x[0] < y[0] ? 1 : -1)).slice(0, 6);
    if (!series.has(cRule)) series.set(cRule, await mod.loadSeries(cRule, "2018-01-01", new Date().toISOString().slice(0, 10), mod.defaultSources()));
    const sr = series.get(cRule);
    const ok = recent.filter(([e, st]) => sr && mod.averageOver(sr, st, e)).length;
    fxCover.push(`${sym} ${cRule} ${ok}/${recent.length}`);
  }
  if (a !== today || b !== today) {
    const cur = newestRevenue(facts, today);
    const out = {};
    for (const c of new Set([a, b])) {
      if (c === today) continue;
      const r = newestRevenue(facts, c);
      out[c] = { r, usd: await toUsd(r, c) };
    }
    flips.push({ sym, today, a, b, cur, curUsd: await toUsd(cur, today), out });
  }
}

console.log(`scope: ${byCik.size} 20-F/40-F filers (by CIK); fetched ${fetched}, failed ${failed}`);
console.log(`ties on field count today: ${ties}`);
for (const l of tieRows) console.log(`  ${l}`);
const fa = flips.filter((f) => f.a !== f.today).length, fb = flips.filter((f) => f.b !== f.today).length;
console.log(`\nwould flip: (a) more rows ${fa}   (b) newest annual period ${fb}`);
for (const f of flips) {
  const parts = Object.entries(f.out).map(([c, o]) => `${c}: ${native(o.r, c)} -> ${B(o.usd)}`).join("; ");
  console.log(`  ${f.sym}: today ${f.today} ${native(f.cur, f.today)} = ${B(f.curUsd)}  |  (a)=${f.a} (b)=${f.b}  |  ${parts}`);
}
console.log(`\nFX coverage of the (c) winner's newest annual periods (years with an average rate / years): ${fxCover.join("  ")}`);
for (const [c, s] of series) console.log(`fx ${c}: ${s ? `${s.source}, ${s.observations.length} obs` : "no series"}`);
