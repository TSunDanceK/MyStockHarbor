"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  TickerJumpDropdown,
  useDismissOnOutside,
  type SymbolResult,
} from "@/app/components/TickerJumpDropdown";

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

  // Tap-outside / Escape: closes without navigating and without discarding
  // whatever was typed.
  const dismiss = useCallback(() => setOpen(false), []);
  useDismissOnOutside(wrapRef, open, dismiss);

  function chooseResult(result: SymbolResult) {
    const clean = result.symbol.trim().toUpperCase();

    setSelected({
      ...result,
      symbol: clean,
    });
    setQuery(clean);
    setOpen(false);

    router.push(`/stock/${encodeURIComponent(clean)}/news`);
  }

  return (
    <div
      ref={wrapRef}
      style={{
        marginTop: 18,
        display: "grid",
        gap: 10,
        maxWidth: 520,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 950,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "rgba(191,219,254,0.86)",
            marginBottom: 4,
          }}
        >
          Change stock
        </div>

        <div
          style={{
            fontSize: 13,
            lineHeight: 1.5,
            color: "rgba(241,245,249,0.66)",
          }}
        >
          Search another ticker to view its latest news page.
        </div>
      </div>

      <div style={{ position: "relative", width: "100%", maxWidth: 320 }}>
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
            boxSizing: "border-box",
          }}
        />

        <TickerJumpDropdown open={open} results={results} onChoose={chooseResult} />

        {!selected?.symbol && query.trim() ? (
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
    </div>
  );
}
