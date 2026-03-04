"use client";

import React, { useEffect, useMemo, useState } from "react";

type PickerRow = {
  symbol: string;
  name?: string | null;
  last: number | null;
  sourceTag: "TOP50" | "OTHER";

  composite?: {
    overbought: number;
    oversold: number;
    spikes: number;
    flagged: number;
    total: number;
    net: number;
  } | null;

  dip?: {
    ath: number | null;
    drawdownPct: number | null;
    athDaysAgo: number | null;
  } | null;

  breakout?: {
    ath: number | null;
    athDaysAgo: number | null;
  } | null;
};

type Payload = {
  updatedAt: string;
  greenComposite: PickerRow[];
  redComposite: PickerRow[];
  buyTheDip: PickerRow[];
  breakouts: PickerRow[];
};

function dotColor(kind: "green" | "red" | "blue" | "muted") {
  if (kind === "green") return "#22c55e";
  if (kind === "red") return "#ef4444";
  if (kind === "blue") return "#3b82f6";
  return "rgba(255,255,255,0.35)";
}

function numOrDash(x: number | null | undefined, digits = 1) {
  if (typeof x !== "number" || !Number.isFinite(x)) return "—";
  return x.toFixed(digits);
}

export default function PickersClient() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch("/api/pickers", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed");
        const json = (await res.json()) as Payload;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setErr("Could not load Trading Styles right now.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const updatedAtText = useMemo(() => {
    if (!data?.updatedAt) return null;
    try {
      return new Date(data.updatedAt).toLocaleString();
    } catch {
      return data.updatedAt;
    }
  }, [data?.updatedAt]);

  const cardStyle = {
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 14,
    padding: 16,
    background: "#0b1220",
  } as const;

  const pillStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 999,
    fontWeight: 950,
    fontSize: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.06)",
  } as const;

  const renderList = (rows: PickerRow[], mode: "green" | "red" | "dip" | "breakout") => {
    if (!rows.length) return <div style={{ opacity: 0.7 }}>No matches right now.</div>;

    return (
      <div style={{ display: "grid", gap: 10 }}>
        {rows.map((r) => {
          const top50 = r.sourceTag === "TOP50";

          let leftDot = dotColor("muted");
          let rightText = "";

          if (mode === "green" && r.composite) {
            leftDot = dotColor("green");
            rightText = `${r.composite.oversold} green • ${r.composite.flagged}/${r.composite.total}`;
          }

          if (mode === "red" && r.composite) {
            leftDot = dotColor("red");
            rightText = `${r.composite.overbought} red • ${r.composite.flagged}/${r.composite.total}`;
          }

          if (mode === "dip" && r.dip) {
            leftDot = dotColor("green");
            rightText = `${numOrDash(r.dip.drawdownPct, 1)}% • ATH ${r.dip.athDaysAgo ?? "—"}d ago`;
          }

          if (mode === "breakout" && r.breakout) {
            leftDot = dotColor("blue");
            rightText = `ATH ${r.breakout.athDaysAgo ?? "—"}d ago`;
          }

          return (
            <a
              key={r.symbol}
              href={`/?symbol=${encodeURIComponent(r.symbol)}`}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.14)",
                background: "rgba(255,255,255,0.04)",
                color: "#f1f5f9",
                textDecoration: "none",
              }}
              title="Open in dashboard"
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: leftDot,
                    boxShadow: "0 0 0 3px rgba(255,255,255,0.04)",
                    flex: "0 0 auto",
                  }}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 1000, letterSpacing: "-0.2px" }}>
                    {r.symbol}{" "}
                    {top50 ? <span style={{ ...pillStyle, marginLeft: 8 }}>Top Traded</span> : null}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      opacity: 0.7,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {typeof r.last === "number" ? `$${r.last.toFixed(2)}` : ""}
                  </div>
                </div>
              </div>

              <div style={{ fontSize: 12, fontWeight: 950, opacity: 0.8, whiteSpace: "nowrap" }}>{rightText}</div>
            </a>
          );
        })}
      </div>
    );
  };

  return (
    <main
      style={{
        padding: 40,
        fontFamily: "system-ui, Arial",
        background: "#06080d",
        color: "#f1f5f9",
        minHeight: "100vh",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 32, letterSpacing: "-0.3px" }}>Trading Styles</h1>
          <p style={{ marginTop: 10, opacity: 0.75 }}>
            Pick a style → click a stock → jump straight into the dashboard.
            {updatedAtText ? ` • Updated: ${updatedAtText}` : ""}
          </p>
        </div>

        <a
          href="/"
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.18)",
            textDecoration: "none",
            color: "#f1f5f9",
            fontWeight: 900,
            background: "rgba(255,255,255,0.06)",
          }}
        >
          ← Back to Dashboard
        </a>
      </div>

      {loading ? <div style={{ marginTop: 18, opacity: 0.8 }}>Loading…</div> : null}
      {err ? <div style={{ marginTop: 18 }}>{err}</div> : null}

      {data ? (
        <div style={{ marginTop: 20, display: "grid", gap: 16, maxWidth: 980 }}>
          <section style={cardStyle}>
            <div style={{ fontSize: 18, fontWeight: 1000 }}>Green Composite (Oversold-leaning)</div>
            <div style={{ marginTop: 12 }}>{renderList(data.greenComposite, "green")}</div>
          </section>

          <section style={cardStyle}>
            <div style={{ fontSize: 18, fontWeight: 1000 }}>Red Composite (Overbought-leaning)</div>
            <div style={{ marginTop: 12 }}>{renderList(data.redComposite, "red")}</div>
          </section>

          <section style={cardStyle}>
            <div style={{ fontSize: 18, fontWeight: 1000 }}>Buy The Dip</div>
            <div style={{ marginTop: 12 }}>{renderList(data.buyTheDip, "dip")}</div>
          </section>

          <section style={cardStyle}>
            <div style={{ fontSize: 18, fontWeight: 1000 }}>Breakouts</div>
            <div style={{ marginTop: 12 }}>{renderList(data.breakouts, "breakout")}</div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
