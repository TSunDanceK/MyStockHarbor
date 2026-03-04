"use client";

export default function PickersError({ reset }: { reset: () => void }) {
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
        <h1 style={{ margin: 0, fontSize: 32 }}>Trading Styles</h1>
        <p style={{ marginTop: 10, opacity: 0.75 }}>
          Something went wrong while building the lists. Try again.
        </p>

        <button
          onClick={() => reset()}
          style={{
            marginTop: 16,
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.18)",
            background: "rgba(59,130,246,0.18)",
            color: "#f1f5f9",
            fontWeight: 900,
            cursor: "pointer",
          }}
        >
          Retry
        </button>

        <a
          href="/"
          style={{
            display: "inline-block",
            marginLeft: 12,
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.18)",
            background: "rgba(255,255,255,0.06)",
            color: "#f1f5f9",
            textDecoration: "none",
            fontWeight: 900,
          }}
        >
          Back to Dashboard
        </a>
      </div>
    </main>
  );
}
