// HOW FAR THE PAIRING REWRITE HAS GOT. Reads only.
//
// Two sources, printed side by side so neither is taken on trust: the last
// sec-facts run's own counters (reportDatesRewrite*) and a direct count over
// data/sec/report-dates-rewrite.json of which records carry the done marker
// (pairingRewriteDone: the `earlyNonResults` key, null included).
//   relay task: write-report-dates-rewrite-progress  (credentialled for the read)
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const JOB_RUN_PREFIX = keyOf("lib/server/jobRuns.ts", "JOB_RUN_PREFIX");
const DATES_PREFIX = keyOf("lib/server/secReportDatesStore.ts", "SEC_REPORT_DATES_PREFIX");
if (!JOB_RUN_PREFIX || !DATES_PREFIX) { console.error("FATAL: key prefixes not readable"); process.exit(2); }

const list = JSON.parse(fs.readFileSync("data/sec/report-dates-rewrite.json", "utf8")).symbols;
const cut = new Set(JSON.parse(fs.readFileSync("data/due-strip.json", "utf8")).symbols);

const run = await redis.get(`${JOB_RUN_PREFIX}:sec-facts`);
const s = run?.summary ?? {};
console.log(`last sec-facts run: ${run ? new Date(run.at).toISOString() : "none recorded"} · ok=${run?.ok}`);
console.log(`  rewrite queued ${s.reportDatesRewrite ?? "n/a"} · written ${s.reportDatesRewriteWritten ?? "n/a"} · ` +
  `failed ${s.reportDatesRewriteFailed ?? "n/a"} · left ${s.reportDatesRewriteLeft ?? "n/a"}`);
console.log(`  report dates attempted ${s.reportDatesAttempted ?? "n/a"} · written ${s.reportDatesWritten ?? "n/a"} · failed ${s.reportDatesFailed ?? "n/a"}`);

const done = [], left = [];
for (const sym of list) {
  const rec = await redis.get(`${DATES_PREFIX}:${sym}`);
  (rec && typeof rec === "object" && "earlyNonResults" in rec ? done : left).push(sym);
}
console.log(`\nlist ${list.length} · done ${done.length} · left ${left.length}`);
console.log(`  cut members left: ${left.filter((x) => cut.has(x)).join(" ") || "none"}`);
console.log(`  left: ${left.join(" ") || "none"}`);
