// THE DIVIDEND ROW ON /stock/[symbol]'s "About" grid, from the filings.
//
// ── NO NEW COLLECTION ────────────────────────────────────────────────────
// `dividendsDeclaredPerShare` (CommonStockDividendsPerShareDeclared) and
// `dividendsPaid` have been extracted into every stored fact set since the SEC
// pipeline landed — see lib/server/secFields.ts. Nothing rendered them. This
// module is the read, not a new pipeline.
//
// ── WHAT REPLACED WHAT ───────────────────────────────────────────────────
// The row used to be FMP's `lastDividend`, rendered as "Yes · $0.26" or "No".
// Both halves of that were doing something this module will not:
//
//   "Yes · $x"  came from a vendor field with no period attached, so a figure
//               declared two years ago read exactly like one declared last
//               quarter. The filings carry the period, so the row states it.
//   "No"        was asserted whenever the field was absent. See WHY THERE IS
//               NO "No" below — that one is the important change.
//
// ── THE FIGURE IS PER-SHARE DECLARED, NOT CASH PAID ──────────────────────
// They are different events and they land in different quarters. GEV's Q1
// FY2025 has no declared per-share figure and $69M of dividends PAID: the cash
// went out that quarter for a dividend declared in the previous one. Reading
// the two as one number is how a row says "no dividend" over a real outflow.
// `dividendsPaid` is therefore NOT used to synthesise a per-share figure —
// dividing it by a share count would be exactly the computed stand-in the
// owner's rule forbids. It is read only to tell "declared nothing" apart from
// "declared something we cannot see", which changes the hide reason and
// nothing a reader sees.
import { resolveFactSetForRender } from "./secColdFetch";
import { cell, periodLabel, type StoredFactSet, type StoredPeriod } from "./secFactCodec";

/**
 * ── WHY THERE IS NO "No" STATE ───────────────────────────────────────────
 *
 * A filer that pays no dividend does not file a fact saying so. There is no
 * `DividendsAreZero` tag; there is only the absence of
 * CommonStockDividendsPerShareDeclared. So "this company pays no dividend" and
 * "this company's per-share dividend is not in the data we read" produce the
 * IDENTICAL input, and the first is a claim about the company while the second
 * is a statement about the filing.
 *
 * The old row asserted the first from the second on every symbol where FMP's
 * field was empty. That is the failure this repo has now registered twice —
 * `claude/traps/a-visible-failure-is-not-a-harmless-one.md`, and the
 * /earnings-calendar work whose whole point was that failure must not read as
 * absence.
 *
 * TSLA AND KTOS GENUINELY PAY NOTHING, and under this rule their row is hidden
 * rather than reading "No". That loses something real, and it is the deliberate
 * trade: a hidden row tells a reader nothing, where a wrong "No" tells them
 * something false. A "No" state can be added the moment there is positive
 * evidence to support it — the owner's live-companyfacts re-check is the thing
 * that would supply it — and `never-declared` below is kept as a distinct
 * reason precisely so that state has somewhere to attach.
 */
export type DividendHideReason =
  | "no-facts"
  | "ifrs-no-per-share-tag"
  | "never-declared";

export type HiddenDividend = {
  reason: DividendHideReason;
  /** What is missing, and whose limit it is. Recorded, not rendered. */
  note: string;
};

export const DIVIDEND_HIDE_REASONS: Record<DividendHideReason, string> = {
  "no-facts":
    "This symbol's SEC filings have not been read into the site yet, so there is " +
    "no dividend figure either way.",
  // MEASURED, NOT ASSUMED. lib/server/secFields.ts records it at the mapping:
  // "0 of 20 probed filers publish a per-share dividend under ifrs-full under
  // this or any spelling", and the IFRS chain for dividendsDeclaredPerShare is
  // deliberately left empty rather than guessed. Confirmed again on the
  // committed fixtures: AZN 0/18 periods, KGC 0/6 — and AZN's own
  // `dividendsPaid` is $4.97B for FY2025, so it is a payer with no per-share
  // tag rather than a non-payer.
  "ifrs-no-per-share-tag":
    "This filer reports under IFRS, which publishes no per-share dividend tag " +
    "under any spelling, so there is no filed figure to show.",
  "never-declared":
    "No period in this filer's stored history carries a declared per-share " +
    "dividend.",
};

export type ProfileDividend =
  | {
      state: "declared";
      /** Dollars per share, as filed for `periodLabel`. */
      perShare: number;
      /** "Q3 FY2026" or "FY2025" — the period the figure BELONGS to. */
      periodLabel: string;
      periodEnd: string;
      /**
       * True when this is not the newest stored period.
       *
       * THE OWNER'S RULE, AND THE CASE IT IS FOR. A quarter can carry cash paid
       * with no declared per-share figure (GEV Q1 FY2025). Leaving the row
       * blank there reads as "no dividend" beside a real outflow, so the last
       * known declared figure is shown instead — LABELLED BY ITS OWN PERIOD,
       * never by the current one. A figure captioned with a quarter it was not
       * declared in is a wrong number, not a stale one.
       */
      carriedForward: boolean;
      /**
       * True when the filer reports in another currency and this figure was
       * converted. The row says so; an unlabelled converted per-share dividend
       * invites comparison against the filer's own press release.
       */
      converted: boolean;
    }
  | { state: "hidden"; why: HiddenDividend };

const hidden = (reason: DividendHideReason): ProfileDividend => ({
  state: "hidden",
  why: { reason, note: DIVIDEND_HIDE_REASONS[reason] },
});

/** Every stored period, newest first, quarters ahead of years. */
function periodsNewestFirst(set: StoredFactSet): StoredPeriod[] {
  const q = Array.isArray(set.quarters) ? set.quarters : [];
  const y = Array.isArray(set.years) ? set.years : [];
  // ALREADY NEWEST-FIRST IN THE STORE for both arrays; sorted again rather
  // than trusted, because "the first element is the newest" is an invariant of
  // the writer and this is a reader.
  const byEndDesc = (a: StoredPeriod, b: StoredPeriod) => (a.e < b.e ? 1 : a.e > b.e ? -1 : 0);
  // QUARTERS FIRST AT AN EQUAL END DATE. A filer's Q4 and its FY share an end,
  // and the quarter is the more specific answer to "what was declared for this
  // period" — an annual figure captioned as the latest reading would be four
  // quarters of dividend shown as one.
  return [...[...q].sort(byEndDesc), ...[...y].sort(byEndDesc)];
}

/**
 * The row, from a stored fact set. PURE, so a check can drive it from fixtures.
 *
 * `taxonomies` is read off the set rather than passed in, so a caller cannot
 * supply a different answer than the one the extractor recorded.
 */
export function buildProfileDividend(set: StoredFactSet | null): ProfileDividend {
  if (!set) return hidden("no-facts");

  // ── THE IFRS GATE COMES FIRST, AND IT IS A TAXONOMY TEST ────────────────
  // Not a currency test and not "the numbers look sparse". KGC was described in
  // the brief as a US-GAAP annual-only filer whose absent tags might be fixture
  // sparseness; its `tx` says ["dei","ifrs-full","srt"]. It is an IFRS filer,
  // so it lands here with AZN and there was never an ambiguous case to resolve.
  const tx = Array.isArray(set.tx) ? set.tx : [];
  const isIfrs = tx.includes("ifrs-full");
  const isUsGaap = tx.includes("us-gaap");
  // BOTH IS POSSIBLE AND US-GAAP WINS. A filer can carry both namespaces; what
  // decides is whether the concept this row reads is reachable, and it is a
  // us-gaap concept.
  if (isIfrs && !isUsGaap) return hidden("ifrs-no-per-share-tag");

  const periods = periodsNewestFirst(set);
  if (!periods.length) return hidden("no-facts");

  // NEWEST-FIRST, FIRST HIT WINS. This is the carry-forward rule: a newest
  // period with no declared figure falls through to the one that has one.
  let found: { p: StoredPeriod; val: number } | null = null;
  for (const p of periods) {
    const c = cell(p, "dividendsDeclaredPerShare");
    if (typeof c.val === "number" && Number.isFinite(c.val) && c.val > 0) {
      found = { p, val: c.val };
      break;
    }
  }

  if (!found) return hidden("never-declared");

  return {
    state: "declared",
    perShare: found.val,
    periodLabel: periodLabel(found.p),
    periodEnd: found.p.e,
    carriedForward: found.p.e !== periods[0].e,
    converted: Boolean(set.fx),
  };
}

/**
 * Read the fact set and build the row.
 *
 * ONE ROUND TRIP THE PAGE IS ALREADY MAKING. /stock/[symbol] renders the
 * sidebar earnings snapshot from the same `resolveFactSetForRender`, and both
 * calls land in the same request — secColdFetch dedupes in flight, so this
 * costs the second caller nothing.
 */
export async function getProfileDividend(symbol: string): Promise<ProfileDividend> {
  const cold = await resolveFactSetForRender(symbol.trim().toUpperCase());
  return buildProfileDividend(cold.status === "ready" ? cold.set : null);
}
