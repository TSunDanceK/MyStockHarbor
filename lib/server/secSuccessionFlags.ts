// POSSIBLE HOLDING-COMPANY SUCCESSIONS, FLAGGED — NEVER LINKED (#552 COWORK #36 §2).
//
// XOM moved its listing to a NEW registrant: "ExxonMobil Holdings Corp" filed
// an 8-K12B on 2026-07-01 and the NYSE filed a 25-NSE for "EXXON MOBIL CORP"
// on 2026-07-02. Its history stayed under the old CIK until the cited
// successor list (data/sec/successor-ciks.json, #581) linked them by hand.
//
// This spots the same shape in EDGAR's daily index, which the sec-daily-index
// job already reads (no extra request): an 8-K12B from a filer we do not
// track, and a 25-NSE for one we do, with the same normalised name within
// SUCCESSION_WINDOW_DAYS. The pair becomes a FLAG for B's daily
// "Classification needed" issue ("possible successor: NEW (CIK) ← OLD (CIK)").
// Nothing is linked here: the owner approves, and the pair is added to the
// cited list by PR. A pair already on that list is not flagged again.
//
// PURE except the two store calls at the bottom.
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { canWriteSecState, noteSecWriteBlocked } from "./secWriteGate";

export type SuccessionEvent = {
  kind: "8-K12B" | "25-NSE";
  cik: string;
  name: string;
  date: string;
  /** The tracked symbol, on a 25-NSE only. */
  symbol?: string;
};

export type SuccessionFlag = {
  symbol: string;
  successorCik: string;
  successorName: string;
  predecessorCik: string;
  predecessorName: string;
  eightK12b: string;
  nse25: string;
};

export const SUCCESSION_WINDOW_DAYS = 30;
/** Events older than this are dropped from the store: a pair is flagged well inside it. */
export const SUCCESSION_EVENT_KEEP_DAYS = 45;

const SUFFIX = /\b(?:the|inc|incorporated|corp|corporation|co|company|companies|holdings?|group|ltd|limited|plc|sa|nv|ag|se|llc|lp|new|de|del|cos)\b/g;

/** "ExxonMobil Holdings Corp" and "EXXON MOBIL CORP" → "exxonmobil". */
export function normalizeFilerName(name: string): string {
  return String(name ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ")
    .replace(SUFFIX, " ").replace(/\s+/g, "");
}

const days = (a: string, b: string) => Math.abs(Date.parse(b) - Date.parse(a)) / 86_400_000;
const pad = (c: string) => String(c).replace(/\D/g, "").padStart(10, "0");

/**
 * Each 25-NSE for a tracked filer paired with an 8-K12B by ANOTHER filer of
 * the same normalised name within the window. `cited` holds predecessor CIKs
 * already on the successor list; those are not flagged.
 */
export function successionFlags(events: SuccessionEvent[], cited: ReadonlySet<string> = new Set()): SuccessionFlag[] {
  const out: SuccessionFlag[] = [];
  const k12b = events.filter((e) => e.kind === "8-K12B");
  for (const d of events.filter((e) => e.kind === "25-NSE" && e.symbol)) {
    if (cited.has(pad(d.cik))) continue;
    const n = normalizeFilerName(d.name);
    if (n.length < 4) continue;
    const s = k12b.find((e) => pad(e.cik) !== pad(d.cik) && normalizeFilerName(e.name) === n && days(e.date, d.date) <= SUCCESSION_WINDOW_DAYS);
    if (s) out.push({
      symbol: d.symbol!, successorCik: pad(s.cik), successorName: s.name, predecessorCik: pad(d.cik),
      predecessorName: d.name, eightK12b: s.date, nse25: d.date,
    });
  }
  return out;
}

/** The index rows that matter: 8-K12Bs from untracked filers, 25-NSEs for tracked ones. */
export function successionEventsOf(
  rows: { cik: string; company: string; form: string; filed: string }[],
  bySymbolCik: ReadonlyMap<string, string>,
): SuccessionEvent[] {
  const out: SuccessionEvent[] = [];
  for (const r of rows) {
    const form = r.form.trim().toUpperCase();
    const tracked = bySymbolCik.get(r.cik) ?? bySymbolCik.get(String(Number(r.cik)));
    if (form === "8-K12B" && !tracked) out.push({ kind: "8-K12B", cik: pad(r.cik), name: r.company, date: r.filed });
    if (form === "25-NSE" && tracked) out.push({ kind: "25-NSE", cik: pad(r.cik), name: r.company, date: r.filed, symbol: tracked });
  }
  return out;
}

export const SEC_SUCCESSION_EVENTS_HASH = "msh:sec:succession-events:v1";
export const SEC_SUCCESSION_FLAGS_HASH = "msh:sec:succession-flags:v1";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? Redis.fromEnv(PAGE_READ_CACHE) : null;

/**
 * Store this run's events, pair everything on hand, write the flags.
 * Redis: NOTHING when the run saw no 8-K12B or 25-NSE of interest (most days);
 * otherwise HSET + HGETALL (+ HDEL for expired events, + HSET for new flags).
 */
export async function recordSuccessionEvents(fresh: SuccessionEvent[], today: string, cited: ReadonlySet<string>): Promise<SuccessionFlag[]> {
  if (!redis || !fresh.length) return [];
  if (!canWriteSecState()) { noteSecWriteBlocked("succession-events"); return []; }
  try {
    await redis.hset(SEC_SUCCESSION_EVENTS_HASH, Object.fromEntries(fresh.map((e) => [`${e.kind}:${e.cik}:${e.date}`, e])));
    const all = Object.entries((await redis.hgetall<Record<string, SuccessionEvent>>(SEC_SUCCESSION_EVENTS_HASH)) ?? {});
    const expired = all.filter(([, e]) => days(e.date, today) > SUCCESSION_EVENT_KEEP_DAYS).map(([k]) => k);
    if (expired.length) await redis.hdel(SEC_SUCCESSION_EVENTS_HASH, ...expired);
    const flags = successionFlags(all.filter(([k]) => !expired.includes(k)).map(([, e]) => e), cited);
    if (flags.length) await redis.hset(SEC_SUCCESSION_FLAGS_HASH, Object.fromEntries(flags.map((f) => [f.symbol, { ...f, seenOn: today }])));
    return flags;
  } catch (err) {
    console.warn("[sec-succession] record failed", err);
    return [];
  }
}
