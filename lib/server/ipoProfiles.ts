// /upcoming-ipos PROFILES FROM SEC EDGAR (#553 COWORK #159 PR 1).
//
// WHAT: for each filer the page shows, a short profile from its own filings --
// industry (SIC), HQ, incorporation, fiscal year end, the emerging-growth flag,
// the registration story (S-1/F-1 -> amendments -> 424B -> 8-A12B) and the
// maximum deal size from the filing-fee exhibit (EX-FILING FEES, inline XBRL
// ffd:TtlOfferingAmt). The view rules are lib/ipoProfileView.ts.
//
// WHEN: in the daily ipo-refresh job, never on a render. A profile is fetched
// only when the filer's IPO record shows a filing newer than the one the
// stored profile was built from (or there is none), so a quiet day costs no
// SEC request at all. ONE Redis key, read with a GET and written with one SET
// only when something changed; filers no longer on the page are dropped.
//
// SEC ETIQUETTE: A's secFetcher (lib/secArchiveBackfill.mjs) -- our declared
// User-Agent, <= 8 requests/s, a 429/403 stops the step (throttled, never
// retried). At most 3 requests a filer: the submissions JSON, the latest
// registration filing's index.json, and its fee exhibit (only when the index
// names one). Bounded by a filer cap and a deadline per run.
//
// Commands: job +1 GET +0/1 SET a day; page +1 GET per ISR regeneration
// (daily). SEC requests: <= 3 x filers with a new filing (a few a day; ~300 on
// the first fill, spread over runs by IPO_PROFILE_MAX_FILERS).
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { secFetcher, SecThrottled } from "../secArchiveBackfill.mjs";
import { PROFILE_FORMS, latestRegistration, type IpoProfile, type IpoProfileFiling } from "../ipoProfileView";

export const IPO_PROFILES_KEY = "msh:ipo:profiles:v1";
/** Filers fetched per run at most: 3 requests each at <= 8/s is ~12 s of pacing. */
export const IPO_PROFILE_MAX_FILERS = 40;
/** Keep longer than a missed run or two; rebuilt from SEC in any case. */
const IPO_PROFILES_TTL_SECONDS = 10 * 24 * 60 * 60;

export type StoredIpoProfiles = { at: number; profiles: Record<string, IpoProfile> };

const readClient =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

/** The page's read: ONE GET. Never throws; an empty map when nothing is on file. */
export async function readIpoProfiles(): Promise<Record<string, IpoProfile>> {
  if (!readClient) return {};
  try {
    const got = await readClient.get<StoredIpoProfiles>(IPO_PROFILES_KEY);
    return got && typeof got === "object" && got.profiles && typeof got.profiles === "object" ? got.profiles : {};
  } catch {
    return {};
  }
}

// ── pure parsers (scripts/check-ipo-profiles.mjs runs them on fixtures) ─────

export type IpoSubmissions = {
  name?: string;
  sic?: string | number;
  sicDescription?: string;
  category?: string;
  fiscalYearEnd?: string;
  stateOfIncorporation?: string;
  stateOfIncorporationDescription?: string;
  addresses?: { business?: { city?: string | null; stateOrCountry?: string | null; stateOrCountryDescription?: string | null } };
  filings?: { recent?: { form?: string[]; filingDate?: string[]; accessionNumber?: string[]; primaryDocument?: string[] } };
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The profile's filer facts from the submissions JSON (fee fields left empty). */
export function profileFromSubmissions(cik: string, s: IpoSubmissions, basedOn: string): IpoProfile {
  const r = s.filings?.recent ?? {};
  const forms = r.form ?? [];
  const filings: IpoProfileFiling[] = [];
  for (let i = 0; i < forms.length; i++) {
    const form = String(forms[i] ?? "");
    const date = String(r.filingDate?.[i] ?? "");
    const acc = String(r.accessionNumber?.[i] ?? "");
    if (!PROFILE_FORMS.test(form) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !acc) continue;
    filings.push({ form, date, acc, doc: str(r.primaryDocument?.[i]) });
  }
  filings.sort((a, b) => a.date.localeCompare(b.date) || a.acc.localeCompare(b.acc));
  const biz = s.addresses?.business ?? {};
  // EDGAR's description is the state code for a US address ("CA") and the
  // country's name otherwise ("CAYMAN ISLANDS"); the bare code ("E9") only as a last resort.
  const region = str(biz.stateOrCountryDescription) ?? str(biz.stateOrCountry);
  return {
    v: 1,
    cik,
    basedOn,
    sic: s.sic == null || s.sic === "" ? null : String(s.sic),
    sicDescription: str(s.sicDescription),
    city: str(biz.city),
    region,
    incorporatedIn: str(s.stateOfIncorporationDescription) ?? str(s.stateOfIncorporation),
    fiscalYearEnd: str(s.fiscalYearEnd),
    emergingGrowth: /emerging growth company/i.test(String(s.category ?? "")),
    filings,
    maxDealSize: null,
    maxDealSizeFrom: null,
  };
}

/** The fee exhibit in a filing's index.json listing, by its file name; null when none is named. */
export function pickFeeExhibit(index: unknown): string | null {
  const items = (index as { directory?: { item?: { name?: string }[] } })?.directory?.item ?? [];
  const names = items.map((i) => String(i?.name ?? "")).filter((n) => /\.html?$/i.test(n));
  return names.find((n) => /(ex[-_]?107|filing[-_]?fees?|exfilingfees|feeexhibit)/i.test(n)) ?? null;
}

/**
 * The total maximum aggregate offering price from the fee exhibit's inline
 * XBRL (ffd:TtlOfferingAmt), in dollars. Null unless exactly that tag is there
 * with a positive number: a guess from the text is never taken.
 */
export function parseFeeExhibitMax(html: string): number | null {
  const m = /<ix:nonFraction\b([^>]*\bname="ffd:TtlOfferingAmt"[^>]*)>([\s\S]*?)<\/ix:nonFraction>/i.exec(html);
  if (!m) return null;
  const attrs = m[1];
  const text = m[2].replace(/<[^>]+>/g, "").trim();
  if (/\bsign="-"/.test(attrs)) return null;
  const decimalComma = /num-comma-decimal/i.test(attrs);
  const digits = decimalComma ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  const n = Number(digits.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0 || !/\d/.test(digits)) return null;
  const scale = Number(/\bscale="(-?\d+)"/.exec(attrs)?.[1] ?? 0);
  const v = n * 10 ** (Number.isFinite(scale) ? scale : 0);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

/** A profile is rebuilt only when the filer's record shows a newer filing than it was built from. */
export function needsRefresh(stored: IpoProfile | undefined, latestFilingDate: string): boolean {
  return !stored || stored.v !== 1 || latestFilingDate > stored.basedOn;
}

// ── the job step ────────────────────────────────────────────────────────────

export type IpoProfileTarget = { cik: string; latestFilingDate: string };

export type IpoProfilesStepResult = {
  targets: number;
  refreshed: number;
  failed: number;
  feeFound: number;
  deferred: number;
  throttled: boolean;
  secRequests: number;
  redisCommands: number;
  wrote: boolean;
};

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Bring the stored profiles in line with the filers the page shows. Never
 * throws: a failure leaves the old profile (or none) and is counted.
 */
export async function refreshIpoProfiles(
  r: Redis,
  targets: IpoProfileTarget[],
  opts: { ua: string; deadlineMs: number; maxFilers?: number; fetchImpl?: FetchImpl; sleep?: (ms: number) => Promise<void>; now?: () => number }
): Promise<IpoProfilesStepResult> {
  const now = opts.now ?? Date.now;
  const counters = { secRequests: 0 };
  const result: IpoProfilesStepResult = { targets: targets.length, refreshed: 0, failed: 0, feeFound: 0, deferred: 0, throttled: false, secRequests: 0, redisCommands: 1, wrote: false };
  let stored: StoredIpoProfiles | null = null;
  try {
    stored = await r.get<StoredIpoProfiles>(IPO_PROFILES_KEY);
  } catch {
    stored = null;
  }
  const before = stored?.profiles ?? {};
  const next: Record<string, IpoProfile> = {};
  for (const t of targets) if (before[t.cik]) next[t.cik] = before[t.cik];
  let changed = Object.keys(next).length !== Object.keys(before).length;

  const get = secFetcher({
    fetchImpl: opts.fetchImpl ?? ((u: string, i?: RequestInit) => fetch(u, { ...i, cache: "no-store", signal: AbortSignal.timeout(10_000) })),
    sleep: opts.sleep ?? ((ms: number) => new Promise((res) => setTimeout(res, ms))),
    now,
    userAgent: opts.ua,
    counters,
  });
  const due = targets.filter((t) => needsRefresh(before[t.cik], t.latestFilingDate));
  const cap = opts.maxFilers ?? IPO_PROFILE_MAX_FILERS;
  for (let i = 0; i < due.length; i++) {
    const t = due[i];
    if (i >= cap || now() > opts.deadlineMs || result.throttled) {
      result.deferred = due.length - i;
      break;
    }
    try {
      const subBuf = await get(`https://data.sec.gov/submissions/CIK${t.cik.padStart(10, "0")}.json`);
      if (!subBuf) { result.failed++; continue; }
      const profile = profileFromSubmissions(t.cik, JSON.parse(subBuf.toString("utf8")) as IpoSubmissions, t.latestFilingDate);
      const reg = latestRegistration(profile.filings);
      if (reg && now() <= opts.deadlineMs) {
        const base = `https://www.sec.gov/Archives/edgar/data/${String(Number(t.cik))}/${reg.acc.replace(/-/g, "")}`;
        const idxBuf = await get(`${base}/index.json`);
        const exhibit = idxBuf ? pickFeeExhibit(JSON.parse(idxBuf.toString("utf8"))) : null;
        if (exhibit) {
          const exBuf = await get(`${base}/${encodeURIComponent(exhibit)}`);
          const max = exBuf ? parseFeeExhibitMax(exBuf.toString("utf8")) : null;
          if (max !== null) {
            profile.maxDealSize = max;
            profile.maxDealSizeFrom = { form: reg.form, date: reg.date };
            result.feeFound++;
          }
        }
      }
      next[t.cik] = profile;
      changed = true;
      result.refreshed++;
    } catch (err) {
      if (err instanceof SecThrottled) { result.throttled = true; result.deferred = due.length - i; break; }
      result.failed++;
    }
  }
  result.secRequests = counters.secRequests;
  if (changed) {
    try {
      await r.set(IPO_PROFILES_KEY, { at: now(), profiles: next } satisfies StoredIpoProfiles, { ex: IPO_PROFILES_TTL_SECONDS });
      result.wrote = true;
      result.redisCommands++;
    } catch {
      // the old copy stays; next run retries
    }
  }
  return result;
}
