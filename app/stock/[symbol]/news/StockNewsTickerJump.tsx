"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type StockNewsTickerJumpProps = {
  currentSymbol: string;
};

export default function StockNewsTickerJump({
  currentSymbol,
}: StockNewsTickerJumpProps) {
  const router = useRouter();
  const [symbol, setSymbol] = useState(currentSymbol);

  function cleanSymbol(value: string) {
    return value.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  }

  function goToNews() {
    const nextSymbol = cleanSymbol(symbol);
    if (!nextSymbol) return;

    router.push(`/stock/${encodeURIComponent(nextSymbol)}/news`);
  }

  function goToStockPage() {
    const nextSymbol = cleanSymbol(symbol);
    if (!nextSymbol) return;

    router.push(`/stock/${encodeURIComponent(nextSymbol)}`);
  }

  return (
    <div
      style={{
        marginTop: 18,
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        alignItems: "center",
      }}
    >
      <input
        value={symbol}
        onChange={(event) => setSymbol(event.target.value.toUpperCase())}
        onKeyDown={(event) => {
          if (event.key === "Enter") goToNews();
        }}
        aria-label="Change stock ticker"
        placeholder="Enter ticker"
        style={{
          minHeight: 44,
          width: 150,
          borderRadius: 14,
          border: "1px solid rgba(59,130,246,0.32)",
          background: "rgba(15,23,42,0.72)",
          color: "#f8fafc",
          padding: "0 14px",
          fontSize: 15,
          fontWeight: 900,
          outline: "none",
          textTransform: "uppercase",
        }}
      />

      <button
        type="button"
        onClick={goToNews}
        style={{
          minHeight: 44,
          padding: "0 15px",
          borderRadius: 14,
          border: "1px solid rgba(248,113,113,0.30)",
          background:
            "linear-gradient(135deg, rgba(248,113,113,0.16), rgba(185,28,28,0.08))",
          color: "#fee2e2",
          fontWeight: 900,
          cursor: "pointer",
        }}
      >
        Latest News →
      </button>

      <button
        type="button"
        onClick={goToStockPage}
        style={{
          minHeight: 44,
          padding: "0 15px",
          borderRadius: 14,
          border: "1px solid rgba(59,130,246,0.30)",
          background:
            "linear-gradient(135deg, rgba(59,130,246,0.16), rgba(37,99,235,0.08))",
          color: "#dbeafe",
          fontWeight: 900,
          cursor: "pointer",
        }}
      >
        Stock Page →
      </button>
    </div>
  );
}
