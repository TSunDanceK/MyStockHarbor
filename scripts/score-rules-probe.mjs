// #535 COWORK #20 §4: how many stored sets trip the proposed tiny-revenue /
// extreme-margin score rules, and how their scores change. MEASUREMENT ONLY —
// the shipped scorer runs unchanged; the rules are applied here by removing
// the excluded components' own recorded contributions (the score is seed +
// the sum of contributions, clamped and rounded — see buildScoreResult).
//   rule 1 (margin): either end of the marginTrend pair below -100%, or the
//          move beyond ±100pp → marginTrend excluded.
//   rule 2 (tiny base): prior-period revenue under $5M, or growth over +300%
//          → revenueGrowth excluded.
// Also prints BYND's narrative inputs (the "loss in both" vs "profitable"
// contradiction). Read-only.
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { loadCards } from "./lib/render-cards.mjs";
import { lift } from "./lib/earnings-plan.mjs";
const redis = Redis.fromEnv();
const M = await loadCards();
const A = await lift(fs.readFileSync("lib/server/annualOnly.ts", "utf8").replace(/^import type[^;]+;$/gm, ""));
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const today = new Date().toISOString().slice(0, 10);
const man = await redis.get("msh:sec:manifest:v1");
const syms = Object.entries(man.symbols).filter(([, e]) => e.cik && e.contentHash && !e.delisted).map(([s]) => s);
const extra = (process.env.SYMBOLS || "WKHS BYND").split(/\s+/).filter(Boolean);
for (const s of extra) if (!syms.includes(s)) syms.push(s);
const FLOOR = 5e6;
const rows = [];
let views = 0, scored = 0;
for (let i = 0; i < syms.length; i += 25) {
  const chunk = syms.slice(i, i + 25);
  const sets = await redis.mget(...chunk.map((s) => `msh:sec:facts:v1:${s}`));
  chunk.forEach((sym, k) => {
    const set = sets[k];
    if (!set) return;
    const annualForm = A.annualOnlyForm(REG[sym]?.annualForm, set, today);
    let view;
    try { view = M.buildSecEarningsView(set, { annualForm }); } catch { return; }
    if (!view) return;
    views++;
    const sc = M.scoreFromSec(view, sym, { status: "ready", set, cold: false });
    if (!sc.available) return;
    scored++;
    const s = view.snapshot;
    const c = sc.contributions;
    // rule 1, on the pair marginTrend actually reads
    const op = view.margins.filter((m) => m.operating != null).slice(-4).map((m) => m.operating);
    const first = op[0], last = op[op.length - 1];
    const r1 = c.marginTrend !== undefined && op.length >= 2 && (first < -100 || last < -100 || Math.abs(last - first) > 100);
    // rule 2, prior revenue from the growth the snapshot shows
    const rev = s.revenue?.val ?? null;
    const yoy = typeof s.revenueYoY === "number" ? s.revenueYoY : null;
    const prior = rev != null && yoy != null && yoy > -100 ? rev / (1 + yoy / 100) : null;
    const r2 = c.revenueGrowth !== undefined && ((prior != null && Math.abs(prior) < FLOOR) || (yoy != null && yoy > 300));
    // narrative-side margin (the pair the sentence names)
    const pp = M.anchorMarginDelta(view);
    const negWidened = pp !== null && /operating margin widened/.test(sc.explanation) &&
      (() => { const rowsA = view.basis === "year" ? view.annual ?? [] : view.margins ?? []; const l = rowsA.find((r) => r.label === view.latestLabel); return l?.operating != null && l.operating < 0; })();
    const narr1 = pp !== null && Math.abs(pp) > 100;
    let adj = sc.seed;
    for (const [key, pts] of Object.entries(c)) if (!(r1 && key === "marginTrend") && !(r2 && key === "revenueGrowth")) adj += pts;
    const after = Math.round(Math.min(100, Math.max(0, adj)));
    rows.push({ sym, score: sc.score, after, tone: sc.tone, toneAfter: M.bandFor(after), r1, r2, narr1, negWidened, rev, prior, yoy, first, last, c, basis: view.basis, label: view.latestLabel, explanation: sc.explanation });
  });
}
const r1 = rows.filter((r) => r.r1), r2 = rows.filter((r) => r.r2), either = rows.filter((r) => r.r1 || r.r2);
console.log(`sets read ${syms.length}; views ${views}; scored ${scored}`);
console.log(`rule 1 (margin) trips ${r1.length}; rule 2 (tiny base / >300%) trips ${r2.length} [prior<$5M ${r2.filter((r) => r.prior != null && Math.abs(r.prior) < FLOOR).length}, >300% ${r2.filter((r) => r.yoy > 300).length}]; either ${either.length}`);
console.log(`narrative: pp move beyond ±100 ${rows.filter((r) => r.narr1).length}; "widened" said of a negative margin ${rows.filter((r) => r.negWidened).length}`);
const moved = either.filter((r) => r.after !== r.score);
const bands = either.filter((r) => r.toneAfter !== r.tone);
const d = moved.map((r) => r.after - r.score);
console.log(`score changes ${moved.length}; mean ${(d.reduce((a, b) => a + b, 0) / (d.length || 1)).toFixed(1)}; down ${d.filter((x) => x < 0).length}, up ${d.filter((x) => x > 0).length}; band changes ${bands.length}`);
console.log("\nTOP 10 score changes:");
for (const r of [...moved].sort((a, b) => Math.abs(b.after - b.score) - Math.abs(a.after - a.score)).slice(0, 10)) {
  console.log(`  ${r.sym.padEnd(6)} ${r.score} → ${r.after} (${r.tone}→${r.toneAfter}) ${r.label} · ${r.r1 ? `margin ${r.first?.toFixed(0)}%→${r.last?.toFixed(0)}% (${(r.c.marginTrend ?? 0).toFixed(1)} pts)` : ""} ${r.r2 ? `rev ${(r.rev / 1e6).toFixed(1)}M vs ${(r.prior / 1e6).toFixed(2)}M (${r.yoy.toFixed(0)}%, ${(r.c.revenueGrowth ?? 0).toFixed(1)} pts)` : ""}`);
}
console.log("\nall band changes:", bands.map((r) => `${r.sym} ${r.score}→${r.after}`).join(", "));
for (const sym of extra) {
  const r = rows.find((x) => x.sym === sym);
  console.log(`\n${sym}: ${r ? `score ${r.score} → ${r.after}; r1 ${r.r1} r2 ${r.r2}; ${r.label}; contributions ${JSON.stringify(r.c)}` : "not scored"}`);
  if (r) console.log(`  narrative: ${r.explanation}`);
}
// BYND: which input says profitable
{
  const set = await redis.get("msh:sec:facts:v1:BYND");
  if (set) {
    const view = M.buildSecEarningsView(set, { annualForm: null });
    const s = view.snapshot;
    const sc = M.scoreFromSec(view, "BYND", { status: "ready", set, cold: false });
    console.log(`\nBYND ${view.latestLabel} (${view.latestEnd}) vs ${s.comparedWith}: netIncome ${JSON.stringify(s.netIncome)} epsDiluted ${JSON.stringify(s.epsDiluted)} epsYoY ${JSON.stringify(s.epsYoY)}`);
    console.log(`  unavailableWhy ${JSON.stringify(sc.unavailableWhy)}`);
    const idx = (k) => M.SEC_FIELDS.findIndex((f) => f.key === k);
    const q = set.quarters.find((p) => p.e === view.latestEnd);
    if (q) for (const k of ["revenue", "operatingIncome", "preTaxIncome", "incomeTaxExpense", "netIncome", "netIncomeToNoncontrollingInterest", "epsBasic", "epsDiluted", "sharesDiluted"]) console.log(`  stored ${k}: ${q.v[idx(k)]} (${set.cc?.[k] ?? ""})`);
  }
}
