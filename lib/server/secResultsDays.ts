// WHICH COMPANIES ANNOUNCED RESULTS ON WHICH DAY — the /earnings-calendar
// grid's candidate list, from SEC's own filings (#535 COWORK #18 §3).
//
// ── WHY AN INDEX, AND WHY THIS SHAPE ──────────────────────────────────────
// The grid asks "who reported on 2026-07-30?". The answer is spread across
// ~866 per-symbol report-dates records (msh:sec:reportdates:v1:<SYM>), and a
// render reading all of them is ~866 GETs. So each record's announcement days
// are mirrored, when the record is written, into ONE small hash:
//
//   msh:sec:results-days:v1   field <SYMBOL>  value "2026-07-30,2026-04-29,…"
//
// One HSET per record write (the job already writes the record), one HGETALL
// per grid render (~50 KB at the whole universe). No TTL: it is the record's
// shadow, rewritten with it.
//
// ── WHAT COUNTS AS AN ANNOUNCEMENT HERE ───────────────────────────────────
// A stored results event (an Item 2.02 8-K, period-matched) and a `pending`
// announcement (announced, not yet in the figures — the day it lands). NOT a
// 6-K: a 6-K carries no item code, and the text rule measured too many false
// positives to list as "reported results" (#535 COWORK #23, rule C) — the grid
// says so under itself.
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { canWriteSecState, noteSecWriteBlocked } from "./secWriteGate";
import type { StoredReportDates } from "./secReportDatesStore";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

export const SEC_RESULTS_DAYS_KEY = "msh:sec:results-days:v1";

/** The announcement days a record contributes to the grid. Pure. */
export function resultsDaysOf(rec: Pick<StoredReportDates, "events" | "pending"> | null): string[] {
  if (!rec) return [];
  const days = new Set<string>();
  for (const e of rec.events ?? []) {
    if (!e || typeof e.announcedOn !== "string" || !e.announcedOn) continue;
    if (typeof e.form === "string" && e.form.startsWith("6-K")) continue;
    days.add(e.announcedOn);
  }
  if (rec.pending?.announcedOn) days.add(rec.pending.announcedOn);
  return [...days].sort().reverse();
}

/** Mirror one record into the index. Best effort: the record is the truth. */
export async function recordResultsDays(symbol: string, rec: StoredReportDates): Promise<void> {
  if (!redis) return;
  if (!canWriteSecState()) { noteSecWriteBlocked("recordResultsDays"); return; }
  try {
    await redis.hset(SEC_RESULTS_DAYS_KEY, { [symbol.toUpperCase()]: resultsDaysOf(rec).join(",") });
  } catch {
    // The next write of this record mirrors it again.
  }
}

/** The whole index, symbol -> days. Null when Redis cannot answer (never "nobody reported"). */
export async function readResultsDays(): Promise<Map<string, string[]> | null> {
  if (!redis) return null;
  try {
    const raw = (await redis.hgetall<Record<string, string>>(SEC_RESULTS_DAYS_KEY)) ?? {};
    return new Map(Object.entries(raw).map(([s, v]) => [s, String(v ?? "").split(",").filter(Boolean)]));
  } catch {
    return null;
  }
}

/** How many symbols the index holds — the rewrite job's "is it backfilled" test. */
export async function resultsDaysCount(): Promise<number | null> {
  if (!redis) return null;
  try {
    return await redis.hlen(SEC_RESULTS_DAYS_KEY);
  } catch {
    return null;
  }
}

/** Invert the index to day -> symbols, for the admitted symbols only. Pure. */
export function symbolsByDay(
  index: ReadonlyMap<string, readonly string[]>,
  admit: (symbol: string) => boolean,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [symbol, days] of index) {
    if (!admit(symbol)) continue;
    for (const d of days) {
      const list = out.get(d) ?? [];
      list.push(symbol);
      out.set(d, list);
    }
  }
  return out;
}

/**
 * ONE-OFF BACKFILL of the index from every stored record, for the records
 * written before the index existed. Run by the report-dates rewrite job while
 * the index holds fewer than BACKFILL_BELOW symbols; after that every record
 * write keeps it current and this never runs again.
 *
 * Cost, once: a SCAN over the record keys (count 1000 a page), one MGET per
 * 100 records and one HSET per 200 fields — on the order of a hundred commands
 * in total, not one per record per render.
 */
export const RESULTS_DAYS_BACKFILL_BELOW = 500;

export async function backfillResultsDays(recordPrefix: string): Promise<{ scanned: number; written: number } | null> {
  if (!redis) return null;
  if (!canWriteSecState()) { noteSecWriteBlocked("backfillResultsDays"); return null; }
  try {
    const keys: string[] = [];
    let cursor: string | number = 0;
    do {
      const [next, batch] = (await redis.scan(cursor, { match: `${recordPrefix}:*`, count: 1000 })) as [string | number, string[]];
      keys.push(...batch);
      cursor = next;
    } while (String(cursor) !== "0");
    const fields: Record<string, string> = {};
    for (let i = 0; i < keys.length; i += 100) {
      const chunk = keys.slice(i, i + 100);
      const recs = await redis.mget<(StoredReportDates | null)[]>(...chunk);
      chunk.forEach((k, j) => {
        const rec = recs[j];
        if (rec) fields[k.slice(recordPrefix.length + 1).toUpperCase()] = resultsDaysOf(rec).join(",");
      });
    }
    const entries = Object.entries(fields);
    for (let i = 0; i < entries.length; i += 200) {
      await redis.hset(SEC_RESULTS_DAYS_KEY, Object.fromEntries(entries.slice(i, i + 200)));
    }
    return { scanned: keys.length, written: entries.length };
  } catch (err) {
    console.warn("[sec-results-days] backfill failed", String((err as Error)?.message ?? err));
    return null;
  }
}
