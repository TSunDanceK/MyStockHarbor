// THE DERIVED-Q4 RULE, CENSUSED ON REAL FILINGS (#552 COWORK #196/#200 item 2). READ-ONLY.
// 1. The store (SCAN + MGET): every DIFFERENCED revenue Q4 under 40% of the
//    same fiscal year's other three quarters, or negative — the only Q4s the
//    rule can withhold. Their filers are the candidates.
// 2. Each candidate's companyfacts (one SEC request each, ≤ 4/s, capped),
//    through THIS BRANCH's extractor: which Q4s it withholds and which it
//    keeps, with the second total it saw.
// No store writes, no other host.
import fs from "node:fs";
import { register } from "node:module";
import { Redis } from "@upstash/redis";

register("./lib/ts-resolve-app.mjs", import.meta.url);
const READS = new Set(["scan", "mget"]);
const counts = {};
let secCalls = 0;
const SEC_CAP = 80;
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
  } else if (/^https:\/\/data\.sec\.gov\/api\/xbrl\/companyfacts\/CIK\d{10}\.json$/.test(url)) {
    if (++secCalls > SEC_CAP) throw new Error("read guard: SEC request cap");
  } else if (!url.startsWith("data:")) throw new Error("read guard: host refused");
  return realFetch(input, init);
};

const { SEC_FIELD_INDEX } = await import("../lib/server/secFields.ts");
const { extractForSymbol } = await import("../lib/server/secExtractFor.ts");
const { DERIVED_Q4_FLOOR } = await import("../lib/server/secExtract.ts");

const keyOf = (file, name) => (fs.readFileSync(file, "utf8").match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
if (!FACTS) { console.error("FATAL: the facts prefix moved"); process.exit(2); }
const CUT = new Set(JSON.parse(fs.readFileSync("data/due-strip.json", "utf8")).symbols);
const cikMap = JSON.parse(fs.readFileSync("data/cik-map.json", "utf8"));
const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; read-only census)";
const REV = SEC_FIELD_INDEX.revenue;
const M = (v) => (typeof v === "number" ? `${(v / 1e6).toFixed(0)}M` : "—");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 1. the store ────────────────────────────────────────────────────────────
const redis = Redis.fromEnv();
const keys = [];
let cursor = "0";
do { const [next, batch] = await redis.scan(cursor, { match: `${FACTS}:*`, count: 1000 }); cursor = String(next); keys.push(...batch); } while (cursor !== "0");
const flagged = new Map(); // sym -> [{fy, end, v, mean}]
let sets = 0, q4s = 0;
for (let i = 0; i < keys.length; i += 20) {
  const chunk = keys.slice(i, i + 20);
  const raw = await redis.mget(...chunk);
  chunk.forEach((k, j) => {
    const set = raw[j];
    if (!set?.quarters?.length) return;
    sets++;
    const sym = k.slice(FACTS.length + 1);
    const byFy = new Map();
    for (const p of set.quarters) { if (p.fy == null || !p.fp) continue; const m = byFy.get(p.fy) ?? {}; m[p.fp] = p; byFy.set(p.fy, m); }
    for (const [fy, m] of byFy) {
      const q4 = m.Q4; if (!q4 || !m.Q1 || !m.Q2 || !m.Q3) continue;
      if ((q4.d ?? "")[REV] !== "D") continue;
      const v = q4.v?.[REV], o = [m.Q1, m.Q2, m.Q3].map((p) => p.v?.[REV]);
      if (typeof v !== "number" || o.some((x) => typeof x !== "number")) continue;
      q4s++;
      const mean = (o[0] + o[1] + o[2]) / 3;
      if (v < 0 || (mean > 0 && v < DERIVED_Q4_FLOOR * mean)) {
        const list = flagged.get(sym) ?? [];
        list.push({ fy, end: q4.e, v, mean });
        flagged.set(sym, list);
      }
    }
  });
}
console.log(`1. store: ${sets} sets with quarters · ${q4s} differenced revenue Q4s with three sibling quarters · ` +
  `${[...flagged.values()].flat().length} under ${DERIVED_Q4_FLOOR * 100}% or negative, in ${flagged.size} filers`);

// ── 2. each candidate through this branch's extractor ──────────────────────
const withheld = [], kept = [], failed = [];
for (const sym of [...flagged.keys()].sort()) {
  const cik = cikMap[sym] ? String(cikMap[sym]).padStart(10, "0") : null;
  if (!cik) { failed.push(`${sym}: no CIK`); continue; }
  await sleep(260); // ≤ 4 requests a second
  let json = null, status = 0;
  try {
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
    status = res.status;
    json = res.ok ? await res.json() : null;
  } catch (e) { failed.push(`${sym}: ${String(e?.message ?? e).slice(0, 80)}`); continue; }
  if (!json) { failed.push(`${sym}: HTTP ${status}`); continue; }
  const r = extractForSymbol(sym, json);
  const tag = `${sym}${CUT.has(sym) ? "*" : ""}`;
  const fresh = new Map(r.quarters.map((p) => [p.end, p.values?.[REV] ?? null]));
  // Every Q4 the extractor withholds for this filer, including any not flagged in the store.
  for (const p of r.quarters) {
    const c = p.values?.[REV];
    if (c?.derived !== "withheld") continue;
    const why = r.notes.find((n) => n.startsWith(`revenue ${p.end}: derived Q4`)) ?? "";
    withheld.push(`${tag} FY${p.fy} ${p.fp} (${p.end}): ${why.replace(/^revenue [\d-]+: /, "")}`);
  }
  for (const f of flagged.get(sym)) {
    const c = fresh.get(f.end);
    if (c?.derived === "withheld") continue;
    kept.push(`${tag} FY${f.fy} Q4: stored ${M(f.v)} vs ${M(f.mean)} mean (${((f.v / f.mean) * 100).toFixed(0)}%) -> now ${c ? `${M(c.val)} ${c.derived} [${c.tag}]` : "no cell"}`);
  }
}
console.log(`\n2. this branch's extractor on ${flagged.size} candidates (${secCalls} SEC requests)`);
console.log(`\nWITHHELD (${withheld.length} periods in ${new Set(withheld.map((x) => x.split(" ")[0])).size} filers):`);
withheld.forEach((x) => console.log("  " + x));
console.log(`\nKEPT (${kept.length} stored periods: no second total, or the total also collapses, or the fresh read differs):`);
kept.forEach((x) => console.log("  " + x));
if (failed.length) { console.log(`\nNOT READ (${failed.length}):`); failed.forEach((x) => console.log("  " + x)); }
console.log(`\nStore commands: ${JSON.stringify(counts)} · SEC requests: ${secCalls}`);
