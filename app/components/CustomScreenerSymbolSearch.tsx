"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import TickerLogo from "@/app/components/TickerLogo";
import { trackTickerInterest } from "@/lib/trackTickerInterest";

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
    trackTickerInterest(sym); // deliberate selection -> popular-searches signal
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

  // Styled to match the /pickers "Search a ticker" box (cyan label, dark
  // rounded input, green Search button), resized to fit the custom-screener
  // hero. Behaviour is unchanged from before -- type-ahead symbol lookup with
  // an inline "which conditions does it meet" result.
  const inputStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 180,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 8,
    padding: "9px 12px",
    color: "#e2e8f0",
    // 16px (not the 13px /pickers uses) so mobile Safari doesn't auto-zoom
    // the page in when this input is focused.
    fontSize: 16,
    outline: "none",
    boxSizing: "border-box",
  };

  // The "Search" button (and Enter) resolves what's typed to the top symbol
  // match and shows its screener result -- the same inline behaviour as
  // picking from the dropdown, just an explicit affordance so it looks and
  // acts like the /pickers search box.
  function submitSearch() {
    if (results.length) choose(results[0]);
  }

  return (
    <div ref={wrapRef} style={{ position: "relative", maxWidth: 520 }}>
      <section
        style={{
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12,
          padding: "12px 16px",
          background: "rgba(255,255,255,0.02)",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#67e8f9",
            marginBottom: 6,
          }}
        >
          Search a ticker
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value.toUpperCase());
              setOpen(true);
              setSelected(null);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitSearch();
            }}
            placeholder="e.g. AAPL — see which conditions it meets"
            aria-label="Search a ticker or company to see which screener conditions it meets"
            style={inputStyle}
          />
          <button
            type="button"
            onClick={submitSearch}
            style={{
              flex: "0 0 auto",
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
      </section>

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
            {selected.reasons.length === 0 ? (
              <span style={{ color: "rgba(226,232,240,0.8)" }}>
                <strong>{selected.symbol}</strong> does not currently qualify in any screener list.
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
