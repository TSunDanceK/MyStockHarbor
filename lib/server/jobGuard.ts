// Runaway-cost safeguards for B's scheduled jobs (#553 COWORK #51 item 3;
// #535 COWORK #17 Part 2; the inventory is CODE-B #39).
//
// THE WORRY THIS EXISTS FOR: a collection that fails and retries, or a Redis
// that starts refusing, billing without limit until someone notices -- and
// Upstash's own 70%/90% emails arriving after the damage (August).
//
// ONE WRAPPER, NO EDITS INSIDE THE JOBS. `guardJob(name, handler)` wraps a cron
// route's GET and adds, in order:
//
//   1. KILL SWITCH. Edge Config `jobs` item: `{ "<job>": false }` (or
//      `{ "<job>": { "enabled": false } }`) and the run is skipped. Edge Config
//      costs no Redis command and is editable from the Vercel dashboard with no
//      deploy. No EDGE_CONFIG, or an unreadable one, means ENABLED: a config
//      outage must not stop the jobs.
//   2. DAILY CIRCUIT BREAKER. One HGET of today's per-job command total; at
//      or over the job's `perDay` ceiling (about 3x a normal day) the rest of
//      today's runs are skipped. The trip is recorded for the usage alert.
//   3. PER-RUN COMMAND BUDGET. Every Upstash command the run sends is counted
//      (a pipeline counts as its length -- that is how Upstash bills). Past
//      `perRun` (about 2x a normal run), the run is STOPPED.
//   4. REDIS ERRORS STOP THE RUN. An Upstash 429/5xx, a limit error, or a
//      network failure stops it. No retries.
//
// HOW A RUN IS STOPPED WITHOUT TOUCHING THE JOB'S CODE: the counting happens in
// a `fetch` wrapper scoped by AsyncLocalStorage, so only this run's requests
// are seen (concurrent page renders in the same instance are not). Once a run
// is stopped, EVERY further outbound request it makes -- Redis, FMP, SEC --
// throws before leaving the process. The jobs already fail open on a throwing
// call, so they wind down quickly and spend nothing more. The one request that
// still goes through is the job's own run record (msh:job-run:v1:<job>), so the
// route can still say what happened; the guard then marks that record
// `ok: false` with the reason.
//
// COST: 1 HGET before the run + 1 pipelined HINCRBY/EXPIRE after it (billed 2)
// = 3 commands a run, ~510 a day across the six jobs at today's cadences;
// +2 (GET + SET of the run record) only on a run that was stopped or skipped.
import { AsyncLocalStorage } from "node:async_hooks";
import { Redis } from "@upstash/redis";
import { JOB_RUN_PREFIX, type JobKey } from "./jobRuns";

export type GuardedJob = Extract<
  JobKey,
  "warm-stock-data" | "warm-fundamentals" | "warm-screener-fundamentals" | "warm-picker-universe" | "warm-pickers-sec" | "ipo-refresh"
>;

/**
 * Ceilings, from the CODE-B #39 inventory (normal run / normal day are the
 * estimates posted there). perRun ~2x a normal run; perDay ~3x a normal day.
 * A ceiling is a safety net, not a target: a normal run never gets near it.
 */
export const JOB_LIMITS: Record<GuardedJob, { perRun: number; perDay: number }> = {
  // 144 runs/day, ~320-440 commands a run, ~46-63K a day.
  "warm-stock-data": { perRun: 1_000, perDay: 190_000 },
  // 24 runs/day, ~870-1,100 a run, ~21-26K a day.
  "warm-fundamentals": { perRun: 2_500, perDay: 78_000 },
  // 1 run/day, ~3,900 a run.
  "warm-screener-fundamentals": { perRun: 8_000, perDay: 12_000 },
  // 1 run/day, ~6-7K a run (a forced history refetch of ~700 symbols); the
  // lock-failure amplifier in CODE-B #39 is ~28K, which this stops at 15K.
  "warm-picker-universe": { perRun: 15_000, perDay: 21_000 },
  // 1 run/day, ~860 a run (stated), hard cap ~2,050 (stated).
  "warm-pickers-sec": { perRun: 2_100, perDay: 6_500 },
  // 1 run/day, ~5 a run (stated). A catch-up run is still tiny.
  "ipo-refresh": { perRun: 200, perDay: 600 },
};

export const JOB_COMMANDS_PREFIX = "msh:jobs:commands:v1";
const JOB_COMMANDS_TTL_SECONDS = 9 * 24 * 60 * 60; // the weekly report reads 7 days

export type StopReason = "command-budget" | "redis-error";
type RunContext = { job: GuardedJob; budget: number; commands: number; stopped: StopReason | null };

/** Thrown by the fetch wrapper for any request a stopped run tries to make. */
export class JobStoppedError extends Error {
  readonly reason: StopReason;
  constructor(reason: StopReason) {
    super(`[job-guard] run stopped: ${reason}`);
    this.name = "JobStoppedError";
    this.reason = reason;
  }
}

const als = new AsyncLocalStorage<RunContext>();

// ── the fetch wrapper ────────────────────────────────────────────────────────
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Commands in one Upstash REST request: a pipeline or transaction bills per command. */
export function upstashCommandCount(url: string, body: unknown): number {
  if (/\/(pipeline|multi-exec)(\?|$)/.test(url) && typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      return Array.isArray(parsed) ? Math.max(1, parsed.length) : 1;
    } catch {
      return 1;
    }
  }
  return 1;
}

/**
 * The job's own run record: always allowed, never counted -- the route must be
 * able to report. ONLY when every command in the request is such a write: the
 * client auto-pipelines, so a run-record SET can share a request with other
 * commands, and those must not ride through a stopped run on its back.
 */
export function isRunRecordWrite(body: unknown): boolean {
  if (typeof body !== "string") return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  const cmds = Array.isArray(parsed) && Array.isArray(parsed[0]) ? parsed : [parsed];
  return cmds.every(
    (c) => Array.isArray(c) && String(c[0]).toLowerCase() === "set" && String(c[1]).startsWith(`${JOB_RUN_PREFIX}:`)
  );
}

/** An Upstash response that means "stop": rate limit, server error, or a quota/limit refusal. */
export async function isRedisFailure(res: Response): Promise<boolean> {
  if (res.status === 429 || res.status >= 500) return true;
  if (res.status === 400 || res.status === 403) {
    try {
      const text = await res.clone().text();
      return /limit|quota|exceeded|max requests|max daily/i.test(text);
    } catch {
      return false;
    }
  }
  return false;
}

let installed = false;
function installFetchGuard() {
  if (installed) return;
  installed = true;
  const original = globalThis.fetch;
  const guarded = async function guardedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const ctx = als.getStore();
    if (!ctx) return original(input, init);
    const url = urlOf(input);
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL ?? "";
    const isRedis = Boolean(redisUrl) && url.startsWith(redisUrl);
    if (isRedis && isRunRecordWrite(init?.body)) return original(input, init);
    if (ctx.stopped) throw new JobStoppedError(ctx.stopped);
    if (!isRedis) return original(input, init);

    const n = upstashCommandCount(url, init?.body);
    if (ctx.commands + n > ctx.budget) {
      ctx.stopped = "command-budget";
      throw new JobStoppedError(ctx.stopped);
    }
    ctx.commands += n;
    let res: Response;
    try {
      res = await original(input, init);
    } catch (err) {
      ctx.stopped = "redis-error";
      throw err;
    }
    if (await isRedisFailure(res)) ctx.stopped = "redis-error";
    return res;
  };
  globalThis.fetch = guarded as typeof fetch;
}

// ── the kill switch (Edge Config, no Redis) ──────────────────────────────────
/**
 * `false` only when Edge Config explicitly disables the job. EDGE_CONFIG is the
 * connection string Vercel sets when a store is linked:
 * https://edge-config.vercel.com/<id>?token=<token>.
 */
export async function jobEnabled(job: GuardedJob, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const conn = process.env.EDGE_CONFIG;
  if (!conn) return true;
  try {
    const u = new URL(conn);
    const token = u.searchParams.get("token");
    const id = u.pathname.replace(/^\/+|\/+$/g, "");
    if (!token || !id) return true;
    const res = await fetchImpl(`${u.origin}/${id}/item/jobs?token=${encodeURIComponent(token)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1_500),
    });
    if (!res.ok) return true; // 404: no `jobs` item yet
    return jobEnabledIn(await res.json(), job);
  } catch {
    return true;
  }
}

/** Pure: read a job's flag out of the `jobs` item. Anything but an explicit false is enabled. */
export function jobEnabledIn(item: unknown, job: GuardedJob): boolean {
  if (!item || typeof item !== "object") return true;
  const v = (item as Record<string, unknown>)[job];
  if (v === false) return false;
  if (v && typeof v === "object" && (v as { enabled?: unknown }).enabled === false) return false;
  return true;
}

// ── the breaker's store ──────────────────────────────────────────────────────
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? Redis.fromEnv() : null;

const dayKey = (nowMs: number) => `${JOB_COMMANDS_PREFIX}:${new Date(nowMs).toISOString().slice(0, 10)}`;

async function commandsToday(job: GuardedJob, nowMs: number): Promise<number | null> {
  if (!redis) return null;
  try {
    const v = await redis.hget<number | string>(dayKey(nowMs), job);
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return null; // unknown -- run, and let the per-run budget and error stop do the work
  }
}

async function addCommands(job: GuardedJob, n: number, nowMs: number): Promise<number | null> {
  if (!redis) return null;
  try {
    const p = redis.pipeline();
    p.hincrby(dayKey(nowMs), job, n);
    p.expire(dayKey(nowMs), JOB_COMMANDS_TTL_SECONDS);
    const [total] = (await p.exec()) as [number, unknown];
    return typeof total === "number" ? total : null;
  } catch {
    return null;
  }
}

async function markTripped(job: GuardedJob, nowMs: number): Promise<void> {
  if (!redis) return;
  try {
    await redis.hset(dayKey(nowMs), { [`${job}:tripped`]: new Date(nowMs).toISOString() });
  } catch {
    // bookkeeping
  }
}

/** Rewrite the route's own run record as a failure, keeping what it said. */
async function markRunRecord(job: GuardedJob, extra: Record<string, string | number | boolean | null>): Promise<void> {
  if (!redis) return;
  try {
    const key = `${JOB_RUN_PREFIX}:${job}`;
    const prev = await redis.get<{ at: number; ok: boolean; summary: Record<string, string | number | boolean | null> }>(key);
    const payload = { at: Date.now(), ok: false, summary: { ...(prev?.summary ?? {}), ...extra } };
    await redis.set(key, payload, { ex: 60 * 60 * 24 * 8 });
  } catch {
    // bookkeeping
  }
}

function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return (req.headers.get("authorization") || "") === `Bearer ${secret}`;
}

export type GuardOutcome = {
  skipped: "kill-switch" | "circuit-breaker" | null;
  stopped: StopReason | null;
  commands: number;
  dayTotal: number | null;
};

/**
 * Run `fn` under the guard. Exported for tests and for callers that are not a
 * route; routes use guardJob.
 */
export async function runGuarded<T>(
  job: GuardedJob,
  fn: () => Promise<T>,
  nowMs = Date.now()
): Promise<{ outcome: GuardOutcome; value: T | null }> {
  const limits = JOB_LIMITS[job];
  if (!(await jobEnabled(job))) {
    console.warn(`[job-guard] ${job}: disabled by the Edge Config kill switch; skipped`);
    return { outcome: { skipped: "kill-switch", stopped: null, commands: 0, dayTotal: null }, value: null };
  }
  const before = await commandsToday(job, nowMs);
  if (before !== null && before >= limits.perDay) {
    console.warn(`[job-guard] ${job}: circuit breaker open (${before} commands today >= ${limits.perDay}); skipped`);
    return { outcome: { skipped: "circuit-breaker", stopped: null, commands: 0, dayTotal: before }, value: null };
  }

  installFetchGuard();
  let outcome: GuardOutcome = { skipped: null, stopped: null, commands: 0, dayTotal: null };
  const ctx: RunContext = { job, budget: limits.perRun, commands: 0, stopped: null };
  let value: T | null = null;
  try {
    value = await als.run(ctx, fn);
  } finally {
    // Outside the run's context, so the bookkeeping is neither counted nor blocked.
    const dayTotal = await addCommands(job, ctx.commands, nowMs);
    if (dayTotal !== null && dayTotal >= limits.perDay) await markTripped(job, nowMs);
    if (ctx.stopped) {
      console.warn(`[job-guard] ${job}: run STOPPED (${ctx.stopped}) after ${ctx.commands} commands`);
    }
    outcome = { skipped: null, stopped: ctx.stopped, commands: ctx.commands, dayTotal };
  }
  return { outcome, value };
}

/**
 * Wrap a cron route's GET. Unauthorized requests go straight to the handler
 * (which answers 401) so a stranger hitting the URL costs no Redis command.
 */
export function guardJob<R extends Request>(job: GuardedJob, handler: (req: R) => Promise<Response>) {
  return async function guardedGET(req: R): Promise<Response> {
    if (!isCronAuthorized(req)) return handler(req);
    const { outcome, value } = await runGuarded(job, () => handler(req));
    if (outcome.skipped) {
      await markRunRecord(job, { guard: `skipped: ${outcome.skipped}`, commandsToday: outcome.dayTotal });
      return Response.json({ ok: true, skipped: outcome.skipped }, { status: 200 });
    }
    if (outcome.stopped) {
      await markRunRecord(job, { guard: `stoppedEarly: ${outcome.stopped}`, guardCommands: outcome.commands });
      return Response.json(
        { ok: false, stoppedEarly: outcome.stopped, commands: outcome.commands },
        { status: 500 }
      );
    }
    return value ?? Response.json({ ok: false, error: "no response" }, { status: 500 });
  };
}
