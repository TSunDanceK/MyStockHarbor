import type { SymbolOutlook } from "@/lib/server/symbolOutlook";

/**
 * "Next report" on /stock/[symbol]/earnings.
 *
 * ── THE 30-DAY BAND, NOT A DAY (owner decision, 2026-09-23) ────────────────
 * This card printed estimateNextReport's day ("<strong>2026-10-22</strong>,
 * results filed after the close if it follows its usual pattern"), its month
 * ("Expected in December 2026", AVAV) or, before the filer's record was read,
 * FMP's calendar date. All three are now one answer: the outlook
 * lib/server/symbolOutlook.ts composes for the /earnings-calendar search, word
 * for word, so the search, this card and the stock page's snapshot tile cannot
 * disagree about the same company.
 *
 * PRESENTATIONAL ONLY. Every sentence arrives finished; nothing here formats a
 * date or chooses words, which is what lets scripts/check-next-report-band.mjs
 * render it and assert on the bytes a reader gets.
 *
 * The evidence lines are filed facts (the last results filing, the period the
 * next report would cover) and the filer's own median lag with its sample
 * size -- never a predicted date.
 */
export default function NextReportCard({ outlook }: { outlook: SymbolOutlook }) {
  return (
    <section className="card">
      <div className="eyebrow">Next report</div>
      <h3>Next expected report</h3>
      {outlook.value ? (
        // A SHORT VALUE WHERE THE ANSWER HAS ONE ("Est. April", annual-only
        // filers, #535 COWORK #22 §5), styled like the page's other values.
        <div className="metricValue">{outlook.value}</div>
      ) : (
        <p style={{ marginBottom: 0 }}>
          <strong>{outlook.headline}</strong>
        </p>
      )}
      {outlook.hedge ? <p style={{ marginBottom: 0 }}>{outlook.hedge}</p> : null}
      {outlook.evidence.length ? (
        <ul className="earningsDataNote" style={{ marginBottom: 0 }}>
          {outlook.evidence.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
