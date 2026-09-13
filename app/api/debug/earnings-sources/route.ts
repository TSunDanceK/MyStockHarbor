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

// The User-Agent is THREADED THROUGH EVERY SEC CALL rather than read from a
// module-level variable, and that is a correctness requirement, not tidiness.
// A serverless instance is reused across concurrent invocations, so a mutable
// module-level UA set per request would let one caller's agent -- which carries
// an email address -- be sent on another caller's request. A parameter cannot
// cross-contaminate.
const SEC_UA_FALLBACK = "MyStockHarbor/1.0 (CONTACT-NOT-SET)";

// A header value cannot carry CR, LF or other control characters: fetch() will
// throw on them, and the throw would surface as "SEC unreachable" rather than
// "your ua parameter is malformed". Stripped and capped here so a bad value is
// reported as a bad value.
function sanitizeUa(raw: string): string {
  return raw.replace(/[\r\n\t\0]/g, " ").replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 256);
}
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

function secHeaders(ua: string): Record<string, string> {
  return {
    "user-agent": ua,
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

async function resolveCiks(symbols: string[], ua: string): Promise<CikMap> {
  const url = "https://www.sec.gov/files/company_tickers.json";
  const timeoutMs = 30000;
  try {
    const r = await timedFetch(url, timeoutMs, secHeaders(ua));
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

async function probeCompanyFacts(symbol: string, cik: string, cutoffMs: number, ua: string) {
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
  const timeoutMs = 60000;
  try {
    const r = await timedFetch(url, timeoutMs, secHeaders(ua));
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

async function probeSubmissions(symbol: string, cik: string, cutoffMs: number, ua: string) {
  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const timeoutMs = 45000;
  try {
    const r = await timedFetch(url, timeoutMs, secHeaders(ua));
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

function zipHeaders(ua: string) {
  return { "user-agent": ua, accept: "application/zip,*/*" };
}

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

async function rangeFetch(url: string, start: number, end: number, timeoutMs: number, ua: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { ...zipHeaders(ua), range: `bytes=${start}-${end}` },
    });
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, buf };
  } finally {
    clearTimeout(timer);
  }
}

type CdParse = { entries: ZipEntry[]; complete: boolean; bytesConsumed: number };

// BOUNDS-SAFE AGAINST A TRUNCATED BUFFER, and that is the fix for a real crash
// rather than defensive padding.
//
// Section 3 hands this a COMPLETE central directory. Section 6d deliberately
// hands it a 64 KB SAMPLE of a central directory that is tens of MB long, so
// its final record is cut in half by construction. The first version bounded
// the extra-field walk by `extraStart + extraLen` -- a length read out of the
// record itself -- and never against `cd.length`, so on the truncated sample it
// walked straight off the end:
//
//   RangeError: The value of "offset" is out of range.
//               It must be >= 0 and <= 65534. Received 65542
//
// Reproduced locally against a 901-entry archive sliced at 65536 bytes: the
// complete directory parses all 901, the truncated one throws. Both bulk
// archives crashed here, which is also the proof that both URLs were RIGHT and
// that real bytes came back -- the crash happened after a successful fetch.
//
// Every read is now guarded, and a record that does not fit ENDS the parse
// cleanly instead of throwing. `complete` says whether the buffer ran out, so a
// caller can tell "this archive has 8 entries" from "I only looked at the first
// 8 of them".
function parseCentralDirectory(cd: Buffer): CdParse {
  const entries: ZipEntry[] = [];
  let p = 0;
  const fits = (offset: number, width: number) => offset >= 0 && offset + width <= cd.length;

  while (fits(p, 46) && readU32(cd, p) === 0x02014b50) {
    const method = readU16(cd, p + 10);
    let compressedSize = readU32(cd, p + 20);
    let uncompressedSize = readU32(cd, p + 24);
    const nameLen = readU16(cd, p + 28);
    const extraLen = readU16(cd, p + 30);
    const commentLen = readU16(cd, p + 32);
    let localHeaderOffset = readU32(cd, p + 42);

    // The whole record -- name, extra and comment -- must be present before any
    // of it is trusted. A half-read name is a wrong name, not a short one.
    const recordEnd = p + 46 + nameLen + extraLen + commentLen;
    if (recordEnd > cd.length) break;

    const name = cd.toString("utf8", p + 46, p + 46 + nameLen);

    // ZIP64 extra field. Present fields appear IN ORDER and only for the ones
    // that overflowed to 0xFFFFFFFF, so the cursor has to advance conditionally
    // -- reading them at fixed offsets gets the wrong number whenever only some
    // of them overflowed.
    const extraStart = p + 46 + nameLen;
    const extraEnd = Math.min(extraStart + extraLen, cd.length);
    let e = extraStart;
    while (e + 4 <= extraEnd) {
      const headerId = readU16(cd, e);
      const dataSize = readU16(cd, e + 2);
      if (headerId === 0x0001) {
        let q = e + 4;
        if (uncompressedSize === 0xffffffff && fits(q, 8)) {
          uncompressedSize = readU64(cd, q);
          q += 8;
        }
        if (compressedSize === 0xffffffff && fits(q, 8)) {
          compressedSize = readU64(cd, q);
          q += 8;
        }
        if (localHeaderOffset === 0xffffffff && fits(q, 8)) {
          localHeaderOffset = readU64(cd, q);
          q += 8;
        }
      }
      // A zero dataSize would spin forever on a corrupt record.
      if (dataSize <= 0) break;
      e += 4 + dataSize;
    }

    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    p = recordEnd;
  }

  return { entries, complete: !fits(p, 46) || readU32(cd, p) !== 0x02014b50, bytesConsumed: p };
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
  opts: { deadlineMs: number; maxInflatedBytes: number; ua: string },
  onLine: (line: string, lineNo: number) => boolean | void
) {
  // The central directory's extra-field length and the LOCAL header's can
  // differ, so the data offset has to come from the local header itself.
  const head = await rangeFetch(url, entry.localHeaderOffset, entry.localHeaderOffset + 29, 30000, opts.ua);
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
      headers: { ...zipHeaders(opts.ua), range: `bytes=${dataStart}-${dataEnd}` },
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

// THE FILENAME IS DISCOVERED, NOT CONSTRUCTED, and the 404 that prompted this is
// the reason. `2026_05_notes.zip` was built from a convention, HEAD returned 404,
// and a 404 on a constructed URL says only "the pattern is wrong" -- it is not
// evidence about the month, the archive, or SEC. SEC has moved these paths
// before, so guessing harder is not the fix.
//
// These index pages are probed, every .zip href is extracted, and the real
// filenames are reported verbatim. If nothing matches the wanted month the
// output carries the list of months that DO exist, which answers the question a
// second guess would not.
const DATASET_INDEX_CANDIDATES = [
  "https://www.sec.gov/dera/data/financial-statement-and-notes-data-set.html",
  "https://www.sec.gov/files/dera/data/financial-statement-and-notes-data-sets/",
  "https://www.sec.gov/data-research/sec-markets-data/financial-statement-notes-data-sets",
];

async function discoverDatasetUrls(ua: string) {
  const pages: Record<string, unknown>[] = [];
  const found = new Map<string, string>();

  for (const index of DATASET_INDEX_CANDIDATES) {
    try {
      const r = await timedFetch(index, 30000, {
        "user-agent": ua,
        "accept-encoding": "gzip, deflate",
        accept: "text/html,*/*",
      });
      const hrefs = [...r.body.matchAll(/href\s*=\s*["']([^"']+\.zip)["']/gi)].map((m) => m[1]);
      for (const href of hrefs) {
        const abs = href.startsWith("http") ? href : new URL(href, index).toString();
        found.set(abs.split("/").pop() ?? abs, abs);
      }
      pages.push({ index, status: r.status, bytes: r.bytes, ms: r.ms, zipHrefs: hrefs.length });
    } catch (err) {
      pages.push({ index, error: describeError(err, 30000) });
    }
  }

  return { pages, filenames: [...found.keys()].sort(), byName: found };
}

const REVENUE_TAGS = new Set(
  [
    "Revenues",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
  ].map((t) => t.toLowerCase())
);

async function probeDataSets(month: string, targetSymbol: string, targetCik: string, overallDeadline: number, ua: string) {
  const stages: Record<string, unknown> = {};
  const cikNumeric = String(Number(targetCik));

  // --- Stage 0: find the real filename -------------------------------------
  const discovery = await discoverDatasetUrls(ua);
  const monthToken = month.replace("-", "_");
  const matched = discovery.filenames.find((f) => f.includes(monthToken));
  const constructed = `${DATASET_BASE}/${month}_notes.zip`;
  const url = matched ? (discovery.byName.get(matched) as string) : constructed;

  stages["0_discovery"] = {
    indexPagesProbed: discovery.pages,
    distinctZipFilenamesFound: discovery.filenames.length,
    // Verbatim, and capped only for readability -- the point is to see SEC's
    // ACTUAL naming convention rather than the one assumed.
    filenamesSample: discovery.filenames.slice(0, 40),
    wantedMonthToken: monthToken,
    matchedFilename: matched ?? null,
    urlSource: matched ? "discovered from SEC's own index page" : "CONSTRUCTED fallback -- discovery found no filename containing the month token, so a 404 below says nothing about the archive",
    urlUsed: url,
  };

  // --- Stage A: does it exist and how big is it -----------------------------
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 30000);
    const started = Date.now();
    const head = await fetch(url, { method: "HEAD", signal: controller.signal, cache: "no-store", headers: zipHeaders(ua) });
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
    const tail = await rangeFetch(url, totalSize - tailLen, totalSize - 1, 30000, ua);
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
      const z64 = await rangeFetch(url, z64Offset, z64Offset + 55, 30000, ua);
      if (readU32(z64.buf, 0) !== 0x06064b50) {
        return { month, url, ok: false, reason: "ZIP64 EOCD signature mismatch", stages };
      }
      entryCount = readU64(z64.buf, 32);
      cdSize = readU64(z64.buf, 40);
      cdOffset = readU64(z64.buf, 48);
    }

    const cd = await rangeFetch(url, cdOffset, cdOffset + cdSize - 1, 45000, ua);
    const parsedCd = parseCentralDirectory(cd.buf);
    entries = parsedCd.entries;
    stages.B_centralDirectory = {
      zip64,
      declaredEntries: entryCount,
      parsedEntries: entries.length,
      // A mismatch against declaredEntries means the directory was cut short,
      // so a missing entry below is "not read" rather than "not in the archive".
      centralDirectoryFullyParsed: parsedCd.complete,
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
    { deadlineMs: Math.min(overallDeadline, Date.now() + 90000), maxInflatedBytes: 512 * 1048576, ua },
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

  // --- Stage D: num.tsv -> EVERY row for the target, classified afterwards -
  //
  // NO TAG PRE-FILTER. The first version filtered to revenue tags BEFORE
  // collecting dimension hashes, which let the filter decide the answer before
  // the evidence was gathered -- and then reported the result as a fact about
  // Apple's disclosures. 969 rows for one filing is nothing to hold, so every
  // row is kept and every classification happens below, where it can be shown.
  const wantedAdsh = new Set(Object.keys(adshRows));
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
  const targetRows: NumRow[] = [];
  let numHeader: ReturnType<typeof tsvIndexer> | null = null;
  let numDataRows = 0;
  let numMatchedAdsh = 0;
  const ROW_CAP = 5000;

  const numRes = await streamEntry(
    url,
    numEntry,
    { deadlineMs: overallDeadline, maxInflatedBytes: 4096 * 1048576, ua },
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
      if (targetRows.length >= ROW_CAP) return;
      targetRows.push({
        adsh,
        tag: numHeader.get(f, "tag"),
        version: numHeader.get(f, "version"),
        ddate: numHeader.get(f, "ddate"),
        qtrs: numHeader.get(f, "qtrs"),
        uom: numHeader.get(f, "uom"),
        dimh: numHeader.get(f, "dimh"),
        dimn: numHeader.get(f, "dimn"),
        value: numHeader.get(f, "value"),
      });
    }
  );
  const numIdx = numHeader as ReturnType<typeof tsvIndexer> | null;

  // A hash of all zeros is XBRL's "no dimensions". Anything else is a real
  // dimension that SHOULD resolve in dim.tsv.
  const isUndimensioned = (h: string) => !h || /^0x0+$/.test(h);
  const allDimh = new Set(targetRows.map((r) => r.dimh).filter((h) => !isUndimensioned(h)));

  // Per tag: how many rows, and how many of them carry a dimension. This is the
  // evidence the old pre-filter destroyed -- it shows WHICH tags the
  // disaggregated rows are filed under, rather than assuming it is one of three.
  const byTag: Record<string, { rows: number; dimensioned: number; undimensioned: number }> = {};
  for (const r of targetRows) {
    const b = (byTag[r.tag] ??= { rows: 0, dimensioned: 0, undimensioned: 0 });
    b.rows++;
    if (isUndimensioned(r.dimh)) b.undimensioned++;
    else b.dimensioned++;
  }
  const dimensionedByTag = Object.entries(byTag)
    .filter(([, b]) => b.dimensioned > 0)
    .sort((a, b) => b[1].dimensioned - a[1].dimensioned);

  stages.D_num = {
    entry: numEntry.name,
    uncompressedMB: +(numEntry.uncompressedSize / 1048576).toFixed(1),
    ...numRes,
    dataRows: numDataRows,
    columns: numIdx?.cols ?? null,
    missingExpectedColumns: numIdx?.missing(["adsh", "tag", "ddate", "qtrs", "uom", "dimh", "value"]) ?? null,
    rowsForTarget: numMatchedAdsh,
    rowsKept: targetRows.length,
    rowsCapped: numMatchedAdsh > ROW_CAP,
    distinctTags: Object.keys(byTag).length,
    distinctDimensionHashes: allDimh.size,
    rowsCarryingADimension: targetRows.filter((r) => !isUndimensioned(r.dimh)).length,
    // EVERY tag with dimensioned rows, not just the revenue ones. If the
    // disaggregation is filed under a tag the revenue filter never matched,
    // it is visible here instead of being reported as absent.
    dimensionedRowsByTag: Object.fromEntries(dimensionedByTag.slice(0, 40)),
    // Verbatim, for comparison against dim.tsv's keys below. A padding, case or
    // 0x-prefix difference between the two sides is visible here at a glance and
    // no amount of counting would show it.
    sampleDimhValuesVerbatim: [...allDimh].slice(0, 8),
    sampleRowsVerbatim: targetRows.filter((r) => !isUndimensioned(r.dimh)).slice(0, 5),
  };

  // --- Stage E: dim.tsv -> the member labels, verbatim ---------------------
  //
  // THE JOIN KEY IS DISCOVERED, NOT ASSUMED. The previous run resolved 0 of 18
  // hashes, which is a join-failure signature rather than an absence signature:
  // irrelevant axes would resolve and then be filtered out as the wrong axis,
  // not fail to resolve at all. NUM and DIM do not necessarily spell the hash
  // column the same way, so the column is looked up by candidate name and the
  // one actually used is REPORTED -- making the join key part of the output
  // rather than an assumption inside it.
  const DIM_KEY_CANDIDATES = ["dimh", "dimhash", "dim_hash", "dimhashkey", "hash"];
  const dimRecords: Record<string, Record<string, string>> = {};
  const dimSampleVerbatim: Record<string, string>[] = [];
  const segtValues: Record<string, number> = {};
  let dimHeader: ReturnType<typeof tsvIndexer> | null = null;
  let dimKeyCol: string | null = null;
  let dimRows = 0;

  const dimRes = allDimh.size
    ? await streamEntry(
        url,
        dimEntry,
        { deadlineMs: overallDeadline, maxInflatedBytes: 1024 * 1048576, ua },
        (line, no) => {
          if (no === 1) {
            dimHeader = tsvIndexer(line);
            dimKeyCol = DIM_KEY_CANDIDATES.find((c) => dimHeader?.idx[c] !== undefined) ?? null;
            return;
          }
          dimRows++;
          if (!dimHeader || !dimKeyCol) return;
          const f = line.split("\t");
          const whole = Object.fromEntries(dimHeader.cols.map((c, i) => [c, f[i] ?? ""]));

          // The first few rows verbatim WHATEVER they are, so the two key
          // formats can be compared side by side even when nothing matches.
          if (dimSampleVerbatim.length < 5) dimSampleVerbatim.push(whole);

          // segt is in the column list and nothing read it before. Counted as a
          // distinct-value histogram, which is what says whether it is a flag,
          // a count or free text.
          const segt = dimHeader.get(f, "segt");
          if (segt !== "" && Object.keys(segtValues).length < 50) {
            segtValues[segt] = (segtValues[segt] ?? 0) + 1;
          }

          const key = dimHeader.get(f, dimKeyCol);
          if (!allDimh.has(key)) return;
          dimRecords[key] = whole;
          if (Object.keys(dimRecords).length >= allDimh.size && no > 6) return false;
        }
      )
    : null;
  const dimIdx = dimHeader as ReturnType<typeof tsvIndexer> | null;

  const segmentsOf = (h: string) => dimRecords[h]?.segments ?? dimRecords[h]?.SEGMENTS ?? "";
  const PRODUCT_AXIS = /ProductOrServiceAxis/i;
  const GEO_AXIS = /StatementGeographicalAxis/i;

  // Each hash gets ONE of three fates, and the distinction is the whole
  // question. "resolved 0 of 18" could not tell them apart.
  const hashClassification = [...allDimh].map((h) => {
    const rec = dimRecords[h];
    if (!rec) return { dimh: h, status: "not-in-dim.tsv" as const, segments: null };
    const seg = segmentsOf(h);
    const status = PRODUCT_AXIS.test(seg)
      ? ("resolved-product-axis" as const)
      : GEO_AXIS.test(seg)
        ? ("resolved-geography-axis" as const)
        : ("resolved-other-axis" as const);
    return { dimh: h, status, segments: seg, segt: rec.segt ?? null };
  });

  const notInDim = hashClassification.filter((c) => c.status === "not-in-dim.tsv");
  const resolved = hashClassification.filter((c) => c.status !== "not-in-dim.tsv");
  const productHashes = hashClassification.filter((c) => c.status === "resolved-product-axis");
  const geoHashes = hashClassification.filter((c) => c.status === "resolved-geography-axis");

  stages.E_dim = {
    entry: dimEntry.name,
    ...(dimRes ?? { skipped: "stage D found no dimensioned rows for this target at all" }),
    dataRows: dimRows,
    columns: dimIdx?.cols ?? null,
    // The join key, made visible. If this is null, dim.tsv carries none of the
    // candidate names and the join could never have worked.
    joinKeyColumnUsed: dimKeyCol,
    joinKeyCandidatesTried: DIM_KEY_CANDIDATES,
    numSideKeyColumn: "dimh",
    // Both sides of the join, verbatim, side by side.
    sampleDimRowsVerbatim: dimSampleVerbatim,
    segtDistinctValues: segtValues,
    segtNote:
      Object.keys(segtValues).length === 0
        ? "segt was empty on every sampled row"
        : `segt took ${Object.keys(segtValues).length} distinct value(s) across the rows read -- ${Object.keys(segtValues).length <= 3 ? "few enough that it is a flag or a small enumeration" : "many enough that it is a count or free text"}`,
    wanted: allDimh.size,
    resolved: resolved.length,
    notFound: notInDim.length,
  };

  // --- The actual go/no-go ------------------------------------------------
  //
  // VERDICT VOCABULARY. NO-GO is reserved for the one case it can honestly
  // describe: dimensions RESOLVED and none of them carry a product or
  // geography axis. Everything else is INCONCLUSIVE with the reason named.
  // Same rule as section 1's hide list -- a lookup that returns nothing is not
  // evidence that nothing exists.
  // REVENUE_TAGS is now an ANNOTATION, not a filter. It marks which recovered
  // splits sit on a revenue tag, which is what the Revenue Breakdown card
  // needs to know -- but it no longer decides what gets looked at, because that
  // is how the previous run concluded "absent" without ever testing the join.
  const isRevenueTag = (t: string) => REVENUE_TAGS.has(t.toLowerCase()) || /revenue/i.test(t);

  const rowsFor = (hashes: { dimh: string }[]) => {
    const set = new Set(hashes.map((h) => h.dimh));
    return targetRows.filter((r) => set.has(r.dimh));
  };
  const productRows = rowsFor(productHashes);
  const geoRows = rowsFor(geoHashes);
  const distinctMembers = (rows: NumRow[]) => [...new Set(rows.map((r) => segmentsOf(r.dimh)).filter(Boolean))];
  const productMembers = distinctMembers(productRows);
  const geoMembers = distinctMembers(geoRows);

  let verdict: string;
  if (!numRes.ok || numRes.truncated) {
    verdict = `INCONCLUSIVE -- num.tsv did not complete (${numRes.truncated ?? "read failed"}), so nothing here is evidence of absence.`;
  } else if (allDimh.size === 0) {
    verdict = `INCONCLUSIVE -- not one of ${numMatchedAdsh} rows for ${targetSymbol} carries a dimension hash. Before concluding anything about disclosures, check D_num.columns: if the NUM side has no 'dimh' column under that name, the hash was never read.`;
  } else if (!dimKeyCol) {
    verdict = `INCONCLUSIVE -- JOIN KEY NOT FOUND. dim.tsv carries none of ${DIM_KEY_CANDIDATES.join("/")}; its real columns are in E_dim.columns. The join could never have matched, so this says nothing about the filing.`;
  } else if (resolved.length === 0) {
    verdict = `INCONCLUSIVE -- JOIN FAILED, not absence. ${allDimh.size} dimension hashes were read from ${targetSymbol}'s rows and NONE matched dim.tsv on '${dimKeyCol}'. Genuinely irrelevant axes would resolve and then be filtered out as the wrong axis; failing to resolve at all is a key mismatch. Compare D_num.sampleDimhValuesVerbatim against E_dim.sampleDimRowsVerbatim.`;
  } else if (productMembers.length && geoMembers.length) {
    verdict = `GO -- both axes recovered: ${productMembers.length} product member(s) and ${geoMembers.length} geographic member(s).`;
  } else if (productMembers.length || geoMembers.length) {
    verdict = `PARTIAL -- ${productMembers.length ? "ProductOrServiceAxis" : "StatementGeographicalAxis"} recovered; the other resolved no members. ${resolved.length} of ${allDimh.size} hashes resolved, so the join works and this is a real observation about the filing.`;
  } else {
    verdict = `NO-GO -- ${resolved.length} of ${allDimh.size} hashes RESOLVED and none carries a product or geography axis. The join works, so this is a genuine statement about what this filing discloses. Axes actually present are in axisHistogram.`;
  }

  // SANITY ANCHOR. Apple's 10-K discloses revenue by five product lines and
  // five geographic segments. If the extraction cannot see roughly that in a
  // dataset that demonstrably contains the filing, the extraction is wrong --
  // "it returned something" is not the pass condition.
  const EXPECT_MIN = 4;
  const sanity =
    targetSymbol === "AAPL"
      ? {
          applies: true,
          expectation: `AAPL's 10-K discloses ~5 product lines (iPhone, Mac, iPad, Wearables, Services) and ~5 geographic segments (Americas, Europe, Greater China, Japan, Rest of Asia Pacific)`,
          productMembersFound: productMembers.length,
          geographyMembersFound: geoMembers.length,
          passes: productMembers.length >= EXPECT_MIN && geoMembers.length >= EXPECT_MIN,
          note:
            productMembers.length >= EXPECT_MIN && geoMembers.length >= EXPECT_MIN
              ? "Matches the known disclosure. The extraction is reading what the filing actually contains."
              : `Does NOT match the known disclosure (expected >=${EXPECT_MIN} of each). Treat this as a fault in the extraction, not a fact about Apple.`,
        }
      : { applies: false, note: `no known-answer anchor for ${targetSymbol}; only AAPL has one wired in` };

  const axisHistogram: Record<string, number> = {};
  for (const c of resolved) {
    for (const axis of (c.segments ?? "").match(/[A-Za-z]+Axis/g) ?? []) {
      axisHistogram[axis] = (axisHistogram[axis] ?? 0) + 1;
    }
  }

  return {
    month,
    url,
    ok: true,
    symbol: targetSymbol,
    cik: cikNumeric,
    verdict,
    sanityCheck: sanity,
    dimensionHashes: {
      total: allDimh.size,
      resolved: resolved.length,
      notInDimTsv: notInDim.length,
      resolvedButOtherAxis: resolved.length - productHashes.length - geoHashes.length,
      // Every hash with its fate and its verbatim segments string.
      classification: hashClassification,
    },
    axisHistogram,
    productSplits: productRows.slice(0, 60).map((r) => ({ tag: r.tag, isRevenueTag: isRevenueTag(r.tag), ddate: r.ddate, qtrs: r.qtrs, value: r.value, segments: segmentsOf(r.dimh) })),
    geographySplits: geoRows.slice(0, 60).map((r) => ({ tag: r.tag, isRevenueTag: isRevenueTag(r.tag), ddate: r.ddate, qtrs: r.qtrs, value: r.value, segments: segmentsOf(r.dimh) })),
    splitsOnRevenueTags: {
      product: productRows.filter((r) => isRevenueTag(r.tag)).length,
      geography: geoRows.filter((r) => isRevenueTag(r.tag)).length,
      note: "the axis decides recovery; this only says how many of the recovered rows sit on a revenue-named tag",
    },
    distinctProductMembers: productMembers,
    distinctGeographyMembers: geoMembers,
    // Renamed: the old `undimensionedRevenueRows` counted rows with no RESOLVED
    // segments string, which silently merged "no dimension" with "dimension did
    // not resolve" -- the two cases this whole section exists to separate.
    rowsWithNoDimension: targetRows.filter((r) => isUndimensioned(r.dimh)).length,
    rowsDimensionedButUnresolved: targetRows.filter((r) => !isUndimensioned(r.dimh) && !dimRecords[r.dimh]).length,
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
// 6. Refresh-pipeline shape (opt-in: sections=refresh)
// ---------------------------------------------------------------------------
//
// Four measurements that decide the SEC -> Upstash pipeline's shape before any
// of it is built. All read-only: no Redis, no writes, no FMP.
//
// NOTE ON THE SPEC. This section was briefed as answering
// claude/sec-pipeline-spec-2026-09-13.md. That file is NOT in this repo -- not
// on this branch and not on main -- so it was not read, and nothing here is
// derived from it. Everything below implements the 6a-6d text of the brief
// itself. See claude/traps/inference-about-a-source-you-cannot-open.md: the
// unreachable source is where inference is least safe and most tempting.

// --- 6a. Conditional requests ---------------------------------------------
//
// SEC's API documentation does not mention caching headers, so both answers are
// live and the brief is explicit about not assuming either.
//
// THE CONTROLS ARE THE POINT, and without them a 304 proves nothing. A server
// that echoes 304 at any conditional header would produce exactly the result
// that looks like good news -- "nightly full-universe verify is nearly free" --
// while actually serving stale data forever. So each conditional request is
// paired with a negative control that MUST come back 200:
//
//   If-None-Match: <the real ETag>        -> 304 means supported
//   If-None-Match: "definitely-not-it"    -> MUST be 200, or the 304 above is noise
//   If-Modified-Since: <real Last-Modified> -> 304 means supported
//   If-Modified-Since: 1990               -> MUST be 200, or the 304 above is noise
//
// Only when a control returns 200 does the matching 304 mean the header is
// genuinely being evaluated.

type CondStep = {
  step: string;
  requestHeader: string | null;
  status: number;
  ms: number;
  bodyBytes: number;
  bodyReturned: boolean;
  contentLength: string | null;
  note?: string;
};

// Body bytes are counted from the DECODED payload rather than trusted from
// content-length: the wire transfer is gzipped and a 304 legitimately carries
// no content-length at all, so the header cannot distinguish "no body" from
// "header absent".
async function measuredFetch(url: string, headers: Record<string, string>, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store", headers });
    const body = await res.arrayBuffer();
    return {
      status: res.status,
      ms: Date.now() - started,
      bodyBytes: body.byteLength,
      headers: res.headers,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeConditional(symbol: string, cik: string, ua: string) {
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
  const timeoutMs = 60000;
  const steps: CondStep[] = [];

  try {
    const base = await measuredFetch(url, secHeaders(ua), timeoutMs);
    const lastModified = base.headers.get("last-modified");
    const etag = base.headers.get("etag");
    steps.push({
      step: "baseline GET",
      requestHeader: null,
      status: base.status,
      ms: base.ms,
      bodyBytes: base.bodyBytes,
      bodyReturned: base.bodyBytes > 0,
      contentLength: base.headers.get("content-length"),
    });

    if (base.status !== 200) {
      return { symbol, cik, url, ok: false, reason: `baseline returned HTTP ${base.status}`, steps };
    }

    const run = async (step: string, header: Record<string, string>, note?: string) => {
      const r = await measuredFetch(url, { ...secHeaders(ua), ...header }, timeoutMs);
      steps.push({
        step,
        requestHeader: Object.entries(header).map(([k, v]) => `${k}: ${v}`)[0],
        status: r.status,
        ms: r.ms,
        bodyBytes: r.bodyBytes,
        bodyReturned: r.bodyBytes > 0,
        contentLength: r.headers.get("content-length"),
        note,
      });
      return r;
    };

    const imsReal = lastModified ? await run("If-Modified-Since = returned Last-Modified", { "if-modified-since": lastModified }) : null;
    const imsControl = lastModified
      ? await run("CONTROL If-Modified-Since = 1990", { "if-modified-since": "Mon, 01 Jan 1990 00:00:00 GMT" }, "must be 200, or the 304 above is meaningless")
      : null;
    const inmReal = etag ? await run("If-None-Match = returned ETag", { "if-none-match": etag }) : null;
    const inmControl = etag
      ? await run("CONTROL If-None-Match = bogus", { "if-none-match": '"definitely-not-the-etag"' }, "must be 200, or the 304 above is meaningless")
      : null;

    const imsWorks = imsReal?.status === 304 && imsControl?.status === 200;
    const inmWorks = inmReal?.status === 304 && inmControl?.status === 200;
    const controlFailed =
      (imsReal?.status === 304 && imsControl?.status === 304) || (inmReal?.status === 304 && inmControl?.status === 304);

    let verdict: string;
    if (controlFailed) {
      verdict =
        "UNUSABLE -- a negative control also returned 304, so this endpoint answers 304 regardless of the validator. Treat every 304 here as meaningless; a verify loop built on it would never see a correction.";
    } else if (imsWorks || inmWorks) {
      verdict = `CONDITIONAL REQUESTS SUPPORTED via ${[imsWorks ? "If-Modified-Since" : null, inmWorks ? "If-None-Match" : null].filter(Boolean).join(" and ")} -- 304 with an empty body, controls returned 200. A nightly full-universe verify costs headers only.`;
    } else if (!lastModified && !etag) {
      verdict = "NO VALIDATOR OFFERED -- the response carries neither Last-Modified nor ETag, so there is nothing to send back. Verify on a rotation, not nightly.";
    } else {
      verdict = `NOT SUPPORTED -- a validator is offered but the conditional request still returned a full body (${imsReal?.status ?? "n/a"} / ${inmReal?.status ?? "n/a"}). Every verify costs a full payload; use a 30-day rotation.`;
    }

    return {
      symbol,
      cik,
      url,
      ok: true,
      validatorsOffered: { lastModified, etag, hasLastModified: Boolean(lastModified), hasEtag: Boolean(etag) },
      // Which intermediary answered matters: a CDN can synthesise validators its
      // origin does not offer, and can also strip them. Populated from the
      // baseline response -- an unpopulated field here would read as "no CDN"
      // rather than "not measured".
      responseOrigin: {
        server: base.headers.get("server"),
        via: base.headers.get("via"),
        xCache: base.headers.get("x-cache"),
        age: base.headers.get("age"),
        cacheControl: base.headers.get("cache-control"),
      },
      steps,
      imsSupported: imsWorks,
      inmSupported: inmWorks,
      verdict,
    };
  } catch (err) {
    return { symbol, cik, url, ok: false, reason: describeError(err, timeoutMs), steps };
  }
}

// --- 6b / 6c. The EDGAR daily index ---------------------------------------
//
// www.sec.gov IS A DIFFERENT HOST from data.sec.gov and reachability is the
// question, not a formality -- the news probe measured Nasdaq answering
// everywhere except iad1. A failure here is reported as a failure.
//
// AND THE CONVERSE, which is just as easy to get wrong: EDGAR publishes no
// daily index on market holidays, so a 404 on Thanksgiving is the correct
// answer rather than a broken fetch. Absent-by-design and failed-to-fetch are
// separate outcomes with separate counts; collapsing them would either invent
// an outage or hide one.

function quarterOf(d: Date) {
  return Math.floor(d.getUTCMonth() / 3) + 1;
}

function businessDaysBack(n: number, from: Date): Date[] {
  const out: Date[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  while (out.length < n) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return out;
}

function idxUrl(d: Date) {
  const y = d.getUTCFullYear();
  const stamp = `${y}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  // The quarter is DERIVED, never hardcoded. The brief's example URL says QTR3,
  // which is right only for Jul-Sep -- a 30-day window run in early October
  // reaches back across the boundary and every pre-October day would 404 for a
  // reason that has nothing to do with reachability.
  return `https://www.sec.gov/Archives/edgar/daily-index/${y}/QTR${quarterOf(d)}/master.${stamp}.idx`;
}

type IdxDay = {
  date: string;
  url: string;
  // "refused" is PROVISIONAL. A 403 alone cannot say whether EDGAR published
  // nothing that day or whether we are blocked, so the outcome is settled by
  // probeDailyIndex once the whole window is in -- see classifyRefusals.
  outcome: "parsed" | "absent" | "failed" | "refused";
  refusalBodyBytes?: number;
  refusalBodyHead?: string;
  status?: number;
  ms?: number;
  bytes?: number;
  lines?: number;
  dataRows?: number;
  headerRows?: string[];
  columnLayout?: string | null;
  columnCount?: number | null;
  cikColumnAllNumeric?: boolean;
  sampleRows?: string[];
  formCounts?: Record<string, number>;
  targetsFound?: { symbol: string; cik: string; form: string; company: string }[];
  reason?: string;
};

async function fetchOneIdx(
  d: Date,
  targetCiks: Record<string, string>,
  captureDetail: boolean,
  ua: string
): Promise<IdxDay> {
  const url = idxUrl(d);
  const date = url.slice(-12, -4);
  const timeoutMs = 45000;
  try {
    const r = await timedFetch(url, timeoutMs, {
      "user-agent": ua,
      "accept-encoding": "gzip, deflate",
      accept: "text/plain,*/*",
    });
    if (r.status === 404) {
      // EXPECTED on a day with no publication. Not a failure.
      return { date, url, outcome: "absent", status: 404, ms: r.ms, bytes: r.bytes };
    }
    if (r.status === 403) {
      // MEASURED 2026-09-13: SEC serves 403 -- not 404 -- for a daily index
      // that does not exist. 20260907 (US Labor Day) came back 403 with a
      // 243-byte body and landed in `failures`, i.e. the bucket that means
      // www.sec.gov refused us, so every public holiday read as an outage.
      //
      // A 403 cannot be classified from the single response: the SAME status
      // means "nothing published that day" and "you are blocked". It is left
      // provisional here and settled across the window by classifyRefusals.
      return {
        date,
        url,
        outcome: "refused",
        status: 403,
        ms: r.ms,
        bytes: r.bytes,
        refusalBodyBytes: r.bytes,
        refusalBodyHead: r.body.slice(0, 200).replace(/\s+/g, " ").trim(),
      };
    }
    if (r.status !== 200) {
      return { date, url, outcome: "failed", status: r.status, ms: r.ms, bytes: r.bytes, reason: `HTTP ${r.status}` };
    }

    const lines = r.body.split("\n");
    // The header block ends at a rule of dashes; the line before it carries the
    // column names. Found by scanning rather than by a fixed line number, since
    // the preamble's length is not guaranteed.
    const ruleAt = lines.findIndex((l) => /^-{5,}/.test(l.trim()));
    // The column-name line is EXCLUDED from headerRows -- it is reported on its
    // own as columnLayout. The brief asks for the header rows and the exact
    // column layout as two separate things, and returning the column line in
    // both makes "3 preamble rows" read as 4.
    const headerRows = ruleAt > 1 ? lines.slice(0, ruleAt - 1).filter((l) => l.trim()) : [];
    const columnLayout = ruleAt > 0 ? (lines[ruleAt - 1] ?? "").trim() : null;
    const dataLines = lines.slice(ruleAt + 1).filter((l) => l.includes("|"));

    const formCounts: Record<string, number> = {};
    const targetsFound: { symbol: string; cik: string; form: string; company: string }[] = [];
    const byCik: Record<string, string> = {};
    for (const [sym, cik] of Object.entries(targetCiks)) byCik[String(Number(cik))] = sym;

    let cikNumeric = 0;
    for (const line of dataLines) {
      const f = line.split("|");
      if (f.length < 5) continue;
      const cik = f[0].trim();
      const company = f[1].trim();
      const form = f[2].trim();
      if (/^\d+$/.test(cik)) cikNumeric++;
      // VERBATIM. The form string is counted exactly as it appears, with no
      // normalising, uppercasing or suffix stripping -- 6c's whole question is
      // whether "/A" survives as part of this string.
      formCounts[form] = (formCounts[form] ?? 0) + 1;
      if (byCik[cik]) targetsFound.push({ symbol: byCik[cik], cik, form, company });
    }

    return {
      date,
      url,
      outcome: "parsed",
      status: r.status,
      ms: r.ms,
      bytes: r.bytes,
      lines: lines.length,
      dataRows: dataLines.length,
      headerRows: captureDetail ? headerRows : undefined,
      columnLayout,
      columnCount: columnLayout ? columnLayout.split("|").length : null,
      cikColumnAllNumeric: dataLines.length > 0 && cikNumeric === dataLines.length,
      sampleRows: captureDetail ? dataLines.slice(0, 3) : undefined,
      formCounts,
      targetsFound,
    };
  } catch (err) {
    return { date, url, outcome: "failed", reason: describeError(err, timeoutMs) };
  }
}

// A 403 on ONE day among many that parsed is a day with no EDGAR publication.
// A 403 on EVERY day is a block. The discriminator is the SPREAD across the
// window, not anything in the individual response -- which is why this cannot
// live in fetchOneIdx, and why the first version got Labor Day wrong.
//
// The body size corroborates it: a real index is megabytes, a refusal page is a
// few hundred bytes. Both signals are reported so the call is checkable rather
// than taken on trust, and neither is collapsed into the other.
const REFUSAL_BODY_MAX = 4096;

function classifyRefusals(results: IdxDay[]) {
  const refused = results.filter((r) => r.outcome === "refused");
  const parsedCount = results.filter((r) => r.outcome === "parsed").length;
  if (!refused.length) return { refused, reclassified: "none" as const, rule: "no 403 responses in this window" };

  const allSmall = refused.every((r) => (r.refusalBodyBytes ?? 0) <= REFUSAL_BODY_MAX);

  if (parsedCount === 0) {
    for (const r of refused) r.outcome = "failed";
    return {
      refused,
      reclassified: "blocked" as const,
      rule: `every day in the window returned 403 and none parsed -- this is a BLOCK on www.sec.gov, not a run of holidays`,
    };
  }

  for (const r of refused) r.outcome = (r.refusalBodyBytes ?? 0) <= REFUSAL_BODY_MAX ? "absent" : "failed";
  return {
    refused,
    reclassified: "noPublication" as const,
    rule:
      `${parsedCount} day(s) in the same window parsed normally, so www.sec.gov is answering; a 403 on a single date is EDGAR having published no index that day ` +
      `(a US market holiday or weekend). Bodies ${allSmall ? "all were" : "were NOT all"} under ${REFUSAL_BODY_MAX} bytes, which is the corroborating signal.`,
  };
}

async function probeDailyIndex(
  days: number,
  detailDays: number,
  targetCiks: Record<string, string>,
  deadline: number,
  ua: string
) {
  const dates = businessDaysBack(days, new Date());
  const results: IdxDay[] = [];
  let truncated: string | null = null;

  // Concurrency 4: enough to fit a month inside the budget, low enough to stay
  // well inside SEC's 10 requests/second fair-access limit.
  const POOL = 4;
  for (let i = 0; i < dates.length; i += POOL) {
    if (Date.now() > deadline) {
      truncated = `time budget exhausted after ${results.length} of ${dates.length} days`;
      break;
    }
    const batch = dates.slice(i, i + POOL);
    results.push(
      ...(await Promise.all(batch.map((d, k) => fetchOneIdx(d, targetCiks, i + k < detailDays, ua))))
    );
  }

  // Settle the provisional 403s before anything is counted.
  const refusalClassification = classifyRefusals(results);

  const parsed = results.filter((r) => r.outcome === "parsed");
  const absent = results.filter((r) => r.outcome === "absent");
  const failed = results.filter((r) => r.outcome === "failed");

  // --- 6c aggregate ---
  const allForms: Record<string, number> = {};
  for (const day of parsed) for (const [form, n] of Object.entries(day.formCounts ?? {})) allForms[form] = (allForms[form] ?? 0) + n;

  const amended = Object.entries(allForms).filter(([f]) => f.endsWith("/A"));
  const amendedTotal = amended.reduce((n, [, c]) => n + c, 0);
  const tenKA = allForms["10-K/A"] ?? 0;
  const tenQA = allForms["10-Q/A"] ?? 0;

  const layouts = [...new Set(parsed.map((d) => d.columnLayout).filter(Boolean))];
  const cikParseable = parsed.length > 0 && parsed.every((d) => d.cikColumnAllNumeric);

  const targets: Record<string, { date: string; form: string }[]> = {};
  for (const day of parsed) for (const t of day.targetsFound ?? []) (targets[t.symbol] ??= []).push({ date: day.date, form: t.form });

  return {
    // 6b
    reachability:
      parsed.length > 0
        ? `www.sec.gov REACHABLE from this function -- ${parsed.length} daily index files parsed`
        : failed.length > 0
          ? `www.sec.gov NOT REACHABLE or refusing -- ${failed.length} failures, 0 parsed. This is a failure, not an absence.`
          : "no files parsed and no failures -- every requested day was absent (404); widen the window",
    daysRequested: days,
    counts: { parsed: parsed.length, absentNoIndex: absent.length, failed: failed.length },
    // SEC answers 403 for a daily index that does not exist, so this is how a
    // holiday is told apart from a block. Read `rule` before trusting either.
    refusalClassification: {
      responsesWith403: refusalClassification.refused.length,
      verdict: refusalClassification.reclassified,
      rule: refusalClassification.rule,
      dates: refusalClassification.refused.map((r) => ({
        date: r.date,
        bodyBytes: r.refusalBodyBytes,
        bodyHead: r.refusalBodyHead,
        classifiedAs: r.outcome,
      })),
    },
    absentDates: absent.map((d) => d.date),
    failures: failed.map((d) => ({ date: d.date, status: d.status, reason: d.reason })),
    truncated,
    columnLayout: {
      distinctLayoutsSeen: layouts,
      stable: layouts.length <= 1,
      cikColumnAllNumericEveryDay: cikParseable,
      note: "master.idx is a 5-column pipe-delimited file. There is no amendment flag column -- the layout itself is the evidence for 6c that '/A' can only live inside the Form Type string.",
    },
    recentDaysDetail: results.slice(0, detailDays),
    targetSymbolsInWindow: targets,
    targetSymbolsAbsent: Object.keys(targetCiks).filter((s) => !targets[s]),

    // 6c
    amendments: {
      distinctFormTypes: Object.keys(allForms).length,
      totalFilings: Object.values(allForms).reduce((a, b) => a + b, 0),
      "10-K/A": tenKA,
      "10-Q/A": tenQA,
      allAmendedFormsVerbatim: Object.fromEntries(amended.sort((a, b) => b[1] - a[1])),
      amendedTotal,
      suffixIsVerbatim: amendedTotal > 0,
      verdict:
        parsed.length === 0
          ? "NOT MEASURED -- no index files were parsed, so this says nothing about amendments."
          : amendedTotal > 0
            ? `'/A' APPEARS VERBATIM as a suffix on the Form Type string: ${amendedTotal} amended filings across ${parsed.length} days, including ${tenKA} 10-K/A and ${tenQA} 10-Q/A. A restatement detector can match on the suffix.`
            : `NO '/A' SUFFIX in ${parsed.length} days of filings. Per the brief that means the PATTERN is wrong, not the market -- inspect topFormTypes below before building a detector on it.`,
      topFormTypes: Object.fromEntries(Object.entries(allForms).sort((a, b) => b[1] - a[1]).slice(0, 25)),
    },
  };
}

// --- 6d. Bulk archives ------------------------------------------------------
//
// HEAD plus a range-read of the ZIP index only. NOT buffered: companyfacts.zip
// and submissions.zip are gigabyte-scale, and the entry COUNT -- which is the
// number that decides one-download-vs-700-requests -- lives in the 22-byte
// end-of-central-directory record at the very end of the file.
//
// The central directory itself is deliberately NOT fetched whole. At roughly
// one entry per filer it runs to tens of MB, and the question here does not
// need it; a 64 KB sample gives real entry names to confirm the archive holds
// what its name claims.
//
// URLS ARE PROBED, NOT ASSUMED. SEC has moved these paths before, and a 404 on
// a guessed URL would read as "no bulk archive exists". Each candidate is
// reported with its own status so a wrong guess is visible as a wrong guess.
const BULK_CANDIDATES: { name: string; url: string }[] = [
  { name: "companyfacts.zip", url: "https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip" },
  { name: "submissions.zip", url: "https://www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip" },
  { name: "submissions.zip (alt path)", url: "https://www.sec.gov/Archives/edgar/daily-index/xbrl/submissions.zip" },
  { name: "companyfacts.zip (alt path)", url: "https://www.sec.gov/Archives/edgar/daily-index/bulkdata/companyfacts.zip" },
];

async function probeBulkArchive(name: string, url: string, ua: string) {
  const timeoutMs = 45000;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    const head = await fetch(url, { method: "HEAD", signal: controller.signal, cache: "no-store", headers: zipHeaders(ua) });
    clearTimeout(t);

    const contentLength = head.headers.get("content-length");
    const base = {
      name,
      url,
      status: head.status,
      ms: Date.now() - started,
      contentLength,
      sizeMB: contentLength ? +(Number(contentLength) / 1048576).toFixed(1) : null,
      lastModified: head.headers.get("last-modified"),
      acceptRanges: head.headers.get("accept-ranges"),
    };
    if (head.status !== 200 || !contentLength) {
      return { ...base, ok: false, reason: head.status === 200 ? "200 but no content-length; cannot range-read" : `HTTP ${head.status}` };
    }

    // EOCD only.
    const total = Number(contentLength);
    const tailLen = Math.min(65557, total);
    const tail = await rangeFetch(url, total - tailLen, total - 1, timeoutMs, ua);
    if (tail.status !== 206) {
      return { ...base, ok: true, rangeSupported: false, note: `server answered ${tail.status} to a Range request; a cold start would have to download all ${base.sizeMB} MB` };
    }

    // Starts at length-22 so the 4-byte read always fits; Math.min guards a
    // tail shorter than one EOCD record.
    let eocd = -1;
    for (let i = Math.min(tail.buf.length - 22, tail.buf.length - 4); i >= 0; i--) {
      if (readU32(tail.buf, i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd === -1) {
      return {
        ...base,
        ok: true,
        rangeSupported: true,
        zipFormat: "unrecognised" as const,
        note: "no EOCD signature in the tail -- not a plain ZIP, or a comment longer than 64 KB",
      };
    }

    let entryCount = readU16(tail.buf, eocd + 10);
    let cdSize = readU32(tail.buf, eocd + 12);
    let cdOffset = readU32(tail.buf, eocd + 16);
    let zip64 = false;
    let zip64LocatorFound = false;
    if (entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      zip64 = true;
      let loc = -1;
      for (let i = eocd - 20; i >= 0; i--) {
        if (readU32(tail.buf, i) === 0x07064b50) {
          loc = i;
          break;
        }
      }
      zip64LocatorFound = loc !== -1;
      if (loc !== -1) {
        const z64Offset = readU64(tail.buf, loc + 8);
        const z64 = await rangeFetch(url, z64Offset, z64Offset + 55, timeoutMs, ua);
        if (readU32(z64.buf, 0) === 0x06064b50) {
          entryCount = readU64(z64.buf, 32);
          cdSize = readU64(z64.buf, 40);
          cdOffset = readU64(z64.buf, 48);
        }
      }
    }

    // A 64 KB sample of the central directory, not the whole thing.
    const sampleLen = Math.min(65536, cdSize);
    const cdSample = await rangeFetch(url, cdOffset, cdOffset + sampleLen - 1, timeoutMs, ua);
    const sampled = parseCentralDirectory(cdSample.buf);

    return {
      ...base,
      ok: true,
      rangeSupported: true,
      // WHICH FORMAT WAS ACTUALLY FOUND. The classic 22-byte EOCD caps entry
      // count at 65535 and offsets at 4 GB; past either, the real numbers live
      // in a ZIP64 record that a ZIP64 locator points at. Reported because an
      // archive of ~800k filers cannot be a classic ZIP and reading it as one
      // would silently give a wrong entryCount.
      zipFormat: zip64 ? ("zip64" as const) : ("classic" as const),
      zip64LocatorFound: zip64 ? zip64LocatorFound : null,
      zip64,
      entryCount,
      centralDirectoryBytes: cdSize,
      centralDirectoryMB: +(cdSize / 1048576).toFixed(1),
      sampleEntryNames: sampled.entries.slice(0, 8).map((e) => e.name),
      sampleEntriesParsed: sampled.entries.length,
      sampleIsTruncated: sampleLen < cdSize,
      bytesActuallyFetched: tailLen + cdSample.buf.length,
      note: `entry count and sizes read from the archive index; ${base.sizeMB} MB was NOT downloaded`,
    };
  } catch (err) {
    // `status` is carried even here, as undefined. Without it the caller's
    // `b.status === 404` fails to typecheck against the union, and the
    // reflex fix -- a fake 0 -- would put a transport failure in the same
    // bucket as a real HTTP response.
    return { name, url, ok: false, status: undefined as number | undefined, reason: describeError(err, timeoutMs) };
  }
}

async function probeRefresh(
  symbols: string[],
  ciks: Record<string, { cik: string; title: string }>,
  opts: { condSymbols: number; idxDays: number; detailDays: number },
  deadline: number,
  ua: string
) {
  const condTargets = symbols.filter((s) => ciks[s]).slice(0, opts.condSymbols);
  const targetCiks = Object.fromEntries(symbols.filter((s) => ciks[s]).map((s) => [s, ciks[s].cik]));

  // SEQUENTIAL, not Promise.all. Run together these three put roughly ten
  // requests in flight at once, which is exactly SEC's fair-access ceiling of
  // 10 requests/second. A self-inflicted 429 or 403 would surface here as
  // "www.sec.gov is blocked from iad1" -- the precise false conclusion 6b was
  // added to rule out, manufactured by the probe measuring itself. The whole
  // section still fits the budget comfortably.
  const conditional = [];
  for (const s of condTargets) conditional.push(await probeConditional(s, ciks[s].cik, ua));

  const dailyIndex = await probeDailyIndex(
    opts.idxDays,
    opts.detailDays,
    targetCiks,
    Math.min(deadline, Date.now() + 150000),
    ua
  );

  const bulk = [];
  for (const c of BULK_CANDIDATES) bulk.push(await probeBulkArchive(c.name, c.url, ua));

  const condOk = conditional.filter((c) => c.ok);
  const agreement = [...new Set(condOk.map((c) => `${c.imsSupported}/${c.inmSupported}`))];

  return {
    "6a_conditionalRequests": {
      symbolsProbed: condTargets,
      // claude/traps/suspicious-uniformity.md in the other direction: here
      // uniformity is what SHOULD happen, since caching is a property of the
      // endpoint rather than the company. Disagreement between symbols means a
      // CDN edge is answering inconsistently and no single result is safe to
      // generalise from.
      consistentAcrossSymbols: agreement.length <= 1,
      results: conditional,
    },
    "6b_dailyIndex": dailyIndex,
    "6d_bulkArchives": {
      candidatesProbed: BULK_CANDIDATES.length,
      reachable: bulk.filter((b) => b.ok && b.status === 200).map((b) => b.name),
      notFound: bulk.filter((b) => b.status === 404).map((b) => b.name),
      results: bulk,
    },
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const FREE_SECTIONS = ["sec-facts", "sec-submissions", "stooq"];
const ALL_SECTIONS = [...FREE_SECTIONS, "datasets", "av", "refresh"];

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

  // WHICH AGENT, AND FROM WHERE. SEC_USER_AGENT does not propagate to Preview on
  // this project -- three redeploys did not fix it -- so every SEC section came
  // back 403 "Request Rate Threshold Exceeded", which is SEC's fair-access block
  // for an UNDECLARED agent rather than an actual rate limit. ?ua= overrides it
  // for this throwaway, key-guarded probe. Nothing is hardcoded: this repo is
  // public, and a contact address committed here would be committed forever.
  const rawQueryUa = (params.get("ua") ?? "").trim();
  const rawEnvUa = (process.env.SEC_USER_AGENT ?? "").trim();
  const uaSource: "query" | "env" | "none" = rawQueryUa ? "query" : rawEnvUa ? "env" : "none";
  const rawUa = uaSource === "query" ? rawQueryUa : uaSource === "env" ? rawEnvUa : "";
  const ua = sanitizeUa(rawUa) || SEC_UA_FALLBACK;

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
  const cikNeeded = sections.some(
    (s) => s === "sec-facts" || s === "sec-submissions" || s === "datasets" || s === "refresh"
  );
  const ciks = cikNeeded ? await resolveCiks(symbols, ua) : { map: {}, diag: { skipped: true } };
  if (cikNeeded) out.cikResolution = ciks.diag;

  if (sections.includes("sec-facts")) {
    out.companyFacts = await Promise.all(
      symbols.map((s) =>
        ciks.map[s]
          ? probeCompanyFacts(s, ciks.map[s].cik, cutoffMs, ua)
          : Promise.resolve({ symbol: s, ok: false, reason: "no CIK resolved -- not probed", concepts: null })
      )
    );
  }

  let submissionsBySymbol: Record<string, { filingDate: string; form: string }[]> = {};
  if (sections.includes("sec-submissions") || sections.includes("datasets")) {
    const subs = await Promise.all(
      symbols.map((s) =>
        ciks.map[s]
          ? probeSubmissions(s, ciks.map[s].cik, cutoffMs, ua)
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
    // DEFAULT AAPL, NOT ARM. The 2026-09-13 run returned ARM's forms as
    // ["20-F","6-K"] with zero 8-Ks: it is a foreign private issuer, and its
    // segment disclosures sit differently from the 10-K filers these datasets
    // are built around. Targeting it tested the wrong kind of filer. Override
    // with &datasetSymbol=.
    const target = params.get("datasetSymbol")?.toUpperCase() || "AAPL";
    const filings = submissionsBySymbol[target] ?? [];
    const annual = filings.find((f) => /^(10-K|20-F)/.test(f.form)) ?? filings[0];
    // A target whose forms carry no 10-K is a foreign private issuer. Flagged
    // rather than silently probed, since an empty result for such a filer would
    // read as "the axes are not recoverable" when it means "wrong filer type".
    const forms = [...new Set(filings.map((f) => f.form))];
    const isForeignPrivateIssuer = forms.length > 0 && !forms.some((f) => f.startsWith("10-K"));
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
        target,
        targetForms: forms,
        foreignPrivateIssuerWarning: isForeignPrivateIssuer
          ? `${target} files ${forms.join("/")} and no 10-K -- it is a foreign private issuer. These datasets are built around 10-K filers, so an empty result here means WRONG FILER TYPE, not "the axes are not recoverable". Re-run with &datasetSymbol=AAPL or MU.`
          : null,
        monthDerivedFrom: params.get("month")
          ? "explicit &month= parameter"
          : `${target}'s ${annual?.form} filed ${annual?.filingDate}`,
        ...(await probeDataSets(month, target, ciks.map[target].cik, overallDeadline, ua)),
      };
    }
  }

  if (sections.includes("refresh")) {
    out.refresh = await probeRefresh(
      symbols,
      ciks.map,
      {
        // Two symbols by default for 6a, not five. Each conditional test costs a
        // baseline plus two negative controls that MUST return a full ~4 MB
        // body, so five symbols is ~100 MB spent re-confirming a property of the
        // endpoint. Two is enough to catch an inconsistent CDN edge, which is
        // the only per-symbol variation there could be.
        condSymbols: Math.max(1, Math.min(5, Number(params.get("condSymbols") ?? 2))),
        idxDays: Math.max(1, Math.min(60, Number(params.get("idxDays") ?? 30))),
        detailDays: Math.max(1, Math.min(10, Number(params.get("detailDays") ?? 5))),
      },
      overallDeadline,
      ua
    );
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
      // The value itself is NEVER echoed -- it carries an email address and this
      // output gets pasted around. These four fields describe whichever source
      // was actually used for the requests above, not the env var specifically,
      // so `set: true` with `source: "query"` means the header really was sent.
      secUserAgent: {
        source: uaSource,
        set: Boolean(rawUa),
        hasContact: rawUa.includes("@"),
        length: rawUa.length,
        // A value that needed stripping is reported rather than silently used:
        // a mangled agent is exactly as blocked as a missing one, and the 403
        // would otherwise look like SEC rather than like the parameter.
        sanitized: rawUa !== sanitizeUa(rawUa),
        note:
          uaSource === "none"
            ? "NEITHER ?ua= NOR SEC_USER_AGENT is set. Requests went out with a placeholder carrying no contact address, which SEC blocks with 403 'Request Rate Threshold Exceeded' -- read that as an undeclared agent, not a rate limit."
            : `User-Agent taken from ${uaSource === "query" ? "the ?ua= parameter" : "SEC_USER_AGENT"}${rawUa.includes("@") ? "" : " -- WARNING: it carries no @, and SEC's fair-access policy requires a contact address"}`,
      },
      alphaVantageKey: { set: Boolean(AV_KEY) },
      quarterWindowStart: new Date(cutoffMs).toISOString().slice(0, 10),
      readingGuide: {
        hideList:
          "companyFacts[].trueHideList is the answer to the brief's question -- missingOrEmpty minus the tags whose alternate spelling IS populated. Read presentButNotQuarterly separately: those are concepts that exist but have no quarterly series, which is a different remedy (derive Q4 from FY minus 9M), not a hidden column.",
        failureVsAbsence:
          "A symbol with ok:false has concepts:null. It contributes NOTHING to any hide list -- a fetch failure is not evidence that a concept is missing.",
        timezone:
          "submissions[].acceptanceAnalysis.timezoneVerdict is FITTED: every candidate offset 0-23h is scored on how well it explains the observed filingDate rollovers against EDGAR's 17:30 ET cutoff. It does not read the trailing Z. Check offsetFit.best.agreement (want ~1.0), offsetFit.rolloverObservations (want well above 5) and offsetFit.tiedWith (want empty) before trusting the verdict.",
        refresh:
          "6a: a 304 means nothing unless its CONTROL row returned 200 -- check steps[] for the two rows labelled CONTROL before believing imsSupported/inmSupported. 6b: absentNoIndex (404 on a market holiday) is a normal outcome and is counted separately from failures; only `failures` means www.sec.gov refused. 6c: amendments.suffixIsVerbatim false means the '/A' pattern is wrong, not that the market filed no amendments -- read topFormTypes. 6d: entryCount and sizes come from the ZIP index; the archives themselves were never downloaded.",
        datasets:
          "dataSets.stages A and B answer the feasibility question on their own and cost about a second. Stage D is the one that can be truncated -- if stages.D_num.truncated is set, a null result in productSplits/geographySplits means NOT MEASURED, not absent.",
      },
      ...out,
    },
    { headers: { "cache-control": "no-store" } }
  );
}
