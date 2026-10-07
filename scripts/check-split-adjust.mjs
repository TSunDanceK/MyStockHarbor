// PER-SHARE FIGURES ON TODAY'S SHARE BASIS (#552 COWORK #187 §1).
//
// DECK (6:1) and BKNG (25:1) as the production census showed them: periods
// first filed before the split beside periods the filer restated. Only a split
// the filer PROVED (StoredFactSet.asr) moves anything; an IPO step, a ×1,000
// unit slip and a period with no share data are left as filed.
//
//   node scripts/check-split-adjust.mjs
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const { SEC_FIELD_KEYS } = await import("../lib/server/secFields.ts");
const { cell } = await import("../lib/server/secFactCodec.ts");
const S = await import("../lib/server/secSplitAdjust.ts");
const { splitAdjustedNote } = await import("../lib/server/secPresentation.ts");

const per = (e, o, fp = "FY") => {
  const v = SEC_FIELD_KEYS.map((k) => o[k] ?? null);
  return { e, s: null, fp, fy: 0, a: null, f: null, v, d: v.map((x) => (x == null ? "-" : "F")).join("") };
};
const eps = (set, e) => cell([...set.years, ...set.quarters].find((p) => p.e === e), "epsDiluted")?.val;
const near = (a, b) => typeof a === "number" && Math.abs(a - b) < 0.005;

// DECK: FY2021-22 first filed (≈28M shares), FY2023-24 restated (≈157M).
const DECK = { asr: [["2023-03-31", 6], ["2024-03-31", 6]], quarters: [], years: [
  per("2021-03-31", { epsDiluted: 13.47, sharesDiluted: 28.4e6, netIncome: 382e6, dividendsDeclaredPerShare: 0.6 }),
  per("2022-03-31", { epsDiluted: 16.26, sharesDiluted: 27.8e6, netIncome: 452e6 }),
  per("2023-03-31", { epsDiluted: 3.23, sharesDiluted: 160.1e6, netIncome: 516e6 }),
  per("2024-03-31", { epsDiluted: 4.86, sharesDiluted: 156.3e6, netIncome: 760e6 })] };
// BKNG: quarter by quarter, the newest Q3 first filed before the split.
// The restated ratios as production stores them (raw, not whole).
const BKNG = { asr: [["2025-03-31", 24.9961942456995], ["2025-06-30", 24.989228780697974]],
  years: [per("2024-12-31", { epsDiluted: 172.69, sharesDiluted: 34.1e6 }), per("2025-12-31", { epsDiluted: 165.57, sharesDiluted: 32.6e6 })],
  quarters: [per("2024-09-30", { epsDiluted: 74.34, sharesDiluted: 33.9e6 }, "Q3"), per("2025-03-31", { epsDiluted: 0.4, sharesDiluted: 827e6 }, "Q1"),
    per("2025-06-30", { epsDiluted: 1.1, sharesDiluted: 815e6 }, "Q2"), per("2025-09-30", { epsDiluted: 84.41, sharesDiluted: 32.6e6 }, "Q3"),
    per("2026-03-31", { epsDiluted: 1.36, sharesDiluted: 794e6 }, "Q1")] };

console.log("1. a proven split moves only the old-basis periods");
{
  const d = S.splitAdjusted(DECK);
  check("DECK FY2022 $16.26 → $2.71 and FY2021 $13.47 → $2.25 (÷6)", near(eps(d, "2022-03-31"), 2.71) && near(eps(d, "2021-03-31"), 2.245), `${eps(d, "2022-03-31")} ${eps(d, "2021-03-31")}`);
  check("DECK's restated years are untouched", eps(d, "2023-03-31") === 3.23 && eps(d, "2024-03-31") === 4.86);
  check("DPS moves with EPS; shares move the other way", near(cell(d.years[0], "dividendsDeclaredPerShare").val, 0.1) && Math.abs(cell(d.years[0], "sharesDiluted").val - 170.4e6) < 1);
  check("the record names the split and the periods moved", JSON.stringify(d.spa) === JSON.stringify({ splits: [{ ratio: 6, restated: "2023-03-31" }], adjusted: ["2021-03-31", "2022-03-31"] }), JSON.stringify(d.spa));
  const b = S.splitAdjusted(BKNG);
  check("BKNG: Q3 2025 $84.41 → $3.38 and Q3 2024 $74.34 → $2.97; Q1/Q2 2025 and Q1 2026 untouched",
    near(eps(b, "2025-09-30"), 3.3764) && near(eps(b, "2024-09-30"), 2.9736) && eps(b, "2025-03-31") === 0.4 && eps(b, "2025-06-30") === 1.1 && eps(b, "2026-03-31") === 1.36);
  check("BKNG's fiscal years (first filed) move too: FY2025 $165.57 → $6.62", near(eps(b, "2025-12-31"), 6.6228));
}

console.log("\n2. nothing moves without the filer's proof");
{
  const ipo = { asr: [], quarters: [], years: [per("2020-12-31", { epsDiluted: -2, sharesDiluted: 50e6 }), per("2021-12-31", { epsDiluted: -0.5, sharesDiluted: 350e6 })] };
  check("an IPO step (×7, no restatement) is left as filed", S.splitAdjusted(ipo) === ipo);
  const slip = { asr: [], quarters: [], years: [per("2023-12-31", { epsDiluted: 2, sharesDiluted: 714e6 }), per("2024-12-31", { epsDiluted: 2.2, sharesDiluted: 714 })] };
  check("a ×1,000,000 unit slip is left as filed", S.splitAdjusted(slip) === slip);
  const noShares = { ...DECK, years: [per("2020-03-31", { epsDiluted: 9.9 }), ...DECK.years] };
  check("a period with no share count and no net income is left as filed", eps(S.splitAdjusted(noShares), "2020-03-31") === 9.9);
  const legacy = { ...DECK }; delete legacy.asr;
  check("a set written before the share-series read (no asr) is left as filed", S.splitAdjusted(legacy) === legacy);
  const d = S.splitAdjusted(DECK);
  check("adjusting twice is adjusting once", S.splitAdjusted(d) === d);
}

console.log("\n3. a reverse split");
{
  // 1-for-10: first-filed periods have ten times the shares.
  const rev = { asr: [["2025-06-30", 0.1]], quarters: [], years: [
    per("2024-06-30", { epsDiluted: -0.05, sharesDiluted: 900e6 }), per("2025-06-30", { epsDiluted: -0.6, sharesDiluted: 88e6 })] };
  check("1-for-10: the older year's EPS ×10 (−$0.05 → −$0.50)", near(eps(S.splitAdjusted(rev), "2024-06-30"), -0.5), String(eps(S.splitAdjusted(rev), "2024-06-30")));
  check("the note names a reverse split", /1-for-10 reverse split/.test(splitAdjustedNote({ splits: [{ ratio: 0.1 }] })));
}

console.log("\n4. wired into every reader that prints a per-share figure");
{
  check("buildSecEarningsView adjusts at entry and carries the record",
    /\): SecEarningsView \| null \{[\s\S]{0,200}set = splitAdjusted\(set\);/.test(readCodeOnly("lib/server/secEarningsView.ts")) &&
      /splitAdjustment: \(set as \{ spa\?: SplitAdjustment \}\)\.spa \?\? null,/.test(readCodeOnly("lib/server/secEarningsView.ts")));
  check("valuationInputs adjusts at entry (TTM EPS for P/E)", /\): ValuationInputs \{\s*set = splitAdjusted\(set\);/.test(readCodeOnly("lib/server/secValuation.ts")));
  check("buildProfileDividend adjusts at entry (yield and growth)", /if \(!set\) return hidden\("no-facts"\);\s*set = splitAdjusted\(set\);/.test(readCodeOnly("lib/server/secDividend.ts")));
  check("the Growth & margins card prints the split-adjusted line",
    /\{view\.splitAdjustment \? <p data-split-adjusted="">\{splitAdjustedNote\(view\.splitAdjustment\)\}<\/p> : null\}/.test(readCodeOnly("app/stock/[symbol]/earnings/SecEarningsCards.tsx")));
  check("the note says what moved and why", /^Split-adjusted: per-share figures \(EPS and dividends per share\) from before the company's 6-for-1 split are restated to today's share count/.test(splitAdjustedNote({ splits: [{ ratio: 6 }] })));
}

console.log("\n5. mutations");
{
  const SRC = fs.readFileSync("lib/server/secSplitAdjust.ts", "utf8");
  const mutant = async (anchor, replacement, tag) => {
    if (SRC.split(anchor).length !== 2) throw new Error(`mutation anchor must match once: ${anchor}`);
    const tmp = `lib/server/.check-split-${tag}-${process.pid}.ts`;
    fs.writeFileSync(tmp, SRC.replace(anchor, replacement));
    try { return await import(`../${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
  };
  const M1 = await mutant("      if (moved < asIs) f *= split.k;", "      f *= split.k;", "all");
  check("MUTATION: every period moved, restated ones too → DECK FY2023 divided again (caught)", !near(eps(M1.splitAdjusted(DECK), "2023-03-31"), 3.23));
  const M2 = await mutant("    const k = splitRatioOf(r);\n    if (k === null) continue;", "    const k = r;", "ratio");
  check("MUTATION: the raw restated ratio, not a whole split → BKNG's split recorded as 24.996…, not 25 (caught)", M2.splitAdjusted(BKNG).spa?.splits[0]?.ratio !== 25);
  // WHY RE-APPLYING IS A NO-OP EVEN WITHOUT THE STAMP: the moved share counts
  // put each old-basis period on the new basis, so the basis test leaves it.
  const M3 = await mutant("  if (already) return set;", "", "nostamp");
  check("without the stamp, adjusting twice still divides once (the share counts carry the basis)", near(eps(M3.splitAdjusted(M3.splitAdjusted(DECK)), "2022-03-31"), 2.71));
  const M4 = await mutant("    if (i >= 0 && typeof v[i] === \"number\") v[i] = (v[i] as number) * f;\n", "", "noshares");
  check("MUTATION: share counts not moved → FY2021 shares still 28.4M beside a ÷6 EPS (caught)", Math.abs(cell(M4.splitAdjusted(DECK).years[0], "sharesDiluted").val - 28.4e6) < 1);
}

if (failures) { console.log(`\n${failures} assertion(s) failed.`); process.exit(1); }
console.log("\nALL CHECKS PASSED");
