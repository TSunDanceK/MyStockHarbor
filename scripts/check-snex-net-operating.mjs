// A FILER WHOSE REVENUE IS ITS NET OPERATING REVENUE (owner ruling, earnings
// audit r2).
//
// StoneX's `Revenues` is gross of physical commodity sales (132,378.2M FY2025);
// its own headline, net operating revenues, is filed as
// RevenuesNetOfInterestExpense (2,052.8M FY2025, accn 0000913760-25-000196).
// A filer in REVENUE_IS_NET_OPERATING reads that concept for every year and
// quarter, and a period without it reads Not reported, so the series has one
// basis. Pinned on a companyfacts-shaped payload from SNEX's own filings ($M,
// fiscal year to September):
//   FY2025 2,052.8 · Q1-Q3 492.1 / 487.3 / 488.3 · Q4 = 2,052.8 - 1,467.7 = 585.1
// plus: every cell on the one concept, a Revenues-only period left Not
// reported (no gross beside net), the rule scoped to the list (an unlisted
// filer with the same rows reads `Revenues`), and two mutations: the block
// removed (FY2025 back to 132,378.2), and the blanking removed (a gross
// quarter beside net ones).
//
//   node scripts/check-snex-net-operating.mjs
import fs from "node:fs";
import { lift } from "./lib/earnings-plan.mjs";

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
const NET = "RevenuesNetOfInterestExpense";
const row = (start, end, val, form, filed) => ({ start, end, val, accn: "0000913760-26-000001", fy: 2025, fp: form === "10-K" ? "FY" : "Q3", form, filed });
/** { tag: [[start, end, $M], ...] } -> companyfacts. A ~year is a 10-K row, anything shorter a 10-Q row. */
const payload = (tags) => ({
  cik: 913760, entityName: "Fixture",
  facts: { "us-gaap": Object.fromEntries(Object.entries(tags).map(([tag, rows]) => [tag, {
    units: { USD: rows.map(([s, e, v]) => {
      const year = (Date.parse(e) - Date.parse(s)) / 864e5 > 300;
      return row(s, e, v * M, year ? "10-K" : "10-Q", year ? "2025-11-28" : "2025-08-05");
    }) },
  }])) },
});
// FY2025 (October 2024 to September 2025), its three quarters and nine months.
const fy25 = (fy, q) => [
  ["2024-10-01", "2025-09-30", fy], ["2024-10-01", "2024-12-31", q[0]], ["2024-12-31", "2025-03-31", q[1]],
  ["2025-03-31", "2025-06-30", q[2]], ["2024-10-01", "2025-06-30", q[0] + q[1] + q[2]],
];
const SNEX = payload({
  Revenues: [...fy25(132378.2, [27935.3, 36890.7, 34828.8]), ["2025-10-01", "2025-12-31", 39029.9]],
  [NET]: fy25(2052.8, [492.1, 487.3, 488.3]),
});
const rev = (ex, end, kind = "years") => ex[kind].find((p) => p.end === end)?.values?.[REV];
const near = (c, v) => c?.val != null && Math.abs(c.val - v * M) < 1;

console.log("1. SNEX reads net operating revenues for years and quarters");
{
  const ex = X.extractCompanyFacts("SNEX", SNEX);
  const fy = rev(ex, "2025-09-30");
  check("FY2025 reads 2,052.8 (net operating revenues), not 132,378.2 gross", near(fy, 2052.8) && fy?.tag === NET, JSON.stringify(fy));
  check("Q1-Q3 FY2025 read 492.1 / 487.3 / 488.3",
    near(rev(ex, "2024-12-31", "quarters"), 492.1) && near(rev(ex, "2025-03-31", "quarters"), 487.3) && near(rev(ex, "2025-06-30", "quarters"), 488.3));
  const q4 = rev(ex, "2025-09-30", "quarters");
  check("Q4 FY2025 = 2,052.8 - 1,467.7 = 585.1, differenced on the same concept", near(q4, 585.1) && q4?.tag === NET, JSON.stringify(q4));
  check("a period with gross `Revenues` and no net figure reads Not reported (Q1 FY2026)",
    rev(ex, "2025-12-31", "quarters")?.val == null, JSON.stringify(rev(ex, "2025-12-31", "quarters")));
  const cells = [...ex.years, ...ex.quarters].map((p) => p.values[REV]).filter((c) => c?.val != null);
  check("one basis: every valued cell is RevenuesNetOfInterestExpense", cells.length === 5 && cells.every((c) => c.tag === NET), cells.map((c) => c.tag).join(","));
  check("the note names the rule", (ex.notes ?? []).some((n) => /net operating revenues/.test(n)));
}

console.log("\n2. scoped to the list");
{
  const ex = X.extractCompanyFacts("FIXT", SNEX);
  check("an unlisted filer with the same rows keeps `Revenues` (FY2025 132,378.2)", near(rev(ex, "2025-09-30"), 132378.2), JSON.stringify(rev(ex, "2025-09-30")));
}

console.log("\n3. mutations");
{
  const XB = await load(once(extractRaw, "if (REVENUE_IS_NET_OPERATING.has(symbol.toUpperCase())) {", "if (false) {"));
  check("MUTATION: without the block SNEX's FY2025 reads gross 132,378.2 (caught)",
    near(rev(XB.extractCompanyFacts("SNEX", SNEX), "2025-09-30"), 132378.2));
  const XK = await load(once(extractRaw, `          else if (m.has("revenue")) { m.delete("revenue"); blanked++; }\n        }\n      }\n      notes.push(\`revenue: net operating revenues`,
    `        }\n      }\n      notes.push(\`revenue: net operating revenues`));
  check("MUTATION: without the blanking a gross quarter sits beside net ones (caught)",
    near(rev(XK.extractCompanyFacts("SNEX", SNEX), "2025-12-31", "quarters"), 39029.9));
}

if (failures) {
  console.log(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nSNEX reads net operating revenues for every period, on one basis.");
