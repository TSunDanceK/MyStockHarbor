"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type SymbolResult = {
  symbol: string;
  name: string;
  exchange: string;
};

type StockNewsTickerJumpProps = {
  currentSymbol: string;
};

export default function StockNewsTickerJump({
  currentSymbol,
}: StockNewsTickerJumpProps) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const [query, setQuery] = useState(currentSymbol);
  const [results, setResults] = useState<SymbolResult[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<SymbolResult | null>({
    symbol: currentSymbol,
    name: "",
    exchange: "",
  });

  useEffect(() => {
    setQuery(currentSymbol);
    setSelected({
      symbol: currentSymbol,
      name: "",
      exchange: "",
    });
  }, [currentSymbol]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    const q = query.trim();

    if (!q) {
      setResults([]);
      setSelected(null);
      return;
    }

    const exactStillSelected =
      selected?.symbol.toUpperCase() === q.toUpperCase();

    if (!exactStillSelected) {
      setSelected(null);
    }

    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/symbols?q=${encodeURIComponent(q)}`);
        if (!res.ok) {
          setResults([]);
          return;
        }

        const data = (await res.json()) as { results?: SymbolResult[] };
        setResults(Array.isArray(data.results) ? data.results : []);
      } catch {
        setResults([]);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [query, selected?.symbol]);

  const canGo = Boolean(selected?.symbol);

  function chooseResult(result: SymbolResult) {
    const clean = result.symbol.trim().toUpperCase();

    setSelected({
      ...result,
      symbol: clean,
    });
    setQuery(clean);
    setOpen(false);
  }

  function goToNews() {
    if (!selected?.symbol) return;
    router.push(`/stock/${encodeURIComponent(selected.symbol)}/news`);
  }

  function goToStockPage() {
    if (!selected?.symbol) return;
    router.push(`/stock/${encodeURIComponent(selected.symbol)}`);
  }

  return (
    <div
      ref={wrapRef}
      style={{
        marginTop: 18,
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        alignItems: "flex-start",
      }}
    >
      <div style={{ position: "relative", width: 280, maxWidth: "100%" }}>
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value.toUpperCase());
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          aria-label="Search stock ticker"
          placeholder="Search ticker or company"
          style={{
            minHeight: 44,
            width: "100%",
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

        {open && results.length > 0 ? (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              left: 0,
              right: 0,
              zIndex: 50,
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "#0b1220",
              boxShadow: "0 18px 34px rgba(0,0,0,0.42)",
              overflow: "hidden",
            }}
          >
            {results.slice(0, 8).map((result) => (
              <button
                key={`${result.symbol}-${result.exchange}`}
                type="button"
                onClick={() => chooseResult(result)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "12px 14px",
                  border: "none",
                  borderBottom: "1px solid rgba(255,255,255,0.08)",
                  background: "#0b1220",
                  color: "#f8fafc",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 950 }}>{result.symbol}</div>
                <div
                  style={{
                    marginTop: 3,
                    fontSize: 13,
                    color: "rgba(241,245,249,0.66)",
                  }}
                >
                  {result.name}
                  {result.exchange ? ` • ${result.exchange}` : ""}
                </div>
              </button>
            ))}
          </div>
        ) : null}

        {!canGo && query.trim() ? (
          <div
            style={{
              marginTop: 7,
              fontSize: 12,
              color: "rgba(248,113,113,0.92)",
              fontWeight: 800,
            }}
          >
            Select a valid ticker from the dropdown.
          </div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={goToNews}
        disabled={!canGo}
        style={{
          minHeight: 44,
          padding: "0 15px",
          borderRadius: 14,
          border: "1px solid rgba(248,113,113,0.30)",
          background:
            "linear-gradient(135deg, rgba(248,113,113,0.16), rgba(185,28,28,0.08))",
          color: "#fee2e2",
          fontWeight: 900,
          cursor: canGo ? "pointer" : "not-allowed",
          opacity: canGo ? 1 : 0.45,
        }}
      >
        Latest News →
      </button>

      <button
        type="button"
        onClick={goToStockPage}
        disabled={!canGo}
        style={{
          minHeight: 44,
          padding: "0 15px",
          borderRadius: 14,
          border: "1px solid rgba(59,130,246,0.30)",
          background:
            "linear-gradient(135deg, rgba(59,130,246,0.16), rgba(37,99,235,0.08))",
          color: "#dbeafe",
          fontWeight: 900,
          cursor: canGo ? "pointer" : "not-allowed",
          opacity: canGo ? 1 : 0.45,
        }}
      >
        Stock Page →
      </button>
    </div>
  );
}
