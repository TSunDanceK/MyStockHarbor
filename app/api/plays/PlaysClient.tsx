function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 14,
        padding: "9px 10px",
        background: "rgba(255,255,255,0.035)",
      }}
    >
      <div
        style={{
          color: "#64748b",
          fontSize: 11,
          fontWeight: 900,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 4,
          color: "#f8fafc",
          fontSize: 14,
          fontWeight: 950,
        }}
      >
        {value}
      </div>
    </div>
  );
}
