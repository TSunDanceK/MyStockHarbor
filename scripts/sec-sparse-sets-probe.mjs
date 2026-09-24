// WHY XOM HAS NO P/E: stored quarters with no fiscal labels and no years
// (#552 COWORK #28). Reads only.
//
//   1. CENSUS over the price-pool universe's stored fact sets: which share
//      XOM's shape — no fiscal years, quarters without a fiscal label, or
//      fewer than four quarters — split by annual form, so annual-only 20-F /
//      40-F filers (expected to lack quarters) are not mistaken for the bug.
//   2. DIAGNOSIS for XOM and the largest few 10-K filers of that shape:
//      companyfacts fetched on the runner, the SHIPPED extractor run on it,
//      and the raw rows behind the income fields (which tag, which form, which
//      duration) so the gap is named from evidence, not guessed.
//
// SEC values only. Nothing is written.
//   relay task: write-sec-sparse-sets  (credentialled for the Redis read)
//   Redis cost: 1 HKEYS + 1 MGET per 25 symbols ≈ 35 commands, once.
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const { extractCompanyFacts } = await import("../lib/server/secExtract.ts");
const { secFieldsHash, SEC_FIELDS } = await import("../lib/server/secFields.ts");
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; sparse-set diagnosis)";
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows ?? {};
const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const HASH = secFieldsHash();
let commands = 0;

commands++;
const universe = (await redis.hkeys("msh:price-pool:v1")).map(String).sort();
const flagged = [];
let read = 0;
for (let i = 0; i < universe.length; i += 25) {
  const chunk = universe.slice(i, i + 25);
  commands++;
  const vals = await redis.mget(...chunk.map((s) => `${FACTS}:${s}`));
  chunk.forEach((s, j) => {
    const set = vals[j];
    if (!set || typeof set !== "object" || !Array.isArray(set.quarters) || set.h !== HASH) return;
    read++;
    const unlabelled = set.quarters.filter((q) => !q.fp || q.fy == null).length;
    const noYears = set.years.length === 0;
    const few = set.quarters.length < 4;
    if (unlabelled || noYears || few) {
      flagged.push({
        s, form: REG[s]?.annualForm ?? null, q: set.quarters.length, y: set.years.length, unlabelled,
        newest: set.quarters[0]?.e ?? null, cover: set.cover?.val ?? null,
        notes: (set.notes ?? []).slice(0, 2).map((n) => String(n).slice(0, 110)),
      });
    }
  });
}
const annualForm = (f) => /^(20-F|40-F)/.test(f ?? "");
const domestic = flagged.filter((r) => !annualForm(r.form));
console.log(`universe ${universe.length}; fact sets read ${read}; sets with no years / unlabelled quarters / <4 quarters: ${flagged.length}`);
console.log(`  of which 20-F/40-F (annual-only is expected): ${flagged.length - domestic.length}; 10-K or unknown form: ${domestic.length}`);
console.log(`\n10-K / unknown-form sets of that shape (symbol | form | quarters | years | unlabelled quarters | newest quarter | first notes):`);
for (const r of domestic.sort((a, b) => (b.cover ?? 0) - (a.cover ?? 0))) {
  console.log(`  ${r.s} | ${r.form ?? "?"} | q${r.q} | y${r.y} | unlabelled ${r.unlabelled} | ${r.newest ?? "—"} | ${r.notes.join(" ¦ ") || "—"}`);
}

// ── 2. diagnosis on the runner ─────────────────────────────────────────────
const tickers = JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8"));
const cikOf = new Map(tickers.data.map(([cik, , t]) => [String(t).toUpperCase(), String(cik).padStart(10, "0")]));
const targets = ["XOM", ...domestic.map((r) => r.s).filter((s) => s !== "XOM")].slice(0, 6);
const DAY = 86400000;
const INCOME_TAGS = new Set(SEC_FIELDS.filter((f) => ["revenue", "netIncome", "epsDiluted", "operatingIncome"].includes(f.key)).flatMap((f) => f.chain));
for (const s of targets) {
  const cik = cikOf.get(s);
  console.log(`\n===== ${s} (CIK ${cik ?? "?"})`);
  if (!cik) continue;
  const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  if (!res.ok) { console.log(`  HTTP ${res.status}`); continue; }
  const facts = await res.json();
  const ns = Object.keys(facts.facts ?? {});
  console.log(`  namespaces: ${ns.map((n) => `${n}(${Object.keys(facts.facts[n]).length})`).join(" ")}`);
  for (const n of ns) {
    for (const [tag, body] of Object.entries(facts.facts[n])) {
      if (!INCOME_TAGS.has(tag)) continue;
      for (const [unit, rows] of Object.entries(body.units ?? {})) {
        const dur = rows.filter((r) => r.start && r.end);
        const q = dur.filter((r) => { const d = (Date.parse(r.end) - Date.parse(r.start)) / DAY; return d >= 80 && d <= 100; });
        const y = dur.filter((r) => { const d = (Date.parse(r.end) - Date.parse(r.start)) / DAY; return d >= 330 && d <= 400; });
        const forms = [...new Set(rows.map((r) => r.form))].join(",");
        const newestY = y.map((r) => `${r.end}/${r.form}/fp=${r.fp}`).sort().at(-1) ?? "—";
        const newestQ = q.map((r) => `${r.end}/${r.form}`).sort().at(-1) ?? "—";
        console.log(`  ${n}:${tag} [${unit}] rows ${rows.length} (quarter-length ${q.length}, year-length ${y.length}); forms ${forms}; newest year ${newestY}; newest quarter ${newestQ}`);
      }
    }
  }
  try {
    const x = extractCompanyFacts(s, facts);
    console.log(`  shipped extractor: quarters ${x.quarters.length} (unlabelled ${x.quarters.filter((p) => !p.fp).length}), years ${x.years.length}, newest quarter ${x.quarters[0]?.end ?? "—"} ${x.quarters[0]?.fp ?? ""}`);
    for (const note of (x.notes ?? []).slice(0, 6)) console.log(`    note: ${String(note).slice(0, 160)}`);
  } catch (err) {
    console.log(`  shipped extractor threw: ${String(err?.message ?? err).slice(0, 200)}`);
  }
  await new Promise((r) => setTimeout(r, 200));
}
console.log(`\nRedis commands used by this read: ${commands}`);
