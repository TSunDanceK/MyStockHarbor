// THE DILUTION CHART'S SERIES IS CORRECTED BEFORE IT IS DRAWN (#552 COWORK #88/#89).
//
// Replaces the interim guard (#673), which only withheld the figures. Series
// shapes are the CODE-A #94 probe's own (SEC share counts):
//   1. AMZN's 20:1 split WITH the filer's restatement on file -> earlier years
//      scaled ×20, no step left, the note names the split.
//   2. the same series WITHOUT a restatement -> the chart starts after the step.
//   3. PAC ×1000 from 2017, NVDA's thousands -> the clean (latest) segment only.
//   4. GDDY: pre-listing 2013–2014 dropped; the 2016 -> 2023 hole breaks the
//      line ("no filing data"); no base within 6 months of the 3-year cut ->
//      "Recent history too short".
//   5. a steady diluter / a buyback -> the 3-year figure, its colour and its
//      hedged words; "Since" in plain ink beside it.
//   1f. BKNG as stored: a quarter re-reported after the split is already
//      restated; scaling stops there, and the split is noted once.
//   3b. ONDS: single filings mis-scaled ×1000 between agreeing neighbours are
//      dropped, not cut at (the chart was lost to them).
//   3c. DOV-like: a dropped mis-scaled year leaves no "no filing data" break,
//      and the source line says which filed figure was left out.
//   5b. AAPL as stored (no fiscal Q4 quarters, years stop at the first
//      quarter): the end steps back up to 6 months to find a base; never more.
//   plus MUTATIONS, one per rule.
//
//   node scripts/check-share-history-series.mjs
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

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
const ROOT = process.cwd();
const BUILDER = "lib/server/secShareHistory.ts";
const COMPONENT = "app/components/DilutionHistory.tsx";
let seq = 0;
async function builder(mutate = (s) => s) {
  const abs = path.join(ROOT, BUILDER);
  const tmp = abs.replace(/\.ts$/, `.__mut${process.pid}_${seq++}.ts`);
  fs.writeFileSync(tmp, mutate(fs.readFileSync(abs, "utf8")));
  try { return await import(pathToFileURL(tmp).href); } finally { fs.rmSync(tmp, { force: true }); }
}
async function component(mutate = (s) => s) {
  const js = ts.transpileModule(mutate(fs.readFileSync(COMPONENT, "utf8")), {
    fileName: "dilution.tsx",
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react" },
  }).outputText;
  const tmp = `scripts/.share-series-${process.pid}-${seq++}.mjs`;
  fs.writeFileSync(tmp, js);
  try { return await import(`${ROOT}/${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
}
/** A minimal stored set: annual points only (`as`), plus the restatement evidence. */
const set = (pairs, asr, asf, cover) => ({ as: pairs, quarters: [], years: [], ...(asr ? { asr } : {}), ...(asf ? { asf } : {}), ...(cover ? { cover: { val: cover } } : {}) });
// AAPL's 4:1 (2020), crossed by a year of buybacks: the step reads 3.80.
const AAPL = [["2015-09-26", 5753421000], ["2016-09-24", 5470820000], ["2017-09-30", 5217242000], ["2018-09-29", 19821510000], ["2019-09-28", 18471336000], ["2020-09-26", 17352119000]];
// A real doubling (an offering year), its earlier year re-filed unchanged.
const ISSUER = [["2020-12-31", 50e6], ["2021-12-31", 52e6], ["2022-12-31", 104e6], ["2023-12-31", 110e6], ["2024-12-31", 116e6]];
const AMZN = [["2017-12-31", 480e6], ["2018-12-31", 487e6], ["2019-12-31", 494e6], ["2020-12-31", 10005e6], ["2021-12-31", 10117e6], ["2022-12-31", 10189e6]];
const PAC = [["2015-12-31", 525575547], ["2016-12-31", 525575547], ["2017-12-31", 525575547000], ["2018-12-31", 525575547000], ["2019-12-31", 525575547000]];
const NVDA = [["2008-01-27", 550108], ["2009-01-25", 548126], ["2010-01-31", 549574000], ["2011-01-30", 575177000], ["2012-01-29", 602000000]];
const GDDY = [["2013-12-31", 38826000], ["2014-12-31", 38826000], ["2015-12-31", 58676000], ["2016-12-31", 79835000], ["2023-12-31", 148296000], ["2024-06-30", 141269000], ["2024-09-30", 140523000]];
// BKNG's stored quarters around its 25:1 (2026): Q1/Q2 2025 restated by the
// 2026 10-Qs' comparatives, Q3 2025 still as first filed.
const BKNG = [["2024-03-31", 33.9e6], ["2024-06-30", 33.4e6], ["2024-09-30", 33.1e6], ["2025-03-31", 816e6], ["2025-06-30", 812e6], ["2025-09-30", 32.38e6], ["2026-03-31", 790e6], ["2026-06-30", 768e6]];
// ONDS as archived (fourth probe run), from 2021: two single-filing ×1000 slips.
const ONDS = [["2021-12-31", 34180897], ["2022-12-31", 42242525], ["2023-09-30", 53892848], ["2024-03-31", 63035122], ["2024-06-30", 66377505], ["2024-09-30", 70741662], ["2025-03-31", 105005], ["2025-06-30", 150653000], ["2025-09-30", 259909415], ["2026-03-31", 445089], ["2026-06-30", 500709000]];
// A long annual series with one year filed in the wrong units (fifth probe run: DOV, EFX, FITB...).
const SLIP = [["2006-12-31", 203e6], ["2007-12-31", 200e6], ["2008-12-31", 186e6], ["2009-12-31", 186100], ["2010-12-31", 187e6], ["2011-12-31", 185e6]];
// ONDS 2016-2021 as archived: 2018 is pre-reverse-split and mixed with issuance.
const ONDS_EARLY = [["2016-12-31", 3e6], ["2017-12-31", 16191240], ["2018-12-31", 28528060], ["2019-12-31", 17610925], ["2020-12-31", 20428490], ["2021-12-31", 34180897]];
// AAPL's stored tail (third probe run): the years stop at 2022-09-24, and the
// quarters skip each fiscal Q4. From the latest quarter the cut lands in the hole.
const AAPL_TAIL = [["2021-09-25", 16701272000], ["2022-09-24", 16215963000], ["2023-09-30", 15744231000], ["2023-12-30", 15509763000], ["2024-03-30", 15405856000], ["2024-06-29", 15287521000], ["2024-12-28", 15081724000], ["2025-03-29", 14994082000], ["2025-06-28", 14902886000], ["2025-12-27", 14748158000], ["2026-03-28", 14673278000], ["2026-06-27", 14656110000]];
// Only an end 184 days back would find a base: one day past the tolerance.
const SHORT_END = [["2020-03-31", 100e6], ["2022-12-31", 110e6], ["2023-06-30", 112e6], ["2023-12-31", 115e6]];
const DILUTER = [["2019-12-31", 100e6], ["2020-12-31", 106e6], ["2021-12-31", 112e6], ["2022-12-31", 118e6], ["2023-12-31", 125e6]];
const BUYBACK = [["2019-12-31", 125e6], ["2020-12-31", 120e6], ["2021-12-31", 115e6], ["2022-12-31", 110e6], ["2023-12-31", 105e6]];

const B = await builder();
const C = await component();
const render = (M, h) => renderToStaticMarkup(React.createElement(M.default, { data: h, symbol: "X" }));

// ── the rules, over one load of each module ────────────────────────────────
const RULES = {
  "1. AMZN with its 20:1 restatement: earlier years ×20, no step left, the split noted": (b, c) => {
    const h = b.buildShareHistory(set(AMZN, [["2020-12-31", 20.01]]));
    return h && h.points.length === 6 && Math.abs(h.points[2].shares - 494e6 * 20) < 1 && h.splits?.[0]?.ratio === 20 && !h.startedAfter
      && h.points.slice(1).every((p, i) => b.splitRatioOf(p.shares / h.points[i].shares) === null)
      && /adjusted for a 20-for-1 split/.test(render(c, h));
  },
  "1b. AAPL: a 3.80 step against a proven 4:1 is scaled by 4 (buybacks mixed into the split year)": (b) => {
    const h = b.buildShareHistory(set(AAPL, [["2018-09-29", 4], ["2019-09-28", 4]]));
    return h && h.splits?.[0]?.ratio === 4 && h.points[2].shares === 5217242000 * 4 && !h.startedAfter;
  },
  "1c. an old proven split never explains a new step (2:1 proven in 2012, a 2.0x step in 2022 unproven)": (b) => {
    const h = b.buildShareHistory(set(ISSUER, [["2012-12-31", 2]]));
    return h && h.startedAfter?.reason === "unexplained-split-step" && h.points[0].date === "2022-12-31";
  },
  "1e. a recent split whose restated comparative sits BEFORE the step (last year's same quarter) is proven": (b) => {
    const h = b.buildShareHistory(set([["2024-03-31", 100e6], ["2024-06-30", 101e6], ["2025-03-31", 102e6], ["2025-12-31", 103e6], ["2026-03-31", 2575e6], ["2026-06-30", 2580e6]], [["2025-03-31", 25]]));
    return h && h.splits?.[0]?.ratio === 25 && h.points.length === 6 && !h.startedAfter;
  },
  "1f. BKNG: scaling stops at the already-restated quarter; one 25-for-1 note; no false start": (b) => {
    const h = b.buildShareHistory(set(BKNG, [["2025-03-31", 24.996], ["2025-06-30", 24.989]]));
    return h && h.points.length === 8 && !h.startedAfter && h.splits?.length === 1 && h.splits[0].ratio === 25
      && h.points.slice(1).every((p, i) => p.shares / h.points[i].shares > 0.9 && p.shares / h.points[i].shares < 1.1);
  },
  "1d. a doubling whose earlier year was re-filed unchanged is real issuance: kept": (b) => {
    const h = b.buildShareHistory(set(ISSUER, undefined, ["2021-12-31"]));
    return h && h.points.length === 5 && !h.startedAfter && !h.splits;
  },
  "2. the same series with NO restatement on file: starts after the step, nothing scaled": (b) => {
    const h = b.buildShareHistory(set(AMZN));
    return h && h.points[0].date === "2020-12-31" && h.startedAfter?.reason === "unexplained-split-step" && !h.splits;
  },
  "3. NVDA's thousands: the clean latest segment only, confirmed by its cover count": (b) => {
    const n = b.buildShareHistory(set(NVDA, undefined, undefined, 6.2e8));
    return n && n.points[0].date === "2010-01-31" && n.startedAfter?.reason === "scale-step" && !n.withheld;
  },
  "3d. PAC: the kept segment is 1,000× its cover count (505.28M) -> not drawn, and the page says why (#552 COWORK #121)": (b, c) => {
    const p = b.buildShareHistory(set(PAC, undefined, undefined, 505277464));
    const html = render(c, p);
    return p && p.points.length === 0 && p.withheld?.reason === "units-unconfirmed" && p.withheld.factor > 900
      && /data-share-withheld="">Not drawn: the share counts in this company/.test(html) && !/505\.28B|525\.58B/.test(html) && !/<svg/.test(html);
  },
  "3e. a >100× step cut with no cover count -> not drawn; no step and no cover -> drawn as before": (b, c) => {
    const p = b.buildShareHistory(set(PAC)), d = b.buildShareHistory(set(DILUTER));
    return p?.withheld?.factor === null && /no cover-page count to confirm/.test(render(c, p)) && d && d.points.length === 5 && !d.withheld;
  },
  "3b. ONDS: two single filings off ×1000 are dropped; the rest of the series is kept": (b) => {
    const h = b.buildShareHistory(set(ONDS));
    const dates = h?.points.map((p) => p.date) ?? [];
    return h && !h.startedAfter && dates.length === 9 && dates[0] === "2021-12-31" && !dates.includes("2025-03-31") && !dates.includes("2026-03-31");
  },
  "3c. a dropped mis-scaled year leaves no break, and the source line names it": (b, c) => {
    const h = b.buildShareHistory(set(SLIP));
    const html = render(c, h);
    return h && h.points.length === 5 && !h.gaps && h.dropped?.[0] === "2009-12-31" && !/no filing data/.test(html)
      && (html.match(/data-share-segment/g) ?? []).length === 1 && /The filed figure for Dec 2009 is left out/.test(html);
  },
  "3f. ONDS: a 1-for-3 restated in 2019-2020 that no step matched -> starts at the first restated year, noted": (b, c) => {
    const h = b.buildShareHistory(set(ONDS_EARLY, [["2019-12-31", 0.3341], ["2020-03-31", 0.3325], ["2020-06-30", 0.3333]]));
    return h && h.points[0].date === "2019-12-31" && h.startedAfter?.reason === "unmatched-split" && h.startedAfter.ratio === 1 / 3
      && /restated its earlier counts for a 1-for-3 split/.test(render(c, h));
  },
  "3g. a fully restated history (no step next to the split) is not cut": (b) => {
    const h = b.buildShareHistory(set([["2017-12-31", 9.4e6], ["2018-12-31", 9.5e6], ["2019-12-31", 9.6e6], ["2020-12-31", 9.8e6]], [["2019-12-31", 0.3341]]));
    return h && h.points.length === 4 && !h.startedAfter;
  },
  "4a. GDDY: pre-listing points dropped (first report 2015-03-31)": (b) => {
    const h = b.buildShareHistory(set(GDDY), { listedFrom: "2015-03-31" });
    return h && h.points[0].date === "2015-12-31" && h.startedAfter?.reason === "listing";
  },
  "4b. GDDY: the 2016 -> 2023 hole breaks the line, labelled \"no filing data\"": (b, c) => {
    const h = b.buildShareHistory(set(GDDY), { listedFrom: "2015-03-31" });
    const html = render(c, h);
    return h?.gaps?.length === 1 && h.gaps[0].from === "2016-12-31" && (html.match(/data-share-segment/g) ?? []).length === 2 && /no filing data/.test(html);
  },
  "4c. GDDY: no base within 6 months of the 3-year cut -> \"Recent history too short\"": (b, c) => {
    const h = b.buildShareHistory(set(GDDY), { listedFrom: "2015-03-31" });
    return h?.threeYear?.pct === null && /Recent history too short/.test(render(c, h));
  },
  "5. a diluter reads risen (red), a buyback fallen (green); Since sits beside it in plain ink": (b, c) => {
    const d = b.buildShareHistory(set(DILUTER)), k = b.buildShareHistory(set(BUYBACK));
    const hd = render(c, d), hk = render(c, k);
    return Math.abs(d.threeYear.pct - ((125 - 106) / 106) * 100) < 1e-9 && /Share count has risen over the last 3 years/.test(hd) && /color:#ef4444/.test(hd)
      && /Share count has fallen over the last 3 years/.test(hk) && /color:#22c55e/.test(hk) && /Since Dec 2019/.test(hd);
  },
  "5b. AAPL as stored: the end steps back to 2025-12-27 (182 days) for a base at 2022-09-24; 184 days back is too far": (b, c) => {
    const h = b.buildShareHistory(set(AAPL_TAIL)), s = b.buildShareHistory(set(SHORT_END));
    return h?.threeYear?.pct !== null && h.threeYear.end.date === "2025-12-27" && h.threeYear.base.date === "2022-09-24"
      && Math.abs(h.threeYear.pct - ((14748158000 - 16215963000) / 16215963000) * 100) < 1e-9
      && /Share count has fallen over the last 3 years/.test(render(c, h))
      // The tile names the window's actual ends, never "latest" (#552 COWORK #120).
      && /data-share-three-window="">24 Sept? 2022 to 27 Dec 2025</.test(render(c, h)) && !/latest/i.test(render(c, h).match(/data-share-three-year[\s\S]*?<\/div><\/div>/)?.[0] ?? "x latest")
      && s?.threeYear?.pct === null;
  },
};
for (const [name, rule] of Object.entries(RULES)) {
  let ok = false; try { ok = Boolean(rule(B, C)); } catch { ok = false; }
  check(name, ok);
}

const caught = async (bm, cm) => {
  const b = bm ? await builder(bm) : B, c = cm ? await component(cm) : C;
  return Object.values(RULES).some((r) => { try { return !r(b, c); } catch { return true; } });
};
const MUTANTS = [
  ["a split-like step scaled with no restatement on file", (s) => once(s, "    if (refiled.includes(pts[i - 1].date)) continue;\n    {", "    if (refiled.includes(pts[i - 1].date)) continue;\n    if (true) { for (let j = 0; j < i; j++) pts[j] = { ...pts[j], shares: pts[j].shares * k }; continue; }\n    {"), null],
  ["the proven-split date window removed", (s) => once(s, "nearStep(x.e, pts[i].date) && ", ""), null],
  ["the loose match for a proven split removed", (s) => once(s, "Math.abs(r / x.k - 1) < SHARE_PROVEN_SPLIT_TOLERANCE", "Math.abs(r / x.k - 1) < SHARE_SPLIT_TOLERANCE"), null],
  ["re-filed periods ignored", (s) => once(s, "    if (refiled.includes(pts[i - 1].date)) continue;\n", ""), null],
  ["isolated mis-scaled filings kept (cut at instead)", (s) => once(s, "    if (slip) slips.push(p.date);\n    return !slip;", "    return true;"), null],
  ["a proven split scales every earlier point again", (s) => once(s, "while (j0 > 0 && Math.abs((pts[j0].shares / pts[j0 - 1].shares) * p - 1) >= SHARE_PROVEN_SPLIT_TOLERANCE) j0--;", "j0 = 0;"), null],
  ["the same split noted twice", (s) => once(s, "if (!splits.some((x) => x.ratio === p && nearStep(x.date, pts[i].date))) splits.push", "splits.push"), null],
  ["a dropped filing counted as a gap", (s) => once(s, "    if (dropped.some((d) => d > from && d < to)) continue;\n", ""), null],
  ["the dropped filing not named", null, (s) => once(s, "  if (dropped.length === 1) out.push(", "  if (false) out.push(")],
  ["the units check removed", (s) => once(s, "  if (withheld) return { points: [], basis: raw.basis, withheld };", ""), null],
  ["the units check against the cover only, not the uncovered cut", (s) => once(s, '  return fixed.startedAfter?.reason === "scale-step" ? { reason: "units-unconfirmed", factor: null } : null;', "  return null;"), null],
  ["an unmatched split drawn across", (s) => once(s, '      startedAfter = { date: pts[j].date, reason: "unmatched-split", ratio: k };\n      pts = pts.slice(j);', ""), null],
  ["any move next to a split cut (no step test)", (s) => once(s, "      if (Math.abs(Math.log(r)) <= Math.log(SHARE_UNMATCHED_SPLIT_STEP)) continue;\n", ""), null],
  ["the withheld reason not shown", null, (s) => once(s, "  if (data?.withheld) {", "  if (false) {")],
  ["the >100× guard removed", (s) => once(s, "if (r > SHARE_SCALE_MAX_STEP || r < 1 / SHARE_SCALE_MAX_STEP) {", "if (false) {"), null],
  ["pre-listing points kept", (s) => once(s, "  if (listedFrom) {", "  if (false) {"), null],
  ["the end never steps back", (s) => once(s, "i >= 0 && days(points[i].date, last.date) <= SHARE_TREND_BASE_MAX_DAYS; i--", "i >= points.length - 1; i--"), null],
  ["the end steps back without limit", (s) => once(s, "i >= 0 && days(points[i].date, last.date) <= SHARE_TREND_BASE_MAX_DAYS; i--", "i >= 0; i--"), null],
  ["the 6-month base window removed", (s) => once(s, "days(base.date, cut) > SHARE_TREND_BASE_MAX_DAYS || ", ""), null],
  ["the line drawn across a gap", null, (s) => once(s, "if (gapStarts.has(c.p.date)) segments.push([]);", "")],
  ["the window caption dropped", null, (s) => once(s, "          {threeWindow ? (", "          {false ? (")],
  ["the colour from first-vs-last again", null, (s) => once(s, "const trend = threeYearWords(threePct);", "const trend = threeYearWords(changePercent);")],
];
for (const [label, bm, cm] of MUTANTS) check(`MUTATION: ${label} → caught`, await caught(bm, cm));

// THE LAYOUT (#552 COWORK #88 §1): the chart and the learn links FULL WIDTH
// after the clear; phones read description -> dilution -> stats -> links.
const PROFILE = fs.readFileSync("app/components/CompanyProfile.tsx", "utf8");
const layout = (src) =>
  /<div className="cp-clear" \/>\s*\{belowDescription \? <div className="cp-full cp-full-chart">\{belowDescription\}<\/div> : null\}\s*\{belowStats \? <div className="cp-full cp-full-learn">\{belowStats\}<\/div> : null\}/.test(src)
  && /\.cp-desc \{ order: 1; \}\s*\.cp-full-chart \{ order: 2; \}\s*\.cp-stats \{ order: 3; \}\s*\.cp-full-learn \{ order: 4;/.test(src)
  && !/cp-below-desc/.test(src);
check("layout: the chart, then Learn the indicators, full width after the clear; phones description -> dilution -> stats -> links", layout(PROFILE));
check("MUTATION: the chart back beside the float (before the clear) → caught",
  !layout(once(PROFILE, `<div className="cp-clear" />\n          {belowDescription ? <div className="cp-full cp-full-chart">{belowDescription}</div> : null}`, `{belowDescription ? <div className="cp-full cp-full-chart">{belowDescription}</div> : null}\n          <div className="cp-clear" />`)));

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
