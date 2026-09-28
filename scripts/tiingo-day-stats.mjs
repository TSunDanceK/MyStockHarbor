// TIINGO: ONE DAY'S MEASURED NUMBERS, READ-ONLY (#553 COWORK #59 §1).
// For the quotes cadence decision, from the counters the jobs already keep
// (Vercel's log search is not needed): the limiter's per-day and per-hour
// request counters, the job guard's per-job command totals for the day, and the
// last run record of each Tiingo job. Prints counts, sizes and timings only --
// no Tiingo data, no keys.
//
//   relay task: write-tiingo-day-stats   (DAY=YYYY-MM-DD to override; default today UTC)
//   Redis: 1 GET (day) + 2 GET (hours) + 1 HGETALL + 2 GET (job runs) = 6, once.
import "./lib/register-ts-here.mjs";
import { Redis } from "@upstash/redis";

const T = await import("../lib/server/marketData/tiingo.ts");
const G = await import("../lib/server/jobGuard.ts");
const J = await import("../lib/server/jobRuns.ts");
const redis = Redis.fromEnv();
const now = new Date();
const day = process.env.DAY || now.toISOString().slice(0, 10);
const hour = (ms) => new Date(ms).toISOString().slice(0, 13);
const prefix = T.TIINGO_CALLS_PREFIX;

const dayReq = await redis.get(`${prefix}:d:${day}`);
const hNow = await redis.get(`${prefix}:h:${hour(now.getTime())}`);
const hPrev = await redis.get(`${prefix}:h:${hour(now.getTime() - 3600_000)}`);
const cmds = (await redis.hgetall(`${G.JOB_COMMANDS_PREFIX}:${day}`)) ?? {};
const tiingoCmds = Object.fromEntries(Object.entries(cmds).filter(([k]) => /tiingo/.test(k)));
console.log(`day ${day}: Tiingo requests (limiter) ${dayReq ?? 0}; this hour ${hNow ?? 0}; previous hour ${hPrev ?? 0}`);
console.log(`job commands ${day} (guard): ${JSON.stringify(tiingoCmds)}; all jobs total ${Object.entries(cmds).filter(([k]) => !k.includes(":")).reduce((s, [, v]) => s + Number(v || 0), 0)}`);
for (const job of ["tiingo-quotes", "tiingo-eod"]) {
  const r = await redis.get(`${J.JOB_RUN_PREFIX}:${job}`);
  const run = typeof r === "string" ? JSON.parse(r) : r;
  console.log(`${job} last run: ${run ? JSON.stringify({ at: new Date(run.at).toISOString(), ok: run.ok, ...run.summary }) : "no record"}`);
}
console.log("Redis commands: 6 (read-only)");
process.exit(0);
