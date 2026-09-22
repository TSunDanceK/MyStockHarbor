import Link from "next/link";
import TickerLogo from "@/app/components/TickerLogo";
import {
  DUE_STRIP_HEADING,
  DUE_STRIP_INTRO,
  DUE_STRIP_NONE_OUTSTANDING,
  DUE_STRIP_UNAVAILABLE,
  dueRowLabel,
  type DueStripState,
} from "@/lib/server/dueStripState";

// The "Due to report" strip. THREE STATES, THREE DIFFERENT SENTENCES.
//
// ── WHY THIS IS NOT EarningsUpcomingTicker ────────────────────────────────
// The obvious move was to reuse the "Next up" marquee already at the top of
// this page. It cannot be done, and the reason is not taste:
//
//   UpcomingEarningsItem needs `company`   DueEntry has no company name
//   UpcomingEarningsItem needs `dayLabel`  DueEntry's only date-shaped field
//                                          is `expectedOn`, and BOTH source
//                                          modules forbid rendering it
//
// dueToReport.ts: "`expectedOn` [...] NOT a prediction of the actual date --
// see the header. Used for ordering only." dueStripState.ts: "`expectedOn`
// exists for ORDERING and is deliberately not rendered as a date."
//
// So adapting the ticker would have required putting expectedOn in its date
// pill -- the single thing both modules say in writing must not happen. The
// marquee's whole grammar ("Next up", a forward-scrolling date badge per row)
// is a forward calendar, and dueToReport.ts's header exists because two routes
// to a real forward calendar were MEASURED and both failed: cadence prediction
// landed 2 of 48 filers inside their own p90 band, 8-K scheduling
// announcements 0 of 276.
//
// THE TICKER IS LEFT WHERE IT IS. It is fed by FMP's published earnings
// calendar -- a vendor's schedule of dates companies have announced, which is a
// different claim from a date we predicted -- so it is a separate live feature
// with its own source, not this one wearing the wrong clothes. Whether an
// FMP-fed forward strip should outlive the FMP exit is a real question and a
// different one.
//
// ── EVERY STRING COMES FROM dueStripState.ts ──────────────────────────────
// None of the copy is written here. That module holds it precisely so the copy
// rule -- present tense about the public record, never "will report" -- lives
// somewhere a check can assert on, and a rule that lives only in JSX is one
// refactor from being paraphrased back into a forecast.

export default function EarningsDueStrip({ state }: { state: DueStripState }) {
  return (
    <section className="dueStrip" aria-labelledby="dueStripHeading">
      <h2 id="dueStripHeading" className="dueStripHeading">{DUE_STRIP_HEADING}</h2>
      <p className="dueStripIntro">{DUE_STRIP_INTRO}</p>

      {state.kind === "listed" ? (
        <ul className="dueStripList">
          {state.entries.map((entry) => (
            <li key={entry.symbol} className="dueStripRow">
              <Link
                href={`/stock/${encodeURIComponent(entry.symbol)}/earnings`}
                className="dueStripLink"
              >
                <TickerLogo symbol={entry.symbol} size={20} radius={6} />
                <span className="dueStripSym">{entry.symbol}</span>
                {/* The row's words are the module's, not this file's. */}
                <span className="dueStripLabel">{dueRowLabel(entry)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        // ── THE TWO EMPTIES, WHICH ARE NOT THE SAME EMPTY ─────────────────
        // "We looked and nothing is outstanding" is a fact about the market;
        // "we have nothing to look in" is a fact about us. Rendering the
        // second as the first is a lie a reader cannot detect, which is the
        // entire reason dueStripState exists. The ternary below is the render
        // half of that distinction; resolveDueStrip is the other half.
        <p className="dueStripEmpty">
          {state.kind === "none-outstanding" ? DUE_STRIP_NONE_OUTSTANDING : DUE_STRIP_UNAVAILABLE}
        </p>
      )}

      <style>{`
        .dueStrip {
          margin: 0 0 24px;
          padding: 18px 20px;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.10);
          background: rgba(255,255,255,0.03);
        }
        .dueStripHeading {
          margin: 0 0 6px;
          font-size: 15px;
          font-weight: 900;
          letter-spacing: 0.02em;
          color: #e2e8f0;
        }
        .dueStripIntro {
          margin: 0 0 14px;
          font-size: 12.5px;
          line-height: 1.6;
          color: rgba(148,163,184,0.92);
          max-width: 68ch;
        }
        .dueStripList { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
        .dueStripRow { margin: 0; }
        .dueStripLink {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          border-radius: 9px;
          text-decoration: none;
          background: rgba(255,255,255,0.02);
          border: 1px solid rgba(255,255,255,0.06);
        }
        .dueStripLink:hover { filter: brightness(1.25); }
        .dueStripSym { font-weight: 900; font-size: 13px; color: #e2e8f0; flex: 0 0 auto; }
        .dueStripLabel {
          font-size: 12px;
          color: rgba(148,163,184,0.9);
          font-weight: 600;
        }
        .dueStripEmpty {
          margin: 0;
          font-size: 12.5px;
          line-height: 1.6;
          color: rgba(148,163,184,0.75);
        }
        @media (max-width: 640px) {
          .dueStripLink { align-items: flex-start; flex-wrap: wrap; }
          .dueStripLabel { flex-basis: 100%; }
        }
      `}</style>
    </section>
  );
}
