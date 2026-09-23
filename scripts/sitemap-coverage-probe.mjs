// Which sitemap stock URLs render noindex or "not yet read" today (#535
// COWORK #21 §1), and the #543 cold-fill day counters (COWORK #19 §1c).
// Read-only: GET/EXISTS/HGETALL only.
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { lift } from "./lib/earnings-plan.mjs";
import { lookupBySpelling } from "../lib/symbolSpellings.mjs";
const redis = Redis.fromEnv();
const C = await lift(fs.readFileSync("lib/curatedSymbols.ts", "utf8"));
const etfs = new Set(C.uniqueEtfs);
const syms = [...new Set([...C.priorityStocks, ...C.uniqueEtfs])];
const raw = JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8"));
const map = new Map();
if (raw.fields && raw.data) {
  const i = { cik: raw.fields.indexOf("cik"), t: raw.fields.indexOf("ticker"), ex: raw.fields.indexOf("exchange") };
  for (const r of raw.data) if (!map.has(String(r[i.t]).toUpperCase())) map.set(String(r[i.t]).toUpperCase(), { cik: String(r[i.cik]).padStart(10, "0"), exchange: r[i.ex] });
} else for (const r of Object.values(raw)) if (!map.has(String(r.ticker).toUpperCase())) map.set(String(r.ticker).toUpperCase(), { cik: String(r.cik_str).padStart(10, "0") });
const man = await redis.get("msh:sec:manifest:v1");
const p = redis.pipeline();
for (const s of syms) p.exists(`msh:sec:facts:v1:${s}`);
const ex = await p.exec();
const rows = syms.map((s, k) => {
  const cik = lookupBySpelling(map, s)?.value?.cik ?? null;
  const e = man.symbols[s] ?? null;
  return { s, etf: etfs.has(s), cik, inManifest: Boolean(e), hash: Boolean(e?.contentHash), set: ex[k] === 1 };
});
const stocks = rows.filter((r) => !r.etf);
const noCik = stocks.filter((r) => !r.cik);
const cold = stocks.filter((r) => r.cik && !r.set);
const notInManifest = stocks.filter((r) => r.cik && !r.inManifest);
console.log(`sitemap symbols ${syms.length} (stocks ${stocks.length}, ETFs ${rows.length - stocks.length})`);
console.log(`stock URLs in sitemap: /stock/X ${syms.length}, /stock/X/earnings ${stocks.length}`);
console.log(`NO CIK (earnings page = "No SEC company filings", noindex) ${noCik.length}: ${noCik.map((r) => r.s).join(" ")}`);
console.log(`CIK but NO STORED SET ("not yet read", noindex on BOTH pages) ${cold.length}: ${cold.map((r) => r.s).join(" ")}`);
console.log(`CIK but not in the manifest (no job will ever fill them) ${notInManifest.length}: ${notInManifest.map((r) => `${r.s}${r.set ? "(set)" : ""}`).join(" ")}`);
console.log(`ETF /stock/X with no CIK ${rows.filter((r) => r.etf && !r.cik).length}; ETF with a CIK and no set ${rows.filter((r) => r.etf && r.cik && !r.set).length}`);
console.log(`manifest hash but no set key ${stocks.filter((r) => r.hash && !r.set).length}; set but no manifest hash ${stocks.filter((r) => r.set && !r.hash).length}`);
for (const day of ["2026-09-22", "2026-09-23", "2026-09-24"]) {
  const [a, f] = await Promise.all([redis.get(`msh:sec:cold-fill-attempt:v1:${day}`), redis.get(`msh:sec:cold-fill-day:v1:${day}`)]);
  console.log(`cold-fill ${day}: attempts ${a ?? 0}, fills (post-BotID human verdicts) ${f ?? 0}`);
}
const ipKeys = await redis.keys("msh:sec:cold-fill-ip:v1:*");
console.log(`cold-fill ip-hour buckets live ${ipKeys.length}`);
const none = await redis.keys("msh:sec:cold-none:v1:*");
console.log(`cold-none (no usable data, 24h) ${none.length}: ${none.map((k) => k.split(":").pop()).join(" ")}`);
