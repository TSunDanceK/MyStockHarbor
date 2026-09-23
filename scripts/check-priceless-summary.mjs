// A SYMBOL WITH NO PRICE IS SAID TO HAVE NONE — not "an unavailable latest price".
//
// COWORK #2 item 5 (#535, 2026-09-23): with no quote, the stock page's summary
// read "The latest available price is an unavailable latest price". The shipped
// buildLongSummary is lifted and run with quote=null and with a price, on both
// of its sentence branches (trend checks known / not known).
import fs from "node:fs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const SRC = fs.readFileSync("app/stock/[symbol]/StockSymbolPageClient.tsx", "utf8");
const load = (mutate = (s) => s) => lift(mutate(
  [grabFunction(SRC, "pctFromBase"), grabFunction(SRC, "buildLongSummary")].join("\n")
) + "\nexport { buildLongSummary };");

const base = { symbol: "BRK.B", companyName: "Berkshire Hathaway", lastClose: null, ma50: null, ma200: null, trend: null, rsi: null };
const text = (M, quote, known) => {
  const out = M.buildLongSummary({ ...base, quote, trendScore: { passed: 2, total: 3, known } });
  return typeof out === "string" ? out : JSON.stringify(out);
};

const M = await load();
for (const known of [true, false]) {
  const none = text(M, null, known);
  check(`no price (checks ${known ? "known" : "not run"}): says no current price is available`,
    none.includes("No current price is available, and"), none.slice(0, 300));
  check(`no price (checks ${known ? "known" : "not run"}): never "an unavailable latest price"`,
    !/unavailable latest price/.test(none) && !/latest available price is/.test(none));
  const priced = text(M, { price: 503.55 }, known);
  check(`with a price (checks ${known ? "known" : "not run"}): the price sentence is unchanged`,
    priced.includes("The latest available price is $503.55, and"), priced.slice(0, 300));
}
const old = await load((s) => s.replace('"No current price is available"', '"The latest available price is an unavailable latest price"'));
check("MUTATION: the old phrase back is caught", /unavailable latest price/.test(text(old, null, true)));

console.log(failures ? `\n${failures} assertion(s) failed.\n` : "\nA priceless symbol is said to have no price.\n");
process.exit(failures ? 1 : 0);
