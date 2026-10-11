// IS THE GRID'S DAY INDEX BACKFILLED? Reads only: HLEN of the index and the
// last sec-report-dates-rewrite run's own summary (#552, after #555 merged).
// No HGETALL, no dump -- the count and the job's counters are the answer.
//   relay task: write-results-days-status  (credentialled for the read)
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const JOB_RUN_PREFIX = keyOf("lib/server/jobRuns.ts", "JOB_RUN_PREFIX");
const INDEX_KEY = keyOf("lib/server/secResultsDays.ts", "SEC_RESULTS_DAYS_KEY");
if (!JOB_RUN_PREFIX || !INDEX_KEY) { console.error("FATAL: key names not readable"); process.exit(2); }

console.log(`HLEN ${INDEX_KEY}: ${await redis.hlen(INDEX_KEY)}`);
for (const job of ["sec-report-dates-rewrite", "sec-facts"]) {
  const run = await redis.get(`${JOB_RUN_PREFIX}:${job}`);
  console.log(`last ${job} run: ${run ? new Date(run.at).toISOString() : "none recorded"} · ok=${run?.ok ?? "-"}`);
  if (run) console.log(`  ${JSON.stringify(run.summary)}`);
}
// Commands this task spent: 1 HLEN + 2 GET.
console.log("\ncommands used by this read: 3");
