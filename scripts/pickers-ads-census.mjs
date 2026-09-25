// Pickers vs the earnings page on the cited ADS ratio (Relay B, #553 COWORK #44/#47).
//
// Read-only. For TSM, ASML, AZN and BABA (or SYMBOLS), runs the SHIPPED
// Pickers write/read halves (buildSecPickerRow -> JSON -> applySecPickerRow)
// with the filer facts the daily job now passes, and the earnings page's own
// call (valuationInputs with the same facts, then marketCap / peRatio), at the
// same price. Prints shares basis, refusals, market cap on both paths and the
// earnings page's P/E. Aggregate figures only; no credentials printed.
//
//   relay task: write-pickers-ads-census
//   Redis: 1 GET per symbol (fact set) + 1 HMGET (price pool) = 5 for four symbols.
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const SYMBOLS = (process.env.SYMBOLS || "TSM,ASML,AZN,BABA").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const P = await import("../lib/server/pickersSecFundamentals.ts");
const V = await import("../lib/server/secValuation.ts");
const { readFactSet } = await import("../lib/server/secFactStore.ts");
const { adsRatioFor } = await import("../lib/server/secAdsMap.ts");
const { lookupSpellingIn } = await import("../lib/symbolSpellings.mjs");
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows ?? {};

const redis = Redis.fromEnv();
const pool = await redis.hmget("msh:price-pool:v1", ...SYMBOLS);
const today = new Date().toISOString().slice(0, 10);
let commands = 1;
const fmt = (v) => (v === null || v === undefined ? "—" : typeof v === "number" ? (Math.abs(v) >= 1e6 ? `${(v / 1e9).toFixed(1)}B` : v.toFixed(2)) : String(v));
for (const sym of SYMBOLS) {
  const set = await readFactSet(sym);
  commands++;
  const row = Array.isArray(pool) ? pool[SYMBOLS.indexOf(sym)] : pool?.[sym];
  const price = typeof row === "object" && row && typeof row.price === "number" ? row.price : null;
  if (!set) { console.log(`${sym}: no fact set`); continue; }
  const filer = { annualForm: lookupSpellingIn(REG, sym)?.value?.annualForm ?? null, ads: adsRatioFor(sym) };
  const picker = P.applySecPickerRow(JSON.parse(JSON.stringify(P.buildSecPickerRow(set, today, filer, Date.now()))), price);
  const inputs = V.valuationInputs(set, today, filer);
  const cap = V.marketCap(inputs, price);
  const pe = V.peRatio(inputs, price);
  const ads = filer.ads ? `${filer.ads.kind} ${filer.ads.ordinaryPerAds}` : "none";
  console.log(`${sym}: form ${filer.annualForm ?? "?"}; cited ${ads}; price ${fmt(price)}; shares ${fmt(inputs.shares?.val ?? null)}${inputs.shares?.adsRatio ? ` (ADS-equiv, ÷${inputs.shares.adsRatio})` : ""}; refusals [${inputs.refusals.join(", ")}]`);
  console.log(`   Pickers cap ${fmt(picker.marketCap)} | earnings-page cap ${cap?.ok ? fmt(cap.val) : `refused (${cap?.why ?? "no figure"})`} | earnings-page P/E ${pe?.ok ? fmt(pe.val) : `refused (${pe?.why ?? "no figure"})`} | same cap: ${picker.marketCap === (cap?.ok ? cap.val : null)}`);
}
console.log(`Redis commands: ${commands} (read-only)`);
