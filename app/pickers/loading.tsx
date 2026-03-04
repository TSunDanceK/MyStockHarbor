"use client";

export default function Loading() {
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
          <h1 style={{ margin: 0, fontSize: 32, letterSpacing: "-0.3px" }}>Find Your Next Stock</h1>
          <p style={{ marginTop: 10, opacity: 0.75 }}>Loading screeners…</p>
        </div>

        <div
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.18)",
            background: "rgba(255,255,255,0.06)",
            opacity: 0.8,
            fontWeight: 800,
          }}
        >
          ← Back to Dashboard
        </div>
      </div>

      {/* fake progress bar */}
      <div
        style={{
          marginTop: 18,
          maxWidth: 980,
          borderRadius: 999,
          height: 10,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.14)",
          background: "rgba(255,255,255,0.06)",
        }}
      >
<div
  style={{
    height: "100%",
    width: "35%",
    borderRadius: 999,
    background: "rgba(59,130,246,0.85)",
    display: "block",
    willChange: "transform",
    animation: "pickersBar 1.1s infinite linear",
  }}
/>

      <div style={{ marginTop: 22, display: "grid", gap: 16, maxWidth: 980 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <section
            key={i}
            style={{
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 14,
              padding: 16,
              background: "#0b1220",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
              <div style={{ width: 260, height: 18, borderRadius: 8, background: "rgba(255,255,255,0.08)" }} />
              <div style={{ width: 90, height: 14, borderRadius: 8, background: "rgba(255,255,255,0.06)" }} />
            </div>

            <div style={{ marginTop: 10, width: 420, height: 12, borderRadius: 8, background: "rgba(255,255,255,0.06)" }} />

            <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
              {Array.from({ length: 10 }).map((__, j) => (
                <div
                  key={j}
                  style={{
                    width: 92,
                    height: 36,
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(255,255,255,0.06)",
                  }}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

<style>{`
  @keyframes pickersBar {
    0% { transform: translateX(-10%); opacity: 0.55; }
    50% { transform: translateX(120%); opacity: 0.95; }
    100% { transform: translateX(240%); opacity: 0.55; }
  }
`}</style>
    </main>
  );
}
