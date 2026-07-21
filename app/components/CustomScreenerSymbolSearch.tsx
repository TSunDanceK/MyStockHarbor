"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import TickerLogo from "@/app/components/TickerLogo";

type SymbolResult = { symbol: string; name: string; exchange: string };

// Clean symbol autocomplete for the /custom-screener page. Searches the
// full symbol universe by TICKER OR COMPANY NAME via /api/symbols and, on
// selection, sends the visitor to that stock's page -- the "output" is the
// raw ticker / its stock page. Modeled on
// app/earnings-calendar/EarningsTickerSearch.tsx (fetch/debounce/markup +
// click-outside-to-close).
export default function CustomScreenerSymbolSearch() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SymbolResult[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/symbols?q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as { results?: SymbolResult[] };
        // /api/symbols already returns relevance-ranked results -- no
        // client-side re-sort (see app/api/symbols/route.ts history).
        setResults(Array.isArray(data.results) ? data.results : []);
      } catch {
        setResults([]);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [query]);

  return (
    <div ref={wrapRef} style={{ position: "relative", maxWidth: 440 }}>
      <input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value.toUpperCase());
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search any ticker or company name…"
        aria-label="Search any ticker or company name"
        style={{
          width: "100%",
          padding: "12px 14px",
          borderRadius: 12,
          border: "1px solid rgba(59,130,246,0.32)",
          background: "rgba(15,23,42,0.72)",
          color: "#f8fafc",
          fontSize: 14,
          fontWeight: 700,
          outline: "none",
          boxSizing: "border-box",
        }}
      />

      {open && results.length > 0 ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            right: 0,
            zIndex: 30,
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 13,
            background: "#0b1220",
            boxShadow: "0 14px 28px rgba(0,0,0,0.4)",
            overflow: "hidden",
          }}
        >
          {results.slice(0, 8).map((result) => (
            <Link
              key={`${result.symbol}-${result.exchange}`}
              href={`/stock/${encodeURIComponent(result.symbol)}`}
              onClick={() => setOpen(false)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                textAlign: "left",
                padding: "10px 13px",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
                background: "#0b1220",
                color: "#f8fafc",
                textDecoration: "none",
                cursor: "pointer",
              }}
            >
              <TickerLogo symbol={result.symbol} size={22} radius={6} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 13 }}>{result.symbol}</div>
                <div style={{ fontSize: 12, color: "rgba(226,232,240,0.66)" }}>
                  {result.name}
                  {result.exchange ? ` · ${result.exchange}` : ""}
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
