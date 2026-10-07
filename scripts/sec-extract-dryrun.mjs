// EXTRACT DRY RUN (#552 COWORK #192): companyfacts → the branch's extractor,
// BEFORE (the netIncome chain without its new last entry) and AFTER, for
// SYMBOLS (default BKNG). READ-ONLY: no store client is loaded, and the only
// network reads are SEC (company_tickers + one companyfacts per symbol, 4/s).
import fs from "node:fs";
import { lift } from "./lib/earnings-plan.mjs";

const UA = process.env.PROBE_USER_AGENT ?? "MyStockHarbor/1.0 (+https://www.mystockharbor.com; filing research)";
const SYMBOLS = (process.env.SYMBOLS || "BKNG").split(/[,\s]+/).filter(Boolean).map((s) => s.toUpperCase());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url) {
  await sleep(250);
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, body: await res.json() };
}
const fieldsSrc = fs.readFileSync("lib/server/secFields.ts", "utf8");
const fxSrc = fs.readFileSync("lib/server/fxRates.ts", "utf8");
const currencySrc = fs.readFileSync("lib/server/secCurrency.ts", "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const extractSrc = fs.readFileSync("lib/server/secExtract.ts", "utf8")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secFields";/, "")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secCurrency";/, "");
const load = (fields) => lift(`${fields}\n${fxSrc}\n${currencySrc}\n${extractSrc}`);
const AFTER = await load(fieldsSrc);
const beforeSrc = fieldsSrc.replace(`"ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"]`, `"ProfitLoss"]`);
if (beforeSrc === fieldsSrc) { console.error("FATAL: the chain entry moved"); process.exit(2); }
const BEFORE = await load(beforeSrc);
const NI = AFTER.SEC_FIELD_KEYS.indexOf("netIncome");

const tick = await getJson("https://www.sec.gov/files/company_tickers.json");
if (!tick.ok) { console.error(`FATAL: tickers ${tick.status}`); process.exit(2); }
const cikOf = new Map(Object.values(tick.body).map((r) => [String(r.ticker).toUpperCase().replace(/-/g, "."), String(r.cik_str).padStart(10, "0")]));
const cell = (v) => (v ? `${(v.val / 1e6).toFixed(0)}M ${v.derived ?? ""}${v.tag ? ` [${v.tag.replace("NetIncomeLoss", "NIL")}]` : ""}` : "Not reported");
for (const sym of SYMBOLS) {
  const cik = cikOf.get(sym);
  if (!cik) { console.log(`${sym}: no CIK`); continue; }
  const r = await getJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
  if (!r.ok) { console.log(`${sym}: companyfacts ${r.status}`); continue; }
  const b = BEFORE.extractCompanyFacts(sym, r.body), a = AFTER.extractCompanyFacts(sym, r.body);
  const byEnd = (res) => new Map(res.quarters.map((p) => [p.end, p]));
  const bq = byEnd(b);
  console.log(`\n${sym} — net income, newest 8 quarters (before → after)`);
  for (const p of [...a.quarters].sort((x, y) => (x.end < y.end ? 1 : -1)).slice(0, 8)) {
    console.log(`  ${p.end} ${p.fp ?? ""} FY${p.fy ?? "?"}: ${cell(bq.get(p.end)?.values?.[NI])} → ${cell(p.values?.[NI])}`);
  }
  console.log(`  years (after): ${[...a.years].sort((x, y) => (x.end < y.end ? 1 : -1)).slice(0, 3).map((p) => `${p.end} ${cell(p.values?.[NI])}`).join(" · ")}`);
}
