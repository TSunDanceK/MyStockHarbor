// The Pickers liquidity slice, S1 (#552 COWORK #235).
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. THE ROLLBACK STOPS BEING THE CAP. At ANALYSIS_UNIVERSE_CAP 700 the build
//      must be the pre-S1 build: the slice gets no slots and the dynamic
//      universe backfills exactly as before.
//   2. SLOTS 701+ GO TO UNRANKED NAMES: the dynamic universe backfilling past
//      700, or backfilling after the slice.
//   3. THE RANKING DRIFTS from what was previewed: floors, order, the 20-session
//      dollar volume, the size slice's hold-outs.
//   4. THE OTHER BUILDERS GROW WITH THE CAP (plays, bull flags, triangles).
//
// Runs the real modules, then every assertion again on mutants; each must be caught.
//
//   node scripts/check-liquidity-slice.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SLICE = "lib/server/liquiditySlice.ts";
const EOD = "lib/server/marketData/eodLast.ts";
const BUILDER = "lib/server/pickersBuilder.ts";
const OTHERS = ["lib/server/playsBuilder.ts", "lib/server/bullFlagsBuilder.ts", "lib/server/descendingTrianglesBuilder.ts"];

let seq = 0;
async function loadSibling(relFile, source) {
  const file = path.join(path.dirname(path.join(ROOT, relFile)), `.check-liq-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, source);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}

const row = (shares) => ({ v: 1, unit: "USD", at: 1, inputs: { shares: { val: shares, unit: "shares" }, refusals: [] } });
const bar = (i, c, v) => [`2026-09-${String(i + 1).padStart(2, "0")}`, c, c, c, c, v];

function suite(L, E, builder, others) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };

  // 3. The dollar volume.
  const bars = Array.from({ length: 25 }, (_, i) => bar(i, 100, i < 5 ? 1 : 200_000));
  ok("dv is the mean close x volume over the LAST 20 sessions", E.dollarVolume20(bars) === 20_000_000, String(E.dollarVolume20(bars)));
  ok("dv is null under 20 bars", E.dollarVolume20(bars.slice(-19)) === null);
  ok("the nightly summary row carries dv", E.eodLastRow(bars)?.dv === 20_000_000);

  // 3. The ranking.
  const rows = { BIG: row(1e9), MID: row(1e8), THIN: row(1e9), SMALL: row(1e7), SPCX: row(1e10), "BRK.B": row(2e9) };
  const eod = {
    BIG: { d: "2026-10-13", c: 100, dv: 5e7 },
    MID: { d: "2026-10-13", c: 100, dv: 1.5e9 }, // a tenth of BIG's cap, thirty times its volume: ranks above it
    THIN: { d: "2026-10-13", c: 100, dv: 9e6 },
    SMALL: { d: "2026-10-13", c: 100, dv: 1e9 },
    SPCX: { d: "2026-10-13", c: 100, dv: 1e9 },
    "BRK-B": { d: "2026-10-13", c: 100, dv: 1e8 },
  };
  const ranked = L.rankByCapAndLiquidity(rows, eod, new Set(["SPCX"]));
  ok("ranked by cap x dollar volume, largest first, dashed spelling", JSON.stringify(ranked) === JSON.stringify(["BRK-B", "MID", "BIG"]), JSON.stringify(ranked));
  ok("the dollar-volume floor holds ($10M)", !ranked.includes("THIN"));
  ok("the cap floor holds ($2B)", !ranked.includes("SMALL"));
  ok("the size slice's hold-outs are held out here too", !ranked.includes("SPCX"));
  ok("a row with no dv is not ranked", !L.rankByCapAndLiquidity({ X: row(1e9) }, { X: { d: "2026-10-13", c: 100 } }).length);

  // 1. The rollback.
  ok("no slots at the pre-S1 cap", L.liquiditySlots(700) === 0 && L.liquiditySlots(650) === 0);
  ok("slots 701-1,000 at cap 1,000", L.liquiditySlots(1000) === 300);
  ok("the pre-S1 size is 700", L.PRE_S1_UNIVERSE_CAP === 700);

  // 2. The wiring.
  const dyn = builder.indexOf("fillSlots(dynamicUniverse, UNIVERSE_CAP, PRE_S1_UNIVERSE_CAP);");
  const liq = builder.indexOf("if (liquidSlots > 0) fillSlots(await readByCapAndLiquidity(), liquidSlots);");
  const done = builder.indexOf("const universe = Array.from(universeSlots);");
  ok("the dynamic universe backfills only up to the pre-S1 size", dyn > 0);
  ok("the slice fills after it", liq > dyn && done > liq);
  ok("nothing backfills after the slice", !/fillSlots\(dynamicUniverse/.test(builder.slice(liq, done)));
  ok("the slot ceiling is honoured", /universeSlots\.size >= Math\.min\(ceiling, UNIVERSE_CAP\)/.test(builder));

  // 4. The other builders.
  for (const [f, src] of others) ok(`${f} stays at the pre-S1 size`, /const UNIVERSE_CAP = Math\.min\(ANALYSIS_UNIVERSE_CAP, PRE_S1_UNIVERSE_CAP\);/.test(src));
  return fails;
}

const sliceSrc = read(SLICE);
const eodSrc = read(EOD);
const builderCode = readCodeOnly(BUILDER);
const others = OTHERS.map((f) => [f, readCodeOnly(f)]);

const base = suite(await loadSibling(SLICE, sliceSrc), await loadSibling(EOD, eodSrc), builderCode, others);
if (base.length) {
  console.error("FAIL check-liquidity-slice:\n  " + base.join("\n  "));
  process.exit(1);
}

const mut = (label, src, from, to) => {
  if (!src.includes(from)) throw new Error(`mutant "${label}": anchor not found`);
  return src.replace(from, () => to);
};
const MUTANTS = [
  ["slots at 700 (rollback broken)", () => [mut("slots", sliceSrc, "universeCap - PRE_S1_UNIVERSE_CAP", "universeCap - 650"), eodSrc, builderCode, others]],
  ["the dv floor dropped", () => [mut("dvfloor", sliceSrc, "&& dv >= LIQUIDITY_MIN_DOLLAR_VOLUME", ""), eodSrc, builderCode, others]],
  ["the cap floor dropped", () => [mut("capfloor", sliceSrc, "cap >= LIQUIDITY_MIN_CAP &&", ""), eodSrc, builderCode, others]],
  ["ranked by cap alone", () => [mut("score", sliceSrc, "score: cap * dv", "score: cap"), eodSrc, builderCode, others]],
  ["hold-outs ignored", () => [mut("hold", sliceSrc, "|| holdOut.has(sym)", ""), eodSrc, builderCode, others]],
  ["dv over the whole history", () => [sliceSrc, mut("window", eodSrc, "const tail = bars.slice(-DOLLAR_VOLUME_SESSIONS);", "const tail = bars;"), builderCode, others]],
  ["dv not written nightly", () => [sliceSrc, mut("row", eodSrc, "    dv: dollarVolume20(bars),\n", ""), builderCode, others]],
  ["dynamic backfill to the full cap", () => [sliceSrc, eodSrc, mut("dyn", builderCode, "fillSlots(dynamicUniverse, UNIVERSE_CAP, PRE_S1_UNIVERSE_CAP);", "fillSlots(dynamicUniverse, UNIVERSE_CAP);"), others]],
  ["dynamic backfill after the slice", () => [sliceSrc, eodSrc, mut("after", builderCode, "const universe = Array.from(universeSlots);", "fillSlots(dynamicUniverse, UNIVERSE_CAP);\n  const universe = Array.from(universeSlots);"), others]],
  ["plays grows with the cap", () => [sliceSrc, eodSrc, builderCode, others.map(([f, s]) => [f, f.includes("plays") ? mut("plays", s, "Math.min(ANALYSIS_UNIVERSE_CAP, PRE_S1_UNIVERSE_CAP)", "ANALYSIS_UNIVERSE_CAP") : s])]],
];

let survived = 0;
for (const [label, make] of MUTANTS) {
  const [s, e, b, o] = make();
  let fails;
  try {
    fails = suite(await loadSibling(SLICE, s), await loadSibling(EOD, e), b, o);
  } catch {
    fails = ["threw"];
  }
  if (!fails.length) {
    survived++;
    console.error(`MUTANT SURVIVED: ${label}`);
  }
}
if (survived) process.exit(1);
console.log(`check-liquidity-slice: ranking, floors, dv, rollback and wiring hold; ${MUTANTS.length} mutants caught`);
