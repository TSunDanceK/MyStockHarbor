"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import TickerLogo from "@/app/components/TickerLogo";

type SymbolResult = { symbol: string; name: string; exchange: string };

// One analyzed symbol from the custom-screener's own universe (every symbol
// PickerResultPage already computed for config.kind === "allSymbols"), carrying
// the exact same conditions the left-hand checkboxes filter by.
export type ScreenerUniverseEntry = {
  symbol: string;
  companyName?: string | null;
  reasons?: string[];
  score?: number;
};

type Selected = {
  symbol: string;
  name: string;
  inUniverse: boolean;
  reasons: string[];
};

// Search box for /custom-screener. Unlike the site's other ticker searches
// (which jump to a stock page), selecting a result here answers the screener's
// actual question -- "does this ticker currently meet any of the tracked
// conditions, and which ones?" -- inline, by looking the picked symbol up in
// the page's already-computed analyzed universe. No navigation, no extra API
// cost for the lookup (the /api/symbols call is only to resolve what you type,
// e.g. "Tesla" -> TSLA).
export default function CustomScreenerSymbolSearch({
  universe = [],
}: {
  universe?: ScreenerUniverseEntry[];
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SymbolResult[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Selected | null>(null);

  const universeMap = useMemo(() => {
    const m = new Map<string, ScreenerUniverseEntry>();
    for (const e of universe) m.set(e.symbol.toUpperCase(), e);
    return m;
  }, [universe]);

  // Close the dropdown when clicking anywhere outside the search.
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
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
        setResults(Array.isArray(data.results) ? data.results : []);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  function choose(r: SymbolResult) {
    const sym = r.symbol.toUpperCase();
    const entry = universeMap.get(sym);
    setSelected({
      symbol: sym,
      name: r.name,
      inUniverse: !!entry,
      reasons: entry?.reasons ?? [],
    });
    setQuery(sym);
    setResults([]);
    setOpen(false);
  }

  const inputStyle: React.CSSProperties = {
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
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", maxWidth: 520 }}>
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value.toUpperCase());
          setOpen(true);
          setSelected(null);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Check a ticker or company against the screener (e.g. TSLA)"
        aria-label="Search a ticker or company to see which screener conditions it meets"
        style={inputStyle}
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
          {results.slice(0, 8).map((r) => {
            const analyzed = universeMap.has(r.symbol.toUpperCase());
            return (
              <button
                key={`${r.symbol}-${r.exchange}`}
                type="button"
                onClick={() => choose(r)}
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
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: analyzed ? "#4ade80" : "rgba(148,163,184,0.6)",
                  }}
                >
                  {analyzed ? "Analyzed" : "Not analyzed"}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {selected ? (
        <div
          style={{
            marginTop: 10,
            padding: 14,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.03)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <TickerLogo symbol={selected.symbol} size={26} radius={7} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{selected.symbol}</div>
              <div
                style={{
                  fontSize: 12.5,
                  color: "rgba(226,232,240,0.66)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {selected.name}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 12, fontSize: 13.5, lineHeight: 1.6 }}>
            {!selected.inUniverse ? (
              <span style={{ color: "rgba(226,232,240,0.8)" }}>
                <strong>{selected.symbol}</strong> isn&rsquo;t in the current analyzed universe (the
                screener tracks roughly the ~200 most-active symbols), so it has no screener
                results right now.
              </span>
            ) : selected.reasons.length === 0 ? (
              <span style={{ color: "rgba(226,232,240,0.8)" }}>
                <strong>{selected.symbol}</strong> is analyzed but currently meets{" "}
                <strong>none</strong> of the tracked screener conditions.
              </span>
            ) : (
              <>
                <div style={{ color: "rgba(226,232,240,0.85)" }}>
                  <strong>{selected.symbol}</strong> currently meets{" "}
                  <strong>{selected.reasons.length}</strong>{" "}
                  screener condition{selected.reasons.length === 1 ? "" : "s"}:
                </div>
                <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {selected.reasons.map((reason) => (
                    <span
                      key={reason}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "4px 9px",
                        borderRadius: 999,
                        border: "1px solid rgba(34,197,94,0.32)",
                        background: "rgba(34,197,94,0.10)",
                        color: "#dcfce7",
                        fontSize: 11,
                        fontWeight: 800,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {reason}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          <div style={{ marginTop: 12 }}>
            <Link
              href={`/stock/${encodeURIComponent(selected.symbol)}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "7px 12px",
                borderRadius: 9,
                border: "1px solid rgba(147,197,253,0.28)",
                background: "rgba(147,197,253,0.10)",
                color: "#93c5fd",
                textDecoration: "none",
                fontWeight: 700,
                fontSize: 12.5,
              }}
            >
              View {selected.symbol} full analysis →
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
