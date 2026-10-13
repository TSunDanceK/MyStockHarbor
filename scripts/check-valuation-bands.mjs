// LOW / FAIR / RICH VS THE SECTOR (#552 COWORK #202 item 3). The rules in
// lib/valuationBands.ts, on fixtures through the REAL module (lifted with the
// P/E sector line it borrows its floor and stability test from):
//   1. quartile edges: below p25 Low, p25–p75 Fair, above p75 Rich
//   2. the floor: a sector under PE_PEER_FLOOR peers, or too unsteady, falls
//      back to the market's quartiles, and the note says so
//   3. no band for a refusal, a loss or a missing figure
//   4. the marker: equal thirds, linear inside each, pinned past the right end
//   5. the card: a refusal has no marker, the words are Low / Fair / Rich with
//      "vs sector" or "vs market", no buy/sell wording; the FY P/E fallback
//      gets no band; one Data Cache read, no new Redis key
// plus mutations, each caught.
import fs from "node:fs";
import { lift } from "./lib/earnings-plan.mjs";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const lineSrc = fs.readFileSync("lib/peSectorLine.ts", "utf8");
const bandsRaw = fs.readFileSync("lib/valuationBands.ts", "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const load = (src) => lift(`${lineSrc}\n${src}`);
const B = await load(bandsRaw);

// A sector of 40 evenly spread P/Es 10..49 (quartiles 19.75 / 29.5 / 39.25),
// a thin sector of 5, and the market.
const spread = (n, from) => Array.from({ length: n }, (_, i) => from + i);
const rows = [
  ...spread(40, 10).map((val) => ({ group: "Tech", key: "peRatio", val })),
  // TEN STEADY NAMES: stable enough, but under the 20-peer floor.
  ...spread(10, 100).map((val) => ({ group: "Thin", key: "peRatio", val })),
  ...spread(60, 5).map((val) => ({ group: "Other", key: "peRatio", val })),
  { group: "Tech", key: "peRatio", val: -3 }, { group: "Tech", key: "peRatio", val: 0 },
];
const bench = B.buildBenchmarks(rows, "2026-10-09");

console.log("1. quartile edges");
{
  const t = bench.groups.Tech.peRatio;
  check("negatives and zeros are left out", t.n === 40, `n=${t.n}`);
  check("quartiles of 10..49", Math.abs(t.p25 - 19.75) < 1e-9 && Math.abs(t.median - 29.5) < 1e-9 && Math.abs(t.p75 - 39.25) < 1e-9, JSON.stringify(t));
  const at = (v) => B.valuationBand(v, "Tech", bench, "peRatio", "A P/E")?.band;
  check("15 → Low", at(15) === "Low");
  check("19.75 (p25) → Fair", at(19.75) === "Fair");
  check("39.25 (p75) → Fair", at(39.25) === "Fair");
  check("45 → Rich", at(45) === "Rich");
  check("basis is the sector", B.valuationBand(30, "Tech", bench, "peRatio", "A P/E")?.basis === "sector");
}

{
  const xs = [3, 9, 1, 7, 5, 11, 2, 8, 6, 4, 10, 12, 15, 14, 13];
  const a = B.quartileBench(xs), b = B.quartileBench([...xs].reverse());
  check("the stability test does not depend on the peers' order", a.spreadPct === b.spreadPct, `${a.spreadPct} vs ${b.spreadPct}`);
}

console.log("\n2. the floor falls back to the market");
{
  const b = B.valuationBand(30, "Thin", bench, "peRatio", "A P/E");
  check("a 10-name sector (under the floor, but steady) uses the market", b?.basis === "market" && b?.group === null, JSON.stringify(b && { basis: b.basis, n: b.n }));
  check("...and its note says why", /too few comparable companies/.test(b?.note ?? ""));
  const none = B.valuationBand(30, null, bench, "peRatio", "A P/E");
  check("no sector uses the market, and says so", none?.basis === "market" && /no sector classification/.test(none?.note ?? ""));
  const unsteady = { asOf: "", market: bench.market, groups: { U: { peRatio: { n: 50, p25: 10, median: 20, p75: 30, spreadPct: 40 } } } };
  check("a spread past the bar uses the market", B.valuationBand(15, "U", unsteady, "peRatio", "A P/E")?.basis === "market");
}

console.log("\n3. no band without a figure");
for (const v of [null, undefined, -5, 0, NaN]) check(`${v} → no band`, B.valuationBand(v, "Tech", bench, "peRatio", "A P/E") === null);
check("no benchmarks → no band", B.valuationBand(30, "Tech", null, "peRatio", "A P/E") === null);

console.log("\n4. the marker");
{
  const pos = (v) => B.valuationBand(v, "Tech", bench, "peRatio", "A P/E");
  check("p25 sits at one third", Math.abs(pos(19.75).pos - 1 / 3) < 1e-9);
  check("p75 sits at two thirds", Math.abs(pos(39.25).pos - 2 / 3) < 1e-9);
  check("the median sits mid-bar", Math.abs(pos(29.5).pos - 0.5) < 1e-9);
  check("p75 + IQR is the right end, not off-scale", Math.abs(pos(58.75).pos - 1) < 1e-9 && pos(58.75).offScale === false);
  check("far past it is pinned and marked off-scale", pos(500).pos === 1 && pos(500).offScale === true);
}

console.log("\n5. the card and the page");
{
  const card = readCodeOnly("app/stock/[symbol]/ValuationBands.tsx");
  const client = readCodeOnly("app/stock/[symbol]/StockSymbolPageClient.tsx");
  const page = readCodeOnly("app/stock/[symbol]/page.tsx");
  const loader = readCodeOnly("lib/server/valuationBenchmarks.ts");
  check("a bar only where there is a figure (refusals: word only)", /const b = r\.value != null \? r\.band : null;/.test(card) && /\{b \? \(/.test(card));
  check("a refusal shows its word with the reason on tap", /<ReasonedValue text=\{r\.word \?\? "—"\} reason=\{r\.reason\} \/>/.test(card));
  check("the scale reads Low · Fair · Rich", /<span>Low<\/span><span>Fair<\/span><span>Rich<\/span>/.test(card));
  check("\"vs sector\" or \"vs market\" beside the band", /`vs \$\{b\.basis === "sector" \? "sector" : "market"\}/.test(card));
  const words = [card, readCodeOnly("lib/valuationBands.ts")].join("\n");
  check("no buy / sell / cheap-stock wording", !/\b(buy|sell|undervalued|overvalued|bargain)\b/i.test(words));
  check("the title and the hedged sub-line", /valuation multiples: low, fair or rich\?/.test(client) && /Lower may mean cheaper, but compare against the company&apos;s own history and its sector\./.test(client));
  check("the old tiles are hidden behind a flag, not deleted", /const SHOW_VALUATION_BANDS = true;/.test(client) && /className="valuationGrid"/.test(client));
  check("the period label and How it's calculated stay", /basis: valuation\?\.peBasis \?\? "TTM"/.test(client) && /How it&apos;s calculated/.test(card) && /How these are calculated/.test(client));
  check("the FY P/E fallback gets no band", /peRatio: fyPe \? null : valuationBand\(/.test(page));
  check("an estimated figure gets no band", /const filed = \(f: ValuationFigure \| null \| undefined\) => \(mark\(f\) \? null : figure\(f\)\);/.test(page) && /valuationBand\(filed\(multiples\?\.evEbitda\)/.test(page));
  check("the peers are filed figures only", /valuationMultiples\(inputs, row\.m, last\.c\);/.test(loader) && !/withEstimates/.test(loader));
  check("one Data Cache read, no new Redis key", /unstable_cache\(loadValuationBenchmarks/.test(loader) && !/\.set\(|\.hset\(|\.sadd\(|\.zadd\(/.test(loader) && (loader.match(/\.hgetall/g) ?? []).length === 1);
}

console.log("\n6. mutations");
{
  const mut = async (name, from, to, probe) => {
    if (!bandsRaw.includes(from)) { check(`mutant "${name}" applies`, false, "anchor moved"); return; }
    let held; try { held = probe(await load(bandsRaw.replace(from, to))); } catch { held = false; }
    check(`mutant caught: ${name}`, !held);
  };
  await mut("no floor", "b!.n >= PE_PEER_FLOOR && ", "", (M) => M.valuationBand(30, "Thin", M.buildBenchmarks(rows, ""), "peRatio", "x")?.basis === "market");
  await mut("p75 counted as Rich", 'value > b.p75 ? "Rich"', 'value >= b.p75 ? "Rich"', (M) => M.valuationBand(39.25, "Tech", M.buildBenchmarks(rows, ""), "peRatio", "x")?.band === "Fair");
  await mut("negatives kept", "xs.filter((x) => Number.isFinite(x) && x > 0)", "xs.filter((x) => Number.isFinite(x))", (M) => M.buildBenchmarks(rows, "").groups.Tech.peRatio.n === 40);
  await mut("unsorted peers", ".filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);", ".filter((x) => Number.isFinite(x) && x > 0);", (M) => { const xs = [3, 9, 1, 7, 5, 11, 2, 8, 6, 4, 10, 12, 15, 14, 13]; return M.quartileBench(xs).spreadPct === M.quartileBench([...xs].reverse()).spreadPct; });
  await mut("never pinned", "offScale = t > 1;", "offScale = false;", (M) => M.valuationBand(500, "Tech", M.buildBenchmarks(rows, ""), "peRatio", "x")?.offScale === true);
}

console.log(failures === 0 ? "\nvaluation-bands: all checks passed" : `\nvaluation-bands: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
