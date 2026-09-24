// THE CITED ADS RATIO (#552 COWORK #22 §1).
//
//   1. The parser (lib/server/secAdsRatio.ts) reads the filer's own ratio
//      statement, in every phrasing measured, and nothing else. MUTATIONS:
//      the inverted-phrasing rule removed; the preceding-count guard removed.
//   2. Direct listings: cited only from a 12(b) row under the ticker, never
//      when the filing mentions depositary shares.
//   3. The committed map (data/sec/ads-ratios.json): every row's own evidence,
//      re-read by the shipped parser, yields its ratio — so a row cannot hold
//      a number its citation does not state. MUTATION: a wrong ratio caught.
//   4. valuationInputs: no ratio → the refusal, unchanged (never a default);
//      a cited ratio → shares in ADS-equivalents and EPS per ADS only when the
//      filer's own identity says EPS is per ordinary share. MUTATIONS: the
//      unit check removed (EPS already per ADS multiplied again); the refusal
//      lifted without a ratio.
//
//   node scripts/check-ads-ratios.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
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
const RSRC = readCodeOnly("lib/server/secAdsRatio.ts");
const R = await import("../lib/server/secAdsRatio.ts");
const loadR = (src) => lift(src.replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, ""));

console.log("1. the parser");
const CASES = [
  ["Each ADS represents five ordinary shares.", 5],
  ["Our ADSs, each representing one-half of one ordinary share, are listed on Nasdaq.", 0.5],
  ["American Depositary Shares (each representing four ordinary shares, no par value per share) AAPG Nasdaq", 4],
  ["“ADS” American Depositary Share representing one-fourth of one share of Common Stock.", 0.25],
  ["Each Class A ADS represents the right to receive one half of one Class A ordinary share of Grifols.", 0.5],
  ["Where ADSs are held, two ADSs represent one share.", 0.5],
  ["The ADSs are listed on the NYSE. Each ADS represents rights to five Class B Shares.", 5],
  ["FTL completed a registered secondary offering of 4,050,549 ADSs, each representing five Class B common shares of Telecom Argentina.", 5],
  ["American Depositary Shares, each representing 200 shares of common stock, without nominal value", 200],
  ["As of March 1, 1,234,567 ADSs were outstanding and the ADS price rose 5 percent.", null],
];
for (const [t, want] of CASES) {
  const got = R.adsRatioOf(`Intro. ${t} More.`);
  check(`${want ?? "none"} ← "${t.slice(0, 64)}…"`, want === null ? !got.ok : got.ok && Math.abs(got.ordinaryPerAds - want) < 1e-6,
    JSON.stringify(got.ok ? got.ordinaryPerAds : got.why));
}
check("two different ratios in one filing are left for a person, never averaged",
  R.adsRatioOf("Each ADS represents two shares. Each ADS represents five shares.").ok === false);
{
  const Mi = await loadR(once(RSRC, "ratio: (m) => { const a = parseCount(m[1]), b = parseCount(m[2]); return a && b ? b / a : null; } },", "ratio: () => null },"));
  check("MUTATION: the inverted rule removed → FMS's 'two ADSs represent one share' is no longer read as 0.5",
    (() => { const g = Mi.adsRatioOf("Where ADSs are held, two ADSs represent one share."); return !(g.ok && g.ordinaryPerAds === 0.5); })());
  const Mg = await loadR(once(RSRC, "{ re: new RegExp(String.raw`${PRECEDING_COUNT}${ADS}", "{ re: new RegExp(String.raw`${ADS}"));
  const g = Mg.adsRatioOf("Where ADSs are held, two ADSs represent one share.");
  check("MUTATION: the preceding-count guard removed → the same sentence reads 1 or disagrees (caught)", !(g.ok && g.ordinaryPerAds === 0.5), JSON.stringify(g));
}

console.log("\n2. direct listings");
const TABLE = "PURSUANT TO SECTION 12(b) OR (g) OF THE SECURITIES EXCHANGE ACT OF 1934 OR ANNUAL REPORT. Securities registered or to be registered pursuant to Section 12(b) of the Act: Title of each class Trading Symbol Name of each exchange on which registered Ordinary shares, nominal value €0.09 ASML The Nasdaq Stock Market LLC";
check("ordinary shares under the ticker in the 12(b) row → cited", /Ordinary shares, nominal value €0\.09 ASML/.test(R.directListingStatement(TABLE, "ASML") ?? ""));
check("Item 12.D 'American Depositary Shares Not applicable' still counts as direct", /ASML/.test(R.directListingStatement(`${TABLE} D. American Depositary Shares Not applicable.`, "ASML") ?? ""));
check("any mention of depositary shares → no direct listing", R.directListingStatement(`${TABLE} American Depositary Shares`, "ASML") === null);
check("a preferred share row is not the common listing", R.directListingStatement(TABLE.replace("Ordinary shares, nominal value €0.09 ASML", "Preferred shares, Series A ASML-PA"), "ASML") === null);

console.log("\n3. the committed map");
const MAP = JSON.parse(fs.readFileSync("data/sec/ads-ratios.json", "utf8")).entries;
const rowOk = (sym, e) => {
  if (!/^\d{10}-\d{2}-\d{6}$/.test(e.source) || !/^\d{4}-\d{2}-\d{2}$/.test(e.filed) || !e.evidence) return false;
  if (e.kind === "ordinary") return e.ordinaryPerAds === 1 && e.form === "20-F" && R.directListingStatement(`Securities registered or to be registered pursuant to Section 12(b) ${e.evidence}`, sym) !== null;
  if (e.kind !== "ads") return false;
  const got = R.adsRatioOf(e.evidence);
  return got.ok && Math.abs(got.ordinaryPerAds - e.ordinaryPerAds) < 1e-6;
};
const bad = Object.entries(MAP).filter(([k, e]) => !rowOk(k, e)).map(([k]) => k);
check(`every one of ${Object.keys(MAP).length} rows restates its ratio from its own quoted evidence`, bad.length === 0, bad.join(", "));
const first = Object.entries(MAP).find(([, e]) => e.kind === "ads");
if (first) check(`MUTATION: ${first[0]}'s ratio changed by one → caught`, !rowOk(first[0], { ...first[1], ordinaryPerAds: first[1].ordinaryPerAds + 1 }));

console.log("\n4. valuationInputs");
const V = await import("../lib/server/secValuation.ts");
const { SEC_FIELD_KEYS } = await import("../lib/server/secFields.ts");
const period = (e, s, fp, fy, vals) => ({ e, s, fp, fy, a: null, f: null, v: SEC_FIELD_KEYS.map((k) => vals[k] ?? null), d: "" });
// TSM-shaped: FY2025 per-ORDINARY EPS 45.25, 25.93bn ordinary shares, identity 1.
const yearOrd = period("2025-12-31", "2025-01-01", "FY", 2025, { epsDiluted: 45.25, sharesDiluted: 25.93e9, netIncome: 45.25 * 25.93e9 });
const set = (y) => ({ symbol: "TSM", quarters: [], years: [y], instants: [], cover: { asOf: "2026-02-28", accession: null, filed: null, val: 25.93e9, derived: "as-filed" }, cur: "USD" });
const TODAY = "2026-09-24";
const none = V.valuationInputs(set(yearOrd), TODAY, { annualForm: "20-F" });
check("no cited ratio → both depositary refusals, as before (never a default of 1)",
  none.refusals.includes("ads-ratio-makes-shares-incomparable") && V.marketCap(none, 100).ok === false && V.peRatio(none, 100).ok === false);
const ads5 = { ordinaryPerAds: 5, source: "0001628280-26-025362" };
const withR = V.valuationInputs(set(yearOrd), TODAY, { annualForm: "20-F", ads: ads5 });
const cap = V.marketCap(withR, 200), pe = V.peRatio(withR, 200);
check("TSM: cap = ADS price x ordinary / 5 = (price / 5) x ordinary", cap?.ok && Math.abs(cap.val - 200 * 25.93e9 / 5) < 1, JSON.stringify(cap));
check("TSM: P/E = (ADS price / 5) / EPS per ordinary share", pe?.ok && Math.abs(pe.val - (200 / 5) / 45.25) < 1e-9, JSON.stringify(pe));
const yearAds = period("2025-12-31", "2025-01-01", "FY", 2025, { epsDiluted: 45.25 * 5, sharesDiluted: 25.93e9, netIncome: 45.25 * 25.93e9 });
const perAds = V.valuationInputs(set(yearAds), TODAY, { annualForm: "20-F", ads: ads5 });
check("EPS the filer already states per ADS (identity ~5) is used as filed", Math.abs(V.peRatio(perAds, 200).val - 200 / (45.25 * 5)) < 1e-9);
const odd = period("2025-12-31", "2025-01-01", "FY", 2025, { epsDiluted: 45.25 * 3, sharesDiluted: 25.93e9, netIncome: 45.25 * 25.93e9 });
check("EPS in neither unit (identity ~3) → refused, not guessed", V.peRatio(V.valuationInputs(set(odd), TODAY, { annualForm: "20-F", ads: ads5 }), 200).ok === false);
{
  // A MUTATED COPY BESIDE THE ORIGINAL, so its relative imports resolve; removed in a finally.
  const VS = fs.readFileSync("lib/server/secValuation.ts", "utf8");
  const loadMutant = async (src) => {
    const tmp = `lib/server/.check-ads-mut-${process.pid}-${Math.random().toString(36).slice(2)}.ts`;
    fs.writeFileSync(tmp, src);
    try { return await import(`../${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
  };
  const Mu = await loadMutant(once(VS, "const unit = epsUnitOf(unitPeriod, ads.ordinaryPerAds);", `const unit = "ordinary" as const; void unitPeriod;`));
  const bad = Mu.peRatio(Mu.valuationInputs(set(yearAds), TODAY, { annualForm: "20-F", ads: ads5 }), 200);
  check("MUTATION: the EPS unit check removed → per-ADS EPS multiplied again, P/E 5x too low (caught)",
    bad.ok && Math.abs(bad.val - 200 / (45.25 * 25)) < 1e-9 && Math.abs(bad.val - V.peRatio(perAds, 200).val) > 1e-6);
  const Md = await loadMutant(once(VS, `if (!ads && (sharesAreIncomparableToPrice(set.symbol) || filer.annualForm === "20-F")) {`, `if (false && (sharesAreIncomparableToPrice(set.symbol) || filer.annualForm === "20-F")) {`));
  check("MUTATION: the refusal lifted without a cited ratio → a cap in the wrong unit appears (caught)",
    Md.marketCap(Md.valuationInputs(set(yearOrd), TODAY, { annualForm: "20-F" }), 100)?.ok === true);
}

console.log("\n5. wiring: the stock page and the earnings page pass the cited ratio");
const snap = readCodeOnly("lib/server/secEarningsSnapshot.ts"), page = readCodeOnly("app/stock/[symbol]/earnings/page.tsx");
check("secEarningsSnapshot passes ads: adsRatioFor(clean)", /ads: adsRatioFor\(clean\)/.test(snap));
check("the earnings page passes ads: adsRatioFor(symbol)", /ads: adsRatioFor\(symbol\)/.test(page));

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
