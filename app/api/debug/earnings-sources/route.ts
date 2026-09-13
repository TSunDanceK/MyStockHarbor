import { guardDebugRequest } from "@/lib/server/backfillAuth";
import { createInflateRaw } from "node:zlib";
import { Readable } from "node:stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Debug-only probe: can a Vercel function reach the candidate earnings-data
// sources, and what do they actually return, field by field?
//
// WHY IT EXISTS
// -------------
// Same reason as the news-sources probe next door: the IP the request comes
// from is the part that matters. SEC and Stooq both treat datacentre ranges
// differently from residential ones, and run 1 of the news probe proved the
// point -- every Nasdaq feed timed out from iad1 while answering fine
// elsewhere. An answer obtained anywhere else is not evidence about this site.
//
// WHAT THE BRIEF ASKED FOR, AND THE ONE PREMISE THAT IS ALREADY CONTRADICTED
// -------------------------------------------------------------------------
// Section 5 was briefed as "already probed for Pickers -- re-confirm only".
// It is not a re-confirmation. claude/stooq-inaccessible-sec-viable-2026-09-12.md
// measured Stooq at 0 of 6 endpoints from a GitHub Actions runner: a JavaScript
// browser-verification interstitial on every per-symbol CSV path and on the site
// root, and HTTP 401 on the bulk archive. So the expected result here is a
// FAIL, and what this probe actually tests is narrower and worth testing:
// whether Vercel's egress IP is treated differently from a GitHub runner's.
// Either answer is information; the point is that "re-confirm the bars exist"
// is not the question the evidence supports asking.
//
// THE CSV PARSE IS STRICT ON PURPOSE. That same run is why: the strict header
// check is the only reason the challenge page was ever noticed, because a
// lenient parser reads HTML as prices and produces ratios from noise.
//
// SECTIONS ARE SEPARATELY INVOCABLE, WHICH IS NOT COSMETIC
// -------------------------------------------------------
// The five sections have wildly different costs and failure modes, and running
// them together would make the cheap ones hostage to the expensive ones:
//
//   sec-facts / sec-submissions / stooq   free, fast, idempotent  -> DEFAULT
//   datasets                              a multi-hundred-MB ZIP  -> opt in
//   av                                    DESTROYS the day's quota -> opt in
//
// Alpha Vantage's free tier is 25 requests/day. Section 4 is designed to spend
// most of one day's allowance and then deliberately overrun it to capture the
// limit body. If that ran by default, every re-run of the *free* SEC sections
// would burn a day of Alpha Vantage, and the sections that can be iterated on
// would become the ones that cannot. And a `datasets` run that exhausts
// maxDuration would take sections 1, 2 and 5 down with it for no reason.
//
// DELIBERATELY INERT
// ------------------
// No Redis reads or writes, no FMP calls, no cache population, no new npm
// package -- the ZIP central directory and DEFLATE streams are handled with
// node:zlib and node:stream, both builtins, so the lockfile is untouched.
//
// See README.md in this folder. SAFE TO DELETE once the adapter lands.

const SEC_UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (CONTACT-NOT-SET)";
const AV_KEY = process.env.ALPHAVANTAGE_API_KEY || "";

const DEFAULT_SYMBOLS = ["ARM", "AAPL", "MU", "PLAB", "ASTS"];

// ---------------------------------------------------------------------------
// Concepts
// ---------------------------------------------------------------------------

// DURATION vs INSTANT is not a stylistic split, and getting it wrong would
// manufacture the exact wrong answer.
//
// A duration fact carries start+end and is measured by the span between them.
// An instant fact -- every balance-sheet line here -- carries ONLY `end`.
// Measuring "quarterly frames" on an instant concept by looking for an 80-100
// day span finds zero, every time, for every filer. That would report the five
// balance-sheet concepts as having no quarterly depth and put them on the hide
// list, when in truth they are reported every quarter. The classification is
// what makes the depth number mean the same thing across the whole list.
type ConceptKind = "duration" | "instant";

type Concept = { tag: string; kind: ConceptKind };

const BRIEFED_CONCEPTS: Concept[] = [
  { tag: "Revenues", kind: "duration" },
  { tag: "RevenueFromContractWithCustomerExcludingAssessedTax", kind: "duration" },
  { tag: "CostOfRevenue", kind: "duration" },
  { tag: "GrossProfit", kind: "duration" },
  { tag: "ResearchAndDevelopmentExpense", kind: "duration" },
  { tag: "SellingGeneralAndAdministrativeExpense", kind: "duration" },
  { tag: "OperatingIncomeLoss", kind: "duration" },
  // The brief wrote this one with an ellipsis. There are TWO real us-gaap tags
  // it could mean and filers genuinely split between them, so both are probed
  // and reported rather than one being guessed at.
  {
    tag: "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
    kind: "duration",
  },
  {
    tag: "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
    kind: "duration",
  },
  { tag: "IncomeTaxExpenseBenefit", kind: "duration" },
  { tag: "NetIncomeLoss", kind: "duration" },
  { tag: "EarningsPerShareDiluted", kind: "duration" },
  { tag: "WeightedAverageNumberOfDilutedSharesOutstanding", kind: "duration" },
  { tag: "NetCashProvidedByUsedInOperatingActivities", kind: "duration" },
  { tag: "PaymentsToAcquirePropertyPlantAndEquipment", kind: "duration" },
  { tag: "ShareBasedCompensation", kind: "duration" },
  { tag: "CashAndCashEquivalentsAtCarryingValue", kind: "instant" },
  { tag: "ShortTermInvestments", kind: "instant" },
  { tag: "AssetsCurrent", kind: "instant" },
  { tag: "LiabilitiesCurrent", kind: "instant" },
  { tag: "LongTermDebtNoncurrent", kind: "instant" },
];

// A MISSING TAG IS NOT THE SAME AS A MISSING NUMBER, and conflating them is how
// a hide list ends up hiding a column the data actually supports. us-gaap has
// several near-synonyms per line item and filers pick between them freely. So
// the briefed list above is reported exactly as briefed -- it is the answer to
// the question asked -- and these are reported SEPARATELY, so a tag that is
// absent while its alternate is populated reads as "different spelling", not
// as "no data".
const ALTERNATES: Record<string, Concept[]> = {
  Revenues: [
    { tag: "RevenueFromContractWithCustomerIncludingAssessedTax", kind: "duration" },
    { tag: "SalesRevenueNet", kind: "duration" },
  ],
  CostOfRevenue: [
    { tag: "CostOfGoodsAndServicesSold", kind: "duration" },
    { tag: "CostOfGoodsSold", kind: "duration" },
  ],
  ShortTermInvestments: [
    { tag: "MarketableSecuritiesCurrent", kind: "instant" },
    { tag: "AvailableForSaleSecuritiesDebtSecuritiesCurrent", kind: "instant" },
  ],
  LongTermDebtNoncurrent: [
    { tag: "LongTermDebtAndCapitalLeaseObligations", kind: "instant" },
    { tag: "LongTermDebt", kind: "instant" },
  ],
  CashAndCashEquivalentsAtCarryingValue: [
    {
      tag: "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
      kind: "instant",
    },
  ],
};

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

type RawFetch = {
  status: number;
  contentType: string;
  contentLength: string | null;
  acceptRanges: string | null;
  body: string;
  bytes: number;
  ms: number;
};

function secHeaders(): Record<string, string> {
  return {
    "user-agent": SEC_UA,
    "accept-encoding": "gzip, deflate",
    accept: "application/json,text/plain,*/*",
  };
}

async function timedFetch(
  url: string,
  ms: number,
  headers: Record<string, string>
): Promise<RawFetch> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store", headers });
    const body = await res.text();
    return {
      status: res.status,
      contentType: (res.headers.get("content-type") ?? "").split(";")[0],
      contentLength: res.headers.get("content-length"),
      acceptRanges: res.headers.get("accept-ranges"),
      body,
      bytes: Buffer.byteLength(body),
      ms: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

function describeError(err: unknown, timeoutMs: number): string {
  const e = err as Error;
  return e?.name === "AbortError"
    ? `timeout after ${timeoutMs / 1000}s`
    : `${e?.name ?? "Error"}: ${e?.message ?? String(err)}`;
}

// ---------------------------------------------------------------------------
// CIK resolution
// ---------------------------------------------------------------------------

// RESOLVED AT RUNTIME, NEVER HARDCODED. A CIK typed from memory is
// claude/traps/inference-about-a-source-you-cannot-open.md in miniature: the
// probe would fetch a real 200 for the wrong company and report its fields as
// the symbol's. The resolved CIK is echoed per symbol so the mapping is
// checkable rather than assumed, and a symbol SEC does not list is reported as
// unresolved rather than silently dropped.
type CikMap = { map: Record<string, { cik: string; title: string }>; diag: Record<string, unknown> };

async function resolveCiks(symbols: string[]): Promise<CikMap> {
  const url = "https://www.sec.gov/files/company_tickers.json";
  const timeoutMs = 30000;
  try {
    const r = await timedFetch(url, timeoutMs, secHeaders());
    if (r.status !== 200) {
      return {
        map: {},
        diag: { url, status: r.status, ms: r.ms, bytes: r.bytes, ok: false, bodyHead: r.body.slice(0, 300) },
      };
    }
    const parsed = JSON.parse(r.body) as Record<string, { cik_str: number; ticker: string; title: string }>;
    const byTicker: Record<string, { cik: string; title: string }> = {};
    for (const row of Object.values(parsed)) {
      if (!row?.ticker) continue;
      byTicker[row.ticker.toUpperCase()] = {
        cik: String(row.cik_str).padStart(10, "0"),
        title: row.title,
      };
    }
    const map: Record<string, { cik: string; title: string }> = {};
    for (const s of symbols) if (byTicker[s]) map[s] = byTicker[s];
    return {
      map,
      diag: {
        url,
        status: r.status,
        ms: r.ms,
        bytes: r.bytes,
        ok: true,
        tickersInMap: Object.keys(byTicker).length,
        resolved: Object.fromEntries(symbols.map((s) => [s, map[s]?.cik ?? null])),
        unresolved: symbols.filter((s) => !map[s]),
      },
    };
  } catch (err) {
    return { map: {}, diag: { url, ok: false, error: describeError(err, timeoutMs) } };
  }
}

// ---------------------------------------------------------------------------
// 1. SEC companyfacts
// ---------------------------------------------------------------------------

type Fact = {
  start?: string;
  end?: string;
  val?: number;
  accn?: string;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
  frame?: string;
};

type ConceptReport = {
  tag: string;
  kind: ConceptKind;
  status: "present" | "absent";
  units?: string[];
  factRows?: number;
  distinctPeriods?: number;
  quarterlyPeriodsIn8q?: number;
  annualPeriods?: number;
  nineMonthPeriods?: number;
  sixMonthPeriods?: number;
  otherSpanPeriods?: number;
  latestPeriodEnd?: string | null;
  forms?: string[];
  verdict?: "quarterly" | "annual-only" | "sparse" | "absent";
};

const DAY = 86400000;

function spanDays(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / DAY);
}

// Analyse ONE concept's fact array. Everything here is about not letting a
// restatement inflate a depth count and not letting an annual filer look like a
// quarterly one.
function analyseConcept(
  concept: Concept,
  unitsObj: Record<string, Fact[]> | undefined,
  cutoffMs: number
): ConceptReport {
  if (!unitsObj) return { tag: concept.tag, kind: concept.kind, status: "absent", verdict: "absent" };

  const unitNames = Object.keys(unitsObj);
  const rows: Fact[] = unitNames.flatMap((u) => unitsObj[u] ?? []);
  if (!rows.length) {
    // Present as a key but carrying nothing. Reported as absent for the hide
    // decision, because an empty concept supports a column exactly as well as a
    // missing one does -- but the units list is kept so the two are told apart.
    return {
      tag: concept.tag,
      kind: concept.kind,
      status: "absent",
      units: unitNames,
      factRows: 0,
      verdict: "absent",
    };
  }

  // DEDUPE BEFORE COUNTING. companyfacts republishes the same period from every
  // filing that restated it, so AAPL's Q1 revenue appears many times over with
  // different `accn`/`fy`/`fp`. Counting rows would report a depth several times
  // the real one -- an answer that looks better the more a filer restates.
  const periods = new Map<string, Fact>();
  for (const f of rows) {
    if (!f.end) continue;
    const key = concept.kind === "instant" ? f.end : `${f.start ?? ""}|${f.end}`;
    if (!periods.has(key)) periods.set(key, f);
  }

  const forms = [...new Set(rows.map((f) => f.form).filter((x): x is string => Boolean(x)))].sort();
  const ends = [...periods.values()]
    .map((f) => f.end as string)
    .sort();
  const latestPeriodEnd = ends.length ? ends[ends.length - 1] : null;

  if (concept.kind === "instant") {
    // For a balance-sheet concept, one distinct `end` IS one observation. Depth
    // is how many of those land inside the last eight quarters.
    const inWindow = [...periods.values()].filter((f) => Date.parse(f.end as string) >= cutoffMs);
    return {
      tag: concept.tag,
      kind: concept.kind,
      status: "present",
      units: unitNames,
      factRows: rows.length,
      distinctPeriods: periods.size,
      quarterlyPeriodsIn8q: inWindow.length,
      latestPeriodEnd,
      forms,
      verdict: inWindow.length >= 6 ? "quarterly" : inWindow.length > 0 ? "sparse" : "annual-only",
    };
  }

  let quarterly = 0;
  let annual = 0;
  let nineMonth = 0;
  let sixMonth = 0;
  let other = 0;
  for (const f of periods.values()) {
    if (!f.start || !f.end) {
      other++;
      continue;
    }
    const d = spanDays(f.start, f.end);
    const inWindow = Date.parse(f.end) >= cutoffMs;
    if (d >= 80 && d <= 100) {
      if (inWindow) quarterly++;
    } else if (d >= 350 && d <= 380) annual++;
    else if (d >= 260 && d <= 290) nineMonth++;
    else if (d >= 170 && d <= 200) sixMonth++;
    else other++;
  }

  // THE XOM CASE IS WHY THIS IS THREE VERDICTS AND NOT A BOOLEAN.
  // claude/stooq-inaccessible-sec-viable-2026-09-12.md found XOM files diluted
  // EPS almost entirely in annual frames -- the concept is there, the number is
  // there, and there is still no quarterly series to build a column from. That
  // is a different fact about a different remedy (derive Q4 from FY minus 9M)
  // than "the filer does not report this at all", so it gets its own verdict
  // rather than being folded into either neighbour.
  const verdict: ConceptReport["verdict"] =
    quarterly >= 6 ? "quarterly" : quarterly > 0 ? "sparse" : annual > 0 ? "annual-only" : "sparse";

  return {
    tag: concept.tag,
    kind: concept.kind,
    status: "present",
    units: unitNames,
    factRows: rows.length,
    distinctPeriods: periods.size,
    quarterlyPeriodsIn8q: quarterly,
    annualPeriods: annual,
    nineMonthPeriods: nineMonth,
    sixMonthPeriods: sixMonth,
    otherSpanPeriods: other,
    latestPeriodEnd,
    forms,
    verdict,
  };
}

async function probeCompanyFacts(symbol: string, cik: string, cutoffMs: number) {
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
  const timeoutMs = 60000;
  try {
    const r = await timedFetch(url, timeoutMs, secHeaders());
    const common = {
      symbol,
      cik,
      url,
      status: r.status,
      contentType: r.contentType,
      wireBytes: r.contentLength ? Number(r.contentLength) : null,
      parsedBytes: r.bytes,
      ms: r.ms,
    };
    if (r.status !== 200) {
      // FETCH FAILURE IS NOT ABSENCE, and this branch is the whole reason the
      // distinction is enforced here rather than at the call site. The brief
      // says the missing list IS the hide list. A 403 that returned a concept
      // report would put all 21 concepts on it and hide every column on the
      // strength of a bad User-Agent.
      return { ...common, ok: false, reason: `HTTP ${r.status}`, bodyHead: r.body.slice(0, 300), concepts: null };
    }

    const data = JSON.parse(r.body) as {
      entityName?: string;
      facts?: Record<string, Record<string, { units?: Record<string, Fact[]> }>>;
    };
    const gaap = data.facts?.["us-gaap"] ?? {};
    const ifrs = data.facts?.["ifrs-full"] ?? {};

    const concepts = BRIEFED_CONCEPTS.map((c) => analyseConcept(c, gaap[c.tag]?.units, cutoffMs));

    const alternates: Record<string, ConceptReport[]> = {};
    for (const [primary, alts] of Object.entries(ALTERNATES)) {
      const reports = alts
        .map((a) => analyseConcept(a, gaap[a.tag]?.units, cutoffMs))
        .filter((r) => r.status === "present");
      if (reports.length) alternates[primary] = reports;
    }

    // AN IFRS FILER HAS NO us-gaap TAGS AT ALL, and without this the output
    // would report all 21 concepts absent and hand back a hide list covering
    // every column -- the same wrong answer as the HTTP-failure branch above,
    // arriving by a different route. A foreign private issuer filing 20-F under
    // ifrs-full is a taxonomy mismatch, not missing data.
    const taxonomyMismatch = Object.keys(gaap).length === 0 && Object.keys(ifrs).length > 0;

    const missing = concepts.filter((c) => c.status === "absent").map((c) => c.tag);
    const presentButNotQuarterly = concepts
      .filter((c) => c.status === "present" && c.verdict !== "quarterly")
      .map((c) => `${c.tag} (${c.verdict}, ${c.quarterlyPeriodsIn8q ?? 0}q in window)`);

    // A tag on the missing list whose alternate IS populated is a spelling
    // difference, not an absent number. Split out so the hide list is not
    // padded with columns the data supports under another name.
    const coveredByAlternate = missing.filter((tag) => (alternates[tag]?.length ?? 0) > 0);

    return {
      ...common,
      ok: true,
      entityName: data.entityName ?? null,
      taxonomies: Object.keys(data.facts ?? {}),
      ifrsConceptCount: Object.keys(ifrs).length,
      gaapConceptCount: Object.keys(gaap).length,
      concepts,
      alternates,
      // The three lists the brief actually asked for, pre-separated.
      taxonomyMismatch,
      taxonomyWarning: taxonomyMismatch
        ? `${symbol} publishes NO us-gaap facts -- ${Object.keys(ifrs).length} ifrs-full concepts instead. The concept list below is absent by taxonomy, not by omission, and trueHideList is suppressed because every tag would be on it for the wrong reason.`
        : null,
      missingOrEmpty: missing,
      missingButAlternateExists: coveredByAlternate,
      trueHideList: taxonomyMismatch ? null : missing.filter((t) => !coveredByAlternate.includes(t)),
      presentButNotQuarterly,
    };
  } catch (err) {
    return { symbol, cik, url, ok: false, reason: describeError(err, timeoutMs), concepts: null };
  }
}

// ---------------------------------------------------------------------------
// 2. SEC submissions -- and settling the acceptanceDateTime timezone by
//    measurement rather than by reading the field name
// ---------------------------------------------------------------------------

type Recent = Record<string, unknown[]>;

// THE TIMEZONE QUESTION IS THE WHOLE POINT OF THIS SECTION, because the
// price-reaction card is built on before-open vs after-close and a four- or
// five-hour error flips that classification for most of the filings that matter.
//
// The field arrives looking like `2026-08-05T20:31:22.000Z`. The trailing Z
// asserts UTC. Asserting is not evidence, and the direction of the error is
// asymmetric: reading an ET stamp as UTC moves every filing four or five hours
// EARLIER, which turns after-close filings into during-session ones.
//
// So it is measured two independent ways, neither of which trusts the suffix:
//
//   1. HOUR HISTOGRAM. Filings are accepted by people during business hours.
//      EDGAR accepts submissions 06:00-22:00 ET. Read at face value, a true-UTC
//      stamp puts that window at 10:00-02:00 UTC and clusters the mass in the
//      afternoon/evening; an ET stamp mislabelled Z clusters it in the morning
//      and afternoon. The shape of the distribution is the tell.
//
//   2. THE 17:30 RULE, which is decisive rather than suggestive. EDGAR assigns
//      the NEXT business day as filingDate to anything accepted after 17:30 ET.
//      So filingDate != the date part of acceptanceDateTime is an observable
//      event with a known cause at a known clock time. Find the hour at which
//      that rollover starts happening: if it starts at 17-18 read at face
//      value, the string is ET. If it starts at 21-22, the string is UTC and
//      the offset is the difference. This does not depend on any assumption
//      about when people like to file.
//
// Both are reported with their raw counts so the conclusion is checkable rather
// than taken on trust.
function analyseAcceptance(rows: { form: string; filingDate: string; acceptance: string }[]) {
  const populated = rows.filter((r) => Boolean(r.acceptance));
  if (!populated.length) {
    return {
      populated: 0,
      total: rows.length,
      verdict: "acceptanceDateTime is EMPTY on every row -- before/after-close cannot be derived",
    };
  }

  const hourHistogram: Record<string, number> = {};
  // hour -> { same, next } filingDate-vs-acceptanceDate outcomes
  const rollover: Record<string, { sameDay: number; laterDay: number }> = {};
  let suffixZ = 0;
  let suffixOffset = 0;
  let suffixNone = 0;

  for (const r of populated) {
    const raw = r.acceptance;
    if (/Z$/.test(raw)) suffixZ++;
    else if (/[+-]\d{2}:?\d{2}$/.test(raw)) suffixOffset++;
    else suffixNone++;

    // Read the clock fields VERBATIM out of the string. Date.parse() would apply
    // the Z and hand back a shifted hour, which is precisely the assumption
    // under test -- so the number being measured must not pass through it.
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (!m) continue;
    const [, y, mo, d, hh] = m;
    const hourKey = hh;
    hourHistogram[hourKey] = (hourHistogram[hourKey] ?? 0) + 1;

    const acceptanceDate = `${y}-${mo}-${d}`;
    const bucket = (rollover[hourKey] ??= { sameDay: 0, laterDay: 0 });
    if (r.filingDate === acceptanceDate) bucket.sameDay++;
    else if (r.filingDate > acceptanceDate) bucket.laterDay++;
    // filingDate EARLIER than the acceptance date would be nonsense; it is
    // counted nowhere rather than being quietly folded into one of the two.
  }

  // INFERRING THE OFFSET BY FITTING, NOT BY SCANNING FOR THE FIRST ROLLOVER
  // HOUR. A first-match scan was the obvious implementation and it was wrong
  // twice over, both caught by feeding the analyser data whose answer was known:
  //
  //   1. Hour 17 ET is MIXED, not rolled over. The cutoff is 17:30, so 17:00-17:29
  //      files same-day and 17:30-17:59 files next-day. Anchoring the scan to 17
  //      read a true-Eastern stamp as ET+1.
  //   2. Hours sort as strings, and the late-filing window CROSSES MIDNIGHT once
  //      an offset is applied. For a genuine UTC stamp the late filings land at
  //      22:00, 23:00 and 00:00-next-day, and an ascending scan hits "00" first
  //      and reported a 17-hour offset.
  //
  // So instead: for every candidate offset 0-23, map each face-value hour back to
  // a hypothetical Eastern hour and score how well the OBSERVED rollovers match
  // EDGAR's known rule. Wraparound is handled by the modulo, and no single hour
  // decides the answer. Hour 17 is excluded from scoring because it is genuinely
  // ambiguous, and hours 00-05 because they fall outside EDGAR's 06:00-22:00 ET
  // acceptance window and carry no signal.
  const scored = [];
  for (let offset = 0; offset < 24; offset++) {
    let agree = 0;
    let considered = 0;
    for (const [h, b] of Object.entries(rollover)) {
      const etHour = (Number(h) - offset + 24) % 24;
      if (etHour === 17 || etHour < 6) continue;
      const expectRollover = etHour >= 18;
      considered += b.sameDay + b.laterDay;
      agree += expectRollover ? b.laterDay : b.sameDay;
    }
    if (considered > 0) scored.push({ offset, agreement: agree / considered, considered });
  }
  // TIES BREAK TOWARD THE CANDIDATE WITH MORE EVIDENCE, not the lower offset.
  // Excluding ET hour 17 and 00-05 means each candidate offset excludes a
  // DIFFERENT set of rows, so a candidate can reach 1.0 agreement simply by
  // scoring fewer filings. Ordering by offset broke a genuine 4h tie toward 3h
  // and reported "neither Eastern nor UTC" for clean UTC data.
  scored.sort(
    (a, b) => b.agreement - a.agreement || b.considered - a.considered || a.offset - b.offset
  );
  const best = scored[0] ?? null;
  const runnerUp = scored.find((c) => c.offset !== best?.offset) ?? null;
  const tiedWith = best
    ? scored.filter((c) => c.offset !== best.offset && Math.abs(c.agreement - best.agreement) < 1e-9).map((c) => c.offset)
    : [];

  // THE ROLLOVER IS THE ONLY DISCRIMINATOR, so if it never fired there is no
  // evidence at all -- every offset that keeps the daytime filings in daytime
  // scores 1.0 and the winner is arbitrary. A filing set with no late filings
  // must say so rather than confidently returning whichever offset sorted first.
  const totalLater = Object.values(rollover).reduce((n, b) => n + b.laterDay, 0);

  let inferred: string;
  if (totalLater < 5) {
    inferred = `INDETERMINATE -- only ${totalLater} filing(s) in this sample have a filingDate later than their acceptance date. The 17:30 ET cutoff is the only thing that distinguishes the hypotheses and it has barely fired here, so every offset fits equally well. Widen the sample before classifying anything.`;
  } else if (!best || best.considered < 20) {
    inferred = `INDETERMINATE -- only ${best?.considered ?? 0} filings fall in a scoreable hour. Not enough to separate the hypotheses; do not classify before/after-close on this.`;
  } else if (best.agreement < 0.9) {
    inferred = `INDETERMINATE -- the best-fitting offset (${best.offset}h) only explains ${Math.round(best.agreement * 100)}% of the observed filingDate rollovers. Something other than the 17:30 ET cutoff is moving these dates; inspect filingDateRolloverByHour by hand.`;
  } else if (best.offset === 0) {
    inferred =
      "EASTERN. The rollover profile fits a 0h offset from Eastern, i.e. these are ET clock times carrying a trailing Z that is WRONG. Use the clock fields as-is against a 09:30/16:00 ET session; do NOT convert from UTC, which would shift every filing 4-5h earlier and turn after-close filings into during-session ones.";
  } else if (best.offset === 4 || best.offset === 5) {
    inferred = `UTC, genuinely. The rollover profile fits a ${best.offset}h offset from Eastern, which is ${best.offset === 4 ? "EDT" : "EST"}. Convert to America/New_York before classifying before-open vs after-close. Expect the fit to sit between 4 and 5 across a DST boundary.`;
  } else {
    inferred = `OFFSET ${best.offset}h FROM EASTERN -- fits the rollover rule but matches neither Eastern (0) nor UTC (4/5). Treat as unexplained and inspect the raw table before relying on it.`;
  }

  return {
    populated: populated.length,
    total: rows.length,
    suffixes: { Z: suffixZ, explicitOffset: suffixOffset, none: suffixNone },
    sampleRaw: populated.slice(0, 5).map((r) => ({
      form: r.form,
      filingDate: r.filingDate,
      acceptanceDateTime: r.acceptance,
    })),
    hourHistogramFaceValue: Object.fromEntries(Object.entries(hourHistogram).sort()),
    filingDateRolloverByHour: Object.fromEntries(Object.keys(rollover).sort().map((h) => [h, rollover[h]])),
    // Every candidate offset's score, so the verdict is checkable rather than
    // taken on trust. A decisive answer looks like one offset near 1.0 and the
    // rest well below it.
    offsetFit: {
      best,
      runnerUp,
      separation: best && runnerUp ? +(best.agreement - runnerUp.agreement).toFixed(3) : null,
      tiedWith,
      rolloverObservations: totalLater,
      allCandidates: scored.slice(0, 6),
    },
    timezoneVerdict: inferred,
  };
}

async function probeSubmissions(symbol: string, cik: string, cutoffMs: number) {
  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const timeoutMs = 45000;
  try {
    const r = await timedFetch(url, timeoutMs, secHeaders());
    const common = { symbol, cik, url, status: r.status, contentType: r.contentType, bytes: r.bytes, ms: r.ms };
    if (r.status !== 200) {
      return { ...common, ok: false, reason: `HTTP ${r.status}`, bodyHead: r.body.slice(0, 300) };
    }

    const data = JSON.parse(r.body) as {
      name?: string;
      sicDescription?: string;
      fiscalYearEnd?: string;
      filings?: { recent?: Recent; files?: unknown[] };
    };
    const recent = data.filings?.recent;
    if (!recent) return { ...common, ok: false, reason: "no filings.recent in payload" };

    const n = (recent.accessionNumber as unknown[] | undefined)?.length ?? 0;
    const col = (name: string, i: number) => String((recent[name]?.[i] ?? "") as string);

    const all: { form: string; filingDate: string; reportDate: string; acceptance: string; accn: string }[] = [];
    for (let i = 0; i < n; i++) {
      all.push({
        form: col("form", i),
        filingDate: col("filingDate", i),
        reportDate: col("reportDate", i),
        acceptance: col("acceptanceDateTime", i),
        accn: col("accessionNumber", i),
      });
    }

    const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10);
    const periodic = all.filter((f) => /^(10-Q|10-K|20-F|40-F|6-K)/.test(f.form));
    const eightK = all.filter((f) => /^8-K/.test(f.form));
    const periodicInWindow = periodic.filter((f) => f.filingDate >= cutoffDate);
    const eightKInWindow = eightK.filter((f) => f.filingDate >= cutoffDate);

    return {
      ...common,
      ok: true,
      name: data.name ?? null,
      sicDescription: data.sicDescription ?? null,
      fiscalYearEnd: data.fiscalYearEnd ?? null,
      totalRecentFilings: n,
      // `files` being non-empty means filings.recent is a TRUNCATED view and
      // older filings live in paged files. Reported because a depth count taken
      // from `recent` alone would silently understate history for a busy filer.
      olderFilingPages: (data.filings?.files as unknown[] | undefined)?.length ?? 0,
      counts: {
        periodicAll: periodic.length,
        periodicLast8q: periodicInWindow.length,
        eightKAll: eightK.length,
        eightKLast8q: eightKInWindow.length,
      },
      formsSeen: [...new Set(periodic.map((f) => f.form))].sort(),
      periodicLast8q: periodicInWindow.map((f) => ({
        form: f.form,
        filingDate: f.filingDate,
        reportDate: f.reportDate,
        acceptanceDateTime: f.acceptance,
        accn: f.accn,
      })),
      eightKSampleLast8q: eightKInWindow.slice(0, 10).map((f) => ({
        form: f.form,
        filingDate: f.filingDate,
        acceptanceDateTime: f.acceptance,
      })),
      // Measured across EVERY filing in `recent`, not just the last 8 quarters:
      // the rollover test needs late-in-the-day filings and those are rare, so a
      // 40-row sample would return INDETERMINATE for want of data.
      acceptanceAnalysis: analyseAcceptance(all),
    };
  } catch (err) {
    return { symbol, cik, url, ok: false, reason: describeError(err, timeoutMs) };
  }
}

// ---------------------------------------------------------------------------
// 3. SEC Financial Statement and Notes Data Sets
// ---------------------------------------------------------------------------
//
// WHY THIS IS RANGE-READ AND STREAMED RATHER THAN DOWNLOADED
// ----------------------------------------------------------
// The monthly notes ZIP is hundreds of MB compressed and num.tsv alone inflates
// to something in the gigabytes. Buffering either one in a serverless function
// is not a tuning problem, it is an out-of-memory crash -- and a crash reports
// nothing, which is the worst outcome for a go/no-go probe.
//
// So: fetch the last 64 KB, parse the ZIP central directory out of it, and
// learn every entry's exact compressed range and inflated size WITHOUT having
// fetched the archive. That alone answers most of the feasibility question, and
// it answers it in about a second. Only then are individual entries range-
// fetched and inflated through a stream, filtered line by line, never
// accumulated.
//
// THE STAGES ARE REPORTED INDEPENDENTLY, on purpose. Stage A (HEAD) and stage B
// (central directory) are cheap and near-certain; stage D (num.tsv) is the one
// that might exhaust the budget. If D is abandoned, A/B/C still answer "how big
// is this thing and what is in it", which is most of what a go/no-go needs.
// A single all-or-nothing call would have thrown that away to report a timeout.
//
// node:zlib and node:stream are builtins -- no package, no lockfile change.

const ZIP_UA = { "user-agent": SEC_UA, accept: "application/zip,*/*" };

type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

function readU16(b: Buffer, o: number) {
  return b.readUInt16LE(o);
}
function readU32(b: Buffer, o: number) {
  return b.readUInt32LE(o);
}
// ZIP64 sizes are 8-byte. Read as BigInt then narrow -- these files are large
// enough that a 32-bit read is a real truncation risk, not a hypothetical one.
function readU64(b: Buffer, o: number) {
  return Number(b.readBigUInt64LE(o));
}

async function rangeFetch(url: string, start: number, end: number, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { ...ZIP_UA, range: `bytes=${start}-${end}` },
    });
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, buf };
  } finally {
    clearTimeout(timer);
  }
}

function parseCentralDirectory(cd: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let p = 0;
  while (p + 46 <= cd.length && readU32(cd, p) === 0x02014b50) {
    const method = readU16(cd, p + 10);
    let compressedSize = readU32(cd, p + 20);
    let uncompressedSize = readU32(cd, p + 24);
    const nameLen = readU16(cd, p + 28);
    const extraLen = readU16(cd, p + 30);
    const commentLen = readU16(cd, p + 32);
    let localHeaderOffset = readU32(cd, p + 42);
    const name = cd.toString("utf8", p + 46, p + 46 + nameLen);

    // ZIP64 extra field. Present fields appear IN ORDER and only for the ones
    // that overflowed to 0xFFFFFFFF, so the cursor has to advance conditionally
    // -- reading them at fixed offsets gets the wrong number whenever only some
    // of them overflowed.
    const extraStart = p + 46 + nameLen;
    let e = extraStart;
    while (e + 4 <= extraStart + extraLen) {
      const headerId = readU16(cd, e);
      const dataSize = readU16(cd, e + 2);
      if (headerId === 0x0001) {
        let q = e + 4;
        if (uncompressedSize === 0xffffffff) {
          uncompressedSize = readU64(cd, q);
          q += 8;
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = readU64(cd, q);
          q += 8;
        }
        if (localHeaderOffset === 0xffffffff) {
          localHeaderOffset = readU64(cd, q);
          q += 8;
        }
      }
      e += 4 + dataSize;
    }

    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    p = extraStart + extraLen + commentLen;
  }
  return entries;
}

// Stream ONE zip entry, inflate it, and hand each line to a callback. Returns
// when the callback says stop, the budget runs out, or the entry ends.
//
// The budget is not belt-and-braces. num.tsv is the entry that decides whether
// this whole approach is viable, and an unbudgeted read of it is how the
// function gets killed with nothing to show. Truncation is REPORTED, so a
// partial answer is never mistaken for a complete one.
async function streamEntry(
  url: string,
  entry: ZipEntry,
  opts: { deadlineMs: number; maxInflatedBytes: number },
  onLine: (line: string, lineNo: number) => boolean | void
) {
  // The central directory's extra-field length and the LOCAL header's can
  // differ, so the data offset has to come from the local header itself.
  const head = await rangeFetch(url, entry.localHeaderOffset, entry.localHeaderOffset + 29, 30000);
  if (head.buf.length < 30 || readU32(head.buf, 0) !== 0x04034b50) {
    return { ok: false as const, reason: `local header not found at offset ${entry.localHeaderOffset}` };
  }
  const dataStart = entry.localHeaderOffset + 30 + readU16(head.buf, 26) + readU16(head.buf, 28);
  const dataEnd = dataStart + entry.compressedSize - 1;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, opts.deadlineMs - Date.now()));
  const started = Date.now();
  let inflatedBytes = 0;
  let compressedBytes = 0;
  let lineNo = 0;
  let truncated: string | null = null;

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { ...ZIP_UA, range: `bytes=${dataStart}-${dataEnd}` },
    });
    if (res.status !== 206 && res.status !== 200) {
      return { ok: false as const, reason: `range request returned HTTP ${res.status}` };
    }
    if (!res.body) return { ok: false as const, reason: "range request returned no body" };
    if (entry.method !== 8 && entry.method !== 0) {
      return { ok: false as const, reason: `unsupported compression method ${entry.method}` };
    }

    const source = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
    compressedBytes = entry.compressedSize;

    // NO `data` LISTENER ON `source`, and that is not a style choice. When the
    // entry is STORED rather than deflated, `stream` IS `source`, and a `data`
    // listener alongside `for await` puts one stream in flowing mode while the
    // iterator is also pulling from it -- the listener wins the race for some
    // chunks and those bytes never reach the iterator. It would silently drop
    // rows out of the middle of a file and report a clean read.
    const stream = entry.method === 8 ? source.pipe(createInflateRaw()) : source;

    // Aborting mid-iteration makes the underlying socket error AFTER the
    // iterator has stopped listening. An 'error' with no listener is an
    // unhandled exception, which in a serverless function takes the whole
    // invocation down and reports nothing at all -- so the budget stop would
    // destroy the very output it exists to preserve. These no-op listeners keep
    // the error handled; the for-await still rejects and the catch below still
    // classifies it.
    source.on("error", () => {});
    if (stream !== source) stream.on("error", () => {});

    let carry = "";
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      inflatedBytes += chunk.length;
      carry += chunk.toString("utf8");
      const lines = carry.split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) {
        lineNo++;
        if (onLine(line, lineNo) === false) {
          truncated = "caller stopped early";
          controller.abort();
          return {
            ok: true as const,
            lineNo,
            inflatedBytes,
            compressedBytes,
            ms: Date.now() - started,
            truncated,
          };
        }
      }
      if (inflatedBytes > opts.maxInflatedBytes) {
        truncated = `inflated-byte budget of ${opts.maxInflatedBytes} exhausted`;
        controller.abort();
        break;
      }
      if (Date.now() > opts.deadlineMs) {
        truncated = "time budget exhausted";
        controller.abort();
        break;
      }
    }
    if (!truncated && carry.trim()) {
      lineNo++;
      onLine(carry, lineNo);
    }
    return { ok: true as const, lineNo, inflatedBytes, compressedBytes, ms: Date.now() - started, truncated };
  } catch (err) {
    // An abort we asked for is a budget stop, not a failure -- reporting it as
    // an error would make a deliberate truncation look like a broken source.
    if (truncated) {
      return { ok: true as const, lineNo, inflatedBytes, compressedBytes, ms: Date.now() - started, truncated };
    }
    return { ok: false as const, reason: describeError(err, opts.deadlineMs - started), lineNo, inflatedBytes };
  } finally {
    clearTimeout(timer);
  }
}

function tsvIndexer(headerLine: string) {
  // Column POSITIONS are never hardcoded. SEC has added columns to these files
  // between releases, and a fixed index silently reads the neighbouring column
  // -- which is a wrong number, not an error.
  const cols = headerLine.replace(/\r$/, "").split("\t");
  const idx: Record<string, number> = {};
  cols.forEach((c, i) => (idx[c.trim().toLowerCase()] = i));
  return {
    cols,
    idx,
    get(fields: string[], name: string): string {
      const i = idx[name.toLowerCase()];
      return i === undefined ? "" : (fields[i] ?? "");
    },
    missing(required: string[]) {
      return required.filter((r) => idx[r.toLowerCase()] === undefined);
    },
  };
}

const DATASET_BASE = "https://www.sec.gov/files/dera/data/financial-statement-and-notes-data-sets";

const REVENUE_TAGS = new Set(
  [
    "Revenues",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
  ].map((t) => t.toLowerCase())
);

async function probeDataSets(month: string, targetSymbol: string, targetCik: string, overallDeadline: number) {
  const url = `${DATASET_BASE}/${month}_notes.zip`;
  const stages: Record<string, unknown> = {};
  const cikNumeric = String(Number(targetCik));

  // --- Stage A: does it exist and how big is it -----------------------------
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 30000);
    const started = Date.now();
    const head = await fetch(url, { method: "HEAD", signal: controller.signal, cache: "no-store", headers: ZIP_UA });
    clearTimeout(t);
    stages.A_head = {
      url,
      status: head.status,
      ms: Date.now() - started,
      contentLength: head.headers.get("content-length"),
      zipMB: head.headers.get("content-length")
        ? Math.round(Number(head.headers.get("content-length")) / 1048576)
        : null,
      acceptRanges: head.headers.get("accept-ranges"),
      lastModified: head.headers.get("last-modified"),
    };
    if (head.status !== 200) {
      return { month, url, ok: false, reason: `HEAD returned HTTP ${head.status}`, stages };
    }
  } catch (err) {
    stages.A_head = { url, error: describeError(err, 30000) };
    return { month, url, ok: false, reason: "HEAD failed", stages };
  }

  const totalSize = Number((stages.A_head as { contentLength: string | null }).contentLength ?? 0);
  if (!totalSize) return { month, url, ok: false, reason: "no content-length; cannot range-read", stages };

  // --- Stage B: central directory, without fetching the archive -------------
  let entries: ZipEntry[] = [];
  try {
    const tailLen = Math.min(65557, totalSize);
    const tail = await rangeFetch(url, totalSize - tailLen, totalSize - 1, 30000);
    if (tail.status !== 206) {
      stages.B_centralDirectory = {
        status: tail.status,
        note: "server did not honour Range (expected 206); whole-archive download is the only option and is not viable here",
      };
      return { month, url, ok: false, reason: "range requests not supported", stages };
    }

    let eocd = -1;
    for (let i = tail.buf.length - 22; i >= 0; i--) {
      if (readU32(tail.buf, i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd === -1) return { month, url, ok: false, reason: "no EOCD signature in tail", stages };

    let cdSize = readU32(tail.buf, eocd + 12);
    let cdOffset = readU32(tail.buf, eocd + 16);
    let entryCount = readU16(tail.buf, eocd + 10);
    let zip64 = false;

    if (cdOffset === 0xffffffff || cdSize === 0xffffffff || entryCount === 0xffff) {
      // ZIP64. Not defensive padding -- these archives are near or past the
      // 4 GB / 65535-entry boundaries where the 32-bit fields stop being able
      // to hold the real value and hold a sentinel instead.
      zip64 = true;
      let loc = -1;
      for (let i = eocd - 20; i >= 0; i--) {
        if (readU32(tail.buf, i) === 0x07064b50) {
          loc = i;
          break;
        }
      }
      if (loc === -1) return { month, url, ok: false, reason: "ZIP64 sentinel present but no ZIP64 locator", stages };
      const z64Offset = readU64(tail.buf, loc + 8);
      const z64 = await rangeFetch(url, z64Offset, z64Offset + 55, 30000);
      if (readU32(z64.buf, 0) !== 0x06064b50) {
        return { month, url, ok: false, reason: "ZIP64 EOCD signature mismatch", stages };
      }
      entryCount = readU64(z64.buf, 32);
      cdSize = readU64(z64.buf, 40);
      cdOffset = readU64(z64.buf, 48);
    }

    const cd = await rangeFetch(url, cdOffset, cdOffset + cdSize - 1, 45000);
    entries = parseCentralDirectory(cd.buf);
    stages.B_centralDirectory = {
      zip64,
      declaredEntries: entryCount,
      parsedEntries: entries.length,
      centralDirectoryBytes: cdSize,
      bytesFetchedSoFar: tailLen + cd.buf.length,
      entries: entries.map((e) => ({
        name: e.name,
        method: e.method,
        compressedMB: +(e.compressedSize / 1048576).toFixed(1),
        uncompressedMB: +(e.uncompressedSize / 1048576).toFixed(1),
      })),
      note: "sizes here are read from the archive index -- the archive itself has not been downloaded",
    };
  } catch (err) {
    stages.B_centralDirectory = { error: describeError(err, 45000) };
    return { month, url, ok: false, reason: "central directory read failed", stages };
  }

  const find = (n: string) => entries.find((e) => e.name.toLowerCase().replace(/^.*\//, "") === n);
  const subEntry = find("sub.tsv");
  const numEntry = find("num.tsv");
  const dimEntry = find("dim.tsv");
  if (!subEntry || !numEntry || !dimEntry) {
    return {
      month,
      url,
      ok: false,
      reason: `expected sub.tsv/num.tsv/dim.tsv; archive holds ${entries.map((e) => e.name).join(", ")}`,
      stages,
    };
  }

  // --- Stage C: sub.tsv -> the target's accession numbers -------------------
  const adshRows: Record<string, Record<string, string>> = {};
  let subHeader: ReturnType<typeof tsvIndexer> | null = null;
  let subRows = 0;
  const subRes = await streamEntry(
    url,
    subEntry,
    { deadlineMs: Math.min(overallDeadline, Date.now() + 90000), maxInflatedBytes: 512 * 1048576 },
    (line, no) => {
      if (no === 1) {
        subHeader = tsvIndexer(line);
        return;
      }
      subRows++;
      if (!subHeader) return;
      const f = line.split("\t");
      if (subHeader.get(f, "cik") !== cikNumeric) return;
      const adsh = subHeader.get(f, "adsh");
      if (adsh) {
        adshRows[adsh] = {
          form: subHeader.get(f, "form"),
          period: subHeader.get(f, "period"),
          fy: subHeader.get(f, "fy"),
          fp: subHeader.get(f, "fp"),
          filed: subHeader.get(f, "filed"),
          name: subHeader.get(f, "name"),
        };
      }
    }
  );
  const subIdx = subHeader as ReturnType<typeof tsvIndexer> | null;
  stages.C_sub = {
    entry: subEntry.name,
    ...subRes,
    dataRows: subRows,
    columns: subIdx?.cols ?? null,
    lookedForCik: cikNumeric,
    symbol: targetSymbol,
    matchedFilings: adshRows,
    matchCount: Object.keys(adshRows).length,
  };

  if (!Object.keys(adshRows).length) {
    return {
      month,
      url,
      ok: true,
      verdict: `NO ${targetSymbol} FILING IN THIS MONTH'S ARCHIVE -- the dimensional question is unanswerable from ${month}; retry with the month ${targetSymbol} actually filed in (see the sec-submissions section for its filing dates)`,
      stages,
    };
  }

  // --- Stage D: num.tsv -> revenue rows carrying a dimension ---------------
  // The big one. Filtered to the target's accessions and to revenue tags; only
  // the dimh values are retained, never the rows.
  const wantedAdsh = new Set(Object.keys(adshRows));
  const dimhWanted = new Set<string>();
  type NumRow = {
    adsh: string;
    tag: string;
    version: string;
    ddate: string;
    qtrs: string;
    uom: string;
    dimh: string;
    dimn: string;
    value: string;
  };
  const revenueRows: NumRow[] = [];
  let numHeader: ReturnType<typeof tsvIndexer> | null = null;
  let numDataRows = 0;
  let numMatchedAdsh = 0;

  const numRes = await streamEntry(
    url,
    numEntry,
    { deadlineMs: overallDeadline, maxInflatedBytes: 4096 * 1048576 },
    (line, no) => {
      if (no === 1) {
        numHeader = tsvIndexer(line);
        return;
      }
      numDataRows++;
      if (!numHeader) return;
      const f = line.split("\t");
      const adsh = numHeader.get(f, "adsh");
      if (!wantedAdsh.has(adsh)) return;
      numMatchedAdsh++;
      const tag = numHeader.get(f, "tag");
      // The three canonical spellings, OR any tag whose name contains
      // "revenue". A filer using a spelling outside the canonical set would
      // otherwise yield zero rows and the verdict would read NO-GO -- absence
      // of a tag reported as absence of the disaggregation. The broader match
      // costs nothing here because the rows are already filtered to this
      // company's accession numbers.
      if (!REVENUE_TAGS.has(tag.toLowerCase()) && !/revenue/i.test(tag)) return;
      const dimh = numHeader.get(f, "dimh");
      if (dimh && dimh !== "0x00000000") dimhWanted.add(dimh);
      if (revenueRows.length < 400) {
        revenueRows.push({
          adsh,
          tag,
          version: numHeader.get(f, "version"),
          ddate: numHeader.get(f, "ddate"),
          qtrs: numHeader.get(f, "qtrs"),
          uom: numHeader.get(f, "uom"),
          dimh,
          dimn: numHeader.get(f, "dimn"),
          value: numHeader.get(f, "value"),
        });
      }
    }
  );
  const numIdx = numHeader as ReturnType<typeof tsvIndexer> | null;
  stages.D_num = {
    entry: numEntry.name,
    uncompressedMB: +(numEntry.uncompressedSize / 1048576).toFixed(1),
    ...numRes,
    dataRows: numDataRows,
    columns: numIdx?.cols ?? null,
    missingExpectedColumns: numIdx?.missing(["adsh", "tag", "ddate", "qtrs", "uom", "dimh", "value"]) ?? null,
    rowsForTarget: numMatchedAdsh,
    revenueRowsKept: revenueRows.length,
    distinctDimensionHashes: dimhWanted.size,
  };

  // --- Stage E: dim.tsv -> the member labels, verbatim ---------------------
  const dimLabels: Record<string, Record<string, string>> = {};
  let dimHeader: ReturnType<typeof tsvIndexer> | null = null;
  let dimRows = 0;
  const dimRes = dimhWanted.size
    ? await streamEntry(
        url,
        dimEntry,
        { deadlineMs: overallDeadline, maxInflatedBytes: 1024 * 1048576 },
        (line, no) => {
          if (no === 1) {
            dimHeader = tsvIndexer(line);
            return;
          }
          dimRows++;
          if (!dimHeader) return;
          const f = line.split("\t");
          const dimh = dimHeader.get(f, "dimh");
          if (!dimhWanted.has(dimh)) return;
          dimLabels[dimh] = {
            // VERBATIM, as the brief asked. No trimming of the axis prefix, no
            // prettifying -- the exact string is what an adapter would have to
            // match on, so an edited one would answer a different question.
            segments: dimHeader.get(f, "segments"),
            segt: dimHeader.get(f, "segt"),
            segc: dimHeader.get(f, "segc"),
            segd: dimHeader.get(f, "segd"),
            segr: dimHeader.get(f, "segr"),
          };
          if (Object.keys(dimLabels).length >= dimhWanted.size) return false;
        }
      )
    : null;
  const dimIdx = dimHeader as ReturnType<typeof tsvIndexer> | null;
  stages.E_dim = {
    entry: dimEntry.name,
    ...(dimRes ?? { skipped: "no dimensioned revenue rows found in stage D" }),
    dataRows: dimRows,
    columns: dimIdx?.cols ?? null,
    resolved: Object.keys(dimLabels).length,
    ofWanted: dimhWanted.size,
  };

  // --- The actual go/no-go ------------------------------------------------
  const joined = revenueRows.map((r) => ({
    ...r,
    segmentsVerbatim: dimLabels[r.dimh]?.segments ?? null,
  }));
  const byProduct = joined.filter((r) => /ProductOrServiceAxis/i.test(String(r.segmentsVerbatim ?? "")));
  const byGeography = joined.filter((r) => /StatementGeographicalAxis/i.test(String(r.segmentsVerbatim ?? "")));

  const verdict =
    byProduct.length && byGeography.length
      ? "GO -- both ProductOrServiceAxis and StatementGeographicalAxis revenue splits recovered"
      : byProduct.length || byGeography.length
        ? `PARTIAL -- ${byProduct.length ? "ProductOrServiceAxis" : "StatementGeographicalAxis"} recovered, the other absent in this month's filing`
        : numRes.ok && !numRes.truncated
          ? "NO-GO for this month -- the filing is present and num.tsv was read in full, but no dimensioned revenue rows on these axes exist in it"
          : "INCONCLUSIVE -- num.tsv was truncated before the file ended, so absence here is not evidence of absence";

  return {
    month,
    url,
    ok: true,
    symbol: targetSymbol,
    cik: cikNumeric,
    verdict,
    productSplits: byProduct.map((r) => ({ ddate: r.ddate, qtrs: r.qtrs, value: r.value, segments: r.segmentsVerbatim })),
    geographySplits: byGeography.map((r) => ({ ddate: r.ddate, qtrs: r.qtrs, value: r.value, segments: r.segmentsVerbatim })),
    allDistinctSegmentStrings: [...new Set(joined.map((r) => r.segmentsVerbatim).filter(Boolean))],
    undimensionedRevenueRows: joined.filter((r) => !r.segmentsVerbatim).length,
    stages,
  };
}

// ---------------------------------------------------------------------------
// 4. Alpha Vantage -- free tier, 25 requests/day
// ---------------------------------------------------------------------------
//
// OPT-IN ONLY, and the reason is worth stating plainly: this section is
// DESIGNED to exhaust the day's allowance, because the brief asks for the exact
// error body on the 26th request. Once spent it cannot be re-run until the
// quota resets, so it must never be reachable by a caller who wanted to re-run
// the free SEC sections.
//
// ALPHA VANTAGE SIGNALS ITS LIMIT WITH HTTP 200. The rate-limit response is a
// normal 200 carrying an `Information` or `Note` key instead of data. Anything
// keying off res.ok treats an exhausted quota as a successful empty response --
// the shape of claude/traps/return-type-cannot-express-failure.md, arriving
// from outside. So every response here is classified by BODY, and the raw body
// is kept verbatim for the limit case.

type AvCall = {
  n: number;
  fn: string;
  symbol?: string;
  status: number;
  ms: number;
  bytes: number;
  contentType: string;
  classification: "data" | "rate-limited" | "error-payload" | "unparseable" | "empty";
  topLevelKeys?: string[];
  quartersReturned?: number | null;
  fieldNames?: string[];
  rawBodyVerbatim?: string;
  csvHeader?: string;
  csvRows?: number;
  symbolsCovered?: string[];
  symbolsMissing?: string[];
};

function classifyAv(body: string, contentType: string) {
  const trimmed = body.trim();
  if (!trimmed) return { classification: "empty" as const };
  if (contentType.includes("csv") || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    // The calendar endpoint answers in CSV. A rate-limited CSV request answers
    // in JSON, so the content type itself is part of the signal.
    if (/rate limit|higher api call|premium|Thank you for using Alpha Vantage/i.test(trimmed)) {
      return { classification: "rate-limited" as const };
    }
    return { classification: "data" as const, csv: true };
  }
  try {
    const json = JSON.parse(trimmed) as Record<string, unknown>;
    const keys = Object.keys(json);
    if (keys.some((k) => /^(Information|Note)$/i.test(k))) {
      return { classification: "rate-limited" as const, json, keys };
    }
    if (keys.some((k) => /^Error Message$/i.test(k))) {
      return { classification: "error-payload" as const, json, keys };
    }
    return { classification: "data" as const, json, keys };
  } catch {
    return { classification: "unparseable" as const };
  }
}

async function probeAlphaVantage(symbols: string[], burnToLimit: boolean, maxRequests: number) {
  if (!AV_KEY) {
    return {
      ok: false,
      reason:
        "ALPHAVANTAGE_API_KEY is not set in this environment. Set it in Vercel Preview (a rebuild is required -- Vercel captures env vars at build time) and re-run with &sections=av.",
      requestsSpent: 0,
      calls: [],
    };
  }

  const calls: AvCall[] = [];
  let n = 0;
  let limitHitAt: number | null = null;

  const call = async (fn: string, extra: Record<string, string>, symbol?: string) => {
    if (n >= maxRequests) return null;
    n++;
    const params = new URLSearchParams({ function: fn, ...extra, apikey: AV_KEY });
    const url = `https://www.alphavantage.co/query?${params.toString()}`;
    try {
      const r = await timedFetch(url, 30000, { accept: "application/json,text/csv,*/*" });
      const c = classifyAv(r.body, r.contentType);
      const rec: AvCall = {
        n,
        fn,
        symbol,
        status: r.status,
        ms: r.ms,
        bytes: r.bytes,
        contentType: r.contentType,
        classification: c.classification,
      };
      if (c.classification === "rate-limited") {
        if (limitHitAt === null) limitHitAt = n;
        // VERBATIM, uncut. This string is the deliverable for this part of the
        // brief and a truncated version would not be the answer.
        rec.rawBodyVerbatim = r.body;
      } else if (c.classification === "error-payload" || c.classification === "unparseable") {
        rec.rawBodyVerbatim = r.body.slice(0, 600);
      }
      if ("keys" in c && c.keys) rec.topLevelKeys = c.keys;
      calls.push(rec);
      return { rec, raw: r, parsed: "json" in c ? (c.json as Record<string, unknown>) : null };
    } catch (err) {
      const rec: AvCall = {
        n,
        fn,
        symbol,
        status: 0,
        ms: 0,
        bytes: 0,
        contentType: "",
        classification: "unparseable",
        rawBodyVerbatim: describeError(err, 30000),
      };
      calls.push(rec);
      return null;
    }
  };

  // EARNINGS -- quarterly history depth per symbol
  for (const s of symbols) {
    const res = await call("EARNINGS", { symbol: s }, s);
    if (!res?.parsed) continue;
    const q = res.parsed.quarterlyEarnings as Record<string, unknown>[] | undefined;
    const a = res.parsed.annualEarnings as Record<string, unknown>[] | undefined;
    res.rec.quartersReturned = Array.isArray(q) ? q.length : null;
    res.rec.fieldNames = Array.isArray(q) && q[0] ? Object.keys(q[0]) : Array.isArray(a) && a[0] ? Object.keys(a[0]) : [];
  }

  // EARNINGS_ESTIMATES -- forward consensus
  for (const s of symbols) {
    const res = await call("EARNINGS_ESTIMATES", { symbol: s }, s);
    if (!res?.parsed) continue;
    const est = res.parsed.estimates as Record<string, unknown>[] | undefined;
    res.rec.quartersReturned = Array.isArray(est) ? est.length : null;
    res.rec.fieldNames = Array.isArray(est) && est[0] ? Object.keys(est[0]) : [];
  }

  // EARNINGS_CALENDAR -- CSV, covers the whole market rather than one symbol
  const cal = await call("EARNINGS_CALENDAR", { horizon: "3month" });
  if (cal && cal.rec.classification === "data") {
    const lines = cal.raw.body.split("\n").filter((l) => l.trim());
    cal.rec.csvHeader = lines[0] ?? "";
    cal.rec.csvRows = Math.max(0, lines.length - 1);
    const header = (lines[0] ?? "").split(",").map((h) => h.trim().toLowerCase());
    const symCol = header.indexOf("symbol");
    const present = new Set<string>();
    if (symCol >= 0) {
      for (const l of lines.slice(1)) {
        const v = l.split(",")[symCol]?.trim().toUpperCase();
        if (v) present.add(v);
      }
    }
    cal.rec.symbolsCovered = symbols.filter((s) => present.has(s));
    cal.rec.symbolsMissing = symbols.filter((s) => !present.has(s));
  }

  // The 26th-request question. Cheap repeated calls until the limit answers,
  // so the burn is spent on the measurement and not on more data.
  if (burnToLimit) {
    while (n < maxRequests && limitHitAt === null) {
      await call("EARNINGS", { symbol: symbols[0] }, symbols[0]);
    }
  }

  return {
    ok: true,
    keySet: true,
    requestsSpent: n,
    maxRequests,
    burnToLimit,
    limitHitAtRequestNumber: limitHitAt,
    limitBodyVerbatim: limitHitAt ? calls.find((c) => c.n === limitHitAt)?.rawBodyVerbatim ?? null : null,
    note: limitHitAt
      ? `The free tier answered with data for ${limitHitAt - 1} requests and refused on request ${limitHitAt}. Note the refusal arrives as HTTP ${calls.find((c) => c.n === limitHitAt)?.status} -- not an error status.`
      : `No limit response within ${n} requests. Either the quota was not exhausted or this key is not on the free tier.`,
    calls,
  };
}

// ---------------------------------------------------------------------------
// 5. Stooq daily bars
// ---------------------------------------------------------------------------
//
// THE HEADER CHECK IS THE MEASUREMENT, not validation around it. Stooq answers
// an unattended datacentre client with a JavaScript browser-verification page
// carrying HTTP 200, and a parser that splits on commas reads that HTML as
// prices. That is not hypothetical: the strict header check is the only reason
// the challenge was ever seen on 2026-09-12, and a lenient one would have
// produced dividend-adjustment ratios out of markup.
//
// So the first line must equal the expected header EXACTLY. Anything else is a
// FAIL with the body head recorded verbatim, and no attempt is made to salvage
// rows from it.

const STOOQ_HEADER = "Date,Open,High,Low,Close,Volume";

function quarterKey(iso: string) {
  const [y, m] = iso.split("-");
  return `${y}Q${Math.floor((Number(m) - 1) / 3) + 1}`;
}

async function probeStooq(symbol: string, cutoffMs: number) {
  const s = `${symbol.toLowerCase().replace(/\./g, "-")}.us`;
  const d1 = new Date(cutoffMs).toISOString().slice(0, 10).replace(/-/g, "");
  const d2 = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const url = `https://stooq.com/q/d/l/?s=${s}&d1=${d1}&d2=${d2}&i=d`;
  const timeoutMs = 25000;

  try {
    const r = await timedFetch(url, timeoutMs, {
      "user-agent": "MyStockHarborBot/1.0 (+https://www.mystockharbor.com)",
      accept: "text/csv,text/plain,*/*",
    });
    const common = { symbol, stooqSymbol: s, url, status: r.status, contentType: r.contentType, bytes: r.bytes, ms: r.ms };

    const lines = r.body.split("\n").map((l) => l.replace(/\r$/, ""));
    const header = (lines[0] ?? "").trim();

    if (header !== STOOQ_HEADER) {
      const head = r.body.slice(0, 240).replace(/\s+/g, " ").trim();
      const challenged = /requires JavaScript to verify your browser/i.test(r.body);
      return {
        ...common,
        ok: false,
        verdict: challenged ? "FAIL -- JavaScript browser-verification interstitial" : "FAIL -- unexpected first line",
        expectedHeader: STOOQ_HEADER,
        actualFirstLine: header.slice(0, 200),
        bodyHeadVerbatim: head,
        barsParsed: 0,
        note: "no rows were parsed from this body, deliberately -- a lenient parse here is how HTML becomes prices",
      };
    }

    const rows = lines
      .slice(1)
      .filter((l) => /^\d{4}-\d{2}-\d{2},/.test(l))
      .map((l) => l.split(","));
    if (!rows.length) return { ...common, ok: false, verdict: "FAIL -- correct header, zero data rows", barsParsed: 0 };

    const dates = rows.map((c) => c[0]).sort();
    const perQuarter: Record<string, number> = {};
    for (const d of dates) perQuarter[quarterKey(d)] = (perQuarter[quarterKey(d)] ?? 0) + 1;
    const quarters = Object.keys(perQuarter).sort();

    // COUNT THE SPREAD, NOT THE TOTAL -- claude/traps/suspicious-uniformity.md.
    // A bar count that clears 504 says nothing about whether the coverage has a
    // hole in it, and the price-reaction card needs +/-20 trading days around a
    // report date specifically. A quarter carrying ~15 bars where its
    // neighbours carry ~63 is a gap that a total would hide completely.
    const counts = Object.values(perQuarter);
    const median = counts.slice().sort((a, b) => a - b)[Math.floor(counts.length / 2)] ?? 0;
    const thinQuarters = quarters.filter((q) => perQuarter[q] < median * 0.6);

    return {
      ...common,
      ok: true,
      verdict: quarters.length >= 8 && !thinQuarters.length ? "PASS" : "PASS WITH GAPS",
      barsParsed: rows.length,
      firstDate: dates[0],
      lastDate: dates[dates.length - 1],
      quartersCovered: quarters.length,
      barsPerQuarter: perQuarter,
      medianBarsPerQuarter: median,
      thinQuarters,
      lastRowVerbatim: rows[rows.length - 1]?.join(","),
    };
  } catch (err) {
    return { symbol, stooqSymbol: s, url, ok: false, verdict: `FAIL -- ${describeError(err, timeoutMs)}`, barsParsed: 0 };
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const FREE_SECTIONS = ["sec-facts", "sec-submissions", "stooq"];
const ALL_SECTIONS = [...FREE_SECTIONS, "datasets", "av"];

export async function GET(request: Request) {
  const denied = await guardDebugRequest(request);
  if (denied) return denied;

  const startedAt = Date.now();
  // Leave room to serialise and return. A probe that reports nothing because it
  // spent its last millisecond fetching has measured nothing.
  const overallDeadline = startedAt + 260000;

  const params = new URL(request.url).searchParams;
  const symbols = (params.get("symbols") ?? DEFAULT_SYMBOLS.join(","))
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 8);

  const requested = (params.get("sections") ?? "free").toLowerCase();
  const sections =
    requested === "all"
      ? ALL_SECTIONS
      : requested === "free"
        ? FREE_SECTIONS
        : requested.split(",").map((s) => s.trim()).filter((s) => ALL_SECTIONS.includes(s));

  // Eight quarters, plus a quarter of slack so a filing that lands late still
  // has its period inside the window rather than falling off the edge.
  const cutoffMs = startedAt - 820 * DAY;

  const out: Record<string, unknown> = {};
  const cikNeeded = sections.some((s) => s === "sec-facts" || s === "sec-submissions" || s === "datasets");
  const ciks = cikNeeded ? await resolveCiks(symbols) : { map: {}, diag: { skipped: true } };
  if (cikNeeded) out.cikResolution = ciks.diag;

  if (sections.includes("sec-facts")) {
    out.companyFacts = await Promise.all(
      symbols.map((s) =>
        ciks.map[s]
          ? probeCompanyFacts(s, ciks.map[s].cik, cutoffMs)
          : Promise.resolve({ symbol: s, ok: false, reason: "no CIK resolved -- not probed", concepts: null })
      )
    );
  }

  let submissionsBySymbol: Record<string, { filingDate: string; form: string }[]> = {};
  if (sections.includes("sec-submissions") || sections.includes("datasets")) {
    const subs = await Promise.all(
      symbols.map((s) =>
        ciks.map[s]
          ? probeSubmissions(s, ciks.map[s].cik, cutoffMs)
          : Promise.resolve({ symbol: s, ok: false, reason: "no CIK resolved -- not probed" })
      )
    );
    if (sections.includes("sec-submissions")) out.submissions = subs;
    submissionsBySymbol = Object.fromEntries(
      subs.map((s) => [
        s.symbol,
        ((s as { periodicLast8q?: { filingDate: string; form: string }[] }).periodicLast8q ?? []),
      ])
    );
  }

  if (sections.includes("datasets")) {
    // THE MONTH IS DERIVED FROM THE TARGET'S OWN FILING DATES, not guessed.
    // A "recent" archive that predates or postdates ARM's filing contains no
    // ARM rows, and an empty result would then read as "the axes are not
    // recoverable" when it only means the wrong month was opened. Overridable
    // with &month=YYYY_MM.
    const target = params.get("datasetSymbol")?.toUpperCase() || "ARM";
    const filings = submissionsBySymbol[target] ?? [];
    const annual = filings.find((f) => /^(10-K|20-F)/.test(f.form)) ?? filings[0];
    const derived = annual?.filingDate ? annual.filingDate.slice(0, 7).replace("-", "_") : null;
    const month = params.get("month") || derived;

    if (!month) {
      out.dataSets = {
        ok: false,
        reason: `could not derive a month: no periodic filings found for ${target} in the submissions window. Pass &month=YYYY_MM explicitly.`,
        target,
      };
    } else if (!ciks.map[target]) {
      out.dataSets = { ok: false, reason: `no CIK resolved for ${target}`, target };
    } else {
      out.dataSets = {
        monthDerivedFrom: params.get("month")
          ? "explicit &month= parameter"
          : `${target}'s ${annual?.form} filed ${annual?.filingDate}`,
        ...(await probeDataSets(month, target, ciks.map[target].cik, overallDeadline)),
      };
    }
  }

  if (sections.includes("av")) {
    out.alphaVantage = await probeAlphaVantage(
      symbols,
      params.get("avBurn") === "1",
      Math.max(1, Math.min(60, Number(params.get("avMax") ?? 30)))
    );
  }

  if (sections.includes("stooq")) {
    const stooq = await Promise.all(symbols.map((s) => probeStooq(s, cutoffMs)));
    out.stooq = {
      priorMeasurement:
        "claude/stooq-inaccessible-sec-viable-2026-09-12.md measured Stooq at 0 of 6 endpoints from a GitHub Actions runner -- a JS browser-verification interstitial on every per-symbol CSV path and on the site root, plus HTTP 401 on the bulk archive. This run tests only whether Vercel's egress IP is treated differently; it is not a re-confirmation of working bars.",
      results: stooq,
    };
  }

  const rawSecUa = process.env.SEC_USER_AGENT ?? "";

  return Response.json(
    {
      ok: true,
      probedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      region: process.env.VERCEL_REGION ?? null,
      env: process.env.VERCEL_ENV ?? null,
      symbols,
      sectionsRun: sections,
      sectionsAvailable: ALL_SECTIONS,
      // The value itself is never echoed: it contains an email address and this
      // output gets pasted around.
      secUserAgent: { set: Boolean(rawSecUa), hasContact: rawSecUa.includes("@"), length: rawSecUa.length },
      alphaVantageKey: { set: Boolean(AV_KEY) },
      quarterWindowStart: new Date(cutoffMs).toISOString().slice(0, 10),
      readingGuide: {
        hideList:
          "companyFacts[].trueHideList is the answer to the brief's question -- missingOrEmpty minus the tags whose alternate spelling IS populated. Read presentButNotQuarterly separately: those are concepts that exist but have no quarterly series, which is a different remedy (derive Q4 from FY minus 9M), not a hidden column.",
        failureVsAbsence:
          "A symbol with ok:false has concepts:null. It contributes NOTHING to any hide list -- a fetch failure is not evidence that a concept is missing.",
        timezone:
          "submissions[].acceptanceAnalysis.timezoneVerdict is FITTED: every candidate offset 0-23h is scored on how well it explains the observed filingDate rollovers against EDGAR's 17:30 ET cutoff. It does not read the trailing Z. Check offsetFit.best.agreement (want ~1.0), offsetFit.rolloverObservations (want well above 5) and offsetFit.tiedWith (want empty) before trusting the verdict.",
        datasets:
          "dataSets.stages A and B answer the feasibility question on their own and cost about a second. Stage D is the one that can be truncated -- if stages.D_num.truncated is set, a null result in productSplits/geographySplits means NOT MEASURED, not absent.",
      },
      ...out,
    },
    { headers: { "cache-control": "no-store" } }
  );
}
