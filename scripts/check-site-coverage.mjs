// THE SITE'S COVERAGE LINE (lib/server/siteCoverage.ts), said on /stocks,
// /about and the homepage description:
//   ROUND DOWN  hedgedCount only ever understates: "over" when rounding
//               dropped something, "about" when it did not.
//   LISTED      the stock-page count is exchange-listed tickers only (no OTC,
//               no venue-less rows), read from the committed SEC file.
//   NO NUMBER   an unreadable count drops its number, never a typed-in one.
//   FITS        the short form stays under 160 characters.
//   NOT TYPED   no page carries the counts as literals.
// plus a mutation: rounding to nearest instead of down is caught.
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
let seq = 0;
async function mutated(rel, from, to) {
  const abs = path.join(ROOT, rel);
  const src = fs.readFileSync(abs, "utf8");
  if (src.split(from).length !== 2) throw new Error(`mutation anchor not found once: ${from.slice(0, 60)}`);
  const tmp = abs.replace(/\.ts$/, `.__mut${process.pid}_${seq++}.ts`);
  fs.writeFileSync(tmp, src.replace(from, to));
  try { return await import(pathToFileURL(tmp).href); } finally { fs.rmSync(tmp, { force: true }); }
}
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const S = await imp("lib/siteCoverageText.ts");
const T = await imp("lib/server/secTickerMap.ts");

console.log("ROUND DOWN");
for (const [n, want] of [[7710, "over 7,000"], [7000, "about 7,000"], [1000, "about 1,000"], [984, "over 900"], [2646, "over 2,000"], [50, "about 50"]]) {
  check(`hedgedCount(${n}) = "${want}"`, S.hedgedCount(n) === want, S.hedgedCount(n));
}
const M = await mutated("lib/siteCoverageText.ts", "  const floored = Math.floor(n / step) * step;", "  const floored = Math.round(n / step) * step;");
check("mutant (round to nearest) is caught", M.hedgedCount(7710) !== "over 7,000", M.hedgedCount(7710));

console.log("LISTED");
check("OTC and venue-less rows are not counted", S.listedTickerCount([{ exchange: "Nasdaq" }, { exchange: "NYSE" }, { exchange: "CBOE" }, { exchange: "OTC" }, { exchange: null }]) === 3);
const live = T.loadTickerMap();
const listed = S.listedTickerCount(live.map.values());
check("the committed SEC file loads and counts thousands of listed tickers", live.present && listed >= 2000, `${listed} of ${live.count}`);

console.log("NO NUMBER");
const blank = S.coverageLine({ stockPages: null, pickers: null });
check("unreadable counts leave no digits in the line", !/\d/.test(blank), blank);
check("...and still name EDGAR earnings pages", /SEC EDGAR filings for US-listed filers/.test(blank));
check("the short form defers to the page's own description when a count is missing", S.coverageDescription({ stockPages: 7710, pickers: null }) === null);
const full = S.coverageLine({ stockPages: 7710, pickers: 1000 });
check("full line: over 7,000 / about 1,000", /over 7,000 stock analysis pages/.test(full) && /about 1,000 stocks in the pickers and screeners/.test(full), full);

console.log("FITS");
const longest = S.coverageDescription({ stockPages: 99_999, pickers: 9_999 });
check("the short form is under 160 characters even at five-figure counts", longest !== null && longest.length < 160, `${longest?.length}`);

console.log("NOT TYPED");
for (const f of ["app/stocks/page.tsx", "app/about/page.tsx", "app/page.tsx"]) {
  const src = fs.readFileSync(path.join(ROOT, f), "utf8");
  check(`${f}: no typed-in coverage count`, !/\b(7,000|1,000 stocks|about 1,000|over 7,000)\b/.test(src));
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
