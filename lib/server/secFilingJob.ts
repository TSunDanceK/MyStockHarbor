// THE FILING JOB (#535 COWORK #10, trigger B as ruled in COWORK #12).
//
// Reads a tracked filer's new 10-Q/10-K/20-F/40-F from the filing's own XBRL
// instance as soon as it is filed, without waiting for SEC's companyfacts feed.
// The per-filer rules are #537's (secFilingFill: fill-only, currency-locked,
// through the shipped extractor, companyfacts winning once it publishes); this
// module adds WHEN and WHO:
//
//   - IN REPORTING SEASON (Jan 20–Feb 28, Apr 15–May 15, Jul 15–Aug 14,
//     Oct 15–Nov 14), every 2 hours: the filers whose outlook says they are due
//     now (the due list, rebuilt nightly), plus any lag already recorded.
//   - EVERY NIGHT at 04:40, after the 04:00 daily index: every filer the index
//     saw file since its last check, every recorded lag, and never-checked
//     filers (the sweep). Off season this and 16:40 are the only runs.
//   - A ONE-OFF CATCH-UP: hourly until nothing is left to check, then the
//     normal schedule. The flag lives in Redis and clears itself.
//
// Caps: 60 fills a run, SEC at <= 5 requests a second, a 240 s budget.
// State is a small hash, never the 400 KB manifest: sec-facts writes the
// manifest at :20, and two jobs writing one key is a lost update.
import { Redis } from "@upstash/redis";
import { canWriteSecState, noteSecWriteBlocked } from "./secWriteGate";
import type { FilingRef, StoredFactSet, StoredPeriod } from "./secFactCodec";
import type { Submissions } from "./secReportDates";
import type { CompanyFacts } from "./secExtract";
import { extractForSymbol } from "./secExtractFor";
import { toStoredSet } from "./secFactBuild";
import { defaultSources, type FxSeries } from "./fxRates";
import { sicChangeOf, type SicChange } from "./secSicChange";
import { instanceToFacts, isLagging, mergeFillOnly, newestPeriodicFiling, newestStoredEnd } from "./secFilingFill";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

export const FILING_JOB_FILLS_PER_RUN = 60;
/** 200 ms between SEC requests: 5 a second, half SEC's fair-access ceiling. */
export const FILING_JOB_PACE_MS = 200;
export const FILING_JOB_BUDGET_MS = 240_000;
/** Off season, and the nightly sweep in season: the UTC hours the job acts. */
export const FILING_JOB_NIGHTLY_HOURS = [4, 16] as const;

export const FILING_STATE_KEY = "msh:sec:filing-state:v1";
export const FILING_DUE_KEY = "msh:sec:filing-due:v1";
export const FILING_CATCHUP_KEY = "msh:sec:filing-catchup:v1";

/** Month-day windows, inclusive, as "MM-DD". */
export const REPORTING_SEASONS: readonly (readonly [string, string])[] = [
  ["01-20", "02-28"],
  ["04-15", "05-15"],
  ["07-15", "08-14"],
  ["10-15", "11-14"],
];

export function inReportingSeason(iso: string): boolean {
  const md = iso.slice(5, 10);
  return REPORTING_SEASONS.some(([a, b]) => md >= a && md <= b);
}

export type RunMode = "catch-up" | "nightly" | "season" | "idle";

/**
 * Whether this hourly firing acts, and how. PURE: the schedule is the whole
 * staleness promise, so a check runs it rather than reading it.
 */
export function runMode(now: Date, catchUpDone: boolean): RunMode {
  const hour = now.getUTCHours();
  if (!catchUpDone) return "catch-up";
  if ((FILING_JOB_NIGHTLY_HOURS as readonly number[]).includes(hour)) return "nightly";
  if (inReportingSeason(now.toISOString().slice(0, 10)) && hour % 2 === 0) return "season";
  return "idle";
}

/** What the job remembers per filer. Short keys: 800+ fields in one hash. */
export type FilingState = {
  /** Last check, ms. */
  c: number;
  /** The recorded lag, when the stored set is behind a filing. */
  lag?: { accn: string; reportDate: string; kind: "filled" | "notice" } | null;
};

export async function readFilingState(): Promise<Map<string, FilingState>> {
  const out = new Map<string, FilingState>();
  if (!redis) return out;
  const raw = (await redis.hgetall<Record<string, FilingState>>(FILING_STATE_KEY)) ?? {};
  for (const [k, v] of Object.entries(raw)) if (v && typeof v === "object") out.set(k, v);
  return out;
}

export async function writeFilingState(updates: Map<string, FilingState>): Promise<boolean> {
  if (!redis || updates.size === 0) return false;
  if (!canWriteSecState()) { noteSecWriteBlocked("filingState"); return false; }
  await redis.hset(FILING_STATE_KEY, Object.fromEntries(updates));
  return true;
}

export async function readDueList(): Promise<string[]> {
  if (!redis) return [];
  const v = await redis.get<string[]>(FILING_DUE_KEY);
  return Array.isArray(v) ? v : [];
}

export async function writeDueList(symbols: string[]): Promise<void> {
  if (!redis) return;
  if (!canWriteSecState()) { noteSecWriteBlocked("filingDue"); return; }
  await redis.set(FILING_DUE_KEY, symbols, { ex: 3 * 86400 });
}

export async function catchUpDone(): Promise<boolean> {
  if (!redis) return true;
  return (await redis.get<string>(FILING_CATCHUP_KEY)) === "done";
}

export async function markCatchUpDone(): Promise<void> {
  if (!redis || !canWriteSecState()) return;
  await redis.set(FILING_CATCHUP_KEY, "done");
}

export type Candidate = { symbol: string; cik: string; rank: number };

/**
 * Who this run checks, in order. PURE.
 *   0  a recorded lag whose re-check is due (a day; a week for notice-only,
 *      whose filing will not change)
 *   1  on the due list and not checked in the last 2 hours
 *   2  the daily index saw a filing newer than the last check (nightly/catch-up)
 *   3  never checked (nightly/catch-up: the sweep)
 * Within a rank, the newest filing first.
 */
export function pickCandidates(
  mode: RunMode,
  entries: [string, { cik?: string | null; delisted?: boolean; lastFiled?: string | null }][],
  state: Map<string, FilingState>,
  due: Set<string>,
  now: number,
): Candidate[] {
  if (mode === "idle") return [];
  const dayAgo = now - 86_400_000;
  const weekAgo = now - 7 * 86_400_000;
  const twoHoursAgo = now - 2 * 3_600_000;
  const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
  const sweep = mode === "nightly" || mode === "catch-up";
  const out: (Candidate & { lastFiled: string })[] = [];
  for (const [symbol, e] of entries) {
    if (!e.cik || e.delisted) continue;
    const s = state.get(symbol);
    const lastFiled = String(e.lastFiled ?? "");
    let rank = -1;
    if (s?.lag && s.c < (s.lag.kind === "notice" ? weekAgo : dayAgo)) rank = 0;
    else if (due.has(symbol) && (!s || s.c < twoHoursAgo)) rank = 1;
    else if (sweep && s && lastFiled && lastFiled > ymd(s.c)) rank = 2;
    else if (sweep && !s) rank = 3;
    if (rank >= 0) out.push({ symbol, cik: e.cik, rank, lastFiled });
  }
  out.sort((a, b) => a.rank - b.rank || b.lastFiled.localeCompare(a.lastFiled));
  return out.map(({ symbol, cik, rank }) => ({ symbol, cik, rank }));
}

export type Fetchers = {
  submissions: (cik: string) => Promise<Submissions>;
  companyFacts: (cik: string) => Promise<CompanyFacts>;
  instance: (cik: string, f: FilingRef) => Promise<string | null>;
};

export type CheckOutcome = (
  | { kind: "current"; lag: null | FilingState["lag"] }
  | { kind: "noted"; lag: FilingState["lag"] }
  | { kind: "caught-up" | "filled" | "notice"; set: StoredFactSet; lag: FilingState["lag"] }
) & {
  /** The filer's SIC code moved since registrants.json (#552 COWORK #3). Flag only. */
  sicChange?: SicChange | null;
};

/**
 * One filer: is its stored set behind its newest filing, and if so, read the
 * period from the filing. The rules are #537's, moved here from sec-facts'
 * filing phase unchanged.
 */
export async function checkAndFill(
  symbol: string,
  cik: string,
  stored: StoredFactSet,
  prior: FilingState | undefined,
  fetch: Fetchers,
  fxSeries: Map<string, FxSeries | null>,
): Promise<CheckOutcome> {
  // THE SAME PAYLOAD, READ TWICE: the SIC comparison costs no request.
  const subs = await fetch.submissions(cik);
  const sicChange = sicChangeOf(symbol, subs);
  return { ...(await checkAndFillFrom(symbol, cik, stored, prior, fetch, fxSeries, subs)), sicChange };
}

async function checkAndFillFrom(
  symbol: string,
  cik: string,
  stored: StoredFactSet,
  prior: FilingState | undefined,
  fetch: Fetchers,
  fxSeries: Map<string, FxSeries | null>,
  subs: Submissions,
): Promise<CheckOutcome> {
  const filing = newestPeriodicFiling(subs);
  if (!isLagging(stored, filing)) {
    // STILL READ FROM THE FILING is not "caught up": the lag stays recorded
    // until a companyfacts-only read carries the period.
    return { kind: "current", lag: stored.ff ? prior?.lag ?? null : null };
  }
  const f = filing!;
  const cf = await fetch.companyFacts(cik);
  const base = extractForSymbol(symbol, cf);
  const baseNewest = newestStoredEnd({
    quarters: base.quarters.map((p) => ({ e: p.end })) as StoredPeriod[],
    years: base.years.map((p) => ({ e: p.end })) as StoredPeriod[],
  });
  if (baseNewest !== null && baseNewest >= f.reportDate) {
    return { kind: "caught-up", set: await toStoredSet(base, defaultSources(), fxSeries), lag: null };
  }
  if (stored.lg?.accn === f.accn) return { kind: "noted", lag: prior?.lag ?? { accn: f.accn, reportDate: f.reportDate, kind: "notice" } };
  const xml = await fetch.instance(cik, f);
  const { merged, added } = xml
    ? mergeFillOnly(cf, instanceToFacts(xml, f).facts, base.reportingCurrency)
    : { merged: cf, added: 0 };
  const next = await toStoredSet(added ? extractForSymbol(symbol, merged) : base, defaultSources(), fxSeries);
  const noticeOnly = isLagging(next, f);
  const lag = { accn: f.accn, reportDate: f.reportDate, kind: noticeOnly ? "notice" as const : "filled" as const };
  return noticeOnly
    ? { kind: "notice", set: { ...next, lg: f }, lag }
    : { kind: "filled", set: { ...next, ff: f }, lag };
}
