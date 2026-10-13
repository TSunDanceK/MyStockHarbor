// THE PRE-MARKET PRICE IS NOT A CLOSE (#553 COWORK #222, the 13 Oct audit).
//
// The audit saw /stock pages show an 08:2x ET IEX print as "the close on Mon 12
// Oct", beside Monday's day range ("day high 0.26% below the last price") and
// Friday's close as "Prev close". The rule now (lib/ta/sessionBar.ts
// sessionPrint / regularSessionTime): an IEX print counts only when it was sold
// in today's regular session, 09:30–16:00 ET. Run on the REAL modules, at four
// times on a fixture (Fri 9 Oct, Mon 12 Oct stored; Tue 13 Oct prints):
//
//   08:20 ET Tue   pre-market print  -> Monday's close, "close, 12 Oct 2026";
//                                       no partial bar; Key levels on Monday
//   11:00 ET Tue   a 10:55 print     -> "today so far (IEX, 10:55 ET)"; prev close
//                                       Monday's; day high/low today's (the
//                                       partial bar), never Monday's
//   16:30 ET Tue   a 16:00 print     -> "today's last IEX trade, 16:00 ET"
//                  a 16:25 print     -> refused (after hours): Monday's close
//   Sat 17 Oct     Friday's bars, an after-hours Friday print -> Friday's close
//
// At every time: the price shown sits inside the day range Key levels draws it
// against (no "above the day high" / "below the day low"), and the real
// buildTiingoQuote / buildTiingoHistoryPoints agree with the primitives.
// Mutants: the old "newer wins" swap, and the ungated partial bar, each fail.
//
//   node scripts/check-premarket-price.mjs
import { register } from "node:module";
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

const ROOT = process.cwd();
const SURFACE = "lib/server/tiingoSurfacePrice.ts", MERGE = "lib/server/marketData/merge.ts";
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const S = await imp(SURFACE);
const M = await imp(MERGE);
const K = await imp("lib/ta/keyLevels.ts");
const Q = await imp("lib/server/tiingoQuote.ts");
const H = await imp("lib/server/tiingoHistory.ts");
const SB = await imp("lib/ta/sessionBar.ts");

// [date, open, high, low, close, volume]
const filler = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 7, 3 + i));
  return [d.toISOString().slice(0, 10), 95, 97, 93, 96, 1000];
}).filter((b) => ![0, 6].includes(new Date(`${b[0]}T00:00:00Z`).getUTCDay()));
const FRI = ["2026-10-09", 98, 100, 97, 99, 1000];
const MON = ["2026-10-12", 100, 102, 98, 101, 1000];
const BARS = [...filler, FRI, MON];
const FRI16 = ["2026-10-16", 104, 106, 103, 105, 1000];
const BARS_TO_FRI16 = [...BARS, ["2026-10-13", 101, 104, 100, 103, 1000], ["2026-10-14", 103, 104, 102, 103, 1000], ["2026-10-15", 103, 105, 102, 104, 1000], FRI16];

// EDT: ET = UTC − 4.
const et = (day, hh, mm) => Date.UTC(2026, 9, day, hh + 4, mm);
const row = (at, price, extra = {}) => ({ price, open: null, high: null, low: null, prevClose: 101, at, ...extra });

const CASES = [
  { name: "08:20 ET Tue, a pre-market print", now: et(13, 8, 20), bars: BARS, row: row(et(13, 8, 18), 104.5),
    want: { kind: "close", price: 101, label: "close, 12 Oct 2026", partial: false, day: "2026-10-12" } },
  { name: "11:00 ET Tue, a 10:55 session print", now: et(13, 11, 0), bars: BARS, row: row(et(13, 10, 55), 103, { open: 101.5, high: 104, low: 100.5 }),
    want: { kind: "iex", price: 103, label: "today so far (IEX, 10:55 ET)", partial: true, day: "2026-10-13", prev: 101 } },
  { name: "16:30 ET Tue, the 16:00 session print", now: et(13, 16, 30), bars: BARS, row: row(et(13, 16, 0), 102.5, { open: 101.5, high: 104, low: 100.5 }),
    want: { kind: "iex", price: 102.5, label: "today's last IEX trade, 16:00 ET", partial: true, day: "2026-10-13", prev: 101 } },
  { name: "16:30 ET Tue, a 16:25 after-hours print", now: et(13, 16, 30), bars: BARS, row: row(et(13, 16, 25), 99.2),
    want: { kind: "close", price: 101, label: "close, 12 Oct 2026", partial: false, day: "2026-10-12" } },
  { name: "Saturday, Friday's bar stored, an after-hours Friday print", now: et(17, 11, 0), bars: BARS_TO_FRI16, row: row(et(16, 17, 30), 107),
    want: { kind: "close", price: 105, label: "close, 16 Oct 2026", partial: false, day: "2026-10-16" } },
];

const toPoints = (bars) => bars.map(([date, open, high, low, close]) => ({ date, open, high, low, close }));
/** The price and the day it is set against, from the given primitives. */
function surfaceAt(c, pick = S.pickSurfacePrice, soFar = M.todaySoFar) {
  const price = pick(c.row, c.bars, c.now);
  const points = toPoints(c.bars);
  const today = soFar(c.bars, c.row);
  if (today) points.push({ date: today.date, open: today.open, high: today.high, low: today.low, close: today.close, partial: true, label: today.label });
  const kl = K.keyLevels(points, { nowMs: c.now });
  const day = kl.periods.find((p) => p.key === "day");
  return { price, today, kl, day };
}
function caseHolds(c, pick, soFar) {
  const { price, today, kl, day } = surfaceAt(c, pick, soFar);
  const hi = day?.levels.high.value, lo = day?.levels.low.value;
  const fails = [];
  if (price?.kind !== c.want.kind || price?.price !== c.want.price) fails.push(`price ${price?.kind} ${price?.price}`);
  if (price?.label !== c.want.label) fails.push(`label "${price?.label}"`);
  if (!!today !== c.want.partial) fails.push(`partial bar ${!!today}`);
  if (kl.periods.length && (kl.live ? "2026-10-13" : kl.asOf) !== c.want.day) fails.push(`Key levels day ${kl.live ? "live" : kl.asOf}`);
  if (!(Number.isFinite(hi) && Number.isFinite(lo) && price && price.price <= hi + 1e-9 && price.price >= lo - 1e-9)) fails.push(`price ${price?.price} outside the day range ${lo}–${hi}`);
  return fails;
}

console.log("=== 1. The four times, on the real primitives ===");
for (const c of CASES) {
  const f = caseHolds(c);
  check(c.name, f.length === 0, f.join("; "));
}

console.log("\n=== 2. The real quote and history builders agree ===");
for (const c of CASES) {
  const q = Q.buildTiingoQuote("TEST", c.row, c.bars, c.now);
  const pts = H.buildTiingoHistoryPoints(c.bars, c.row) ?? [];
  const partial = !!pts[pts.length - 1]?.partial;
  const prevOk = c.want.prev === undefined || q?.previousClose === c.want.prev;
  const rangeOk = q && (c.want.kind === "close" || (q.dayHigh === c.row.high && q.dayLow === c.row.low));
  check(`${c.name}: header price, label, prev close and day range`, q?.price === c.want.price && q?.priceLabel === c.want.label && prevOk && rangeOk && partial === c.want.partial,
    JSON.stringify({ price: q?.price, label: q?.priceLabel, prev: q?.previousClose, hi: q?.dayHigh, lo: q?.dayLow, partial }));
}

console.log("\n=== 3. The helper ===");
check("09:30 and 16:00 ET are session prints; 09:29 and 16:01 are not; weekends never",
  SB.regularSessionTime(et(13, 9, 30)) && SB.regularSessionTime(et(13, 16, 0)) && !SB.regularSessionTime(et(13, 9, 29)) && !SB.regularSessionTime(et(13, 16, 1)) && !SB.regularSessionTime(et(17, 12, 0)));
check("a print counts only on its own New York day", SB.sessionPrint(et(13, 15, 59), et(13, 23, 0)) && !SB.sessionPrint(et(13, 15, 59), et(14, 10, 0)));
check("across DST: 13:40 UTC on 3 Nov is 08:40 EST, pre-market", !SB.regularSessionTime(Date.UTC(2026, 10, 3, 13, 40)) && SB.regularSessionTime(Date.UTC(2026, 9, 30, 13, 40)));
check("both price paths ask the helper", /sessionPrint\(row\.at, nowMs\)/.test(fs.readFileSync(SURFACE, "utf8")) && /if \(!regularSessionTime\(quote\.at\)\) return null;/.test(fs.readFileSync(MERGE, "utf8")));

console.log("\n=== 4. Mutants (each must fail) ===");
async function mutantModule(file, from, to) {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  if (!src.includes(from)) return null;
  const copy = path.join(ROOT, path.dirname(file), `.premarket-mutant-${process.pid}-${path.basename(file)}`);
  fs.writeFileSync(copy, src.split(from).join(to));
  try { return await import(pathToFileURL(copy).href); } finally { fs.rmSync(copy, { force: true }); }
}
const oldSwap = await mutantModule(SURFACE, " && sessionPrint(row.at, nowMs)", "");
check("mutant caught: the old \"newer wins\" swap (no session gate on the price)",
  !!oldSwap && CASES.some((c) => caseHolds(c, oldSwap.pickSurfacePrice, M.todaySoFar).length > 0), oldSwap ? "" : "the mutation did not apply");
const openBar = await mutantModule(MERGE, "  if (!regularSessionTime(quote.at)) return null;\n", "");
check("mutant caught: the ungated partial bar (a pre-market print as today's bar)",
  !!openBar && CASES.some((c) => caseHolds(c, S.pickSurfacePrice, openBar.todaySoFar).length > 0), openBar ? "" : "the mutation did not apply");

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
