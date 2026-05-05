"use client";

export default function PlaysClient() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#020617",
        color: "#e5e7eb",
        padding: "40px 20px",
      }}
    >
      <section
        style={{
          maxWidth: 1100,
          margin: "0 auto",
        }}
      >
        <h1
          style={{
            margin: 0,
            color: "#f8fafc",
            fontSize: 48,
            letterSpacing: "-0.05em",
          }}
        >
          Stock Plays
        </h1>

        <p
          style={{
            marginTop: 14,
            maxWidth: 760,
            color: "#cbd5e1",
            fontSize: 16,
            lineHeight: 1.7,
            fontWeight: 650,
          }}
        >
          Find daily and weekly chart-pattern plays using MyStockHarbor’s
          ascending triangle scanner.
        </p>
      </section>
    </main>
  );
}
