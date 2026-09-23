// WHEN SEC'S DATA FEED LAGS A FILING, THE FILING IS READ — AND SAID SO.
//
// #535 COWORK #6 (option C with B as the safety net). Pins:
//   1. the instance parser: non-dimensional contexts only, namespaces by URI,
//      divide units, one row per (concept, unit, span);
//   2. the merge: FILL-ONLY (companyfacts wins a span it has) and
//      CURRENCY-LOCKED (TSM: TWD rows never enter a USD set);
//   3. end to end through the SHIPPED extraction: a Q1-only feed plus a Q2
//      instance yields Q2, with the quarter derived as every other is;
//   4. the lag test and the newest-filing pick (originals only);
//   5. the view, the earnings card and the stock-page tile: the credit when the
//      period came from the filing, the notice (dated from the filing's own
//      period) only when neither source has it, and the older cadence-dated
//      `pending` note never beside either.
// Each rule is broken on purpose below to show its assertion can fail.
import fs from "node:fs";
import { lift } from "./lib/earnings-plan.mjs";
import { loadCards, html, visibleText, React } from "./lib/render-cards.mjs";
import { loadSnapshot } from "./lib/render-snapshot.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const strip = (src) => src.replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const FILL_SRC = fs.readFileSync("lib/server/secFilingFill.ts", "utf8");
const loadFill = (mutate = (s) => s) => lift(mutate(strip(FILL_SRC)));
const extractSrc = [
  fs.readFileSync("lib/server/secFields.ts", "utf8"),
  strip(fs.readFileSync("lib/server/secExtract.ts", "utf8")),
  strip(fs.readFileSync("lib/server/fxRates.ts", "utf8")),
  strip(fs.readFileSync("lib/server/secCurrency.ts", "utf8")),
  strip(fs.readFileSync("lib/server/secFactCodec.ts", "utf8")),
  strip(fs.readFileSync("lib/server/secEarningsView.ts", "utf8")),
].join("\n");
const X = await lift(extractSrc);
const F = await loadFill();

const FILING = { form: "10-Q", accn: "0000000001-26-000002", filed: "2026-07-29", reportDate: "2026-07-03" };
const row = (start, end, val, fp, form = "10-Q", filed = "2026-04-30") =>
  ({ start, end, val, accn: "0000000001-26-000001", fy: 2026, fp, form, filed });
const FEED = {
  cik: 1, entityName: "Test Co",
  facts: { "us-gaap": {
    Revenues: { units: { USD: [row("2026-01-01", "2026-04-03", 100e6, "Q1"),
      { ...row("2025-01-01", "2025-12-31", 380e6, "FY", "10-K", "2026-02-20") }] } },
    NetIncomeLoss: { units: { USD: [row("2026-01-01", "2026-04-03", 10e6, "Q1")] } },
  } },
};
// The instance uses a NON-STANDARD prefix ("gaap") on purpose: namespaces are
// matched by URI. c3 is dimensional and must be ignored; c1 is year-to-date.
const XML = `<xbrl xmlns:gaap="http://fasb.org/us-gaap/2025" xmlns:dei="http://xbrl.sec.gov/dei/2025"
 xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:iso4217="http://www.xbrl.org/2003/iso4217">
<xbrli:context id="c1"><xbrli:entity><xbrli:identifier>1</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2026-01-01</xbrli:startDate><xbrli:endDate>2026-07-03</xbrli:endDate></xbrli:period></xbrli:context>
<xbrli:context id="c2"><xbrli:entity><xbrli:identifier>1</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2026-04-04</xbrli:startDate><xbrli:endDate>2026-07-03</xbrli:endDate></xbrli:period></xbrli:context>
<xbrli:context id="c3"><xbrli:entity><xbrli:identifier>1</xbrli:identifier><xbrli:segment><x>y</x></xbrli:segment></xbrli:entity><xbrli:period><xbrli:startDate>2026-04-04</xbrli:startDate><xbrli:endDate>2026-07-03</xbrli:endDate></xbrli:period></xbrli:context>
<xbrli:context id="c4"><xbrli:entity><xbrli:identifier>1</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2026-01-01</xbrli:startDate><xbrli:endDate>2026-04-03</xbrli:endDate></xbrli:period></xbrli:context>
<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>
<xbrli:unit id="twd"><xbrli:measure>iso4217:TWD</xbrli:measure></xbrli:unit>
<xbrli:unit id="usdps"><xbrli:divide><xbrli:unitNumerator><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unitNumerator><xbrli:unitDenominator><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unitDenominator></xbrli:divide></xbrli:unit>
<dei:DocumentFiscalYearFocus contextRef="c1">2026</dei:DocumentFiscalYearFocus>
<dei:DocumentFiscalPeriodFocus contextRef="c1">Q2</dei:DocumentFiscalPeriodFocus>
<gaap:Revenues contextRef="c1" unitRef="usd" decimals="-6">230000000</gaap:Revenues>
<gaap:Revenues contextRef="c2" unitRef="usd" decimals="-6">130000000</gaap:Revenues>
<gaap:Revenues contextRef="c2" unitRef="usd" decimals="-6">130000000</gaap:Revenues>
<gaap:Revenues contextRef="c3" unitRef="usd" decimals="-6">999</gaap:Revenues>
<gaap:Revenues contextRef="c4" unitRef="usd" decimals="-6">555</gaap:Revenues>
<gaap:NetIncomeLoss contextRef="c2" unitRef="usd" decimals="-6">-5000000</gaap:NetIncomeLoss>
<gaap:NetIncomeLoss contextRef="c2" unitRef="twd" decimals="-6">-160000000</gaap:NetIncomeLoss>
<gaap:EarningsPerShareDiluted contextRef="c2" unitRef="usdps" decimals="2">-0.05</gaap:EarningsPerShareDiluted>
</xbrl>`;

console.log("\n1. the instance parser");
{
  const { facts, rows } = F.instanceToFacts(XML, FILING);
  const rev = facts["us-gaap"]?.Revenues?.units?.USD ?? [];
  check("namespaces are matched by URI, not prefix (\"gaap\" read as us-gaap)", rev.length > 0);
  check("a dimensional context is not the consolidated figure", !rev.some((r) => r.val === 999));
  check("one row per (concept, unit, span) — the duplicate fact is dropped",
    rev.filter((r) => r.start === "2026-04-04").length === 1, JSON.stringify(rev));
  check("a divide unit reads as USD/shares, the companyfacts spelling",
    facts["us-gaap"]?.EarningsPerShareDiluted?.units?.["USD/shares"]?.[0]?.val === -0.05);
  check("rows carry the filing's accession, form, filed date and DEI focus",
    rev.every((r) => r.accn === FILING.accn && r.form === "10-Q" && r.filed === "2026-07-29" && r.fp === "Q2" && r.fy === 2026));
  check("dei text facts (no unit) are not rows", !facts.dei, JSON.stringify(Object.keys(facts)));
  check("row count", rows === 6, String(rows));
}

console.log("\n2. the merge: fill-only, currency-locked");
{
  const { facts } = F.instanceToFacts(XML, FILING);
  const { merged, added } = F.mergeFillOnly(FEED, facts, "USD");
  const rev = merged.facts["us-gaap"].Revenues.units.USD;
  const q1 = rev.filter((r) => r.end === "2026-04-03" && r.start === "2026-01-01");
  check("a span the feed has is NOT replaced (Q1 revenue stays 100M, not the filing's 555)",
    q1.length === 1 && q1[0].val === 100e6, JSON.stringify(q1));
  check("the feed's input payload is not mutated", FEED.facts["us-gaap"].Revenues.units.USD.length === 2);
  check("a TWD row never enters a USD-locked set", !merged.facts["us-gaap"].NetIncomeLoss.units.TWD);
  check("USD/shares is admitted under a USD lock",
    merged.facts["us-gaap"].EarningsPerShareDiluted?.units?.["USD/shares"]?.length === 1);
  check("added counts only new spans", added === 4, String(added));
  const twdLock = F.mergeFillOnly({ facts: {} }, facts, "TWD").merged.facts["us-gaap"];
  check("under a TWD lock, USD rows are the ones refused", !twdLock.Revenues && twdLock.NetIncomeLoss.units.TWD.length === 1);

  const noLock = await loadFill((s) => s.replace("if (foreignCurrencyIn(unit, currency)) continue;", ""));
  const bad = noLock.mergeFillOnly(FEED, facts, "USD").merged.facts["us-gaap"].NetIncomeLoss.units;
  check("MUTATION \"currency lock removed\" breaks the assertion", Boolean(bad.TWD));
  const noFill = await loadFill((s) => s.replace("if (have.has(`${r.start ?? \"\"}|${r.end ?? \"\"}`)) continue;", ""));
  const dup = noFill.mergeFillOnly(FEED, facts, "USD").merged.facts["us-gaap"].Revenues.units.USD
    .filter((r) => r.end === "2026-04-03" && r.start === "2026-01-01");
  check("MUTATION \"fill-only removed\" breaks the assertion", dup.length > 1);
}

console.log("\n3. end to end through the shipped extraction");
{
  const { facts } = F.instanceToFacts(XML, FILING);
  const before = X.encodeFactSet(X.extractCompanyFacts("TEST", FEED));
  const after = X.encodeFactSet(X.extractCompanyFacts("TEST", F.mergeFillOnly(FEED, facts, "USD").merged));
  const q0 = after.quarters[0];
  check("the feed alone stops at the quarter to 3 Apr", before.quarters[0].e === "2026-04-03");
  check("with the filing, the newest quarter is the one to 3 Jul", q0.e === "2026-07-03", q0.e);
  check("its revenue is the filed three-month figure (130M)", X.valueOf(q0, "revenue") === 130e6, String(X.valueOf(q0, "revenue")));
  check("its net income (-5M) and diluted EPS (-0.05) are read, not invented",
    X.valueOf(q0, "netIncome") === -5e6 && X.valueOf(q0, "epsDiluted") === -0.05);
  check("the period carries the filing's accession, so the view can credit it", q0.a === FILING.accn);
  check("isLagging: the feed-only set is behind the filing", F.isLagging(before, FILING));
  check("isLagging: the merged set is not", !F.isLagging(after, FILING));
}

console.log("\n4. the newest filing is the newest ORIGINAL periodic form");
{
  const subs = { filings: { recent: {
    form: ["8-K", "10-Q/A", "10-Q", "10-K"],
    accessionNumber: ["a8", "aqa", "aq", "ak"],
    filingDate: ["2026-08-01", "2026-07-30", "2026-07-29", "2026-02-20"],
    reportDate: ["2026-07-28", "2026-07-03", "2026-07-03", "2025-12-31"],
  } } };
  const f = F.newestPeriodicFiling(subs);
  check("8-K and 10-Q/A are not the period report", f?.accn === "aq", JSON.stringify(f));
  check("no filing is not a lag", !F.isLagging({ quarters: [], years: [] }, null));
}

console.log("\n5. the view, the earnings card and the tile");
const LAG_20F = { form: "20-F", accn: "x", filed: "2026-04-16", reportDate: "2025-12-31" };
const aapl = JSON.parse(fs.readFileSync("data/sec/factset-fixture-AAPL.json", "utf8"));
const newest = aapl.quarters[0];
const credited = { ...aapl, ff: { form: "10-Q", accn: newest.a, filed: newest.f, reportDate: newest.e } };
const lagging = { ...aapl, lg: { form: "10-Q", accn: "zz", filed: "2026-10-30", reportDate: "2026-09-26" } };
const stale = { ...aapl, lg: { form: "10-Q", accn: "zz", filed: "2026-01-30", reportDate: "2025-12-27" } };
{
  check("filingNoticeText names the filing's own period and date (KO's case)",
    X.filingNoticeText({ form: "10-Q", accn: "a", filed: "2026-07-29", reportDate: "2026-07-03" }) ===
      "Results for the quarter ended 3 Jul 2026 were filed with the SEC on 29 Jul 2026 (10-Q); the figures " +
      "are not in SEC's data feed yet, so this page still shows the previous period.");
  check("a 20-F is a fiscal year", /fiscal year ended 31 Dec 2025/.test(X.filingNoticeText(LAG_20F)));
  check("the notice tells the reader nothing to do", !/\b(you|should|buy|sell|consider)\b/i.test(X.filingNoticeText(LAG_20F)));
  const vc = X.buildSecEarningsView(credited);
  check("a period supplied by the filing is credited", vc.latestFromFiling?.accn === newest.a && vc.filedNotInFeed === null);
  check("…by accession: ff for another filing credits nothing",
    X.buildSecEarningsView({ ...aapl, ff: { ...credited.ff, accn: "other" } }).latestFromFiling === null);
  const vl = X.buildSecEarningsView(lagging);
  check("a newer filing neither source has raises the notice", vl.filedNotInFeed?.accn === "zz" && vl.latestFromFiling === null);
  check("an lg no newer than what is shown raises nothing", X.buildSecEarningsView(stale).filedNotInFeed === null);
  check("a plain set has neither", (() => { const v = X.buildSecEarningsView(aapl); return v.latestFromFiling === null && v.filedNotInFeed === null; })());
}
{
  const M = await loadCards();
  const PENDING = { periodEnd: "2026-09-30", announcedOn: "2026-10-28" };
  const card = (mod, set, pending) =>
    visibleText(html(React.createElement(mod.SecSnapshotCard, { view: mod.buildSecEarningsView(set), pending })));
  const tl = card(M, lagging, PENDING);
  check("the earnings card shows the filing notice", tl.includes("were filed with the SEC on 30 Oct 2026 (10-Q)"), tl.slice(0, 400));
  check("…and not the cadence-dated announced note beside it", !tl.includes("were announced on"));
  const tp = card(M, aapl, PENDING);
  check("with no filing lag the announced note shows as before", tp.includes("were announced on"));
  check("the announced note never names the period already shown",
    !card(M, aapl, { periodEnd: newest.e, announcedOn: "2026-08-01" }).includes("were announced on"));
  const tc = card(M, credited, null);
  check("the earnings card credits a filing-read period", tc.includes(`From the 10-Q filed`) && tc.includes("read from the filing itself"));
  const mut = await loadCards((s) => s.replace("pending && !view.filedNotInFeed && !view.latestFromFiling &&", "pending &&"));
  check("MUTATION \"pending shown beside the filing notice\" breaks the assertion",
    card(mut, lagging, PENDING).includes("were announced on"));
}
{
  const S = await loadSnapshot();
  const tile = (set) => {
    const view = S.buildSecEarningsView(set);
    const score = S.scoreFromSec(view, "AAPL", { status: "ready", set, cold: false });
    const snap = S.buildSecEarningsSnapshot({ symbol: "AAPL", view, score, reported: null, nextReport: { kind: "none" } });
    return { snap, text: visibleText(html(React.createElement(S.default, { snapshot: snap, symbol: "AAPL" }))) };
  };
  const l = tile(lagging);
  check("the stock-page tile carries the same notice", l.snap.filingNotice === S.filingNoticeText(lagging.lg) && l.text.includes("(10-Q); the figures are not in SEC's data feed yet"));
  const c = tile(credited);
  check("the tile carries the same credit", c.snap.filingCredit !== null && c.text.includes("read from the filing itself"));
  const p = tile(aapl);
  check("a current set shows neither on the tile", p.snap.filingNotice === null && p.snap.filingCredit === null &&
    !p.text.includes("data feed"));
}

console.log(failures ? `\n${failures} assertion(s) failed.\n` : "\nFiling fill holds.\n");
process.exit(failures ? 1 : 0);
