// THE EARNINGS-PAGE GAPS (#552 COWORK #187 §3/§4/§5). READ-ONLY.
//
//   A. NET INCOME ABOVE REVENUE: every stored period (quarters and years) with
//      revenue > 0 and net income > revenue (net margin > 100%) -- the AFRM
//      shape, a revenue SUB-LINE read as the total.
//   B. THE 200 CUT, A's READERS: market cap (valuationInputs' share refusal),
//      total debt (no short- or long-term debt line on the balance-sheet
//      instant), and EPS (none in the newest year although net income is there).
//   C. QUARTERLY NET INCOME MISSING (BKNG): >= 4 of the newest 8 quarters with
//      no net income while the newest year has it; and Q4 rows absent while
//      years are present.
//   D. AFRM's revenue concepts from SEC (4 companyconcept requests).
//   E. §5: the top 300 manifest symbols by latest dollar volume (Tiingo close ×
//      volume -- a size proxy that needs no SEC shares, which a symbol with no
//      fact set does not have) with no stored fact set.
//
// Store: SCAN + MGET (fact sets), GET (manifest), HGETALL (eod-last). Anything
// else is refused before it leaves. SEC <= 8/s.
import fs from "node:fs";
import { register } from "node:module";
import { Redis } from "@upstash/redis";

register("./lib/ts-resolve-app.mjs", import.meta.url);

const READS = new Set(["scan", "mget", "get", "hgetall"]);
const counts = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (process.env.UPSTASH_REDIS_REST_URL && url.startsWith(process.env.UPSTASH_REDIS_REST_URL)) {
    const body = JSON.parse(init.body ?? "null");
    for (const c of Array.isArray(body?.[0]) ? body : [body]) {
      const op = String(c?.[0]).toLowerCase();
      if (!READS.has(op)) throw new Error(`read guard: ${op} refused`);
      counts[op] = (counts[op] ?? 0) + 1;
    }
  }
  return realFetch(input, init);
};

const { cell, balanceSheetInstant } = await import("../lib/server/secFactCodec.ts");
const { valuationInputs } = await import("../lib/server/secValuation.ts");
const keyOf = (file, name) => (fs.readFileSync(file, "utf8").match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];
const FACTS_PREFIX = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const MANIFEST_KEY = keyOf("lib/server/secManifest.ts", "SEC_MANIFEST_KEY");
const TIINGO_PREFIX = keyOf("lib/server/marketData/keys.ts", "TIINGO_PREFIX");
if (!FACTS_PREFIX || !MANIFEST_KEY || !TIINGO_PREFIX) { console.error("FATAL: a key moved"); process.exit(2); }
const CUT = JSON.parse(fs.readFileSync("data/due-strip.json", "utf8")).symbols;
const TODAY = new Date().toISOString().slice(0, 10);
const redis = Redis.fromEnv();
const val = (p, k) => { const v = p ? cell(p, k)?.val : null; return typeof v === "number" && Number.isFinite(v) ? v : null; };
const byEnd = (a, b) => (a.e < b.e ? 1 : -1);

const keys = [];
let cursor = "0";
do { const [next, batch] = await redis.scan(cursor, { match: `${FACTS_PREFIX}:*`, count: 1000 }); cursor = String(next); keys.push(...batch); } while (cursor !== "0");
const sets = new Map();
for (let i = 0; i < keys.length; i += 20) {
  const chunk = keys.slice(i, i + 20);
  const raw = await redis.mget(...chunk);
  chunk.forEach((k, j) => { if (raw[j]?.quarters) sets.set(k.slice(FACTS_PREFIX.length + 1), raw[j]); });
}
console.log(`fact sets read: ${sets.size}`);

// ── A ──
const over = [];
for (const [sym, set] of sets) {
  const hits = [...set.quarters, ...(set.years ?? [])].filter((p) => { const r = val(p, "revenue"), n = val(p, "netIncome"); return r !== null && r > 0 && n !== null && n > r; });
  if (hits.length) {
    const newest = [...hits].sort(byEnd)[0];
    over.push(`${sym}(${hits.length}; newest ${newest.e} ${Math.round((val(newest, "netIncome") / val(newest, "revenue")) * 100)}%)`);
  }
}
console.log(`\nA. NET INCOME ABOVE REVENUE (net margin > 100%) in at least one period: ${over.length} symbols`);
console.log(`   ${over.join(" ")}`);

// ── B ──
const noCap = [], noDebt = [], noEps = [];
for (const sym of CUT) {
  const set = sets.get(sym) ?? sets.get(sym.replace(/\./g, "-"));
  if (!set) { noCap.push(`${sym}(no fact set)`); continue; }
  let v;
  try { v = valuationInputs(set, TODAY); } catch (e) { v = { shares: null, refusals: [`threw: ${String(e.message).slice(0, 40)}`] }; }
  if (!v.shares) noCap.push(`${sym}(${(v.refusals ?? []).filter((r) => /share|ads|debt|class/.test(r)).join("+") || "no shares"})`);
  const bs = balanceSheetInstant(set);
  if (bs && val(bs, "shortTermDebt") === null && val(bs, "longTermDebt") === null) noDebt.push(sym);
  const fy = [...(set.years ?? [])].sort(byEnd)[0];
  if (fy && val(fy, "netIncome") !== null && val(fy, "epsDiluted") === null && val(fy, "epsBasic") === null) noEps.push(sym);
}
console.log(`\nB. THE 200 CUT`);
console.log(`   no market cap (share count refused or absent): ${noCap.length} · ${noCap.join(" ")}`);
console.log(`   no debt line on the balance sheet: ${noDebt.length} · ${noDebt.join(" ")}`);
console.log(`   newest year has net income but no EPS: ${noEps.length} · ${noEps.join(" ")}`);

// ── C ──
const niGap = [], noQ4 = [];
for (const [sym, set] of sets) {
  const q8 = [...set.quarters].sort(byEnd).slice(0, 8);
  const fy = [...(set.years ?? [])].sort(byEnd)[0];
  const missing = q8.filter((p) => val(p, "netIncome") === null).length;
  if (q8.length >= 6 && missing >= 4 && fy && val(fy, "netIncome") !== null) niGap.push(`${sym}(${missing}/${q8.length})`);
  if (q8.length >= 6 && (set.years ?? []).length >= 2 && !q8.some((p) => p.fp === "Q4")) noQ4.push(sym);
}
const inCut = (list) => list.filter((x) => CUT.includes(x.split("(")[0]));
console.log(`\nC. QUARTERLY NET INCOME MISSING (>= 4 of the newest 8, the year has it): ${niGap.length} symbols; in the 200 cut: ${inCut(niGap).join(" ") || "none"}`);
console.log(`   all: ${niGap.join(" ")}`);
console.log(`   NO Q4 ROW in the newest 8 quarters (years present): ${noQ4.length}; in the 200 cut: ${inCut(noQ4).join(" ") || "none"}`);

// ── D ──
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; read-only census)";
let sec = 0;
console.log("\nD. AFRM's REVENUE CONCEPTS (fiscal years, as filed)");
for (const concept of ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenuesNetOfInterestExpense", "InterestAndFeeIncomeLoansAndLeases"]) {
  await new Promise((r) => setTimeout(r, 150));
  sec++;
  const res = await realFetch(`https://data.sec.gov/api/xbrl/companyconcept/CIK${REG.AFRM?.cik}/us-gaap/${concept}.json`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) { console.log(`   ${concept}: not tagged (${res.status})`); continue; }
  const doc = await res.json();
  const fy = Object.values(doc.units ?? {}).flat().filter((f) => f.fp === "FY" && f.form === "10-K" && f.start && (Date.parse(f.end) - Date.parse(f.start)) / 864e5 > 350);
  const latest = new Map();
  for (const f of fy) if (!latest.has(f.end) || f.filed > latest.get(f.end).filed) latest.set(f.end, f);
  console.log(`   ${concept}: ${[...latest.values()].sort((a, b) => (a.end < b.end ? 1 : -1)).slice(0, 3).map((f) => `${f.end} ${(f.val / 1e9).toFixed(2)}B`).join(" · ") || "no fiscal years"}`);
}

// ── E ──
const manifest = await redis.get(MANIFEST_KEY);
const eod = await redis.hgetall(`${TIINGO_PREFIX}eod-last:v1`);
const dollarVol = (sym) => { let r = eod?.[sym.replace(/\./g, "-")]; if (typeof r === "string") { try { r = JSON.parse(r); } catch { r = null; } } return r && r.c > 0 && r.v > 0 ? r.c * r.v : 0; };
const ranked = Object.entries(manifest?.symbols ?? {}).filter(([, e]) => e.cik).map(([s, e]) => ({ s, e, dv: dollarVol(s) })).filter((x) => x.dv > 0).sort((a, b) => b.dv - a.dv).slice(0, 300);
const noSet = ranked.filter((x) => !sets.has(x.s) && !sets.has(x.s.replace(/\./g, "-")));
console.log(`\nE. TOP 300 MANIFEST SYMBOLS BY LATEST DOLLAR VOLUME WITH NO FACT SET: ${noSet.length}`);
console.log(`   ${noSet.map((x) => `${x.s}(${x.e.contentHash === null ? "unpopulated" : "hash set"}${x.e.needsReverify ? ",reverify" : ""})`).join(" ")}`);
console.log(`   POOL: ${ranked.find((x) => x.s === "POOL") ? "in the top 300" : "not in the top 300"} · fact set ${sets.has("POOL") ? "present" : "ABSENT"} · manifest ${manifest?.symbols?.POOL ? JSON.stringify({ cik: manifest.symbols.POOL.cik, contentHash: manifest.symbols.POOL.contentHash ? "set" : null }) : "no entry"}`);

console.log(`\nStore commands: ${JSON.stringify(counts)} · SEC requests: ${sec}`);
