// THE PRIMARY LISTING PER SHARED CIK (#552 COWORK #48/#55), run and mutated.
//   1. every entry is cited: its 12(b) row names the primary's ticker and class,
//      and its cover count is OF THAT CLASS (the stored listing carries the
//      cover class, which COWORK #55 asked to be checked, not assumed);
//   2. a debt ticker (BIPI, "5.125% Perpetual Subordinated Notes") gets no cap
//      and no P/E, and says which listing the equity trades as;
//   3. the SEC universe includes every primary (BIP was in no list).
import "./lib/register-ts-here.mjs";
import fs from "node:fs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const MAP = JSON.parse(fs.readFileSync("data/sec/primary-listings.json", "utf8")).entries;
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;

console.log("\n1. every entry is cited, and its cover count is of the primary's class");
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const entryOk = (cik, e) => {
  const [row, cover] = e.evidence ?? [];
  return Boolean(row && cover && e.source && e.class && e.primary)
    // the 12(b) row: class, then the primary's ticker
    && new RegExp(`^${escape(e.class)}\\s+${escape(e.primary)}\\b`).test(row)
    // the cover count is a number OF THAT CLASS
    && new RegExp(`^[\\d,]+\\s+${escape(e.class)}\\s+as of\\b`).test(cover)
    // the primary and every debt ticker belong to this CIK
    && [e.primary, ...Object.keys(e.nonEquity ?? {})].every((t) => !REG[t] || String(REG[t].cik).padStart(10, "0") === cik)
    // no ticker is both the primary and debt
    && !(e.primary in (e.nonEquity ?? {}));
};
const bad = Object.entries(MAP).filter(([cik, e]) => !entryOk(cik, e)).map(([cik]) => cik);
check(`all ${Object.keys(MAP).length} entries cite a 12(b) row and a cover count of the primary's class`, bad.length === 0, bad.join(", "));
const bip = MAP["0001406234"];
check("BIP: 'Limited Partnership Units BIP …' and '460,488,788 Limited Partnership Units as of …'", bip?.primary === "BIP" && entryOk("0001406234", bip));
check("MUTATION: a cover count of another class (preferred units) → caught",
  !entryOk("0001406234", { ...bip, evidence: [bip.evidence[0], "8,000,000 Class A Preferred Limited Partnership Units, Series 13 as of December 31, 2025"] }));
check("MUTATION: the primary set to a note's ticker (BIPI) → caught",
  !entryOk("0001406234", { ...bip, primary: "BIPI" }));

console.log("\n2. a debt ticker is refused, not valued");
// THE SHIPPED MODULE, its `@/data` JSON import inlined (bare Node has no alias).
const PSRC = fs.readFileSync("lib/server/secPrimaryListing.ts", "utf8");
const IMPORT = 'import listingsFile from "@/data/sec/primary-listings.json";';
if (!PSRC.includes(IMPORT)) throw new Error("secPrimaryListing no longer imports the map the expected way");
const ptmp = `lib/server/.check-pl-src-${process.pid}.ts`;
fs.writeFileSync(ptmp, PSRC.replace(IMPORT, `const listingsFile = ${fs.readFileSync("data/sec/primary-listings.json", "utf8")};`));
let P;
try { P = await import(`../${ptmp}`); } finally { fs.rmSync(ptmp, { force: true }); }
const V = await import("../lib/server/secValuation.ts");
const d = P.nonEquityListingOf("BIPI");
check("BIPI resolves to its class and BIP", d?.cls === "5.125% Perpetual Subordinated Notes" && d?.primary === "BIP", JSON.stringify(d));
check("BIP itself is not debt", P.nonEquityListingOf("BIP") === null);
const set = { symbol: "BIPI", quarters: [], years: [], instants: [], cover: { asOf: "2026-06-30", accession: null, filed: null, val: 460488788, derived: "as-filed" }, cur: "USD" };
const inp = V.valuationInputs(set, "2026-09-25", { annualForm: "20-F", nonEquity: d });
const cap = V.marketCap(inp, 35), pe = V.peRatio(inp, 35);
check("cap and P/E both refused as a debt security, naming the class and BIP",
  cap?.ok === false && pe?.ok === false && cap.why === "ticker-is-a-debt-security" && /5\.125% Perpetual Subordinated Notes.*BIP/.test(cap.detail ?? ""), JSON.stringify(cap));
const VS = fs.readFileSync("lib/server/secValuation.ts", "utf8");
const tmp = `lib/server/.check-pl-mut-${process.pid}.ts`;
fs.writeFileSync(tmp, VS.replace("  if (filer.nonEquity) {\n", "  if (false) {\n"));
let M;
try { M = await import(`../${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
const mIn = M.valuationInputs(set, "2026-09-25", { annualForm: "20-F", nonEquity: d });
check("MUTATION: the debt guard removed → a note's ticker is valued like equity (caught)",
  M.marketCap(mIn, 35)?.why !== "ticker-is-a-debt-security");

console.log("\n2b. the cover count cited from the primary's own 20-F (#552 COWORK #56)");
const cc = P.citedCoverFor("BIP");
check("BIP: 460,488,788 as of 2025-12-31, parsed from the evidence line, with its accession",
  cc?.val === 460488788 && cc.asOf === "2025-12-31" && cc.source === "0001406234-26-000002" && cc.quote === bip.evidence[1], JSON.stringify(cc));
check("a debt ticker gets no cited cover", P.citedCoverFor("BIPI") === null && P.citedCoverFor("BIPH") === null);
const ADS = JSON.parse(fs.readFileSync("data/sec/ads-ratios.json", "utf8")).entries;
check("BIP is in the ADS map as directly listed (ordinary, 1), cited to the same 20-F",
  ADS.BIP?.kind === "ordinary" && ADS.BIP.ordinaryPerAds === 1 && ADS.BIP.source === bip.source && bip.evidence[0].startsWith(ADS.BIP.evidence));
// BIP's stored dei count: 295,429,987 as of 2020 (refused as stale on its own).
const bipSet = { symbol: "BIP", quarters: [], years: [], instants: [], cur: "USD",
  cover: { asOf: "2020-12-31", accession: "dei", filed: "2021-03-01", val: 295429987, derived: "as-filed" } };
const bipFiler = { annualForm: "20-F", ads: ADS.BIP, citedCover: cc };
const bi = V.valuationInputs(bipSet, "2026-09-26", bipFiler);
check("BIP: the cited 2025 count replaces the 2020 dei count, and the share count is current",
  bi.shares?.val === 460488788 && bi.shares.asOf === "2025-12-31" && !bi.refusals.includes("share-count-is-stale"), JSON.stringify(bi.shares) + " " + bi.refusals.join(","));
check("...without the cited count the 2020 dei count is refused as stale (the gap this closes)",
  V.valuationInputs(bipSet, "2026-09-26", { ...bipFiler, citedCover: null }).refusals.includes("share-count-is-stale"));
const newerDei = { ...bipSet, cover: { ...bipSet.cover, asOf: "2026-06-30", val: 461000000 } };
check("a dei count NEWER than the cited one keeps its place",
  V.valuationInputs(newerDei, "2026-09-26", bipFiler).shares?.val === 461000000);
const tmp2 = `lib/server/.check-pl-cov-${process.pid}.ts`;
const ANCHOR = "(!set.cover?.asOf || cited.asOf > set.cover.asOf)";
if (VS.split(ANCHOR).length !== 2) throw new Error("cited-cover mutation anchor must match once");
fs.writeFileSync(tmp2, VS.replace(ANCHOR, "(!set.cover?.asOf || cited.asOf < set.cover.asOf)"));
let M2;
try { M2 = await import(`../${tmp2}`); } finally { fs.rmSync(tmp2, { force: true }); }
const older = M2.valuationInputs(bipSet, "2026-09-26", bipFiler);
check("MUTATION: the older count wins → BIP is back on the 2020 count, refused as stale (caught)",
  older.shares === null && older.refusals.includes("share-count-is-stale"), JSON.stringify(older.shares));

console.log("\n3. wiring");
const route = fs.readFileSync("app/api/jobs/sec-daily-index/route.ts", "utf8");
check("the SEC universe includes every cited primary", /\.\.\.primaryListingSymbols\(\)/.test(route) && P.primaryListingSymbols().includes("BIP"));
const snap = fs.readFileSync("lib/server/secEarningsSnapshot.ts", "utf8"), page = fs.readFileSync("app/stock/[symbol]/earnings/page.tsx", "utf8");
check("both valuation callers pass nonEquity", /nonEquity: nonEquityListingOf\(clean\)/.test(snap) && /nonEquity: nonEquityListingOf\(symbol\)/.test(page));
check("...and both pass the cited cover", /citedCover: citedCoverFor\(clean\)/.test(snap) && /citedCover: citedCoverFor\(symbol\)/.test(page));

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
