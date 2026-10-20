// "n/m" FOR GROWTH AND MARGINS ON A TINY BASE (#552 COWORK #212).
//
// JOBY Q2 FY2026 printed "+257,493.3%" revenue growth (on $15k a year earlier)
// and an operating margin change of "▲1,118,418.2 pt"; ACHR an operating
// margin of "−5,584.0%" on $5.0M of revenue. The rule (CODE-A #229): growth
// n/m when the year-ago revenue is under $1M or the rate is beyond ±1,000%; a
// margin n/m when its period's revenue is under $1M or it is beyond ±1,000%; a
// margin's change n/m when either end is. Run through the real view, the real
// snapshot reasons, the real trend summary and the real cards; KO, TSLA and
// JPM are unchanged; the score reads the same figures as before. Then a mutant
// per clause.
//
//   node scripts/check-not-meaningful.mjs
import fs from "node:fs";
import { loadCards, html, visibleText, React } from "./lib/render-cards.mjs";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const M = await loadCards();

// ── fixtures, shaped like the census's figures (CODE-A #229) ──────────────
const mk = (Mod) => {
  const per = (e, s, fp, fy, o) => {
    const v = Mod.SEC_FIELD_KEYS.map((k) => o[k] ?? null);
    return { e, s, fp, fy, a: null, f: null, v, d: v.map((x) => (x == null ? "-" : "F")).join("") };
  };
  const q = (fy, fp, o) => {
    const starts = { Q1: ["01-01", "03-31"], Q2: ["04-01", "06-30"], Q3: ["07-01", "09-30"] }[fp];
    return per(`${fy}-${starts[1]}`, `${fy}-${starts[0]}`, fp, fy, o);
  };
  const set = (symbol, quarters) => ({ symbol, cik: null, tx: ["dei", "us-gaap"], cur: "USD", quarters, years: [], instants: [], nt: [] });
  return {
    // JOBY: $38.6M against $15k; operating margin −675.2% now, about −1,119,000% a year ago.
    JOBY: set("JOBY", [
      q(2026, "Q2", { revenue: 38.6e6, operatingIncome: -260.6e6, netIncome: -245.2e6, epsDiluted: -0.29 }),
      q(2026, "Q1", { revenue: 15.1e6, operatingIncome: -210e6, netIncome: -200e6, epsDiluted: -0.25 }),
      q(2025, "Q2", { revenue: 15e3, operatingIncome: -167.9e6, netIncome: -160e6, epsDiluted: -0.22 }),
      q(2025, "Q1", { revenue: 30e3, operatingIncome: -150e6, netIncome: -145e6, epsDiluted: -0.21 }),
      // A year further back, so FY2025's rows have comparators and render.
      q(2024, "Q2", { revenue: 20e3, operatingIncome: -120e6, netIncome: -118e6, epsDiluted: -0.18 }),
      q(2024, "Q1", { revenue: 10e3, operatingIncome: -110e6, netIncome: -108e6, epsDiluted: -0.17 }),
    ]),
    // ACHR: $5.0M, operating −5,584%; no revenue a year earlier ("turned profitable" from zero).
    ACHR: set("ACHR", [
      q(2026, "Q2", { revenue: 5.0e6, operatingIncome: -279.2e6, netIncome: -263.2e6, epsDiluted: -0.4 }),
      q(2025, "Q2", { revenue: 0, operatingIncome: -150e6, netIncome: -140e6, epsDiluted: -0.3 }),
      q(2024, "Q2", { revenue: 0, operatingIncome: -120e6, netIncome: -115e6, epsDiluted: -0.25 }),
    ]),
    KO: set("KO", [
      q(2026, "Q2", { revenue: 12.5e9, grossProfit: 7.7e9, operatingIncome: 3.6e9, netIncome: 2.6e9, epsDiluted: 0.6 }),
      q(2025, "Q2", { revenue: 11.7e9, grossProfit: 7.2e9, operatingIncome: 3.3e9, netIncome: 2.5e9, epsDiluted: 0.58 }),
    ]),
    // JPM: a bank — no operating line, revenue and net income only.
    JPM: set("JPM", [
      q(2026, "Q2", { revenue: 45.0e9, netIncome: 14.0e9, epsDiluted: 4.9 }),
      q(2025, "Q2", { revenue: 44.0e9, netIncome: 13.0e9, epsDiluted: 4.4 }),
    ]),
  };
};
const F = mk(M);
const committed = (s) => JSON.parse(fs.readFileSync(`data/sec/factset-fixture-${s}.json`, "utf8"));
const views = {
  JOBY: M.buildSecEarningsView(F.JOBY), ACHR: M.buildSecEarningsView(F.ACHR), KO: M.buildSecEarningsView(F.KO),
  JPM: M.buildSecEarningsView(F.JPM), TSLA: M.buildSecEarningsView(committed("TSLA")), WKHS: M.buildSecEarningsView(committed("WKHS")),
};
const newest = (v) => v.margins.at(-1);
const anyMark = (v) =>
  v.snapshot.revenueYoYNotMeaningful ||
  v.growth.some((g) => g.revenueYoYNotMeaningful) ||
  v.annual.some((a) => a.revenueYoYNotMeaningful || Object.values(a.notMeaningful ?? {}).some(Boolean)) ||
  v.margins.some((r) => Object.values(r.notMeaningful ?? {}).some(Boolean));

console.log("1. the helper");
{
  check("growth off $15k → n/m", M.revenueGrowthNotMeaningful(257493.3, 15e3));
  check("growth beyond ±1,000% off $3.7M → n/m", M.revenueGrowthNotMeaningful(8608.6, 3.7e6));
  check("NBIS +479% off $91.5M → stands (the owner's real-base case)", !M.revenueGrowthNotMeaningful(479, 91.5e6));
  check("a crossing is never n/m (it already says what happened)", !M.revenueGrowthNotMeaningful("turned-profitable", 0));
  check("yoy60 2f: growth off a $20M base → n/m; off $30M → stands", M.revenueGrowthNotMeaningful(80, 20e6) && !M.revenueGrowthNotMeaningful(80, 30e6));
  check("...the margin floor stays $1M: a margin on $5M revenue stands", !M.marginNotMeaningful(-20, 5e6));
  check("yoy60 2f: an ARS reporter's growth carries the high-inflation reason", M.revenueGrowthNotMeaningfulReason(150, 900e6, 360e6, true, "ARS") === M.HIGH_INFLATION_REASON);
  check("...a USD or BRL reporter's does not", M.revenueGrowthNotMeaningfulReason(150, 900e6, 360e6, true, "USD") === null && M.revenueGrowthNotMeaningfulReason(150, 900e6, 360e6, true, "BRL") === null);
  check("...a crossing word is left alone even in pesos", M.revenueGrowthNotMeaningfulReason("turned-profitable", 900e6, 360e6, true, "ARS") === null);
  check("margin on $500k of revenue → n/m; −675% on $38.6M → stands; −5,584% on $5M → n/m",
    M.marginNotMeaningful(-20, 5e5) && !M.marginNotMeaningful(-675.2, 38.6e6) && M.marginNotMeaningful(-5584, 5e6));
  check("a change is n/m when EITHER end is", M.marginChangeNotMeaningful({ margin: -675.2, revenueUsd: 38.6e6 }, { margin: -1119093, revenueUsd: 15e3 })
    && !M.marginChangeNotMeaningful({ margin: 30, revenueUsd: 1e9 }, { margin: 28, revenueUsd: 9e8 }));
  check("the text and the two reasons are the ruled ones", M.NOT_MEANINGFUL_TEXT === "n/m"
    && M.NOT_MEANINGFUL_GROWTH_REASON === "Year-ago revenue was too small for a meaningful comparison"
    && M.NOT_MEANINGFUL_MARGIN_REASON === "Revenue is too small for a meaningful margin");
}

console.log("\n2. the view's markers, beside figures left as filed");
{
  const j = views.JOBY;
  check("JOBY: revenue growth n/m on the snapshot and its growth row", j.snapshot.revenueYoYNotMeaningful === true && j.growth.at(-1).revenueYoYNotMeaningful === true);
  check("JOBY: the figure itself is untouched (+257,493%)", Math.abs(j.snapshot.revenueYoY - 257233.3) < 1000, String(j.snapshot.revenueYoY));
  check("JOBY: the operating margin (−675%) stands; its change is n/m", newest(j).notMeaningful.operating === false && newest(j).notMeaningful.operatingChange === true);
  const a = views.ACHR;
  check("ACHR: operating and net margins n/m", newest(a).notMeaningful.operating && newest(a).notMeaningful.net, JSON.stringify(newest(a).notMeaningful));
  // #552 COWORK #213 item 3: the Pct stays the crossing (the score reads it);
  // what prints is n/m with "No revenue a year earlier".
  check("ACHR: no revenue a year earlier → n/m with its own reason (the Pct stays as computed)",
    a.snapshot.revenueYoY === "turned-profitable" && a.snapshot.revenueYoYNotMeaningful === true
      && a.snapshot.revenueYoYNotMeaningfulReason === M.NOT_MEANINGFUL_NO_BASE_REASON && M.NOT_MEANINGFUL_NO_BASE_REASON === "No revenue a year earlier");
  check("WKHS: +374.9% off $750k → n/m by the floor alone", views.WKHS.snapshot.revenueYoYNotMeaningful === true && Math.abs(views.WKHS.snapshot.revenueYoY) < 1000, String(views.WKHS.snapshot.revenueYoY));
  for (const s of ["KO", "TSLA", "JPM"]) check(`${s}: no marker anywhere`, !anyMark(views[s]));
}

console.log("\n3. the cards");
{
  const out = (card, v) => visibleText(html(React.createElement(card, { view: v })));
  const snap = out(M.SecSnapshotCard, views.JOBY);
  check("JOBY snapshot: 'n/m' where the growth was, no +257,493", /YoY revenue growth[\s\S]{0,40}n\/m/.test(snap) && !/257,?493/.test(snap));
  check("JOBY snapshot: the dollar figures and EPS stay", /\$38\.6M/.test(snap) && /0\.29/.test(snap), snap.slice(0, 300));
  const gm = out(M.SecGrowthMarginsCard, views.JOBY);
  check("JOBY growth card: the operating-margin line reads n/m, no 1,118,418", /Operating margin vs Q2 FY2025\s*:\s*n\/m/.test(gm) && !/1,?118,?418/.test(gm), gm.match(/Operating margin vs[^.]{0,60}/)?.[0]);
  // THE TABLE, not the whole card: C's chart above it (lib/growthVisuals) still
  // labels its dot −5,584% — listed for Cowork in the PR, not this file's to change.
  const ga = out(M.SecGrowthMarginsCard, views.ACHR);
  const table = ga.slice(ga.indexOf("Revenue YoY"));
  check("ACHR growth table: the margin cells read n/m, no −5,584", ga.includes("Revenue YoY") && /n\/m/.test(table) && !/5,?584/.test(table), table.slice(0, 160));
  const ko = out(M.SecGrowthMarginsCard, views.KO) + out(M.SecSnapshotCard, views.KO);
  check("KO: no n/m on either card", !/n\/m/.test(ko));
}

console.log("\n4. the trend summary and the score");
{
  const t = M.trendSummary(views.JOBY);
  const rev = t.lines.find((l) => l.label === "Revenue growth");
  check("JOBY trend: +257,493% is not the revenue line's latest", rev.latest === null || Math.abs(rev.latest) < 1000, String(rev.latest));
  const strip = (v) => ({ ...v, snapshot: { ...v.snapshot, revenueYoYNotMeaningful: false },
    growth: v.growth.map((g) => ({ ...g, revenueYoYNotMeaningful: false })), margins: v.margins.map((r) => ({ ...r, notMeaningful: undefined })) });
  for (const s of ["JOBY", "ACHR", "WKHS"]) {
    const a = M.scoreFromSec(views[s], s, { status: "ready" }), b = M.scoreFromSec(strip(views[s]), s, { status: "ready" });
    check(`${s}: the score reads the same figures with or without the markers`, a.score === b.score && a.available === b.available, `${a.score} / ${b.score}`);
  }
}

console.log("\n5. the other surfaces read the markers");
{
  const card = readCodeOnly("app/components/LatestEarningsCard.tsx");
  check("stock page tiles: margins print n/m with the payload's reason", /const NOT_MEANINGFUL = "n\/m";/.test(card) && /const nm = snapshot\.notMeaningful \?\? null;/.test(card) && /marginTile\(snapshot\.margins\.operating, nm\?\.operating, nm\?\.operatingChange/.test(card));
  const snapSrc = readCodeOnly("lib/server/secEarningsSnapshot.ts");
  check("the snapshot carries the reasons for every reader (C's tile and line included)", /notMeaningful: notMeaningfulOf\(view\),/.test(snapSrc));
  const week = readCodeOnly("app/earnings-calendar/EarningsWeek.tsx");
  check("calendar week: an n/m growth prints n/m with its reason", /r\.revenueYoYNote \? <span className="ewYoY" data-yoy="" data-nm=""><ReasonedValue text="n\/m" reason=\{r\.revenueYoYNote\} \/>/.test(week));
}

console.log("\n5b. the #213 follow-up: the statement row, tiny amounts, no year-ago revenue, the meter");
{
  const stmt = html(React.createElement(M.SecIncomeStatementCard, { view: views.JOBY }));
  check("JOBY income statement: the revenue row's tap note is n/m with the reason, no 'up 257233'",
    stmt.includes("n/m vs Q2 FY2025: Year-ago revenue was too small for a meaningful comparison.") && !/up 257,?233/.test(stmt));
  check("…and the revenue row takes no colour", /data-line-trend="none"[^>]*>[\s\S]{0,400}\$38\.6M/.test(stmt));
  check("tiny amounts: $15K, $0, -$15K, $640, and $0.5M from $100K up",
    M.scaledAmount(15e3) === "$15K" && M.scaledAmount(0) === "$0" && M.scaledAmount(-15e3) === "-$15K" && M.scaledAmount(640) === "$640"
      && M.scaledAmount(5e5) === "$0.5M" && M.scaledAmount(1e5) === "$0.1M" && M.scaledAmount(38.6e6) === "$38.6M",
    [15e3, 0, -15e3, 640, 5e5, 1e5].map((v) => M.scaledAmount(v)).join(" "));
  check("JOBY income statement: the year-ago $15K reads in thousands, not $0.0M", !stmt.includes("$0.0M"));
  const ga = visibleText(html(React.createElement(M.SecGrowthMarginsCard, { view: views.ACHR })));
  const snapA = visibleText(html(React.createElement(M.SecSnapshotCard, { view: views.ACHR })));
  check("ACHR: no 'Turned profitable' on a revenue figure (snapshot and table)", !/Turned profitable/.test(snapA) && !/Revenue YoY[\s\S]*Turned profitable/.test(ga) && /YoY revenue growth[\s\S]{0,40}n\/m/.test(snapA), snapA.slice(0, 220));
  const store = readCodeOnly("lib/server/secFactStore.ts");
  check("the stock page's fact-set read is metered (#553 CODE-B #182)", /await recordRedisRead\("sec-facts", 1, caller\);/.test(store)
    && /caller = "stock-page",/.test(store) && /readFactSet\(clean\)/.test(readCodeOnly("lib/server/secColdFetch.ts")));
  check("readEarningsSchedule is gone, with its dated note", !/readEarningsSchedule\(/.test(readCodeOnly("lib/server/earningsSchedule.ts"))
    && /RETIRED 2026-10-12 \(#552 COWORK #213 item 4\)/.test(fs.readFileSync("lib/server/earningsSchedule.ts", "utf8")));
}

console.log("\n6. mutants, one per clause");
{
  const mutant = async (from, to) => {
    let applied = false;
    const Mm = await loadCards((src) => { applied = src.split(from).length === 2; return src.replace(from, to); });
    if (!applied) throw new Error(`mutant anchor must match once: ${from}`);
    return Mm;
  };
  const m1 = await mutant("yearAgoRevenueUsd > 0 && yearAgoRevenueUsd < NOT_MEANINGFUL_GROWTH_BASE_USD", "false");
  check("MUTANT the $25M growth floor off: WKHS's +374.9% back (caught)", m1.buildSecEarningsView(committed("WKHS")).snapshot.revenueYoYNotMeaningful === false);
  const m1b = await mutant("usd > 0 && usd < NOT_MEANINGFUL_REVENUE_USD", "false");
  check("MUTANT the $1M margin floor off: a $500k margin back (caught)", m1b.marginNotMeaningful(-20, 5e5) === false);
  const m1c = await mutant("if (isPct(growth) && HIGH_INFLATION_CURRENCIES.has(", "if (false && HIGH_INFLATION_CURRENCIES.has(");
  check("MUTANT the high-inflation rule off: an ARS +150% back (caught)", m1c.revenueGrowthNotMeaningfulReason(150, 900e6, 360e6, true, "ARS") === null);
  const m2 = await mutant("export const NOT_MEANINGFUL_PCT = 1_000;", "export const NOT_MEANINGFUL_PCT = 1e12;");
  check("MUTANT the ±1,000% ceiling off: ACHR's −5,584% back (caught)", m2.buildSecEarningsView(mk(m2).ACHR).margins.at(-1).notMeaningful.operating === false);
  const m3 = await mutant("return marginNotMeaningful(now.margin, now.revenueUsd) || marginNotMeaningful(then.margin, then.revenueUsd);", "return marginNotMeaningful(now.margin, now.revenueUsd);");
  check("MUTANT the change reads only today's end: JOBY's 1,118,418 pt back (caught)", m3.buildSecEarningsView(mk(m3).JOBY).margins.at(-1).notMeaningful.operatingChange === false);
  const m4 = await mutant("  if (notMeaningful) return <NotMeaningfulValue reason={notMeaningfulReason ?? NOT_MEANINGFUL_GROWTH_REASON} />;", "");
  check("MUTANT the growth cell ignores the marker: +257,233 printed (caught)", /257,?233/.test(visibleText(html(React.createElement(m4.SecSnapshotCard, { view: m4.buildSecEarningsView(mk(m4).JOBY) })))));
}

{
  const mutant = async (from, to) => {
    let applied = false;
    const Mm = await loadCards((src) => { applied = src.split(from).length === 2; return src.replace(from, to); });
    if (!applied) throw new Error(`mutant anchor must match once: ${from}`);
    return Mm;
  };
  const m5 = await mutant("  if (key === \"revenue\" && view.snapshot.revenueYoYNotMeaningful) {", "  if (false) {");
  check("MUTANT (#213 item 1) the statement ignores the marker: 'up 257233' back (caught)",
    /up 257,?233/.test(html(React.createElement(m5.SecIncomeStatementCard, { view: m5.buildSecEarningsView(mk(m5).JOBY) }))));
  const m6 = await mutant("  if (abs < 1e5) {", "  if (false) {");
  check("MUTANT (#213 item 2) no thousands tier: $15K reads $0.0M again (caught)", m6.scaledAmount(15e3) === "$0.0M");
  const m7 = await mutant("  if (yearAgoOnFile && now && (yearAgoRevenueUsd == null || yearAgoRevenueUsd === 0)) return NOT_MEANINGFUL_NO_BASE_REASON;", "");
  check("MUTANT (#213 item 3) no no-base rule: ACHR's revenue reads 'Turned profitable' again (caught)",
    /Turned profitable/.test(visibleText(html(React.createElement(m7.SecSnapshotCard, { view: m7.buildSecEarningsView(mk(m7).ACHR) })))));
}

if (failures) { console.log(`\nnot-meaningful: ${failures} FAILED`); process.exit(1); }
console.log("\nnot-meaningful: all checks passed");
