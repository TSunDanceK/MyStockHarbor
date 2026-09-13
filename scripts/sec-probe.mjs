// SEC: the CIK map, a filings sample, and the sicDescription comparison.
//
// WHY A RUNNER. sec.gov/files/company_tickers.json 403s without a declared
// User-Agent — a missing header, not a block. The runner sends one. data.sec.gov
// answers either way but the fair-access policy asks for identification, so both
// requests carry it and both stay inside 10 req/sec.
//
// THREE OUTPUTS, one per dispatch (see scripts/lib/relay-capture.mjs):
//   symbols=cik-map   the universe's ticker -> CIK map, ready to commit
//   symbols=filings   one symbol's recent filings, trimmed, for the fixture
//   symbols=sic       the sicDescription vs lib/sectors.ts comparison
//
// The comparison is the one that must exist BEFORE sicDescription is wired into
// anything: the spec says compare against the existing taxonomy before trusting
// either, and industry-from-fundamentalsCache already works.
import fs from "node:fs";
import path from "node:path";
import { emitPayload, requestedPayload } from "./lib/relay-capture.mjs";

const DUMP_DIR = process.argv[2] || "";
const UA =
  process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (contact@mystockharbor.com)";
const HEADERS = { "user-agent": UA, accept: "application/json" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- universe
let universe = [];
if (DUMP_DIR) {
  const p = path.join(DUMP_DIR, "universe.json");
  if (fs.existsSync(p)) {
    universe = [...new Set((JSON.parse(fs.readFileSync(p, "utf8"))?.pickersSymbolsKey ?? [])
      .map((s) => String(s).toUpperCase()))].sort();
  }
}
console.log(`[sec] universe symbols: ${universe.length}`);
console.log(`[sec] user-agent: ${JSON.stringify(UA)}`);

// ------------------------------------------------- ticker -> CIK, from SEC
const tickersRes = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: HEADERS });
console.log(`[sec] company_tickers.json: HTTP ${tickersRes.status} (${tickersRes.headers.get("content-length") ?? "?"} bytes)`);
if (!tickersRes.ok) {
  console.error("FATAL: company_tickers.json did not return 200 — nothing below is meaningful.");
  process.exit(1);
}
const rawMap = await tickersRes.json();
const rows = Object.values(rawMap);
console.log(`[sec] entries: ${rows.length}`);

const bySymbol = new Map();
for (const row of rows) {
  const ticker = String(row?.ticker ?? "").toUpperCase();
  const cik = Number(row?.cik_str);
  if (ticker && Number.isFinite(cik) && !bySymbol.has(ticker)) {
    bySymbol.set(ticker, { cik, title: String(row?.title ?? "") });
  }
}

const hits = universe.filter((s) => bySymbol.has(s));
const misses = universe.filter((s) => !bySymbol.has(s));
console.log(`[sec] universe symbols with a CIK: ${hits.length}/${universe.length}`);
if (misses.length) console.log(`[sec] no CIK for: ${misses.slice(0, 25).join(", ")}${misses.length > 25 ? ` …+${misses.length - 25}` : ""}`);

// THE TRIMMED MAP. Padded to the 10-digit form data.sec.gov wants, so the
// adapter never has to remember to pad.
const trimmed = {};
for (const symbol of hits) trimmed[symbol] = String(bySymbol.get(symbol).cik).padStart(10, "0");
console.log(`[sec] trimmed map: ${Object.keys(trimmed).length} entries, ` +
  `${Buffer.byteLength(JSON.stringify(trimmed), "utf8")} bytes ` +
  `(full ${rows.length} entries would be ~${Math.round(Buffer.byteLength(JSON.stringify(rawMap), "utf8") / 1024)} KB)`);

emitPayload("cik-map", JSON.stringify(trimmed, null, 0));

// ------------------------------------------------------------ filings sample
const SAMPLE_SYMBOL = "MU";
if (requestedPayload() === "filings" || !requestedPayload()) {
  const cik = trimmed[SAMPLE_SYMBOL] ?? "0000723125";
  const res = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: HEADERS });
  console.log(`[sec] submissions ${SAMPLE_SYMBOL} (CIK ${cik}): HTTP ${res.status}`);
  if (res.ok) {
    const body = await res.json();
    const recent = body?.filings?.recent ?? {};
    const n = (recent.form ?? []).length;
    console.log(`[sec] ${SAMPLE_SYMBOL}: ${n} recent filings · sicDescription=${JSON.stringify(body?.sicDescription ?? null)} · tickers=${JSON.stringify(body?.tickers ?? [])}`);
    // TRIMMED TO WHAT THE ADAPTER READS. The full document is megabytes and
    // most of it is addresses and former names.
    const slice = {
      cik: body?.cik, name: body?.name, tickers: body?.tickers, exchanges: body?.exchanges,
      sicDescription: body?.sicDescription,
      filings: { recent: Object.fromEntries(
        ["accessionNumber", "filingDate", "reportDate", "form", "items", "primaryDocument", "primaryDocDescription"]
          .map((k) => [k, (recent[k] ?? []).slice(0, 25)])
      ) },
    };
    emitPayload("filings", JSON.stringify(slice, null, 0));
  }
}

// -------------------------------------------- sicDescription vs lib/sectors.ts
if (requestedPayload() === "sic" || !requestedPayload()) {
  // Parsed from the shipping file so the comparison cannot drift from the taxonomy.
  const sectorsSrc = fs.readFileSync("lib/sectors.ts", "utf8");
  const defs = [];
  for (const m of sectorsSrc.matchAll(/slug:\s*"([^"]+)"[\s\S]*?fmpLabel:\s*"([^"]+)"[\s\S]*?aliases:\s*\[([^\]]*)\]/g)) {
    defs.push({
      slug: m[1],
      label: m[2].toLowerCase(),
      aliases: [...m[3].matchAll(/"([^"]+)"/g)].map((a) => a[1].toLowerCase()),
    });
  }
  console.log(`[sic] sector definitions parsed from lib/sectors.ts: ${defs.length}`);

  const SAMPLE = universe.filter((s) => trimmed[s]).slice(0, 60);
  console.log(`[sic] sampling ${SAMPLE.length} symbols at <=10 req/sec`);

  const results = [];
  for (const symbol of SAMPLE) {
    try {
      const res = await fetch(`https://data.sec.gov/submissions/CIK${trimmed[symbol]}.json`, { headers: HEADERS });
      if (res.ok) {
        const body = await res.json();
        results.push([symbol, String(body?.sicDescription ?? "").trim()]);
      } else {
        results.push([symbol, `HTTP ${res.status}`]);
      }
    } catch (err) {
      results.push([symbol, `ERR ${err.message}`]);
    }
    await sleep(150); // ~6.7 req/sec, inside the 10/sec policy
  }

  // EXACT means the SIC text equals a sector label or a known alias. A mapping
  // table would be needed for anything that is recognisably one of the eleven
  // but not spelled like it. FAIL is everything else.
  let exact = 0, mappable = 0, failed = 0;
  const lines = [];
  const MAPPABLE_HINTS = [
    [/pharmaceutic|biological|medical|surgical|health|diagnostic/, "healthcare"],
    [/semiconductor|computer|software|electronic|data processing|prepackaged/, "technology"],
    [/bank|credit|insurance|securit|investment|finance/, "financial-services"],
    [/retail|apparel|restaurant|hotel|motor vehicle|household|leisure/, "consumer-cyclical"],
    [/food|beverage|tobacco|grocer|soap|cosmetic/, "consumer-defensive"],
    [/petroleum|oil|gas|coal|drilling|energy/, "energy"],
    [/machinery|aircraft|aerospace|construction|industrial|transport|freight|engineering|defense/, "industrials"],
    [/chemical|steel|metal|mining|paper|lumber|cement|gold/, "basic-materials"],
    [/electric services|utilit|water supply|natural gas distribution/, "utilities"],
    [/real estate|reit/, "real-estate"],
    [/telephone|communication|broadcast|cable|publishing|motion picture|advertis/, "communication-services"],
  ];

  for (const [symbol, sic] of results) {
    const lower = sic.toLowerCase();
    const direct = defs.find((d) => d.label === lower || d.aliases.includes(lower));
    if (direct) { exact += 1; lines.push(`EXACT    ${symbol.padEnd(6)} ${sic} -> ${direct.slug}`); continue; }
    const hint = MAPPABLE_HINTS.find(([re]) => re.test(lower));
    if (hint) { mappable += 1; lines.push(`MAPPABLE ${symbol.padEnd(6)} ${sic} -> ${hint[1]}`); continue; }
    failed += 1;
    lines.push(`FAIL     ${symbol.padEnd(6)} ${JSON.stringify(sic)}`);
  }

  const total = results.length || 1;
  const pct = (n) => `${n} (${((n / total) * 100).toFixed(0)}%)`;
  console.log(`\n[sic] RESULT over ${total} symbols:`);
  console.log(`[sic]   EXACT match to a sector label or alias : ${pct(exact)}`);
  console.log(`[sic]   MAPPABLE via a mapping table          : ${pct(mappable)}`);
  console.log(`[sic]   FAILED to map                          : ${pct(failed)}`);
  emitPayload("sic", lines.join("\n"));
}

console.log("\n[sec-probe] done");
