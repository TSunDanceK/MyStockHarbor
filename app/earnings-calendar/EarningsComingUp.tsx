// "COMING UP · Estimated: Expected to report" (#552 COWORK #170): the existing
// estimates, compact. One chip per company, grouped by calendar week from
// today; each chip's evidence (the filer's habit, the period, the last filing)
// sits behind a tap in a native <details>, so it is in the server HTML and
// works without JS. Nothing is removed from the old section, only folded.
//
// THE DATE ON A CHIP IS "~15 Oct", AN ESTIMATE MARKED AS ONE. The old section
// printed words ("Expected in about 9 days"), never a date; the owner's pick
// (COWORK #170) is the approximate date, and the line under the title says
// each may be off by a week or two (COWORK #174).
//
// "DUE TO REPORT", WHEN IT HAS NAMES, IS THE FIRST GROUP: "Period ended, not
// filed yet". Empty, it is not shown at all (COWORK #170 "Remove"). An
// UNREADABLE record is not "empty": it keeps its one sentence, so a failed read
// never looks like a quiet market (dueStripState's whole point).
import Link from "next/link";
import TickerLogo from "@/app/components/TickerLogo";
import { EXPECTED_NONE, EXPECTED_UNAVAILABLE, coverageLabel, habitLabel, lastReportedLabel } from "@/lib/server/expectedCopy";
import { DUE_STRIP_UNAVAILABLE, dueRowLabel, type DueStripState } from "@/lib/server/dueStripState";
import { EXPECTED_WINDOW_DAYS, MIN_USABLE_PERIODS, PRECISION_BAR_DOMESTIC, PRECISION_BAR_FPI, type ExpectedSectionState } from "@/lib/server/expectedToReport";
import { addDays, approxDate, groupByWeek, shortDate } from "@/lib/server/earningsWeek";

export const COMING_UP_TITLE = "Coming up · Estimated: Expected to report";
// THE MISS, STATED (#552 COWORK #174): a median of 3 days and a 90th
// percentile of 15, so "a week, not a day" understated the tail.
export const COMING_UP_LINE =
  "Estimated from each company's own filing history. These aren't announced dates. Each is an estimate that may be off by a week or two.";
export const DUE_GROUP_HEADING = "Period ended, not filed yet";


function Chip({ symbol, label, children }: { symbol: string; label: string; children: React.ReactNode }) {
  return (
    <details className="cuChip" data-chip={symbol}>
      <summary>
        <TickerLogo symbol={symbol} size={20} radius={6} alt="" />
        <span className="cuSym">{symbol}</span>
        <span className="cuWhen">{label}</span>
      </summary>
      <div className="cuBody">
        {children}
        <Link href={`/stock/${encodeURIComponent(symbol)}/earnings`} prefetch={false} className="cuLink">{symbol} earnings →</Link>
      </div>
    </details>
  );
}

export default function EarningsComingUp({ expected, due, today }: { expected: ExpectedSectionState; due: DueStripState; today: string }) {
  const rows = expected.kind === "listed" ? expected.rows.map((r) => ({ ...r, estimatedOn: addDays(today, r.daysAway) })) : [];
  const weeks = groupByWeek(rows, today);
  const dueEntries = due.kind === "listed" ? due.entries : [];
  return (
    <section className="cuCard" aria-labelledby="cuHeading">
      <h2 id="cuHeading" className="cuHeading">{COMING_UP_TITLE}</h2>
      <p className="cuLine">{COMING_UP_LINE}</p>

      {dueEntries.length ? (
        <div className="cuGroup" data-group="due">
          <h3 className="cuGroupHeading">{DUE_GROUP_HEADING}</h3>
          <div className="cuChips">
            {dueEntries.map((e) => (
              <Chip key={e.symbol} symbol={e.symbol} label={`period ended ${shortDate(e.periodEnd)}`}>
                <p>{dueRowLabel(e)}</p>
              </Chip>
            ))}
          </div>
        </div>
      ) : due.kind === "unavailable" ? (
        // A FAILED READ IS NOT A QUIET MARKET: with no names the group is not
        // shown (COWORK #170), but "we could not read the record" still says so.
        <p className="cuLine" data-due-unavailable="">{DUE_STRIP_UNAVAILABLE}</p>
      ) : null}

      {weeks.map((w) => (
        <div key={w.key} className="cuGroup" data-group={w.key}>
          <h3 className="cuGroupHeading">{w.heading}</h3>
          <div className="cuChips">
            {w.items.map((r) => (
              <Chip key={r.symbol} symbol={r.symbol} label={approxDate(r.estimatedOn)}>
                <p>{habitLabel(r.medianLagDays, r.fromPeriods)}</p>
                <p>For the period ending {shortDate(r.periodEnd)}</p>
                {r.lastReportedOn ? <p>{lastReportedLabel(r.lastReportedOn, r.lastReportedPeriodEnd)}</p> : null}
              </Chip>
            ))}
          </div>
        </div>
      ))}

      {expected.kind === "listed" ? (
        <p className="cuCoverage">{coverageLabel(expected.rows.length, expected.considered, DUE_GROUP_HEADING)}</p>
      ) : (
        <p className="cuLine">{expected.kind === "none" ? EXPECTED_NONE : EXPECTED_UNAVAILABLE}</p>
      )}

      <details className="cuHow">
        <summary>How these estimates work</summary>
        <p>
          For each of the largest companies we track, we take how many days after a period ends it has
          filed its results in the past (the middle value over at least {MIN_USABLE_PERIODS} periods), and add that to
          the end of the period it is reporting next. A company is shown only when that method, tested on
          its own past filings, has scored at least {Math.round(PRECISION_BAR_DOMESTIC * 100)}% ({Math.round(PRECISION_BAR_FPI * 100)}% for a foreign filer), and only for
          the next {EXPECTED_WINDOW_DAYS} days. A company whose period has ended and
          whose usual filing day has arrived, with nothing filed yet, is listed first as &ldquo;{DUE_GROUP_HEADING}&rdquo;.
        </p>
      </details>

      <style>{`
        .cuCard { margin: 0 0 24px; padding: 20px; border-radius: 16px; border: 1px dashed rgba(148,163,184,0.30); background: rgba(148,163,184,0.04); }
        .cuHeading { margin: 0 0 6px; font-size: 1.125rem; font-weight: 900; color: #e2e8f0; }
        .cuLine { margin: 0 0 14px; font-size: var(--fs-read); line-height: var(--lh-read); color: #cbd5e1; }
        .cuGroup { margin: 0 0 14px; }
        .cuGroupHeading { margin: 0 0 8px; font-size: var(--fs-read); font-weight: 900; color: #cbd5e1; }
        .cuChips { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; }
        .cuChip { border-radius: 999px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.03); }
        .cuChip[open] { border-radius: 12px; flex-basis: 100%; }
        .cuChip > summary { display: flex; align-items: center; gap: 7px; padding: 5px 10px 5px 6px; cursor: pointer; list-style: none; font-size: var(--fs-label); }
        .cuChip > summary::-webkit-details-marker { display: none; }
        .cuChip > summary:focus-visible { outline: 2px solid #93c5fd; outline-offset: 2px; border-radius: 999px; }
        .cuSym { font-weight: 900; color: #f8fafc; }
        .cuWhen { color: #cbd5e1; font-weight: 700; white-space: nowrap; }
        .cuBody { padding: 4px 14px 12px; }
        .cuBody p { margin: 4px 0; font-size: var(--fs-read); line-height: var(--lh-read); color: #cbd5e1; }
        .cuLink { display: inline-block; margin-top: 6px; font-size: var(--fs-label); font-weight: 800; color: #93c5fd; text-decoration: none; }
        .cuCoverage { margin: 4px 0 10px; font-size: var(--fs-read); line-height: var(--lh-read); color: #94a3b8; }
        .cuHow > summary { cursor: pointer; font-size: var(--fs-label); font-weight: 800; color: #93c5fd; }
        .cuHow p { margin: 8px 0 0; font-size: var(--fs-read); line-height: var(--lh-read); color: #cbd5e1; }
      `}</style>
    </section>
  );
}
