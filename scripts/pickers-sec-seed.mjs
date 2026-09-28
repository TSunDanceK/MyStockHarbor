// ONE-OFF SEED of msh:pickers:sec-fundamentals:v1 so the Pickers PR's preview
// shows the filings figures before its first production cron (05:35 UTC).
//
// A REAL WRITE, TO A KEY NOTHING ON main READS: only the Pickers PR's code reads
// it, and that PR's own daily job overwrites every field it writes. It runs the
// SHIPPED warmPickersSec over the price-pool universe -- no second
// implementation -- and it refuses to run without --allow-writes.
//   relay task: write-pickers-sec-seed   (run only on the owner's OK)
//               write-pickers-sec-seed-preview  (--preview: the preview-only
//               key, msh:pickers:sec-fundamentals:preview:v1, which production
//               never reads or overwrites -- #553 COWORK #60)
//   cost: one HKEYS + ~850 GETs + ~9 HSETs + 1 EXPIRE ≈ 860 commands, once.
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import { Redis } from "@upstash/redis";

if (!process.argv.includes("--allow-writes")) {
  console.error("FATAL: write task invoked without --allow-writes; refusing.");
  process.exit(2);
}
const redis = Redis.fromEnv();
const { warmPickersSec, PICKERS_SEC_KEY, PICKERS_SEC_PREVIEW_KEY } = await import("../lib/server/pickersSecFundamentals.ts");
const KEY = process.argv.includes("--preview") ? PICKERS_SEC_PREVIEW_KEY : PICKERS_SEC_KEY;
const { lookupSpellingIn } = await import("../lib/symbolSpellings.mjs");
const REGISTRANTS = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows ?? {};
// The cited ADS ratios (#553 COWORK #44), looked up as secAdsMap.adsRatioFor does.
const ADS = JSON.parse(fs.readFileSync("data/sec/ads-ratios.json", "utf8")).entries ?? {};

const symbols = (await redis.hkeys("msh:price-pool:v1")).map(String);
console.log(`universe: ${symbols.length} symbols (msh:price-pool:v1)`);
const result = await warmPickersSec(symbols, (s) => ({
  annualForm: REGISTRANTS[s]?.annualForm ?? null,
  // A withheld row (#552 COWORK #64, MFG) is not used, as in adsRatioFor.
  ads: ((e) => (e && !e.withheld ? e : null))(lookupSpellingIn(ADS, s.toUpperCase())?.value ?? null),
}), Date.now(), KEY);
console.log(JSON.stringify(result));
console.log(`key ${KEY}; field count now: ${await redis.hlen(KEY)}; seeded at ${new Date().toISOString()}`);
process.exit(result.ok ? 0 : 1);
