"use client";

// THE ANALYSER'S "FILED EARNINGS" TAB (#563 COWORK #154 §6): a compact chart
// in place of the one sentence it used to show. Bars are the newest 8 filed
// quarters' diluted EPS (the latest highlighted); the line is operating margin.
// The snapshot's verdict chip sits above, "Full earnings →" below.
//
// Fetched only when the tab is open, from /api/dashboard-earnings/SYM (A's
// fact set and view through lib/server/dashboardEarnings.ts, cached an hour).
// Describes the filings; never advises.
import { useEffect, useState } from "react";
import Link from "next/link";
import type { DashboardEarnings, FiledPeriod } from "@/lib/filedEarnings";
import { useFiledEarnings } from "@/app/components/useFiledEarnings";

type Tone = "green" | "yellow" | "red" | null;
const TONE_BG: Record<string, string> = { green: "rgba(34,197,94,0.16)", yellow: "rgba(245,158,11,0.16)", red: "rgba(239,68,68,0.16)" };
const TONE_FG: Record<string, string> = { green: "#86efac", yellow: "#fcd34d", red: "#fca5a5" };

/** The chart: EPS bars on a zero baseline, operating margin as a line on its own scale. Pure, for the check. */
export function FiledBars({ periods }: { periods: FiledPeriod[] }) {
  const W = 320, H = 150, top = 14, bottom = 118, left = 6, right = W - 6;
  const eps = periods.map((p) => p.eps);
  const hi = Math.max(0, ...eps), lo = Math.min(0, ...eps), span = hi - lo || 1;
  const y = (v: number) => top + ((hi - v) / span) * (bottom - top);
  const slot = (right - left) / periods.length, bw = Math.min(26, slot * 0.6);
  const ops = periods.map((p) => p.opPct).filter((v): v is number => v !== null);
  const oHi = Math.max(...ops, 0), oLo = Math.min(...ops, 0), oSpan = oHi - oLo || 1;
  const oy = (v: number) => top + ((oHi - v) / oSpan) * (bottom - top);
  const pts = periods.map((p, i) => (p.opPct === null ? null : `${left + slot * (i + 0.5)},${oy(p.opPct)}`));
  const last = periods.length - 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="feChart" role="img" aria-label={`Diluted EPS for the last ${periods.length} filed periods, ${periods[0].label} to ${periods[last].label}, with operating margin`} data-filed-chart="">
      <line x1={left} x2={right} y1={y(0)} y2={y(0)} stroke="rgba(148,163,184,0.45)" strokeWidth={1} />
      {periods.map((p, i) => {
        const x = left + slot * (i + 0.5) - bw / 2, y0 = y(0), y1 = y(p.eps);
        return (
          <g key={p.label}>
            <rect x={x} y={Math.min(y0, y1)} width={bw} height={Math.max(1, Math.abs(y1 - y0))} rx={3} fill={i === last ? "#60a5fa" : p.eps < 0 ? "rgba(239,68,68,0.55)" : "rgba(96,165,250,0.35)"} data-eps-bar={i === last ? "latest" : ""}>
              <title>{`${p.label}: diluted EPS ${p.epsText}${p.opText ? `, operating margin ${p.opText}` : ""}`}</title>
            </rect>
            <text x={left + slot * (i + 0.5)} y={H - 16} textAnchor="middle" fontSize={10} fill="#94a3b8">{p.short}</text>
            {i === last ? <text x={left + slot * (i + 0.5)} y={Math.min(y0, y1) - 4} textAnchor="middle" fontSize={10.5} fontWeight={800} fill="#e2e8f0">{p.epsText}</text> : null}
          </g>
        );
      })}
      {ops.length > 1 ? <polyline points={pts.filter(Boolean).join(" ")} fill="none" stroke="#f59e0b" strokeWidth={2} data-op-line="" /> : null}
      {periods.map((p, i) => (p.opPct === null ? null : <circle key={`o${p.label}`} cx={left + slot * (i + 0.5)} cy={oy(p.opPct)} r={2.5} fill="#f59e0b" />))}
    </svg>
  );
}

/** One fetch per symbol per visit: switching tabs or symbols back never refetches. */
const SEEN = new Map<string, DashboardEarnings>();

export default function FiledEarningsChart({ symbol, verdict, tone }: { symbol: string; verdict: string | null; tone: Tone }) {
  const { hasFiledEarnings } = useFiledEarnings(); // #552 COWORK #197: earnings link only with a filed set
  // Answers by symbol; state is only set when a fetch settles, never in the effect body.
  const [, setTick] = useState(0);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  useEffect(() => {
    if (SEEN.has(symbol)) return;
    let gone = false;
    fetch(`/api/dashboard-earnings/${encodeURIComponent(symbol)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: DashboardEarnings) => { SEEN.set(symbol, d); if (!gone) setTick((t) => t + 1); })
      .catch(() => { if (!gone) setFailedFor(symbol); });
    return () => { gone = true; };
  }, [symbol]);
  const data = SEEN.get(symbol) ?? null, failed = failedFor === symbol && !data;

  const empty = failed || (data !== null && !data.available);
  const latest = data?.available ? data.periods[data.periods.length - 1] : null;
  return (
    <div className="fe" data-filed-earnings={empty ? "empty" : data ? "chart" : "loading"}>
      {verdict && !empty ? (
        <p className="feHead">
          <span className="feChip" data-verdict-chip="" style={{ background: TONE_BG[tone ?? "yellow"], color: TONE_FG[tone ?? "yellow"] }}>{verdict}</span>
          <span className="feChipNote">on our earnings snapshot</span>
        </p>
      ) : null}
      {empty ? <p className="dlEmpty" data-filed-empty="">Filed figures not available for {symbol}.</p>
        : !data?.available ? <p className="dlEmpty">Loading the filed figures…</p>
        : (
          <>
            <FiledBars periods={data.periods} />
            <p className="feKey" data-fine-print="">
              <i className="feKeyBar" aria-hidden="true" /> Diluted EPS, as filed · <i className="feKeyLine" aria-hidden="true" /> Operating margin
              {latest ? <> · Latest: {latest.label}, {latest.epsText}{latest.opText ? `, ${latest.opText}` : ""}</> : null}
            </p>
          </>
        )}
      {hasFiledEarnings(symbol) ? <Link className="dlMore" href={`/stock/${encodeURIComponent(symbol)}/earnings`} prefetch={false}>Full earnings →</Link> : null}
      <p className="dlFine" data-fine-print="">Filings from SEC EDGAR · per-share figures on today&apos;s share basis</p>
    </div>
  );
}

export const FILED_EARNINGS_CSS = `
.fe{display:grid;gap:8px;}
.feHead{margin:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.feChip{display:inline-block;padding:3px 10px;border-radius:999px;font-weight:900;font-size:var(--fs-label);}
.feChipNote{color:#94a3b8;font-size:var(--fs-label);}
.feChart{display:block;width:100%;height:auto;max-height:220px;}
.feKey{margin:0;color:#94a3b8;font-size:var(--fs-fine);}
.feKeyBar{display:inline-block;width:10px;height:10px;border-radius:2px;background:#60a5fa;vertical-align:middle;}
.feKeyLine{display:inline-block;width:14px;height:0;border-top:2px solid #f59e0b;vertical-align:middle;}
`;
