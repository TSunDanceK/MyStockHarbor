// Fetch SEC's ticker->CIK file and commit it as data/sec/company-tickers.json.
//
// WHY THIS IS A SCRIPT AND NOT A RUNTIME FETCH. lib/server/secTickerMap.ts
// records the reasons: a committed file removes a network dependency from the
// manifest seed path, and it is what lets an unknown ticker 404 BEFORE any
// network call -- the gate that bounds cold-fetch exposure at 10,426 requests
// ever rather than at whatever a scraper asks for.
//
// WHY IT IS NOT ALREADY COMMITTED. The agent sandbox is refused www.sec.gov with
// 403 CONNECT (re-tested 2026-09-13), so the session that wrote this could not
// download it. Ten thousand invented ticker->CIK pairs would every one of them
// look plausible and route companyfacts requests at the wrong company, so the
// file was left absent and loudly reported rather than fabricated.
//
//   node scripts/fetch-company-tickers.mjs
//   SEC_USER_AGENT="MyStockHarbor you@example.com" node scripts/fetch-company-tickers.mjs
//
// Or dispatch .github/workflows/relay.yml with task `company-tickers`; the
// workflow uploads data/sec/*.json as a build artifact, so the file can be
// downloaded rather than saved out of a browser -- which is how the previous
// copy arrived with a stray byte at the head of it.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const URL_ = "https://www.sec.gov/files/company_tickers_exchange.json";
const OUT = path.join(process.cwd(), "data/sec/company-tickers.json");

// SEC's fair-access policy requires a declared agent carrying a contact address
// and blocks generic ones with 403 "Request Rate Threshold Exceeded" -- which
// reads as a rate limit and is not one. Measured on this project: three
// redeploys were spent on that misreading.
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor sonnybrindle@mystockharbor.com";

const res = await fetch(URL_, { headers: { "user-agent": UA, accept: "application/json" } });
if (res.status !== 200) {
  console.error(`FAIL  HTTP ${res.status} from ${URL_}`);
  console.error(`      User-Agent sent: ${UA.includes("@") ? "declared, with contact" : "NO CONTACT ADDRESS -- SEC blocks this"}`);
  console.error((await res.text()).slice(0, 400));
  process.exit(1);
}

const text = await res.text();

// VALIDATED BEFORE IT IS WRITTEN. A 200 carrying an error page would otherwise
// be committed as the ticker map and fail much later, per-symbol, silently.
let parsed;
try {
  parsed = JSON.parse(text);
} catch (err) {
  console.error(`FAIL  200 but the body is not JSON: ${err.message}`);
  console.error(text.slice(0, 300));
  process.exit(1);
}

// THE COLUMNS ARE READ BY NAME, not by position. company_tickers_exchange.json
// is { fields: [...], data: [[...], ...] }, and a positional read is one column
// insertion away from filing every exchange under `name`.
if (!Array.isArray(parsed.fields) || !Array.isArray(parsed.data)) {
  console.error("FAIL  200 but not the fields+data shape this endpoint serves");
  console.error(`      top-level keys: ${Object.keys(parsed).slice(0, 8).join(", ")}`);
  process.exit(1);
}
const iTicker = parsed.fields.findIndex((f) => String(f).toLowerCase() === "ticker");
const iCik = parsed.fields.findIndex((f) => String(f).toLowerCase() === "cik");
const iExchange = parsed.fields.findIndex((f) => String(f).toLowerCase() === "exchange");
if (iTicker === -1 || iCik === -1) {
  console.error(`FAIL  required column missing (fields: ${parsed.fields.join(",")})`);
  process.exit(1);
}
const rows = parsed.data.filter(Array.isArray);
const distinct = new Set(rows.filter((r) => r[iTicker]).map((r) => String(r[iTicker]).toUpperCase()));
const exchanges = {};
for (const r of rows) {
  const e = iExchange === -1 ? "(no column)" : String(r[iExchange] ?? "").trim() || "(blank)";
  exchanges[e] = (exchanges[e] ?? 0) + 1;
}

// Measured 2026-09-13: 10,426 tickers. A file an order of magnitude smaller is
// a truncated or wrong response, not a quiet month on the markets.
const MIN_EXPECTED = 5000;
if (distinct.size < MIN_EXPECTED) {
  console.error(`FAIL  only ${distinct.size} distinct tickers (expected >= ${MIN_EXPECTED}, measured 10,426 on 2026-09-13)`);
  process.exit(1);
}
for (const sample of ["AAPL", "MU", "PLAB"]) {
  if (!distinct.has(sample)) {
    console.error(`FAIL  ${sample} is absent — this is not the ticker file`);
    process.exit(1);
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, text);

console.log(`OK    ${distinct.size} distinct tickers, ${rows.length} rows`);
console.log(`      exchanges ${Object.entries(exchanges).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(" ")}`);
console.log(`      bytes   ${text.length}`);
console.log(`      sha256  ${crypto.createHash("sha256").update(text).digest("hex")}`);
console.log(`      written ${path.relative(process.cwd(), OUT)}`);
console.log(`\nCommit it: git add data/sec/company-tickers.json`);
