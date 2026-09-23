// #535 COWORK #7 — THREE FOLLOW-UPS, READ-ONLY, ONE PASS OVER companyfacts.
//
//   #6-B  Revenue chain candidates, measured the #533 way — periods FILLED
//         (was blank) vs periods ALTERED (an existing figure changes), per
//         filer, across every stored set; and whether the 21 refused filers
//         come back under 100% net margin.
//           B1  `Revenues` ranked ahead of the Excluding tag (a REIT's total)
//           B2  shipped chain + RevenuesNetOfInterestExpense appended (banks)
//   #2    CRWD: SEC's `fy` is wrong on 3 of its 4 newest 10-Ks. Candidate:
//         the NEWEST annual reading decides the offset instead of the mode.
//         Which of the 120 Jan-Jun year-end filers would that relabel?
//   EPS   For the filers with net income but no EPS: which per-share concepts
//         their companyfacts DOES carry on the newest quarter (plain facts
//         only exist there), so the chain gap can be named.
// relay task: write-spotcheck-census-3
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; spot-check census 3)";
const strip = (f) => fs.readFileSync(f, "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const FIELDS = fs.readFileSync("lib/server/secFields.ts", "utf8");
const EXTRACT = strip("lib/server/secExtract.ts");
const REST = [strip("lib/server/fxRates.ts"), strip("lib/server/secCurrency.ts"), strip("lib/server/secFactCodec.ts")];
const build = (fields, extract = EXTRACT) => lift([fields, extract, ...REST].join("\n"));
const CHAIN = `chain: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"]`;
if (!FIELDS.includes(CHAIN)) { console.error("FATAL: revenue chain anchor"); process.exit(2); }
const X = await build(FIELDS);
const B1 = await build(FIELDS.replace(CHAIN, `chain: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"]`));
const B2 = await build(FIELDS.replace(CHAIN, `chain: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax", "RevenuesNetOfInterestExpense"]`));
const VOTE = "let best = recent[0].offset;\n  for (const [off, n] of counts) {\n    if (n > (counts.get(best) ?? 0)) best = off;\n  }";
if (!EXTRACT.includes(VOTE)) { console.error("FATAL: vote anchor"); process.exit(2); }
const XN = await build(FIELDS, EXTRACT.replace(VOTE, "const best = recent[0].offset;"));

const manifestSrc = fs.readFileSync("lib/server/secManifest.ts", "utf8");
const pick = (n) => (manifestSrc.match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const manifest = await redis.get(pick("SEC_MANIFEST_KEY"));
const FACTS = pick("SEC_FACTS_PREFIX");
const all = Object.entries(manifest.symbols).filter(([, e]) => e.cik).map(([s]) => s).sort();
const sets = new Map();
for (let i = 0; i < all.length; i += 50) {
  const b = all.slice(i, i + 50);
  const ss = await Promise.all(b.map((s) => redis.get(`${FACTS}:${s}`)));
  b.forEach((s, k) => { if (ss[k]?.quarters) sets.set(s, ss[k]); });
}
let lastAt = 0;
const get = async (url) => {
  const w = Math.max(0, lastAt + 130 - Date.now());
  if (w) await new Promise((r) => setTimeout(r, w));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  return res.ok ? res.json() : null;
};

const REFUSED = new Set("AMT CCI CFG CFR COF CPT CRCL ESS EXR HIG INVH KEY MET MTB NAMM OHI SBAC SOFI UDR VS ZION".split(" "));
const NO_EPS = new Set("ARES ATHS BKR BRK-B COKE CQP FWONK HSY JEF KKR MPLX ONON PAA SUN V WES WMG".split(" "));
const revByEnd = (M, ex) => {
  const i = M.SEC_FIELD_KEYS.indexOf("revenue");
  const m = new Map();
  for (const p of [...ex.quarters, ...ex.years]) m.set(`${p.start ?? ""}|${p.end}`, p.values[i]?.val ?? null);
  return m;
};
const tally = { B1: { filled: 0, altered: 0, filersAltered: [], rescued: [] }, B2: { filled: 0, altered: 0, filersAltered: [], rescued: [] } };
const relabel = [];
let fyChecked = 0, read = 0;
const epsLines = [];

for (const [s, set] of sets) {
  const facts = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${manifest.symbols[s].cik}.json`);
  if (!facts) continue;
  read++;
  const base = X.extractCompanyFacts(s, facts);
  const b = revByEnd(X, base);
  for (const [name, M] of [["B1", B1], ["B2", B2]]) {
    const ex = M.extractCompanyFacts(s, facts);
    const v = revByEnd(M, ex);
    let f = 0, a = 0, maxRatio = 1;
    for (const [k, nv] of v) {
      const ov = b.get(k) ?? null;
      if (ov === null && nv !== null) f++;
      else if (ov !== null && nv !== null && Math.abs(nv - ov) > Math.abs(ov) * 0.005) { a++; maxRatio = Math.max(maxRatio, Math.abs(nv / (ov || 1))); }
    }
    tally[name].filled += f;
    tally[name].altered += a;
    if (a) tally[name].filersAltered.push(`${s}(${a}, x${maxRatio.toFixed(1)})`);
    if (REFUSED.has(s)) {
      const p = ex.quarters[0] && (!ex.years[0] || ex.quarters[0].end >= ex.years[0].end) ? ex.quarters[0] : ex.years[0];
      const ri = M.SEC_FIELD_KEYS.indexOf("revenue"), ni = M.SEC_FIELD_KEYS.indexOf("netIncome"), oi = M.SEC_FIELD_KEYS.indexOf("operatingIncome");
      const rev = p?.values[ri]?.val, n = p?.values[ni]?.val, op = p?.values[oi]?.val;
      if (rev > 0 && n !== null && n / rev <= 1 && (op == null || op <= rev)) tally[name].rescued.push(`${s} ${(100 * n / rev).toFixed(0)}%`);
    }
  }
  const ye = set.years?.[0]?.e;
  if (ye && Number(ye.slice(5, 7)) <= 6 && set.quarters[0]) {
    fyChecked++;
    const a = X.fiscalYearOffset(facts, ye), n = XN.fiscalYearOffset(facts, ye);
    const q = set.quarters[0].e;
    const la = X.fiscalLabel(q, a.yearEnd ?? ye, a), ln = XN.fiscalLabel(q, n.yearEnd ?? ye, n);
    if (la.fy !== ln.fy || la.fp !== ln.fp) relabel.push(`${s}: ${la.fp} FY${la.fy} -> ${ln.fp} FY${ln.fy} (vote ${a.offset} ${a.agreeing}/${a.disagreeing} -> newest ${n.offset})`);
  }
  if (NO_EPS.has(s) && set.quarters[0]) {
    const end = set.quarters[0].e;
    const found = new Set();
    for (const [ns, tags] of Object.entries(facts.facts ?? {})) for (const [tag, def] of Object.entries(tags))
      if (/PerShare|PerUnit|PerDiluted|PerBasic/i.test(tag))
        for (const [unit, rows] of Object.entries(def.units ?? {})) if (rows.some((r) => r.end === end && r.start)) found.add(`${ns}:${tag} [${unit}]`);
    epsLines.push(`${s} (${end}): ${found.size ? [...found].slice(0, 6).join(", ") : "no per-share concept on this period"}`);
  }
}

console.log(`${read} companyfacts payloads read of ${sets.size} stored sets\n`);
console.log(`${"=".repeat(78)}\n#6-B REVENUE CHAIN CANDIDATES (periods; altered = an existing figure changes by > 0.5%)`);
for (const [name, t] of Object.entries(tally)) {
  console.log(`\n  ${name}: filled ${t.filled} · ALTERED ${t.altered} across ${t.filersAltered.length} filers`);
  console.log(`    altered filers (periods, max ratio): ${t.filersAltered.slice(0, 80).join(" ")}${t.filersAltered.length > 80 ? " …" : ""}`);
  console.log(`    of the 21 refused, back under 100% with a sane operating line: ${t.rescued.length} — ${t.rescued.join(", ")}`);
}
console.log(`\n${"=".repeat(78)}\n#2 NEWEST ANNUAL READING DECIDES THE OFFSET — relabels ${relabel.length} of ${fyChecked}`);
for (const l of relabel) console.log(`  ${l}`);
console.log(`\n${"=".repeat(78)}\nEPS: PER-SHARE CONCEPTS companyfacts CARRIES ON THE NEWEST QUARTER`);
for (const l of epsLines) console.log(`  ${l}`);
