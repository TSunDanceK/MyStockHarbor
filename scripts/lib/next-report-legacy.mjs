// THE OLD NEXT-REPORT RENDER PATHS, kept as mutants and as the "before" column.
//
// Until 2026-09-23 the stock pages printed estimateNextReport's day or month:
//
//   /stock/[symbol]            the Earnings snapshot tile ("22 Oct 2026 ·
//                              Estimated from its last 15 reports")
//   /stock/[symbol]/earnings   the "Next expected earnings date" card ("2026-10-22",
//                              "Expected in December 2026", or FMP's day)
//
// The owner ruled the 30-day band the only forward claim on the site, and both
// now render lib/server/symbolOutlook.ts's answer. These are the REMOVED code
// paths, reproduced from the pre-change source (the tile's mapping off
// `rec.next` in secEarningsSnapshot.snapshotFrom and its formatter/sub-line in
// LatestEarningsCard; the card's view in the earnings page and its JSX), for
// two readers only:
//
//   scripts/check-next-report-band.mjs   runs them as MUTANTS — its date scan
//                                        must catch every one
//   scripts/next-report-band-render.mjs  prints them as the BEFORE wording
//                                        beside the live AFTER, per symbol
//
// NOTHING ON A PAGE IMPORTS THIS. It is a record of what shipped, not a
// second home for any wording that ships.
import { once } from "./render-snapshot.mjs";

/** The tile's old mapping, off the stored `next` (secEarningsSnapshot.snapshotFrom). */
export const oldTileNext = (rec) =>
  rec?.next?.kind === "date"
    ? { kind: "date", date: rec.next.date, timingNote: null, fromEvents: rec.next.fromEvents }
    : rec?.next?.kind === "month"
      ? { kind: "month", month: rec.next.month, fromEvents: rec.next.fromEvents }
      : { kind: "none" };

const OLD_FORMATTER = `function nextReportText(n) {
  if (n.kind === "date") return formatPlainDate(n.date);
  if (n.kind === "month") return n.month;
  return "—";
}`;

/**
 * A loadSnapshot mutation that puts the OLD tile back: its formatter, and its
 * "Estimated from its last N reports" / "No regular pattern yet" sub-line.
 */
export function oldTileMutation(src) {
  const anchor = "function nextReportText(n: SnapshotNextReport): string {";
  const start = src.indexOf(anchor);
  if (start < 0 || src.indexOf(anchor, start + 1) >= 0) throw new Error("legacy tile: nextReportText anchor must match once");
  const end = src.indexOf("}\n", start) + 2;
  return once(
    "{snapshot.nextReport.hedge ? (",
    `{snapshot.nextReport.kind === "none" ? "No regular pattern yet" : "Estimated from its last " + snapshot.nextReport.fromEvents + " reports"}{false ? (`,
  )(src.slice(0, start) + OLD_FORMATTER + "\n" + src.slice(end));
}

/** The earnings card's old view (NextReportView), off the stored `next`, then FMP. */
export const oldCardView = (rec, fmpDate = null) =>
  rec && rec.next?.kind === "date"
    ? { source: "sec", kind: "date", date: rec.next.date, timing: rec.next.timing, clamped: rec.next.clamped, fromEvents: rec.next.fromEvents }
    : rec && rec.next?.kind === "month"
      ? { source: "sec", kind: "month", month: rec.next.month, fromEvents: rec.next.fromEvents }
      : fmpDate
        ? { source: "fmp", date: fmpDate, time: "amc" }
        : rec?.events?.length
          ? { source: "sec", kind: "none" }
          : null;

/** The earnings card's old JSX, verbatim but for the TIMING_WORDING table it imported. */
export const OLD_CARD_TSX = `
const TIMING_WORDING = {
  "before-open": "Results filed before the open",
  "during-market": "Results filed during market hours",
  "after-close": "Results filed after the close",
};
function monthName(ym) {
  const [y, m] = ym.split("-");
  const idx = Number(m) - 1;
  const names = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  return names[idx] ? \`\${names[idx]} \${y}\` : ym;
}
export default function OldCard({ nextReport, clean }) {
  if (!nextReport) return null;
  return (
                <section className="card">
                  <div className="eyebrow">Next report</div>
                  <h3>Next expected earnings date</h3>
                  {nextReport.source === "fmp" ? (
                    <p style={{ marginBottom: 0 }}>
                      <strong>{nextReport.date}</strong>{nextReport.time ? \` (\${nextReport.time === "bmo" ? "before market open" : nextReport.time === "amc" ? "after market close" : nextReport.time})\` : ""}.
                      {" "}This one comes from the earnings calendar — {clean}&apos;s own filing
                      history has not been read yet.
                    </p>
                  ) : nextReport.kind === "date" ? (
                    <p style={{ marginBottom: 0 }}>
                      <strong>{nextReport.date}</strong>
                      {nextReport.timing ? \`, \${TIMING_WORDING[nextReport.timing].replace("Results filed", "results filed")} if it follows its usual pattern\` : ""}.
                      {" "}Estimated from {clean}&apos;s own past reporting pattern — the gap between
                      the end of its financial quarter and the 8-K it files with the results,
                      over its last {nextReport.fromEvents} reports. It is not a company
                      announcement and the company is free to break the pattern.
                      {nextReport.clamped
                        ? " Pulled back to the SEC's filing deadline for this period, which the pattern would have run past."
                        : ""}
                    </p>
                  ) : nextReport.kind === "none" ? (
                    <p style={{ marginBottom: 0 }}>
                      Not enough regular reporting history to estimate the next report date.
                      {" "}{clean}&apos;s past results filings are spread too widely, or too few
                      of them are on file, for a date or even a month to mean anything here.
                    </p>
                  ) : (
                    <p style={{ marginBottom: 0 }}>
                      Expected in <strong>{monthName(nextReport.month)}</strong>.
                      {" "}{clean} has reported within the same month each year but not on a
                      settled day of it, so no specific date is offered here. Based on its last{" "}
                      {nextReport.fromEvents} reports.
                    </p>
                  )}
                </section>
  );
}`;
