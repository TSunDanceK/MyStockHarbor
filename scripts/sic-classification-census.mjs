// COWORK #3 (#552), MEASURE FIRST: can SEC SIC codes carry Pickers' sector and
// industry filters? Reads only. Prints AGGREGATES ONLY: counts, SIC codes and
// SEC's own SIC descriptions. It prints no per-ticker FMP value, and nothing
// is stored.
//
// Universes:
//   U1  the Pickers universe (msh:pickers:v10:symbols)
//   U2  the top 3,000 US-listed by market cap. Ranked from the screener rows
//       Pickers renders today, read here once for ranking and comparison only.
//
// "Today's label" = the sector/industry Pickers renders now (the fundamentals
// row, else the screener row). "Mapped" = our own SEC leg, as the resolver in
// lib/server/staticProfile.ts reads it: the 10-K override
// (data/sec/classification-overrides.json), else the SIC table
// (data/sec/sic-classification.json), else the major group's sector. The
// comparison with today's labels is a one-off internal number; nothing is stored.
//
//   relay task: write-sic-classification-census  (credentialled for the read)
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { symbolSpellings } from "../lib/symbolSpellings.mjs";

const redis = Redis.fromEnv();
let commands = 0;
const r = async (fn) => { commands++; return fn(); };
const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const SYMBOLS_KEY = keyOf("lib/server/pickersBuilder.ts", "PICKERS_SYMBOLS_KEY");
const FUND = keyOf("lib/server/fundamentalsCache.ts", "FUND_KEY_PREFIX");
const SCR = keyOf("lib/server/fundamentalsCache.ts", "SCREENER_FUND_KEY_PREFIX");
if (!SYMBOLS_KEY || !FUND || !SCR) { console.error("FATAL: key names not readable"); process.exit(2); }

const registrants = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const TABLE = JSON.parse(fs.readFileSync("data/sec/sic-classification.json", "utf8"));
const OVERRIDES = JSON.parse(fs.readFileSync("data/sec/classification-overrides.json", "utf8"));
const overrideFor = (s) => symbolSpellings(s).map((v) => OVERRIDES.overrides[v]).find(Boolean) ?? null;
const mapped = (s, sic) => {
  const o = overrideFor(s);
  if (o && (o.sector || o.industry)) return { sector: o.sector ?? null, industry: o.industry ?? null };
  if (!sic) return { sector: null, industry: null };
  const row = TABLE.codes[sic];
  return { sector: row ? row.sector : TABLE.majorGroups[sic.slice(0, 2)] ?? null, industry: row?.industry ?? null };
};
const tickers = JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8"));
const cikByTicker = new Map(tickers.data.map(([cik, , t]) => [String(t).toUpperCase(), String(cik).padStart(10, "0")]));
const COARSE = new Set(["6770", "7372", "6199", "6189", "6798", "9995", "8742"]);

// ── the universes and today's labels ─────────────────────────────────────
const u1 = ((await r(() => redis.get(SYMBOLS_KEY))) ?? []).map((s) => String(s).toUpperCase());
const scrKeys = [];
let cursor = "0";
do {
  const [next, batch] = await r(() => redis.scan(cursor, { match: `${SCR}*`, count: 1000 }));
  scrKeys.push(...batch); cursor = String(next);
} while (cursor !== "0");
const scrRows = new Map();
for (let i = 0; i < scrKeys.length; i += 100) {
  const chunk = scrKeys.slice(i, i + 100);
  const vals = await r(() => redis.mget(...chunk));
  chunk.forEach((k, j) => { if (vals[j]) scrRows.set(k.slice(SCR.length).toUpperCase(), vals[j]); });
}
const u2 = [...scrRows.entries()]
  .filter(([, v]) => typeof v?.marketCap === "number" && v.marketCap > 0)
  .sort((a, b) => b[1].marketCap - a[1].marketCap).slice(0, 3000).map(([s]) => s);
const fundRows = new Map();
for (let i = 0; i < u1.length; i += 100) {
  const chunk = u1.slice(i, i + 100);
  const vals = await r(() => redis.mget(...chunk.map((s) => `${FUND}${s}`)));
  chunk.forEach((s, j) => { if (vals[j]) fundRows.set(s, vals[j]); });
}
const today = (s) => {
  const f = fundRows.get(s), c = scrRows.get(s);
  const clean = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return { sector: clean(f?.sector) ?? clean(c?.sector), industry: clean(f?.industry) ?? clean(c?.industry) };
};

// ── SIC per symbol: committed registrants, else SEC submissions ───────────
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; sic census)";
let fetched = 0, fetchFailed = 0, lastAt = 0;
const sicOf = new Map();
async function sicFor(s) {
  if (sicOf.has(s)) return sicOf.get(s);
  for (const v of symbolSpellings(s)) {
    const reg = registrants[v];
    if (reg?.sic) { sicOf.set(s, { sic: reg.sic, desc: reg.sicDescription }); return sicOf.get(s); }
  }
  const cik = symbolSpellings(s).map((v) => cikByTicker.get(v)).find(Boolean);
  let out = null;
  if (cik) {
    const wait = Math.max(0, lastAt + 130 - Date.now());
    if (wait) await new Promise((res) => setTimeout(res, wait));
    lastAt = Date.now();
    try {
      const res = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: { "User-Agent": UA } });
      if (res.ok) { const j = await res.json(); fetched++; if (j.sic) out = { sic: String(j.sic), desc: j.sicDescription ?? null }; }
      else fetchFailed++;
    } catch { fetchFailed++; }
  }
  sicOf.set(s, out);
  return out;
}

async function census(name, universe) {
  const rows = [];
  for (const s of universe) {
    const sic = await sicFor(s);
    const t = today(s);
    const m = mapped(s, sic?.sic ?? null);
    rows.push({ s, sic: sic?.sic ?? null, desc: sic?.desc ?? null, t, mappedSector: m.sector, mappedIndustry: m.industry });
  }
  const n = rows.length;
  const pct = (k) => `${k} (${((100 * k) / Math.max(1, n)).toFixed(1)}%)`;
  const withSic = rows.filter((x) => x.sic);
  const mappedRows = rows.filter((x) => x.mappedSector);
  const todayHas = rows.filter((x) => x.t.sector);
  const both = rows.filter((x) => x.mappedSector && x.t.sector);
  const agree = both.filter((x) => x.mappedSector === x.t.sector);
  console.log(`\n=== ${name}: ${n} symbols ===`);
  console.log(`  has a SIC code                 ${pct(withSic.length)}`);
  console.log(`  SIC maps to a sector label     ${pct(mappedRows.length)}   (today renders a sector for ${pct(todayHas.length)})`);
  console.log(`  sector agrees with today       ${agree.length} of ${both.length} comparable (${((100 * agree.length) / Math.max(1, both.length)).toFixed(1)}%)`);

  // per sector filter: today's rows vs SIC-mapped rows
  console.log("  per sector filter: today | SIC-mapped | in both | precision | recall");
  const sectors = [...new Set(rows.flatMap((x) => [x.t.sector, x.mappedSector]).filter(Boolean))].sort();
  for (const sec of sectors) {
    const a = new Set(rows.filter((x) => x.t.sector === sec).map((x) => x.s));
    const b = new Set(rows.filter((x) => x.mappedSector === sec).map((x) => x.s));
    const inter = [...a].filter((x) => b.has(x)).length;
    console.log(`    ${sec.padEnd(24)} ${String(a.size).padStart(5)} ${String(b.size).padStart(6)} ${String(inter).padStart(6)}   ` +
      `${b.size ? ((100 * inter) / b.size).toFixed(0) : "-"}%   ${a.size ? ((100 * inter) / a.size).toFixed(0) : "-"}%`);
  }

  // SIC codes driving sector disagreement
  const dis = new Map();
  for (const x of both) if (x.mappedSector !== x.t.sector) dis.set(x.sic, (dis.get(x.sic) ?? 0) + 1);
  const unmapped = new Map();
  for (const x of withSic) if (!x.mappedSector) unmapped.set(x.sic, (unmapped.get(x.sic) ?? 0) + 1);
  const descOf = new Map(withSic.map((x) => [x.sic, x.desc]));
  const top = (m, k) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([c, v]) => `${c} ${descOf.get(c) ?? ""} (${v})`);
  console.log(`  SIC codes behind most sector disagreement: ${top(dis, 12).join("; ") || "none"}`);
  console.log(`  SIC codes with no sector mapping: ${[...unmapped.values()].reduce((a, b) => a + b, 0)} symbols; top: ${top(unmapped, 10).join("; ") || "none"}`);

  // industry: purity of each SIC code against today's industry labels
  const byCode = new Map();
  for (const x of withSic) {
    if (!x.t.industry) continue;
    const m = byCode.get(x.sic) ?? new Map();
    m.set(x.t.industry, (m.get(x.t.industry) ?? 0) + 1);
    byCode.set(x.sic, m);
  }
  let covered = 0, majority = 0;
  const impure = [];
  for (const [code, m] of byCode) {
    const tot = [...m.values()].reduce((a, b) => a + b, 0);
    const best = Math.max(...m.values());
    covered += tot; majority += best;
    if (tot >= 5 && best / tot < 0.6) impure.push(`${code} ${descOf.get(code) ?? ""} (${tot} symbols, ${m.size} labels, top ${Math.round((100 * best) / tot)}%)`);
  }
  const todayLabels = new Set(rows.map((x) => x.t.industry).filter(Boolean));
  console.log(`  industry: ${byCode.size} distinct SIC codes carry ${todayLabels.size} distinct industry labels today`);
  console.log(`  best case of a one-label-per-SIC table: ${majority} of ${covered} (${((100 * majority) / Math.max(1, covered)).toFixed(1)}%) keep today's industry label`);
  console.log(`  SIC codes too mixed for one label (>=5 symbols, top label <60%): ${impure.length}`);
  for (const line of impure.slice(0, 15)) console.log(`    ${line}`);

  // override candidates
  const noSic = rows.filter((x) => !x.sic).length;
  const coarse = withSic.filter((x) => COARSE.has(x.sic)).length;
  const impureCodes = new Set(impure.map((l) => l.split(" ")[0]));
  const inImpure = withSic.filter((x) => impureCodes.has(x.sic) && !COARSE.has(x.sic)).length;
  console.log(`  override candidates: no SIC ${noSic} + coarse codes (6770/7372/6199/…) ${coarse} + mixed codes ${inImpure} = ${noSic + coarse + inImpure}`);

  // industry agreement with today's label, and names left for the helper
  const indBoth = rows.filter((x) => x.mappedIndustry && x.t.industry);
  const indAgree = indBoth.filter((x) => x.mappedIndustry === x.t.industry).length;
  const noSector = rows.filter((x) => !x.mappedSector).length;
  const noIndustry = rows.filter((x) => !x.mappedIndustry).length;
  console.log(`  mapped industry agrees with today: ${indAgree} of ${indBoth.length} (${((100 * indAgree) / Math.max(1, indBoth.length)).toFixed(1)}%)`);
  console.log(`  left without a sector: ${noSector}; without an industry (the helper's list for this universe): ${noIndustry}`);

  // presets
  const semiToday = rows.filter((x) => x.t.industry === "Semiconductors").length;
  const semiSic = rows.filter((x) => x.mappedIndustry === "Semiconductors").length;
  const techToday = rows.filter((x) => x.t.sector === "Technology").length;
  const techSic = rows.filter((x) => x.mappedSector === "Technology").length;
  console.log(`  presets (the category predicate only): /semiconductor-stocks industry=Semiconductors today ${semiToday} vs SIC ${semiSic}; ` +
    `/cheap-tech-stocks sector=Technology today ${techToday} vs SIC ${techSic}`);
}

await census("U1 Pickers universe", u1);
await census("U2 top 3,000 by market cap", u2);
console.log(`\nSEC submissions fetched for symbols not in registrants.json: ${fetched} (failed ${fetchFailed})`);
console.log(`Redis commands used by this read: ${commands}`);
