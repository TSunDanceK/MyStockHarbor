"use client";

import { useEffect, useState, useRef } from "react";

const STEPS = [
  { label: "Fetching latest headlines",  sub: "News feed"    },
  { label: "Pulling price & chart data", sub: "Market data"  },
  { label: "Scoring headline sentiment", sub: "News score"   },
  { label: "Loading earnings data",      sub: "Earnings"     },
  { label: "Running AI analysis",        sub: "AI"           },
  { label: "Assembling your briefing",   sub: "Almost there" },
];

// Approximate time each step takes before advancing.
// The last step holds indefinitely — the page resolves when the server is done.
const STEP_DURATIONS_MS = [900, 700, 650, 1100, 99999, 500];

const TARGET_PCTS = [12, 24, 38, 55, 88, 100];

type StepState = "pending" | "active" | "done";

function useAnimatedPct(target: number) {
  const [pct, setPct] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    let startPct = 0;
    setPct((prev) => { startPct = prev; return prev; });

    const duration = 600;
    const t0 = performance.now();

    function tick(now: number) {
      const p = Math.min((now - t0) / duration, 1);
      const eased = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
      const next = Math.round(startPct + (target - startPct) * eased);
      setPct(next);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); };
  }, [target]);

  return pct;
}

function SymbolFromPath() {
  const [sym, setSym] = useState("STOCK");

  useEffect(() => {
    try {
      const parts = window.location.pathname.split("/").filter(Boolean);
      // path: /stock/[symbol]/news  →  parts[0]="stock" parts[1]=symbol parts[2]="news"
      const candidate = parts[1]?.toUpperCase();
      if (candidate && /^[A-Z0-9.^-]{1,8}$/.test(candidate)) {
        setSym(candidate);
      }
    } catch {
      // non-browser — keep default
    }
  }, []);

  return <>{sym}</>;
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <div style={iconStyle("done")}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 6l3 3 5-5" stroke="#4ade80" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }
  if (state === "active") {
    return (
      <div style={iconStyle("active")}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ animation: "mshSpin 0.85s linear infinite" }}>
          <circle cx="6" cy="6" r="4.5" stroke="rgba(96,165,250,0.25)" strokeWidth="1.5" />
          <path d="M6 1.5A4.5 4.5 0 0 1 10.5 6" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
    );
  }
  return <div style={iconStyle("pending")} />;
}

export default function StockNewsLoading() {
  const [current, setCurrent] = useState(0);
  const targetPct = TARGET_PCTS[Math.min(current, TARGET_PCTS.length - 1)];
  const pct = useAnimatedPct(targetPct);

  useEffect(() => {
    if (current >= STEPS.length) return;
    const dur = STEP_DURATIONS_MS[current];
    if (dur >= 99000) return; // hold indefinitely on AI step
    const t = setTimeout(() => setCurrent((c) => c + 1), dur);
    return () => clearTimeout(t);
  }, [current]);

  const activeLabel = current < STEPS.length ? STEPS[current].label : "Ready";

  return (
    <main style={mainStyle}>
      <div style={innerStyle}>

        {/* Tag */}
        <div style={tagStyle}>
          <div style={pulseDotStyle} />
          News desk
        </div>

        {/* Symbol */}
        <div style={symbolStyle}>
          <SymbolFromPath />
        </div>
        <div style={subtitleStyle}>Building your stock news briefing</div>

        {/* Progress bar */}
        <div style={pctRowStyle}>
          <span style={pctLabelStyle}>{pct}%</span>
        </div>
        <div style={trackStyle}>
          <div style={{ ...fillStyle, width: `${pct}%` }} />
        </div>

        {/* Steps */}
        <div style={{ marginTop: 24 }}>
          {STEPS.map((step, i) => {
            const state: StepState = i < current ? "done" : i === current ? "active" : "pending";
            return (
              <div key={step.label} style={rowStyle(state)}>
                <StepIcon state={state} />
                <span style={stepTextStyle(state)}>{step.label}</span>
                <span style={stepSubStyle(state)}>
                  {state === "done" ? "Done" : state === "active" ? "Working…" : ""}
                </span>
              </div>
            );
          })}
        </div>

        {/* Footer line */}
        <div style={etaStyle}>{activeLabel}…</div>
      </div>

      <style>{`
        @keyframes mshPulseDot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.35; transform: scale(0.65); }
        }
        @keyframes mshSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes mshFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </main>
  );
}

/* ─── styles ─────────────────────────────────────────────── */

const mainStyle: React.CSSProperties = {
  minHeight: "100vh",
  background:
    "radial-gradient(circle at top left, rgba(37,99,235,0.18), transparent 22%), " +
    "radial-gradient(circle at top right, rgba(34,197,94,0.10), transparent 22%), #06080d",
  color: "#f1f5f9",
  fontFamily: "system-ui, Arial",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "40px 20px",
  boxSizing: "border-box",
};

const innerStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 520,
  animation: "mshFadeIn 0.4s ease both",
};

const tagStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "7px 13px",
  borderRadius: 999,
  border: "1px solid rgba(59,130,246,0.30)",
  background: "rgba(59,130,246,0.10)",
  color: "#dbeafe",
  fontSize: 11,
  fontWeight: 900,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  marginBottom: 28,
};

const pulseDotStyle: React.CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: "50%",
  background: "#60a5fa",
  animation: "mshPulseDot 1.2s ease-in-out infinite",
};

const symbolStyle: React.CSSProperties = {
  fontSize: 52,
  fontWeight: 900,
  color: "#f8fafc",
  letterSpacing: "-0.04em",
  lineHeight: 1,
  marginBottom: 6,
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 14,
  color: "rgba(148,163,184,0.70)",
  marginBottom: 32,
  fontWeight: 600,
  letterSpacing: "0.02em",
};

const pctRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  marginBottom: 6,
};

const pctLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "rgba(148,163,184,0.55)",
  letterSpacing: "0.04em",
};

const trackStyle: React.CSSProperties = {
  width: "100%",
  height: 6,
  borderRadius: 999,
  background: "rgba(255,255,255,0.07)",
  overflow: "hidden",
};

const fillStyle: React.CSSProperties = {
  height: "100%",
  borderRadius: 999,
  background: "linear-gradient(90deg, #3b82f6, #22c55e)",
  transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)",
};

function rowStyle(state: StepState): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "11px 0",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
    opacity: state === "pending" ? 0.28 : state === "done" ? 0.55 : 1,
    transition: "opacity 0.3s ease",
  };
}

function iconStyle(state: StepState): React.CSSProperties {
  const base: React.CSSProperties = {
    width: 26,
    height: 26,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  };
  if (state === "done")    return { ...base, border: "1.5px solid rgba(34,197,94,0.40)",  background: "rgba(34,197,94,0.10)" };
  if (state === "active")  return { ...base, border: "1.5px solid rgba(59,130,246,0.55)", background: "rgba(59,130,246,0.10)" };
  return { ...base, border: "1.5px solid rgba(255,255,255,0.12)", background: "transparent" };
}

function stepTextStyle(state: StepState): React.CSSProperties {
  return {
    fontSize: 14,
    flex: 1,
    color: state === "pending" ? "rgba(241,245,249,0.38)" : "#f1f5f9",
  };
}

function stepSubStyle(state: StepState): React.CSSProperties {
  return {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: state === "done" ? "#4ade80" : state === "active" ? "#60a5fa" : "transparent",
    minWidth: 70,
    textAlign: "right",
  };
}

const etaStyle: React.CSSProperties = {
  marginTop: 22,
  fontSize: 12,
  color: "rgba(148,163,184,0.42)",
  textAlign: "center",
  letterSpacing: "0.03em",
};
