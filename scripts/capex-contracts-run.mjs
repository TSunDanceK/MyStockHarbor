// "Federal contracts": run the weekly job's logic from a relay runner (Relay C,
// #563 D5) -- the sandbox cannot reach USAspending.
//   mode=dry  (default) print the top rows, totals and timing. Redis 0.
//   mode=seed also write msh:capex:contracts:v1 (1 SET; a key nothing on main
//             reads). Needs --allow-writes AND the owner's OK.
//   relay task: write-capex-contracts
import "./lib/register-ts-here.mjs";
import fs from "node:fs";

const M = await import("../lib/server/capexContractsCore.ts");
const mode = ((process.env.SYMBOLS || "").match(/mode=(\w+)/) ?? [])[1] ?? "dry";
if (mode === "seed" && !process.argv.includes("--allow-writes")) throw new Error("mode=seed needs --allow-writes");

const aliases = JSON.parse(fs.readFileSync("data/capex/contract-aliases.json", "utf8"));
const ours = new Set(Object.keys(JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows));
const ct = JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8"));
const universe = ct.data.map((r) => ({ ticker: String(r[ct.fields.indexOf("ticker")]), secName: String(r[ct.fields.indexOf("name")]) })).filter((u) => ours.has(u.ticker));

const UA = "MyStockHarbor/1.0 (+https://www.mystockharbor.com; contact sonnybrindle@mystockharbor.com)";
async function post(path, body) {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(`https://api.usaspending.gov/api/v2${path}`, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": UA }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
      if (r.ok) return await r.json();
      if (r.status < 500 && r.status !== 429) return null;
    } catch {}
    await new Promise((res) => setTimeout(res, 2000 * 2 ** a));
  }
  return null;
}

const t0 = Date.now();
const window = M.contractWindow(Date.now());
const filters = { time_period: [{ start_date: window.start, end_date: window.end }], award_type_codes: M.CONTRACT_AWARD_TYPES };
const pages = [];
for (let p = 1; p <= 10; p += 3) {
  const batch = await Promise.all(Array.from({ length: Math.min(3, 10 - p + 1) }, (_, i) => post("/search/spending_by_category/recipient/", { filters, category: "recipient", limit: 100, page: p + i })));
  for (const b of batch) pages.push(Array.isArray(b?.results) ? b.results.map((r) => ({ name: String(r.name ?? ""), amount: Number(r.amount) })) : null);
}
const failed = pages.filter((p) => p === null).length;
const over = await post("/search/spending_over_time/", { group: "fiscal_year", filters });
const totalAmount = Array.isArray(over?.results) ? over.results.reduce((a, r) => a + (Number(r.aggregated_amount) || 0), 0) : null;
const recipients = pages.flat().filter(Boolean);
const { rows, mappedAmount, readAmount } = M.aggregateContracts(recipients, M.buildMapper(aliases.aliases, aliases.exclusions, universe), 25);
const record = { v: 1, window, builtAt: Date.now(), recipientsRead: recipients.length, readAmount, totalAmount, mappedAmount, rows };

console.log(`window ${window.start}..${window.end}; pages failed ${failed}; ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(`total obligated $${((totalAmount ?? 0) / 1e9).toFixed(1)}bn; read (top ${recipients.length}) $${(readAmount / 1e9).toFixed(1)}bn; mapped $${(mappedAmount / 1e9).toFixed(1)}bn`);
for (const r of rows) console.log(`  ${r.ticker.padEnd(6)} $${(r.amount / 1e9).toFixed(2)}bn  ${r.entities.length} entities: ${r.entities.slice(0, 4).map((e) => `${e.name} [${e.how}]`).join("; ")}`);
console.log(`record size ${JSON.stringify(record).length} bytes`);
if (mode === "seed" && !failed) {
  const { Redis } = await import("@upstash/redis");
  await Redis.fromEnv().set("msh:capex:contracts:v1", record);
  console.log("seeded msh:capex:contracts:v1 (1 SET)");
} else console.log("dry run: Redis 0");
