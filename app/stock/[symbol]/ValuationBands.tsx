"use client";
// THE VALUATION CARD AS LOW / FAIR / RICH BARS (#552 COWORK #202 item 3).
//
// One row per multiple: its short name, a grey line naming it, the figure,
// and a bar in three equal bands (Low · Fair · Rich, green / amber / red
// tints) with the figure in a pill on its place. The bands are the sector's
// quartiles, or the market's where the sector is too thin or too unsteady
// (lib/valuationBands.ts, built server-side); the row says which, and the
// numbers behind it are on tap. A REFUSAL HAS NO MARKER: only its short word
// ("Loss", "Not meaningful", "—"), its reason on tap. No buy or sell wording.
import { EstimatedValue, ReasonedValue } from "@/app/components/EstimatedValue";
import type { EstimateMark } from "@/app/components/estimateMark";

export type ValuationBandView = {
  band: "Low" | "Fair" | "Rich";
  pos: number;
  offScale: boolean;
  basis: "sector" | "market";
  group: string | null;
  note: string;
};

export type ValuationBandRow = {
  key: string;
  short: string;
  long: string;
  /** "TTM to 30 Jun 2026": which twelve months, shown beside the name. */
  basis?: string | null;
  value: number | null | undefined;
  text: string | null;
  word: string | null | undefined;
  reason: string | null | undefined;
  /** "How it's calculated": the figure's own note, when it has a value. */
  how?: string | null;
  est?: EstimateMark | null;
  band: ValuationBandView | null | undefined;
};

// The site's tone family (lib/server/secPresentation toneBg/toneColor), as tints.
const BAND_TINT = { Low: "rgba(34,197,94,0.30)", Fair: "rgba(250,204,21,0.26)", Rich: "rgba(239,68,68,0.30)" } as const;
const BAND_INK = { Low: "#86efac", Fair: "#fde68a", Rich: "#fca5a5" } as const;

export function ValuationBandsCard({ rows }: { rows: ValuationBandRow[] }) {
  return (
    <div className="vbRows" data-valuation-bands="">
      {rows.map((r) => {
        const b = r.value != null ? r.band : null;
        return (
          <div key={r.key} className="vbRow" data-band={b?.band ?? "none"}>
            <div className="vbHead">
              <div>
                <div className="vbShort">{r.short}{r.basis ? <span className="vbBasis"> ({r.basis})</span> : null}</div>
                <div className="vbLong">{r.long}</div>
              </div>
              <div className="vbFigure">
                {r.value != null && r.text
                  ? <EstimatedValue text={r.text} est={r.est ?? null} />
                  : <ReasonedValue text={r.word ?? "—"} reason={r.reason} />}
              </div>
            </div>
            {b ? (
              <>
                <div className="vbBar" role="img" aria-label={`${r.short} ${r.text}: ${b.band} vs ${b.basis}`}>
                  <span className="vbBand" style={{ background: BAND_TINT.Low }} />
                  <span className="vbBand" style={{ background: BAND_TINT.Fair }} />
                  <span className="vbBand" style={{ background: BAND_TINT.Rich }} />
                  <span className="vbPin" style={{ left: `${(b.pos * 100).toFixed(1)}%` }}>
                    {/* NEAR AN END THE PILL HANGS INWARD, so it never runs off a phone. */}
                    <span className="vbPill" style={{ transform: `translateX(${b.pos < 0.15 ? "-12%" : b.pos > 0.85 ? "-88%" : "-50%"})` }}>{r.text}{b.offScale ? " ▸" : ""}</span>
                    <span className="vbPointer" aria-hidden="true" />
                  </span>
                </div>
                <div className="vbScale" aria-hidden="true"><span>Low</span><span>Fair</span><span>Rich</span></div>
                <div className="vbVerdict">
                  <span style={{ color: BAND_INK[b.band], fontWeight: 800 }}>{b.band}</span>{" "}
                  <ReasonedValue text={`vs ${b.basis === "sector" ? "sector" : "market"}${b.basis === "sector" && b.group ? ` (${b.group})` : ""}`} reason={b.note} />
                </div>
              </>
            ) : null}
            {r.value != null && r.how ? (
              <details className="valuationHow" style={{ marginTop: 6 }}>
                <summary style={{ cursor: "pointer", fontSize: "var(--fs-label)", fontWeight: 700, color: "rgba(147,197,253,0.85)" }}>How it&apos;s calculated</summary>
                <div style={{ marginTop: 6, fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)", color: "rgba(226,232,240,0.85)" }}>{r.how}</div>
              </details>
            ) : null}
          </div>
        );
      })}
      <style>{`
        .vbRows { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0; }
        .vbRow { padding: 14px 0; border-bottom: 1px solid rgba(255,255,255,0.07); min-width: 0; }
        .vbHead { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
        .vbShort { font-size: var(--fs-read); font-weight: 800; color: #f1f5f9; }
        .vbBasis { font-weight: 600; color: #94a3b8; font-size: var(--fs-label); }
        .vbLong { font-size: var(--fs-label); color: #94a3b8; margin-top: 2px; }
        .vbFigure { font-size: 1.25rem; font-weight: 800; letter-spacing: -0.02em; white-space: nowrap; }
        .vbBar { position: relative; display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px; height: 10px; margin: 30px 0 4px; }
        .vbBand { border-radius: 4px; }
        .vbPin { position: absolute; bottom: -3px; width: 0; height: 16px; pointer-events: none; }
        .vbPill { position: absolute; bottom: 21px; left: 0; padding: 1px 7px; border-radius: 999px; background: #0b1220; border: 1px solid rgba(241,245,249,0.75); color: #f8fafc; font-size: var(--fs-fine); font-weight: 800; white-space: nowrap; }
        .vbPointer { position: absolute; left: -1px; bottom: 0; width: 2px; height: 16px; background: #f8fafc; border-radius: 1px; }
        .vbScale { display: grid; grid-template-columns: repeat(3, 1fr); font-size: var(--fs-fine); color: #94a3b8; text-align: center; }
        .vbVerdict { margin-top: 6px; font-size: var(--fs-label); color: #cbd5e1; }
      `}</style>
    </div>
  );
}
