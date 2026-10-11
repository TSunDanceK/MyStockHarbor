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
// "WHAT IT DOES" (#553 COWORK #159 PR 2): a fourth request, the latest
// registration filing's own document (the prospectus), from which
// extractAbout() lifts two or three sentences of the prospectus summary word
// for word. No AI and no rewording: what cannot be extracted cleanly is not
// shown. A profile built before PR 2 has no `about` key and is rebuilt once.
//
// Commands: job +1 GET +0/1 SET a day; page +1 GET per ISR regeneration
// (daily). SEC requests: <= 4 x filers with a new filing (a few a day; ~400 on
// the first fill or the PR 2 backfill, spread over runs by
// IPO_PROFILE_MAX_FILERS).
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { secFetcher, SecThrottled } from "../secArchiveBackfill.mjs";
import { PROFILE_FORMS, latestRegistration, type IpoAbout, type IpoProfile, type IpoProfileFiling } from "../ipoProfileView";

export const IPO_PROFILES_KEY = "msh:ipo:profiles:v1";
/** Filers fetched per run at most: 4 requests each at <= 8/s is ~20 s of pacing. */
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

// ── "What it does": the prospectus summary, extracted (PR 2) ───────────────
//
// A registration statement opens with a table of contents, then the
// "Prospectus Summary", whose first section is usually "Overview". That
// section's opening sentences are the company describing itself. The rules,
// all of them reasons to OMIT rather than to guess:
//   - tables are dropped whole (the contents page and every figure grid);
//     footnote markers (<sup>) are dropped;
//   - the summary heading must stand alone in its block ("Prospectus
//     Summary"/"Summary"), so a contents line with a page number never counts;
//   - the standard preamble is skipped ("This summary highlights...", "Unless
//     the context otherwise requires...", the defined terms);
//   - a sentence with a placeholder ("[•]", "[ ]"), a defined-term list, or
//     boilerplate (emerging growth company, forward-looking, risk factors, "this
//     prospectus") is left out;
//   - two or three sentences, cut on sentence boundaries to about 60 words;
//     under 20 words, or nothing prose-like, and the block is omitted.

/** The soft and hard word limits, and the floor below which the block is omitted. */
export const ABOUT_TARGET_WORDS = 60;
export const ABOUT_MAX_WORDS = 80;
export const ABOUT_MIN_WORDS = 20;

const ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "\u2019", lsquo: "\u2018",
  rdquo: "\u201d", ldquo: "\u201c", mdash: "\u2014", ndash: "\u2013", hellip: "\u2026", reg: "\u00ae",
  trade: "\u2122", copy: "\u00a9", bull: "\u2022", middot: "\u00b7", eacute: "\u00e9",
};

function decodeEntities(t: string): string {
  return t
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => safeChar(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
}
function safeChar(code: number): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return " ";
  return code === 0xa0 ? " " : String.fromCodePoint(code);
}

/** The document as text blocks (one per paragraph or heading), tables and footnote markers removed. */
export function htmlBlocks(html: string): string[] {
  const t = html
    .replace(/<ix:header>[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<table\b[\s\S]*?<\/table>/gi, "\n\n")
    .replace(/<sup\b[\s\S]*?<\/sup>/gi, "")
    .replace(/<\/?(p|div|br|h[1-6]|li|ul|ol|tr|section|center|hr|body)\b[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(t)
    .split(/\n\s*\n/)
    .map((b) => b.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const SUMMARY_HEADING = /^(prospectus\s+)?summary$/i;
const OVERVIEW_HEADING = /^(overview|general|our company|company overview|business overview|our business|who we are|our mission)$/i;
/**
 * The opening sentence must be the company saying what it is or does ("We are
 * a ...", "Acme is a ...", "We develop ..."). Measured on the live list
 * (2026-10-11): without it, team biographies, a risk paragraph and a sentence
 * cut by a page break all read as "prose" in SPAC summaries.
 */
const DESCRIBES = /\b(is|are|was) (a|an)\b|\b(we|[A-Z][\w.&’'-]*) (develops?|designs?|builds?|provides?|operates?|offers?|makes?|sells?|manufactures?|owns?|focus(es)?|speciali[sz]es?)\b/;
const END_OF_SECTION = /^(the offering|risk factors|summary risk factors|summary of risk factors|risks? associated with our business|corporate information|implications of being an emerging growth company|summary (consolidated )?(historical )?financial (and other )?data)$/i;
const PREAMBLE = /this summary highlights|summary highlights (selected )?information|does not contain all (of )?the information|you should read the (entire|following)|unless (otherwise indicated|the context)|as used in this prospectus|throughout this prospectus|references in this prospectus|in this prospectus,? (unless|references|we|the terms)|we use the terms?|references to [“"]/i;
const BAD_SENTENCE = /emerging growth company|smaller reporting company|forward-looking|risk factors|this prospectus|you should|unless the context|references to|[“"](we|us|our)[,”"]|\[\s*[•●]?\s*\]|[•●]|\.{4,}|\|/i;
const ABBREVIATION = /(?:^|[\s(])(?:inc|corp|co|ltd|llc|l\.p|n\.v|s\.a|plc|no|nos|approx|e\.g|i\.e|etc|vs|mr|ms|dr|st|jr|sr|u\.s|u\.k|[a-z])\.$/i;

const wordsOf = (t: string) => t.split(/\s+/).filter(Boolean).length;
const strip = (h: string) => h.replace(/[\s.:\u2014\u2013-]+$/, "").trim();

/** Sentences on boundaries a reader would agree with: not after "Inc.", "U.S." or an initial. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  const re = /[.!?]["”’)]?(?=\s+["“(]?[A-Z0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    const upTo = text.slice(start, m.index + 1);
    if (m[0][0] === "." && ABBREVIATION.test(upTo)) continue;
    out.push(text.slice(start, end).trim());
    start = end;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/**
 * True when a block reads as running prose: long enough, mostly letters, starts
 * a sentence (not a fragment cut by a page break, not a bullet) and ends one.
 */
function isProse(b: string): boolean {
  if (wordsOf(b) < 12 || !/^["“(]?[A-Z0-9]/.test(b) || !/[.!?]["”’)]?$/.test(b)) return false;
  const nonSpace = b.replace(/\s/g, "");
  const letters = (nonSpace.match(/[A-Za-z]/g) ?? []).length;
  return letters / Math.max(1, nonSpace.length) >= 0.7;
}

/** Two or three sentences, cut on sentence boundaries; null when they would not read cleanly. */
export function trimToSentences(paragraphs: string[]): string | null {
  const picked: string[] = [];
  let words = 0;
  for (const sentence of paragraphs.flatMap(splitSentences)) {
    if (picked.length >= 3) break;
    const w = wordsOf(sentence);
    if (w < 5 || BAD_SENTENCE.test(sentence) || !/[.!?]["”’)]?$/.test(sentence)) {
      if (picked.length) break; // a gap would join sentences that were not side by side
      continue;
    }
    if (words + w <= ABOUT_TARGET_WORDS || (picked.length < 2 && words + w <= ABOUT_MAX_WORDS)) {
      picked.push(sentence);
      words += w;
    } else break;
  }
  if (!picked.length || words < ABOUT_MIN_WORDS) return null;
  return picked.join(" ");
}

/**
 * "What it does" from a registration filing's HTML, or null. Pure.
 *
 * The summary is the first standalone summary heading followed by any prose
 * (a contents line left outside a table has none, so it is passed over). The
 * decision is made THERE, once: no later "Summary" elsewhere in the document
 * is tried. Within it, reading starts after "Overview" (or "General") when
 * that heading comes first, and the extract starts at the first paragraph
 * whose opening sentence describes the company (DESCRIBES); that paragraph and
 * the one after it are trimmed to two or three sentences.
 */
export function extractAbout(html: string): string | null {
  const blocks = htmlBlocks(html);
  for (let h = 0; h < blocks.length; h++) {
    if (!SUMMARY_HEADING.test(strip(blocks[h]))) continue;
    let from = h + 1;
    for (let k = h + 1; k < Math.min(blocks.length, h + 30); k++) {
      if (END_OF_SECTION.test(strip(blocks[k]))) break;
      if (OVERVIEW_HEADING.test(strip(blocks[k]))) { from = k + 1; break; }
    }
    const prose: string[] = [];
    for (let k = from; k < Math.min(blocks.length, from + 40); k++) {
      const b = blocks[k];
      if (END_OF_SECTION.test(strip(b)) || SUMMARY_HEADING.test(strip(b))) break;
      if (isProse(b) && !PREAMBLE.test(b)) prose.push(b);
    }
    if (!prose.length) continue; // a contents line, not the summary
    const start = prose.findIndex((b) => DESCRIBES.test(splitSentences(b)[0] ?? ""));
    return start < 0 ? null : trimToSentences(prose.slice(start, start + 2));
  }
  return null;
}

/**
 * A profile is rebuilt only when the filer's record shows a newer filing than
 * it was built from, or once when it predates "What it does" (no `about` key).
 */
export function needsRefresh(stored: IpoProfile | undefined, latestFilingDate: string): boolean {
  return !stored || stored.v !== 1 || latestFilingDate > stored.basedOn || !("about" in stored);
}

// ── the job step ────────────────────────────────────────────────────────────

export type IpoProfileTarget = { cik: string; latestFilingDate: string };

export type IpoProfilesStepResult = {
  targets: number;
  refreshed: number;
  failed: number;
  feeFound: number;
  /** Profiles whose prospectus yielded a "What it does" extract / were read but yielded none. */
  aboutFound: number;
  aboutOmitted: number;
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
  const result: IpoProfilesStepResult = { targets: targets.length, refreshed: 0, failed: 0, feeFound: 0, aboutFound: 0, aboutOmitted: 0, deferred: 0, throttled: false, secRequests: 0, redisCommands: 1, wrote: false };
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
        // "WHAT IT DOES" (PR 2): the filing's own document. A fetch that fails
        // leaves `about` absent, so the next run tries again; a document that
        // yields no clean extract is recorded as null, and not re-read until a
        // newer filing arrives.
        if (reg.doc && now() <= opts.deadlineMs) {
          try {
            const docBuf = await get(`${base}/${encodeURIComponent(reg.doc)}`);
            if (docBuf) {
              const text = extractAbout(docBuf.toString("utf8"));
              profile.about = text ? ({ text, form: reg.form, date: reg.date } satisfies IpoAbout) : null;
              if (text) result.aboutFound++;
              else result.aboutOmitted++;
            }
          } catch (err) {
            if (err instanceof SecThrottled) throw err;
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
