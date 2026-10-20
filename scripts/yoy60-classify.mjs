// YOY60 CLASSIFICATION — read-only. Groups the r1 scan's yoy60 filers (revenue
// YoY beyond ±60% while net income's YoY does not move the same way) by likely
// cause, through MAIN's shipped extraction. Changes nothing.
//
// Per flagged period (period vs the same period a year earlier), the first
// matching group wins, in this order:
//   scale      revenue ratio within 2% of 1000x / 1e6x (or their inverses)
//   duration   ratio 3.5-4.5x or 0.22-0.29x (a year against a quarter)
//   concept    the two periods' revenue cells come from different tags, or one is computed
//   restated   the year-ago frame carries values >5% apart across filings (same tag)
//   financial  SIC 6000-6799, or the filer tags InterestIncomeExpenseNet
//   mna        acquisitions paid in the period >= 25% of year-ago revenue, or
//              diluted weighted shares moved >= 40% (merger, IPO, spin)
//   divest     a fall past -60% with divestiture proceeds or discontinued operations tagged
//   tinyBase   year-ago revenue under $25M
//   genuine    none of the above
// A filer is counted once, under the group of its largest-|YoY| flagged period.
//
// CREDENTIALLED, READ-ONLY: one manifest GET. companyfacts at 250ms spacing.
// SYMBOLS="SHARD i/n" splits the manifest. relay task: write-yoy60-classify
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { loadMainAndBranch } from "./lib/earnings-audit-lift.mjs";

const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (+https://www.mystockharbor.com; yoy60 classification)";
const { NEW, OLD } = await loadMainAndBranch();
const M = OLD ?? NEW;
console.log(`extraction: ${OLD ? "main" : "BRANCH (main unavailable)"}`);

const MANIFEST_KEY = (fs.readFileSync("lib/server/secManifest.ts", "utf8").match(/SEC_MANIFEST_KEY = "([^"]+)"/) ?? [])[1];
const redis = Redis.fromEnv();
const manifest = await redis.get(MANIFEST_KEY);
if (!manifest?.symbols) { console.error("FATAL: no manifest"); process.exit(2); }
const all = Object.entries(manifest.symbols).filter(([, e]) => e?.cik).map(([s, e]) => [s, String(e.cik).padStart(10, "0")]).sort();
const m = String(process.env.SYMBOLS || "").match(/SHARD\s+(\d+)\s*\/\s*(\d+)/i);
const [shard, shards] = m ? [Number(m[1]), Number(m[2])] : [0, 1];
const targets = all.filter((_, i) => i % shards === shard);
console.log(`manifest symbols with a CIK: ${all.length}; this shard ${shard}/${shards}: ${targets.length}\n`);

const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).fields ?? {};
const usd = (facts, c) => facts.facts?.["us-gaap"]?.[c]?.units?.USD ?? [];
const frameOf = (r) => `${r.start}..${r.end}`;
const near = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) <= 10 * 864e5;
/** Sum of a duration concept's newest values whose frame lies inside [start, end] at about that duration. */
function flowIn(facts, c, start, end) {
  const best = new Map();
  for (const r of usd(facts, c)) {
    if (!r.start || !near(r.start, start) || !near(r.end, end)) continue;
    const k = frameOf(r), p = best.get(k);
    if (!p || String(r.filed) > String(p.filed)) best.set(k, r);
  }
  return [...best.values()][0]?.val ?? null;
}
function dilutedShares(facts, start, end) {
  const rows = facts.facts?.["us-gaap"]?.WeightedAverageNumberOfDilutedSharesOutstanding?.units?.shares ?? [];
  const hit = rows.filter((r) => r.start && near(r.start, start) && near(r.end, end)).sort((a, b) => String(b.filed).localeCompare(String(a.filed)))[0];
  return hit?.val ?? null;
}
function restated(facts, tag, start, end) {
  if (!tag) return null;
  const vals = usd(facts, tag).filter((r) => r.start && near(r.start, start) && near(r.end, end)).map((r) => r.val);
  if (vals.length < 2) return null;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  return lo > 0 && hi > lo * 1.05 ? `${(lo / 1e6).toFixed(1)}M..${(hi / 1e6).toFixed(1)}M` : null;
}

const ORDER = ["scale", "duration", "concept", "restated", "financial", "mna", "divest", "tinyBase", "genuine"];
const groups = Object.fromEntries(ORDER.map((g) => [g, []]));
let flaggedFilers = 0, done = 0, failed = 0;

for (const [sym, cik] of targets) {
  let facts;
  try {
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
      headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" }, signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) { failed++; await new Promise((r) => setTimeout(r, 250)); continue; }
    facts = await res.json();
  } catch { failed++; continue; }
  try {
    const ex = M.extractCompanyFacts(sym, facts);
    const ri = M.SEC_FIELD_KEYS.indexOf("revenue"), ni = M.SEC_FIELD_KEYS.indexOf("netIncome");
    const sic = Number(REG[sym]?.sic ?? NaN);
    const fin = (sic >= 6000 && sic <= 6799) || usd(facts, "InterestIncomeExpenseNet").length > 0;
    const disc = usd(facts, "IncomeLossFromDiscontinuedOperationsNetOfTax").length > 0 || usd(facts, "ProceedsFromDivestitureOfBusinesses").length > 0;
    let worst = null;
    for (const list of [ex.years, ex.quarters]) {
      for (const p of list) {
        const r = p.values[ri];
        if (r?.val == null) continue;
        const ago = list.find((q) => Math.abs(Date.parse(q.end) - (Date.parse(p.end) - 365.25 * 864e5)) < 10 * 864e5);
        const r0 = ago?.values[ri];
        if (!(r0?.val > 0)) continue;
        const g = (r.val - r0.val) / r0.val;
        const n1 = p.values[ni]?.val, n0 = ago.values[ni]?.val;
        const ng = n1 != null && n0 != null && n0 > 0 ? (n1 - n0) / n0 : null;
        if (!(Math.abs(g) > 0.6) || (ng != null && Math.abs(ng) > 0.6 && Math.sign(ng) === Math.sign(g))) continue;
        const ratio = r.val / r0.val;
        const acq = flowIn(facts, "PaymentsToAcquireBusinessesNetOfCashAcquired", p.start, p.end);
        const s1 = dilutedShares(facts, p.start, p.end), s0 = dilutedShares(facts, ago.start, ago.end);
        const sh = s1 && s0 ? s1 / s0 - 1 : null;
        const rest = restated(facts, r0.tag, ago.start, ago.end);
        const group =
          [1000, 1e6].some((k) => Math.abs(ratio / k - 1) < 0.02 || Math.abs(ratio * k - 1) < 0.02) ? "scale"
          : (ratio >= 3.5 && ratio <= 4.5) || (ratio >= 0.22 && ratio <= 0.29) ? "duration"
          : r.tag !== r0.tag || r.derived === "computed" || r0.derived === "computed" ? "concept"
          : rest ? "restated"
          : fin ? "financial"
          : (acq != null && acq >= 0.25 * r0.val) || (sh != null && Math.abs(sh) >= 0.4) ? "mna"
          : g < -0.6 && disc ? "divest"
          : r0.val < 25e6 ? "tinyBase"
          : "genuine";
        const detail = `${sym} ${p.fp ?? ""}${p.fy ?? ""} ${(r0.val / 1e6).toFixed(1)}M -> ${(r.val / 1e6).toFixed(1)}M (${(g * 100).toFixed(0)}%), NI ${ng == null ? "n/a" : `${(ng * 100).toFixed(0)}%`}`
          + (group === "concept" ? ` [${r0.tag}${r0.derived === "computed" ? "*" : ""} -> ${r.tag}${r.derived === "computed" ? "*" : ""}]` : "")
          + (rest ? ` [year-ago filed ${rest}]` : "")
          + (acq != null ? ` [acq ${(acq / 1e6).toFixed(0)}M]` : "")
          + (sh != null ? ` [shares ${(sh * 100).toFixed(0)}%]` : "")
          + (Number.isFinite(sic) ? ` [SIC ${sic}]` : "");
        if (!worst || Math.abs(g) > Math.abs(worst.g)) worst = { g, group, detail };
      }
    }
    if (worst) { flaggedFilers++; groups[worst.group].push(worst.detail); }
  } catch (e) { failed++; console.log(`ERR ${sym}: ${e.message}`); }
  if (++done % 200 === 0) console.log(`... ${done}/${targets.length}`);
  await new Promise((r) => setTimeout(r, 250));
}

console.log(`\nfilers read: ${done}; failed: ${failed}; flagged yoy60: ${flaggedFilers}\n`);
for (const g of ORDER) {
  console.log(`== ${g}: ${groups[g].length}`);
  for (const d of groups[g]) console.log(`  ${d}`);
}
