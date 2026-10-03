// HOW SMALL IS BOOK EQUITY BESIDE MARKET CAP, ACROSS PICKERS (#552 COWORK
// #86b, ruled in by COWORK #92 Q1). Sizes the "P/B not meaningful" threshold
// (GDDY's P/B 1,813: tiny positive equity, arithmetically right, meaningless).
//
// COUNTS ONLY. The price is used internally, through Pickers' own
// applySecPickerRow, so the census counts exactly the P/B figures the page
// would show. No price, cap, equity or ratio is printed: only bucket sizes and
// the tickers in the buckets a threshold would refuse. SEC reads: none.
//
//   relay task: write-pb-equity-cap-census
//   Redis: 1 GET (universe; +1 payload GET if the symbol key has lapsed) + 1 HMGET (stored rows) + the pool bulk read,
//   read-only.
import "./lib/register-ts-app.mjs";
import { Redis } from "@upstash/redis";

const P = await import("../lib/server/pickersSecFundamentals.ts");
const B = await import("../lib/server/pickersBuilder.ts");
const POOL = await import("../lib/server/pricePool.ts");
const redis = Redis.fromEnv();
let commands = 0;

// The builder's own reader: the symbol key has a 3 h TTL, and the reader falls
// back to the payload when it has lapsed (the first run read an empty key).
const list = (await B.readPickersSymbolsIfCached()) ?? []; commands++;
const universe = [...new Set(list.map((x) => String(typeof x === "string" ? x : x?.symbol ?? "").toUpperCase()).filter(Boolean))];
const rows = await P.readSecPickerRows(universe); commands++;
const pool = await POOL.readPricePoolBulk(universe); commands++;

// equity / cap, as P/B's inverse: equity < t of cap  <=>  P/B > 1/t.
const THRESHOLDS = [
  ["<0.5%", 200],
  ["<1%", 100],
  ["<2%", 50],
  ["<5%", 20],
];
let withRow = 0, priced = 0, pbShown = 0;
const refusedNow = {};
const hit = Object.fromEntries(THRESHOLDS.map(([k]) => [k, []]));
for (const s of universe) {
  const row = rows.get(s);
  if (!row) continue;
  withRow++;
  const price = pool.get(s)?.price ?? null;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) continue;
  priced++;
  const f = P.applySecPickerRow(row, price);
  if (f.pbRatio === null) {
    const bs = row.m.balanceSheet;
    const why = !bs || bs.equity === null ? "no-equity" : bs.equity <= 0 ? "equity<=0" : f.marketCap === null ? "no-cap" : "non-usd-or-other";
    refusedNow[why] = (refusedNow[why] ?? 0) + 1;
    continue;
  }
  pbShown++;
  for (const [k, pb] of THRESHOLDS) if (f.pbRatio > pb) hit[k].push(s);
}

console.log(`Pickers universe ${universe.length}; stored rows ${withRow}; priced ${priced}; P/B shown today ${pbShown}`);
console.log(`P/B not shown today (priced rows): ${Object.entries(refusedNow).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);
console.log("Would be refused as 'not meaningful' at each threshold (book equity under X of market cap):");
for (const [k] of THRESHOLDS) console.log(`  equity ${k} of cap: ${hit[k].length}${hit[k].length ? `  ${hit[k].join(" ")}` : ""}`);
console.log(`Redis commands: ${commands} (read-only). SEC requests: 0. No price, cap, equity or ratio printed.`);
