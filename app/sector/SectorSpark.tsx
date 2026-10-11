import type { CSSProperties } from "react";
import { sparkPath, sparkUp } from "@/lib/sectorSeries";

// THE SECTOR'S 3-MONTH LINE, DRAWN ON THE SERVER (#553 COWORK #157/#167/#180).
//
// The series stays on the server: this renders the SVG path only, so the page
// ships a path string and never the points (no public JSON, no client prop).
// Faint by design -- it sits behind the card's own figures, not in place of
// them, and carries no axis or values. Nothing renders when the night's lines
// are not on file (row.spark null), so a missing line is absence, not a flat.

const W = 300;
const H = 60;

export default function SectorSpark({
  v,
  variant = "background",
  style,
}: {
  v: readonly number[] | null | undefined;
  /** "background" fills its positioned parent; "strip" is a labelled 40 px band. */
  variant?: "background" | "strip";
  style?: CSSProperties;
}) {
  if (!v || v.length < 2) return null;
  const d = sparkPath(v, W, H, 3);
  if (!d) return null;
  const stroke = sparkUp(v) ? "rgba(74,222,128,0.42)" : "rgba(248,113,113,0.42)";
  const svg = (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      data-sector-spark
      style={{ display: "block", width: "100%", height: "100%" }}
    >
      <path d={d} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
  if (variant === "strip") {
    return (
      <div style={{ marginTop: 10, ...style }}>
        <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(191,219,254,0.7)" }}>Last 3 months</div>
        <div style={{ height: 40, marginTop: 6 }}>{svg}</div>
      </div>
    );
  }
  return (
    <div
      style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "55%", pointerEvents: "none", opacity: 0.9, zIndex: 0, ...style }}
    >
      {svg}
    </div>
  );
}
