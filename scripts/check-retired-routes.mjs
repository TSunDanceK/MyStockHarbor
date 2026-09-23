// TWO RETIRED FMP ROUTES ARE GONE, NOT JUST UNFETCHED (#552, COWORK #1).
//
// /api/stock-analyst-rating/[symbol] (FMP price-target-consensus +
// grades-consensus) and /api/stock-valuation/[symbol] (eight FMP URLs) had no
// reader left on the page, but stayed publicly reachable and metered FMP calls
// for anyone who hit them. Replaces check-failure-is-expressible, whose subject
// was these two routes' status codes.
//
//   1. Neither route directory exists. MUTATION: a listing with the route back.
//   2. Nothing under app/ or lib/ fetches /api/stock-valuation.
//   3. The analyst-rating fetch is unreachable: the retired-block branch
//      returns before it. MUTATION: that return removed.
//   4. retiredBlocks.ts names the endpoints the route actually called.
//
//   node scripts/check-retired-routes.mjs
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const code = (p) => stripComments(read(p), { file: p });
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);

console.log("\n=== 1. The routes are deleted ===\n");
const ROUTES = ["app/api/stock-analyst-rating", "app/api/stock-valuation"];
const present = (files) => ROUTES.filter((r) => files.some((f) => f.startsWith(`${r}/`)));
const appFiles = walk("app");
check("neither route directory exists", present(appFiles).length === 0, present(appFiles).join(", "));
check("MUTATION: a route file put back is caught",
  present([...appFiles, "app/api/stock-valuation/[symbol]/route.ts"]).length === 1);

console.log("\n=== 2. Nothing fetches /api/stock-valuation ===\n");
{
  const src = [...walk("app"), ...walk("lib")].filter((f) => /\.(ts|tsx)$/.test(f));
  const callers = src.filter((f) => code(f).includes("/api/stock-valuation"));
  check("no caller in app/ or lib/", callers.length === 0, callers.join(", "));
}

console.log("\n=== 3. The analyst-rating fetch cannot run while the block is retired ===\n");
const CLIENT = "app/stock/[symbol]/StockSymbolPageClient.tsx";
const guarded = (text) => {
  const c = stripComments(text, { file: CLIENT });
  const g = c.indexOf('isRetiredBlock("analyst-ratings")');
  const f = c.indexOf("/api/stock-analyst-rating/");
  if (g < 0 || f < 0 || g > f) return false;
  // The retired branch must RETURN before the fetch's effect body continues.
  const branch = c.slice(g, c.indexOf("}", c.indexOf("{", g)) + 1);
  return /\breturn;/.test(branch);
};
{
  const client = read(CLIENT);
  check("the retired-block branch returns before the fetch", guarded(client));
  const from = "      setAnalystRating(null);\n      return;\n";
  check("MUTATION: without that return the fetch is reachable again",
    client.includes(from) && !guarded(client.replace(from, "      setAnalystRating(null);\n")));
}

console.log("\n=== 4. retiredBlocks.ts names the right endpoints ===\n");
{
  const rb = code("app/stock/[symbol]/retiredBlocks.ts");
  check("price-target-consensus and grades-consensus, not price-target-summary",
    /price-target-consensus/.test(rb) && /grades-consensus/.test(rb) && !/price-target-summary/.test(rb));
}

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
