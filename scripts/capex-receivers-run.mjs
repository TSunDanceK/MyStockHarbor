// "Who is receiving": run the job's own code against live SEC from a relay
// runner (Relay C, #563 COWORK #2). The agent sandbox cannot reach sec.gov.
//
//   mode=dry  (default) read every curated line, print the rows and flags, and
//             list the members for any entry with no element yet. No Redis.
//   mode=seed also write the record to msh:capex:receivers:v1 -- ONE SET, a key
//             nothing on main reads. Needs --allow-writes AND the owner's OK.
//
//   relay task: write-capex-receivers (SYMBOLS="mode=seed" to seed)
//   SEC: ~44 submissions + ~45 filings x (index, instance, labels) + 2 documents
//   ≈ 180 requests at 8/s. Redis: 0 (dry) or 1 SET (seed).
import "./lib/register-ts-here.mjs";
import fs from "node:fs";

const { refreshReceivers } = await import("../lib/server/capexReceiversCore.ts");
const { percentChange } = await import("../lib/server/capexXbrl.ts");

const args = (process.env.SYMBOLS || "").split(/\s+/).filter(Boolean);
const mode = (args.find((a) => a.startsWith("mode=")) ?? "mode=dry").slice(5);
const allowWrites = process.argv.includes("--allow-writes");
if (!["dry", "seed"].includes(mode)) throw new Error(`mode must be dry or seed, got ${mode}`);
if (mode === "seed" && !allowWrites) throw new Error("mode=seed needs --allow-writes");

const file = JSON.parse(fs.readFileSync("data/capex/receivers.json", "utf8"));
const UA = process.env.SEC_USER_AGENT?.trim() || "MyStockHarbor/1.0 (+https://www.mystockharbor.com; contact sonnybrindle@mystockharbor.com)";

let last = 0;
async function get(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = last + 125 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" }, signal: AbortSignal.timeout(60_000) });
      if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt)); continue; }
      return res.ok ? res : null;
    } catch {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  return null;
}
const fetchers = {
  json: async (u) => (await get(u))?.json().catch(() => null) ?? null,
  text: async (u) => (await get(u))?.text().catch(() => null) ?? null,
};

const discovered = [];
const t0 = Date.now();
const { record, stats } = await refreshReceivers(file.rows, null, fetchers, {
  now: Date.now(),
  maxFilings: 60,
  budgetMs: 25 * 60_000,
  onDiscover: (id, members) => discovered.push([id, members]),
});

const fmt = (v, cur) => (v === null || v === undefined ? "—" : `${cur === "USD" ? "" : cur + " "}${(v / 1e9).toFixed(2)}bn`);
console.log(`receivers: ${file.rows.length} lines, ${stats.companies} companies; filings read ${stats.filingsRead}, deferred ${stats.deferred}, SEC requests ${stats.secRequests}, ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
console.log("id | form accession | FY | concept | current | prior | change | label in filing | sub-label ok");
for (const e of file.rows) {
  const r = record.rows[e.id];
  if (!r) { console.log(`${e.id} | NO ROW`); continue; }
  const pc = percentChange(r.current, r.prior);
  console.log(`${e.id} | ${r.form} ${r.accession} | ${r.fyStart}..${r.fyEnd} | ${r.concept.replace(/^[^:]+:/, "")} | ${fmt(r.current, r.currency)} | ${fmt(r.prior, r.currency)} | ${pc === null ? "n/a" : (pc >= 0 ? "+" : "") + pc.toFixed(0) + "%"} | ${r.labelInFiling ?? "(none)"}${r.labelInFiling && r.labelInFiling !== e.filedLabel ? ` ≠ committed "${e.filedLabel}"` : ""} | ${e.subLabel ? r.subLabelOk : "-"}`);
}
console.log(`\nflags (${record.flags.length}):`);
for (const f of record.flags) console.log(`  ${f.id}: ${f.kind} — ${f.detail}`);
for (const [id, members] of discovered) console.log(`\nDISCOVER ${id}: ${members.join(" ")}`);
console.log(`\nrecord size: ${JSON.stringify(record).length} bytes`);

if (mode === "seed") {
  const { Redis } = await import("@upstash/redis");
  await Redis.fromEnv().set("msh:capex:receivers:v1", record);
  console.log("seeded msh:capex:receivers:v1 (1 SET)");
} else {
  console.log("dry run: Redis commands 0");
}
