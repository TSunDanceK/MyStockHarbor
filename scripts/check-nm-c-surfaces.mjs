// "n/m" ON C'S SURFACES (#563 COWORK #178), A'S RULE (#552 COWORK #212).
//
// A's #855 marks growth and margins off a tiny revenue base as "n/m" and puts
// the reason on the snapshot (`notMeaningful`) and the view. C's readers now
// honour it, importing A's text and reasons, never copying the rule:
//   - the insight page's "From the filings" tiles (EarningsTiles): JOBY's
//     operating-margin change reads "n/m vs Q2 FY2025: …", not ▲1,118,418 pt;
//     ACHR's −5,584% operating margin reads "n/m" with A's reason, uncoloured;
//   - the bottleneck page's "From the filings" (filedRowOf + FiledFigures):
//     JOBY's revenue reads "n/m y/y", not +257,233%, the reason in the fine print;
//   - the earnings-page charts (buildGrowthVisuals): ACHR's operating dot is
//     "n/m" with A's reason, JOBY's growth carries the n/m note;
//   - KO, an established name: every figure exactly as before, no "n/m".
// The snapshots are built by A's real view and snapshot code from fact sets
// shaped like A's census (the same shapes as scripts/check-not-meaningful.mjs);
// the components render with react-dom/server. Then a mutant per wiring.
//
//   node scripts/check-nm-c-surfaces.mjs
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./lib/tsx-render-hooks.mjs", import.meta.url);
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const V = await import("../lib/server/secEarningsView.ts");
const SNAP = await import("../lib/server/secEarningsSnapshot.ts");
const SCORE = await import("../lib/server/secEarningsScore.ts");
const { SEC_FIELD_KEYS } = await import("../lib/server/secFields.ts");

const INSIGHT = "app/insights/[slug]/InsightPage.tsx", VIEW = "app/bottlenecks/[ticker]/BottleneckView.tsx";
const BN = "lib/server/bottleneckPage.ts", GV = "lib/growthVisuals.ts";

let failures = 0, n = 0;
const check = (label, ok, detail = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail}` : ""}`); if (!ok) failures++; };
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

// ── fact sets shaped like A's census (CODE-A #229) ─────────────────────────
const per = (e, s, fp, fy, o) => {
  const v = SEC_FIELD_KEYS.map((k) => o[k] ?? null);
  return { e, s, fp, fy, a: null, f: null, v, d: v.map((x) => (x == null ? "-" : "F")).join("") };
};
const q = (fy, fp, o) => {
  const [s, e] = { Q1: ["01-01", "03-31"], Q2: ["04-01", "06-30"], Q3: ["07-01", "09-30"] }[fp];
  return per(`${fy}-${e}`, `${fy}-${s}`, fp, fy, o);
};
const set = (symbol, quarters) => ({ symbol, cik: null, tx: ["dei", "us-gaap"], cur: "USD", quarters, years: [], instants: [], nt: [] });
const SETS = {
  // JOBY: $38.6M against $15k; operating margin −675.2% now, about −1,119,000% a year ago.
  JOBY: set("JOBY", [
    q(2026, "Q2", { revenue: 38.6e6, operatingIncome: -260.6e6, netIncome: -245.2e6, epsDiluted: -0.29 }),
    q(2026, "Q1", { revenue: 15.1e6, operatingIncome: -210e6, netIncome: -200e6, epsDiluted: -0.25 }),
    q(2025, "Q2", { revenue: 15e3, operatingIncome: -167.9e6, netIncome: -160e6, epsDiluted: -0.22 }),
    q(2025, "Q1", { revenue: 30e3, operatingIncome: -150e6, netIncome: -145e6, epsDiluted: -0.21 }),
    q(2024, "Q2", { revenue: 20e3, operatingIncome: -120e6, netIncome: -118e6, epsDiluted: -0.18 }),
    q(2024, "Q1", { revenue: 10e3, operatingIncome: -110e6, netIncome: -108e6, epsDiluted: -0.17 }),
  ]),
  // ACHR: $5.0M of revenue, operating margin −5,584%.
  ACHR: set("ACHR", [
    q(2026, "Q2", { revenue: 5.0e6, operatingIncome: -279.2e6, netIncome: -263.2e6, epsDiluted: -0.4 }),
    q(2025, "Q2", { revenue: 0, operatingIncome: -150e6, netIncome: -140e6, epsDiluted: -0.3 }),
    q(2024, "Q2", { revenue: 0, operatingIncome: -120e6, netIncome: -115e6, epsDiluted: -0.25 }),
  ]),
  // KO: an established name, nothing near the rule.
  KO: set("KO", [
    q(2026, "Q2", { revenue: 12.5e9, grossProfit: 7.7e9, operatingIncome: 3.6e9, netIncome: 2.6e9, epsDiluted: 0.6 }),
    q(2025, "Q2", { revenue: 11.7e9, grossProfit: 7.2e9, operatingIncome: 3.3e9, netIncome: 2.5e9, epsDiluted: 0.58 }),
  ]),
};
const views = Object.fromEntries(Object.entries(SETS).map(([k, s]) => [k, V.buildSecEarningsView(s)]));
const snaps = Object.fromEntries(Object.entries(SETS).map(([k, s]) => [k, SNAP.buildSecEarningsSnapshot({
  symbol: k, view: views[k], score: SCORE.scoreFromSec(views[k], k, { status: "ready", set: s }), reported: null, nextReport: null,
})]));

// ── the surfaces, from a module (the real one, or a mutated copy) ──────────
async function load(file, mutate) {
  if (!mutate) return import(pathToFileURL(path.resolve(file)).href);
  const src = fs.readFileSync(file, "utf8"), mut = mutate(src);
  if (mut === src) return null;
  const tmp = path.join(path.dirname(file), `.check-nm-c-${process.pid}-${n++}${path.extname(file)}`);
  fs.writeFileSync(tmp, mut);
  try { return await import(pathToFileURL(path.resolve(tmp)).href); } finally { fs.rmSync(tmp, { force: true }); }
}
const tiles = (mod, k) => text(renderToStaticMarkup(React.createElement(mod.EarningsTiles, { d: { snapshot: snaps[k], pe: null } })));
const filed = (bn, view, k) => { const row = bn.filedRowOf(snaps[k]); return row ? text(renderToStaticMarkup(React.createElement(view.FiledFigures, { filed: row }))) : ""; };
const latest = (gv, k) => gv.buildGrowthVisuals(views[k]).quarters.periods.at(-1);

const NM = V.NOT_MEANINGFUL_TEXT, GROWTH = V.NOT_MEANINGFUL_GROWTH_REASON, MARGIN = V.NOT_MEANINGFUL_MARGIN_REASON;
const lc = (s) => s.charAt(0).toLowerCase() + s.slice(1);

const RULES = {
  "insight tile, JOBY: the operating-margin change reads n/m with A's reason, no ▲1,118,418 pt; the margin and EPS stand": ({ insight }) => {
    const t = tiles(insight, "JOBY");
    return t.includes(`Operating margin -675.1% ${NM} vs Q2 FY2025: ${lc(MARGIN)}`) && !/1,?118,?\d{3}/.test(t) && t.includes("$-0.29");
  },
  "insight tile, ACHR: the operating margin reads n/m with A's reason, uncoloured, no −5,584%": ({ insight }) => {
    const html = renderToStaticMarkup(React.createElement(insight.EarningsTiles, { d: { snapshot: snaps.ACHR, pe: null } }));
    const op = html.slice(html.indexOf("Operating margin"));
    return /Operating margin <\/div><div class="inTileValue">n\/m<\/div>|Operating margin<\/div><div class="inTileValue">n\/m<\/div>/.test(html) &&
      op.includes(MARGIN) && !/5,?584/.test(text(html)) && /data-tone="none"[^>]*><div class="inStatLabel">Operating margin/.test(html);
  },
  "bottleneck line, JOBY: revenue reads 'n/m y/y', no +257,233%; the reason is in the fine print; $38.6M stays": ({ bn, view }) => {
    const t = filed(bn, view, "JOBY");
    return t.includes(`$39m ${NM} y/y`) && !/257,?\d{3}/.test(t) && t.includes(`Revenue growth: ${NM}, ${lc(GROWTH)}.`);
  },
  "earnings charts: ACHR's operating dot is n/m with A's reason; JOBY's growth carries the n/m note": ({ gv }) => {
    const a = latest(gv, "ACHR"), j = latest(gv, "JOBY");
    return a.opPct === null && a.opText === NM && a.opNote === MARGIN && a.operating === `${NM}: ${lc(MARGIN)}` &&
      j.growth === null && j.growthNote === `sales growth ${NM}: ${lc(GROWTH)}`;
  },
  "KO unchanged: tiles, bottleneck line and chart print their figures, no n/m anywhere": ({ insight, bn, view, gv }) => {
    const t = tiles(insight, "KO"), f = filed(bn, view, "KO"), k = latest(gv, "KO");
    return t.includes("Gross margin 61.6%") && t.includes("Operating margin 28.8%") && t.includes("$0.60 up from $0.58") && !t.includes(NM) &&
      /\+6\.8% y\/y/.test(f) && /61\.6%/.test(f) && !f.includes(NM) &&
      k.grossText === "61.6%" && k.growth === "+6.8%" && !k.growthNote;
  },
};

const base = { insight: await load(INSIGHT), view: await load(VIEW), bn: await load(BN), gv: await load(GV) };
const run = (rule, m) => { try { return !!rule(m); } catch (e) { if (process.env.DEBUG) console.log(e); return false; } };
console.log("=== Rules ===");
for (const [label, rule] of Object.entries(RULES)) check(label, run(rule, base));

console.log("\n=== Mutants: each must FAIL its rule ===");
const MUTANTS = [
  ["insight tile, JOBY", "insight", INSIGHT, (s) => s.replace("change ? { text: NOT_MEANINGFUL_TEXT, reason: change } : null", "null")],
  ["insight tile, ACHR", "insight", INSIGHT, (s) => s.replace("value: own ? NOT_MEANINGFUL_TEXT :", "value: false ? NOT_MEANINGFUL_TEXT :")],
  ["bottleneck line, JOBY", "bn", BN, (s) => s.replace('revenueYoY: s.revenueYoY?.kind === "pct" && !nm?.revenueYoY ? s.revenueYoY.value : null,', 'revenueYoY: s.revenueYoY?.kind === "pct" ? s.revenueYoY.value : null,').replace('revenueYoY: s.revenueYoY?.kind === "pct" ? nm?.revenueYoY ?? null : null,', "revenueYoY: null,")],
  ["bottleneck line, JOBY", "view", VIEW, (s) => s.replace("{nmNotes(filed.notMeaningful).map(", "{[].map(")],
  ["earnings charts", "gv", GV, (s) => s.replace("  if (notMeaningful) return { pct: null, text: NOT_MEANINGFUL_TEXT, note: NOT_MEANINGFUL_MARGIN_REASON };\n  if (m == null", "  if (m == null")],
  ["earnings charts", "gv", GV, (s) => s.replace("growthNote: growthNm ? growthNotMeaningfulNote : null,", "growthNote: null,")],
  ["KO unchanged", "insight", INSIGHT, (s) => s.replace("value: own ? NOT_MEANINGFUL_TEXT :", "value: true ? NOT_MEANINGFUL_TEXT :")],
];
for (const [start, key, file, mutate] of MUTANTS) {
  const label = Object.keys(RULES).find((l) => l.startsWith(start));
  const mod = await load(file, mutate);
  if (!mod) { check(`mutant "${start}" (${file}) — the mutation did not apply`, false); continue; }
  check(`mutant bites: ${label} (${file})`, !run(RULES[label], { ...base, [key]: mod }));
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
