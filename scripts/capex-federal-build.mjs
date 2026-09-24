// BUILD data/capex/federal-baseline.json — a dated snapshot of the Federal
// contracts panel, shown only until the capex-federal job has written its
// first record (so a preview is not empty). Same code as the job: the
// matcher, the roll-up and the USAspending fetch are lifted from
// lib/server/capexFederal.ts. Read-only; prints the JSON between markers.
//
//   node scripts/capex-federal-build.mjs
import fs from "node:fs";
import { liftCapexFederal } from "./lib/capex-lift.mjs";

const F = await liftCapexFederal();
const tickers = JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8")).data;
const aliases = JSON.parse(fs.readFileSync("data/capex/federal-aliases.json", "utf8"));
const now = new Date();
const fetched = await F.fetchFederal(now, Date.now() + 25 * 60_000, F.CAPEX_FEDERAL_PAGES);
const match = F.buildMatcher(tickers, aliases.aliases, aliases.exclusions);
const rolled = F.rollUp(fetched.rows, match);
const doc = {
  version: 1,
  updatedAt: now.toISOString(),
  window: fetched.window,
  totalObligations: fetched.total,
  topRecipientsObligations: fetched.rows.reduce((a, r) => a + Math.max(0, r.amount), 0),
  recipientsRead: fetched.rows.length,
  matchedObligations: rolled.matched,
  companies: rolled.companies,
  unmatchedLargest: rolled.unmatchedLargest,
};
console.log(`window ${doc.window.start}..${doc.window.end}; recipients ${doc.recipientsRead}; total ${(doc.totalObligations / 1e9).toFixed(1)}bn; matched ${(doc.matchedObligations / 1e9).toFixed(1)}bn (${((100 * doc.matchedObligations) / doc.totalObligations).toFixed(1)}%)`);
for (const c of doc.companies.slice(0, 40)) console.log(`  ${c.ticker.padEnd(6)} ${(c.amount / 1e9).toFixed(2)}bn  recipients ${c.recipients}  via ${c.via}  ${c.name}`);
console.log("UNMATCHED:");
for (const u of doc.unmatchedLargest) console.log(`  ${(u.amount / 1e6).toFixed(0)}m  ${u.name}`);
console.log("=====BEGIN federal-baseline.json=====");
console.log(JSON.stringify(doc, null, 1));
console.log("=====END federal-baseline.json=====");
