import type { SymbolOutlook } from "@/lib/server/symbolOutlook";
import { readableIsoDates, reportWindowMark } from "@/lib/server/secEstimates";
import { EstimatedValue } from "@/app/components/EstimatedValue";

/**
 * "Next report" on /stock/[symbol]/earnings.
 *
 * ── ONE HEADING, ONE LINE, THE DETAIL BEHIND A DROPDOWN (#552 COWORK #96) ──
 * The card said "Next report" twice, then a bold negative ("ONDS is not
 * expected to report in the next 30 days."), a two-line disclaimer and two
 * grey lines of ISO dates. Now:
 *   - one heading;
 *   - one line: the estimated window ("≈ Mid-November 2026 (estimate)"), or
 *     "Expected around now", or "Later than usual; no report filed yet",
 *     composed by lib/server/symbolOutlook.ts from the filer's own record;
 *   - "How this is estimated" in a native <details>, closed, in the server
 *     HTML so it is indexed and works without JS: the hedge and the evidence.
 * Dates read "13 Aug 2026", never ISO (readableIsoDates).
 *
 * The window is a third of a month, never a day: the filer's median lag added
 * to the period end, as the estimator decides it. The search and the stock
 * page's tile keep the outlook's own sentences.
 */
export const NEXT_REPORT_DETAILS_SUMMARY = "How this is estimated";

export default function NextReportCard({ outlook }: { outlook: SymbolOutlook }) {
  const w = outlook.window;
  const detail = [outlook.hedge, ...outlook.evidence, ...(w && outlook.kind === "due" ? [outlook.headline] : [])]
    .filter((x): x is string => Boolean(x));
  return (
    <section className="card">
      <h3>Next report</h3>
      {w ? (
        <div className="metricValue" data-next-window="">
          {w.estimate ? (
            <>
              <EstimatedValue text={w.line} est={reportWindowMark(outlook.hedge ?? "Estimated from this company's own filing history.")} />
              <span className="nextEstimateWord"> (estimate)</span>
            </>
          ) : (
            w.line
          )}
        </div>
      ) : outlook.value ? (
        // A SHORT VALUE WHERE THE ANSWER HAS ONE ("Est. April", annual-only
        // filers, #535 COWORK #22 §5), styled like the page's other values.
        <div className="metricValue">{outlook.value}</div>
      ) : (
        <p style={{ marginBottom: 0 }}>
          <strong>{readableIsoDates(outlook.headline)}</strong>
        </p>
      )}
      {detail.length ? (
        <details className="cardDetails">
          <summary>{NEXT_REPORT_DETAILS_SUMMARY}</summary>
          <ul className="earningsDataNote" style={{ marginBottom: 0 }}>
            {detail.map((line) => (
              <li key={line}>{readableIsoDates(line)}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
