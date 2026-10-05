// The fair value gap detector (#553 COWORK #140): lib/ta/fairValueGaps.ts.
//
// Fixtures: a bullish gap, a bearish gap, a partial fill that invalidates, an
// edge touch that does not, a gap at the edge of the lookback, the size test
// against ATR(14), flat data, and the nearest-2-per-side cap. ATR matches
// lib/ta/confluence.ts atr at every index. Each rule gets a planted mutant.
//
//   node scripts/check-fair-value-gaps.mjs
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const LIB = "lib/ta/fairValueGaps.ts";
const raw = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

let seq = 0;
const tmp = [];
async function loadLib(src) {
  const f = path.join(ROOT, "lib", "ta", `.check-fvg-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(f, src);
  tmp.push(f);
  return import(pathToFileURL(f).href);
}
const { atr: confluenceAtr } = await import(pathToFileURL(path.join(ROOT, "lib/ta/confluence.ts")).href);

// 30 quiet bars around 100 (range 99..101, ATR ~2), then the scenario's bars.
function base(n = 30) {
  return Array.from({ length: n }, (_, i) => ({ date: new Date(Date.UTC(2026, 5, 1 + i)).toISOString().slice(0, 10), high: 101, low: 99, close: 100 }));
}
const bar = (high, low, close = (high + low) / 2) => ({ high, low, close });
function series(extra) {
  const b = base();
  const start = Date.UTC(2026, 5, 1 + b.length);
  return [...b, ...extra.map((x, i) => ({ date: new Date(start + i * 86_400_000).toISOString().slice(0, 10), ...x }))];
}

async function rules(L) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };

  // Bullish: c1 high 101, c2 runs up, c3 low 104 > 101. Zone [101, 104] (3 = 1.5x ATR 2).
  const bull = series([bar(101, 99), bar(105, 100), bar(106, 104), bar(107, 105)]);
  const g1 = L.fairValueGaps(bull, { lookback: 250, minAtr: 0.5 });
  want("bullish: c3.low > c1.high gives the zone [c1.high, c3.low], dated at the middle candle", g1.length === 1 && g1[0].kind === "bullish" && g1[0].lower === 101 && g1[0].upper === 104 && g1[0].index === 31 && g1[0].date === bull[31].date);

  // Bearish: c1 low 99, c3 high 96 < 99. Zone [96, 99].
  const bear = series([bar(101, 99), bar(100, 95), bar(96, 94), bar(95, 93)]);
  const g2 = L.fairValueGaps(bear, { lookback: 250, minAtr: 0.5 });
  want("bearish: c3.high < c1.low gives the zone [c3.high, c1.low]", g2.length === 1 && g2[0].kind === "bearish" && g2[0].lower === 96 && g2[0].upper === 99);

  // A later bar dipping into the bullish zone (low 103.5 < 104) removes it, even partly.
  const partial = series([bar(101, 99), bar(105, 100), bar(106, 104), bar(107, 105), bar(106, 103.5), bar(108, 105)]);
  want("a later bar entering the zone, even partly, removes it", L.fairValueGaps(partial, { minAtr: 0.5 }).length === 0);
  // A later bar touching the zone's edge exactly (low 104) has not entered.
  const touch = series([bar(101, 99), bar(105, 100), bar(106, 104), bar(107, 105), bar(106, 104), bar(108, 105)]);
  want("a bar that only touches the edge leaves the gap open", L.fairValueGaps(touch, { minAtr: 0.5 }).length === 1);
  // A bearish gap entered from below (high 96.5 > 96) is removed.
  const bearFill = series([bar(101, 99), bar(100, 95), bar(96, 94), bar(95, 93), bar(96.5, 94)]);
  want("a bearish gap entered from below is removed", L.fairValueGaps(bearFill, { minAtr: 0.5 }).length === 0);

  // Size: a 1-point gap (0.5x ATR 2 at most... ATR here ~2) passes at 0.25, not at 0.75.
  const small = series([bar(101, 99), bar(102, 100), bar(103, 102), bar(103.5, 102.2)]);
  const atrAt = L.atrSeries(small)[32];
  want("the size test is height ≥ minAtr × ATR(14) at c3", L.fairValueGaps(small, { minAtr: 0.25 }).length === 1 && L.fairValueGaps(small, { minAtr: 0.75 }).length === (1 >= 0.75 * atrAt ? 1 : 0) && L.fairValueGaps(small, { minAtr: 1 / atrAt }).length === 1 && L.fairValueGaps(small, { minAtr: 1 / atrAt + 1e-9 }).length === 0);

  // Lookback: the bullish gap's c1 is bar 30 of 34. lookback 4 keeps it (c1 = n-4), lookback 3 drops it.
  want("a gap whose c1 is the lookback's first bar counts; one bar earlier does not", L.fairValueGaps(bull, { lookback: 4 }).length === 1 && L.fairValueGaps(bull, { lookback: 3 }).length === 0);

  // Flat data: no gaps, no throw.
  const flat = Array.from({ length: 60 }, (_, i) => ({ date: `d${i}`, high: 50, low: 50, close: 50 }));
  want("flat data has no gaps", L.fairValueGaps(flat).length === 0 && L.fairValueGaps([]).length === 0 && L.fairValueGaps(flat.slice(0, 2)).length === 0);

  // ATR at every index equals confluence's atr on the bars up to it.
  // Varied from the first bar, so a mis-seeded average shows.
  const wav = Array.from({ length: 60 }, (_, i) => ({ date: `w${i}`, ...bar(100 + 3 * Math.sin(i / 3) + 1 + (i % 5) * 0.4, 100 + 3 * Math.sin(i / 3) - 1 - (i % 3) * 0.3, 100 + 3 * Math.sin(i / 2.5)) }));
  const s = L.atrSeries(wav);
  let same = true;
  for (let i = 0; i < wav.length; i++) {
    const c = confluenceAtr(wav.slice(0, i + 1));
    if (!((c === null && s[i] === null) || (c !== null && s[i] !== null && Math.abs(c - s[i]) < 1e-9))) { same = false; break; }
  }
  want("ATR(14) matches lib/ta/confluence.ts atr at every index", same);

  // The cap: 3 bullish gaps below and 3 bearish above; the nearest 2 of each, by nearer edge.
  const mk = (kind, lower, upper, index) => ({ kind, lower, upper, index, date: `d${index}`, atr: 1 });
  const gaps = [mk("bullish", 80, 82, 1), mk("bullish", 90, 92, 2), mk("bullish", 95, 97, 3), mk("bearish", 103, 105, 4), mk("bearish", 110, 112, 5), mk("bearish", 120, 122, 6)];
  const near = L.nearestGaps(gaps, 100, 2).map((g) => g.index);
  want("nearest 2 below and 2 above, by the nearer edge", JSON.stringify(near) === JSON.stringify([2, 3, 4, 5]));
  want("distance is to the nearer edge", Math.abs(L.gapDistance(gaps[2], 100) - 0.03) < 1e-12 && Math.abs(L.gapDistance(gaps[3], 100) - 0.03) < 1e-12);
  return fails;
}

try {
  const SRC = raw(LIB);
  console.log("\n=== lib/ta/fairValueGaps.ts ===\n");
  const f = await rules(await loadLib(SRC));
  check("bull, bear, partial fill, edge touch, size, lookback edge, flat, ATR, nearest cap", f.length === 0, f.join("; "));

  console.log("\n=== Mutants ===\n");
  const MUTANTS = [
    ["bullish compares c3.low to c2", /if \(b3\.low > c1\.high\)/, "if (b3.low > bars[c3 - 1].high)"],
    ["bullish zone upper from c3.high", /lower = c1\.high; upper = b3\.low;/, "lower = c1.high; upper = b3.high;"],
    ["bearish rule dropped", /else if \(b3\.high < c1\.low\) \{ kind = "bearish"; lower = b3\.high; upper = c1\.low; \}/, ""],
    ["a touch counts as entering", /bars\[j\]\.low < upper && bars\[j\]\.high > lower/, "bars[j].low <= upper && bars[j].high >= lower"],
    ["fill tested on closes only", /bars\[j\]\.low < upper && bars\[j\]\.high > lower/, "bars[j].close < upper && bars[j].close > lower"],
    ["filled gaps kept", /if \(!filled\) out\.push/, "out.push"],
    ["no size test", /if \(a === null \|\| !\(upper - lower >= minAtr \* a\)\) continue;/, "if (a === null) continue;"],
    ["the zone dated at c3", /index: c3 - 1, date: bars\[c3 - 1\]\.date/, "index: c3, date: bars[c3].date"],
    ["lookback off by one", /n - lookback \+ 2/, "n - lookback + 3"],
    ["ATR seeded on 13 ranges", /if \(i === period\) a = sum \/ period;/, "if (i === period - 1) a = sum / (period - 1);"],
    ["the cap takes the farthest", /\.sort\(\(x, y\) => x\.lower - y\.lower\)/, ".sort((x, y) => y.lower - x.lower)"],
  ];
  for (const [label, from, to] of MUTANTS) {
    const m = SRC.replace(from, to);
    if (m === SRC) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
    let fails;
    try { fails = await rules(await loadLib(m)); } catch (e) { fails = [`threw: ${e.message}`]; }
    check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
  }
} finally {
  for (const f of tmp) fs.rmSync(f, { force: true });
}
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
