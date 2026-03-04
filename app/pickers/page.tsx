export const dynamic = "force-dynamic";

type PickerSection = {
  title: string;
  description?: string;
  items: { symbol: string; note?: string; tone?: "green" | "yellow" | "orange" | "red" }[];
};

function toneDot(tone?: string) {
  if (tone === "green") return "#22c55e";
  if (tone === "yellow") return "#eab308";
  if (tone === "orange") return "#fb923c";
  if (tone === "red") return "#ef4444";
  return "rgba(255,255,255,0.35)";
}

export default async function PickersPage() {
  // For now: hard-coded lists (fast to ship).
  // Next step (later): replace with API-backed “live screeners”.
  const sections: PickerSection[] = [
    {
      title: "Green Composite (Oversold-leaning)",
      description: "Stocks flashing multiple oversold / dip-style signals.",
      items: [
        { symbol: "AAPL", note: "Example", tone: "green" },
        { symbol: "MSFT", note: "Example", tone: "green" },
      ],
    },
    {
      title: "Red Composite (Overbought-leaning)",
      description: "Stocks looking stretched / extended / euphoric.",
      items: [
        { symbol: "NVDA", note: "Example", tone: "red" },
        { symbol: "TSLA", note: "Example", tone: "red" },
      ],
    },
    {
      title: "Buy The Dip",
      description: "Pullbacks in uptrends (you’ll define the rules).",
      items: [{ symbol: "AMZN", note: "Example", tone: "yellow" }],
    },
    {
      title: "Breakouts",
      description: "Strength + new highs / range breaks (you’ll define the rules).",
      items: [{ symbol: "META", note: "Example", tone: "orange" }],
    },
  ];

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
            fontWeight: 800,
            background: "rgba(255,255,255,0.06)",
          }}
        >
          ← Back to Dashboard
        </a>
      </div>

      <div style={{ marginTop: 20, display: "grid", gap: 16, maxWidth: 980 }}>
        {sections.map((sec) => (
          <section
            key={sec.title}
            style={{
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 14,
              padding: 16,
              background: "#0b1220",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 950 }}>{sec.title}</div>
                {sec.description ? (
                  <div style={{ marginTop: 6, fontSize: 13, opacity: 0.7 }}>{sec.description}</div>
                ) : null}
              </div>
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
              {sec.items.map((it) => (
                <a
                  key={it.symbol}
                  href={`/?symbol=${encodeURIComponent(it.symbol)}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 12px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: "rgba(255,255,255,0.06)",
                    color: "#f1f5f9",
                    textDecoration: "none",
                    fontWeight: 900,
                  }}
                  title={it.note ?? "Open in dashboard"}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      background: toneDot(it.tone),
                      boxShadow: "0 0 0 3px rgba(255,255,255,0.04)",
                      flex: "0 0 auto",
                    }}
                  />
                  {it.symbol}
                  {it.note ? <span style={{ fontSize: 12, opacity: 0.65, fontWeight: 700 }}>{it.note}</span> : null}
                </a>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
