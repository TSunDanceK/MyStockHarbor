// NO POOL PRICE IN THE CACHED CALENDAR DAY (#552 COWORK #113).
//
// With PRICE_PROVIDER_POOL=tiingo the pool read carries Tiingo's price, and the
// day blob (msh:earnings-day-items:v2:<date>, 3+ day TTL) sits outside
// msh:tiingo:, where the Tiingo clean-up can't reach it. So:
//   1. stripPoolPrices: a "covered" (pool-priced) row is stored with no price
//      and no market cap; an FMP-quoted row keeps both.
//   2. writeDayItemsCache stores stripPoolPrices(items), and it is the only
//      writer of the day key.
//   3. Every serve path re-reads the pool: the cached day, Show more
//      (getCachedDayItems) and the sector panels (one batched overlay).
//   4. Mutants: each rule broken once, and caught.
//
//   node scripts/check-calendar-pool-price.mjs
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift, grabFunction } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (src, from, to) => {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`mutation anchor matched ${n} times: ${from.slice(0, 60)}`);
  return src.replace(from, to);
};

const CAL = "lib/server/earningsCalendar.ts";
const SRC = readCodeOnly(CAL);
const SECTOR = readCodeOnly("lib/server/sectorPanels.ts");

console.log("1. stripPoolPrices");
const load = (src) => lift([grabFunction(src, "stripPoolPrices"), "export { stripPoolPrices };"].join("\n"));
const M = await load(SRC);
const rows = [
  { symbol: "AAPL", price: 230, marketCap: 3.4e12, priceCoverage: "covered" },
  { symbol: "TINY", price: 4.1, marketCap: 2e8, priceCoverage: "outside-bar-universe" },
];
const out = M.stripPoolPrices(rows);
check("a pool-priced row is stored with no price and no cap", out[0].price === null && out[0].marketCap === null && out[0].symbol === "AAPL");
check("an FMP-quoted row keeps both", out[1].price === 4.1 && out[1].marketCap === 2e8);
check("the input is not mutated", rows[0].price === 230);
{
  const Mm = await load(once(SRC, 'it.priceCoverage === "covered" ? { ...it, price: null, marketCap: null } : it', "it"));
  check("MUTATION: the strip removed → caught", Mm.stripPoolPrices(rows)[0].price === 230);
}

console.log("\n2. the only writer stores the stripped rows");
const writeRule = (s) => /redis\.set\(`\$\{DAY_ITEMS_PREFIX\}:\$\{date\}`, stripPoolPrices\(items\),/.test(s)
  && (s.match(/\$\{DAY_ITEMS_PREFIX\}:\$\{date\}`/g) ?? []).length === 2; // one get, one set
check("writeDayItemsCache stores stripPoolPrices(items), and nothing else writes the day key", writeRule(SRC));
check("MUTATION: the raw rows stored → caught", !writeRule(once(SRC, "stripPoolPrices(items), {", "items, {")));

console.log("\n3. every serve re-reads the pool");
const serveRules = (s, sector) => [
  /items: await withLivePoolPrices\(cleaned\),/.test(s),
  /return opts\.livePrices === false \? dedupeAndSortItems\(items\) : withLivePoolPrices\(items\);/.test(s),
  /getCachedDayItems\(date, \{ livePrices: false \}\)/.test(sector) && /days\.flat\(\)\.filter\(\(it\) => constituentSet\.has\(/.test(sector) && /await overlayLivePoolPrices\(mine\)/.test(sector),
  /pool = await readPricePoolBulk\(want\);/.test(s),
];
check("the cached day, Show more and the sector panels (one batched read) all overlay live pool prices", serveRules(SRC, SECTOR).every(Boolean), serveRules(SRC, SECTOR).join());
check("MUTATION: the cached day served from the blob as stored → caught",
  !serveRules(once(SRC, "items: await withLivePoolPrices(cleaned),", "items: cleaned,"), SECTOR).every(Boolean));
check("MUTATION: the sector panels overlay every calendar row, not just the sector's → caught",
  !serveRules(SRC, once(SECTOR, "const live = await overlayLivePoolPrices(mine)", "const live = await overlayLivePoolPrices(days.flat())")).every(Boolean));
check("MUTATION: the sector panels read the pool per date → caught",
  !serveRules(SRC, once(SECTOR, "getCachedDayItems(date, { livePrices: false })", "getCachedDayItems(date)")).every(Boolean));

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
