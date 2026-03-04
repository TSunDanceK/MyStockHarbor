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
   <h1 style={{ fontSize: 32, margin: 0 }}>Find Your Next Stock</h1>
<p style={{ opacity: 0.75, marginTop: 8 }}>Building your stock lists…</p>

<div
  style={{
    marginTop: 18,
    width: 420,
    height: 8,
    borderRadius: 999,
    overflow: "hidden",
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.14)",
  }}
>
  <div
    style={{
      height: "100%",
      width: "40%",
      borderRadius: 999,
      background: "rgba(59,130,246,0.85)",
      animation: "pickersBar 1.1s infinite linear",
    }}
  />
</div>

      {/* progress bar */}
      <div
        style={{
          marginTop: 18,
          width: 420,
          height: 8,
          borderRadius: 999,
          overflow: "hidden",
          background: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.14)",
        }}
      >
        <div
          style={{
            height: "100%",
            width: "40%",
            borderRadius: 999,
            background: "rgba(59,130,246,0.85)",
            animation: "pickersBar 1.1s infinite linear",
          }}
        />
      </div>

      {/* skeleton cards */}
      <div style={{ marginTop: 26, display: "grid", gap: 16, maxWidth: 900 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            style={{
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 14,
              padding: 16,
              background: "#0b1220",
            }}
          >
            <div
              style={{
                width: 240,
                height: 16,
                borderRadius: 8,
                background: "rgba(255,255,255,0.08)",
              }}
            />

            <div
              style={{
                marginTop: 12,
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              {Array.from({ length: 8 }).map((__, j) => (
                <div
                  key={j}
                  style={{
                    width: 90,
                    height: 36,
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.10)",
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes pickersBar {
          0% { transform: translateX(-20%); opacity: 0.55; }
          50% { transform: translateX(120%); opacity: 0.95; }
          100% { transform: translateX(240%); opacity: 0.55; }
        }
      `}</style>
    </main>
  );
}
