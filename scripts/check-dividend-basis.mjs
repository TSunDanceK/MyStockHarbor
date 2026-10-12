// DIVIDENDS FILED AS A PER-QUARTER RATE, AND ACROSS A SPLIT (#552 COWORK #208).
//
// Fixtures shaped like the census's cases (CODE-A #226/#227):
//   BKNG  a rate filer (year ≈ its Q1) with differenced $0 quarters → rules 1, 2
//   WMT   declares the whole year in Q1 and files $0 after it: year ≈ Q1, but
//         NOT a rate filer (its year is a real total) → untouched
//   V     a rate filer whose Q2/Q3 are filed at the rate, Q4 differenced to $0 → rules 1, 2
//   CEG   a rate filer with every quarter filed directly → rule 2 only
//   DD    a running-total filer with a proven split mid-year → rule 3 only
//   plus a plain running-total filer that must come back untouched.
// Then the readers (the profile row; the pickers' payout and Q4 derivation),
// the tap notes, and one mutant per rule.
//
//   node scripts/check-dividend-basis.mjs
import "./lib/register-ts-app.mjs";
import fs from "node:fs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const { SEC_FIELD_KEYS } = await import("../lib/server/secFields.ts");
const { cell } = await import("../lib/server/secFactCodec.ts");
const S = await import("../lib/server/secSplitAdjust.ts");
const { buildProfileDividend } = await import("../lib/server/secDividend.ts");
const { samePeriodPayout, quarterlyDps } = await import("../lib/server/pickersSecFundamentals.ts");
const { derivationNote, DIVIDEND_RATE_YEAR_NOTE, DIVIDEND_QUARTER_WITHHELD_NOTE } = await import("../lib/server/secEarningsView.ts");

const DPS = "dividendsDeclaredPerShare";
// One period: `o` maps key → value, or key → [value, code] for a derived cell.
const per = (e, fp, fy, o) => {
  const pairs = SEC_FIELD_KEYS.map((k) => (Array.isArray(o[k]) ? o[k] : o[k] == null ? [null, "-"] : [o[k], "F"]));
  return { e, s: null, fp, fy, a: null, f: null, v: pairs.map((x) => x[0]), d: pairs.map((x) => x[1]).join("") };
};
const set = (quarters, years, extra = {}) => ({ tx: ["us-gaap"], asr: [], quarters: [...quarters].reverse(), years: [...years].reverse(), ...extra });
const dps = (s, e, which = "quarters") => cell(s[which].find((p) => p.e === e), DPS);

const BKNG = set([
  per("2025-03-31", "Q1", 2025, { [DPS]: 0.384, epsDiluted: 0.4 }),
  per("2025-06-30", "Q2", 2025, { [DPS]: [0, "D"], epsDiluted: 1.1 }),
  per("2025-09-30", "Q3", 2025, { [DPS]: [0, "D"], epsDiluted: 3.38 }),
  per("2025-12-31", "Q4", 2025, { [DPS]: [0, "D"] }),
  per("2026-03-31", "Q1", 2026, { [DPS]: 0.42, epsDiluted: 1.36 }),
], [per("2025-12-31", "FY", 2025, { [DPS]: 0.384, epsDiluted: 6.62 })]);
const WMT = set([
  per("2025-04-30", "Q1", 2026, { [DPS]: 0.94, epsDiluted: 0.61 }),
  per("2025-07-31", "Q2", 2026, { [DPS]: 0, epsDiluted: 0.88 }),
  per("2025-10-31", "Q3", 2026, { [DPS]: [0, "D"], epsDiluted: 0.77 }),
  per("2026-01-31", "Q4", 2026, { [DPS]: [0, "D"] }),
], [per("2026-01-31", "FY", 2026, { [DPS]: 0.94, epsDiluted: 2.73 })]);
const V = set([
  per("2024-12-31", "Q1", 2025, { [DPS]: 0.59, epsDiluted: 2.58 }),
  per("2025-03-31", "Q2", 2025, { [DPS]: 0.59, epsDiluted: 2.32 }),
  per("2025-06-30", "Q3", 2025, { [DPS]: 0.59, epsDiluted: 2.69 }),
  per("2025-09-30", "Q4", 2025, { [DPS]: [0, "D"] }),
], [per("2025-09-30", "FY", 2025, { [DPS]: 0.59, epsDiluted: 10.2 })]);
const CEG = set([
  per("2025-03-31", "Q1", 2025, { [DPS]: 0.3874 }),
  per("2025-06-30", "Q2", 2025, { [DPS]: 0.3874 }),
  per("2025-09-30", "Q3", 2025, { [DPS]: 0.3874 }),
], [per("2024-12-31", "FY", 2024, { [DPS]: 0.3525, epsDiluted: 11.89 }), per("2025-12-31", "FY", 2025, { [DPS]: 0.3874, epsDiluted: 7.4 })]);
// DD: a running-total filer; a 2-for-1 split the filer proved by restating Q3's
// comparatives, so Q1–Q2 are moved onto today's basis and Q3 is not.
const DD = set([
  per("2025-03-31", "Q1", 2025, { [DPS]: 0.41, sharesDiluted: 100e6 }),
  per("2025-06-30", "Q2", 2025, { [DPS]: [0.41, "D"], sharesDiluted: 100e6 }),
  per("2025-09-30", "Q3", 2025, { [DPS]: [-0.205, "D"], sharesDiluted: 200e6 }),
], [per("2024-12-31", "FY", 2024, { [DPS]: 1.64, sharesDiluted: 100e6 })], { asr: [["2025-09-30", 2]] });
const RUNNING = set([
  per("2025-03-31", "Q1", 2025, { [DPS]: 0.25 }),
  per("2025-06-30", "Q2", 2025, { [DPS]: [0.25, "D"] }),
  per("2025-09-30", "Q3", 2025, { [DPS]: [0.25, "D"] }),
  per("2025-12-31", "Q4", 2025, { [DPS]: [0.25, "D"] }),
], [per("2025-12-31", "FY", 2025, { [DPS]: 1.0 })]);

console.log("1. who is a rate filer (the year against its own filed Q1)");
check("BKNG 1.00× → rate", S.dividendRateFiler(BKNG)?.ratio === 1);
check("V 1.00×, Q2/Q3 filed at the rate → rate", S.dividendRateFiler(V)?.fy === 2025);
check("WMT 1.00× to Q1, but Q2 filed at $0 (the year declared once) → not", S.dividendRateFiler(WMT) === null);
check("CEG 1.00× (FY2025, the newest year with a filed Q1) → rate", S.dividendRateFiler(CEG)?.fy === 2025);
check("a running total (4.0×) → not", S.dividendRateFiler(RUNNING) === null);
check("DD (no filed year with a filed Q1 in the same year) → not", S.dividendRateFiler(DD) === null);

console.log("\n2. rule 1: a rate filer's differenced quarters are withheld, filed ones kept");
{
  const b = S.splitAdjusted(BKNG), v = S.splitAdjusted(V);
  check("BKNG Q2–Q4 2025: $0 → withheld (null, W)", ["2025-06-30", "2025-09-30", "2025-12-31"].every((e) => dps(b, e).val === null && dps(b, e).derived === "withheld"));
  check("BKNG's filed Q1s stay", dps(b, "2025-03-31").val === 0.384 && dps(b, "2026-03-31").val === 0.42);
  check("V Q4 $0 → withheld; Q1–Q3 $0.59 stay", dps(v, "2025-09-30").derived === "withheld" && ["2024-12-31", "2025-03-31", "2025-06-30"].every((e) => dps(v, e).val === 0.59));
  check("WMT comes back as the same object: $0.94 year and its $0 quarters stand", S.splitAdjusted(WMT) === WMT);
  check("other fields untouched (EPS)", cell(b.quarters.find((p) => p.e === "2025-09-30"), "epsDiluted").val === 3.38);
}

console.log("\n3. rule 2: a rate filer's year is withheld");
{
  const b = S.splitAdjusted(BKNG), c = S.splitAdjusted(CEG);
  check("BKNG FY2025 $0.384 (one quarter) → withheld", dps(b, "2025-12-31", "years").derived === "withheld" && dps(b, "2025-12-31", "years").val === null);
  check("CEG: both years withheld, every quarter kept", c.dvr?.years.length === 2 && c.dvr.quarters.length === 0 && c.quarters.every((p) => cell(p, DPS).val === 0.3874));
  check("the record says why", JSON.stringify(c.dvr?.rate) === JSON.stringify({ fy: 2025, ratio: 1 }), JSON.stringify(c.dvr));
}

console.log("\n4. rule 3: a quarter differenced across a proven split");
{
  const d = S.splitAdjusted(DD);
  check("the split moved Q1–Q2, not Q3", JSON.stringify(d.spa?.adjusted) === JSON.stringify(["2024-12-31", "2025-03-31", "2025-06-30"]), JSON.stringify(d.spa?.adjusted));
  check("DD Q3 (−$0.205, one basis minus the other) → withheld", dps(d, "2025-09-30").derived === "withheld");
  check("DD Q2 (both sides moved) → kept, on today's basis", Math.abs(dps(d, "2025-06-30").val - 0.205) < 1e-9 && dps(d, "2025-06-30").derived === "differenced");
  check("DD's year is not withheld (not a rate filer)", dps(d, "2024-12-31", "years").val !== null && d.dvr?.rate === null);
}

console.log("\n5. nothing else moves");
{
  check("a running-total filer comes back as the same object", S.splitAdjusted(RUNNING) === RUNNING);
  const b = S.splitAdjusted(BKNG);
  check("passing twice is passing once", S.splitAdjusted(b) === b);
  const stamped = { ...BKNG, dvr: { rate: null, quarters: [], years: [] } };
  check("a set already stamped is not judged again", S.splitAdjusted(stamped) === stamped);
  check("the stored set itself is not changed", cell(BKNG.years[0], DPS).val === 0.384);
}

console.log("\n6. the readers");
{
  // A newer differenced quarter reading a positive figure (as BKNG's Q3 2025 did, $0.3688).
  const before = buildProfileDividend({ ...BKNG, quarters: [per("2026-06-30", "Q2", 2026, { [DPS]: [0.3688, "D"] }), ...BKNG.quarters] });
  check("profile row: a newest differenced quarter is skipped, the newest FILED quarter shown", before.state === "declared" && before.perShare === 0.42 && before.periodEnd === "2026-03-31", JSON.stringify(before));
  const v = S.splitAdjusted(V);
  check("pickers payout: no fiscal-year fallback on a rate filer's year (was 0.59 ÷ 10.2 = 5.8%)", samePeriodPayout(v, null) === null && samePeriodPayout(V, null)?.val > 5.7);
  const vNoQ4 = S.splitAdjusted({ ...V, quarters: V.quarters.map((p) => (p.fp === "Q4" ? per(p.e, "Q4", 2025, {}) : p)) });
  check("pickers Q4: nothing derived from a withheld year", quarterlyDps(vNoQ4)[0] === null);
  check("WMT's pickers payout keeps its fiscal-year figure (0.94 ÷ 2.73)", Math.abs(samePeriodPayout(S.splitAdjusted(WMT), null)?.val - 34.43) < 0.01);
  check("tap note, a rate filer's year (the owner's wording)", derivationNote("withheld", { key: DPS, fp: "FY" }) === DIVIDEND_RATE_YEAR_NOTE && DIVIDEND_RATE_YEAR_NOTE === "This company files its dividend as a per-quarter rate, so no full-year total is shown.");
  check("tap note, a withheld dividend quarter", derivationNote("withheld", { key: DPS, fp: "Q3" }) === DIVIDEND_QUARTER_WITHHELD_NOTE);
  check("the revenue note is unchanged for revenue", /different scopes/.test(derivationNote("withheld", { key: "revenue", fp: "Q4" })));
}

console.log("\n7. mutations, one per rule (and the rate test's two edges)");
{
  const SRC = fs.readFileSync("lib/server/secSplitAdjust.ts", "utf8");
  const mutant = async (anchor, replacement, tag) => {
    if (SRC.split(anchor).length !== 2) throw new Error(`mutation anchor must match once: ${anchor}`);
    const tmp = `lib/server/.check-dividend-basis-${tag}-${process.pid}.ts`;
    fs.writeFileSync(tmp, SRC.replace(anchor, replacement));
    try { return await import(`../${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
  };
  const M1 = await mutant("    if (!rate && !acrossSplit) return p;", "    if (!acrossSplit) return p;", "rule1");
  check("MUTATION rule 1 off: BKNG Q2 back to $0 (caught)", dps(M1.splitAdjusted(BKNG), "2025-06-30").val === 0);
  const M2 = await mutant("  const nextYears = !rate ? set.years :", "  const nextYears = true ? set.years :", "rule2");
  check("MUTATION rule 2 off: CEG's year back (caught)", dps(M2.splitAdjusted(CEG), "2025-12-31", "years").val !== null);
  const M3 = await mutant("    const acrossSplit = Boolean(prior) && moved.has(prior!.e) !== moved.has(p.e);", "    const acrossSplit = false;", "rule3");
  check("MUTATION rule 3 off: DD Q3 −$0.205 back (caught)", dps(M3.splitAdjusted(DD), "2025-09-30").derived !== "withheld");
  const M5 = await mutant("    return offRate ? null : { fy: y.fy, ratio };", "    return { fy: y.fy, ratio };", "q2q3");
  check("MUTATION the Q2/Q3 guard off: WMT's real $0.94 year withheld (caught)", M5.splitAdjusted(WMT) !== WMT);
  const M4 = await mutant("export const DIVIDEND_RATE_MAX = 1.25;", "export const DIVIDEND_RATE_MAX = 5;", "range");
  check("MUTATION the rate band widened to 5×: a running-total filer withheld (caught)", M4.splitAdjusted(RUNNING) !== RUNNING);
}

if (failures) { console.log(`\n${failures} assertion(s) failed.`); process.exit(1); }
console.log("\nALL CHECKS PASSED");
