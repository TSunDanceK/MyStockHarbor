"use client";

import { useEffect, useRef, useState } from "react";
import TickerLogo from "@/app/components/TickerLogo";

type SymbolResult = { symbol: string; name: string; exchange?: string };

// Type-ahead ticker search for the /pickers page. It mirrors the
// /custom-screener search's look and dropdown -- debounced /api/symbols
// lookup, a logo + company-name results list, click-outside-to-close -- but
// it does NOT navigate and does NOT change what /pickers does with the pick.
// Choosing a result (or pressing Search / Enter) just hands the resolved,
// upper-cased symbol back to the page via onSubmit; the page then runs the
// exact same in-memory "which picker lists does this ticker qualify for"
// scan it always has (see PickersClient's searchSubmitted / symbolCategoryIndex).
export default function PickerTickerSearch({
  query,
  setQuery,
  onSubmit,
}: {
  query: string;
  setQuery: (value: string) => void;
  onSubmit: (symbol: string, name?: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [results, setResults] = useState<SymbolResult[]>([]);
  const [open, setOpen] = useState(false);

  // Close the dropdown when clicking anywhere outside the search.
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  // Debounced symbol/company lookup -- the same endpoint + response shape the
  // page already uses to resolve company names (GET /api/symbols?q=...).
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/symbols?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        const data = (await res.json()) as { results?: SymbolResult[] };
        setResults(Array.isArray(data.results) ? data.results : []);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  // Resolve to an upper-cased symbol and run the page's existing picker-list
  // scan. Used by the Search button, the Enter key, and each dropdown row --
  // all three behave identically, exactly as the plain box did before.
  function submit(symbol: string, name?: string) {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    // Carry the company name through when we have it (from a picked dropdown
    // row, or by matching the typed symbol against the current results) so the
    // page's "no qualifying list" card can show it -- same as /custom-screener.
    const resolvedName = name ?? results.find((r) => r.symbol.trim().toUpperCase() === sym)?.name;
    setQuery(sym);
    setResults([]);
    setOpen(false);
    onSubmit(sym, resolvedName);
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value.toUpperCase());
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit(query);
          }}
          placeholder="e.g. AAPL — see every list it qualifies for"
          aria-label="Search a ticker or company to see every list it qualifies for"
          style={{
            flex: 1,
            minWidth: 180,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 8,
            padding: "9px 12px",
            color: "#e2e8f0",
            // 16px (not 13px) so mobile Safari doesn't auto-zoom the page in
            // when this input is focused.
            fontSize: 16,
            outline: "none",
            boxSizing: "border-box",
          }}
        />
        <button
          type="button"
          onClick={() => submit(query)}
          style={{
            padding: "9px 16px",
            borderRadius: 8,
            border: "1px solid rgba(34,197,94,0.28)",
            background: "rgba(34,197,94,0.10)",
            color: "#86efac",
            fontWeight: 700,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Search
        </button>
      </div>

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
          {results.slice(0, 8).map((r) => (
            <button
              key={`${r.symbol}-${r.exchange ?? ""}`}
              type="button"
              onClick={() => submit(r.symbol, r.name)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 10,
                textAlign: "left",
                padding: "10px 13px",
                border: "none",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
                background: "#0b1220",
                color: "#f8fafc",
                cursor: "pointer",
              }}
            >
              <TickerLogo symbol={r.symbol} size={22} radius={6} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 13 }}>{r.symbol}</div>
                <div
                  style={{
                    fontSize: 12,
                    color: "rgba(226,232,240,0.66)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.name}
                  {r.exchange ? ` · ${r.exchange}` : ""}
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
