// THE STALE-RATIO CLASS (#552 COWORK #64, after MFG). For every ADS row in
// data/sec/ads-ratios.json: the issuer's own dei share-count series from
// companyfacts, and any step between consecutive filed counts of ×1.8 or more
// (a split) or ÷1.8 or more (a consolidation) since 2018. A row whose cited
// ratio sentence may predate such a step is where a stale ratio hides. SEC
// values only; read-only; no credential; no Redis. ≤8 req/s.
//   node scripts/ads-stale-ratio-probe.mjs   (relay: ads-stale-ratio)
import fs from "node:fs";

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; ads stale-ratio probe)";
const MAP = JSON.parse(fs.readFileSync("data/sec/ads-ratios.json", "utf8")).entries;
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const only = (process.env.SYMBOLS || "").split(/[,\s]+/).filter(Boolean);
const rows = Object.entries(MAP).filter(([s, e]) => e.kind === "ads" && (!only.length || only.includes(s)));
let lastAt = 0;
async function get(url) {
  const wait = Math.max(0, lastAt + 130 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}
const flagged = [], tally = { rows: rows.length, stepped: 0, noSeries: 0, error: 0 };
for (const [s, e] of rows) {
  const cik = REG[s]?.cik;
  if (!cik) { tally.error++; console.log(`${s}: no CIK`); continue; }
  try {
    const f = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`);
    const units = f.facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares ?? [];
    // One value per as-of date (the latest filed), 2018 on, in date order.
    const by = new Map();
    for (const u of units) if (u.end >= "2018-01-01" && u.val > 0 && (!by.has(u.end) || u.filed > by.get(u.end).filed)) by.set(u.end, u);
    const ser = [...by.values()].sort((a, b) => a.end.localeCompare(b.end));
    if (ser.length < 2) { tally.noSeries++; continue; }
    const steps = [];
    for (let i = 1; i < ser.length; i++) {
      const r = ser[i].val / ser[i - 1].val;
      if (r >= 1.8 || r <= 1 / 1.8) steps.push(`${ser[i - 1].end}→${ser[i].end} ×${r >= 1 ? r.toFixed(2) : `1/${(1 / r).toFixed(2)}`}`);
    }
    if (steps.length) {
      tally.stepped++;
      flagged.push(`${s.padEnd(6)} ratio ${e.ordinaryPerAds} (${e.form} ${e.filed}) | steps: ${steps.join("; ")}${e.withheld ? " | WITHHELD" : ""}`);
    }
  } catch (err) { tally.error++; console.log(`${s}: ERROR ${String(err?.message ?? err).slice(0, 60)}`); }
}
for (const l of flagged) console.log(`STEP ${l}`);
console.log(`\n${JSON.stringify(tally)}`);
