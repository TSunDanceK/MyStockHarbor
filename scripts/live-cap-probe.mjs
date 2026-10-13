// A SYMBOL'S LIVE MARKET CAP, AS THE STOCK PAGE COMPUTES IT (#552 COWORK #223/#224:
// V after #873, ONC after #877). READS ONLY, despite the write- task prefix (the
// store read needs the credential): per symbol 1 GET (the stored fact set), the
// shipped readSurfacePrice (the Tiingo pool and the symbol's EOD history) and 1
// HGET (its Pickers SEC row). The shipped valuationInputs + marketCap with the
// filer facts the earnings snapshot passes.
//
// ACTIONS LOGS ARE PUBLIC, AND TIINGO DATA IN A LOG IS DISTRIBUTION (contract
// §5.3): the PRICE IS NEVER PRINTED, only its kind and date, and the market cap
// the site itself publishes.
//   relay task: write-live-cap-probe   SYMBOLS="V"
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const V = await import("../lib/server/secValuation.ts");
const { adsRatioFor, adsListedUnrated } = await import("../lib/server/secAdsMap.ts");
const { readSurfacePrice } = await import("../lib/server/tiingoSurfacePrice.ts");
const { nonEquityListingOf, citedCoverFor } = await import("../lib/server/secPrimaryListing.ts");
const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const PICKERS = keyOf("lib/server/pickersSecFundamentals.ts", "PICKERS_SEC_KEY");
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const TODAY = new Date().toISOString().slice(0, 10);
const obj = (x) => (typeof x === "string" ? JSON.parse(x) : x);
let commands = 0;
for (const s of (process.env.SYMBOLS || "V").split(/[,\s]+/).filter(Boolean)) {
  const set = await redis.get(`${FACTS}:${s}`); commands++;
  const surface = await readSurfacePrice(s); commands += 2;
  const pick = obj(await redis.hget(PICKERS, s)); commands++;
  console.log(`\n== ${s}`);
  if (!set) { console.log("  no stored set"); continue; }
  console.log(`  stored set: extracted ${new Date(set.at).toISOString().slice(0, 19)}Z; cover ${set.cover?.val ?? null} as of ${set.cover?.asOf ?? null} (${set.cover?.derived ?? "-"}); te ${set.te ? `${set.te.val} to ${set.te.periodEnd}` : "none"}`);
  const inputs = V.valuationInputs(set, TODAY, { annualForm: REG[s]?.annualForm ?? null, ads: adsRatioFor(s), nonEquity: nonEquityListingOf(s), citedCover: citedCoverFor(s), sic: REG[s]?.sic ?? null, adsUnrated: adsListedUnrated(s) });
  console.log(`  valuationInputs: shares ${inputs.shares ? `${inputs.shares.val} as of ${inputs.shares.asOf}` : "null"}; refusals ${JSON.stringify(inputs.refusals)}`);
  const price = surface?.price ?? null;
  console.log(`  price: ${surface ? `${surface.kind}, ${surface.date} (the figure is not printed: Tiingo, contract §5.3)` : "none"}`);
  const cap = V.marketCap(inputs, price);
  console.log(`  marketCap: ${cap?.ok ? `$${(cap.val / 1e9).toFixed(2)}B` : JSON.stringify(cap)}`);
  const pe = V.peRatio(inputs, price);
  console.log(`  P/E: ${pe?.ok ? pe.val.toFixed(1) : JSON.stringify(pe)}; shares basis: ${V.sharesBasisWords?.(inputs.shares) ?? "-"}`);
  console.log(`  Pickers SEC row: ${pick ? `at ${pick.at ?? pick.updatedAt ?? "?"}; inputs.shares ${JSON.stringify(pick.inputs?.shares ?? null)}; refusals ${JSON.stringify(pick.inputs?.refusals ?? null)}` : "none"}`);
}
console.log(`\nRedis commands used by this read: ${commands}`);
