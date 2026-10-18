// A BANK'S REVENUE IS ITS NET REVENUE (earnings audit r2).
//
// 55 filers read revenue below their own net interest income: HBAN $1,562M
// (its 606 fee line) beside $5,991M of NII. A filer tagging both halves, on any
// period more than BANK_NET_TOLERANCE off NII + noninterest income, now reads
// net revenue across its whole series: RevenuesNetOfInterestExpense, else a
// `Revenues` within tolerance, else the halves' sum marked computed. Pinned on
// companyfacts-shaped payloads built from the filers' own 10-K figures ($M):
//   HBAN  fee line 1,562 · NII 5,991 · NonII 2,175  -> 8,166 computed
//   ZION  Revenues 662 (a sub-line) · NII 2,627 · NonII 758 -> 3,385 computed
//   BBT   Revenues 400.0 (gross) · NII+NonII 355.2 -> 355.2 computed
//   KEY   Revenues 7,513 within 0.5% of 4,636 + 2,842 -> UNCHANGED
//   SYF   no total; already the computed halves -> UNCHANGED
// plus: the derived Q4 on the same basis as its year, no fee line left beside
// net revenue in one series, no bank below its own NII, no backfill of an older
// period the earlier rules left blank (USB 2020-21), the newest blank years
// filled (FITB), a non-USD filer untouched (MFG), and the mutation (the block
// removed) that brings HBAN's fee line back.
import fs from "node:fs";
import { lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const fieldsSrc = fs.readFileSync("lib/server/secFields.ts", "utf8");
const fxSrc = fs.readFileSync("lib/server/fxRates.ts", "utf8");
const currencySrc = fs.readFileSync("lib/server/secCurrency.ts", "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const extractRaw = fs.readFileSync("lib/server/secExtract.ts", "utf8")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secFields";/, "")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secCurrency";/, "");
const load = (src) => lift(`${fieldsSrc}\n${fxSrc}\n${currencySrc}\n${src}`);
const X = await load(extractRaw);
const REV = X.SEC_FIELD_KEYS.indexOf("revenue");

const M = 1e6;
const CONTRACT = "RevenueFromContractWithCustomerExcludingAssessedTax";
const NII = "InterestIncomeExpenseNet", NON = "NoninterestIncome";
const row = (start, end, val, form) => ({ start, end, val, accn: "0000000000-26-000001", fy: 2025, fp: form === "10-K" ? "FY" : "Q3", form, filed: "2026-02-20" });
/** { tag: [[start, end, $M], ...] } -> companyfacts. A ~year is a 10-K row, anything shorter a 10-Q row. */
const payload = (tags) => ({
  cik: 1, entityName: "Fixture",
  facts: { "us-gaap": Object.fromEntries(Object.entries(tags).map(([tag, rows]) => [tag, {
    units: { USD: rows.map(([s, e, v]) => row(s, e, v * M, (Date.parse(e) - Date.parse(s)) / 864e5 > 300 ? "10-K" : "10-Q")) },
  }])) },
});
const Y = (y, v) => [`${y}-01-01`, `${y}-12-31`, v];
// A year with its three quarters and nine months, so Q4 is FY - 9M.
const quartered = (y, fy, q) => [
  Y(y, fy), [`${y}-01-01`, `${y}-03-31`, q[0]], [`${y}-04-01`, `${y}-06-30`, q[1]], [`${y}-07-01`, `${y}-09-30`, q[2]],
  [`${y}-01-01`, `${y}-09-30`, q[0] + q[1] + q[2]],
];
const rev = (ex, end, kind = "years") => ex[kind].find((p) => p.end === end)?.values?.[REV];

console.log("1. the fee-line bank moves to net revenue, whole series");
const hban = payload({
  [CONTRACT]: [...quartered(2025, 1562, [380, 390, 395]), ...quartered(2024, 1460, [350, 360, 370])],
  [NII]: [...quartered(2025, 5991, [1450, 1490, 1520]), ...quartered(2024, 5450, [1330, 1350, 1380])],
  [NON]: [...quartered(2025, 2175, [520, 540, 550]), ...quartered(2024, 1980, [480, 490, 500])],
});
{
  const ex = X.extractCompanyFacts("HBAN", hban);
  const fy = rev(ex, "2025-12-31"), q4 = rev(ex, "2025-12-31", "quarters"), q1 = rev(ex, "2025-03-31", "quarters");
  check("HBAN FY2025 reads 8,166M (NII 5,991 + NonII 2,175), not the 1,562M fee line",
    fy?.val === 8166 * M && fy?.derived === "computed", JSON.stringify(fy));
  check("...Q1 on the same basis (1,450 + 520)", q1?.val === 1970 * M && q1?.derived === "computed", JSON.stringify(q1));
  check("...the derived Q4 too: FY - 9M of each half (1,531 + 565)", Math.abs((q4?.val ?? 0) - 2096 * M) < 1 && q4?.derived === "computed", JSON.stringify(q4));
  const cells = [...ex.years, ...ex.quarters].map((p) => p.values[REV]).filter((c) => c?.val != null);
  check("no fee line left beside net revenue in the series", cells.length > 0 && cells.every((c) => c.derived === "computed"), cells.map((c) => c.derived).join(","));
  check("the note names the rule", (ex.notes ?? []).some((n) => /bank net basis/.test(n)));
}

console.log("\n2. a `Revenues` that is not net revenue is not taken");
{
  const zion = payload({
    [CONTRACT]: [Y(2025, 529), Y(2024, 510)], Revenues: [Y(2025, 662), Y(2024, 639)],
    [NII]: [Y(2025, 2627), Y(2024, 2470)], [NON]: [Y(2025, 758), Y(2024, 660)],
  });
  const z = rev(X.extractCompanyFacts("ZION", zion), "2025-12-31");
  check("ZION's 662M sub-line `Revenues` becomes 3,385M", z?.val === 3385 * M && z?.derived === "computed", JSON.stringify(z));
  const bbt = payload({ Revenues: [Y(2024, 400.0)], [NII]: [Y(2024, 300.0)], [NON]: [Y(2024, 55.2)] });
  const b = rev(X.extractCompanyFacts("BBT", bbt), "2024-12-31");
  check("BBT's gross 400.0M becomes 355.2M net", Math.abs((b?.val ?? 0) - 355.2 * M) < 1 && b?.derived === "computed", JSON.stringify(b));
  const rn = payload({ [CONTRACT]: [Y(2025, 900)], RevenuesNetOfInterestExpense: [Y(2025, 4010)], [NII]: [Y(2025, 3000)], [NON]: [Y(2025, 1000)] });
  const r = rev(X.extractCompanyFacts("RNIE", rn), "2025-12-31");
  check("a filed RevenuesNetOfInterestExpense within 2% is taken as filed", r?.val === 4010 * M && r?.tag === "RevenuesNetOfInterestExpense", JSON.stringify(r));
}

console.log("\n3. banks already on net revenue do not move");
{
  const key = payload({
    [CONTRACT]: [Y(2025, 1749), Y(2024, 1643)], Revenues: [Y(2025, 7513), Y(2024, 4619)],
    [NII]: [Y(2025, 4636), Y(2024, 3765)], [NON]: [Y(2025, 2842), Y(2024, 809)],
    IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: [Y(2025, 2304), Y(2024, -300)],
  });
  const ex = X.extractCompanyFacts("KEY", key);
  check("KEY keeps Revenues 7,513M / 4,619M (within 0.5% / 1% of its halves)",
    rev(ex, "2025-12-31")?.val === 7513 * M && rev(ex, "2024-12-31")?.val === 4619 * M && rev(ex, "2025-12-31")?.tag === "Revenues");
  check("...and the bank rule did not fire", !(ex.notes ?? []).some((n) => /bank net basis/.test(n)));
  const syf = payload({ [NII]: [Y(2025, 18466), Y(2024, 18011)], [NON]: [Y(2025, 520), Y(2024, 1521)] });
  const s = X.extractCompanyFacts("SYF", syf);
  check("SYF keeps its computed halves (18,986M)", rev(s, "2025-12-31")?.val === 18986 * M && !(s.notes ?? []).some((n) => /bank net basis/.test(n)));
}

console.log("\n4. no bank below its own net interest income");
{
  for (const [sym, facts] of [["HBAN", hban]]) {
    const ex = X.extractCompanyFacts(sym, facts);
    const bad = [...ex.years, ...ex.quarters].filter((p) => {
      const r = p.values[REV]?.val;
      const n = (facts.facts["us-gaap"][NII].units.USD.find((x) => x.start === p.start && x.end === p.end) ?? {}).val;
      return r != null && n != null && r < n;
    });
    check(`${sym}: every period at or above its NII`, bad.length === 0, bad.map((p) => p.end).join(","));
  }
}

console.log("\n5. it replaces, it does not backfill; USD filers only");
{
  // FY2024 carries no fee line: whatever the earlier rules leave there, the
  // block must leave too (USB 2020-21). FY2025's fee line still moves.
  const gap = payload({
    [CONTRACT]: [Y(2025, 1562), Y(2023, 1400)],
    [NII]: [Y(2025, 5991), Y(2024, 5450), Y(2023, 5100)], [NON]: [Y(2025, 2175), Y(2024, 1980), Y(2023, 1900)],
  });
  const start = extractRaw.indexOf("    // ── A BANK'S REVENUE IS ITS NET REVENUE (earnings audit r2)");
  const stop = extractRaw.indexOf("    // ── A DERIVED Q4 THAT CROSSES SCOPES IS WITHHELD");
  const XW = await load(extractRaw.slice(0, start) + extractRaw.slice(stop));
  const withB = X.extractCompanyFacts("GAP", gap), without = XW.extractCompanyFacts("GAP", gap);
  check("the fee line still moves (FY2025 8,166M)", rev(withB, "2025-12-31")?.val === 8166 * M, JSON.stringify(rev(withB, "2025-12-31")));
  check("an older period the earlier rules left as they did is left as they did (FY2024)",
    JSON.stringify(rev(withB, "2024-12-31") ?? null) === JSON.stringify(rev(without, "2024-12-31") ?? null),
    `${JSON.stringify(rev(withB, "2024-12-31"))} vs ${JSON.stringify(rev(without, "2024-12-31"))}`);
  // The newest years blank (FITB): filled, the gap the rule exists for.
  const head = payload({
    [CONTRACT]: [Y(2023, 577)],
    [NII]: [Y(2025, 5982), Y(2024, 5630), Y(2023, 5827)], [NON]: [Y(2025, 3035), Y(2024, 2849), Y(2023, 2881)],
  });
  const h = X.extractCompanyFacts("FITB", head);
  check("FITB-shaped: the newest years read net revenue (9,017M / 8,479M) and 2023 moves off its 577M fee line",
    rev(h, "2025-12-31")?.val === 9017 * M && rev(h, "2024-12-31")?.val === 8479 * M && rev(h, "2023-12-31")?.val === 8708 * M,
    [rev(h, "2025-12-31")?.val, rev(h, "2024-12-31")?.val, rev(h, "2023-12-31")?.val].join(","));
  // A 20-F bank in yen: its own presentation, not this rule's.
  const yen = JSON.parse(JSON.stringify(hban).replace(/"USD"/g, '"JPY"'));
  const j = X.extractCompanyFacts("MFG", yen);
  check("a non-USD filer is not touched (no bank net basis note, fee line kept)",
    !(j.notes ?? []).some((n) => /bank net basis/.test(n)) && rev(j, "2025-12-31")?.derived !== "computed",
    `${j.reportingCurrency} ${JSON.stringify(rev(j, "2025-12-31"))}`);
}

console.log("\n6. mutation");
{
  const start = extractRaw.indexOf("    // ── A BANK'S REVENUE IS ITS NET REVENUE (earnings audit r2)");
  const stop = extractRaw.indexOf("    // ── A DERIVED Q4 THAT CROSSES SCOPES IS WITHHELD");
  check("the block is where the mutation expects it", start > 0 && stop > start);
  const XM = await load(extractRaw.slice(0, start) + extractRaw.slice(stop));
  const m = rev(XM.extractCompanyFacts("HBAN", hban), "2025-12-31");
  check("MUTATION: without the block HBAN reads its 1,562M fee line again (caught)", m?.val === 1562 * M, JSON.stringify(m));
}

{
  const cut = (from, to = "") => {
    if (extractRaw.split(from).length !== 2) throw new Error(`mutation anchor not unique: ${from}`);
    return load(extractRaw.replace(from, to));
  };
  const gap = payload({
    [CONTRACT]: [Y(2025, 1562), Y(2023, 1400)],
    [NII]: [Y(2025, 5991), Y(2024, 5450), Y(2023, 5100)], [NON]: [Y(2025, 2175), Y(2024, 1980), Y(2023, 1900)],
  });
  const XB = await cut('              if (m.get("revenue")?.val == null && end <= newestValued) continue;\n');
  check("MUTATION: the no-backfill guard removed -> FY2024 filled with 7,430M (caught)",
    rev(XB.extractCompanyFacts("GAP", gap), "2024-12-31")?.val === 7430 * M);
  const XU = await cut('currency === "USD" && nii.n && non.n', "nii.n && non.n");
  const yen = JSON.parse(JSON.stringify(hban).replace(/"USD"/g, '"JPY"'));
  check("MUTATION: the USD gate removed -> the yen filer moves (caught)",
    rev(XU.extractCompanyFacts("MFG", yen), "2025-12-31")?.derived === "computed");
}

if (failures) {
  console.log(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nA bank's revenue is its net revenue.");
