// One small "last run" record per warm job, written by the job itself.
//
// The health page needs to answer "which warm job last failed, or silently did
// nothing" (spec, "What good looks like") and today that question is only
// answerable by reading Vercel logs by hand -- which is how the quote-stage
// truncation went unnoticed for as long as it did.
//
// A LOG LINE IS NOT A HEALTH SIGNAL. Every one of these jobs already
// console.logs its summary, and every failure on 22 Aug still went unnoticed,
// because a log line is only seen by someone who goes looking in the right
// window. This is the same summary written where something can read it back.
//
// Deliberately ONE key per job holding only the latest run: this is not a
// history, and a page that has to page through run history is a page nobody
// opens. The 8-day TTL means a job that has stopped running entirely disappears
// rather than showing a stale green -- absence is reported by the page as
// "never / expired", which is the honest reading
// (claude/traps/absence-needs-the-producer-to-have-run.md).
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

const JOB_RUN_PREFIX = "msh:job-run:v1";
// Comfortably longer than the slowest job's cadence (daily), so a job that ran
// yesterday still shows, and short enough that one which stopped a week ago
// reads as gone rather than as old-but-fine.
const JOB_RUN_TTL_SECONDS = 60 * 60 * 24 * 8;

export const JOBS = {
  "warm-fundamentals": "Fundamentals (hourly)",
  "warm-screener-fundamentals": "Screener fundamentals (daily 06:50)",
  "warm-price-pool": "Price pool (every 3 min)",
  "warm-stock-data": "Stock data (every 10 min)",
  "warm-earnings": "Earnings (daily 07:15)",
  "warm-picker-universe": "Picker universe (daily 07:00)",
} as const;

export type JobKey = keyof typeof JOBS;

export type JobRun = {
  at: number;
  ok: boolean;
  /** Small, flat, human-readable. Whatever the job's own summary already says. */
  summary: Record<string, string | number | boolean | null>;
};

/**
 * Record the outcome of a run. Fails open and silent: a job must never fail
 * because its bookkeeping did.
 */
export async function recordJobRun(
  job: JobKey,
  ok: boolean,
  summary: JobRun["summary"]
): Promise<void> {
  if (!redis) return;
  try {
    const payload: JobRun = { at: Date.now(), ok, summary };
    await redis.set(`${JOB_RUN_PREFIX}:${job}`, payload, { ex: JOB_RUN_TTL_SECONDS });
  } catch {
    // bookkeeping -- never throws into the caller
  }
}

export type JobRunView = { job: JobKey; label: string; run: JobRun | null };

/** All jobs' latest runs, in one pipelined read. */
export async function readJobRuns(): Promise<JobRunView[]> {
  const keys = Object.keys(JOBS) as JobKey[];
  const empty = keys.map((job) => ({ job, label: JOBS[job], run: null }));
  if (!redis) return empty;
  try {
    const values = await redis.mget<(JobRun | null)[]>(
      ...keys.map((j) => `${JOB_RUN_PREFIX}:${j}`)
    );
    return keys.map((job, i) => {
      const raw = values?.[i];
      const run =
        raw && typeof raw === "object" && typeof (raw as JobRun).at === "number"
          ? (raw as JobRun)
          : null;
      return { job, label: JOBS[job], run };
    });
  } catch {
    return empty;
  }
}
