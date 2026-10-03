// THE PERFORMANCE STRIP (#563 COWORK #69): six chips under the header strip,
// 1M · 3M · YTD · 1Y · 3Y · 5Y, each the price change with ▲/▼ and colour (never
// colour alone: the arrow and the sign say it too) and a second line against
// the S&P 500. A tap opens the exact dates and closes (A's ReasonedValue).
//
// Presentation only: the page computes the strip server-side (lib/ta/
// performance.ts over the bars it already reads) and hands down derived
// percentages, never bars.
import type { CSSProperties, ReactNode } from "react";
import { ReasonedValue } from "@/app/components/EstimatedValue";
import { pctWords, spyWords, type PerfStrip } from "@/lib/ta/performance";

const C = { up: "#4ade80", down: "#f87171", flat: "rgba(226,232,240,0.8)", muted: "rgba(203,213,225,0.62)", rule: "rgba(255,255,255,0.08)" };

export default function PerformanceStrip({ strip, credit }: { strip: PerfStrip; credit?: ReactNode }) {
  if (!strip.chips.length) return null;
  return (
    <div className="perfStrip" style={{ marginTop: 16 }}>
      <div className="perfChips">
        {strip.chips.map((c) => {
          const tone = c.pct === null ? "flat" : c.pct > 0 ? "up" : c.pct < 0 ? "down" : "flat";
          const arrow = c.pct === null ? "" : c.pct > 0 ? "▲ " : c.pct < 0 ? "▼ " : "";
          return (
            <div key={c.key} className="perfChip" data-key={c.key} data-tone={tone} style={chipStyle}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.07em", color: C.muted }}>{c.key}</div>
              <div className="perfPct" style={{ marginTop: 2, fontSize: 15, fontWeight: 850, color: C[tone], whiteSpace: "nowrap" }}>
                <ReasonedValue text={c.pct === null ? "—" : `${arrow}${pctWords(c.pct)}`} reason={c.note} />
              </div>
              <div className="perfSpy" style={{ marginTop: 2, fontSize: 10.5, lineHeight: 1.3, color: C.muted }}>
                {c.diffPts !== null ? spyWords(c.diffPts) : c.pct === null ? "" : "S&P 500: not on file"}
              </div>
            </div>
          );
        })}
      </div>
      {strip.asOfWords ? (
        <p style={{ margin: "8px 0 0", fontSize: 12, opacity: 0.6 }}>
          Closes to {strip.asOfWords} · price change only{credit ? <> · {credit}</> : null}
        </p>
      ) : null}
      <style>{`
        .perfChips { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; }
        @media (max-width: 640px) { .perfChips { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        @media (max-width: 360px) { .perfChips { gap: 6px; } .perfChip { padding: 7px 6px !important; } .perfPct { font-size: 13px !important; } }
      `}</style>
    </div>
  );
}

const chipStyle: CSSProperties = {
  minWidth: 0, padding: "8px 10px", borderRadius: 12, border: `1px solid ${C.rule}`, background: "rgba(255,255,255,0.025)",
};
