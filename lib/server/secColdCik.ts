// THE CIK THE COLD PATH RESOLVED, HANDED TO THE CRON — because the render path
// may not touch the manifest.
//
// ── THE DEFECT ────────────────────────────────────────────────────────────
// `populationQueues` filters on `e.cik`, so a manifest entry without one is in
// NO cron queue at all: not populate, not reverify, not rewindow. ONDS is the
// case — it has a stored fact set written by the cold path and a manifest entry
// carrying no CIK, so nothing will ever refresh it. The daily
// `reconcileCiks` fills gaps from the ticker map, which covers every symbol the
// map can resolve and leaves exactly the ones it cannot.
//
// AND THE COLD PATH ALREADY KNOWS THE ANSWER. It cannot have fetched without
// resolving a CIK — `cikForSymbol` is the first gate in
// resolveFactSetForRender and returns `no-cik` otherwise. So by the time a set
// is written, the CIK is in hand and the manifest is the only place that does
// not have it.
//
// ── WHY A SIDE CHANNEL AND NOT A MANIFEST WRITE ───────────────────────────
// THE MANIFEST IS 417 KB. secColdFetch's own header says a render path may not
// read it, and that is the entire affordability argument for the cold path.
// Read-modify-write on a render would be worse still: two concurrent renders
// would each read 417 KB, and the second would overwrite the first's entry.
//
// So the cold path writes ONE small hash field and the cron drains it — the
// same shape as the cold QUEUE, for the same reason and with the same
// ownership: the render path enqueues, the job does the work.
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import type { SecManifest } from "./secManifest";
import { emptyEntry } from "./secManifest";

// Redis.fromEnv WITH PAGE_READ_CACHE, the same construction as secColdFetch and
// secFactStore. @upstash/redis sends `cache: "no-store"` by default and ONE such
// hint opts the whole route out of static rendering — which on a render path is
// the difference between paying the fetch per revalidation window and paying it
// per visitor. check-page-read-cache asserts it.
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv({ ...PAGE_READ_CACHE, retry: { retries: 1, backoff: () => 200 } })
    : null;

export const SEC_COLD_CIK_KEY = "msh:sec:cold-cik:v1";

/**
 * A CAP, for the same reason the cold queue has one: this is fed by an endpoint
 * anyone can hit. Past it the write is skipped — the symbol keeps its stored
 * set and its page, and only the manifest note is dropped.
 *
 * Generous against the real population: the whole universe is ~760 SYMBOLS, so
 * 2000 cannot be reached by legitimate use and exists only to bound abuse.
 */
export const SEC_COLD_CIK_MAX = 2000;

/**
 * Record the CIK a cold write resolved. One HSET, best effort, never throws.
 *
 * ON THE WRITE PATH ONLY, not on every render: a symbol reaches here once, when
 * its set is first written, not each time someone reads it.
 */
export async function recordColdCik(symbol: string, cik: string): Promise<boolean> {
  if (!redis || !symbol || !cik) return false;
  try {
    // HLEN BEFORE HSET, so a full hash costs one command rather than growing.
    // Racy by a few entries under concurrency, and that is fine: this is a cap
    // against unbounded growth, not a quota anyone is owed to the exact field.
    if ((await redis.hlen(SEC_COLD_CIK_KEY)) >= SEC_COLD_CIK_MAX) return false;
    await redis.hset(SEC_COLD_CIK_KEY, { [symbol]: cik });
    return true;
  } catch {
    // The manifest note is an optimisation over reconcileCiks, not the
    // mechanism. A failure here costs nothing a reader can see.
    return false;
  }
}

/** What the drain did, for the job's summary line. */
export type ColdCikDrain = {
  /** Fields read out of the hash. */
  seen: number;
  /** Manifest entries that gained a CIK they did not have. */
  filled: number;
  /** Manifest entries CREATED because the symbol had none at all. */
  created: number;
  /** Entries already carrying the same CIK — nothing to do. */
  already: number;
  /**
   * Entries whose manifest CIK DISAGREES with the recorded one. Reported and
   * NOT applied: see the drain.
   */
  conflicts: { symbol: string; manifest: string; cold: string }[];
};

/**
 * Fold recorded CIKs into the manifest, in the JOB's scope where reading it is
 * affordable.
 *
 * MUTATES `manifest` and does not write it — the caller already writes the
 * manifest once at the end of its run, and a second write here would be a
 * read-modify-write race against that one.
 *
 * ── A DISAGREEMENT IS REPORTED, NEVER APPLIED ─────────────────────────────
 * If the manifest has a CIK and the cold path recorded a different one, that is
 * either a genuine CIK change or a bad spelling match, and the two need
 * opposite responses. `reconcileCiks` is the code that owns that decision — it
 * has the ticker map, a change threshold and a shape-change guard. Silently
 * taking the cold path's value here would route a CIK change around all three.
 */
export async function drainColdCiks(manifest: SecManifest): Promise<ColdCikDrain> {
  const out: ColdCikDrain = { seen: 0, filled: 0, created: 0, already: 0, conflicts: [] };
  if (!redis) return out;
  let recorded: Record<string, string> | null = null;
  try {
    recorded = await redis.hgetall<Record<string, string>>(SEC_COLD_CIK_KEY);
  } catch {
    return out;
  }
  if (!recorded) return out;

  const drained: string[] = [];
  for (const [symbol, cik] of Object.entries(recorded)) {
    out.seen++;
    if (!cik) { drained.push(symbol); continue; }
    const entry = manifest.symbols[symbol];
    if (!entry) {
      // NO ENTRY AT ALL. A cold-path symbol outside the seeded universe has a
      // stored set and nothing tracking it; without this it is invisible to
      // every queue forever.
      manifest.symbols[symbol] = emptyEntry(cik);
      out.created++;
    } else if (!entry.cik) {
      entry.cik = cik;
      out.filled++;
    } else if (entry.cik === cik) {
      out.already++;
    } else {
      out.conflicts.push({ symbol, manifest: entry.cik, cold: cik });
      // NOT DRAINED. Left in the hash so the conflict keeps being reported
      // rather than disappearing after one run — a disagreement that logs once
      // and then vanishes is a disagreement nobody acts on.
      continue;
    }
    drained.push(symbol);
  }

  if (drained.length) {
    try {
      await redis.hdel(SEC_COLD_CIK_KEY, ...drained);
    } catch {
      // Re-drained next run. Folding the same CIK in twice is a no-op — the
      // second pass counts it as `already`.
    }
  }
  return out;
}
