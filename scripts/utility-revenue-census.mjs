// WHO FILES A TOTAL OPERATING REVENUE ABOVE ITS CONTRACT LINE (audit r3, NEE).
// For every manifest filer that tags RegulatedAndUnregulatedOperatingRevenue:
// the newest fiscal year's figure beside the contract line (excluding, else
// including, assessed tax) for the same frame, and what this branch's
// extraction stores. Prints a line per filer whose total is more than 3% above
// the contract line, then counts. Changes nothing.
//
// CREDENTIALLED, READ-ONLY: one manifest GET. SYMBOLS="SHARD i/n".
//   relay task: write-utility-revenue-census
import fs from "node:fs";
import { loadMainAndBranch } from "./lib/earnings-audit-lift.mjs";

const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (+https://www.mystockharbor.com; utility revenue census)";
const { NEW } = await loadMainAndBranch();
const shardM = String(process.env.SYMBOLS || "").match(/SHARD\s+(\d+)\s*\/\s*(\d+)/i);
const { Redis } = await import("@upstash/redis");
const KEY = (fs.readFileSync("lib/server/secManifest.ts", "utf8").match(/SEC_MANIFEST_KEY = "([^"]+)"/) ?? [])[1];
const manifest = await Redis.fromEnv().get(KEY);
const all = Object.entries(manifest.symbols).filter(([, e]) => e?.cik && !e.delisted).map(([s, e]) => [s, String(e.cik).padStart(10, "0")]).sort();
const targets = shardM ? all.filter((_, i) => i % Number(shardM[2]) === Number(shardM[1])) : all;
console.log(`filers: ${targets.length}\n`);
const REV = NEW.SEC_FIELD_KEYS.indexOf("revenue");
const B = (v) => (v == null ? "—" : `${(v / 1e6).toFixed(1)}M`);
const yearRows = (g, tag) => (g[tag]?.units?.USD ?? []).filter((r) => r.start && r.end && /^10-K|^20-F|^40-F/.test(r.form ?? "") &&
  Math.abs((Date.parse(r.end) - Date.parse(r.start)) / 864e5 - 365) <= 10);
const newestOf = (rows, start, end) => rows.filter((r) => r.start === start && r.end === end).sort((a, b) => String(a.filed).localeCompare(String(b.filed))).at(-1)?.val ?? null;
let taggers = 0, over = 0, failed = 0;
for (const [sym, cik] of targets) {
  let facts;
  try {
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) { failed++; continue; }
    facts = await res.json();
  } catch { failed++; continue; }
  const g = facts.facts?.["us-gaap"] ?? {};
  const R = yearRows(g, "RegulatedAndUnregulatedOperatingRevenue");
  if (R.length) {
    taggers++;
    const top = R.sort((a, b) => String(a.end).localeCompare(String(b.end))).at(-1);
    const total = newestOf(R, top.start, top.end);
    const contract = newestOf(yearRows(g, "RevenueFromContractWithCustomerExcludingAssessedTax"), top.start, top.end)
      ?? newestOf(yearRows(g, "RevenueFromContractWithCustomerIncludingAssessedTax"), top.start, top.end);
    let site = null;
    try { site = NEW.extractCompanyFacts(sym, facts).years.find((p) => p.end === top.end)?.values?.[REV]?.val ?? null; } catch { /* reported below as — */ }
    const gap = contract ? (total - contract) / contract : null;
    if (gap != null && gap > 0.03) {
      over++;
      console.log(`${sym}\tFY ${top.end}\ttotal ${B(total)}\tcontract ${B(contract)}\t+${(gap * 100).toFixed(1)}%\tsite ${B(site)}${site != null && Math.abs(site - total) <= 0.005 * total ? "\t(already total)" : ""}`);
    }
  }
  await new Promise((r) => setTimeout(r, 250));
}
console.log(`\ntaggers of RegulatedAndUnregulatedOperatingRevenue: ${taggers}; total >3% above contract line: ${over}; read failures: ${failed}`);
