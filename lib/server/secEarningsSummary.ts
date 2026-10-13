// THE DASHBOARD'S "EARNINGS" PILL, FROM THE SAME SEC SNAPSHOT THE STOCK PAGE
// SHOWS (#535 COWORK #18 §3).
//
// The pill read lib/latest-earnings-data.ts, which scores FMP's /stable/earnings
// and analyst estimates — a second score beside the SEC one on the stock page,
// for the same company. It now takes the stock page's own verdict: the band the
// SEC scorer put the latest filing in, or "Unavailable" when it could not score.
// Only the fields the dashboard reads; no dates, no surprises.
import { getSecEarningsSnapshot } from "./secEarningsSnapshot";

export type SecEarningsSummary = {
  hasStructuredData: boolean;
  tone: "green" | "yellow" | "red";
  toneLabel: string;
  /**
   * THE NEXT REPORT, from the same snapshot (#563 COWORK #134, the dashboard's
   * analyser): its value line ("~19–25 Oct") or headline, and whether it is an
   * estimate (it carries a hedge). No extra read.
   */
  nextReport?: { text: string; estimated: boolean } | null;
};

const PAINT = { good: "green", neutral: "yellow", weak: "red" } as const;

export async function secEarningsSummary(symbol: string): Promise<SecEarningsSummary> {
  try {
    const snap = await getSecEarningsSnapshot(symbol);
    if (!snap.available) return { hasStructuredData: false, tone: "yellow", toneLabel: "Unavailable" };
    const nr = snap.nextReport;
    return {
      hasStructuredData: true, tone: PAINT[snap.tone], toneLabel: snap.toneLabel,
      nextReport: nr && (nr.kind === "due" || nr.kind === "expected") ? { text: nr.value ?? nr.headline, estimated: nr.hedge !== null } : null,
    };
  } catch {
    return { hasStructuredData: false, tone: "yellow", toneLabel: "Unavailable" };
  }
}
