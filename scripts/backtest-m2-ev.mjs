// BACK-TEST M2 (#552 COWORK #93/#99): ENTERPRISE VALUE FROM THE DEBT AND CASH
// PARTS THAT ARE FILED. READ-ONLY; no SEC request; no FMP data.
//
// Pickers' EV = cap + short-term debt + long-term debt - cash, refused when any
// part is missing. M2 would treat a missing part as 0. Test: on rows where all
// three parts ARE filed, drop each missing-part pattern that refused rows
// actually have, and measure |EV_est / EV_true - 1|. The price is used inside
// the job only (through applySecPickerRow); printed: counts, patterns and error
// statistics, never a price, cap or EV.
//   relay task: write-backtest-m2-ev
import "./lib/register-ts-app.mjs";
import { Redis } from "@upstash/redis";

const P = await import("../lib/server/pickersSecFundamentals.ts");
const POOL = await import("../lib/server/pricePool.ts");
const redis = Redis.fromEnv();
const universe = ((await redis.hkeys(P.PICKERS_SEC_KEY)) ?? []).map((x) => String(x).toUpperCase());
const rows = await P.readSecPickerRows(universe);
const pool = await POOL.readPricePoolBulk(universe);

const PARTS = ["shortTermDebt", "longTermDebt", "cash"];
const patterns = {}; // missing-part pattern among rows with a cap but no EV
const complete = [];
for (const s of universe) {
  const row = rows.get(s);
  const price = pool.get(s)?.price ?? null;
  if (!row || typeof price !== "number" || !(price > 0)) continue;
  const f = P.applySecPickerRow(row, price);
  if (f.marketCap === null) continue;
  const bs = row.m.balanceSheet;
  const missing = PARTS.filter((k) => !bs || bs[k] === null);
  if (missing.length === 0) {
    if (f.enterpriseValue !== null && f.enterpriseValue > 0) complete.push({ s, cap: f.marketCap, bs, ev: f.enterpriseValue });
  } else {
    const key = missing.join("+");
    (patterns[key] ??= []).push(s);
  }
}
console.log(`Pickers rows with a market cap: EV shown ${complete.length} (all three parts filed, EV > 0); EV refused by missing parts:`);
for (const [k, v] of Object.entries(patterns).sort((a, b) => b[1].length - a[1].length)) console.log(`  missing ${k}: ${v.length}${v.length <= 25 ? `: ${v.join(" ")}` : ""}`);

const q = (a, p) => { const x = [...a].sort((m, n) => m - n); return x.length ? x[Math.min(x.length - 1, Math.floor(p * (x.length - 1)))] : null; };
const pct = (x) => (x === null ? "-" : `${(x * 100).toFixed(2)}%`);
console.log("\nM2 back-test on the complete rows: drop the pattern's parts (treated as 0), compare with the filed EV");
for (const key of Object.keys(patterns)) {
  const drop = key.split("+");
  const errs = complete.map(({ cap, bs, ev }) => {
    const v = (k) => (drop.includes(k) ? 0 : bs[k]);
    const est = cap + v("shortTermDebt") + v("longTermDebt") - v("cash");
    return Math.abs(est / ev - 1);
  });
  const within = errs.filter((e) => e <= 0.05).length / (errs.length || 1);
  console.log(`  missing ${key} (cells it could fill: ${patterns[key].length}): n ${errs.length}; median ${pct(q(errs, 0.5))}; p90 ${pct(q(errs, 0.9))}; within ±5% ${(within * 100).toFixed(1)}% -> ${within >= 0.9 ? "PASS" : "FAIL"}`);
}
console.log("\nRedis: HKEYS + HMGET + the pool bulk read, read-only. SEC requests: 0. No price, cap or EV printed.");
