// THE /stock "ABOUT" BLOCK IS COMPOSED FROM FREE SOURCES — asserted by running it.
//
// Brief 2026-09-22 PR 2. What must hold, each paired with a mutation that
// breaks it (a check that cannot fail reports PASS and proves nothing):
//
//   1. No FMP attribution reaches a reader at all: the description is the
//      company's own annual-report wording with its filing named under it,
//      and no description means no paragraph (PR 3, #518).
//   2. A market-cap refusal HIDES the row; it is never printed in the card.
//   3. Every 20-F filer's cap is refused — AZN and ABVX included, which the
//      five-name list missed (§2.6).
//   4. The 52-week range is the high/low of the last 252 bars, not all bars.
//   5. Country is the headquarters' country, via EDGAR's own code table.
//   6. The share-dilution series comes from the stored set's sharesBasic, and
//      the chart's footer names SEC, not FMP.
//   7. IPO date and Website are hidden by the registry, not by a missing value.
//
// NO FIXTURE SUPPLIES AN EXPECTED VALUE: data/sec/factset-fixture-*.json and
// data/sec/registrants.json come from SEC via the shipped code.
import fs from "node:fs";
import ts from "typescript";
import { grabConst } from "./lib/source-code.mjs";
import { loadProfile, html, visibleText, once, React } from "./lib/render-snapshot.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const read = (f) => fs.readFileSync(f, "utf8");
const strip = (f) =>
  read(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "").replace(/^export \* from "\.\/[^"]+";$/gm, "");

/** The composer and its pure dependencies, as one transpiled unit. */
async function loadComposer(mutate = (s) => s) {
  const unit = [
    read("lib/server/secFields.ts"),
    strip("lib/server/secExtract.ts"),
    strip("lib/server/fxRates.ts"),
    strip("lib/server/secCurrency.ts"),
    strip("lib/server/secFactCodec.ts"),
    strip("lib/server/secEarningsView.ts"),
    grabConst("lib/server/secReportDates.ts", "DEADLINE_FALLBACK"),
    strip("lib/server/secValuation.ts"),
    strip("lib/server/secShareHistory.ts"),
    read("lib/symbolSpellings.mjs").replace(/^export /gm, ""),
    `const registrantsFile = ${read("data/sec/registrants.json")};`,
    `const locationFile = ${read("data/sec/edgar-location-codes.json")};`,
    // exchangeFor is not exercised here (the test passes `exchange` in); a stub
    // keeps the unit loadable without the ticker file's fs/Redis path.
    "const loadTickerMap = () => ({ map: new Map() });",
    // The composer's attribution helper; the committed rows are not read here.
    "const descriptionsFile = { rows: {}, misses: {} };",
    strip("lib/server/filingDescription.ts"),
    strip("lib/server/stockProfile.ts"),
  ].join("\n");
  const js = ts.transpileModule(mutate(unit), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const tmp = `scripts/.check-stock-profile-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`;
  fs.writeFileSync(tmp, js);
  try { return await import(`${process.cwd()}/${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
}

const fixture = (sym) => JSON.parse(read(`data/sec/factset-fixture-${sym}.json`));
const TODAY = "2026-09-22";
const bars = (n, fn) => Array.from({ length: n }, (_, i) => ({ date: `d${i}`, close: fn(i) }));
const taxonomy = { sector: "Technology", industry: "Consumer Electronics", source: "snapshot", sectorSource: "fmp-snapshot", industrySource: "fmp-snapshot" };

const FILED = {
  text: "Apple designs, manufactures and markets smartphones and personal computers.\n\niPhone® is the Company’s line of smartphones.",
  form: "10-K", filedOn: "2025-10-31", accession: "0000320193-25-000079",
};
const M = await loadComposer();
const compose = (mod, sym, over = {}) => {
  const set = fixture(sym);
  return mod.composeCompanyProfile({
    symbol: sym, directoryName: "", snapshotName: "", entityName: set.entityName,
    filingDescription: FILED, taxonomy,
    valuation: mod.valuationInputs(set, TODAY, { annualForm: mod.registrantFor(sym)?.annualForm ?? null }),
    price: 200, points: bars(300, (i) => 100 + i), exchange: "NASDAQ",
    registrant: mod.registrantFor(sym), ...over,
  });
};

const P = await loadProfile();
const noDividend = { state: "none", perShare: null, periodLabel: null, why: "test" };
const render = (mod, profile, sym) =>
  visibleText(html(React.createElement(mod.default, { profile, symbol: sym, dividend: noDividend })));

console.log("\n1. no FMP attribution; the description is the company's own, with its filing named");
{
  const aapl = compose(M, "AAPL", { directoryName: "Apple Inc." });
  const t = render(P, aapl, "AAPL");
  check("no FMP mention anywhere in the block", !/Financial Modeling Prep|FMP/.test(t));
  check("the attribution is the owner's wording", /From Apple Inc\.'s 10-K, filed Oct 2025/.test(t));
  const h = html(React.createElement(P.default, { profile: aapl, symbol: "AAPL", dividend: noDividend }));
  check("each paragraph is its own <p>, camel-case start kept",
    /<p[^>]*>Apple designs[^<]*<\/p><p[^>]*>iPhone® is the Company’s line of smartphones\.<\/p>/.test(h));
  check("the other rows credit SEC EDGAR and market data",
    /Market cap: shares from SEC EDGAR/.test(t) && /Exchange: SEC EDGAR/.test(t) && /Country: SEC EDGAR/.test(t), "");
  const none = compose(M, "AAPL", { filingDescription: null });
  const noDesc = render(P, none, "AAPL");
  check("no filing description → no paragraph, no attribution, no FMP",
    none.description === null && none.descriptionAttribution === null &&
      !/From .*'s (10-K|20-F)/.test(noDesc) && !/Financial Modeling Prep|FMP/.test(noDesc) && !/Apple designs/.test(noDesc));
  check("dates are month-year, parsed without a time zone",
    M.monthYear("2026-01-01") === "Jan 2026" && M.monthYear("2025-12-31") === "Dec 2025" && M.monthYear("bad") === null);
  const old = await loadProfile(once(
    "? `${profile.sources.map((s) => `${s.field}: ${s.source}`).join(\" · \")}.`",
    "? `Company profile data from Financial Modeling Prep.`"
  ));
  check("...and CATCHES the blanket FMP line put back",
    (render(old, none, "AAPL").match(/Financial Modeling Prep/g) ?? []).length > 0);
  const unattributed = await loadComposer(once(
    "descriptionAttribution: i.filingDescription ? descriptionAttribution(name, i.filingDescription) : null,",
    "descriptionAttribution: null,"
  ));
  check("...and CATCHES a description shown without its filing",
    !/From Apple Inc\.'s 10-K/.test(render(P, compose(unattributed, "AAPL", { directoryName: "Apple Inc." }), "AAPL")));
  // THE LAST FMP PROFILE CALL IS GONE from the page, and nothing replaced it
  // with a fallback: the description is read from the committed file only.
  const page = read("app/stock/[symbol]/page.tsx");
  check("the page no longer calls FMP's profile, and reads the committed description",
    !/fetchCompanyProfile\(upper\)/.test(page) && /filingDescription: filingDescriptionFor\(upper\)/.test(page) &&
      !/fmpDescription|fmpProfile/.test(page));
}

console.log("\n2. market cap: shares x the page's price, and a refusal hides the row");
{
  const aapl = compose(M, "AAPL");
  const shares = fixture("AAPL").cover?.val;
  check("AAPL's cap is its cover-page shares times the price given",
    aapl.marketCap === shares * 200, `${aapl.marketCap} vs ${shares} x 200`);
  const refused = compose(M, "AAPL", { valuation: { shares: null, eps: null, refusals: ["no-cover-share-count"] } });
  check("a refusal yields no Market cap row", !/Market cap/.test(render(P, refused, "AAPL")));
  const printed = await loadComposer(once("marketCap: cap?.ok ? cap.val : null,", "marketCap: cap?.ok ? cap.val : 0,"));
  const m2 = printed.composeCompanyProfile({ ...{ symbol: "AAPL", directoryName: "", snapshotName: "", entityName: null, filingDescription: null, taxonomy, price: 200, points: [], exchange: null, registrant: null }, valuation: { shares: null, eps: null, refusals: ["no-cover-share-count"] } });
  check("...and CATCHES a refusal rendered as a figure", m2.marketCap !== null);
}

console.log("\n3. every 20-F filer's cap is refused (the §2.6 ADS guard)");
{
  const reg = JSON.parse(read("data/sec/registrants.json")).rows;
  const twentyF = Object.entries(reg).filter(([, r]) => r.annualForm === "20-F").map(([s]) => s);
  check("the registrant file names the 20-F filers", twentyF.length > 300, `${twentyF.length}`);
  check("AZN and ABVX are among them — neither was on the five-name list",
    reg.AZN?.annualForm === "20-F" && reg.ABVX?.annualForm === "20-F");
  const azn = compose(M, "AZN");
  check("AZN's cap is refused, not printed at the ordinary-share count", azn.marketCap === null);
  check("AZN's P/E is refused too",
    M.peRatio(M.valuationInputs(fixture("AZN"), TODAY, { annualForm: "20-F" }), 70)?.ok === false);
  check("a 10-K filer is unaffected", compose(M, "AAPL").marketCap !== null);
  const blind = await loadComposer(once(
    'if (sharesAreIncomparableToPrice(set.symbol) || filer.annualForm === "20-F") {',
    "if (sharesAreIncomparableToPrice(set.symbol)) {"
  ));
  // On the REFUSAL, not the cap: AZN's fixture carries no cover-page count, so
  // its cap is null either way and would not distinguish the two rules.
  check("...and CATCHES the five-name list alone",
    !blind.valuationInputs(fixture("AZN"), TODAY, { annualForm: "20-F" }).refusals.includes("ads-ratio-makes-shares-incomparable"));
  check("the refusal is the ADS one, not a missing share count",
    M.valuationInputs(fixture("AZN"), TODAY, { annualForm: "20-F" }).refusals.includes("ads-ratio-makes-shares-incomparable"));
}

console.log("\n4. the 52-week range is the last 252 bars");
{
  // 300 rising bars: all-time low is 100, the 252-bar low is 148.
  const r = M.fiftyTwoWeekRange(bars(300, (i) => 100 + i));
  check("low and high over the last 252 bars only", r?.low === 148 && r?.high === 399, JSON.stringify(r));
  check("high/low fields win over the close when present",
    M.fiftyTwoWeekRange([...bars(30, () => 10), { close: 10, high: 15, low: 5 }])?.low === 5);
  check("too few bars hides the row", M.fiftyTwoWeekRange(bars(5, () => 1)) === null);
  const all = await loadComposer(once("const window = points.slice(-RANGE_BARS)", "const window = points"));
  check("...and CATCHES a range over every bar", all.fiftyTwoWeekRange(bars(300, (i) => 100 + i))?.low === 100);
}

console.log("\n5. country: the headquarters, via EDGAR's code table");
{
  check("ABVX → FR (business address in France)", M.countryFor(M.registrantFor("ABVX")) === "FR", String(M.countryFor(M.registrantFor("ABVX"))));
  check("AZN → GB", M.countryFor(M.registrantFor("AZN")) === "GB", String(M.countryFor(M.registrantFor("AZN"))));
  check("AAPL → US", M.countryFor(M.registrantFor("AAPL")) === "US");
  check("an unknown code yields null, never a guess",
    M.countryFor({ stateOrCountry: "Q!", stateOfIncorporation: null }) === null);
  check("incorporation is the fallback only when no business address was filed",
    M.countryFor({ stateOrCountry: null, stateOfIncorporation: "DE" }) === "US" &&
      M.countryFor({ stateOrCountry: "L3", stateOfIncorporation: "DE" }) === "IL");
}

console.log("\n6. the share-dilution series is SEC's");
{
  const counts = {};
  for (const sym of ["AAPL", "AZN", "TSLA", "GEV", "KTOS", "KGC"]) {
    const h = M.buildShareHistory(fixture(sym));
    counts[sym] = h ? `${h.points.length} ${h.basis}` : "none";
  }
  check("AAPL gets a quarterly series from sharesBasic", /^\d+ quarter$/.test(counts.AAPL), JSON.stringify(counts));
  const s = M.buildShareHistory(fixture("AAPL"));
  check("ascending by date", s.points.every((p, i, a) => i === 0 || a[i - 1].date < p.date));
  const dil = read("app/components/DilutionHistory.tsx");
  check("the chart's footer names SEC filings, not FMP",
    /own SEC filings/.test(dil) && !/data from Financial Modeling Prep/.test(dil));
  const page = read("app/stock/[symbol]/page.tsx");
  check("the page no longer calls the FMP share-history read",
    !/fetchShareHistory\(upper\)/.test(page) && /secFacts\.profileFacts\.shareHistory/.test(page));
}

console.log("\n7. IPO date and Website are hidden by the registry");
{
  const withBoth = { ...compose(M, "AAPL"), ipoDate: "1980-12-12", website: "https://www.apple.com" };
  const t = render(P, withBoth, "AAPL");
  check("neither renders even when a value is present", !/IPO date/.test(t) && !/Website/.test(t));
  const reg = JSON.parse(read("data/sec/registrants.json")).rows;
  const withSite = Object.values(reg).filter((r) => r.website).length;
  check("SEC's website field is blank across the registrant file (why Website stays hidden)",
    withSite === 0, `${withSite} of ${Object.keys(reg).length} carry one`);
}

console.log("\n8. the valuation multiples are the filings', one period basis each");
{
  const set = fixture("AAPL");
  const inputs = M.valuationInputs(set, TODAY, {});
  const mi = M.multipleInputs(set);
  const v = M.valuationMultiples(inputs, mi, 200);
  const cap = M.marketCap(inputs, 200).val;
  const rev4 = set.quarters.slice(0, 4).map((q) => M.valueOf(q, "revenue")).reduce((a, b) => a + b, 0);
  check("AAPL's P/S is cap ÷ four consecutive quarters of revenue",
    mi.revenue.basis === "four-quarters" && Math.abs(v.ps.val - cap / rev4) < 1e-9, `${v.ps.val?.toFixed(2)}`);
  check("AAPL's P/B is cap ÷ the latest balance sheet's stockholders' equity",
    Math.abs(v.pb.val - cap / M.valueOf(set.instants[0], "stockholdersEquity")) < 1e-9, `${v.pb.val?.toFixed(2)}`);
  check("AAPL's P/E is peRatio(), unchanged", v.pe.val === M.peRatio(inputs, 200).val);
  const b = mi.balanceSheet, e = mi.ebitda.vals;
  const ev = cap + b.shortTermDebt + b.longTermDebt - b.cash;
  check("AAPL's EV/EBITDA is (cap + debt − cash) ÷ (operating income + D&A)",
    Math.abs(v.evEbitda.val - ev / (e.operatingIncome + e.depreciationAndAmortization)) < 1e-9, `${v.evEbitda.val?.toFixed(2)}`);

  // NEVER MIXED: AZN's stored quarters are all Q2s — not consecutive — so the
  // fiscal year is the basis for every twelve-month input.
  const azn = M.multipleInputs(fixture("AZN"));
  check("a filer with non-consecutive quarters is read on the fiscal year",
    azn.revenue?.basis === "fiscal-year" && (azn.ebitda === null || azn.ebitda.basis === "fiscal-year"),
    JSON.stringify({ revenue: azn.revenue?.basis, ebitda: azn.ebitda?.basis ?? null }));
  const mixed = await loadComposer(once(
    "four.length === 4 && four.every((q, i) => i === 0 || isConsecutive(four[i - 1], q));",
    "four.length === 4;"
  ));
  check("...and CATCHES four non-consecutive quarters summed as a year",
    mixed.multipleInputs(fixture("AZN")).revenue?.basis === "four-quarters");

  // NOT APPROXIMATED: one missing debt line refuses EV/EBITDA outright.
  const noDebt = { ...mi, balanceSheet: { ...mi.balanceSheet, shortTermDebt: null } };
  check("a missing debt line refuses EV/EBITDA rather than assuming zero",
    M.valuationMultiples(inputs, noDebt, 200).evEbitda?.why === "enterprise-value-input-missing");
  const zeroed = await loadComposer(once(
    "if (!bs || bs.shortTermDebt === null || bs.longTermDebt === null || bs.cash === null || !m.ebitda) {",
    "if (!bs || !m.ebitda) {"
  ));
  check("...and CATCHES a missing debt line treated as zero",
    zeroed.valuationMultiples(inputs, noDebt, 200).evEbitda?.ok !== false);

  check("non-positive equity refuses P/B",
    M.valuationMultiples(inputs, { ...mi, balanceSheet: { ...mi.balanceSheet, equity: -5 } }, 200).pb?.why === "equity-is-zero-or-negative");
  check("no twelve months of revenue refuses P/S",
    M.valuationMultiples(inputs, { ...mi, revenue: null }, 200).ps?.why === "no-twelve-month-revenue");

  // THE 20-F RULE REFUSES ALL FOUR.
  const f20 = M.valuationMultiples(M.valuationInputs(set, TODAY, { annualForm: "20-F" }), mi, 200);
  check("a 20-F filer refuses all four",
    ["pe", "ps", "pb", "evEbitda"].every((k) => f20[k]?.ok === false), JSON.stringify(Object.fromEntries(Object.entries(f20).map(([k, x]) => [k, x?.why]))));

  // NO FMP WORDING LEFT IN THE SECTION, and no client fetch of the FMP route.
  const client = read("app/stock/[symbol]/StockSymbolPageClient.tsx");
  const sec = client.slice(client.indexOf("Valuation multiples (SEC filings, TTM)"), client.indexOf("Analyst ratings & price targets"));
  check("the section's footer names SEC EDGAR and no FMP",
    /SEC EDGAR/.test(sec) && !/Financial Modeling Prep|FMP/.test(sec));
  check("the client no longer fetches /api/stock-valuation",
    !/await fetch\(`\/api\/stock-valuation/.test(client));
  check("the page computes the multiples on the server",
    /valuationMultiples\(/.test(read("app/stock/[symbol]/page.tsx")));
}

console.log("\n9. the long share history: fiscal years from the payload, then recent quarters");
{
  // A payload with fifteen fiscal years of basic shares and one 10-Q
  // trailing-twelve-month comparative that must NOT count as a year.
  const row = (val, start, end, fp = "FY", form = "10-K") =>
    ({ val, start, end, fy: Number(end.slice(0, 4)), fp, form, filed: `${Number(end.slice(0, 4)) + 1}-02-01`, accn: `0000000000-${end}` });
  const years = Array.from({ length: 15 }, (_, i) => 2010 + i);
  const facts = { cik: 1, entityName: "Synthetic", facts: { "us-gaap": {
    WeightedAverageNumberOfSharesOutstandingBasic: { units: { shares: [
      ...years.map((y) => row(1000 + y, `${y}-01-01`, `${y}-12-31`)),
      row(9999, "2024-07-01", "2025-06-30", "Q2", "10-Q"),
    ] } },
    NetIncomeLoss: { units: { USD: years.map((y) => row(5, `${y}-01-01`, `${y}-12-31`)) } },
  } } };
  const r = M.extractCompanyFacts("SYN", facts);
  check("every fiscal year in the payload is kept, beyond the retained window",
    r.annualShares?.length === 15 && r.annualShares[0][0] === "2010-12-31", `${r.annualShares?.length} years`);
  check("a trailing-twelve-month comparative is not a fiscal year",
    !r.annualShares.some(([e]) => e === "2025-06-30"));
  const enc = M.encodeFactSet(r);
  check("the codec stores it as `as`, about 20 bytes a year",
    enc.as?.length === 15 && JSON.stringify(enc.as).length < 15 * 25, `${JSON.stringify(enc.as).length} bytes`);

  // THE CHART: years up to the first stored quarter, then every stored quarter.
  const set = fixture("AAPL");
  const lastFy = set.years[0].e;
  const qs = set.quarters.filter((q) => q.v && M.buildShareHistory({ ...set, as: undefined }).points.some((p) => p.date === q.e)).map((q) => q.e).sort();
  const firstQ = qs[0];
  const withAs = { ...set, as: [["2012-09-29", 26e9], ["2018-09-29", 19e9], [lastFy, 15e9]] };
  const h = M.buildShareHistory(withAs);
  const quarterOnly = M.buildShareHistory(set);
  check("the chart draws the yearly points before the first stored quarter, then EVERY stored quarter",
    h.basis === "annual+quarters" && h.points[0].date === "2012-09-29" &&
      h.points.length === 2 + quarterOnly.points.length &&
      h.points.slice(2).every((p, i) => p.date === quarterOnly.points[i].date),
    `${h.points.length} points, first quarter ${firstQ}`);
  check("a year ending inside the stored quarters is left to the quarters",
    !h.points.some((p) => p.date === lastFy && p.shares === 15e9));
  check("a set without `as` keeps the quarterly fallback", M.buildShareHistory(set).basis === "quarter");
  const dil = read("app/components/DilutionHistory.tsx");
  check("the footer uses the owner's wording", /Annual share counts from SEC filings, latest quarters appended/.test(dil));
  const overlap = await loadComposer(once(
    ".filter(([date, v]) => typeof v === \"number\" && v > 0 && date < firstQuarter)",
    ".filter(([, v]) => typeof v === \"number\" && v > 0)"
  ));
  check("...and CATCHES a yearly point plotted inside the quarters' span",
    overlap.buildShareHistory(withAs).points.some((p) => p.date === lastFy && p.shares === 15e9));
  const dropQuarters = await loadComposer(once(
    "const points = [...years, ...quarters];",
    "const points = [...years, ...quarters.filter((p) => p.date > (set.as?.at(-1)?.[0] ?? \"\"))];"
  ));
  // The first shape (#517 round 1): quarters only after the last fiscal year.
  check("...and CATCHES quarters dropped from the combined series",
    dropQuarters.buildShareHistory({ ...withAs, as: [["2012-09-29", 26e9], [qs[2], 15e9]] }).points.length <
      M.buildShareHistory({ ...withAs, as: [["2012-09-29", 26e9], [qs[2], 15e9]] }).points.length);
}

console.log(failures ? `\n${failures} FAILED` : "\nThe About block is composed from free sources.");
process.exit(failures ? 1 : 0);
