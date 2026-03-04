export default function LoadingPickers() {
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
      <div style={{ maxWidth: 980 }}>
        <h1 style={{ margin: 0, fontSize: 32, letterSpacing: "-0.3px" }}>Trading Styles</h1>
        <p style={{ marginTop: 10, opacity: 0.75 }}>
          Building today’s stock lists… this can take a few seconds.
        </p>

        {/* Loading bar */}
        <div
          style={{
            marginTop: 18,
            height: 10,
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.14)",
            background: "rgba(255,255,255,0.06)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: "40%",
              borderRadius: 999,
              background: "rgba(59,130,246,0.55)",
              animation: "pickersBar 1.1s ease-in-out infinite",
            }}
          />
        </div>

        {/* Skeleton cards */}
        <div style={{ marginTop: 22, display: "grid", gap: 16 }}>
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
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div style={{ width: "55%" }}>
                  <div
                    style={{
                      height: 18,
                      borderRadius: 8,
                      background: "rgba(255,255,255,0.10)",
                    }}
                  />
                  <div
                    style={{
                      marginTop: 10,
                      height: 12,
                      width: "75%",
                      borderRadius: 8,
                      background: "rgba(255,255,255,0.06)",
                    }}
                  />
                </div>
                <div
                  style={{
                    height: 14,
                    width: 70,
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.06)",
                  }}
                />
              </div>

              <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
                {Array.from({ length: 6 }).map((__, j) => (
                  <div
                    key={j}
                    style={{
                      height: 38,
                      width: 120,
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.14)",
                      background: "rgba(255,255,255,0.06)",
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        <style>{`
          @keyframes pickersBar {
            0%   { transform: translateX(-60%); opacity: 0.65; }
            50%  { transform: translateX(120%); opacity: 1; }
            100% { transform: translateX(-60%); opacity: 0.65; }
          }
        `}</style>
      </div>
    </main>
  );
}
