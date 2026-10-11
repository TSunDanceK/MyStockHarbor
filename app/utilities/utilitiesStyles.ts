import type { CSSProperties } from "react";

// THE SITE'S PALETTE (#563 COWORK #166 PR 4): the dashboard's cards, borders
// and tiles, one eyebrow hue, no gradients and no rainbow accents. Green,
// amber and red stay only where they mean something (a result's risk level),
// and there only as a muted border.
const CARD_BG = "#0d1422", CARD_BORDER = "1px solid #1f2b44", TILE_BG = "#0f1624", TILE_BORDER = "1px solid #222c40";
const EYEBROW = "#93c5fd", MUTED = "#8a97ad";

export function calculatorPanelStyle(): CSSProperties {
  return { border: CARD_BORDER, borderRadius: 20, padding: 18, background: CARD_BG };
}

export function badgeStyle(_type: "blue" | "green"): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "5px 10px",
    borderRadius: 999,
    background: TILE_BG,
    border: TILE_BORDER,
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: "0.06em",
    color: MUTED,
  };
}

export function inputStyle(): CSSProperties {
  return {
    width: "100%",
    height: 44,
    padding: "0 14px",
    borderRadius: 12,
    border: TILE_BORDER,
    background: TILE_BG,
    color: "#f1f5f9",
    outline: "none",
    fontSize: 14,
    fontWeight: 700,
    boxSizing: "border-box",
  };
}

export function selectStyle(): CSSProperties {
  return inputStyle();
}

export function baseResultBoxStyle(): CSSProperties {
  return { borderRadius: 14, border: TILE_BORDER, background: TILE_BG, padding: 14 };
}

export function infoCardStyle(): CSSProperties {
  return { borderRadius: 14, border: TILE_BORDER, background: TILE_BG, padding: 14 };
}

export function labelStyle(): CSSProperties {
  return {
    fontSize: 12,
    fontWeight: 850,
    color: "rgba(241,245,249,0.90)",
    marginBottom: 6,
    display: "flex",
    alignItems: "center",
    gap: 2,
    flexWrap: "wrap",
  };
}

export function resultLabelStyle(): CSSProperties {
  return {
    fontSize: 12,
    color: "rgba(241,245,249,0.82)",
    fontWeight: 850,
    display: "flex",
    alignItems: "center",
    gap: 2,
    flexWrap: "wrap",
  };
}

export function guideCardStyle(): CSSProperties {
  return { border: TILE_BORDER, borderRadius: 14, padding: 15, background: TILE_BG, color: "#f1f5f9", textDecoration: "none", display: "block" };
}

export function infoSectionStyle(): CSSProperties {
  return { marginTop: 24, border: CARD_BORDER, borderRadius: 20, padding: 18, background: CARD_BG };
}

export function sectionEyebrowStyle(_type: "blue" | "green" | "red" | "yellow"): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: EYEBROW,
  };
}

/** The old round emoji badge, now muted; the live page no longer draws icons (#166 PR 4). */
export function utilityIconStyle(_type: "blue" | "green" | "red" | "yellow"): CSSProperties {
  return {
    width: 36,
    height: 36,
    borderRadius: 999,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "0 0 auto",
    fontSize: 18,
    background: TILE_BG,
    border: TILE_BORDER,
    color: MUTED,
  };
}

export function calloutCardStyle(_type: "blue" | "green" | "red" | "yellow"): CSSProperties {
  return { borderRadius: 16, border: TILE_BORDER, background: TILE_BG, padding: 16 };
}

export function toNum(v: string) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

export function fmtMoney(v: number | null) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}

export function fmtPct(v: number | null) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}%`;
}

export function fmtNum(v: number | null) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}`;
}

export function getLiquidationColor(distance: number | null) {
  if (distance == null || !Number.isFinite(distance)) return "neutral";
  if (distance >= 50) return "green";
  if (distance >= 31) return "yellow";
  return "red";
}

export function getRRColor(rr: number | null) {
  if (rr == null || !Number.isFinite(rr)) return "neutral";
  if (rr >= 2.5) return "green";
  if (rr >= 1.5) return "yellow";
  return "red";
}

export function tintBox(
  type: "neutral" | "green" | "yellow" | "red",
  _emphasize = false
): CSSProperties {
  const base = baseResultBoxStyle();
  // The risk level as a muted border only; the box itself stays the site's tile.
  if (type === "green") return { ...base, border: "1px solid rgba(34,197,94,0.38)" };
  if (type === "yellow") return { ...base, border: "1px solid rgba(234,179,8,0.38)" };
  if (type === "red") return { ...base, border: "1px solid rgba(239,68,68,0.40)" };
  return base;
}
