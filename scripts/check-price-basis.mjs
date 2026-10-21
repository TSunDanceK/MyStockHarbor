// THE EARNINGS PAGE'S ONE PRICE AND ITS LABEL (audit r3 item 5).
//
//   1. The words: "Price: close, 20 Oct 2026" / "Price: last trade 14:05 ET",
//      and a trade with no stated time is dated, never called a close.
//   2. earningsPrice: on Tiingo, pickSurfacePrice's pick with its kind and ET
//      time; off Tiingo, the newest FMP bar as a close; nothing on a miss.
//   3. pickSurfacePrice carries the print's own ET time.
//   4. The card prints the label and the hedge; the title stays on the last
//      completed close with no label (owner ruling).
//   5. Mutants, caught.
//
//   node scripts/check-price-basis.mjs
import { register } from "node:module";
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";

register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

const ROOT = process.cwd();
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const B = await imp("lib/priceBasis.ts");
const E = await imp("lib/server/earningsPrice.ts");
const S = await imp("lib/server/tiingoSurfacePrice.ts");

console.log("1. the words");
check("a close: Price: close, 20 Oct 2026", B.priceBasisLabel({ kind: "close", date: "2026-10-20", time: null }) === "Price: close, 20 Oct 2026");
check("a trade: Price: last trade 14:05 ET", B.priceBasisLabel({ kind: "trade", date: "2026-10-21", time: "14:05" }) === "Price: last trade 14:05 ET");
check("a trade with no time is dated, not called a close", B.priceBasisWords({ kind: "trade", date: "2026-10-21", time: null }) === "last trade, 21 Oct 2026");
check("the hedge names the single exchange, the lag, and the title's close",
  /single exchange \(IEX\)/.test(B.PRICE_BASIS_NOTE) && /may lag/.test(B.PRICE_BASIS_NOTE) && /title shows the last completed close/.test(B.PRICE_BASIS_NOTE));

console.log("\n2. earningsPrice");
const iex = { price: 103, kind: "iex", date: "2026-10-21", time: "14:05", label: "today so far (IEX, 14:05 ET)" };
const close = { price: 101, kind: "close", date: "2026-10-20", time: null, label: "close, 20 Oct 2026" };
const a = E.earningsPrice(true, iex, null);
check("on Tiingo, an IEX pick is a timed trade", a?.price === 103 && a.basis.kind === "trade" && a.basis.time === "14:05" && a.basis.date === "2026-10-21", JSON.stringify(a));
const b = E.earningsPrice(true, close, { date: "2026-10-19", close: 99 });
check("on Tiingo, a close pick is the close (the FMP bar is not read)", b?.price === 101 && b.basis.kind === "close" && b.basis.date === "2026-10-20");
check("on Tiingo, no pick is no price", E.earningsPrice(true, null, { date: "2026-10-19", close: 99 }) === null);
const c = E.earningsPrice(false, iex, { date: "2026-10-20", close: 100.5 });
check("off Tiingo, the newest FMP bar as a close", c?.price === 100.5 && c.basis.kind === "close" && c.basis.date === "2026-10-20");
check("off Tiingo, no bar is no price", E.earningsPrice(false, null, null) === null);

console.log("\n3. pickSurfacePrice carries the print's ET time");
const et = (day, hh, mm) => Date.UTC(2026, 9, day, hh + 4, mm); // EDT
const bars = [["2026-10-20", 100, 102, 99, 101, 1000]];
const live = S.pickSurfacePrice({ price: 103, open: 101, high: 104, low: 100, prevClose: 101, at: et(21, 14, 5) }, bars, et(21, 14, 10));
check("a session print: kind iex, time 14:05", live?.kind === "iex" && live.time === "14:05", JSON.stringify(live));
const done = S.pickSurfacePrice(null, bars, et(21, 14, 10));
check("a close: time null", done?.kind === "close" && done.time === null);

console.log("\n4. the card is labelled; the title is not");
const PAGE = "app/stock/[symbol]/earnings/page.tsx", CARD = "app/stock/[symbol]/earnings/SecEarningsCards.tsx";
const P = stripComments(fs.readFileSync(PAGE, "utf8"), { file: PAGE });
const C = stripComments(fs.readFileSync(CARD, "utf8"), { file: CARD });
const RULES = {
  "the card prints the label beside the price": (p, c) => /\{priceBasisLabel\(basis\)\} · \$\{price\.toFixed\(2\)\}/.test(c),
  "the card prints the hedge": (p, c) => /<p>\{PRICE_BASIS_NOTE\}<\/p>/.test(c),
  "the title stays on the last close and prints no basis words": (p) =>
    /const priceStr = seed\.lastClose != null \? ` — Price \$\$\{seed\.lastClose\.toFixed\(2\)\}` : "";/.test(p) && !/priceBasisWords/.test(p),
  "the card's price goes through earningsPrice": (p) => /earningsPrice\(onTiingo, surfacePrice, lastBar\)/.test(p),
};
for (const [name, rule] of Object.entries(RULES)) check(name, rule(P, C));

console.log("\n5. mutants");
const once = (src, from, to) => {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`mutation anchor matched ${n} times: ${from.slice(0, 60)}`);
  return src.replace(from, to);
};
const MUTANTS = [
  ["the label dropped from the card", CARD, "{priceBasisLabel(basis)} · ${price.toFixed(2)}", "${price.toFixed(2)}"],
  ["the hedge dropped", CARD, "<p>{PRICE_BASIS_NOTE}</p>", ""],
  ["the card off earningsPrice", PAGE, "earningsPrice(onTiingo, surfacePrice, lastBar)", "earningsPrice(false, null, lastBar)"],
];
for (const [label, file, from, to] of MUTANTS) {
  const p = file === PAGE ? once(P, from, to) : P;
  const c = file === CARD ? once(C, from, to) : C;
  check(`MUTATION: ${label} → caught`, Object.values(RULES).some((r) => !r(p, c)));
}
{
  const src = fs.readFileSync("lib/server/earningsPrice.ts", "utf8");
  const mut = once(src, 'kind: surface.kind === "iex" ? "trade" : "close"', 'kind: "close"');
  const tmp = "lib/server/.earningsPrice.mut.ts";
  fs.writeFileSync(tmp, mut);
  try {
    const M = await imp(tmp);
    check("MUTATION: an IEX trade labelled a close → caught", M.earningsPrice(true, iex, null)?.basis.kind !== "trade");
  } finally { fs.rmSync(tmp, { force: true }); }
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
