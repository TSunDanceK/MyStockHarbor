// KB REVENUE (#552 COWORK #200 item 4). READ-ONLY.
// Why the 20-F bank stores no FY revenue, and which filed tag would fill it.
//   A. Every duration concept in KB's companyfacts (any namespace) that reads
//      like revenue / income / interest / fee / commission, with its newest
//      annual values (FY frames, 20-F) and units.
//   B. What the shipped extractor stores for KB's years: revenue, operating
//      income, pre-tax and net income, and the cells' tags.
// One SEC companyfacts request per symbol (SYMBOLS, default KB). No store access.
import fs from "node:fs";
import { register } from "node:module";

register("./lib/ts-resolve-app.mjs", import.meta.url);
let secCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (/^https:\/\/data\.sec\.gov\/api\/xbrl\/companyfacts\/CIK\d{10}\.json$/.test(url)) {
    if (++secCalls > 4) throw new Error("read guard: SEC request cap");
  } else if (!url.startsWith("data:")) throw new Error("read guard: host refused");
  return realFetch(input, init);
};
const { extractForSymbol } = await import("../lib/server/secExtractFor.ts");
const { SEC_FIELD_INDEX } = await import("../lib/server/secFields.ts");
const cikMap = JSON.parse(fs.readFileSync("data/cik-map.json", "utf8"));
const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; read-only probe)";
const days = (s, e) => (s && e ? Math.round((Date.parse(e) - Date.parse(s)) / 864e5) + 1 : null);
const B = (v) => (typeof v === "number" ? `${(v / 1e9).toFixed(3)}B` : "—");
const RX = /revenue|income|interest|fee|commission|insurance|operating|premium|gain|dividend/i;

for (const symbol of (process.env.SYMBOLS || "KB").split(/[\s,]+/).filter(Boolean).map((s) => s.toUpperCase())) {
  console.log(`\n================ ${symbol} ================`);
  const cik = cikMap[symbol];
  if (!cik) { console.log("no CIK"); continue; }
  const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
  console.log(`companyfacts HTTP ${res.status}`);
  if (!res.ok) continue;
  const json = await res.json();
  console.log(`namespaces: ${Object.entries(json.facts ?? {}).map(([ns, c]) => `${ns}(${Object.keys(c).length})`).join(" ")}`);
  console.log("\nA. annual duration concepts matching revenue/income/interest/fee/commission/…, newest three fiscal years");
  for (const [ns, concepts] of Object.entries(json.facts ?? {})) {
    if (ns === "dei") continue;
    for (const [name, c] of Object.entries(concepts)) {
      if (!RX.test(name)) continue;
      for (const [unit, rows] of Object.entries(c.units ?? {})) {
        const fy = rows.filter((r) => r.start && (days(r.start, r.end) ?? 0) > 330 && (days(r.start, r.end) ?? 0) < 380 && /20-F|10-K|40-F/.test(r.form ?? ""));
        if (!fy.length) continue;
        const byEnd = new Map();
        for (const r of fy) if (!byEnd.has(r.end) || (r.filed ?? "") > (byEnd.get(r.end).filed ?? "")) byEnd.set(r.end, r);
        const newest = [...byEnd.values()].sort((a, b) => (a.end < b.end ? 1 : -1)).slice(0, 3);
        console.log(`  ${ns}:${name} [${unit}] ${newest.map((r) => `${r.end}=${B(r.val)}`).join(" · ")}`);
      }
    }
  }
  console.log("\nB. the shipped extractor's years");
  const r = extractForSymbol(symbol, json);
  const keys = ["revenue", "operatingIncome", "preTaxIncome", "netIncome"];
  console.log(`  quarters ${r.quarters.length} · years ${r.years.length} · untagged: ${(r.untagged ?? []).filter((k) => keys.includes(k)).join(",") || "none of these"}`);
  for (const p of r.years.slice(-4)) {
    console.log(`  ${p.end} FY${p.fy}: ` + keys.map((k) => { const c = p.values?.[SEC_FIELD_INDEX[k]]; return `${k}=${c ? `${B(c.val)} ${c.ns ?? ""}:${c.tag ?? ""}` : "—"}`; }).join(" · "));
  }
  console.log(`  notes mentioning revenue: ${r.notes.filter((n) => /revenue/i.test(n)).slice(0, 8).join(" | ") || "none"}`);
}
console.log(`\nSEC requests: ${secCalls}`);
