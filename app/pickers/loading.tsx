// app/pickers/loading.tsx

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
<div style={{ marginTop: 20, textAlign: "center" }}>
  <div
    style={{
      fontSize: 40,
      fontWeight: 950,
      letterSpacing: "-0.5px",
      lineHeight: 1.1,
    }}
  >
    We are gathering stocks for you
  </div>

  <div
    style={{
      marginTop: 12,
      fontSize: 22,
      opacity: 0.85,
      fontWeight: 700,
    }}
  >
    Please wait...
  </div>
</div>
      </p>

      {/* Loading bar */}
      <div
        style={{
          marginTop: 18,
          width: 420,
          maxWidth: "100%",
          height: 10,
          borderRadius: 999,
          overflow: "hidden",
          background: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.16)",
        }}
      >
        <div
          style={{
            height: "100%",
            width: "35%",
            borderRadius: 999,
            background: "rgba(59,130,246,0.95)",
            animation: "pickersBar 1.1s linear infinite",
          }}
        />
      </div>

      {/* Skeleton blocks */}
      <div style={{ marginTop: 22, display: "grid", gap: 14, maxWidth: 980 }}>
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
              <div style={{ display: "grid", gap: 8 }}>
                <div
                  style={{
                    width: 260,
                    height: 18,
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.08)",
                  }}
                />
                <div
                  style={{
                    width: 420,
                    height: 12,
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.06)",
                  }}
                />
              </div>

              <div
                style={{
                  width: 90,
                  height: 12,
                  borderRadius: 8,
                  background: "rgba(255,255,255,0.06)",
                }}
              />
            </div>

            <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
              {Array.from({ length: 10 }).map((__, j) => (
                <div
                  key={j}
                  style={{
                    height: 38,
                    width: 96,
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(255,255,255,0.05)",
                  }}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Keyframes MUST be inside returned JSX */}
      <style>{`
        @keyframes pickersBar {
          0% { transform: translateX(-60%); opacity: 0.55; }
          50% { transform: translateX(140%); opacity: 0.95; }
          100% { transform: translateX(320%); opacity: 0.55; }
        }
      `}</style>
    </main>
  );
}
