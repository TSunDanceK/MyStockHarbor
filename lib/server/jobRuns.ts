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

/**
 * The jobs the page reports on, and whether each one actually calls
 * recordJobRun.
 *
 * `instrumented` EXISTS BECAUSE ITS ABSENCE WAS A LIE. The first version listed
 * all six and only two recorded anything, so warm-price-pool -- which runs every
 * three minutes -- rendered "never run, or older than the 8-day record TTL".
 * That is an uninstrumented job reading exactly like a dead one: the precise
 * failure this page was built to remove, reproduced inside the page itself.
 *
 * All six are instrumented now, so every flag is true. The field stays because
 * the NEXT job added here will not be, and the honest default for it is "not
 * measured" rather than "never ran"
 * (claude/traps/absence-needs-the-producer-to-have-run.md).
 *
 * The flag is a declaration, so scripts/check-cache-health-page.mjs verifies it
 * against reality: a job declared instrumented must have a matching
 * recordJobRun("<key>") call somewhere in the tree. A declaration nothing checks
 * is just a second thing that can be wrong.
 */
export const JOBS = {
  "warm-fundamentals": { label: "Fundamentals (hourly, :22)", instrumented: true, cron: "22 * * * *" },
  "warm-screener-fundamentals": { label: "Screener fundamentals (daily 06:50)", instrumented: true, cron: "50 6 * * *" },
  "warm-price-pool": { label: "Price pool (every 5 min)", instrumented: true, cron: "*/5 * * * *" },
  "warm-stock-data": { label: "Stock data (every 10 min, :07)", instrumented: true, cron: "7-57/10 * * * *" },
  "warm-earnings": { label: "Earnings (daily 07:15)", instrumented: true, cron: "15 7 * * *" },
  "warm-picker-universe": { label: "Picker universe (daily 07:02)", instrumented: true, cron: "2 7 * * *" },
} as const;

/**
 * Roughly how often a cron fires, in seconds. Coarse on purpose -- this exists
 * to decide whether SILENCE IS ALARMING, and that only needs the order of
 * magnitude.
 *
 * WHY IT IS NEEDED. "No run recorded" reads identically for a job that fires
 * every three minutes and one that fires once a day, and the two mean opposite
 * things. Confirmed live 2026-08-22: warm-picker-universe and warm-earnings both
 * showed "no run recorded" on /cache-health, and the reason was neither failure
 * nor a missing schedule -- recordJobRun reached those two routes at 19:18 UTC
 * in #343, and their crons fire at 07:00 and 07:15. Neither had had an
 * opportunity to record. The page was telling the truth and the truth read like
 * a fault (claude/traps/absence-needs-the-producer-to-have-run.md).
 */
export function cronIntervalSeconds(cron: string): number {
  const [minute, hour] = cron.trim().split(/\s+/);

  // BOTH STEP FORMS, and the second one is not hypothetical. Jobs are offset off
  // minute :00 using "lo-hi/step" (see vercel.json -- four crons used to start in
  // the same minute and saturate the FMP calls/min ceiling). Matching only "*/N"
  // would drop "7-57/10" through to the hourly default below, and the page would
  // then treat ten minutes of silence from a ten-minute job as perfectly normal.
  // That is this file's own failure mode: a declaration that reads fine and is
  // wrong (claude/traps/absence-needs-the-producer-to-have-run.md).
  const step = minute?.includes("/") ? Number(minute.split("/")[1]) : NaN;
  if (Number.isFinite(step) && step > 0) return Math.max(60, step * 60);

  if (hour === "*") return 60 * 60;
  return 60 * 60 * 24;
}

/**
 * The cadence, in words, for display beside a dataset on /cache-health.
 *
 * WHY THIS IS DERIVED AND NOT TYPED OUT. stalenessQueue.ts used to carry the
 * cadence of each warm job as prose in its own DATASETS table -- "every 3 min",
 * "daily 07:00" -- which made it a THIRD copy of the schedule after vercel.json
 * and the JOBS registry above. Nothing checked it, and within an hour of the
 * 2026-08-31 cron stagger (#374) both strings were lies: the page told a reader
 * the price pool refreshes every three minutes and the history warm runs at
 * 07:00, when neither had been true since the deploy.
 *
 * That is this file's documented failure mode reappearing one module over -- a
 * declaration that reads fine and is wrong. The registry is the single source,
 * so the words are computed from the same cron string the check script already
 * asserts against vercel.json, and there is no longer a copy that CAN drift.
 */
export function describeCron(cron: string): string {
  const [minute, hour] = cron.trim().split(/\s+/);

  const step = minute?.includes("/") ? Number(minute.split("/")[1]) : NaN;
  if (Number.isFinite(step) && step > 0) return `every ${step} min`;

  const mm = (minute ?? "0").padStart(2, "0");
  if (hour === "*") return `hourly at :${mm}`;
  return `daily ${(hour ?? "0").padStart(2, "0")}:${mm}`;
}

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

export type JobRunView = {
  job: JobKey;
  label: string;
  instrumented: boolean;
  /** The vercel.json schedule this job is declared to run on. */
  cron: string;
  /** Coarse cadence, so the page can judge whether silence is alarming. */
  intervalSeconds: number;
  run: JobRun | null;
};

/** All jobs' latest runs, in one pipelined read. */
export async function readJobRuns(): Promise<JobRunView[]> {
  const keys = Object.keys(JOBS) as JobKey[];
  const view = (job: JobKey, run: JobRun | null): JobRunView => ({
    job,
    label: JOBS[job].label,
    instrumented: JOBS[job].instrumented,
    cron: JOBS[job].cron,
    intervalSeconds: cronIntervalSeconds(JOBS[job].cron),
    run,
  });
  const empty = keys.map((job) => view(job, null));
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
      return view(job, run);
    });
  } catch {
    return empty;
  }
}
