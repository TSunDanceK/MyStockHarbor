import Link from "next/link";
import TickerLogo from "@/app/components/TickerLogo";
import {
  EXPECTED_HEADING, EXPECTED_INTRO, EXPECTED_NONE, EXPECTED_UNAVAILABLE,
  habitLabel, awayLabel, coverageLabel, lastReportedLabel,
} from "@/lib/server/expectedCopy";
import { groupByBand, type ExpectedSectionState } from "@/lib/server/expectedToReport";

// The page's third and weakest claim, and it is placed and dressed to read
// that way.
//
// ── THE LADDER, WHICH IS THE WHOLE INFORMATION ARCHITECTURE ───────────────
//   FILED        the grid. A dated public document exists.
//   OUTSTANDING  the due strip. A period ended and nothing has been filed.
//                Present tense about the record.
//   EXPECTED     this. Estimated from the filer's own history. NOT a fact
//                about the record.
//
// It sits BELOW the grid, so the whole confirmed body of the page separates it
// from the due strip. That distance is deliberate: the due strip exists to
// never look like a forecast, and putting an estimate beside it is the fastest
// way to undo that. A reader who scrolls this far has passed everything
// confirmed first.
//
// ── NOT THE MARQUEE, AND NOT THE DUE STRIP EITHER ─────────────────────────
// EarningsUpcomingTicker's grammar -- "Next up", a forward date badge per row,
// horizontal scroll -- is a schedule, and this is not one. The due strip's flat
// row list is the confirmed voice. So this takes a third form: BANDED groups
// with a heading per band. The uncertainty is in the layout rather than only in
// a caption, and the widest thing on screen is the coarsest thing the data
// supports.
//
// NO DATE IS EVER RENDERED FOR THE ESTIMATE. Only `daysAway` as words, and only
// inside a band. Dates DO appear for the last filing and the period end,
// because those are dated public documents rather than estimates -- the
// distinction the whole section rests on.

export default function EarningsExpectedSection({ state }: { state: ExpectedSectionState }) {
  const bands = state.kind === "listed" ? groupByBand(state.rows) : [];
  return (
    <section className="expSec" aria-labelledby="expSecHeading">
      <h2 id="expSecHeading" className="expSecHeading">{EXPECTED_HEADING}</h2>
      <p className="expSecIntro">{EXPECTED_INTRO}</p>

      {state.kind === "listed" ? (
        <>
          {bands.map((band) => (
            <div key={band.id} className="expBand">
              <h3 className="expBandHeading">{band.heading}</h3>
              <ul className="expList">
                {band.rows.map((row) => (
                  <li key={row.symbol} className="expRow">
                    <Link href={`/stock/${encodeURIComponent(row.symbol)}/earnings`} className="expLink">
                      <span className="expHead">
                        <TickerLogo symbol={row.symbol} size={20} radius={6} />
                        <span className="expSym">{row.symbol}</span>
                        {/* Words, never a date. See the header. */}
                        <span className="expAway">{awayLabel(row.daysAway)}</span>
                      </span>
                      {/* ── THE EVIDENCE, NOT DECORATION ────────────────────
                          A bare "COMPANY, soon" list is the thin templated
                          pattern flagged as a search-console risk elsewhere.
                          Each row instead shows the filer's own habit with its
                          sample size, the period the report would cover, and
                          the last filing on record -- which is simultaneously
                          the content and the reason to believe the estimate. */}
                      <span className="expEvidence">
                        {habitLabel(row.medianLagDays, row.fromPeriods)}
                      </span>
                      <span className="expEvidence">
                        For the period ending {row.periodEnd}
                      </span>
                      {row.lastReportedOn ? (
                        <span className="expEvidence">
                          {lastReportedLabel(row.lastReportedOn, row.lastReportedPeriodEnd)}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {/* THE DENOMINATOR IS STATED, not implied by the list's length. */}
          <p className="expCoverage">{coverageLabel(state.rows.length, state.considered)}</p>
        </>
      ) : (
        // TWO EMPTIES, TWO SENTENCES -- the same rule dueStripState established
        // one section up. "Nothing clears the bar" is a claim about our
        // confidence; "we cannot read the record" is a claim about us.
        <p className="expEmpty">
          {state.kind === "none" ? EXPECTED_NONE : EXPECTED_UNAVAILABLE}
        </p>
      )}

      <style>{`
        .expSec {
          margin: 28px 0 24px;
          padding: 20px;
          border-radius: 14px;
          /* DELIBERATELY NOT the due strip's card. A dashed edge and a flatter
             ground read as provisional beside the solid confirmed blocks. */
          border: 1px dashed rgba(148,163,184,0.28);
          background: rgba(148,163,184,0.04);
        }
        .expSecHeading { margin: 0 0 6px; font-size: 15px; font-weight: 900; color: #e2e8f0; }
        .expSecIntro {
          margin: 0 0 18px; font-size: 12.5px; line-height: 1.6;
          color: rgba(148,163,184,0.92); max-width: 72ch;
        }
        .expBand { margin: 0 0 16px; }
        .expBandHeading {
          margin: 0 0 8px; font-size: 11px; font-weight: 800;
          letter-spacing: 0.08em; text-transform: uppercase;
          color: #7c8798;
        }
        .expList { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
        .expRow { margin: 0; }
        .expLink {
          display: grid; gap: 3px; padding: 10px 12px; border-radius: 10px;
          text-decoration: none;
          background: rgba(255,255,255,0.02);
          border: 1px solid rgba(255,255,255,0.06);
        }
        .expLink:hover { filter: brightness(1.25); }
        .expHead { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
        .expSym { font-weight: 900; font-size: 13px; color: #e2e8f0; }
        .expAway {
          font-size: 11.5px; font-weight: 700; color: #cbd5e1;
          padding: 2px 8px; border-radius: 999px;
          border: 1px dashed rgba(148,163,184,0.35);
          background: rgba(148,163,184,0.08);
        }
        .expEvidence { font-size: 11.5px; line-height: 1.5; color: rgba(148,163,184,0.85); }
        .expCoverage {
          margin: 4px 0 0; font-size: 11.5px; line-height: 1.6;
          color: rgba(148,163,184,0.7);
        }
        .expEmpty { margin: 0; font-size: 12.5px; line-height: 1.6; color: rgba(148,163,184,0.75); }
        @media (max-width: 640px) {
          .expHead { flex-wrap: wrap; }
        }
      `}</style>
    </section>
  );
}
