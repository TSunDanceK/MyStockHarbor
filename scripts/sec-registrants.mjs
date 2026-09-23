// REGISTRANT FACTS FOR EVERY PROFILED SYMBOL → data/sec/registrants.json
//
// ── WHAT THIS IS FOR ─────────────────────────────────────────────────────
// PR 2 of BRIEF-stock-page-profile-off-fmp-2026-09-22 (§2.3). The /stock page's
// "About" block read Country from FMP's profile, and the Pickers taxonomy needs
// a leg after the static snapshot for symbols it does not cover (§2.4). SEC's
// submissions endpoint carries both as FACTS the registrant filed: SIC code,
// business address, state of incorporation, fiscal year end, entity type.
//
// NO DESCRIPTION, NO PROSE. Only coded or short structured fields are stored —
// the same rule static-profile.json follows, for the same reason.
//
// ── WHY IT PRINTS ITS OWN OUTPUT INTO THE LOG ────────────────────────────
// The agent sandbox cannot reach the blob host Actions artifacts download
// from, and the committed company-tickers.json once arrived via a browser save
// with a stray byte at its head. So after writing the file, this prints it
// gzipped and base64'd in numbered chunks between two markers, with a SHA-256
// of the JSON. The session reassembles it from the job log and REFUSES a
// mismatched hash. The file is also written to data/sec/ for the artifact.
//
// ── SCOPE ────────────────────────────────────────────────────────────────
// data/static-profile.json rows ∪ data/cik-map.json. CIKs from the CIK map,
// then the committed ticker file (spellings BRK.B → BRK-B tried). One request
// per symbol at ≤8/s, under SEC's 10/s fair-access limit.
//
//   node scripts/sec-registrants.mjs            (relay task: sec-registrants)
import fs from "node:fs";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";
import { symbolSpellings } from "../lib/symbolSpellings.mjs";

const UA = process.env.SEC_USER_AGENT ||
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; registrant facts)";
const OUT = "data/sec/registrants.json";

const tickerSrc = readCodeOnly("lib/server/secTickerMap.ts");
const tick = await lift([
  grabFunction(tickerSrc, "padCik"),
  grabFunction(tickerSrc, "parseTickerFile"),
  "export { parseTickerFile, padCik };",
].join("\n"));
const { map: tickerMap } = tick.parseTickerFile(fs.readFileSync("data/sec/company-tickers.json", "utf8"));
const cikMap = JSON.parse(fs.readFileSync("data/cik-map.json", "utf8"));
const snapshot = JSON.parse(fs.readFileSync("data/static-profile.json", "utf8"));

const symbols = [...new Set([...Object.keys(snapshot.rows ?? {}), ...Object.keys(cikMap)])].sort();
const cikFor = (s) => {
  for (const v of symbolSpellings(s)) {
    if (cikMap[v]) return tick.padCik(cikMap[v]);
    const t = tickerMap.get(v);
    if (t?.cik) return t.cik;
  }
  return null;
};

let lastAt = 0;
async function getJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = Math.max(0, lastAt + 125 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
      if (res.status === 404) return { status: 404 };
      if (res.ok) return { status: 200, json: await res.json() };
      if (res.status !== 429 && res.status < 500) return { status: res.status };
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  return { status: "failed" };
}

const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const ANNUAL = new Set(["10-K", "10-K405", "10-KT", "20-F", "40-F"]);

const rows = {};
const misses = { noCik: [], http: [] };
const cikCache = new Map();
let i = 0;
for (const symbol of symbols) {
  i++;
  const cik = cikFor(symbol);
  if (!cik) { misses.noCik.push(symbol); continue; }
  let got = cikCache.get(cik);
  if (!got) {
    got = await getJson(`https://data.sec.gov/submissions/CIK${cik}.json`);
    cikCache.set(cik, got);
  }
  if (got.status !== 200) { misses.http.push(`${symbol}:${got.status}`); continue; }
  const j = got.json;
  const forms = j.filings?.recent?.form ?? [];
  const annualForm = forms.find((f) => ANNUAL.has(f)) ?? null;
  rows[symbol] = {
    cik,
    sic: str(j.sic),
    sicDescription: str(j.sicDescription),
    stateOrCountry: str(j.addresses?.business?.stateOrCountry),
    stateOfIncorporation: str(j.stateOfIncorporation),
    website: str(j.website),
    fiscalYearEnd: str(j.fiscalYearEnd),
    entityType: str(j.entityType),
    annualForm,
  };
  if (i % 250 === 0) console.log(`  ... ${i} of ${symbols.length}`);
}

const asOf = new Date().toISOString().slice(0, 10);
const file = {
  _comment:
    "Registrant facts from SEC submissions (data.sec.gov/submissions/CIK##########.json), " +
    "one row per profiled symbol. Coded/structured fields only — no description, no prose. " +
    "Regenerate with relay task sec-registrants. A symbol missing here logs a line at lookup; " +
    "that line is the regeneration trigger, as for static-profile.json.",
  asOf,
  source: "data.sec.gov submissions",
  fields: ["cik", "sic", "sicDescription", "stateOrCountry", "stateOfIncorporation", "website", "fiscalYearEnd", "entityType", "annualForm"],
  rows,
};
const json = JSON.stringify(file, null, 1) + "\n";
fs.writeFileSync(OUT, json);

// ── COVERAGE, PER FIELD ─────────────────────────────────────────────────
const n = Object.keys(rows).length;
console.log(`\nsymbols in scope: ${symbols.length}  ·  rows written: ${n}  ·  no CIK: ${misses.noCik.length}  ·  fetch failed: ${misses.http.length}`);
if (misses.noCik.length) console.log(`  no CIK (first 30): ${misses.noCik.slice(0, 30).join(", ")}`);
if (misses.http.length) console.log(`  fetch failed (first 30): ${misses.http.slice(0, 30).join(", ")}`);
console.log(`\nCOVERAGE (of ${n} rows)`);
for (const f of file.fields) {
  const have = Object.values(rows).filter((r) => r[f] !== null).length;
  console.log(`  ${f.padEnd(22)} ${String(have).padStart(5)}  ${(100 * have / Math.max(n, 1)).toFixed(1)}%`);
}
const hist = (key) => {
  const m = new Map();
  for (const r of Object.values(rows)) m.set(r[key] ?? "(none)", (m.get(r[key] ?? "(none)") ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};
console.log(`\nannualForm: ${hist("annualForm").map(([k, v]) => `${k}=${v}`).join("  ")}`);
console.log(`entityType: ${hist("entityType").map(([k, v]) => `${k}=${v}`).join("  ")}`);
console.log(`stateOrCountry (top 40): ${hist("stateOrCountry").slice(0, 40).map(([k, v]) => `${k}=${v}`).join("  ")}`);
console.log(`\nSIC CODES FOUND: ${hist("sic").length}`);
for (const [sic, count] of hist("sic")) {
  const desc = Object.values(rows).find((r) => r.sic === sic)?.sicDescription ?? "";
  console.log(`  ${String(sic).padEnd(6)} ${String(count).padStart(4)}  ${desc}`);
}

// ── THE FILE ITSELF, FOR THE SESSION TO REASSEMBLE ──────────────────────
const sha = crypto.createHash("sha256").update(json).digest("hex");
const b64 = zlib.gzipSync(Buffer.from(json), { level: 9 }).toString("base64");
const CHUNK = 3000;
const parts = Math.ceil(b64.length / CHUNK);
console.log(`\n===REGISTRANTS-BEGIN sha256=${sha} bytes=${json.length} parts=${parts}===`);
for (let p = 0; p < parts; p++) console.log(`R${String(p).padStart(4, "0")} ${b64.slice(p * CHUNK, (p + 1) * CHUNK)}`);
console.log(`===REGISTRANTS-END===`);
