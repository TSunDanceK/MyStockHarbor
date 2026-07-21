"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import TickerLogo from "@/app/components/TickerLogo";

type SymbolResult = {
  symbol: string;
  name: string;
  exchange: string;
};

type StockTickerJumpProps = {
  currentSymbol: string;
};

export default function StockTickerJump({ currentSymbol }: StockTickerJumpProps) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [query, setQuery] = useState(currentSymbol);
  const [results, setResults] = useState<SymbolResult[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<SymbolResult | null>({
    symbol: currentSymbol,
    name: "",
    exchange: "",
  });
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    setQuery(currentSymbol);
    setSelected({ symbol: currentSymbol, name: "", exchange: "" });
  }, [currentSymbol]);

  // Update dropdown position whenever it opens or on scroll/resize
  useEffect(() => {
    if (!open || !inputRef.current) return;

    function updateRect() {
      if (!inputRef.current) return;
      const r = inputRef.current.getBoundingClientRect();
      setDropdownRect({ top: r.bottom + 8, left: r.left, width: r.width });
    }

    updateRect();
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [open]);

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

    const exactStillSelected = selected?.symbol.toUpperCase() === q.toUpperCase();

    if (!exactStillSelected) {
      const exactResult = results.find(
        (result) => result.symbol.toUpperCase() === q.toUpperCase()
      );
      if (exactResult) {
        setSelected({ ...exactResult, symbol: exactResult.symbol.trim().toUpperCase() });
      } else if (/^[A-Z.]{1,6}$/.test(q.toUpperCase())) {
        setSelected({ symbol: q.toUpperCase(), name: "", exchange: "" });
      } else {
        setSelected(null);
      }
    }

    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/symbols?q=${encodeURIComponent(q)}`);
        if (!res.ok) { setResults([]); return; }
        const data = (await res.json()) as { results?: SymbolResult[] };
        // /api/symbols already returns results in relevance order (exact
        // symbol > symbol prefix > name prefix > name word prefix). Do NOT
        // re-sort here: an earlier client-side alphabetical sort is what
        // buried MSFT below MBOT/MCHP for the query "micro".
        setResults(Array.isArray(data.results) ? data.results : []);
      } catch {
        setResults([]);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [query, selected?.symbol]);

  function chooseResult(result: SymbolResult) {
    const clean = result.symbol.trim().toUpperCase();
    setSelected({ ...result, symbol: clean });
    setQuery(clean);
    setOpen(false);
    router.push(`/stock/${encodeURIComponent(clean)}`);
  }

  return (
    <div ref={wrapRef}>
      <div style={{ position: "relative", width: "100%" }}>
        <input
          ref={inputRef}
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
            boxSizing: "border-box",
          }}
        />

        {open && results.length > 0 && dropdownRect ? (
          <div
            style={{
              position: "fixed",
              top: dropdownRect.top,
              left: dropdownRect.left,
              width: dropdownRect.width,
              zIndex: 9999,
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "#0b1220",
              boxShadow: "0 18px 34px rgba(0,0,0,0.72)",
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
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <TickerLogo symbol={result.symbol} size={22} radius={6} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 950 }}>{result.symbol}</div>
                  <div style={{ marginTop: 3, fontSize: 13, color: "rgba(241,245,249,0.66)" }}>
                    {result.name}
                    {result.exchange ? ` • ${result.exchange}` : ""}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : null}

        {!selected?.symbol && query.trim() ? (
          <div style={{ marginTop: 7, fontSize: 12, color: "rgba(248,113,113,0.92)", fontWeight: 800 }}>
            Select a valid ticker from the dropdown.
          </div>
        ) : null}
      </div>
    </div>
  );
}
