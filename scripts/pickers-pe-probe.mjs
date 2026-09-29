// WHY AN FY-MARKED P/E LOOKS WRONG (#553 COWORK #64). READ-ONLY.
//
// For a handful of symbols, what #587 ships (buildSecPickerRow + applySecEarnings,
// with the same filer facts the seed and the daily job pass) beside the inputs
// behind it: reporting currency, whether A's FX conversion was applied, the EPS
// period and value (per ADS where a ratio is cited), the cited ratio and the
// pool price; FMP's P/E for comparison only. Public filed figures and prices;
// no keys, no credentials.
//
//   relay task: write-pickers-pe-probe   (SYMBOLS="MFG,TM" to override)
//   Redis: 1 HMGET (pool) + 1 GET per symbol (fact set) = ~15, once.
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { lookupSpellingIn, toDashed } from "../lib/symbolSpellings.mjs";

const P = await import("../lib/server/pickersSecFundamentals.ts");
const S = await import("../lib/server/secFactStore.ts");
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows ?? {};
const ADS = JSON.parse(fs.readFileSync("data/sec/ads-ratios.json", "utf8")).entries ?? {};
const filerFor = (s) => ({
  annualForm: lookupSpellingIn(REG, s)?.value?.annualForm ?? null,
  ads: lookupSpellingIn(ADS, s)?.value ?? null,
});

const symbols = (process.env.SYMBOLS || "MFG,PDD,TCOM,TM,RCI,BCE,GFL,NMR,NWG,KSPI,AZN,AAPL,KGC")
  .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const redis = Redis.fromEnv();
const poolRaw = await redis.hmget("msh:price-pool:v1", ...symbols.map(toDashed));
const today = new Date().toISOString().slice(0, 10);
const r4 = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : v ?? null);

for (const [i, s] of symbols.entries()) {
  let pool = Array.isArray(poolRaw) ? poolRaw[i] : poolRaw?.[toDashed(s)];
  if (typeof pool === "string") try { pool = JSON.parse(pool); } catch { pool = null; }
  const price = typeof pool?.price === "number" ? pool.price : null;
  const set = await S.readFactSet(s).catch(() => null);
  if (!set) { console.log(`${s}: no fact set`); continue; }
  const filer = filerFor(s);
  const row = JSON.parse(JSON.stringify(P.buildSecPickerRow(set, today, filer, Date.now())));
  const shown = P.applySecEarnings(row, price);
  const y = set.years?.[0];
  console.log(JSON.stringify({
    s, form: filer.annualForm, adsCited: filer.ads ? { kind: filer.ads.kind, ordinaryPerAds: filer.ads.ordinaryPerAds } : null,
    cur: set.cur ?? "USD", fxApplied: Boolean(set.fx), fxFrom: set.fx?.from ?? null,
    newestYear: y ? { fy: y.fy ?? null, e: y.e } : null,
    eps: row.eps ? { basis: row.eps.basis, periodEnd: row.eps.periodEnd, val: r4(row.eps.val), adsRatio: row.eps.adsRatio ?? null } : null,
    refusals: row.inputs.refusals, unit: row.unit,
    price: r4(price), fmpPe: r4(pool?.pe), shipped: { pe: r4(shown?.peRatio), epsBasis: shown?.epsBasis ?? null },
  }));
}
process.exit(0);
