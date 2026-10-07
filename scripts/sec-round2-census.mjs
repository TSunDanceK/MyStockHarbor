// #811 ROUND 2 CENSUS (#552 COWORK #192). READ-ONLY.
// For every manifest symbol with a CIK (deduped by CIK): companyfacts → this
// branch's extractor, and its own notes say what the new rules did:
//   REV   "revenue: Revenues … used for N period(s)" -- ruling A's flips
//   SLIP  "<shares> <end>: … rescaled xF" -- every rescaled period and factor
//   DEBT  newest instant with a current debt line and no long-term line --
//         where Total debt is now withheld and Short-term debt shown
// Store: ONE GET (the manifest); anything else is refused. SEC <= 8/s (6/s here).
import fs from "node:fs";
import { register } from "node:module";
import { Redis } from "@upstash/redis";

register("./lib/ts-resolve-app.mjs", import.meta.url);
const READS = new Set(["get"]);
const counts = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (process.env.UPSTASH_REDIS_REST_URL && url.startsWith(process.env.UPSTASH_REDIS_REST_URL)) {
    const body = JSON.parse(init.body ?? "null");
    for (const c of Array.isArray(body?.[0]) ? body : [body]) {
      const op = String(c?.[0]).toLowerCase();
      if (!READS.has(op)) throw new Error(`read guard: ${op} refused`);
      counts[op] = (counts[op] ?? 0) + 1;
    }
  }
  return realFetch(input, init);
};
const { extractCompanyFacts } = await import("../lib/server/secExtract.ts");
const { SEC_FIELD_INDEX } = await import("../lib/server/secFields.ts");
const keyOf = (file, name) => (fs.readFileSync(file, "utf8").match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];
const MANIFEST_KEY = keyOf("lib/server/secManifest.ts", "SEC_MANIFEST_KEY");
if (!MANIFEST_KEY) { console.error("FATAL: the manifest key moved"); process.exit(2); }
const UA = process.env.PROBE_USER_AGENT ?? "MyStockHarbor/1.0 (+https://www.mystockharbor.com; filing research)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function sec(url) {
  const wait = last + 170 - Date.now(); if (wait > 0) await sleep(wait); last = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, body: await res.json() };
}
const manifest = await new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }).get(MANIFEST_KEY);
const byCik = new Map();
for (const [sym, e] of Object.entries(manifest?.symbols ?? {})) {
  if (!e?.cik) continue;
  const list = byCik.get(e.cik) ?? []; list.push(sym); byCik.set(e.cik, list);
}
console.log(`manifest CIKs: ${byCik.size}`);
const STD = SEC_FIELD_INDEX.shortTermDebt, LTD = SEC_FIELD_INDEX.longTermDebt;
const rev = [], slip = [], debt = [], errs = [];
let n = 0, slipPeriods = 0;
for (const [cik, syms] of byCik) {
  const label = syms.sort().join("/");
  const r = await sec(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`);
  if (!r.ok) { if (r.status !== 404) errs.push(`${label}:${r.status}`); continue; }
  let x; try { x = extractCompanyFacts(syms[0], r.body); } catch (e) { errs.push(`${label}:threw`); continue; }
  n++;
  for (const note of x.notes ?? []) {
    if (note.startsWith("revenue: Revenues")) rev.push(`${label} — ${note.slice(9)}`);
  }
  const s = (x.notes ?? []).filter((t) => / rescaled x/.test(t));
  if (s.length) {
    slipPeriods += s.length;
    const fs_ = [...new Set(s.map((t) => t.match(/rescaled x([0-9.e+-]+)/)?.[1]))].join(",");
    slip.push(`${label} ${s.length} period(s) ×${fs_}: ${s.map((t) => t.split(":")[0]).slice(0, 6).join("; ")}${s.length > 6 ? " …" : ""}`);
  }
  const inst = [...(x.instants ?? [])].sort((a, b) => (a.end < b.end ? 1 : -1))[0];
  const v = (i) => inst?.values?.[i]?.val ?? null;
  if (inst && v(STD) !== null && v(LTD) === null) debt.push(`${label} ${inst.end} short ${v(STD)} (${inst.values[STD]?.tag})`);
  if (n % 250 === 0) console.log(`  … ${n} read`);
}
console.log(`\nread ${n} · errors ${errs.length}${errs.length ? `: ${errs.slice(0, 20).join(" ")}` : ""}`);
console.log(`\nREV (ruling A) flips: ${rev.length}`); rev.forEach((l) => console.log("  " + l));
console.log(`\nSLIP rescaled: ${slip.length} filers, ${slipPeriods} periods`); slip.forEach((l) => console.log("  " + l));
console.log(`\nDEBT short-only on the newest instant (Total withheld, Short-term shown): ${debt.length}`); debt.forEach((l) => console.log("  " + l));
console.log(`\nStore commands: ${JSON.stringify(counts)}`);
