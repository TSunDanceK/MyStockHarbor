// WHY sec-facts TIMES OUT, measured before anything is changed. Reads only.
//
//   1. the last recorded run of every SEC job (sec-facts, sec-daily-index,
//      ipo-refresh, sec-report-dates-rewrite), with its full summary
//   2. the queues the NEXT sec-facts run will build, from today's manifest,
//      using the shipped staleness rule (needsReread's four stamps) and the
//      shipped allowances -- split by WHY each rewindow entry is stale
//   3. the companyfacts fetch cost, sampled on this runner, so the per-run
//      wall time can be estimated against the 300s budget
//   relay task: write-sec-facts-timeout-diagnosis (credentialled for the read)
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; sec-facts diagnosis)";
const src = (f) => fs.readFileSync(f, "utf8");
const num = (f, n) => Number((src(f).match(new RegExp(`export const ${n} = (\\d+)`)) ?? [])[1]);
const keyOf = (f, n) => (src(f).match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];

const QW = num("lib/server/secExtract.ts", "SEC_QUARTER_WINDOW");
const YW = num("lib/server/secExtract.ts", "SEC_YEAR_WINDOW");
const LV = num("lib/server/secExtract.ts", "SEC_LABEL_VERSION");
const route = "app/api/jobs/sec-facts/route.ts";
const LIM = {
  cold: num(route, "SEC_COLD_PER_RUN"), reverify: num(route, "SEC_REVERIFY_PER_RUN"),
  populate: num(route, "SEC_POPULATE_PER_RUN"), rewindow: num(route, "SEC_REWINDOW_PER_RUN"),
  slack: num(route, "SEC_POPULATE_SLACK_CEILING"), dates: num(route, "SEC_REPORT_DATES_PER_RUN"),
};
const fields = await lift(readCodeOnly("lib/server/secFields.ts").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
  .replace(/export (const|function|type)/g, "$1") + "\nexport { secChainsHash };", "", "secFields");
const CHAINS = fields.secChainsHash();
console.log(`shipped stamps: w=${QW} y=${YW} lv=${LV} c=${CHAINS} · allowances ${JSON.stringify(LIM)}\n`);

// ── 1 ──
const JOB = keyOf("lib/server/jobRuns.ts", "JOB_RUN_PREFIX");
for (const job of ["sec-daily-index", "sec-facts", "ipo-refresh", "sec-report-dates-rewrite"]) {
  const r = await redis.get(`${JOB}:${job}`);
  console.log(`${job.padEnd(26)} last recorded ${r ? new Date(r.at).toISOString() : "NONE (or expired: 8-day TTL)"} ok=${r?.ok ?? "-"}`);
  if (r) console.log(`  ${JSON.stringify(r.summary).slice(0, 1500)}`);
}

// ── 2 ──
const manifest = await redis.get(keyOf("lib/server/secManifest.ts", "SEC_MANIFEST_KEY"));
const entries = Object.entries(manifest.symbols).filter(([, e]) => e.cik);
const reasons = (e) => {
  const out = [];
  if ((e.w ?? 8) < QW) out.push("quarters");
  if ((e.y ?? 5) < YW) out.push("years");
  if ((e.lv ?? 1) < LV) out.push("labels");
  if ((e.c ?? null) !== CHAINS) out.push("chains");
  return out;
};
const reverify = entries.filter(([, e]) => e.needsReverify);
const populate = entries.filter(([, e]) => !e.needsReverify && e.contentHash === null);
const rewindow = entries.filter(([, e]) => !e.needsReverify && e.contentHash !== null && reasons(e).length);
const rt = Math.min(reverify.length, LIM.reverify), pt = Math.min(populate.length, LIM.populate);
const slack = populate.length < LIM.slack ? LIM.reverify - rt + (LIM.populate - pt) : 0;
const rwLimit = LIM.rewindow + slack;
const rwt = Math.min(rewindow.length, rwLimit);
console.log(`\nmanifest: ${entries.length} entries with a CIK`);
console.log(`queues next run: reverify ${reverify.length} (takes ${rt}) · populate ${populate.length} (takes ${pt}) · ` +
  `rewindow ${rewindow.length} (limit ${rwLimit} = ${LIM.rewindow} + slack ${slack}; takes ${rwt})`);
console.log(`=> fact-set fetches next run: up to ${LIM.cold} cold + ${rt + pt + rwt} = ${LIM.cold + rt + pt + rwt}`);
const by = {};
for (const [, e] of rewindow) for (const r of reasons(e)) by[r] = (by[r] ?? 0) + 1;
console.log(`rewindow stale reasons: ${JSON.stringify(by)}`);
const lvDist = {}; for (const [, e] of entries) lvDist[e.lv ?? "absent"] = (lvDist[e.lv ?? "absent"] ?? 0) + 1;
const cDist = {}; for (const [, e] of entries) cDist[e.c ?? "absent"] = (cDist[e.c ?? "absent"] ?? 0) + 1;
console.log(`manifest lv: ${JSON.stringify(lvDist)} · c: ${JSON.stringify(cDist)}`);
const verified = entries.map(([, e]) => e.verifiedAt).filter(Boolean).sort((a, b) => b - a);
console.log(`newest verifiedAt in the manifest: ${verified[0] ? new Date(verified[0]).toISOString() : "none"}`);

// ── 3 ──
const sample = rewindow.slice(0, 20);
const t = [];
let bytes = 0;
for (const [sym, e] of sample) {
  const t0 = Date.now();
  const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${e.cik}.json`, { headers: { "User-Agent": UA } });
  const body = await res.arrayBuffer();
  t.push(Date.now() - t0); bytes += body.byteLength;
  await new Promise((r) => setTimeout(r, 125));
  void sym;
}
t.sort((a, b) => a - b);
console.log(`\ncompanyfacts fetch on this runner, ${t.length} rewindow symbols: p50 ${t[t.length >> 1]}ms · max ${t[t.length - 1]}ms · mean ${Math.round(t.reduce((a, b) => a + b, 0) / t.length)}ms · ${(bytes / t.length / 1e6).toFixed(1)} MB avg`);
