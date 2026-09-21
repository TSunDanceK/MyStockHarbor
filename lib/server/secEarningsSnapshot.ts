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
  buildSecEarningsView, conversionNote, isPct,
  type PeriodBasis, type Pct, type SecEarningsView, type ViewCell,
} from "./secEarningsView";
import { resolveFactSetForRender } from "./secColdFetch";
import { readReportDates, latestResults } from "./secReportDatesStore";
import {
  TIMING_WORDING, type ReportTiming,
} from "./secReportDates";
import {
  scoreFromSec, toneLabel, type EarningsTone,
} from "./secEarningsScore";

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
};

const figure = (c: ViewCell): SnapshotFigure => ({
  value: c.val,
  perShare: c.perShare,
  derivedNote: c.derivedNote,
});

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

/** The next report, in the three shapes the filer's own habit can support. */
export type SnapshotNextReport =
  | { kind: "date"; date: string; timingNote: string | null; fromEvents: number }
  | { kind: "month"; month: string; fromEvents: number }
  | { kind: "none" };

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
  /** "Good" / "Mixed" / "Weak", or "Unavailable". */
  toneLabel: string;
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
  epsYoY: SnapshotPct;
  revenue: SnapshotFigure;
  revenueYoY: SnapshotPct;
  netIncome: SnapshotFigure;
  /** Percentages, already computed by the view. Null where the inputs are absent. */
  margins: { gross: number | null; operating: number | null; net: number | null };

  /** Set only for a filer that reports in another currency. */
  currencyNote: string | null;
  sourceNote: string;
};

const pct = (p: Pct, crossingWords: (p: Pct) => string | null): SnapshotPct => {
  if (isPct(p)) return { kind: "pct", value: p };
  const words = crossingWords(p);
  return words ? { kind: "crossing", words } : { kind: "none" };
};

const EMPTY_FIGURE: SnapshotFigure = { value: null, perShare: false, derivedNote: null };

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

  const base = {
    symbol,
    // A SCORE THE SCORER REFUSED IS NOT A NUMBER. scoreFromSec returns 50 on
    // its unavailable branch because its shape requires one, and its own
    // docblock says 50 is the neutral seed rather than a reading. Carrying it
    // through as a number would put "50" on the card under a Mixed pill, which
    // is a measurement the filings never supplied.
    score: score.available ? score.score : null,
    tone: score.tone,
    toneLabel: score.available ? toneLabel(score.tone) : "Unavailable",
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
      epsYoY: { kind: "none" },
      revenue: EMPTY_FIGURE,
      revenueYoY: { kind: "none" },
      netIncome: EMPTY_FIGURE,
      margins: { gross: null, operating: null, net: null },
      currencyNote: null,
      sourceNote: SNAPSHOT_SOURCE_NOTE,
    };
  }

  const s = view.snapshot;
  // THE NEWEST MARGIN ROW, which is the one belonging to this snapshot's own
  // period. `margins` is oldest-first, so this is .at(-1) and not [0]; taking
  // the first row would caption the oldest quarter's margins with the newest
  // quarter's label, and both are plausible percentages.
  const m = view.margins.at(-1) ?? null;

  return {
    ...base,
    available: true,
    unavailableReason: null,
    basis: view.basis,
    periodLabel: view.latestLabel,
    periodEnd: view.latestEnd,
    comparedWith: s.comparedWith,
    eps: figure(s.epsDiluted),
    epsYoY: pct(s.epsYoY, crossingWords),
    revenue: figure(s.revenue),
    revenueYoY: pct(s.revenueYoY, crossingWords),
    netIncome: figure(s.netIncome),
    margins: m
      ? { gross: m.gross, operating: m.operating, net: m.net }
      : { gross: null, operating: null, net: null },
    currencyNote: view.currency ? conversionNote(view.currency) : null,
    sourceNote: SNAPSHOT_SOURCE_NOTE,
  };
}

export const SNAPSHOT_SOURCE_NOTE =
  "Reported figures from the company's own SEC filings (US GAAP, as filed). " +
  "Analyst estimates and beat-or-miss are not shown — no free source publishes them.";

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
    readReportDates(clean).catch(() => null),
  ]);
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

  const next: SnapshotNextReport =
    dates?.next.kind === "date"
      ? {
          kind: "date",
          date: dates.next.date,
          timingNote: dates.next.timing ? TIMING_WORDING[dates.next.timing] : null,
          fromEvents: dates.next.fromEvents,
        }
      : dates?.next.kind === "month"
        ? { kind: "month", month: dates.next.month, fromEvents: dates.next.fromEvents }
        : { kind: "none" };

  return buildSecEarningsSnapshot({ symbol: clean, view, score, reported, nextReport: next });
}
