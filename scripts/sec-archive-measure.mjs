// MEASURE A FULL SEC ARCHIVE (#552 COWORK #65). Read-only; public SEC data;
// no credential; no Redis; nothing stored. For each registrant CIK (shard K of
// N): the raw companyfacts and submissions bytes, a normalised NDJSON of EVERY
// fact (all taxonomies, concepts, units, periods, with accn/form/fy/fp/filed/
// frame) and its gzip/brotli sizes, with and without de-duplication across
// re-filings, and how many facts/concepts the SEC_FIELDS chains use. Per shard:
// us-gaap concept filer counts (>=5), for the unused-concepts ranking.
//   SHARD=1 SHARDS=8 node scripts/sec-archive-measure.mjs   (relay: sec-archive-measure-1..8)
import fs from "node:fs";
import zlib from "node:zlib";

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; archive measure)";
const K = Number(process.env.SHARD || 1), N = Number(process.env.SHARDS || 1);
const BUDGET_MS = Number(process.env.BUDGET_MS || 26 * 60 * 1000), started = Date.now();
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
let ciks = [...new Set(Object.values(REG).map((r) => String(r.cik).padStart(10, "0")))].sort();
const only = (process.env.SYMBOLS || "").split(/[,\s]+/).filter(Boolean);
ciks = only.length ? only.map((s) => String(REG[s]?.cik ?? "").padStart(10, "0")) : ciks.filter((_, i) => i % N === K - 1);
// The concepts the field chains name: every quoted CamelCase token in secFields.ts (an upper bound on "used").
const USED = new Set([...fs.readFileSync("lib/server/secFields.ts", "utf8").matchAll(/"([A-Z][A-Za-z0-9]{3,})"/g)].map((m) => m[1]));
let lastAt = 0;
async function get(url) {
  const wait = Math.max(0, lastAt + 125 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(String(res.status));
  return Buffer.from(await res.arrayBuffer());
}
const gz = (b) => zlib.gzipSync(b, { level: 9 }).length;
const br = (b) => zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }).length;
const conceptFilers = new Map();
const T = { filers: 0, err: 0, missing: 0 };
console.log("F cik raw rawGz ndAll ndAllGz ndAllBr ndDedup ndDedupGz ndDedupBr facts factsDedup factsUsed concepts conceptsUsed usgaapConcepts sub subGz subPages subPagesBytes");
for (const cik of ciks) {
  if (Date.now() - started > BUDGET_MS) break;
  try {
    let raw;
    try { raw = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`); }
    catch (e) { if (String(e.message) === "404") { T.missing++; console.log(`MISSING ${cik}`); continue; } throw e; }
    const j = JSON.parse(raw.toString("utf8"));
    const lines = [], seen = new Map();
    let facts = 0, used = 0, concepts = 0, conceptsUsed = 0, usg = 0;
    for (const [tax, cs] of Object.entries(j.facts ?? {})) {
      for (const [concept, def] of Object.entries(cs)) {
        concepts++;
        const isUsed = USED.has(concept);
        if (isUsed) conceptsUsed++;
        if (tax === "us-gaap") { usg++; conceptFilers.set(concept, (conceptFilers.get(concept) ?? 0) + 1); }
        for (const [unit, rows] of Object.entries(def.units ?? {})) {
          for (const f of rows) {
            facts++; if (isUsed) used++;
            const row = [tax, concept, unit, f.start ?? null, f.end, f.val, f.accn, f.fy ?? null, f.fp ?? null, f.form, f.filed, f.frame ?? null];
            lines.push(JSON.stringify(row));
            // One row per (fact identity), keeping the latest-filed.
            const key = `${tax}|${concept}|${unit}|${f.start ?? ""}|${f.end}`;
            const prev = seen.get(key);
            if (!prev || f.filed > prev[10]) seen.set(key, row);
          }
        }
      }
    }
    const ndAll = Buffer.from(lines.join("\n"));
    const ndDedup = Buffer.from([...seen.values()].map((r) => JSON.stringify(r)).join("\n"));
    const sub = await get(`https://data.sec.gov/submissions/CIK${cik}.json`);
    const sj = JSON.parse(sub.toString("utf8"));
    let pagesBytes = 0;
    for (const p of sj.filings?.files ?? []) pagesBytes += (await get(`https://data.sec.gov/submissions/${p.name}`)).length;
    T.filers++;
    console.log(`F ${cik} ${raw.length} ${gz(raw)} ${ndAll.length} ${gz(ndAll)} ${br(ndAll)} ${ndDedup.length} ${gz(ndDedup)} ${br(ndDedup)} ${facts} ${seen.size} ${used} ${concepts} ${conceptsUsed} ${usg} ${sub.length} ${gz(sub)} ${(sj.filings?.files ?? []).length} ${pagesBytes}`);
  } catch (e) { T.err++; console.log(`ERROR ${cik} ${String(e?.message ?? e).slice(0, 60)}`); }
}
for (const [c, n] of [...conceptFilers].filter(([, n]) => n >= 5).sort((a, b) => b[1] - a[1])) console.log(`C ${c} ${n} ${USED.has(c) ? 1 : 0}`);
console.log(`\nshard ${K}/${N} of ${ciks.length} ciks ${JSON.stringify(T)} | ${Math.round((Date.now() - started) / 1000)}s`);
