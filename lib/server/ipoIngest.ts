// The daily refresh that keeps `msh:ipo:filings:v1` current.
//
// ── WHAT THIS IS THE OTHER HALF OF ─────────────────────────────────────────
// scripts/ipo-seed.mjs builds the same records from the QUARTERLY index
// (`form.idx`, 39.3 MB a quarter) on a GitHub Actions runner. This builds them
// from the DAILY index, in the app. They must produce identical records, so
// everything that decides what a record IS -- the merge, the prune, the cover
// parser, the classifier -- lives in lib/server and is imported by both. The
// only thing that differs is which EDGAR index the filings are discovered in,
// and that is a discovery mechanism rather than a rule.
//
// ── WHY THE APP AND NOT THE RUNNER ─────────────────────────────────────────
// The seed can build the document but CANNOT WRITE IT: relay.yml holds the
// read-only Upstash token, by deliberate choice, and that refusal is a security
// posture rather than a bug (see writeStoredIpoFilings). The write token exists
// in the Vercel environment, so the app is the only thing that can write. Since
// the write has to happen here, the daily ingest belongs here too rather than
// in a second place that knows about SEC filings.
//
// Supersedes the note that used to sit in ipoSecStore.ts's header saying the
// cold start is "seeded once from form.idx on a runner, never backfilled a day
// at a time from a function". That was written while the runner was still
// expected to do the writing. It cannot, so the day-at-a-time walk below is the
// cold start as well as the standing path -- bounded per run, and reporting how
// far it has got so "is this ready to serve?" is a number rather than a guess.
//
// ── WHAT A RENDER STILL DOES NOT DO ────────────────────────────────────────
// None of this. A page render reads the stored document and makes no upstream
// call, exactly as claude/news-as-stored-dataset-spec-2026-08-22.md settled for
// news. This module is imported by the cron route and by nothing on a render
// path.
import { parseCoverTerms, stripHtml, TERMS_BEARING_FORM } from "./ipoCoverTerms";
import {
  addDays,
  fetchDailyIndex,
  latestProcessableDate,
  toYyyymmdd,
  type IndexRow,
} from "./secDailyIndex";
import type { IpoFilerRecord } from "./ipoSecSource";

/**
 * The forms that make a filer interesting.
 *
 * THE SAME NINE THE SEED KEEPS, and the list is duplicated nowhere: the seed
 * imports it from here. Three different jobs are being done by one set and it
 * is worth naming which, because a future reader trimming it will otherwise
 * remove a form that looks decorative:
 *
 *   S-1 F-1 S-1/A F-1/A   registration and terms — what puts a row in the UPPER table
 *   424B1 424B4           the final prospectus — what MOVES a row to the lower table
 *   8-A12B                registering a class on an exchange — the LISTING event,
 *                         and the test that separates an IPO from a follow-on
 *   RW AW                 withdrawal — what takes a row off the page
 */
export const IPO_OFFERING_FORMS = new Set([
  "S-1",
  "S-1/A",
  "F-1",
  "F-1/A",
  "424B4",
  "424B1",
  "8-A12B",
  "RW",
  "AW",
]);

/**
 * Periodic reports, collected ONLY for filers already interesting.
 *
 * A filer that was already filing these was already a reporting company, so its
 * offering is a follow-on -- the free second discriminator described at length
 * in ipoSecSource.wasReportingCompanyBefore. Collecting them market-wide would
 * mean a record for every public company in America; collecting them for the
 * ~8 filers a day that file an offering form costs nothing extra, because they
 * arrive in the same submissions.json read the SIC comes from.
 */
export const IPO_PERIODIC_FORMS = new Set([
  "10-K",
  "10-Q",
  "20-F",
  "40-F",
  "6-K",
  "10-K/A",
  "10-Q/A",
  "20-F/A",
  "6-K/A",
]);

/**
 * EDGAR-GENERATED NOTICES ARE NOT COMPANY FILINGS.
 *
 * Accessions beginning 9999999995- are produced by EDGAR itself: EFFECT
 * notices, CORRESP/UPLOAD correspondence and the like. MEASURED: Wellchange
 * Holdings has no 424B4 on its record at all -- the 2026-08-28 item the first
 * seed run recorded as one is an EFFECT notice, accession 9999999995-26-002778.
 * It parsed cleanly, landed in a plausible bucket and was counted twice over.
 *
 * A FILTER THAT MATCHES THE WRONG THING LOOKS EXACTLY AS CORRECT AS ONE THAT
 * MATCHES THE RIGHT THING (claude/traps/a-filter-that-matches-nothing-looks-
 * correct.md, addendum). The count of what this removes is reported per run for
 * the same reason.
 */
export const EDGAR_GENERATED_ACCESSION = /^9999999995-/;

/** SEC asks for at most 10 requests a second from a declared agent. */
const MIN_GAP_MS = 125;

/**
 * How many dates one invocation will walk.
 *
 * BOUNDED CATCH-UP, NOT "YESTERDAY", for the reason sec-daily-index states: a
 * missed run loses a day's filings permanently, because tomorrow's run would
 * move the watermark past the gap and there is no second chance at a daily
 * index. Every date from the watermark forward is walked, oldest first, and the
 * watermark is left wherever it got to.
 *
 * 15 is sized against the 300s function budget: a day costs one index fetch
 * (~2-4 MB) plus three requests for each filer that filed an offering form that
 * day -- about eight, from the seed's 722 filers over 90 days. DEADLINE_MS
 * below is the real guard; this cap only keeps a quiet stretch from walking
 * further than anyone asked.
 */
export const IPO_MAX_DAYS_PER_RUN = 15;

/**
 * Wall-clock budget, and the reason there are two limits rather than one.
 *
 * A day cap alone assumes days cost the same. They do not: an IPO-heavy
 * Wednesday can carry five times a quiet Monday's filers, and a run that hits
 * the platform's own timeout is the worst outcome available -- the write never
 * happens, so a whole run's fetching is discarded AND the watermark does not
 * move, which means the next run repeats it. Stopping early and writing what
 * was gathered is strictly better: the watermark advances over the days that
 * did complete.
 *
 * 240s against Vercel's 300s maxDuration leaves room for the merge, the
 * validation and the two Redis commands.
 */
export const IPO_INGEST_DEADLINE_MS = 240_000;

/**
 * How far back a cold start reaches when there is no watermark.
 *
 * IPO_WINDOW_DAYS, so the store ends up the shape the seed would have produced.
 * The TABLES are fully served sooner than that -- the upper table drops
 * anything past IPO_TERMS_MAX_AGE_DAYS (45) and the lower table covers 30 days
 * -- so a walk that has covered 45 days is already serving everything the page
 * can show. The run reports both numbers rather than leaving the difference to
 * be inferred.
 */
export const IPO_COLD_START_DAYS = 90;

type FetchText = (url: string) => Promise<{ ok: boolean; status: number; body: string }>;

/** One filer's entry in a day's index, before anything has been read about it. */
export type TouchedFiler = { cik: string; company: string; forms: string[] };

/**
 * Which filers in one day's index filed something this page cares about.
 *
 * PURE, so scripts/check-ipo-ingest-fixtures.mjs can hold it to fixed index
 * rows with no network -- including the EFFECT-notice row, which is the case
 * that reads as correct when it is wrong.
 */
export function touchedFilersIn(rows: IndexRow[]): {
  filers: Map<string, TouchedFiler>;
  noticesSkipped: number;
} {
  const filers = new Map<string, TouchedFiler>();
  let noticesSkipped = 0;

  for (const row of rows) {
    if (!IPO_OFFERING_FORMS.has(row.form)) continue;
    if (EDGAR_GENERATED_ACCESSION.test(row.accession)) {
      noticesSkipped += 1;
      continue;
    }
    // NORMALISED HERE, ONCE. The daily index pads nothing and submissions.json
    // pads to ten, and a record keyed on one spelling and looked up by the
    // other produces a store that grows a duplicate entry per filer per day
    // while every table stays plausible.
    const cik = String(Number(row.cik));
    const prior = filers.get(cik);
    if (prior) {
      if (!prior.forms.includes(row.form)) prior.forms.push(row.form);
      if (row.company.length > prior.company.length) prior.company = row.company;
      continue;
    }
    filers.set(cik, { cik, company: row.company, forms: [row.form] });
  }

  return { filers, noticesSkipped };
}

/** The slice of submissions.json this reads. Narrow on purpose. */
export type SubmissionsPayload = {
  name?: string;
  sic?: string | number;
  filings?: {
    recent?: {
      form?: string[];
      filingDate?: string[];
      accessionNumber?: string[];
    };
  };
};

export type FilerFromSubmissions = {
  record: IpoFilerRecord;
  /** The newest filing that could carry terms, or null if there is none. */
  termsFiling: { form: string; date: string; accession: string } | null;
  /**
   * TRUE WHEN submissions.recent DOES NOT REACH BACK TO windowStart.
   *
   * SEC documents `recent` as holding at least a year of filings or the most
   * recent 1,000, whichever is more, so for a company filing an S-1 this should
   * never fire. It is reported anyway, because the alternative to reporting it
   * is a filer whose 8-A12B sits just outside a truncated history and is
   * therefore READ AS A FOLLOW-ON -- a correct-looking exclusion of a real IPO,
   * with nothing to distinguish it from a correct one.
   */
  historyTruncated: boolean;
};

/**
 * Build one filer's record from its own submissions.json.
 *
 * ── WHY THE FILER'S OWN HISTORY AND NOT THE ACCUMULATED DAYS ───────────────
 * The obvious design is to append each day's rows to the stored record and let
 * the window fill up over 90 days. It has a silent hole: a company that files a
 * 424B4 today, having filed its 8-A12B three weeks ago, is FIRST SEEN today.
 * Its 8-A12B was filed on a day when nothing about that CIK was interesting, so
 * a day-at-a-time accumulation never recorded it -- and ipoSecSource then reads
 * "no 8-A12B in window" and drops a genuine IPO as a follow-on.
 *
 * That failure is invisible in every direction that matters: the row simply is
 * not on the page, the funnel counts it under droppedFollowOn next to the real
 * follow-ons, and the count stays plausible. Reading the filer's whole in-window
 * history the first time it is touched removes the hole entirely, and costs
 * nothing -- the SIC has to be fetched from this same document anyway.
 *
 * PURE. The caller does the fetching.
 */
export function filerFromSubmissions(
  touched: TouchedFiler,
  payload: SubmissionsPayload,
  windowStart: string
): FilerFromSubmissions {
  const recent = payload.filings?.recent ?? {};
  const forms = recent.form ?? [];
  const dates = recent.filingDate ?? [];
  const accessions = recent.accessionNumber ?? [];

  const filings: IpoFilerRecord["filings"] = [];
  let termsFiling: FilerFromSubmissions["termsFiling"] = null;
  let oldestSeen: string | null = null;

  for (let i = 0; i < forms.length; i++) {
    const form = (forms[i] ?? "").trim();
    const date = (dates[i] ?? "").trim();
    const accession = (accessions[i] ?? "").trim();
    if (!form || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (oldestSeen === null || date < oldestSeen) oldestSeen = date;
    if (date < windowStart) continue;
    if (EDGAR_GENERATED_ACCESSION.test(accession)) continue;
    if (!IPO_OFFERING_FORMS.has(form) && !IPO_PERIODIC_FORMS.has(form)) continue;

    filings.push({ form, date });

    if (TERMS_BEARING_FORM.test(form)) {
      // THE NEWEST ONE WINS, and ties are broken toward the later array
      // position -- submissions.recent is ordered newest-first, so a later
      // index is an OLDER filing and must not displace a newer one of the same
      // date. Same date, same form, two accessions is a real shape (a filer
      // correcting a submission), and taking either is fine; taking the older
      // one systematically is not.
      if (!termsFiling || date > termsFiling.date) {
        termsFiling = { form, date, accession };
      }
    }
  }

  return {
    record: {
      cik: touched.cik,
      // submissions.json carries the registrant's full name; the daily index
      // truncates some. mergeIpoRecords prefers the longer of the two anyway,
      // so passing both through is what makes that rule able to act.
      company:
        (payload.name ?? "").length > touched.company.length
          ? (payload.name as string)
          : touched.company,
      sic: payload.sic != null && String(payload.sic).trim() ? String(payload.sic).trim() : null,
      filings,
      // Filled by the caller if a cover is fetched and parsed. NULL IS NOT A
      // DELETION: mergeIpoRecords keeps terms an earlier run parsed rather than
      // letting a failed read erase them.
      terms: null,
    },
    termsFiling,
    historyTruncated: oldestSeen !== null && oldestSeen > windowStart,
  };
}

/**
 * Which document in a filing's directory is the prospectus.
 *
 * THE SEED'S RULE, UNCHANGED AND NOW SHARED: the largest `.htm` that is not an
 * `R<n>.htm` (those are XBRL viewer fragments). It is a heuristic, but it is
 * the heuristic Phase 0 gated the parser at 5/5 against, so changing it here
 * would invalidate that measurement while looking like a tidy-up.
 *
 * READ FROM index.json, NEVER FROM THE HTML DIRECTORY LISTING. The HTML listing
 * silently truncates and drops the NEWEST filings -- `/Archives/edgar/data/
 * 2089447/` returned 7 of 9, omitting the 424B4 and the EFFECT. No error, no
 * pagination marker. For a calendar page that is the worst available failure:
 * the omission is exactly the rows the page exists to show, and the result
 * looks complete.
 */
export function pickCoverDocument(indexJson: string): string | null {
  try {
    const items = (JSON.parse(indexJson) as { directory?: { item?: { name: string; size: string | number }[] } })
      .directory?.item ?? [];
    return (
      items
        .filter((it) => /\.htm$/i.test(it.name) && !/^R\d+\.htm$/i.test(it.name))
        .sort((a, b) => Number(b.size) - Number(a.size))[0]?.name ?? null
    );
  } catch {
    return null;
  }
}

export type IpoIngestDay = {
  date: string;
  outcome: "parsed" | "absent" | "failed";
  status: number | null;
  ms: number;
  indexRows?: number;
  filers?: number;
  noticesSkipped?: number;
  reason?: string;
};

export type IpoIngestResult = {
  /** Records to merge into the store. Not the whole window -- just what moved. */
  records: IpoFilerRecord[];
  days: IpoIngestDay[];
  /** The last date successfully walked, or null if none was. */
  lastIndexDate: string | null;
  filersTouched: number;
  submissionsRead: number;
  submissionsFailed: number;
  coversFetched: number;
  coversParsed: number;
  noticesSkipped: number;
  historyTruncated: string[];
  stoppedOnDeadline: boolean;
  requests: number;
  ms: number;
};

/**
 * Walk the daily index forward and build the records that changed.
 *
 * `fetchText` is injectable so scripts/check-ipo-ingest-fixtures.mjs can drive
 * the whole walk off fixed bytes. That is not decoration: the rules this exists
 * to get right -- the EFFECT-notice exclusion, the in-window prune boundary,
 * the terms-filing choice -- all fail in the direction that produces a
 * plausible number, and a live run cannot tell a right number from a wrong one.
 */
export async function ingestIpoWindow(opts: {
  ua: string;
  windowStart: string;
  /** First date to walk, yyyymmdd. */
  from: string;
  /** Last date worth asking for, yyyymmdd. Defaults to latestProcessableDate(). */
  to?: string;
  maxDays?: number;
  deadlineMs?: number;
  fetchText?: FetchText;
  now?: Date;
}): Promise<IpoIngestResult> {
  const started = Date.now();
  const to = opts.to ?? latestProcessableDate(opts.now);
  const maxDays = Math.max(1, Math.min(90, opts.maxDays ?? IPO_MAX_DAYS_PER_RUN));
  const deadlineMs = opts.deadlineMs ?? IPO_INGEST_DEADLINE_MS;

  let requests = 0;
  let lastAt = 0;
  const paced: FetchText =
    opts.fetchText ??
    (async (url) => {
      // SHARED SPACING ACROSS EVERY ENDPOINT THIS TOUCHES. SEC's limit is per
      // requester, not per endpoint; two fetchers each politely spacing their
      // own calls would between them double the rate the limit is measured at.
      const wait = Math.max(0, lastAt + MIN_GAP_MS - Date.now());
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastAt = Date.now();
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": opts.ua, "Accept-Encoding": "gzip, deflate", accept: "*/*" },
          cache: "no-store",
        });
        return { ok: res.ok, status: res.status, body: await res.text() };
      } catch (err) {
        return { ok: false, status: 0, body: `${(err as Error).name}: ${(err as Error).message}` };
      }
    });
  const count = <T>(p: Promise<T>): Promise<T> => {
    requests += 1;
    return p;
  };

  const days: IpoIngestDay[] = [];
  const touched = new Map<string, TouchedFiler>();
  let noticesSkipped = 0;
  let lastIndexDate: string | null = null;
  let stoppedOnDeadline = false;

  const dates: string[] = [];
  for (let d = opts.from; d <= to && dates.length < maxDays; d = addDays(d, 1)) dates.push(d);

  for (const date of dates) {
    if (Date.now() - started > deadlineMs) {
      stoppedOnDeadline = true;
      break;
    }
    requests += 1;
    const res = await fetchDailyIndex(date, opts.ua);

    if (res.outcome === "parsed") {
      const found = touchedFilersIn(res.parsed.rows);
      noticesSkipped += found.noticesSkipped;
      for (const [cik, filer] of found.filers) {
        const prior = touched.get(cik);
        if (!prior) {
          touched.set(cik, filer);
          continue;
        }
        for (const f of filer.forms) if (!prior.forms.includes(f)) prior.forms.push(f);
        if (filer.company.length > prior.company.length) prior.company = filer.company;
      }
      lastIndexDate = date;
      days.push({
        date,
        outcome: "parsed",
        status: 200,
        ms: res.ms,
        indexRows: res.parsed.dataRows,
        filers: found.filers.size,
        noticesSkipped: found.noticesSkipped,
      });
      continue;
    }

    if (res.outcome === "absent") {
      // A weekend or a market holiday. EDGAR answers 403 AccessDenied for a key
      // that does not exist, so this is NOT a failure and the watermark still
      // advances -- there is no index to come back for.
      lastIndexDate = date;
      days.push({ date, outcome: "absent", status: res.status, ms: res.ms });
      continue;
    }

    // A real failure. THE WATERMARK IS NOT ADVANCED PAST IT: the day is retried
    // on the next run rather than lost, and walking on would put the gap behind
    // the watermark forever.
    days.push({ date, outcome: "failed", status: res.status, ms: res.ms, reason: res.reason });
    break;
  }

  // ── Per-filer work, for the handful whose filings actually changed ────────
  const records: IpoFilerRecord[] = [];
  const historyTruncated: string[] = [];
  let submissionsRead = 0;
  let submissionsFailed = 0;
  let coversFetched = 0;
  let coversParsed = 0;

  for (const filer of touched.values()) {
    if (Date.now() - started > deadlineMs) {
      stoppedOnDeadline = true;
      break;
    }
    const padded = String(Number(filer.cik)).padStart(10, "0");
    const subs = await count(paced(`https://data.sec.gov/submissions/CIK${padded}.json`));
    if (!subs.ok) {
      submissionsFailed += 1;
      // NO RECORD RATHER THAN A HALF ONE. A record built from the index row
      // alone would carry this filer's forms for today and nothing else, and
      // "no 8-A12B in window" would then be a statement about a failed fetch
      // rather than about the company. Skipping means the filer is picked up on
      // the next run that sees it file, and until then it is absent -- which is
      // the honest reading of "we could not find out".
      continue;
    }
    submissionsRead += 1;

    let payload: SubmissionsPayload;
    try {
      payload = JSON.parse(subs.body) as SubmissionsPayload;
    } catch {
      submissionsFailed += 1;
      continue;
    }

    const built = filerFromSubmissions(filer, payload, opts.windowStart);
    if (built.historyTruncated) historyTruncated.push(filer.cik);

    // Cover terms, only where a filing that can carry them exists.
    if (built.termsFiling) {
      const bare = built.termsFiling.accession.replace(/-/g, "");
      const dir = `https://www.sec.gov/Archives/edgar/data/${Number(filer.cik)}/${bare}`;
      const index = await count(paced(`${dir}/index.json`));
      if (index.ok) {
        const primary = pickCoverDocument(index.body);
        if (primary) {
          coversFetched += 1;
          const doc = await count(paced(`${dir}/${primary}`));
          if (doc.ok) {
            built.record.terms = parseCoverTerms(stripHtml(doc.body), built.record.sic);
            if (
              built.record.terms.priceRangeLow !== null ||
              built.record.terms.sharesOffered !== null
            ) {
              coversParsed += 1;
            }
          }
        }
      }
    }

    records.push(built.record);
  }

  return {
    records,
    days,
    lastIndexDate,
    filersTouched: touched.size,
    submissionsRead,
    submissionsFailed,
    coversFetched,
    coversParsed,
    noticesSkipped,
    historyTruncated,
    stoppedOnDeadline,
    requests,
    ms: Date.now() - started,
  };
}

/** The first date to walk when the store carries no watermark. */
export function coldStartFrom(now = new Date(), days = IPO_COLD_START_DAYS): string {
  return toYyyymmdd(new Date(now.getTime() - days * 86400000));
}
