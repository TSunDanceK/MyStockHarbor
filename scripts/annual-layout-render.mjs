// #535 COWORK #15: before/after render text for the annual-only layout, from
// LIVE stored sets (read-only). "before" = today's view (no annualForm);
// "after" = the PR's rule applied (annualOnlyForm from registrants + set).
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { loadCards, html, visibleText, React } from "./lib/render-cards.mjs";
import { lift } from "./lib/earnings-plan.mjs";
const redis = Redis.fromEnv();
const M = await loadCards();
const A = await lift(fs.readFileSync("lib/server/annualOnly.ts", "utf8").replace(/^import type[^;]+;$/gm, ""));
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const today = new Date().toISOString().slice(0, 10);
const cut = (t, n = 420) => t.replace(/\s+/g, " ").trim().slice(0, n);
for (const sym of ["ASML", "NVO", "SAP", "SONY", "BABA", "TSM", "BMO", "ONON"]) {
  const set = await redis.get(`msh:sec:facts:v1:${sym}`);
  const form = REG[sym]?.annualForm ?? null;
  console.log(`\n==== ${sym} · annualForm ${form} · stored quarters ${set?.quarters?.length ?? "—"} (newest ${set?.quarters?.[0]?.e ?? "—"}) · years ${set?.years?.length ?? "—"} (newest ${set?.years?.[0]?.e ?? "—"}, filed ${set?.years?.[0]?.f ?? "—"}) · cur ${set?.cur ?? "USD"}${set?.lg ? ` · notice ${set.lg.form} ${set.lg.reportDate}` : ""}`);
  if (!set) { console.log("  no stored set"); continue; }
  const af = A.annualOnlyForm(form, set, today);
  console.log(`  RULE -> ${af ?? "quarterly layout"}`);
  const before = M.buildSecEarningsView(set);
  const after = M.buildSecEarningsView(set, { annualForm: af });
  if (!after) { console.log("  view: null (not renderable — e.g. non-USD without a rate)"); continue; }
  for (const [tag, v] of [["BEFORE", before], ["AFTER", after]]) {
    if (!v) { console.log(`  ${tag}: view null`); continue; }
    const snap = visibleText(html(React.createElement(M.SecSnapshotCard, { view: v })));
    const recent = visibleText(html(React.createElement(M.SecRecentPeriodsCard, { view: v })) ?? "");
    const growth = v.tableBasis === "year" ? "(hidden by the page)" : cut(visibleText(html(React.createElement(M.SecGrowthMarginsCard, { view: v }))), 160);
    console.log(`  ${tag}: basis ${v.basis}/${v.tableBasis} · latest ${v.latestLabel} (${v.latestEnd})`);
    console.log(`    snapshot: ${cut(snap, 300)}`);
    console.log(`    growth card: ${growth}`);
    console.log(`    recent quarters: ${recent ? cut(recent, 120) : "(renders nothing)"}`);
  }
  if (af) {
    console.log(`  NOTE: ${A.annualOnlyNote(af)}`);
    const o = A.annualNextReportOutlook(sym, set, af);
    console.log(`  NEXT REPORT: ${o.headline} | ${o.hedge ?? ""} | ${o.evidence.join(" ")}`);
    console.log(`  FIVE-YEAR: ${cut(visibleText(html(React.createElement(M.SecAnnualCard, { view: after, sole: true }))), 360)}`);
  }
}
