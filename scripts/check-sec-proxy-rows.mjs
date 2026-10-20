// A PROXY STATEMENT IS NOT A FINANCIAL STATEMENT (earnings audit r2).
//
// The pay-versus-performance table tags NetIncomeLoss in DEF 14A / PRE 14A,
// filed after the 10-K, so it won the frame on newest-filed. The rows below are
// SCHW's and MET's own (relay field-trace, run 39476118394), in $M:
//   SCHW FY2024: 10-K 0000316709-25-000010 5,942.0; DEF 14A 0001193125-26-142826 5.942
//   MET  FY2022: 10-K 0001099219-24-000035 5,284.0 (restated); DEF 14A
//        0001099219-26-000026 2,354.0 (net income to common)
// Pinned: both read their 10-K figure, a 10-K filed after a proxy still wins as
// usual, a concept tagged ONLY in a proxy reads as absent, and the mutation that
// drops the filter is caught.
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
const NI = X.SEC_FIELD_KEYS.indexOf("netIncome");
const M = 1e6;
// concept -> [start, end, $M, form, fy, fp, filed, accn]
const facts = (byTag) => ({ cik: 1, entityName: "Fixture", facts: { "us-gaap": Object.fromEntries(Object.entries(byTag).map(([tag, rows]) =>
  [tag, { units: { USD: rows.map(([start, end, v, form, fy, fp, filed, accn]) => ({ start, end, val: v * M, form, fy, fp, filed, accn })) } }])) } });
const ni = (ex, end) => ex.years.find((p) => p.end === end)?.values?.[NI]?.val ?? null;

console.log("1. SCHW: the proxy's 5.942 does not displace the 10-K's 5,942.0");
const SCHW = facts({ NetIncomeLoss: [
  ["2023-01-01", "2023-12-31", 5067.0, "10-K", 2024, "FY", "2025-02-26", "0000316709-25-000010"],
  ["2024-01-01", "2024-12-31", 5942.0, "10-K", 2024, "FY", "2025-02-26", "0000316709-25-000010"],
  ["2023-01-01", "2023-12-31", 5.067, "DEF 14A", null, null, "2026-04-06", "0001193125-26-142826"],
  ["2024-01-01", "2024-12-31", 5.942, "DEF 14A", null, null, "2026-04-06", "0001193125-26-142826"],
] });
const s = X.extractCompanyFacts("SCHW", SCHW);
check("FY2024 reads 5,942.0", ni(s, "2024-12-31") === 5942 * M, String(ni(s, "2024-12-31")));
check("FY2023 reads 5,067.0", ni(s, "2023-12-31") === 5067 * M, String(ni(s, "2023-12-31")));

console.log("\n2. MET: the proxy's net income to common (2,354.0) does not displace the restated 10-K (5,284.0)");
const MET = facts({ NetIncomeLoss: [
  ["2022-01-01", "2022-12-31", 2539.0, "10-K", 2022, "FY", "2023-02-23", "0001099219-23-000045"],
  ["2022-01-01", "2022-12-31", 5284.0, "10-K", 2023, "FY", "2024-02-16", "0001099219-24-000035"],
  ["2022-01-01", "2022-12-31", 2354.0, "PRE 14A", null, null, "2026-04-20", "0001099219-26-000020"],
  ["2022-01-01", "2022-12-31", 2354.0, "DEF 14A", null, null, "2026-04-29", "0001099219-26-000026"],
] });
check("FY2022 reads 5,284.0", ni(X.extractCompanyFacts("MET", MET), "2022-12-31") === 5284 * M);

console.log("\n3. the ordinary rules are untouched");
const later = facts({ NetIncomeLoss: [
  ["2024-01-01", "2024-12-31", 9.0, "DEF 14A", null, null, "2025-04-01", "a"],
  ["2024-01-01", "2024-12-31", 900.0, "10-K/A", 2024, "FY", "2025-06-01", "b"],
] });
check("a 10-K/A filed after the proxy still reads", ni(X.extractCompanyFacts("X", later), "2024-12-31") === 900 * M);
const only = facts({ NetIncomeLoss: [["2024-01-01", "2024-12-31", 7.0, "DEF 14A", null, null, "2025-04-01", "a"]] });
check("a concept tagged only in a proxy reads as absent", ni(X.extractCompanyFacts("X", only), "2024-12-31") === null);
check("a payload with a proxy row is copied, not mutated", X.withoutProxyRows(SCHW) !== SCHW && SCHW.facts["us-gaap"].NetIncomeLoss.units.USD.length === 4);
{
  const plain = facts({ NetIncomeLoss: [["2024-01-01", "2024-12-31", 1, "10-K", 2024, "FY", "2025-01-01", "c"]] });
  check("...and untouched when there is no proxy row", X.withoutProxyRows(plain) === plain);
}

console.log("\n4. mutation");
{
  const src = extractRaw.replace("const facts = withoutProxyRows(factsIn);", "const facts = factsIn;");
  check("the mutation is applied", src !== extractRaw);
  const Xm = await load(src);
  check("MUTATION: filter dropped → SCHW FY2024 back to 5.942, caught", ni(Xm.extractCompanyFacts("SCHW", SCHW), "2024-12-31") !== 5942 * M);
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
