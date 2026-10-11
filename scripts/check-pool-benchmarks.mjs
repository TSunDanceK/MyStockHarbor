// THE BENCHMARK ETFs ARE ALWAYS IN THE PRICE POOL (#553 COWORK #77/#78).
//
// SPY (C's SPX page, step 6) and QQQ/DIA/IWM (dashboard benchmarks, step 4)
// are in neither the Pickers universe nor the dynamic one, and the Tiingo
// quote and EOD jobs take their universe from the pool's fields. So:
//   1. the list holds SPY, QQQ, DIA and IWM;
//   2. the warm-price-pool route hands them to warmPricePool;
//   3. getWarmTargetSymbols does NOT (the fundamentals warms share it);
//   4. the Tiingo universe's filters keep them (not debt, not PRICE_EXCLUDED).
//   MUTANT: the route warms `symbols` alone. Caught.
//
//   node scripts/check-pool-benchmarks.mjs
import "./lib/register-capex-ts.mjs";
import { register } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
const ROOT = process.cwd();
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const imp = (f) => import(pathToFileURL(path.join(ROOT, f)).href);

const { POOL_BENCHMARK_ETFS, POOL_VIDEO_TICKERS } = await imp("lib/server/pricePool.ts");
check("the list is SPY, QQQ, DIA, IWM", JSON.stringify(POOL_BENCHMARK_ETFS) === '["SPY","QQQ","DIA","IWM"]', JSON.stringify(POOL_BENCHMARK_ETFS));

const routeRule = (code) =>
  /const poolSymbols = \[\.\.\.new Set\(\[\.\.\.symbols, \.\.\.POOL_BENCHMARK_ETFS, \.\.\.POOL_VIDEO_TICKERS\]\)\];/.test(code) &&
  /warmPricePool\(poolSymbols, /.test(code);
const route = readCodeOnly("app/api/jobs/warm-price-pool/route.ts");
check("warm-price-pool warms the Pickers/dynamic targets plus the ETFs", routeRule(route));
check("C's video-page tickers are ASTS, KRMN, LUNR, MOD, IFNNY (#553 COWORK #83)", JSON.stringify(POOL_VIDEO_TICKERS) === '["ASTS","KRMN","LUNR","MOD","IFNNY"]', JSON.stringify(POOL_VIDEO_TICKERS));
check("getWarmTargetSymbols does not carry them (the fundamentals warms share it)", !/POOL_BENCHMARK_ETFS/.test(readCodeOnly("lib/server/warmTargets.ts")));

const { isDebtListing } = await imp("lib/server/marketData/universe.ts");
const { isPriceExcluded } = await imp("lib/priceExcluded.mjs");
const dropped = [...POOL_BENCHMARK_ETFS, ...POOL_VIDEO_TICKERS].filter((s) => isDebtListing(s) || isPriceExcluded(s));
check("the Tiingo universe's filters keep every one", dropped.length === 0, dropped.join());

const mutant = route.replace("warmPricePool(poolSymbols, ", "warmPricePool(symbols, ");
check("mutant caught: the route warms `symbols` alone", mutant !== route && !routeRule(mutant));
const mutant2 = route.replace(", ...POOL_VIDEO_TICKERS]", "]");
check("mutant caught: the video tickers dropped from the warm", mutant2 !== route && !routeRule(mutant2));

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
