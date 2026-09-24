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

console.log("\n2b. the newest source wins (COWORK #45)");
{
  const H = "PURSUANT TO SECTION 12(b) OR (g). Securities registered or to be registered pursuant to Section 12(b) of the Act: Title of each class Trading Symbol(s) Name of each exchange on which registered ";
  const AZN20F = `${H}Ordinary Shares of US$0.25 each AZN The Nasdaq Stock Market LLC Securities registered pursuant to Section 12(g): None. Our ADS programme was terminated.`;
  const OLD_F6 = "American Depositary Shares evidenced by American Depositary Receipts, each American Depositary Share representing one-half of one ordinary share of AstraZeneca PLC.";
  const d = R.decideAdsRow(AZN20F, "AZN", OLD_F6, false);
  check("AZN: the latest 20-F's cover row (ordinary shares under AZN) beats the older F-6's one-half", "row" in d && d.row.kind === "ordinary" && d.row.ordinaryPerAds === 1, JSON.stringify(d));
  const TSM20F = `${H}Common Shares, par value NT$10 per share* American Depositary Shares, each representing 5 Common Shares TSM New York Stock Exchange`;
  const t = R.decideAdsRow(TSM20F, "TSM", null, false);
  check("TSM: the cover row is the ADS, ratio 5 from its own title", "row" in t && t.row.ordinaryPerAds === 5 && t.row.basis === "cover-row", JSON.stringify(t));
  check("an F-6 NEWER than the 20-F stating a different ratio → refused as a ratio change",
    "refuse" in R.decideAdsRow(TSM20F, "TSM", "each American Depositary Share representing ten common shares", true));
  check("no 20-F statement and only an OLDER F-6 → no row (the F-6 is not read)",
    "refuse" in R.decideAdsRow(`${H}Something else entirely`, "XYZ", OLD_F6, false));
  const T = (x) => `${H}${x} Securities registered or to be registered pursuant to Section 12(g) of the Act: None`;
  const VOD = T("Ordinary shares of 20 20/21 US cents each VOD* NASDAQ Stock Market LLC* American Depositary Shares, each representing 10 ordinary shares VOD NASDAQ Stock Market LLC *Not for trading, but only in connection with the registration of the American Depositary Shares");
  const v = R.decideAdsRow(VOD, "VOD", null, false);
  check("VOD: the ordinary line under the same ticker is the deposit ('not for trading'); the ADS row wins, 10", "row" in v && v.row.kind === "ads" && v.row.ordinaryPerAds === 10, JSON.stringify(v));
  const AZNN = T("0.700% Notes due 2026 AZN/26 Nasdaq Stock Market LLC Ordinary Shares of US$0.25 each AZN Nasdaq Stock Market LLC 3.125% Notes due 2027 AZN27 Nasdaq Stock Market LLC");
  const an = R.decideAdsRow(AZNN, "AZN", OLD_F6, false);
  check("AZN with notes listed first: a note's symbol (AZN/26, AZN27) is not the ticker; ordinary shares under AZN", "row" in an && an.row.kind === "ordinary", JSON.stringify(an));
  const IBN = T("Equity Shares, par value Rs.2 per share* New York Stock Exchange American Depositary Shares, each representing two equity shares IBN New York Stock Exchange");
  const ib = R.decideAdsRow(IBN, "IBN", null, false);
  check("IBN: 'each representing two equity shares' → 2", "row" in ib && ib.row.ordinaryPerAds === 2, JSON.stringify(ib));
  const Mo = await loadR(once(RSRC, "if (f6Text && f6IsNewer) {", "if (f6Text) {"));
  const dm = Mo.decideAdsRow(AZN20F, "AZN", OLD_F6, false);
  check("MUTATION: an older F-6 allowed to override the newer 20-F → AZN no longer reads as ordinary (caught)", !("row" in dm && dm.row.kind === "ordinary"), JSON.stringify(dm));
}

console.log("\n3. the committed map");
const MAP = JSON.parse(fs.readFileSync("data/sec/ads-ratios.json", "utf8")).entries;
const rowOk = (sym, e) => {
  if (!/^\d{10}-\d{2}-\d{6}$/.test(e.source) || !/^\d{4}-\d{2}-\d{2}$/.test(e.filed) || !e.evidence) return false;
  if (e.kind === "ordinary") return e.ordinaryPerAds === 1 && e.form === "20-F" && !/depositary|\bADSs?\b|preferred|preference/i.test(e.evidence)
    && /(?:ordinary|common)\s+(?:shares?|stock)|\bshares?\b/i.test(e.evidence);
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

console.log("\n4b. stale EPS and a changed share basis (COWORK #45)");
{
  const VS = fs.readFileSync("lib/server/secValuation.ts", "utf8");
  const loadMutant = async (src) => {
    const tmp = `lib/server/.check-ads-mut-${process.pid}-${Math.random().toString(36).slice(2)}.ts`;
    fs.writeFileSync(tmp, src);
    try { return await import(`../${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
  };
  const fy24 = period("2024-12-31", "2024-01-01", "FY", 2024, { epsDiluted: 45.25, sharesDiluted: 25.93e9, netIncome: 45.25 * 25.93e9 });
  const staleIn = V.valuationInputs(set(fy24), TODAY, { annualForm: "20-F", ads: ads5 });
  const stalePe = V.peRatio(staleIn, 452);
  check("TSM on FY2024 EPS (ended 21 months before today) → P/E withheld, with the date said",
    stalePe?.ok === false && stalePe.why === "eps-period-is-stale" && stalePe.detail === "the latest fiscal year on file ended 31 Dec 2024", JSON.stringify(stalePe));
  check("...the market cap is unaffected (it does not use EPS)", V.marketCap(staleIn, 452)?.ok === true);
  const q = (e, s2, eps) => period(e, s2, null, null, { epsDiluted: eps, sharesDiluted: 1e9, netIncome: eps * 1e9 });
  const dom = { symbol: "DOMX", quarters: [q("2025-03-31", "2025-01-01", 1), q("2024-12-31", "2024-10-01", 1), q("2024-09-30", "2024-07-01", 1), q("2024-06-30", "2024-04-01", 1)],
    years: [], instants: [], cover: { asOf: "2026-07-01", accession: null, filed: null, val: 1e9, derived: "as-filed" }, cur: "USD" };
  const domPe = V.peRatio(V.valuationInputs(dom, TODAY, { annualForm: "10-K" }), 50);
  check("every filer, not just 20-F: twelve months ending 2025-03-31 → withheld, 'twelve months' said",
    domPe?.ok === false && domPe.why === "eps-period-is-stale" && /twelve months on file ended 31 Mar 2025/.test(domPe.detail ?? ""), JSON.stringify(domPe));
  check("a current year (FY2025, 9 months old) still shows its P/E", V.peRatio(withR, 200)?.ok === true);
  const Ms = await loadMutant(once(VS, "if (eps && epsIsStale(eps.periodEnd, today)) {", "if (false) {"));
  check("MUTATION: the staleness guard removed → a stale EPS year still shows a P/E (caught)",
    Ms.peRatio(Ms.valuationInputs(set(fy24), TODAY, { annualForm: "20-F", ads: ads5 }), 452)?.ok === true);
  const split = period("2025-12-31", "2025-01-01", "FY", 2025, { epsDiluted: 45.25, sharesDiluted: 20e9, netIncome: 45.25 * 20e9 });
  const sp = V.peRatio(V.valuationInputs(set(split), TODAY, { annualForm: "20-F", ads: ads5 }), 200);
  check("cover 25.93bn against the EPS year's 20bn diluted shares (+30%) → refused as a changed basis", sp?.ok === false && sp.why === "share-basis-changed", JSON.stringify(sp));
  const Mb = await loadMutant(once(VS, "if (dil !== null && dil > 0 && Math.abs(shares.val / dil - 1) > SHARE_BASIS_MAX_MOVE) {", "if (false) {"));
  check("MUTATION: the share-basis guard removed → a P/E across the change (caught)",
    Mb.peRatio(Mb.valuationInputs(set(split), TODAY, { annualForm: "20-F", ads: ads5 }), 200)?.ok === true);
}

console.log("\n5. wiring: the stock page and the earnings page pass the cited ratio");
const snap = readCodeOnly("lib/server/secEarningsSnapshot.ts"), page = readCodeOnly("app/stock/[symbol]/earnings/page.tsx");
check("secEarningsSnapshot passes ads: adsRatioFor(clean)", /ads: adsRatioFor\(clean\)/.test(snap));
check("the earnings page passes ads: adsRatioFor(symbol)", /ads: adsRatioFor\(symbol\)/.test(page));

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
