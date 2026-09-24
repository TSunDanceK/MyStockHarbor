// THE QXO ANCHOR FIX, MEASURED ACROSS THE UNIVERSE BEFORE IT SHIPS
// (#552 COWORK #30). For every price-pool symbol: companyfacts fetched on the
// runner; the shipped fiscalYearOffset run twice -- as shipped (a duration
// ending after its own filing date is skipped) and with that one guard
// removed (the old rule); where the year-end anchor differs, the shipped
// extractor is run both ways and the years kept and newest labels printed.
// SEC values only; the Redis read is the symbol list (1 HKEYS). Nothing written.
//   relay task: write-sec-fy-anchor-census
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; fy anchor census)";
const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const EXTRACT = strip("lib/server/secExtract.ts");
const GUARD = "if (r.filed && r.end > r.filed) continue;";
if (EXTRACT.split(GUARD).length !== 2) { console.error("FATAL: guard anchor not found once"); process.exit(2); }
const unit = (x) => lift([readCodeOnly("lib/server/secFields.ts"), x, strip("lib/server/fxRates.ts"), strip("lib/server/secCurrency.ts"),
  "export { extractCompanyFacts, fiscalYearOffset };"].join("\n"));
const NEW = await unit(EXTRACT);
const OLD = await unit(EXTRACT.replace(GUARD, ""));

const redis = Redis.fromEnv();
const universe = (await redis.hkeys("msh:price-pool:v1")).map(String).sort();
const tickers = JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8"));
const cikOf = new Map(tickers.data.map(([cik, , t]) => [String(t).toUpperCase(), String(cik).padStart(10, "0")]));
const started = Date.now();
let fetched = 0, failed = 0, same = 0;
const changed = [];
for (const s of universe) {
  if (Date.now() - started > 24 * 60 * 1000) { console.log(`stopped at the time budget after ${fetched} fetches`); break; }
  const cik = cikOf.get(s.replace(".", "-")) ?? cikOf.get(s);
  if (!cik) continue;
  let facts;
  try {
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
    await new Promise((r) => setTimeout(r, 130));
    if (!res.ok) { failed++; continue; }
    facts = await res.json();
    fetched++;
  } catch { failed++; continue; }
  const a = OLD.fiscalYearOffset(facts, null);
  const b = NEW.fiscalYearOffset(facts, null);
  if (a.yearEnd === b.yearEnd && a.offset === b.offset) { same++; continue; }
  const xa = OLD.extractCompanyFacts(s, facts), xb = NEW.extractCompanyFacts(s, facts);
  const lab = (x) => x.quarters.slice(0, 2).map((p) => `${p.end} ${p.fp} FY${p.fy}`).join(", ") || "—";
  changed.push(`${s} | anchor ${a.yearEnd ?? "none"} → ${b.yearEnd ?? "none"} | offset ${a.offset} → ${b.offset} | years ${xa.years.length} → ${xb.years.length} | newest ${lab(xa)} → ${lab(xb)}`);
}
console.log(`universe ${universe.length}; companyfacts fetched ${fetched}, failed ${failed}; anchor unchanged ${same}; changed ${changed.length}`);
for (const c of changed) console.log(`  ${c}`);
console.log(`Redis commands used by this read: 1`);
