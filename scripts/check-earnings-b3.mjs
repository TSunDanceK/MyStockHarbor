// B3: THE EARNINGS PAGE'S PRICES ON THE CHARTS GATE (#553 CODE-B table,
// #552 COWORK #108 item 2 / #112).
//
//   1. The reaction chart reads historyForSurface("CHARTS", …) with the old
//      windowed FMP read as its fallback, drops today's partial Tiingo bar, and
//      cuts the Tiingo series to the same window.
//   2. The valuation price: readSurfacePrice on Tiingo (labelled, and the FMP
//      read skipped), the last FMP bar otherwise; the card prints the label.
//   3. The title's price follows the same gate.
//   4. The linked credit shows whenever a figure on the page is Tiingo's.
//   5. Mutants: each rule broken once, and caught.
//
//   node scripts/check-earnings-b3.mjs
import fs from "node:fs";
import { stripComments } from "./lib/source-code.mjs";

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
const PAGE = "app/stock/[symbol]/earnings/page.tsx";
const CARD = "app/stock/[symbol]/earnings/SecEarningsCards.tsx";
const P = stripComments(fs.readFileSync(PAGE, "utf8"), { file: PAGE });
const C = stripComments(fs.readFileSync(CARD, "utf8"), { file: CARD });

const RULES = {
  "the reaction chart reads historyForSurface(\"CHARTS\") with the windowed FMP read as fallback":
    (p) => /historyForSurface\("CHARTS", symbol, \(\) =>\s*barWindow\s*\? getDailyBars\(symbol, barWindow\.from, barWindow\.to/.test(p),
  "today's partial bar is dropped and the series cut to the report window":
    (p) => /\.filter\(\(p\) => !p\.partial && \(!barWindow \|\| \(p\.date >= barWindow\.from && p\.date <= barWindow\.to\)\)\)/.test(p),
  "the reaction is computed on that series":
    (p) => /computeEarningsReactionDetail\(row, dailyHistory\)/.test(p),
  "on Tiingo the valuation price is readSurfacePrice's, and the FMP read is skipped":
    (p) => /onTiingo \? Promise\.resolve\(\[\] as Point\[\]\) : getDailyHistory\(symbol, \{ caller: "stock-earnings-valuation" \}\)/.test(p)
      && /onTiingo \? readSurfacePrice\(symbol\)/.test(p)
      && /const latestClose = onTiingo\s*\? surfacePrice\?\.price \?\? null/.test(p),
  "the price's own label reaches the card": (p, c) => /priceLabel=\{data\.latestPriceLabel\}/.test(p)
    && /\$\{priceLabel \?\? `close\$\{priceAsOf \? `, \$\{readableDate\(priceAsOf\)\}` : ""\}`\}/.test(c),
  "the title's price follows the gate": (p) => /historyForSurface\("CHARTS", clean, \(\) => getDailyHistory\(clean, \{ caller: "stock-earnings-meta" \}\)\)/.test(p),
  "the linked credit shows whenever a figure is Tiingo's":
    (p) => /const pricesFromTiingo = chartHistory\.provider === "tiingo" \|\| \(onTiingo && surfacePrice !== null\);/.test(p)
      && /\{data\.pricesFromTiingo \? \(\s*<p[^>]*>\s*Prices: <a href=\{TIINGO_URL\}[^>]*>\{TIINGO_CREDIT\}<\/a>/.test(p),
};
for (const [name, rule] of Object.entries(RULES)) check(name, rule(P, C));

const MUTANTS = [
  ["the reaction chart back on the bare FMP read", PAGE, "historyForSurface(\"CHARTS\", symbol, () =>", "((_f) => _f())(() =>"],
  ["the partial bar kept", PAGE, "!p.partial && ", ""],
  ["the FMP valuation read kept on Tiingo", PAGE, "onTiingo ? Promise.resolve([] as Point[]) : getDailyHistory(symbol", "getDailyHistory(symbol"],
  ["an IEX trade printed as a \"close\"", CARD, "${priceLabel ?? `close${priceAsOf ? `, ${readableDate(priceAsOf)}` : \"\"}`}", "close${priceAsOf ? `, ${readableDate(priceAsOf)}` : \"\"}"],
  ["the title off the gate", PAGE, "historyForSurface(\"CHARTS\", clean, () => getDailyHistory(clean, { caller: \"stock-earnings-meta\" }))", "getDailyHistory(clean, { caller: \"stock-earnings-meta\" }).then((p) => ({ points: p }))"],
  ["the credit only for the chart", PAGE, " || (onTiingo && surfacePrice !== null)", ""],
];
for (const [label, file, from, to] of MUTANTS) {
  const p = file === PAGE ? once(P, from, to) : P;
  const c = file === CARD ? once(C, from, to) : C;
  const broke = Object.values(RULES).some((r) => !r(p, c));
  check(`MUTATION: ${label} → caught`, broke);
}

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
