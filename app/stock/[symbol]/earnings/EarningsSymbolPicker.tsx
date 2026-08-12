"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { trackTickerInterest } from "@/lib/trackTickerInterest";
import {
  TickerJumpDropdown,
  useTickerJumpAnchor,
  type SymbolResult,
} from "@/app/components/TickerJumpDropdown";

type EarningsSymbolPickerProps = {
  currentSymbol: string;
};

export default function EarningsSymbolPicker({
  currentSymbol,
}: EarningsSymbolPickerProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [query, setQuery] = useState(currentSymbol);
  const [results, setResults] = useState<SymbolResult[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<SymbolResult | null>({
    symbol: currentSymbol,
    name: "",
    exchange: "",
  });

  // Shared positioning + page scroll lock -- see TickerJumpDropdown.tsx.
  const anchorRect = useTickerJumpAnchor(open, inputRef);

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
      const exactResult = results.find(
        (result) => result.symbol.toUpperCase() === q.toUpperCase()
      );

      if (exactResult) {
        setSelected({
          ...exactResult,
          symbol: exactResult.symbol.trim().toUpperCase(),
        });
      } else if (/^[A-Z.]{1,6}$/.test(q.toUpperCase())) {
        setSelected({
          symbol: q.toUpperCase(),
          name: "",
          exchange: "",
        });
      } else {
        setSelected(null);
      }
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
    // `results` is intentionally NOT a dependency even though it's read above:
    // this effect calls setResults, so including it re-triggered the effect on
    // every fetch and left the picker fetching /api/symbols in a loop for as
    // long as the query stayed put. Reading a slightly stale `results` to
    // resolve an exact-symbol match is fine, and matches StockTickerJump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, selected?.symbol]);

  const canGo = Boolean(selected?.symbol);

  // Tap-outside / Escape. Leaves `query` and `selected` alone, which is
  // what makes the "Open earnings ->" button below still usable: dismiss
  // the dropdown with one tap, then press the button.
  const dismiss = useCallback(() => {
    setOpen(false);
    inputRef.current?.blur();
  }, []);

  function chooseResult(result: SymbolResult) {
    const clean = result.symbol.trim().toUpperCase();
    trackTickerInterest(clean); // deliberate selection -> popular-searches signal

    setSelected({
      ...result,
      symbol: clean,
    });
    setQuery(clean);
    setOpen(false);

    router.push(`/stock/${encodeURIComponent(clean)}/earnings`);
  }

  function goToEarningsPage() {
    if (!selected?.symbol) return;

    const clean = selected.symbol.trim().toUpperCase();
    trackTickerInterest(clean); // deliberate "open earnings" -> popular-searches signal

    if (clean === currentSymbol.toUpperCase()) {
      router.refresh();
      return;
    }

    router.push(`/stock/${encodeURIComponent(clean)}/earnings`);
  }

  return (
    <div className="earningsSymbolPicker" style={{ marginTop: 20, maxWidth: 660 }}>
      <style>{`
        @media (max-width: 720px) {
          .earningsSymbolPicker {
            width: 100%;
            max-width: none !important;
          }

          .earningsSymbolPickerRow {
            display: grid !important;
            grid-template-columns: 1fr;
            gap: 9px !important;
            width: 100%;
          }

          .earningsSymbolPickerInputWrap {
            width: 100% !important;
            max-width: none !important;
          }

          .earningsSymbolPickerInput {
            min-height: 48px !important;
            font-size: 16px !important;
          }

          .earningsSymbolPickerButton {
            width: 100%;
            min-height: 48px !important;
          }
        }
      `}</style>
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
          marginBottom: 10,
        }}
      >
        Search another ticker to view its earnings page.
      </div>

      <div
        className="earningsSymbolPickerRow"
        style={{
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <div className="earningsSymbolPickerInputWrap" style={{ position: "relative", width: 430, maxWidth: "100%" }}>
          <input
            ref={inputRef}
            className="earningsSymbolPickerInput"
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
              position: "relative",
              zIndex: 10000,
            }}
          />

          <TickerJumpDropdown
            open={open}
            rect={anchorRect}
            results={results}
            onChoose={chooseResult}
            onDismiss={dismiss}
          />

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
          className="earningsSymbolPickerButton"
          type="button"
          onClick={goToEarningsPage}
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
          {selected?.symbol?.toUpperCase() === currentSymbol.toUpperCase()
            ? "Refresh report →"
            : "Open earnings →"}
        </button>
      </div>
    </div>
  );
}
