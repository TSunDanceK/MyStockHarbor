// The sidebar earnings snapshot, on SEC filings — the payload, not the card.
//
// ── WHAT THIS REPLACED ────────────────────────────────────────────────────
// app/components/LatestEarningsCard.tsx used to take `LatestEarningsData` from
// lib/latest-earnings-data.ts: FMP's stable/earnings rows plus an income
// statement, with epsEstimated/revenueEstimated/surprise on every one of them.
// Those estimate fields left with the FMP licence on 2026-09-15 — the earnings
// page already hides them (RETIRED_SOURCES in secEarningsView.ts) — and the
// card was still drawing them beside figures the filings do carry.
//
// ── WHY THE PAYLOAD IS PLAIN NUMBERS AND STRINGS ──────────────────────────
// LatestEarningsCard is imported by StockSymbolPageClient.tsx, a "use client"
// module, so the card ships in the browser bundle. It therefore cannot import
// anything from lib/server at RUNTIME: secEarningsView reaches secCurrency
// reaches fxRates reaches Redis, and pulling that chain into a client bundle
// fails the build.
//
// So every ViewCell, Pct and PeriodBasis is resolved HERE, on the server, into
// a number, a string or null. The card imports this module's TYPES only
// (`import type`, which erases) and formats what it is handed. That is also
// why the tone is resolved to a word and a colour key rather than passed as a
// live scorer result.
//
// ── THE TONE IS THE PAGE'S TONE ───────────────────────────────────────────
// `scoreFromSec` is the one in lib/server/secEarningsScore.ts — the same
// function /stock/[symbol]/earnings runs for its gauge. The sidebar card and
// the full report therefore cannot disagree about the same filing, which they
// would within a week of anyone tuning either copy. See that module's header.
import {
  EMPTY_REASONS, buildSecEarningsView, conversionNote, filingCreditText, filingNoticeText, isPct,
  type PeriodBasis, type Pct, type SecEarningsView, type ViewCell,
} from "./secEarningsView";
import { resolveFactSetForRender, type ColdResult } from "./secColdFetch";
import { buildProfileDividend, type ProfileDividend } from "./secDividend";
import { readReportDatesChecked, latestResults, type ReportDatesRead } from "./secReportDatesStore";
import { compactOutlook, outlookFromRead, type CompactOutlook } from "./symbolOutlook";
import {
  multipleInputs, valuationInputs, type MultipleInputs, type ValuationInputs,
} from "./secValuation";
import { buildShareHistory, type ShareHistory } from "./secShareHistory";
import { registrantFor } from "./stockProfile";
import {
  TIMING_WORDING, type ReportTiming,
} from "./secReportDates";
import {
  coverageOf, scoreFromSec, toneLabel, type EarningsTone,
} from "./secEarningsScore";
import { partialScoreLabel, partialScoreShortNote } from "./secPresentation";

/**
 * ── FIELDS DROPPED FROM THIS CARD. HIDDEN, NOT REMOVED. ───────────────────
 *
 * The owner's standing rule, and deliberately the SAME five sources the
 * earnings page registers in RETIRED_SOURCES — because they are the same five.
 * The card was showing "Estimated EPS", "EPS surprise", "Revenue estimate" and
 * "Revenue surprise" on /stock/[symbol] and /stock/[symbol]/news while
 * /stock/[symbol]/earnings, one click away, had already stopped: the same
 * reader could see a beat-or-miss in the sidebar and no consensus at all in
 * the full report.
 *
 * A ZERO IS THE SPECIFIC THING TO AVOID, and it is what the old card rendered
 * once FMP stopped returning estimates. `formatMoney(null)` gives an em dash,
 * which is survivable; but `epsSurprise` arrives as a NUMBER computed from a
 * null estimate in several of FMP's shapes, and "EPS surprise: $0.00 · +0.0%"
 * reads as "came in exactly in line". That is a claim, and a false one.
 *
 * WHY THE REGISTRY IS HERE AND NOT IN THE CARD: this is where the fields would
 * have to be reintroduced. A card cannot render a field its payload does not
 * carry, so the payload type is the honest place to record why it does not.
 */
export type RetiredSnapshotField = {
  id: string;
  /** The label the card used to print. */
  label: string;
  /** What used to supply it. */
  source: string;
  /** When it stopped being shown here. */
  retiredOn: string;
  /** One short sentence, no jargon. */
  reason: string;
};

export const RETIRED_SNAPSHOT_FIELDS: RetiredSnapshotField[] = [
  {
    id: "eps-estimate",
    label: "Estimated EPS",
    source: "FMP stable/earnings epsEstimated",
    retiredOn: "2026-09-21",
    reason:
      "Analyst estimates are not published by the SEC and no free source covers them.",
  },
  {
    id: "eps-surprise",
    label: "EPS surprise",
    source: "FMP stable/earnings epsActual − epsEstimated",
    retiredOn: "2026-09-21",
    reason:
      "A surprise is a comparison against an estimate, so it goes with the estimate.",
  },
  {
    id: "revenue-estimate",
    label: "Revenue estimate",
    source: "FMP stable/earnings revenueEstimated",
    retiredOn: "2026-09-21",
    reason:
      "Analyst estimates are not published by the SEC and no free source covers them.",
  },
  {
    id: "revenue-surprise",
    label: "Revenue surprise",
    source: "FMP stable/earnings revenueActual − revenueEstimated",
    retiredOn: "2026-09-21",
    reason:
      "A surprise is a comparison against an estimate, so it goes with the estimate.",
  },
  {
    id: "guidance",
    label: "Guidance summary",
    source: "FMP income statement + earnings-call metadata",
    retiredOn: "2026-09-21",
    reason:
      "Company guidance appears in 8-K exhibits as prose, not as structured data, " +
      "so there is nothing to read it from.",
  },
  {
    id: "recent-trend-dots",
    label: "Recent earnings trend",
    source: "FMP stable/earnings, scored on EPS and revenue surprise per quarter",
    retiredOn: "2026-09-21",
    reason:
      "Each dot's colour was a beat-or-miss against consensus, so the row is the " +
      "estimate fields again in a different shape.",
  },
  {
    id: "yearly-read",
    label: "Yearly earnings read",
    source: "FMP stable/earnings, surprise tones aggregated per fiscal year",
    retiredOn: "2026-09-21",
    reason: "Built from the same per-quarter surprise tones as the trend row above.",
  },
];

const RETIRED_SNAPSHOT_IDS = new Set(RETIRED_SNAPSHOT_FIELDS.map((f) => f.id));

/** Validated for its throw. An unregistered id is a programming error. */
export const retiredSnapshotField = (id: string): RetiredSnapshotField => {
  const found = RETIRED_SNAPSHOT_FIELDS.find((f) => f.id === id);
  if (!found) throw new Error(`Unregistered retired snapshot field: ${id}`);
  return found;
};

export const isRetiredSnapshotField = (id: string) => RETIRED_SNAPSHOT_IDS.has(id);

/**
 * ONE FILED FIGURE, FLATTENED FOR THE CLIENT.
 *
 * `derivedNote` is carried and `derived` is not: the card shows the note and
 * never branches on the tag, and shipping both is two spellings of one fact.
 */
export type SnapshotFigure = {
  value: number | null;
  /** Two-decimal, price-like formatting. True for EPS. See ViewCell.perShare. */
  perShare: boolean;
  /** "Derived by differencing…" or null. Rendered as a footnote, not a badge. */
  derivedNote: string | null;
  /**
   * WHY THERE IS NO VALUE, in a few words — set exactly when `value` is null.
   *
   * ABVX's card was five em dashes and one number. A dash says "we don't
   * know", and for most of those tiles the page DOES know: Q4 EPS is never
   * filed on its own, the company has no revenue line, and a margin cannot be
   * taken without revenue. Each of those is a different fact and a reader is
   * owed the one that applies (brief 2026-09-22 §1.2 item 2).
   */
  emptyReason: string | null;
};

const figure = (c: ViewCell, emptyReason: string | null = null): SnapshotFigure => ({
  value: c.val,
  perShare: c.perShare,
  derivedNote: c.derivedNote,
  emptyReason: c.val === null ? emptyReason ?? NOT_CAPTURED : null,
});

// EMPTY_REASONS lives in secEarningsView now, so the earnings page's cards
// print the same words for the same blanks. See its docblock there.
const NOT_CAPTURED = EMPTY_REASONS.notCaptured;

/**
 * A percentage the card can print, or the reason it cannot.
 *
 * ── WHY THIS IS NOT `number | null` ───────────────────────────────────────
 * `Pct` in secEarningsView is `number | PctCrossing | null`, where a crossing
 * is "turned-profitable", "swung-to-loss" or "loss-both" — a growth rate
 * across a sign change is not a number and printing one is how KGC's swing out
 * of a loss became "+1,240%". The card has to be able to say the words, so the
 * distinction survives flattening instead of collapsing to null.
 */
export type SnapshotPct =
  | { kind: "pct"; value: number }
  | { kind: "crossing"; words: string }
  | { kind: "none" };

/**
 * The next report: the SAME answer the /earnings-calendar search and the
 * earnings page's card give, cut to its headline and hedge.
 *
 * This was `{ kind: "date"; date } | { kind: "month"; month } | { kind: "none" }`
 * off estimateNextReport, and the tile printed "22 Oct 2026 · Estimated from
 * its last 15 reports" (TSLA, live). Owner decision 2026-09-23: the 30-day band
 * is the only forward claim anywhere on the site. The sentences are composed in
 * lib/server/symbolOutlook.ts and arrive finished; there is no date field left
 * on this type for a component to format.
 */
export type SnapshotNextReport = CompactOutlook;

export type SecEarningsSnapshot = {
  symbol: string;
  /**
   * Whether there are FIGURES to draw. False is a real and common state — a
   * symbol whose filings have not been read in, a non-USD filer, an ETF — and
   * the card renders `unavailableReason` instead of a grid of em dashes.
   */
  available: boolean;
  /** Why not, in the same words /stock/[symbol]/earnings uses. Null when available. */
  unavailableReason: string | null;

  /** The score's band. "neutral" is the seed, not a reading, when unavailable. */
  tone: EarningsTone;
  /**
   * "Good" / "Mixed" / "Weak", or "Unavailable" — or, when not every input
   * ran, "Partial · N of 5 measured". Never a bare verdict on a partial score.
   */
  toneLabel: string;
  /**
   * TRUE WHEN THE SCORE RAN ON SOME INPUTS ONLY. The card then drops the
   * verdict colour, the same rule the full report applies: on ABVX the reach
   * was 34 to 66, entirely inside MIXED, so the amber was decided by what is
   * missing rather than by the company. From coverageOf, the ONE computation
   * both surfaces call.
   */
  partial: boolean;
  /**
   * partialScoreShortNote's one sentence, or null when the score is not
   * partial. The full note with the reachable range stays on the earnings page.
   */
  partialNote: string | null;
  /** 0-100, or null when the score could not run. NEVER 50-as-a-reading. */
  score: number | null;

  /** Whether the figures below are quarters or fiscal years. */
  basis: PeriodBasis;
  /** "Q3 FY2026". Null when unavailable. */
  periodLabel: string | null;
  periodEnd: string | null;
  /** The period the YoY percentages are measured against. */
  comparedWith: string | null;

  /**
   * When the company REPORTED, and how that date was arrived at.
   *
   * "announcement" is the 8-K Item 2.02 (or 6-K) date from the shared store —
   * the day the figures reached the market. "filing" is the 10-Q/10-K
   * acceptance date, which can be days later. They are different events and
   * the card says which one it has rather than printing both as "reported".
   */
  reportedOn: string | null;
  reportedVia: "announcement" | "filing" | null;
  /** "Results filed after the close" etc. Only ever set alongside an announcement. */
  reportedTimingNote: string | null;
  nextReport: SnapshotNextReport;

  eps: SnapshotFigure;
  /**
   * The fiscal year's diluted EPS under a blank derived-Q4 tile, labelled with
   * its year. See SecEarningsView.snapshot.fyEpsDiluted. Owner may veto.
   */
  epsFullYear: { label: string; value: number } | null;
  epsYoY: SnapshotPct;
  revenue: SnapshotFigure;
  revenueYoY: SnapshotPct;
  netIncome: SnapshotFigure;
  /** Percentages, already computed by the view. Null where the inputs are absent. */
  margins: { gross: number | null; operating: number | null; net: number | null };
  /** Per margin, why it is blank. Null where the margin has a value. */
  marginReasons: { gross: string | null; operating: string | null; net: string | null };

  /** Set only for a filer that reports in another currency. */
  currencyNote: string | null;
  /**
   * "From the 10-Q filed 29 Jul 2026…" when the newest period was read from
   * the filing because SEC's data feed lagged it. Null otherwise.
   */
  filingCredit: string | null;
  /**
   * "Results for the quarter ended … were filed with the SEC on …; the figures
   * are not in SEC's data feed yet" — only when NEITHER the feed nor the filing
   * parse gave the newer period. Null otherwise.
   */
  filingNotice: string | null;
  sourceNote: string;
};

const pct = (p: Pct, crossingWords: (p: Pct) => string | null): SnapshotPct => {
  if (isPct(p)) return { kind: "pct", value: p };
  const words = crossingWords(p);
  return words ? { kind: "crossing", words } : { kind: "none" };
};

const EMPTY_FIGURE: SnapshotFigure = { value: null, perShare: false, derivedNote: null, emptyReason: null };

/**
 * THE SNAPSHOT, FROM A VIEW AND A SCORE — pure, so a check can mutate it.
 *
 * Kept separate from `getSecEarningsSnapshot` below for the same reason
 * buildSecEarningsView is separate from the page: the rules about which number
 * is which are the part that has to be checkable, and they must not require a
 * Redis round trip to run. scripts/check-earnings-snapshot.mjs calls this with
 * committed fixtures.
 */
export function buildSecEarningsSnapshot(args: {
  symbol: string;
  view: SecEarningsView | null;
  score: ReturnType<typeof scoreFromSec>;
  reported: { on: string; via: "announcement" | "filing"; timing: ReportTiming | null } | null;
  nextReport: SnapshotNextReport;
}): SecEarningsSnapshot {
  const { symbol, view, score, reported, nextReport } = args;
  const coverage = coverageOf(score);

  const base = {
    symbol,
    // A SCORE THE SCORER REFUSED IS NOT A NUMBER. scoreFromSec returns 50 on
    // its unavailable branch because its shape requires one, and its own
    // docblock says 50 is the neutral seed rather than a reading. Carrying it
    // through as a number would put "50" on the card under a Mixed pill, which
    // is a measurement the filings never supplied.
    score: score.available ? score.score : null,
    tone: score.tone,
    toneLabel: coverage?.partial
      ? partialScoreLabel(coverage)
      : score.available ? toneLabel(score.tone) : "Unavailable",
    partial: Boolean(coverage?.partial),
    partialNote: coverage?.partial
      ? partialScoreShortNote(coverage, score.available ? score.unavailableWhy : [])
      : null,
    reportedOn: reported?.on ?? null,
    reportedVia: reported?.via ?? null,
    reportedTimingNote:
      reported?.via === "announcement" && reported.timing
        ? TIMING_WORDING[reported.timing]
        : null,
    nextReport,
  };

  if (!view) {
    return {
      ...base,
      available: false,
      unavailableReason: score.explanation,
      basis: "quarter",
      periodLabel: null,
      periodEnd: null,
      comparedWith: null,
      eps: EMPTY_FIGURE,
      epsFullYear: null,
      epsYoY: { kind: "none" },
      revenue: EMPTY_FIGURE,
      revenueYoY: { kind: "none" },
      netIncome: EMPTY_FIGURE,
      margins: { gross: null, operating: null, net: null },
      marginReasons: { gross: null, operating: null, net: null },
      currencyNote: null,
      filingCredit: null,
      filingNotice: null,
      sourceNote: snapshotSourceNote(null),
    };
  }

  const s = view.snapshot;
  // THE NEWEST MARGIN ROW, which is the one belonging to this snapshot's own
  // period. `margins` is oldest-first, so this is .at(-1) and not [0]; taking
  // the first row would caption the oldest quarter's margins with the newest
  // quarter's label, and both are plausible percentages.
  const m = view.margins.at(-1) ?? null;
  const margins = m
    ? { gross: m.gross, operating: m.operating, net: m.net }
    : { gross: null, operating: null, net: null };

  // ── WHY A TILE IS BLANK, decided from what the set records ──────────────
  // A derived Q4 never carries EPS: EPS is a ratio and is not differenced
  // (FieldKind "duration-ratio"). `untagged` is the extraction-time marker —
  // null on a set written before it existed, and then no tile claims it.
  const untagged = new Set(view.untagged ?? []);
  const derivedQ4 = view.basis === "quarter" && /^Q4 /.test(view.latestLabel);
  const epsReason = derivedQ4 ? EMPTY_REASONS.q4NotFiled : null;
  const revenueReason = untagged.has("revenue") ? EMPTY_REASONS.noRevenueLine : null;
  const noRevenue = s.revenue.val === null;
  // A REVENUE LINE THE FILINGS TAG ONLY IN PART refuses every margin by name
  // (secEarningsView.revenueLineIncomplete) rather than printing 420%.
  const refused = Boolean(m?.marginsRefused);
  const marginReason = (v: number | null) =>
    refused ? EMPTY_REASONS.revenueIncomplete
      : v !== null ? null : noRevenue ? EMPTY_REASONS.needsRevenue : NOT_CAPTURED;
  const fy = s.fyEpsDiluted;

  return {
    ...base,
    available: true,
    unavailableReason: null,
    basis: view.basis,
    periodLabel: view.latestLabel,
    periodEnd: view.latestEnd,
    comparedWith: s.comparedWith,
    eps: figure(s.epsDiluted, epsReason),
    epsFullYear: fy && fy.cell.val !== null ? { label: fy.label, value: fy.cell.val } : null,
    epsYoY: pct(s.epsYoY, crossingWords),
    revenue: figure(s.revenue, revenueReason),
    revenueYoY: pct(s.revenueYoY, crossingWords),
    netIncome: figure(s.netIncome),
    margins,
    marginReasons: {
      gross: marginReason(margins.gross),
      operating: marginReason(margins.operating),
      net: marginReason(margins.net),
    },
    currencyNote: view.currency ? conversionNote(view.currency) : null,
    filingCredit: view.latestFromFiling ? filingCreditText(view.latestFromFiling) : null,
    filingNotice: view.filedNotInFeed ? filingNoticeText(view.filedNotInFeed) : null,
    sourceNote: snapshotSourceNote(view.accounting),
  };
}

/**
 * The footer, naming the standard the figures were actually read under.
 *
 * IT WAS A CONSTANT, AND IT SAID "US GAAP" ON IFRS FILERS. ABVX and AZN file
 * under IFRS (`ifrs-full` is the only financial namespace in either payload,
 * relay 35764672279), and the card told their readers otherwise. Null — a set
 * written before the namespace census — names no standard rather than guess.
 */
export function snapshotSourceNote(accounting: "IFRS" | "US GAAP" | null): string {
  const basis = accounting ? `${accounting}, as filed` : "as filed";
  return (
    `Reported figures from the company's own SEC filings (${basis}). ` +
    "Analyst estimates and beat-or-miss are not shown — no free source publishes them."
  );
}

/** The footer for a US GAAP filer — what the constant used to say everywhere. */
export const SNAPSHOT_SOURCE_NOTE = snapshotSourceNote("US GAAP");

/**
 * The crossing words, spelled out for a card that has no room for a footnote.
 *
 * CROSSING_WORDS in secEarningsView is keyed by the crossing and phrased for a
 * table cell ("into profit"). The sidebar prints the phrase on its own, where
 * "into profit" with no subject reads as a fragment, so the subject comes with
 * it here rather than being reconstructed at the call site.
 */
function crossingWords(p: Pct): string | null {
  if (p === "turned-profitable") return "turned profitable";
  if (p === "swung-to-loss") return "swung to a loss";
  if (p === "loss-both") return "loss in both periods";
  return null;
}

/**
 * Read everything the snapshot needs and build it.
 *
 * TWO ROUND TRIPS, BOTH OF WHICH /stock/[symbol] AND /stock/[symbol]/news
 * WERE ALREADY MAKING in a different shape — this replaces
 * getLatestEarningsData's FMP calls rather than adding to them.
 */
export async function getSecEarningsSnapshot(symbol: string): Promise<SecEarningsSnapshot> {
  const clean = symbol.trim().toUpperCase();
  const [cold, dates] = await Promise.all([
    resolveFactSetForRender(clean),
    readReportDatesChecked(clean).catch((): ReportDatesRead => ({ ok: false })),
  ]);
  return snapshotFrom(clean, cold, dates);
}

/**
 * The stock page needs TWO things out of one fact set. This reads it once.
 *
 * ── WHY THIS EXISTS RATHER THAN TWO CALLS ────────────────────────────────
 * The obvious shape is `getSecEarningsSnapshot(sym)` and
 * `getProfileDividend(sym)` side by side in the page's Promise.all, and the
 * first draft was exactly that, with a comment claiming the second read came
 * free because secColdFetch dedupes an in-flight read per symbol.
 *
 * IT DOES NOT. `resolveFactSetForRender` calls `readFactSet` unconditionally —
 * there is no in-flight map in that module, unlike `getDailyHistory`, which
 * has one and is probably where the belief came from. Two calls are two Redis
 * reads of the same ~15 KB value, on the most-crawled route on the site, for
 * data that cannot have changed between them.
 *
 * So the read happens once here and both answers are derived from it. Same
 * shape as the earnings page's bars: one read, two shapes of answer.
 */
export async function getStockPageSecFacts(symbol: string): Promise<{
  snapshot: SecEarningsSnapshot;
  dividend: ProfileDividend;
  profileFacts: StockPageProfileFacts;
}> {
  const clean = symbol.trim().toUpperCase();
  const [cold, dates] = await Promise.all([
    resolveFactSetForRender(clean),
    readReportDatesChecked(clean).catch((): ReportDatesRead => ({ ok: false })),
  ]);
  const set = cold.status === "ready" ? cold.set : null;
  return {
    snapshot: snapshotFrom(clean, cold, dates),
    dividend: buildProfileDividend(set),
    // ── AND NOW THE PROFILE BLOCK'S FILED HALF, FROM THE SAME READ ─────────
    // "One fact-set read, two answers" became three (brief 2026-09-22 §2.1):
    // the market-cap numerator, the share-dilution series and the filer's own
    // name all come out of the object already in hand. A second read for them
    // would be the double-read this function exists to prevent.
    profileFacts: {
      valuation: set
        ? valuationInputs(set, new Date().toISOString().slice(0, 10), {
            annualForm: registrantFor(clean)?.annualForm ?? null,
          })
        : null,
      shareHistory: buildShareHistory(set),
      entityName: set?.entityName ?? null,
      // The Valuation section's filed inputs — revenue, EBITDA and the latest
      // balance sheet (owner addendum, brief 2026-09-22 PR 2).
      multiples: set ? multipleInputs(set) : null,
    },
  };
}

/** The /stock profile block's inputs that come from the stored SEC set. */
export type StockPageProfileFacts = {
  /** Cover-page shares and twelve-month EPS; the page multiplies by its own price. */
  valuation: ValuationInputs | null;
  shareHistory: ShareHistory | null;
  entityName: string | null;
  multiples: MultipleInputs | null;
};

function snapshotFrom(
  clean: string,
  cold: ColdResult,
  read: ReportDatesRead
): SecEarningsSnapshot {
  const dates = read.ok ? read.rec : null;
  const view = cold.status === "ready" ? buildSecEarningsView(cold.set) : null;
  const score = scoreFromSec(view, clean, cold);

  // ── WHICH DATE THE CARD CALLS "REPORTED" ────────────────────────────────
  //
  // Preferred: the announcement the filer made, from the shared store. Only a
  // MATCHED event is stored, and `latestResults` skips any whose period end is
  // null, so this is a date that belongs to a known period.
  //
  // THE ANNOUNCEMENT MUST BE FOR THE PERIOD ON THE CARD. A filer can announce
  // Q4 while the stored facts still end at Q3 — the announcement arrives days
  // before the 10-K's XBRL does — and captioning Q3's figures with Q4's
  // announcement date is the defect this comparison exists to stop. It is the
  // same shape as claude/traps/a-derived-quantity-attached-to-the-wrong-event.md.
  // Where they disagree, the filing acceptance date is used instead, because
  // that one is carried BY the fact set and so cannot belong to another period.
  const announced = latestResults(dates);
  const reported: { on: string; via: "announcement" | "filing"; timing: ReportTiming | null } | null =
    announced && view && announced.periodEnd === view.latestEnd
      ? {
          on: announced.announcedOn,
          via: "announcement",
          timing: (dates?.events ?? []).find((e) => e.accession === announced.accession)?.timing ?? null,
        }
      : view?.latestFiled
        ? { on: view.latestFiled, via: "filing", timing: null }
        : null;

  // THE 30-DAY BAND, NOT `dates.next`. `dates.next` is estimateNextReport's
  // day or month and must not reach this tile; see SnapshotNextReport. UTC
  // "today", the day boundary every stored date is measured against -- the
  // same one app/api/earnings-outlook uses.
  const today = new Date().toISOString().slice(0, 10);
  const next: SnapshotNextReport = compactOutlook(outlookFromRead(clean, read, today));

  return buildSecEarningsSnapshot({ symbol: clean, view, score, reported, nextReport: next });
}
