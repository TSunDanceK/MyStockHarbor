// THE ADS MAP'S PREVIEW FIGURES, WITHOUT A PRICE (#552 COWORK #45). Reads only.
// For each named symbol: the committed map row (kind, ratio, source), and what
// the SHIPPED valuationInputs makes of the stored set with it — EPS per the
// traded unit and its period, shares in the traded unit and their as-of date,
// and every refusal (a stale EPS year, a share-basis change). SEC values only;
// no price is read or printed, so no P/E or market cap is computed here.
//   relay task: write-ads-preview-figures   Redis cost: 1 MGET.
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const V = await import("../lib/server/secValuation.ts");
const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const MAP = JSON.parse(fs.readFileSync("data/sec/ads-ratios.json", "utf8")).entries;
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const syms = (process.env.SYMBOLS || "AZN,TSM,ASML,SPOT,BABA").split(",").filter(Boolean);
const today = new Date().toISOString().slice(0, 10);
const sets = await redis.mget(...syms.map((s) => `${FACTS}:${s}`));
syms.forEach((s, j) => {
  const row = MAP[s];
  console.log(`\n== ${s}: map ${row ? `${row.kind} ${row.ordinaryPerAds} (${row.form} ${row.source} filed ${row.filed})` : "no row"}`);
  if (row) console.log(`   source line: "${row.evidence.slice(0, 220)}"`);
  const set = sets[j];
  if (!set) { console.log("   no stored set"); return; }
  console.log(`   stored cover: ${JSON.stringify(set.cover)} cur ${set.cur ?? "USD"}`);
  const ads = row ? { kind: row.kind, ordinaryPerAds: row.ordinaryPerAds } : undefined;
  const v = V.valuationInputs(set, today, { annualForm: REG[s]?.annualForm ?? null, ads });
  console.log(`   eps: ${v.eps ? `${v.eps.val} (${v.eps.basis}${v.eps.fiscalYear ? ` FY${v.eps.fiscalYear}` : ""}, to ${v.eps.periodEnd}${v.eps.adsRatio ? `, per ADS x${v.eps.adsRatio}` : ""})` : "none"}`);
  console.log(`   shares: ${v.shares ? `${v.shares.val} as of ${v.shares.asOf}${v.shares.adsRatio ? ` (ADS-equivalent, ordinary / ${v.shares.adsRatio})` : ""}` : "none"}`);
  if (v.staleEpsEnd) console.log(`   stale EPS withheld: period ended ${v.staleEpsEnd}`);
  console.log(`   refusals: ${v.refusals.length ? v.refusals.join(", ") : "none"}`);
  const pe = V.peRatio(v, 1);
  console.log(`   P/E wording with any price: ${pe && !pe.ok ? `refused ${pe.why}${pe.detail ? ` — ${pe.detail}` : ""}` : "computed (price / EPS above)"}`);
});
console.log("\nRedis commands: 1");
