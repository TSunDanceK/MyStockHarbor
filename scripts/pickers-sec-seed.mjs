// ONE-OFF SEED of msh:pickers:sec-fundamentals:v1 so the Pickers PR's preview
// shows the filings figures before its first production cron (05:35 UTC).
//
// A REAL WRITE, TO A KEY NOTHING ON main READS: only the Pickers PR's code reads
// it, and that PR's own daily job overwrites every field it writes. It runs the
// SHIPPED warmPickersSec over the price-pool universe -- no second
// implementation -- and it refuses to run without --allow-writes.
//   relay task: write-pickers-sec-seed   (run only on the owner's OK)
//   cost: one HKEYS + ~850 GETs + ~9 HSETs + 1 EXPIRE ≈ 860 commands, once.
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import { Redis } from "@upstash/redis";

if (!process.argv.includes("--allow-writes")) {
  console.error("FATAL: write task invoked without --allow-writes; refusing.");
  process.exit(2);
}
const redis = Redis.fromEnv();
const { warmPickersSec } = await import("../lib/server/pickersSecFundamentals.ts");
const REGISTRANTS = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows ?? {};

const symbols = (await redis.hkeys("msh:price-pool:v1")).map(String);
console.log(`universe: ${symbols.length} symbols (msh:price-pool:v1)`);
const result = await warmPickersSec(symbols, (s) => REGISTRANTS[s] ?? null);
console.log(JSON.stringify(result));
console.log(`field count now: ${await redis.hlen("msh:pickers:sec-fundamentals:v1")}`);
process.exit(result.ok ? 0 : 1);
