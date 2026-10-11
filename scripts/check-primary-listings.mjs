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
    // the cover count is a number OF THAT CLASS: "N <class> as of <date>" (a
    // 20-F), or "As of <date>, there were N shares of … <class>" (a 10-K, whose
    // cover names the class without its par value: matched case-blind on the
    // class up to its first comma, and it must END the quote)
    && (new RegExp(`^[\\d,]+\\s+${escape(e.class)}\\s+as of\\b`).test(cover)
      || new RegExp(`^As of [A-Za-z]+ \\d{1,2}, \\d{4}, there were [\\d,]+ shares of .*\\b${escape(e.class.split(",")[0])}$`, "i").test(cover)
      // or a table row (SO's 10-K): "Shares Outstanding at <date> <registrant>
      // <par value clause> N", bound to the class by its par-value clause
      || (e.class.includes(",") && new RegExp(`^Shares Outstanding at [A-Za-z]+ \\d{1,2}, \\d{4} .*\\b${escape(e.class.split(",").slice(1).join(",").trim())} [\\d,]+$`, "i").test(cover)))
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

const cmcsa = MAP["0001166691"];
check("CMCSA: 'Class A Common Stock, $0.01 par value CMCSA …' and 'As of January 15, 2026, there were 3,588,401,619 shares of … Class A common stock'",
  cmcsa?.primary === "CMCSA" && entryOk("0001166691", cmcsa));
check("MUTATION: CMCSA's cover count swapped for the Class B count → caught",
  !entryOk("0001166691", { ...cmcsa, evidence: [cmcsa.evidence[0], "As of January 15, 2026, there were 9,444,375 shares of Comcast Corporation Class B common stock"] }));
check("MUTATION: CCZ (the exchangeable debentures) made the primary → caught",
  !entryOk("0001166691", { ...cmcsa, primary: "CCZ" }));

const so = MAP["0000092122"];
check("SO: 'Common Stock, par value $5 per share SO …' and the table row 'Shares Outstanding at January 31, 2026 The Southern Company Par Value $5 Per Share 1,119,391,291'",
  so?.primary === "SO" && entryOk("0000092122", so));
check("MUTATION: SO's count swapped for Alabama Power's row ('Par Value $40 Per Share 30,537,500') → caught",
  !entryOk("0000092122", { ...so, evidence: [so.evidence[0], "Shares Outstanding at January 31, 2026 Alabama Power Company Par Value $40 Per Share 30,537,500"] }));
check("MUTATION: SOMN (the corporate units) made the primary → caught",
  !entryOk("0000092122", { ...so, primary: "SOMN" }));

console.log("\n2. a debt ticker is refused, not valued");
// THE SHIPPED MODULE, its `@/data` JSON import inlined (bare Node has no alias).
const PSRC = fs.readFileSync("lib/server/secPrimaryListing.ts", "utf8");
const IMPORT = 'import listingsFile from "@/data/sec/primary-listings.json";';
if (!PSRC.includes(IMPORT)) throw new Error("secPrimaryListing no longer imports the map the expected way");
// Both maps inlined (bare Node has no @/ alias): the hand-cited entries and the census rows (#552 COWORK #64).
const IMPORT2 = 'import nonCommonFile from "@/data/sec/non-common-listings.json";';
if (!PSRC.includes(IMPORT2)) throw new Error("secPrimaryListing no longer imports the census rows the expected way");
// And the cited 20-F/40-F covers (#552 COWORK #86b), overridable for the fixtures below.
const IMPORT3 = 'import citedCoversFile from "@/data/sec/cited-covers.json";';
if (!PSRC.includes(IMPORT3)) throw new Error("secPrimaryListing no longer imports the cited covers the expected way");
const inline = (src, nonCommon = fs.readFileSync("data/sec/non-common-listings.json", "utf8"), cited = fs.readFileSync("data/sec/cited-covers.json", "utf8")) => src
  .replace(IMPORT, `const listingsFile = ${fs.readFileSync("data/sec/primary-listings.json", "utf8")};`)
  .replace(IMPORT2, `const nonCommonFile = ${nonCommon};`)
  .replace(IMPORT3, `const citedCoversFile = ${cited};`);
const ptmp = `lib/server/.check-pl-src-${process.pid}.ts`;
fs.writeFileSync(ptmp, inline(PSRC));
let P;
try { P = await import(`../${ptmp}`); } finally { fs.rmSync(ptmp, { force: true }); }
const V = await import("../lib/server/secValuation.ts");
const d = P.nonEquityListingOf("BIPI");
check("BIPI resolves to its class and BIP", d?.cls === "5.125% Perpetual Subordinated Notes" && d?.primary === "BIP", JSON.stringify(d));
check("BIP itself is not debt", P.nonEquityListingOf("BIP") === null);
const set = { symbol: "BIPI", quarters: [], years: [], instants: [], cover: { asOf: "2026-06-30", accession: null, filed: null, val: 460488788, derived: "as-filed" }, cur: "USD" };
const inp = V.valuationInputs(set, "2026-09-25", { annualForm: "20-F", nonEquity: d });
const cap = V.marketCap(inp, 35), pe = V.peRatio(inp, 35);
check("cap and P/E both refused as not the common stock, naming the class and BIP",
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
const ccz = P.nonEquityListingOf("CCZ"), cc2 = P.citedCoverFor("CMCSA");
check("CCZ resolves to '2.0% Exchangeable Subordinated Debentures due 2029' and CMCSA (#552 COWORK #61)",
  ccz?.cls === "2.0% Exchangeable Subordinated Debentures due 2029" && ccz?.primary === "CMCSA" && P.nonEquityListingOf("CMCSA") === null, JSON.stringify(ccz));
check("CMCSA: the 10-K cover wording parses to 3,588,401,619 as of 2026-01-15, with its accession",
  cc2?.val === 3588401619 && cc2.asOf === "2026-01-15" && cc2.source === "0001628280-26-004994", JSON.stringify(cc2));
check("CCZ gets no cited cover", P.citedCoverFor("CCZ") === null);
const somn = P.nonEquityListingOf("SOMN"), cc3 = P.citedCoverFor("SO");
check("SOMN resolves to '2025 Series A Corporate Units' and SO; the SOJx notes to SO; SO itself is common (#552 COWORK #63)",
  somn?.cls === "2025 Series A Corporate Units" && somn?.primary === "SO" && ["SOJC", "SOJD", "SOJE", "SOJF"].every((t) => P.nonEquityListingOf(t)?.primary === "SO") && P.nonEquityListingOf("SO") === null, JSON.stringify(somn));
check("SO: the 10-K table row parses to 1,119,391,291 as of 2026-01-31, with its accession",
  cc3?.val === 1119391291 && cc3.asOf === "2026-01-31" && cc3.source === "0000092122-26-000006", JSON.stringify(cc3));
const somnIn = V.valuationInputs({ ...set, symbol: "SOMN" }, "2026-09-27", { annualForm: "10-K", nonEquity: somn });
check("SOMN: cap and P/E refused, saying it is not the common stock and naming SO (not 'a debt security': these are units)",
  V.peRatio(somnIn, 30)?.why === "ticker-is-a-debt-security" && /Corporate Units, not its common stock; the common stock trades as SO/.test(V.peRatio(somnIn, 30)?.detail ?? ""), V.peRatio(somnIn, 30)?.detail);
const B_ANCHOR = "const b = line && !a ?";
if (PSRC.split(B_ANCHOR).length !== 2) throw new Error("10-K cover-wording mutation anchor must match once");
const ptmp2 = `lib/server/.check-pl-b-${process.pid}.ts`;
fs.writeFileSync(ptmp2, inline(PSRC).replace(B_ANCHOR, "const b = false && line && !a ?"));
let PB;
try { PB = await import(`../${ptmp2}`); } finally { fs.rmSync(ptmp2, { force: true }); }
const C_ANCHOR = "const c = line && !a && !b ?";
if (PSRC.split(C_ANCHOR).length !== 2) throw new Error("table cover-wording mutation anchor must match once");
const ptmp3 = `lib/server/.check-pl-c-${process.pid}.ts`;
fs.writeFileSync(ptmp3, inline(PSRC).replace(C_ANCHOR, "const c = false && line && !a && !b ?"));
let PC;
try { PC = await import(`../${ptmp3}`); } finally { fs.rmSync(ptmp3, { force: true }); }
check("MUTATION: the table cover wording not parsed → SO has no cited count (caught), CMCSA unchanged",
  PC.citedCoverFor("SO") === null && PC.citedCoverFor("CMCSA")?.val === 3588401619);
check("MUTATION: the 10-K cover wording not parsed → CMCSA has no cited count (caught), BIP unchanged",
  PB.citedCoverFor("CMCSA") === null && PB.citedCoverFor("BIP")?.val === 460488788);
const cczSet = { ...set, symbol: "CCZ", cover: { ...set.cover, val: 3588401619 } };
const cczIn = V.valuationInputs(cczSet, "2026-09-27", { annualForm: "10-K", nonEquity: ccz });
check("CCZ: cap and P/E refused as not the common stock, naming the debentures and CMCSA",
  V.marketCap(cczIn, 30)?.why === "ticker-is-a-debt-security" && V.peRatio(cczIn, 30)?.why === "ticker-is-a-debt-security"
  && /Exchangeable Subordinated Debentures.*CMCSA/.test(V.marketCap(cczIn, 30)?.detail ?? ""));
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

// ── 4. CITED 20-F / 40-F COVERS (#552 COWORK #86b) ───────────────────────────
console.log("\n4. cited 20-F/40-F covers (data/sec/cited-covers.json)");
const CITED = JSON.parse(fs.readFileSync("data/sec/cited-covers.json", "utf8")).entries ?? {};
const ROW_OK = (r) => (r.form === "20-F" || r.form === "40-F") && /^\d{10}-\d{2}-\d{6}$/.test(r.source) &&
  /^\d{4}-\d{2}-\d{2}$/.test(r.period) && /^\d{4}-\d{2}-\d{2}$/.test(r.filed) && r.filed >= r.period &&
  typeof r.class === "string" && r.class.length > 0 && P.coverQuoteHasCount(r);
const badRows = Object.entries(CITED).filter(([, r]) => !ROW_OK(r)).map(([s]) => s);
check(`every row is whole: form, accession, period ≤ filed, class, and a quote that prints its count (${Object.keys(CITED).length} rows)`,
  badRows.length === 0, badRows.join(" "));
const clash = Object.keys(CITED).filter((s) => Object.values(MAP).some((e) => e.primary === s));
check("no symbol is cited twice (a primary-listing entry and a cover row)", clash.length === 0, clash.join(" "));

// Fixtures, through the shipped module with the file swapped for one row each.
const fx = JSON.stringify({ entries: {
  NTRX: { form: "40-F", source: "0001725964-26-000010", filed: "2026-02-19", period: "2025-12-31", class: "Common Shares",
    count: 480123456, quote: "As at December 31, 2025, the registrant had 480,123,456 Common Shares outstanding." },
  EURX: { form: "20-F", source: "0001000184-26-000011", filed: "2026-03-01", period: "2025-12-31", class: "ordinary shares",
    count: 2345678901, quote: "2.345.678.901 ordinary shares of nominal value EUR 0.10 each" },
  BADX: { form: "20-F", source: "0001000184-26-000012", filed: "2026-03-01", period: "2025-12-31", class: "ordinary shares",
    count: 999000000, quote: "998,000,000 ordinary shares" },
} });
const ptmp4 = `lib/server/.check-pl-cc-${process.pid}.ts`;
fs.writeFileSync(ptmp4, inline(PSRC, undefined, fx));
let PCC;
try { PCC = await import(`../${ptmp4}`); } finally { fs.rmSync(ptmp4, { force: true }); }
const ntr = PCC.citedCoverFor("NTRX");
check("a 40-F common-shares row is read as the cited cover, as of its period", ntr?.val === 480123456 && ntr.asOf === "2025-12-31", JSON.stringify(ntr));
check("a European-printed count (dots) is read", PCC.citedCoverFor("EURX")?.val === 2345678901);
check("a row whose quote does not print its count is NOT used", PCC.citedCoverFor("BADX") === null);
check("a hand-cited primary-listing entry still wins for its own symbol", PCC.citedCoverFor("BIP")?.val === 460488788);
const QANCHOR = "!coverQuoteHasCount(r)) return null;";
if (PSRC.split(QANCHOR).length !== 2) throw new Error("quote-count mutation anchor must match once");
const ptmp5 = `lib/server/.check-pl-cc2-${process.pid}.ts`;
fs.writeFileSync(ptmp5, inline(PSRC, undefined, fx).replace(QANCHOR, "false) return null;"));
let PCM;
try { PCM = await import(`../${ptmp5}`); } finally { fs.rmSync(ptmp5, { force: true }); }
check("MUTATION: the quote-must-print-the-count rule removed → the mistyped row is used (caught)", PCM.citedCoverFor("BADX")?.val === 999000000);
// And through secValuation: newer-only still governs a cover row.
const ntrSet = { ...bipSet, symbol: "NTRX", cover: { asOf: "2021-12-31", accession: null, filed: null, val: 470000000, derived: "as-filed" } };
const ntrIn = V.valuationInputs(ntrSet, "2026-09-26", { annualForm: "40-F", citedCover: ntr });
check("a 40-F filer's stale dei count is replaced by the newer cited cover", ntrIn.shares?.val === 480123456 && !ntrIn.refusals.includes("share-count-is-stale"),
  JSON.stringify(ntrIn.shares) + " " + ntrIn.refusals.join(","));

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
