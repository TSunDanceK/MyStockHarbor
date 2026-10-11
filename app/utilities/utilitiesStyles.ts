import type { CSSProperties } from "react";

export function calculatorPanelStyle(): CSSProperties {
  return {
    border: "1px solid rgba(59,130,246,0.24)",
    borderRadius: 20,
    padding: 18,
    background:
      "linear-gradient(180deg, rgba(8,22,45,0.94), rgba(7,18,36,0.98))",
    boxShadow:
      "0 16px 34px rgba(0,0,0,0.20), inset 0 1px 0 rgba(255,255,255,0.05)",
  };
}

export function badgeStyle(type: "blue" | "green"): CSSProperties {
  if (type === "green") {
    return {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "6px 10px",
      borderRadius: 999,
      background: "#0f2c24",
      border: "1px solid rgba(34,197,94,0.24)",
      fontSize: 12,
      fontWeight: 900,
      letterSpacing: "0.3px",
      color: "#f8fafc",
    };
  }

  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 999,
    background: "#102a52",
    border: "1px solid rgba(59,130,246,0.24)",
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: "0.3px",
    color: "#f8fafc",
  };
}

export function inputStyle(): CSSProperties {
  return {
    width: "100%",
    height: 44,
    padding: "0 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "#1a2742",
    color: "#f8fafc",
    outline: "none",
    fontSize: 14,
    fontWeight: 700,
    boxSizing: "border-box",
  };
}

export function selectStyle(): CSSProperties {
  return {
    width: "100%",
    height: 44,
    padding: "0 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "#1a2742",
    color: "#f8fafc",
    outline: "none",
    fontSize: 14,
    fontWeight: 700,
    boxSizing: "border-box",
  };
}

export function baseResultBoxStyle(): CSSProperties {
  return {
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "linear-gradient(135deg, rgba(19,35,59,0.96), rgba(15,23,42,0.92))",
    padding: 14,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.045)",
  };
}

export function infoCardStyle(): CSSProperties {
  return {
    borderRadius: 14,
    border: "1px solid rgba(59,130,246,0.18)",
    background: "linear-gradient(135deg, rgba(59,130,246,0.08), rgba(19,35,59,0.94))",
    padding: 14,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
  };
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
  return {
    border: "1px solid rgba(59,130,246,0.20)",
    borderRadius: 16,
    padding: 15,
    background:
      "linear-gradient(135deg, rgba(59,130,246,0.09), rgba(255,255,255,0.035))",
    color: "#f1f5f9",
    textDecoration: "none",
    display: "block",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.045)",
  };
}

export function infoSectionStyle(): CSSProperties {
  return {
    marginTop: 24,
    border: "1px solid rgba(59,130,246,0.18)",
    borderRadius: 20,
    padding: 18,
    background: "linear-gradient(135deg, rgba(59,130,246,0.07), rgba(255,255,255,0.03))",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.045)",
  };
}

export function sectionEyebrowStyle(type: "blue" | "green" | "red" | "yellow"): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    fontWeight: 950,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color:
      type === "green"
        ? "#86efac"
        : type === "red"
        ? "#fca5a5"
        : type === "yellow"
        ? "#fde68a"
        : "#93c5fd",
  };
}

export function utilityIconStyle(type: "blue" | "green" | "red" | "yellow"): CSSProperties {
  return {
    width: 42,
    height: 42,
    borderRadius: 999,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "0 0 auto",
    fontSize: 21,
    background:
      type === "green"
        ? "rgba(34,197,94,0.18)"
        : type === "red"
        ? "rgba(239,68,68,0.18)"
        : type === "yellow"
        ? "rgba(250,204,21,0.18)"
        : "rgba(59,130,246,0.18)",
    border:
      type === "green"
        ? "1px solid rgba(34,197,94,0.34)"
        : type === "red"
        ? "1px solid rgba(239,68,68,0.34)"
        : type === "yellow"
        ? "1px solid rgba(250,204,21,0.34)"
        : "1px solid rgba(59,130,246,0.34)",
    boxShadow:
      type === "green"
        ? "0 0 18px rgba(34,197,94,0.16)"
        : type === "red"
        ? "0 0 18px rgba(239,68,68,0.16)"
        : type === "yellow"
        ? "0 0 18px rgba(250,204,21,0.16)"
        : "0 0 18px rgba(59,130,246,0.16)",
  };
}

export function calloutCardStyle(type: "blue" | "green" | "red" | "yellow"): CSSProperties {
  return {
    borderRadius: 16,
    border:
      type === "green"
        ? "1px solid rgba(34,197,94,0.24)"
        : type === "red"
        ? "1px solid rgba(239,68,68,0.24)"
        : type === "yellow"
        ? "1px solid rgba(250,204,21,0.24)"
        : "1px solid rgba(59,130,246,0.24)",
    background:
      type === "green"
        ? "linear-gradient(135deg, rgba(34,197,94,0.10), rgba(255,255,255,0.035))"
        : type === "red"
        ? "linear-gradient(135deg, rgba(239,68,68,0.10), rgba(255,255,255,0.035))"
        : type === "yellow"
        ? "linear-gradient(135deg, rgba(250,204,21,0.12), rgba(255,255,255,0.035))"
        : "linear-gradient(135deg, rgba(59,130,246,0.12), rgba(255,255,255,0.035))",
    padding: 16,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.045)",
  };
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
  emphasize = false
): CSSProperties {
  const base = baseResultBoxStyle();

  if (type === "green") {
    return {
      ...base,
      border: "1px solid rgba(34,197,94,0.44)",
      background: "linear-gradient(135deg, rgba(11,61,44,0.95), #13233b)",
      boxShadow: emphasize ? "0 0 0 1px rgba(34,197,94,0.10) inset" : "none",
    };
  }

  if (type === "yellow") {
    return {
      ...base,
      border: "1px solid rgba(234,179,8,0.42)",
      background: "linear-gradient(135deg, rgba(78,56,12,0.95), #13233b)",
    };
  }

  if (type === "red") {
    return {
      ...base,
      border: "1px solid rgba(239,68,68,0.46)",
      background: "linear-gradient(135deg, rgba(83,22,22,0.95), #13233b)",
    };
  }

  return base;
}
