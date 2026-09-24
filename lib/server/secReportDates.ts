// WHEN A COMPANY ACTUALLY ANNOUNCED, FROM ITS OWN FILINGS — not from a vendor.
//
// ── WHAT THIS REPLACES AND WHY ────────────────────────────────────────────
// The earnings page reads announcement dates and before-open/after-close timing
// from FMP's /earnings. Those are the last two fields on the page still coming
// from a vendor, and they are the two a filer publishes itself: an 8-K carrying
// Item 2.02 ("Results of Operations and Financial Condition") IS the earnings
// announcement, and EDGAR records the moment it was accepted.
//
// A FILING DATE IS NOT AN ANNOUNCEMENT DATE, which is the whole reason this
// module reads `acceptanceDateTime` rather than `filingDate`. EDGAR rolls the
// filing date to the next business day for anything accepted after 17:30 ET, so
// a 16:05 release on a Thursday can carry Friday's filingDate. Using it would
// put the market reaction on the wrong session — the exact defect the price
// reaction card exists to avoid.
//
// ── WHAT IT DELIBERATELY DOES NOT DO ──────────────────────────────────────
// It does not read numbers. EPS and revenue come from the stored fact set and
// nowhere else (claude/traps/two-validators-for-one-value.md). This module
// supplies DATES and TIMING only.

/** Where a filing sits against the US regular session, in Eastern time. */
export type ReportTiming = "before-open" | "during-market" | "after-close";

export type ReportEvent = {
  /**
   * ── THE 8-K reportDate IS NOT A PERIOD END, AND I BUILT ON THE ASSUMPTION
   * THAT IT WAS ──────────────────────────────────────────────────────────────
   *
   * EDGAR labels it "Date of Report (Date of earliest event reported)". For an
   * Item 2.02 8-K the earliest event reported IS THE RESULTS RELEASE, so this
   * field is the announcement date, not the quarter it covers.
   *
   * The first version of this module called it `periodEnd` and computed the
   * reporting lag as announcedOn - reportDate. That is announcement minus
   * announcement: ZERO by construction. The backtest then "predicted" the
   * announcement date from the announcement date and reported a median
   * absolute error of 0 days across 103 filers, which read as an
   * extraordinarily good model and was an identity.
   *
   *   AA  prior lags [0,0,0,0,0,0] (n=42) median 0d
   *       period end 2026-07-16 -> predicted 2026-07-16 · actual 2026-07-16
   *
   * Six zero lags in a row is not a well-behaved filer, it is a tautology, and
   * the field name was what hid it.
   */
  eventDate: string | null;
  /**
   * The FISCAL PERIOD the results cover, matched from the stored fact set —
   * the only place this repository holds real period ends.
   *
   * Null where no stored period lines up, and that is the honest answer: an
   * announcement older than the retention window has no period to measure a
   * lag against, and inventing one from the filing itself is the mistake above.
   */
  periodEnd: string | null;
  /** Announcement DATE in ET (YYYY-MM-DD), taken from acceptanceDateTime. */
  announcedOn: string;
  /** Announcement time in ET, HH:MM. */
  announcedAt: string;
  timing: ReportTiming;
  form: string;
  /** The raw items string, so a reader can see why this filing was selected. */
  items: string | null;
  accession: string;
  /**
   * HOW this event was identified, carried with it rather than inferred later.
   *
   * The two paths are not equally strong and must not be presented as if they
   * were: an 8-K names Item 2.02 explicitly, while a 6-K has no items taxonomy
   * at all and is selected by a weaker rule. See `SIX_K_IS_A_WEAKER_SIGNAL`.
   */
  basis: "8-K item 2.02" | "6-K near period end";
};

/**
 * ── THE 6-K PROBLEM, STATED RATHER THAN PAPERED OVER ──────────────────────
 *
 * A foreign private issuer files 6-K, not 8-K, and THE 6-K FORM HAS NO ITEM
 * CODES. `items` is empty for every one of them, so "the filing that carries
 * Item 2.02" is not a question that can be asked of a 6-K.
 *
 * A 6-K carries anything the filer must disclose at home: results, yes, but
 * also board changes, dividends, AGM notices, press releases of every kind. A
 * filer can publish twenty in a year.
 *
 * So this module uses a POSITIONAL rule for them — a 6-K whose reportDate is a
 * period end the filer also reports figures for — and marks the result with a
 * different `basis` so nothing downstream can treat the two as equivalent
 * evidence. Where the rule is wrong it will be wrong by selecting a nearby
 * non-results 6-K, which is why the probe reports 8-K and 6-K agreement
 * SEPARATELY and never as one blended number.
 */
export const SIX_K_IS_A_WEAKER_SIGNAL = true;

/**
 * How long after a period ends an announcement about it can plausibly arrive.
 *
 * Wide enough for a slow annual filer (the statutory 10-K deadline alone is 90
 * days for a non-accelerated filer) and narrow enough that an announcement
 * cannot match the period BEFORE the one it is about.
 */
export const MAX_PERIOD_TO_ANNOUNCEMENT_DAYS = 120;

/** Item 2.02 — Results of Operations and Financial Condition. */
const RESULTS_ITEM = "2.02";

/**
 * Item 9.01 — Financial Statements and Exhibits.
 *
 * A results release attaches its figures as an exhibit, so an 8-K carrying BOTH
 * 2.02 and 9.01 is the better evidence that this filing IS the release rather
 * than a filing that merely mentions results. Used only as a tie-break — see
 * the dedup at the bottom of reportEvents.
 */
const EXHIBITS_ITEM = "9.01";

/** US regular session, Eastern. */
const OPEN_MINUTES = 9 * 60 + 30;
const CLOSE_MINUTES = 16 * 60;

/**
 * The shape `filings.recent` actually has: parallel arrays, one entry per
 * filing, indexed together. Optional throughout because a partial payload must
 * produce no events rather than throw.
 */
export type SubmissionsFilings = {
  accessionNumber?: unknown[];
  filingDate?: unknown[];
  reportDate?: unknown[];
  acceptanceDateTime?: unknown[];
  form?: unknown[];
  items?: unknown[];
};

export type Submissions = {
  cik?: unknown;
  name?: unknown;
  /** "Large accelerated filer" | "Accelerated filer" | "Non-accelerated filer" | … */
  category?: unknown;
  /** SEC's Standard Industrial Classification code, and its description. */
  sic?: unknown;
  sicDescription?: unknown;
  filings?: { recent?: SubmissionsFilings };
};

/**
 * ── THE TIMEZONE, WHICH IS THE ONE THING HERE THAT CAN BE SILENTLY WRONG ──
 *
 * `acceptanceDateTime` is serialised as `2026-07-28T14:58:11.000Z`, and THE Z IS
 * REAL: the digits are UTC and must be converted to Eastern.
 *
 * I ASSUMED THE OPPOSITE AND WAS WRONG. The first version of this module took
 * the digits at face value as Eastern wall time, on the widely-repeated claim
 * that EDGAR stamps acceptance in ET and the serializer appends a spurious Z.
 * scripts/sec-report-dates-probe.mjs was written to settle it rather than
 * argue it, and it settled it against me:
 *
 *   PANEL: 10 filers whose habit is public and stable
 *     digits read as EASTERN            5/10 in the expected bucket
 *     digits read as UTC and converted  10/10
 *
 * THE BEFORE-OPEN HALF IS WHAT DISCRIMINATES. KO, PG, CAT and MMM stamp
 * 10:58Z, 11:03Z, 10:31Z and 10:34Z. Read as Eastern those are 10:58, 11:03,
 * 10:31, 10:34 — all "during market", all wrong. Converted they are 06:58,
 * 07:03, 06:31 and 06:34 ET, which is what a before-open release looks like.
 *
 * The after-close half (AAPL, MSFT, NVDA, GOOGL, AMZN) lands after 16:00 under
 * BOTH readings, which is exactly why a panel of only mega-caps would have
 * confirmed the wrong answer — 5 of 5, and meaningless.
 *
 * HAD THIS SHIPPED, nothing would have failed. Every before-open filer on the
 * site would simply have been labelled "during market", forever, and the price
 * reaction card would have measured the wrong session for them.
 *
 * ── AND THE CONVERSION IS Intl, NOT A FIXED OFFSET ────────────────────────
 * Eastern is UTC-5 or UTC-4 depending on the date, and a hardcoded -5 puts
 * every summer filing an hour early — enough to move a 09:00 ET release across
 * the 09:30 open. `America/New_York` via Intl knows the rules and the
 * historical transitions; nothing here needs to.
 *
 * THE DATE CONVERTS TOO, which is the part a naive fix misses: a filing
 * accepted at 00:30Z is 20:30 ET on the PREVIOUS day, and reporting it under
 * the UTC date puts the announcement on a session that had already closed.
 */
const ET = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function parseAcceptanceEt(raw: unknown): { date: string; time: string; minutes: number } | null {
  if (typeof raw !== "string") return null;
  // EDGAR writes it with a Z, but not always; a bare "YYYY-MM-DD HH:MM:SS" is
  // the same instant in UTC and is normalised here rather than at every caller.
  const iso = /[Zz]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw.replace(" ", "T")}Z`;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const parts = ET.formatToParts(new Date(t));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const [y, mo, d, hh, mm] = [get("year"), get("month"), get("day"), get("hour"), get("minute")];
  if (!y || !mo || !d || !hh || !mm) return null;
  return {
    date: `${y}-${mo}-${d}`,
    time: `${hh}:${mm}`,
    minutes: Number(hh) * 60 + Number(mm),
  };
}

/**
 * BOUNDARIES INCLUSIVE AT THE CLOSE, EXCLUSIVE AT THE OPEN, and that asymmetry
 * is deliberate. A release timed for 16:00:00 is an after-close release in
 * every newsroom's usage; one timed for 09:30:00 is not a before-open release,
 * it is into the opening bell.
 */
export function timingFor(minutes: number): ReportTiming {
  if (minutes < OPEN_MINUTES) return "before-open";
  if (minutes >= CLOSE_MINUTES) return "after-close";
  return "during-market";
}

/**
 * Every item spelling EDGAR uses, so a filing is not missed on format.
 *
 * ONE PARSER FOR BOTH ITEM CODES. 2.02 and 9.01 arrive in the same field with
 * the same spellings, so a second hand-written matcher for 9.01 would be a
 * second reading of one format — the shape this repo has paid for repeatedly
 * (claude/traps/two-validators-for-one-value.md). The item code is a parameter.
 */
function hasItem(raw: unknown, code: string): boolean {
  if (typeof raw !== "string") return false;
  // EDGAR writes items as a comma-separated list, sometimes with the prose
  // title attached: "2.02,9.01" or "Item 2.02 Results of Operations...".
  return raw.split(/[,;]/).some((part) => part.trim().replace(/^Item\s+/i, "").startsWith(code));
}

const hasResultsItem = (raw: unknown): boolean => hasItem(raw, RESULTS_ITEM);

/** Does this filing also attach the statements? The tie-break, nothing more. */
export const carriesExhibits = (raw: unknown): boolean => hasItem(raw, EXHIBITS_ITEM);

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * Every earnings announcement this filer's recent submissions can evidence,
 * newest first.
 *
 * `periodEnds` is the set of period ends the STORED FACT SET knows about, used
 * only by the 6-K rule. Passed in rather than fetched so this module stays pure
 * and the caller owns every read.
 */
export function reportEvents(
  subs: Submissions,
  periodEnds: ReadonlySet<string> = new Set()
): ReportEvent[] {
  return resultsPairing(subs, periodEnds).events;
}

/**
 * Forms that ARE the periodic report for a period, originals only. An
 * amendment re-files a period already reported and says nothing about when
 * the results were first out.
 */
const PERIODIC_REPORT_FORMS = new Set(["10-Q", "10-K", "10-QT", "10-KT"]);

/**
 * When each period's 10-Q / 10-K reached EDGAR, keyed by the period it covers.
 *
 * ── THE ONE DATE ON A PERIODIC REPORT THAT IS A PERIOD END ───────────────
 * Unlike the 8-K's (see ReportEvent.eventDate), a 10-Q's `reportDate` IS the
 * "period of report" -- the fiscal period end. So this pairs by equality with
 * the period ends the fact set holds, and needs no window to guess with.
 *
 * Dated in ET from acceptanceDateTime, the same clock `announcedOn` uses, so
 * "on or before the 10-Q" compares like with like. filingDate only where there
 * is no acceptance time: here it bounds a comparison rather than being
 * reported, and a 10-Q accepted at 17:45 rolling to the next day can only
 * WIDEN the window by one day, never exclude the release.
 */
export function periodicReportDates(subs: Submissions): Map<string, string> {
  const recent = subs?.filings?.recent;
  const out = new Map<string, string>();
  if (!recent) return out;
  const n = Array.isArray(recent.accessionNumber) ? recent.accessionNumber.length : 0;
  for (let i = 0; i < n; i++) {
    const form = str(recent.form?.[i]);
    if (!form || !PERIODIC_REPORT_FORMS.has(form)) continue;
    const period = str(recent.reportDate?.[i]);
    if (!period) continue;
    const filed = parseAcceptanceEt(recent.acceptanceDateTime?.[i])?.date ?? str(recent.filingDate?.[i]);
    if (!filed) continue;
    const seen = out.get(period);
    if (!seen || filed < seen) out.set(period, filed);
  }
  return out;
}

/**
 * How one period's results event was chosen, kept so the choice can be
 * audited and so the current period can be judged by the filer's own past.
 */
export type PeriodPairing = {
  periodEnd: string;
  /** The period's 10-Q/10-K date, or null when none is on file yet. */
  periodicFiledOn: string | null;
  /** The event kept for the period. */
  picked: ReportEvent;
  /** The EARLIEST qualifying event for the period -- what the old rule kept. */
  earliest: ReportEvent;
  /** Every qualifying event for the period, newest first -- for audits only. */
  candidates: ReportEvent[];
  /**
   * "paired"    picked as the latest 2.02 on or before the 10-Q/10-K
   * "unpaired"  no 10-Q/10-K for this period, or no 2.02 before it: earliest
   */
  rule: "paired" | "unpaired";
};

export type ResultsPairing = { events: ReportEvent[]; periods: PeriodPairing[] };

export function resultsPairing(
  subs: Submissions,
  periodEnds: ReadonlySet<string> = new Set()
): ResultsPairing {
  const recent = subs?.filings?.recent;
  if (!recent) return { events: [], periods: [] };
  const n = Array.isArray(recent.accessionNumber) ? recent.accessionNumber.length : 0;
  const out: ReportEvent[] = [];

  for (let i = 0; i < n; i++) {
    const form = str(recent.form?.[i]);
    if (!form) continue;
    const items = str(recent.items?.[i]);
    const isEightK = form === "8-K" || form === "8-K/A";
    const isSixK = form === "6-K" || form === "6-K/A";
    if (!isEightK && !isSixK) continue;

    const eventDate = str(recent.reportDate?.[i]);
    let basis: ReportEvent["basis"];
    if (isEightK) {
      if (!hasResultsItem(items)) continue;
      basis = "8-K item 2.02";
    } else {
      // THE POSITIONAL RULE, and it refuses rather than guesses. A 6-K carries
      // no item codes, so the only handle is its reported date landing on a
      // period this filer publishes figures for. NOTE the asymmetry with the
      // 8-K above: on a 6-K that date often IS the period end, which is why
      // this rule works at all and why the 8-K's identically-named field misled
      // me. See ReportEvent.eventDate.
      if (!eventDate || !periodEnds.has(eventDate)) continue;
      basis = "6-K near period end";
    }

    const accepted = parseAcceptanceEt(recent.acceptanceDateTime?.[i]);
    // NO ACCEPTANCE TIME, NO EVENT. Falling back to filingDate here is exactly
    // the substitution this module's header rejects: it is a different fact.
    if (!accepted) continue;

    // ── THE PERIOD IS MATCHED, NEVER READ OFF THE FILING ────────────────
    // The newest stored period end that had already ENDED when the filing was
    // accepted, within a window a results announcement can plausibly span.
    // Nothing outside that window is a match rather than a guess.
    let periodEnd: string | null = null;
    for (const end of periodEnds) {
      if (end > accepted.date) continue;
      const age = daysBetween(end, accepted.date);
      if (age > MAX_PERIOD_TO_ANNOUNCEMENT_DAYS) continue;
      if (!periodEnd || end > periodEnd) periodEnd = end;
    }

    out.push({
      eventDate,
      periodEnd,
      announcedOn: accepted.date,
      announcedAt: accepted.time,
      timing: timingFor(accepted.minutes),
      form,
      items,
      accession: str(recent.accessionNumber?.[i]) ?? "",
      basis,
    });
  }

  out.sort((a, b) => (a.announcedOn < b.announcedOn ? 1 : a.announcedOn > b.announcedOn ? -1 : 0));

  // ── ONE EVENT PER PERIOD, AND THE EARLIEST ONE ────────────────────────────
  //
  // A filer can file several qualifying documents for the SAME period: an
  // 8-K/A amending the original, a second 8-K carrying the transcript, or —
  // seen live on ABEV — the same 6-K indexed twice. The ORIGINAL announcement
  // is the one the market reacted to, so the earliest wins.
  //
  // THIS IS NOT COSMETIC, AND IT WAS LEAKING A BACKTEST. With duplicates in the
  // list, a leave-one-out prediction of the newest event kept a COPY of that
  // same event in its own training set, whose lag is by definition the lag
  // being predicted. The median was then pulled onto the answer and the
  // reported error collapsed toward zero — a number that measured the
  // duplication, not the method.
  // KEYED ON THE PERIOD WHERE THERE IS ONE, on the event date otherwise — an
  // announcement with no matched period is still one announcement, and two
  // index entries for it must still collapse to one.
  // ── THE 9.01 TIE-BREAK, AND WHY IT IS ONLY A TIE-BREAK ───────────────────
  //
  // Restored from lib/server/secResultsDate.ts, deleted in the consolidation.
  // That module preferred a 2.02 filing also carrying 9.01 -- the exhibit that
  // attaches the statements -- because it is the better evidence that a filing
  // IS the release rather than one that mentions results.
  //
  // NARROWED ON PURPOSE, AND THE NARROWING IS THE POINT. The deleted rule
  // preferred a 9.01 filing even when an earlier 2.02-only filing existed. Here
  // that would override "the earliest wins", and earliest is load-bearing for a
  // different consumer: the ORIGINAL announcement is the one the market reacted
  // to, and announcedOn feeds the price-reaction card on the stock page. A
  // later 8-K/A carrying the statements would silently move every reaction
  // measurement onto the amendment's date.
  //
  // SO IT BREAKS TIES ONLY -- and there was a real, arbitrary tie to break.
  // On equal announcedOn the old test (`e.announcedOn < seen.announcedOn`) is
  // false, so the incumbent survived and the winner was whichever filing came
  // first in the submissions array: index order, which is not a rule. Two 8-Ks
  // filed the same day for the same period is exactly the ambiguous case the
  // 9.01 preference was measured to resolve, and it is the case where earliest
  // has nothing to say.
  const beats = (candidate: ReportEvent, incumbent: ReportEvent): boolean => {
    if (candidate.announcedOn !== incumbent.announcedOn) {
      return candidate.announcedOn < incumbent.announcedOn;
    }
    return carriesExhibits(candidate.items) && !carriesExhibits(incumbent.items);
  };

  //
  // ── AND WITHIN A PERIOD THAT HAS ITS 10-Q, THE LATEST ONE BEFORE IT ──────
  //
  // Earliest-wins picked the wrong filing for a filer with TWO Item 2.02s a
  // quarter. Tesla files its production and delivery numbers under 2.02 two
  // days after quarter end and its results about three weeks later; ABBV files
  // an early 2.02 on in-process R&D charges. Earliest kept the early one every
  // quarter, so TSLA's stored lag was 2 days over 14 periods with a spread of
  // 0 -- a perfectly regular, perfectly wrong habit that no spread test or
  // precision bar can see (claude/BRIEF-early-2.02-mispick-2026-09-22.md).
  //
  // The periodic report settles it, because the results must be out by the
  // time the 10-Q is filed. So where the period's 10-Q/10-K is on file, the
  // pick is the LATEST original 8-K 2.02 filed ON OR BEFORE it:
  //   - later than an early non-results 2.02 (the delivery numbers),
  //   - never an amendment or restatement filed AFTER the 10-Q, which is the
  //     failure plain latest-wins would have (option 4 in the brief),
  //   - never an 8-K/A inside the window while an original is there, for the
  //     reason the earliest rule exists: the original is what the market read.
  // Where there is no 10-Q yet -- the current period -- or no 2.02 before it,
  // nothing can be paired and the earliest rule above still decides. The
  // current period's early 2.02 is handled by the guard in pendingResults,
  // not here.
  const periodic = periodicReportDates(subs);
  const byPeriod = new Map<string, ReportEvent[]>();
  const undated: ReportEvent[] = [];
  for (const e of out) {
    const key = e.periodEnd ?? e.eventDate;
    if (!key) { undated.push(e); continue; }
    const group = byPeriod.get(key);
    if (group) group.push(e);
    else byPeriod.set(key, [e]);
  }

  const kept: ReportEvent[] = [];
  const periods: PeriodPairing[] = [];
  for (const group of byPeriod.values()) {
    let earliest = group[0];
    for (const e of group) if (beats(e, earliest)) earliest = e;
    const periodEnd = earliest.periodEnd;
    const filedOn = periodEnd ? periodic.get(periodEnd) ?? null : null;

    let picked: ReportEvent | null = null;
    if (filedOn) {
      const before = group.filter((e) => e.basis === "8-K item 2.02" && e.announcedOn <= filedOn);
      const originals = before.filter((e) => e.form === "8-K");
      for (const e of originals.length ? originals : before) {
        if (
          !picked ||
          e.announcedOn > picked.announcedOn ||
          (e.announcedOn === picked.announcedOn && carriesExhibits(e.items) && !carriesExhibits(picked.items))
        ) picked = e;
      }
    }
    kept.push(picked ?? earliest);
    if (periodEnd) {
      periods.push({
        periodEnd,
        periodicFiledOn: filedOn,
        picked: picked ?? earliest,
        earliest,
        candidates: group,
        rule: picked ? "paired" : "unpaired",
      });
    }
  }

  const events = [...kept, ...undated];
  events.sort((a, b) => (a.announcedOn < b.announcedOn ? 1 : a.announcedOn > b.announcedOn ? -1 : 0));
  periods.sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : a.periodEnd > b.periodEnd ? -1 : 0));
  return { events, periods };
}

/**
 * A filer whose past quarters carry an Item 2.02 that is NOT the results.
 *
 * DERIVED FROM THE PAIRING, never from a list of symbols: a paired period
 * whose earliest 2.02 is not the one kept had an earlier 2.02 that the 10-Q
 * shows was not the results release. TSLA's delivery numbers, ABBV's IPR&D
 * update.
 *
 * A HABIT, NOT AN INCIDENT: at least two such periods. A single early 2.02 --
 * a one-off pre-announcement -- does not make a filer's next early 2.02
 * suspect, and flagging on one would suppress a real early release.
 *
 * The two lags are the filer's own, so the guard that reads them needs no
 * fixed day threshold (see pendingResults): the brief's option 2, a global
 * floor, was rejected because ORCL genuinely reports at around ten days.
 */
export type EarlyNonResultsPattern = {
  /** Paired periods that had an earlier, non-results 2.02. */
  periods: number;
  /** Paired periods in total. */
  ofPaired: number;
  /** Median lag of the early, non-results 2.02s. */
  earlyLagDays: number;
  /** Median lag of the paired results releases. */
  resultsLagDays: number;
};

export const EARLY_PATTERN_MIN_PERIODS = 2;

export function earlyNonResultsPattern(periods: readonly PeriodPairing[]): EarlyNonResultsPattern | null {
  const paired = periods.filter((p) => p.rule === "paired");
  const early = paired.filter(
    (p) => p.earliest !== p.picked && p.earliest.announcedOn < p.picked.announcedOn
  );
  if (early.length < EARLY_PATTERN_MIN_PERIODS) return null;
  const earlyLag = median(early.map((p) => daysBetween(p.periodEnd, p.earliest.announcedOn)));
  const resultsLag = median(paired.map((p) => daysBetween(p.periodEnd, p.picked.announcedOn)));
  if (earlyLag === null || resultsLag === null || earlyLag >= resultsLag) return null;
  return { periods: early.length, ofPaired: paired.length, earlyLagDays: earlyLag, resultsLagDays: resultsLag };
}

/**
 * Is an announcement this many days after its period end the filer's EARLY,
 * non-results 2.02 rather than its results?
 *
 * Nearer the filer's own early habit than its own results habit: the midpoint
 * of the two medians. Per filer, from its own history -- TSLA 2 vs ~22 days,
 * ABBV ~4 vs ~31 -- so nothing here is a threshold a fast filer could trip.
 * A filer with no pattern is never judged early.
 */
export function looksLikeEarlyNonResults(
  lagDays: number,
  pattern: EarlyNonResultsPattern | null | undefined
): boolean {
  if (!pattern) return false;
  return lagDays < (pattern.earlyLagDays + pattern.resultsLagDays) / 2;
}

// ── THE NEXT REPORT DATE ───────────────────────────────────────────────────

const DAY = 86400000;
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY);

/**
 * Statutory deadlines for the PERIODIC report covering a period, in days after
 * the period end. 17 CFR 240.13a-13 / 13a-1.
 *
 * THE DEADLINE IS FOR THE 10-Q OR 10-K, NOT FOR THE 8-K, and that is the point:
 * an earnings 8-K almost always precedes the periodic report, so the deadline
 * is an UPPER BOUND on a sane estimate rather than a prediction of it. It is
 * used to clamp, never to predict.
 */
export const FILING_DEADLINE_DAYS: Record<string, { quarter: number; annual: number }> = {
  "large accelerated filer": { quarter: 40, annual: 60 },
  "accelerated filer": { quarter: 40, annual: 75 },
  "non-accelerated filer": { quarter: 45, annual: 90 },
};
/** The slowest of the three. An unknown category must not tighten the clamp. */
export const DEADLINE_FALLBACK = { quarter: 45, annual: 90 };

export function deadlineDays(category: unknown, annual: boolean): number {
  const key = typeof category === "string" ? category.trim().toLowerCase() : "";
  const row = FILING_DEADLINE_DAYS[key] ?? DEADLINE_FALLBACK;
  return annual ? row.annual : row.quarter;
}

export const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

/**
 * ── ONLY PROMISE A DATE WHERE THE FILER HAS EARNED ONE ────────────────────
 *
 * A median over four wildly different lags is still a number, and rendering it
 * as "expected 12 November" tells a reader something the data does not support.
 * So the estimate is a DISCRIMINATED RESULT and the page renders whichever
 * shape it gets, rather than a number plus a confidence nobody reads.
 */
export type NextReportEstimate =
  | {
      kind: "date";
      date: string;
      medianLagDays: number;
      /** max - min over the last four lags. The regularity that earned a date. */
      spreadDays: number;
      fromEvents: number;
      clamped: boolean;
      timing: ReportTiming | null;
      /** Which of the three produced it — C means the primary had no input. */
      estimator: EstimatorId;
    }
  | {
      kind: "month";
      /** YYYY-MM. The last four lags all land here, but not on one day. */
      month: string;
      spreadDays: number;
      fromEvents: number;
      timing: ReportTiming | null;
    }
  | { kind: "none"; reason: string };

/**
 * How far the last four lags may spread and still earn a specific date.
 *
 * SEVEN DAYS IS A WEEK OF WEEKDAY DRIFT and nothing more. A filer whose period
 * end moves across the week announces a few days earlier or later without
 * changing its habit; one that swings a fortnight has no habit to report.
 */
export const REGULAR_SPREAD_DAYS = 7;
/** Lags are judged over this many of the most recent events. */
export const REGULARITY_WINDOW = 4;

/**
 * Estimate the next announcement from THE FILER'S OWN HABIT, clamped.
 *
 * NOT A FORECAST AND LABELLED AS SUCH WHEREVER IT RENDERS. A median lag over
 * past quarters is a description of a pattern, and a filer is free to break it.
 * `fromEvents` travels with the number so a one-sample "median" cannot be
 * quoted as if it were a habit.
 */
/**
 * ── THREE ESTIMATORS, DECLARED BEFORE THEY WERE MEASURED ──────────────────
 *
 * The first attempt used C alone and lost to a one-line baseline. Rather than
 * tune until something won — which is how a method gets chosen by the noise in
 * one corpus — exactly three candidates were fixed in advance, compared on the
 * same symbols with the same corrected data, and the winner taken by lowest
 * MEAN absolute error with ties going to A as the simplest to explain.
 *
 *   A  this period end + LAST YEAR'S SAME-QUARTER LAG
 *   B  last year's same-quarter announcement + 364 days (preserves weekday)
 *   C  the filer's MEDIAN LAG over every prior announcement
 *
 * A and B differ in what they hold fixed: A holds the gap from period end, B
 * holds the calendar position. They disagree whenever the period end moves
 * relative to the week, which is exactly when a fixed lag drifts.
 */
export type EstimatorId = "A" | "B" | "C";

/** The year-ago announcement for the same fiscal quarter, or null. */
export function sameQuarterLastYear(
  events: readonly ReportEvent[],
  nextPeriodEnd: string
): ReportEvent | null {
  let best: ReportEvent | null = null;
  for (const e of events) {
    if (!e.periodEnd || e.basis !== "8-K item 2.02") continue;
    const gap = daysBetween(e.periodEnd, nextPeriodEnd);
    // A YEAR, GENEROUSLY: a 52/53-week calendar moves the anniversary by a
    // week either way, and a 4-4-5 year can be 371 days.
    if (gap < 330 || gap > 400) continue;
    if (!best || daysBetween(best.periodEnd!, nextPeriodEnd) > gap) best = e;
  }
  return best;
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Run one named estimator. Null when it has no input for this filer. */
export function runEstimator(
  id: EstimatorId,
  events: readonly ReportEvent[],
  nextPeriodEnd: string
): string | null {
  const yearAgo = sameQuarterLastYear(events, nextPeriodEnd);
  if (id === "A") {
    if (!yearAgo) return null;
    return iso(Date.parse(nextPeriodEnd) + daysBetween(yearAgo.periodEnd!, yearAgo.announcedOn) * DAY);
  }
  if (id === "B") {
    if (!yearAgo) return null;
    // 364, NOT 365: fifty-two whole weeks, so the prediction lands on the same
    // weekday the filer used last year. A filer that always reports on a
    // Thursday keeps reporting on a Thursday.
    return iso(Date.parse(yearAgo.announcedOn) + 364 * DAY);
  }
  const lags = events
    .filter((e) => e.periodEnd && e.basis === "8-K item 2.02")
    .map((e) => daysBetween(e.periodEnd!, e.announcedOn))
    .filter((d) => d >= 0 && d <= 200);
  const lag = median(lags);
  return lag === null ? null : iso(Date.parse(nextPeriodEnd) + lag * DAY);
}

/**
 * THE PRIMARY, CHOSEN BY THE RULE AND NOT REVISITED.
 *
 * Set from the measured table (relay run recorded in the commit that changed
 * it). C remains the fallback for a filer with no same-quarter event a year
 * ago, which is the one case A and B cannot answer at all.
 */
export const PRIMARY_ESTIMATOR: EstimatorId = "A";
// MEASURED, relay run 35120730648, 44 SYMBOLS all three could answer:
//   A 1.98d mean · B 2.07d · C 3.27d      (claude/sec-report-dates-2026-09-16.md §4)
// B wins the exact-hit column (26 of 44 against A's 15) and loses the mean. The
// rule was fixed before the run and says MEAN, so A ships and the split is
// recorded rather than used to justify a different choice afterwards.

/**
 * Estimate the next announcement.
 *
 * ── THE CLAMP NEEDS A REAL PERIOD END ────────────────────────────────────
 * The statutory deadline is measured from the fiscal period end. `eventDate` is
 * the announcement, so clamping against it was nonsense in the first version —
 * a deadline measured from the thing being predicted. This takes
 * `nextPeriodEnd`, and the caller may only pass a MATCHED period; where none
 * matched there is no deadline to clamp to and no specific date to offer.
 */
export function estimateNextReport(
  events: readonly ReportEvent[],
  nextPeriodEnd: string | null,
  category: unknown,
  annual = false
): NextReportEstimate {
  // NO PERIOD END, NO DATE. Every one of the three estimators is arithmetic on
  // a period end, and the deadline that caps them is measured from one. Without
  // it there is nothing to add a lag to and nothing to clamp against, so the
  // honest output is silence — not a date computed from the announcement, which
  // is the conflation this whole module exists to keep out.
  if (!nextPeriodEnd) return { kind: "none", reason: "no matched fiscal period end" };
  const usable = events.filter((e) => e.periodEnd && e.basis === "8-K item 2.02");
  const lags = usable
    .map((e) => daysBetween(e.periodEnd!, e.announcedOn))
    .filter((d) => d >= 0 && d <= 200);
  if (lags.length < REGULARITY_WINDOW) {
    return { kind: "none", reason: `only ${lags.length} prior 8-K item 2.02 announcement(s)` };
  }

  const recent = lags.slice(0, REGULARITY_WINDOW);
  const spread = Math.max(...recent) - Math.min(...recent);

  const primary = runEstimator(PRIMARY_ESTIMATOR, usable, nextPeriodEnd);
  const predicted = primary ?? runEstimator("C", usable, nextPeriodEnd);
  if (!predicted) return { kind: "none", reason: "no usable prior announcement" };

  const cap = new Date(Date.parse(nextPeriodEnd) + deadlineDays(category, annual) * DAY);
  const clamped = Date.parse(predicted) > cap.getTime();

  const timings = usable.slice(0, REGULARITY_WINDOW).map((e) => e.timing);
  const timing = timings.length && timings.every((t) => t === timings[0]) ? timings[0] : null;

  if (spread <= REGULAR_SPREAD_DAYS) {
    return {
      kind: "date",
      date: clamped ? cap.toISOString().slice(0, 10) : predicted,
      medianLagDays: median(lags)!,
      spreadDays: spread,
      fromEvents: lags.length,
      clamped,
      timing,
      estimator: primary ? PRIMARY_ESTIMATOR : "C",
    };
  }

  const months = new Set(
    recent.map((d) => iso(Date.parse(nextPeriodEnd) + d * DAY).slice(0, 7))
  );
  if (months.size === 1) {
    return { kind: "month", month: [...months][0], spreadDays: spread, fromEvents: lags.length, timing };
  }
  return { kind: "none", reason: `last ${REGULARITY_WINDOW} lags spread ${spread} days across ${months.size} months` };
}

// ── WHICH SESSION THE MARKET REACTED IN ────────────────────────────────────

/**
 * The trading day whose close reflects the announcement.
 *
 * ── WHY THIS COLLAPSES THREE TIMINGS INTO TWO ─────────────────────────────
 * A release before the open and one at 11:00 are both digested by the SAME
 * day's close. Only an after-close release waits for the next session:
 *
 *   before-open   on D  ->  D
 *   during-market on D  ->  D
 *   after-close   on D  ->  D + 1 trading day
 *
 * AND THAT IS WHY A TIMING MISTAKE IS MOSTLY HARMLESS. The boundary this code
 * can plausibly get wrong is before-open vs during-market — a morning release
 * filed late, and the probe could not resolve how often that happens because
 * NONE of the sampled EX-99.1 exhibits stated a release time. That question is
 * openly unanswered. It does not need answering: both map to the same session.
 * The boundary that WOULD matter, after-close, is the one the timestamps are
 * least ambiguous about — nothing accepted at 20:30Z is a morning release.
 *
 * RETURNS A DATE, NOT AN INDEX. The caller owns the bar series and advances to
 * the next available bar, so a weekend or holiday filing lands on the next
 * session without this needing a market calendar it would only get wrong.
 */
export function reactionDate(event: Pick<ReportEvent, "announcedOn" | "timing">): string {
  if (event.timing !== "after-close") return event.announcedOn;
  return new Date(Date.parse(event.announcedOn) + DAY).toISOString().slice(0, 10);
}

/**
 * How the page describes the timing.
 *
 * IT DESCRIBES THE FILING, NOT THE ANNOUNCEMENT, and the distinction is not
 * pedantry: what this module observes is when a document reached EDGAR, which
 * is at or after the moment the company put the news out. "Reported after
 * close" claims to know the press release time; "filed with the SEC after
 * market close" claims only what the timestamp shows.
 */
/**
 * WHY A REPORT HAS NO PRICE REACTION, said rather than left blank.
 *
 * A bar that is simply absent invites the reader to conclude something about
 * the report — that the market ignored it, or that the company did not file.
 * The true claim is about the PRICE SERIES: it does not reach back that far.
 *
 * MEASURED (relay 35499147949): RYAAY's cached bars begin 2021-09-02 and its
 * FY2021 report is 2021-03-31, so there is no prior close to measure against.
 * CNI has four reports older than its series for the same reason. Before this,
 * those reports either vanished or — worse, when the filing was after-close —
 * borrowed the first bar held and rendered four identical fabricated figures.
 *
 * Same convention as derivationNote and CROSSING_NOTE: name the limit, and
 * make it a statement about the data on file rather than about the filer.
 */
export const NO_PRICE_HISTORY_NOTE =
  "No price history on file before this report, so its market reaction " +
  "cannot be measured. The price series this page holds starts later than " +
  "the report date; the filing itself is unaffected.";

export const TIMING_WORDING: Record<ReportTiming, string> = {
  "before-open": "Results filed with the SEC before market open",
  "during-market": "Results filed with the SEC during market hours",
  "after-close": "Results filed with the SEC after market close",
};

// ── THE PERIOD THE NEXT ANNOUNCEMENT WILL BE ABOUT ────────────────────────

/**
 * Derive the next fiscal period end from the filer's OWN cadence.
 *
 * ── WHY THIS IS NOT "TODAY PLUS NINETY" ──────────────────────────────────
 * A 4-4-5 filer's quarters end on a weekday that moves; a 52/53-week year adds
 * a week every five or six years; AAPL's September quarter is thirteen weeks
 * from the June one and not ninety-one days. The filer's own spacing carries
 * all of that, and nothing else available here does.
 *
 * QUARTERS IF THERE ARE ENOUGH OF THEM, ANNUAL OTHERWISE, never mixed: a set
 * holding both would otherwise produce a median spacing somewhere between a
 * quarter and a year, which describes no filer that exists.
 *
 * Returns null rather than guessing. Null is what `estimateNextReport` needs to
 * say nothing at all — and saying nothing is the correct output for a filer
 * whose stored history is too thin to show a cadence.
 */
export function nextPeriodEndFrom(
  quarterEnds: readonly string[],
  yearEnds: readonly string[]
): { end: string; annual: boolean; stepDays: number } | null {
  const pick = (ends: readonly string[]) => {
    const sorted = [...new Set(ends.filter(Boolean))].sort().reverse();
    if (sorted.length < 3) return null;
    const gaps: number[] = [];
    for (let i = 0; i + 1 < sorted.length; i++) gaps.push(daysBetween(sorted[i + 1], sorted[i]));
    // A SPACING THAT IS NOT A REPORTING PERIOD is a gap in the stored history,
    // not a cadence. Bounded either side so a missing quarter cannot stretch
    // the median into something no filer uses.
    const step = median(gaps.filter((d) => d >= 60 && d <= 400));
    if (step === null) return null;
    return { newest: sorted[0], step };
  };
  const q = pick(quarterEnds);
  const chosen = q ?? pick(yearEnds);
  if (!chosen) return null;
  return {
    end: new Date(Date.parse(chosen.newest) + chosen.step * DAY).toISOString().slice(0, 10),
    annual: !q,
    stepDays: chosen.step,
  };
}

/**
 * THE PERIOD ENDS A RESULTS ANNOUNCEMENT MAY BE MATCHED TO — reader fix V1
 * (#535 COWORK #18 §3, measured in claude/grid-sec-gaps-measured-2026-09-23.md).
 *
 * The stored fact set LAGS: companyfacts carries a quarter once it is filed,
 * and the fact-set re-read queue can run weeks behind. Matched only against
 * the set, a July 2.02 was grouped into Q1 (30 records) or fell outside the
 * 120-day window (19 records) — 49 of 54 stale records. The same submissions
 * payload already names every 10-Q/10-K's period end (`reportDate`), exactly
 * and in the filer's own calendar, so those are added — no extra fetch.
 * Measured: recovers 48 of the 54.
 *
 * V2 (cadence-projected ends) IS DELIBERATELY NOT HERE, though it measured
 * 50 of 54. Its only extra reach is the day a 2.02 lands before its 10-Q, and
 * that day is already `pending` (pendingResults: announced, not yet in the
 * figures), which is what takes MU off the due strip the day after it files.
 * A projected end turned that announcement into an event instead, and MU stayed
 * on the strip (check-due-strip-end-to-end). The grid reads `pending` for it.
 */
export function pairingPeriodEnds(
  quarterEnds: readonly string[],
  yearEnds: readonly string[],
  subs: Submissions,
): Set<string> {
  const ends = new Set<string>([...quarterEnds, ...yearEnds].filter(Boolean));
  for (const end of periodicReportDates(subs).keys()) ends.add(end);
  return ends;
}

/**
 * The same period end, one year on.
 *
 * ── TWO KINDS OF FILER, AND +365 IS WRONG FOR BOTH SOMETIMES ─────────────
 * A calendar filer's quarter ends on the LAST DAY OF A MONTH: 30 September
 * this year, 30 September next, and +365 lands on the 30th only when no leap
 * day intervenes. A 52/53-week filer's quarter ends on a fixed WEEKDAY:
 * AAPL's June quarter ended 2026-06-27, and its successor is 2027-06-26 —
 * 364 days, fifty-two whole weeks, so the weekday is preserved.
 *
 * The two are told apart by the one thing that distinguishes them: whether the
 * date is its month's last day. Nothing else here can, and guessing wrong costs
 * a day or two on every estimate that rolls.
 */
export function periodAnniversary(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  if (d.getUTCDate() === lastDay) {
    const nextLast = new Date(Date.UTC(y + 1, mo + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y + 1, mo, nextLast)).toISOString().slice(0, 10);
  }
  return new Date(d.getTime() + 364 * DAY).toISOString().slice(0, 10);
}

/**
 * A derived period end, corrected to the filer's own calendar.
 *
 * ── WHY A STEPPED DATE IS NOT GOOD ENOUGH ────────────────────────────────
 * Stepping by the median spacing accumulates: two steps of 92 days from a
 * 31 March quarter end lands on 1 October, not 30 September, and everything
 * computed from it inherits every day of that drift. Where the same quarter a
 * year earlier is on file, its anniversary IS the period end — exactly, by the
 * filer's own convention — so the stepped date is used only to FIND it.
 *
 * Returns the stepped date unchanged when no year-ago period is near enough to
 * correct it, which is the honest answer rather than a nearest-match.
 */
export function snapPeriodEnd(events: readonly ReportEvent[], end: string): string {
  let best: string | null = null;
  for (const e of events) {
    if (!e.periodEnd) continue;
    const cand = periodAnniversary(e.periodEnd);
    const off = Math.abs(daysBetween(cand, end));
    if (off > 20) continue;
    if (!best || off < Math.abs(daysBetween(best, end))) best = cand;
  }
  return best ?? end;
}

/**
 * The next announcement that HAS NOT HAPPENED YET.
 *
 * ── THE DEFECT THIS EXISTS FOR ────────────────────────────────────────────
 * The first wiring rendered "Next expected earnings date: 2026-07-18" on a page
 * read in September. It was not a bad estimate — it was a correct estimate for
 * a quarter already reported. The stored fact set lags the filings by design:
 * companyfacts carries a period once it is FILED, so a filer that has announced
 * Q3 but not yet filed its 10-Q has a fact set ending at Q2, and one cadence
 * step past Q2 is a date in the past.
 *
 * A date in the past under the heading "next expected" is worse than no date.
 * Nothing about it fails, and a reader has no way to tell it from a date the
 * company missed.
 *
 * SO IT ROLLS FORWARD, one cadence step at a time, until the estimate lands on
 * or after `today` — and stops after a bounded number of steps rather than
 * looping, because an unbounded roll on a filer with a strange cadence is a
 * hang on a page render.
 *
 * `today` IS PASSED IN, never read from the clock here: this runs in the cron,
 * in the seeder and in checks, and a function that reads the clock cannot be
 * given a date to test against.
 */
export function estimateUpcoming(
  events: readonly ReportEvent[],
  cadence: { end: string; annual: boolean; stepDays: number } | null,
  category: unknown,
  today: string
): { estimate: NextReportEstimate; periodEnd: string | null } {
  if (!cadence) {
    return { estimate: estimateNextReport(events, null, category, false), periodEnd: null };
  }
  // NOT PAST TODAY ALONE. A filer that announced yesterday should be estimated
  // for its NEXT quarter, not shown yesterday's date as if it were upcoming.
  const floor = events[0]?.announcedOn && events[0].announcedOn > today ? events[0].announcedOn : today;
  const snap = (end: string) => snapPeriodEnd(events, end);
  let end = snap(cadence.end);
  let estimate = estimateNextReport(events, end, category, cadence.annual);
  for (let i = 0; i < 8; i++) {
    if (estimate.kind !== "date" || estimate.date >= floor) break;
    end = snap(new Date(Date.parse(end) + cadence.stepDays * DAY).toISOString().slice(0, 10));
    estimate = estimateNextReport(events, end, category, cadence.annual);
  }
  // A MONTH THAT HAS PASSED IS THE SAME MISTAKE IN A COARSER UNIT.
  if (estimate.kind === "month" && estimate.month < today.slice(0, 7)) {
    return { estimate: { kind: "none", reason: "the estimated month has already passed" }, periodEnd: end };
  }
  if (estimate.kind === "date" && estimate.date < floor) {
    return { estimate: { kind: "none", reason: "no upcoming date within eight periods" }, periodEnd: end };
  }
  return { estimate, periodEnd: end };
}

// ── LABELLING THE REACTION BARS ────────────────────────────────────────────

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * What a bar is called when its fiscal period is NOT known.
 *
 * ── WHY THIS IS NOT A QUARTER ────────────────────────────────────────────
 * The fallback path has an announcement date and nothing else, and a quarter
 * derived from one is a different quarter from the one being reported on. That
 * is what put "Q3 26" on a quarter that had not ended and the same "Q4 23" on
 * two different bars: an announcement names the quarter it FALLS IN, and two
 * announcements can fall in one. So it says only what it knows.
 */
export function reportedLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return `Reported ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * One label per bar, in the page's own fiscal vocabulary, all distinct.
 *
 * ── THE THREE DEFECTS THIS REPLACES, ALL VISIBLE ON ONE PREVIEW ──────────
 *   AAPL's latest bar read "Q2 26" while the snapshot called the same filing
 *   Q3 FY2026 — two vocabularies for one filing on one page.
 *   AAP carried "Q4 23" TWICE, because two of its announcements fell in the
 *   same calendar quarter.
 *   AAP and ABEV showed "Q3 26" for a quarter that had not ended.
 *
 * All three come from labelling a bar by the calendar quarter of its
 * ANNOUNCEMENT. The fix is to take the label from the SAME stored period the
 * rest of the page reads, by the matched period end — and where there is no
 * matched period, to make no fiscal claim at all.
 *
 * `labelFor` is passed in rather than imported: the stored labels live in the
 * fact set, this module knows nothing about fact sets, and a second copy of the
 * labeller here is exactly the drift that produced two vocabularies.
 *
 * DISTINCTNESS IS ENFORCED, NOT ASSUMED. Matched periods are unique because
 * `reportEvents` keeps one event per period — but the fallback path has no such
 * guarantee, and two announcements in one month would collide. A collision
 * takes the day as well, because a chart with two bars named the same thing
 * cannot be read at all.
 */
export function reactionBarLabels(
  rows: readonly { periodEnd: string | null; announcedOn: string }[],
  labelFor: (periodEnd: string) => string | undefined
): string[] {
  const out = rows.map((r) =>
    (r.periodEnd ? labelFor(r.periodEnd) : undefined) ?? reportedLabel(r.announcedOn)
  );
  const seen = new Map<string, number>();
  for (const l of out) seen.set(l, (seen.get(l) ?? 0) + 1);
  return out.map((l, i) =>
    (seen.get(l) ?? 0) > 1 ? `${l} (${rows[i].announcedOn.slice(5).replace("-", "/")})` : l
  );
}

// ── ANNOUNCED, BUT NOT YET IN THE DATA FEED ────────────────────────────────

/**
 * The newest Item 2.02 announcement, WITHOUT any period matching.
 *
 * ── WHY THIS IS SEPARATE FROM `reportEvents` ─────────────────────────────
 * `reportEvents` exists to place an announcement on a period the store holds,
 * and it is right to discard one it cannot place: an unplaceable event has no
 * lag, no label and no bar. But "cannot place" is itself a fact worth keeping —
 * it is what ABT's page needed and did not have.
 *
 * ABT announced its June quarter on 16 July 2026 and filed the 10-Q on 28 July.
 * Seven weeks later SEC's companyfacts still carried no frame ending
 * 2026-06-30 — measured, all tags, no filter — so the store's newest period was
 * 31 March and the page said "Most recent quarter filed: Q1 FY2026". Correct,
 * and a reader who knows ABT reported in July reads it as broken.
 *
 * Inside `reportEvents` the July filing lands on 31 March (the newest stored
 * end within the window) and then loses the dedupe to the real Q1 announcement
 * of 16 April, which is the correct outcome for a bar and the wrong one for a
 * notice. Hence a second, deliberately simpler reader.
 */
export function latestResultsAnnouncement(subs: Submissions): ReportEvent | null {
  const recent = subs?.filings?.recent;
  if (!recent) return null;
  const n = Array.isArray(recent.accessionNumber) ? recent.accessionNumber.length : 0;
  let best: ReportEvent | null = null;
  for (let i = 0; i < n; i++) {
    const form = str(recent.form?.[i]);
    // 8-K ONLY, AND THE ORIGINAL, NOT AN AMENDMENT. A 6-K carries no item codes
    // and is selected positionally, which is too weak to hang a claim about a
    // specific quarter on; an 8-K/A re-announces a period already announced.
    if (form !== "8-K") continue;
    if (!hasResultsItem(str(recent.items?.[i]))) continue;
    const accepted = parseAcceptanceEt(recent.acceptanceDateTime?.[i]);
    if (!accepted) continue;
    if (best && accepted.date <= best.announcedOn) continue;
    best = {
      eventDate: str(recent.reportDate?.[i]),
      periodEnd: null,
      announcedOn: accepted.date,
      announcedAt: accepted.time,
      timing: timingFor(accepted.minutes),
      form,
      items: str(recent.items?.[i]),
      accession: str(recent.accessionNumber?.[i]) ?? "",
      basis: "8-K item 2.02",
    };
  }
  return best;
}

/** A results release the SEC's data feed has not caught up with. */
export type PendingResults = {
  /** The quarter the announcement is about, derived from the filer's cadence. */
  periodEnd: string;
  announcedOn: string;
  timing: ReportTiming;
};

/**
 * Has the filer announced a quarter the stored figures do not contain yet?
 *
 * ── THE TEST IS AN ORDERING, NOT A WINDOW ────────────────────────────────
 * A results 8-K newer than the one already placed on the newest stored period
 * must be about a LATER period — there is no third possibility, because
 * `reportEvents` keeps the earliest announcement per period and a filer does
 * not announce the same quarter twice on an 8-K. So the comparison is between
 * two announcement dates and needs no plausible-lag window to guess with.
 *
 * ONE EXCEPTION, AND THE PAIRING IS WHAT FINDS IT: a filer with a second,
 * EARLY Item 2.02 each quarter (TSLA's deliveries) does file two for one
 * quarter. For past quarters the 10-Q tells them apart; for the current one
 * `pattern` does -- see the guard at the bottom.
 *
 * ── AND THE PERIOD IS NAMED ONLY IF IT CAN BE DERIVED ────────────────────
 * The notice says which quarter, so a quarter has to be known. It comes from
 * the filer's own cadence, snapped to the anniversary of the same quarter a
 * year earlier — the same arithmetic the next-date estimate uses, which was
 * measured at a mean error under two days. Where the cadence cannot be read,
 * this returns null and the page says nothing rather than naming a quarter it
 * inferred loosely.
 *
 * `today` is passed in, never read from the clock: an announcement filed today
 * is excluded because companyfacts was never going to have it yet, and a rule
 * about "today" cannot be tested by a function that decides what today is.
 */
export function pendingResults(
  placed: readonly ReportEvent[],
  latest: ReportEvent | null,
  cadence: { end: string; annual: boolean; stepDays: number } | null,
  today: string,
  pattern: EarlyNonResultsPattern | null = null
): PendingResults | null {
  if (!latest || !cadence) return null;
  const newestPlaced = placed.find((e) => e.periodEnd && e.basis === "8-K item 2.02");
  if (!newestPlaced) return null;
  // NOT NEWER THAN WHAT IS ALREADY ON THE PAGE: nothing is pending.
  if (latest.announcedOn <= newestPlaced.announcedOn) return null;
  // FILED TODAY IS NOT A LAG. companyfacts was never going to carry it yet, and
  // a notice saying so on the afternoon of the release is noise.
  if (latest.announcedOn >= today) return null;
  const periodEnd = snapPeriodEnd(placed, cadence.end);
  // THE DERIVED PERIOD MUST ACTUALLY BE LATER than the one on the page, and
  // must already have ENDED — a quarter that has not finished cannot have been
  // reported, and naming one would be worse than saying nothing.
  if (periodEnd <= newestPlaced.periodEnd! || periodEnd > today) return null;
  // ── THE CURRENT PERIOD HAS NO 10-Q TO PAIR AGAINST, SO THE PAST DECIDES ─
  // A filer whose past quarters show an early non-results 2.02 (TSLA's
  // delivery numbers) files one again two days into this quarter, and without
  // this it would be announced here as the quarter's results. Judged by the
  // filer's own two habits, not a day count -- see looksLikeEarlyNonResults.
  if (looksLikeEarlyNonResults(daysBetween(periodEnd, latest.announcedOn), pattern)) return null;
  return { periodEnd, announcedOn: latest.announcedOn, timing: latest.timing };
}
