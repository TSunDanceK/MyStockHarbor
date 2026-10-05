// THE ONE ESTIMATE LAYER (#552 COWORK #93/#94/#99/#112).
//
// The owner's rule: an accurate, clearly marked estimate is more helpful than
// "can't calculate". A figure may be estimated only by a method that passed the
// back-test (within ±5% for at least 90% of cases, CODE-A #115), and it is then
// shown with its marker, a key on the page and a hover/tap note naming the
// method and the date. Every surface reads estimates through this module;
// nobody computes their own.
//
// WHAT PASSED, AND IS HERE:
//   ev-short-term-debt-untagged  (M2) EV = cap + long-term debt − cash, the
//       short-term debt line counted as zero because the balance sheet does
//       not tag one. 93.2% within ±5% of the full EV (median 0.84%, p90 4.44%,
//       n 295). ONLY this pattern: with cash or long-term debt missing it fails
//       (75.9% and below), so those stay refusals.
//   ev-cash-incl-restricted      (B1, #552 COWORK #162) EV with cash including
//       restricted cash where cash is not tagged; both debt lines filed, never
//       a bank, never stacked with M2. 96.6% within ±5% (median 0.00%, p90
//       0.47%, n 268); misses are client-funds holders (PYPL 27%).
//   pb-parent-equity-derived     (M6a) shareholders' equity = equity including
//       noncontrolling interests − the filed noncontrolling interest, on the
//       same balance-sheet date. 99.1% exact (n 16,172). It is arithmetic on
//       filed figures, so it is labelled "derived", not "≈" (COWORK #112).
//
// WHAT FAILED, AND IS NOT: M1 (an older share count), M5 (an implied ADS
// ratio), M6b (split-adjusted counts), and every other M2 pattern. M3 (FY − 9M
// EPS) is already the live rule (secValuation.derivedQ4Eps); M4 needed nothing.
//
// THE BOUNDARY (#94): current snapshot figures only. A reported period's own
// figure is never estimated: no estimate reaches an earnings table, a growth or
// margin chart, the dilution series, a trend card or a score.
//
// PURE. No I/O and no imports, so the client components can render what it
// returns and the check suite can lift it. The NCI READ is extraction and lives
// in secExtract (minorityInterestAt).

/** The methods that passed, by name. Nothing else may carry an estimate. */
export type EstimateKey = "ev-short-term-debt-untagged" | "ev-cash-incl-restricted" | "pb-parent-equity-derived";

/**
 * How an estimated or derived figure was made. `kind` decides the marker:
 * "estimate" renders "≈" in the estimate colour; "derived" renders the word
 * "derived". `note` is the hover/tap text, written here so every surface says
 * the same thing.
 */
export type Estimate = {
  key: EstimateKey;
  kind: "estimate" | "derived";
  /** The balance-sheet date the figure rests on, ISO. */
  asOf: string;
  note: string;
};

/** One line per method, for the page key and the PR record. */
export const ESTIMATE_METHODS: Record<EstimateKey, { kind: Estimate["kind"]; method: string; backtest: string }> = {
  "ev-short-term-debt-untagged": {
    kind: "estimate",
    method: "short-term debt is not tagged on this balance sheet, so it is counted as zero",
    backtest: "93% of back-tested cases within ±5% of the full figure",
  },
  // B1 (#552 COWORK #162 §3): cash untagged, cash INCLUDING restricted cash
  // filed at the same balance-sheet date, both debt lines filed. Back-test
  // (relay write-sec-estimate-accuracy, 5 Oct): on the 268 stored non-bank
  // sets filing all four lines at one date, EV with cash incl. restricted vs
  // the full EV: 259 (96.6%) within ±5%, median 0.00%, p90 0.47%. The 9
  // misses hold client funds as restricted cash (PYPL 27%, CPAY, ABNB, MRSH,
  // WTW, BRO, ADM, ADP, INTU).
  "ev-cash-incl-restricted": {
    kind: "estimate",
    method: "cash is not tagged on this balance sheet, so it uses cash including restricted cash",
    backtest: "97% of back-tested cases within ±5% of the full figure",
  },
  "pb-parent-equity-derived": {
    kind: "derived",
    method: "shareholders' equity = total equity less the noncontrolling interest, both as filed",
    backtest: "exact on 99% of back-tested balance sheets",
  },
};

export const EST_MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "30 Jun 2026". */
export function readableDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[3])} ${EST_MONTH_ABBR[Number(m[2]) - 1]} ${m[1]}` : iso;
}

/**
 * THE NEXT-REPORT WINDOW'S MARK (#552 COWORK #96): an estimated window, not a
 * figure, so it carries the outlook's own hedge as its note. Built here, like
 * every estimate mark, so no surface invents one.
 */
export function reportWindowMark(note: string): { kind: "estimate"; note: string } {
  return { kind: "estimate", note };
}

/**
 * Every yyyy-mm-dd in a sentence, read as "30 Jun 2026" (#552 COWORK #96/#97).
 * For sentences composed elsewhere (the outlook's evidence lines) that a card
 * prints as they are: the words stay theirs, only the date format changes.
 */
export function readableIsoDates(text: string): string {
  return text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (iso) => readableDate(iso));
}

export function estimateOf(key: EstimateKey, asOf: string): Estimate {
  const m = ESTIMATE_METHODS[key];
  const lead = m.kind === "estimate" ? "Estimate" : "Derived";
  return { key, kind: m.kind, asOf, note: `${lead}, balance sheet as at ${readableDate(asOf)}: ${m.method} (${m.backtest}).` };
}

/**
 * BANKS AND OTHER FINANCIALS ARE NEVER ESTIMATED (#552 COWORK #113): SIC
 * 6000–6299, the range the #86b bank census used (CODE-A #113). At a bank,
 * "no short-term debt tagged" is deposits and short-term funding, so counting
 * it as zero is not the tested M2 case. FAIL-CLOSED: an unknown SIC gets no
 * estimate either.
 */
export const BANK_SIC_RANGE = [6000, 6299] as const;
export function sicAllowsEstimate(sic: string | null | undefined): boolean {
  const n = Number(sic);
  if (!sic || !Number.isFinite(n)) return false;
  return n < BANK_SIC_RANGE[0] || n > BANK_SIC_RANGE[1];
}

/** The balance-sheet lines EV needs, as stored (null = not tagged). */
export type EvBalanceSheet = {
  asOf: string; shortTermDebt: number | null; longTermDebt: number | null; cash: number | null;
  /**
   * Cash INCLUDING restricted cash on the SAME balance sheet (`asOf`), for B1
   * only. Optional: rows written before it existed simply have no fallback.
   */
  cashIncludingRestricted?: number | null;
};

/**
 * ENTERPRISE VALUE: cap + short-term debt + long-term debt − cash.
 *
 * Every line on file → the filed figure, no estimate. ONLY short-term debt
 * untagged, and the filer not a bank (sicAllowsEstimate) → the M2 estimate. Anything else missing → null with the missing
 * lines named, exactly as before: those patterns failed the back-test.
 */
export function enterpriseValueOf(
  cap: number | null,
  bs: EvBalanceSheet | null,
  /** The filer's SIC, REQUIRED so no caller can skip the bank gate; null = unknown (no estimate). */
  sic: string | null | undefined,
): { val: number; est?: Estimate; missing?: string[] } | { val: null; missing: string[] } {
  const missing = [
    ...(bs ? [] : ["the balance sheet"]),
    ...(bs && bs.shortTermDebt === null ? ["short-term debt"] : []),
    ...(bs && bs.longTermDebt === null ? ["long-term debt"] : []),
    ...(bs && bs.cash === null ? ["cash"] : []),
  ];
  // B1 (#552 COWORK #162 §3): ONLY cash untagged, its incl.-restricted twin
  // filed on the same balance sheet, both debt lines filed, not a bank. Never
  // stacked with M2: two estimated lines in one figure were not back-tested.
  // `missing` names the line the estimate stands in for, so a surface that
  // does not render the mark refuses with the right word.
  if (cap !== null && bs && bs.cash === null && bs.shortTermDebt !== null && bs.longTermDebt !== null
      && typeof bs.cashIncludingRestricted === "number" && sicAllowsEstimate(sic)) {
    return { val: cap + bs.shortTermDebt + bs.longTermDebt - bs.cashIncludingRestricted, est: estimateOf("ev-cash-incl-restricted", bs.asOf), missing: ["cash"] };
  }
  if (cap === null || !bs || bs.longTermDebt === null || bs.cash === null) return { val: null, missing };
  if (bs.shortTermDebt === null) {
    if (!sicAllowsEstimate(sic)) return { val: null, missing };
    return { val: cap + bs.longTermDebt - bs.cash, est: estimateOf("ev-short-term-debt-untagged", bs.asOf), missing: ["short-term debt"] };
  }
  return { val: cap + bs.shortTermDebt + bs.longTermDebt - bs.cash };
}

/**
 * SHAREHOLDERS' EQUITY FROM TOTAL EQUITY AND THE FILED NCI (M6a), or null when
 * the filer does not tag the noncontrolling interest on that date. The result
 * may be zero or negative: the caller refuses it the way it refuses any
 * non-positive equity, so the derived figure and a filed one never disagree
 * about what is shown.
 */
export function derivedParentEquity(total: number, nci: [string, number][] | undefined, asOf: string): { equity: number; est: Estimate } | null {
  const row = nci?.find(([e]) => e === asOf);
  if (!row) return null;
  return { equity: total - row[1], est: estimateOf("pb-parent-equity-derived", asOf) };
}
