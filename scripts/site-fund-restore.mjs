// THE TEN SELECT SECTOR FUNDS THE SEC-LISTING SWEEP EVICTED (#552 COWORK #233 S0).
//
// XLK, XLF, XLE, XLB, XLC, XLP, XLI, XLY, XLV and XLU are series of one trust,
// so SEC's ticker file has no row for them; the sweep read that as a delisting,
// evicted them and tombstoned them for 21 trading days. The exemption in
// secListing.ts stops it happening again. This puts them back:
//
//   1. ZREM their tombstones (msh:evict:log:v1), so the re-admission gate no
//      longer holds them back.
//   2. Price and history today come from Tiingo (PRICE_PROVIDER_*=tiingo), not
//      the FMP-era price-pool row or msh:history:v7 that evictSymbol deleted:
//      the quote and EOD jobs fetch every symbol with a stock page, the funds
//      included. Any fund whose Tiingo EOD key is missing is put on the cold
//      queue (ZADD NX), which the tiingo-cold-queue job drains with 1 Tiingo
//      request each. No Tiingo call from here: this job holds no Tiingo key.
//
// Reports every fund's state before and after. `--apply` writes; without it
// nothing is written.
//
//   relay task: write-site-fund-restore-dry / write-site-fund-restore (owner's GO)
//   Redis: reads 1 ZMSCORE + 1 ZMSCORE + 3 HMGET + 1 GET + 2 EXISTS pipelines
//   (~20 commands); apply adds 1 ZREM + at most 1 ZADD, then the reads again.
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const apply = process.argv.includes("--apply");
const FUNDS = ["XLK", "XLF", "XLE", "XLB", "XLC", "XLP", "XLI", "XLY", "XLV", "XLU"];

// Key names read from the source, so a renamed key fails here rather than
// silently reading nothing.
const grab = (file, re) => {
  const m = fs.readFileSync(file, "utf8").match(re);
  if (!m) throw new Error(`key not found in ${file}: ${re}`);
  return m[1];
};
const EVICTED = grab("lib/server/symbolEviction.ts", /const EVICTED_KEY = "([^"]+)"/);
const SCORE = grab("lib/server/dynamicUniverseCache.ts", /const SCORE_KEY = "([^"]+)"/);
const POOL = grab("lib/server/pricePool.ts", /export const PRICE_POOL_KEY = "([^"]+)"/);
const STAMPS = grab("lib/server/historyCache.ts", /const NEWEST_BAR_STAMP_HASH = "([^"]+)"/);
const HISTORY = grab("lib/server/historyCache.ts", /const REDIS_HISTORY_PREFIX = "([^"]+)"/);
const T = "msh:tiingo:";
if (grab("lib/server/marketData/keys.ts", /export const TIINGO_PREFIX = "([^"]+)"/) !== T) throw new Error("TIINGO_PREFIX moved");
const QUOTES = `${T}quotes:v1`;
const EOD_LAST = `${T}eod-last:v1`;
const UNIVERSE = `${T}universe:v1`;
const COLD_QUEUE = `${T}cold-queue:v1`;
const eodKey = (s) => `${T}eod:v2:${s}`;
for (const [name, k] of [["QUOTES", "quotes:v1"], ["EOD_LAST", "eod-last:v1"], ["UNIVERSE", "universe:v1"], ["COLD_QUEUE", "cold-queue:v1"], ["eod", "eod:v2:"]]) {
  if (!fs.readFileSync("lib/server/marketData/keys.ts", "utf8").includes(`\${TIINGO_PREFIX}${k}`)) throw new Error(`${name} key moved`);
}

const redis = Redis.fromEnv();
let commands = 0;

async function state() {
  const p = redis.pipeline();
  p.zmscore(EVICTED, FUNDS);
  p.zmscore(SCORE, FUNDS);
  p.hmget(POOL, ...FUNDS);
  p.hmget(QUOTES, ...FUNDS);
  p.hmget(EOD_LAST, ...FUNDS);
  p.hmget(STAMPS, ...FUNDS);
  p.get(UNIVERSE);
  p.zmscore(COLD_QUEUE, FUNDS);
  for (const s of FUNDS) p.exists(eodKey(s));
  for (const s of FUNDS) p.exists(`${HISTORY}:${s}`);
  const r = await p.exec();
  commands += 8 + FUNDS.length * 2;
  const field = (v, i) => (Array.isArray(v) ? v[i] : v && typeof v === "object" ? v[FUNDS[i]] : null);
  const uni = (() => {
    const raw = r[6];
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return new Set(Array.isArray(v?.symbols) ? v.symbols : []);
  })();
  return FUNDS.map((s, i) => {
    const tomb = field(r[0], i);
    const quote = field(r[3], i);
    const last = field(r[4], i);
    const q = typeof quote === "string" ? JSON.parse(quote) : quote;
    const l = typeof last === "string" ? JSON.parse(last) : last;
    return {
      s,
      tombstone: tomb == null ? "none" : new Date(Number(tomb)).toISOString().slice(0, 10),
      dynScore: field(r[1], i) ?? "absent",
      poolRow: field(r[2], i) ? "yes" : "no",
      tiingoUniverse: uni.has(s) ? "yes" : "no",
      // Presence and dates only: no price is printed to a public log.
      quote: q ? "yes" : "no",
      eodLast: l ? String(l.d ?? "yes") : "no",
      eodKey: Number(r[8 + i]) ? "yes" : "no",
      historyV7: Number(r[8 + FUNDS.length + i]) ? "yes" : "no",
      stamp: field(r[5], i) ? "yes" : "no",
      coldQueued: field(r[7], i) == null ? "no" : "yes",
    };
  });
}

const print = (label, rows) => {
  console.log(`── ${label}`);
  for (const r of rows) console.log(`FUND ${Object.entries(r).map(([k, v]) => `${k}=${v}`).join(" ")}`);
};

const before = await state();
print("before", before);
const tombed = before.filter((r) => r.tombstone !== "none").map((r) => r.s);
const noEod = before.filter((r) => r.eodKey === "no" && r.coldQueued === "no").map((r) => r.s);
console.log(`plan: ZREM tombstones ${tombed.join(",") || "-"}; cold-queue ${noEod.join(",") || "-"}${apply ? "" : " (dry)"}`);

if (apply) {
  if (tombed.length) { await redis.zrem(EVICTED, ...tombed); commands++; }
  if (noEod.length) {
    const now = Date.now();
    await redis.zadd(COLD_QUEUE, { nx: true }, ...noEod.map((member) => ({ score: now, member })));
    commands++;
  }
  print("after", await state());
}
console.log(`Redis commands: ${commands}`);
