"use client";

import { useRouter } from "next/navigation";
import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Props = {
  currentSymbol: string;
};

type SymbolResult = {
  symbol: string;
  name: string;
  exchange: string;
};

function cleanSymbol(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9.-]/g, "").trim();
}

function cleanSearch(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9. -]/g, "").trim();
}

function rankResult(item: SymbolResult, query: string) {
  const q = cleanSearch(query);
  const symbol = cleanSymbol(item.symbol);
  const name = String(item.name || "").toUpperCase();

  if (!q) return 999;

  if (symbol === q) return 0;
  if (symbol.startsWith(q)) return 10;
  if (name.startsWith(q)) return 20;
  if (symbol.includes(q)) return 30;
  if (name.includes(q)) return 40;

  return 90;
}

export default function EarningsSymbolPicker({ currentSymbol }: Props) {
  const router = useRouter();
  const cleanCurrentSymbol = useMemo(
    () => cleanSymbol(currentSymbol),
    [currentSymbol]
  );

  const [value, setValue] = useState(cleanCurrentSymbol);
  const [selected, setSelected] = useState<SymbolResult | null>({
    symbol: cleanCurrentSymbol,
    name: cleanCurrentSymbol,
    exchange: "",
  });
  const [results, setResults] = useState<SymbolResult[]>([]);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const requestIdRef = useRef(0);

  const cleanValue = cleanSearch(value);
  const canSubmit = Boolean(selected?.symbol);
  const isCurrentSymbol = selected?.symbol === cleanCurrentSymbol;

  useEffect(() => {
    const query = cleanSearch(value);

    if (!query) {
      setResults([]);
      setOpen(false);
      setSearching(false);
      setSearchError(null);
      return;
    }

    if (selected?.symbol && query === selected.symbol) {
      setResults([]);
      setOpen(false);
      setSearching(false);
      setSearchError(null);
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setSearching(true);
    setSearchError(null);

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/symbols?q=${encodeURIComponent(query)}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Search failed");
        }

        const data = (await response.json()) as { results?: SymbolResult[] };
        const rows = Array.isArray(data.results) ? data.results : [];

        const safeResults = rows
          .map((item) => ({
            symbol: cleanSymbol(item.symbol || ""),
            name: String(item.name || "").trim(),
            exchange: String(item.exchange || "").trim(),
          }))
          .filter((item) => item.symbol && item.name)
          .sort((a, b) => {
            const rankDelta = rankResult(a, query) - rankResult(b, query);
            if (rankDelta !== 0) return rankDelta;

            const symbolLengthDelta = a.symbol.length - b.symbol.length;
            if (symbolLengthDelta !== 0) return symbolLengthDelta;

            return a.symbol.localeCompare(b.symbol);
          })
          .slice(0, 8);

        if (requestIdRef.current !== requestId) return;

        setResults(safeResults);
        setHighlightedIndex(0);
        setOpen(Boolean(safeResults.length));
      } catch {
        if (requestIdRef.current !== requestId) return;

        setResults([]);
        setOpen(false);
        setSearchError("Stock search is unavailable right now.");
      } finally {
        if (requestIdRef.current === requestId) {
          setSearching(false);
        }
      }
    }, 220);

    return () => window.clearTimeout(timer);
  }, [value, selected?.symbol]);

  function selectResult(result: SymbolResult) {
    const symbol = cleanSymbol(result.symbol);

    setSelected({
      ...result,
      symbol,
    });
    setValue(symbol);
    setOpen(false);
    setResults([]);
    setHighlightedIndex(0);
    setSearchError(null);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selected?.symbol) return;

    if (isCurrentSymbol) {
      router.refresh();
      return;
    }

    router.push(`/stock/${encodeURIComponent(selected.symbol)}/earnings`);
  }

  function onInputChange(nextValue: string) {
    setValue(nextValue);
    setSelected(null);
    setOpen(Boolean(nextValue.trim()));
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      if (open && results[highlightedIndex]) {
        event.preventDefault();
        selectResult(results[highlightedIndex]);
      } else {
        event.preventDefault();
      }

      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlightedIndex((prev) =>
        results.length ? Math.min(prev + 1, results.length - 1) : 0
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setHighlightedIndex((prev) => Math.max(prev - 1, 0));
      return;
    }

    if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="earningsChangeStock">
      <style>{`
        .earningsPickerWrap {
          position: relative;
          min-width: 0;
        }

        .earningsSearchRow {
          align-items: start;
        }

        .earningsSearchRow button:disabled {
          opacity: 0.45;
          cursor: not-allowed;
          filter: grayscale(0.25);
        }

        .earningsSearchInput {
          width: 100%;
          box-sizing: border-box;
        }

        .earningsSearchMenu {
          position: absolute;
          top: calc(100% + 8px);
          left: 0;
          right: 0;
          z-index: 100;
          border-radius: 16px;
          border: 1px solid rgba(96,165,250,0.26);
          background: #020617;
          box-shadow: 0 24px 60px rgba(0,0,0,0.58);
          overflow: hidden;
        }

        .earningsSearchOption {
          width: 100%;
          display: grid;
          grid-template-columns: 76px minmax(0, 1fr);
          gap: 10px;
          align-items: center;
          padding: 11px 12px;
          border: 0;
          border-top: 1px solid rgba(255,255,255,0.07);
          background: transparent;
          color: #f8fafc;
          text-align: left;
          cursor: pointer;
        }

        .earningsSearchOption:first-child {
          border-top: 0;
        }

        .earningsSearchOption:hover,
        .earningsSearchOption.active {
          background: rgba(59,130,246,0.18);
        }

        .earningsSearchSymbol {
          font-weight: 950;
          letter-spacing: 0.03em;
          color: #dbeafe;
        }

        .earningsSearchName {
          display: block;
          min-width: 0;
          font-size: 13px;
          font-weight: 750;
          color: rgba(226,232,240,0.88);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .earningsSearchExchange {
          display: block;
          margin-top: 3px;
          font-size: 11px;
          color: rgba(148,163,184,0.78);
          font-weight: 800;
        }

        .earningsSearchHint {
          margin-top: 8px;
          min-height: 18px;
          font-size: 12px;
          color: rgba(203,213,225,0.66);
          line-height: 1.45;
        }

        .earningsSearchHint.warning {
          color: #fbbf24;
        }

        .earningsSearchHint.error {
          color: #fecaca;
        }

        @media (max-width: 640px) {
          .earningsSearchOption {
            grid-template-columns: 64px minmax(0, 1fr);
          }
        }
      `}</style>

      <div>
        <div className="smallLabel">Change stock</div>
        <p>Search by company name or ticker, then select a result.</p>
      </div>

      <div className="earningsSearchRow">
        <div className="earningsPickerWrap">
          <input
            className="earningsSearchInput"
            value={value}
            onChange={(event) => onInputChange(event.target.value)}
            onFocus={() => {
              if (results.length) setOpen(true);
            }}
            onBlur={() => {
              window.setTimeout(() => setOpen(false), 140);
            }}
            onKeyDown={onInputKeyDown}
            aria-label="Search stocks by company name or ticker"
            placeholder="Search ticker or company name"
            autoCapitalize="characters"
            spellCheck={false}
            autoComplete="off"
          />

          {open && results.length ? (
            <div className="earningsSearchMenu" role="listbox">
              {results.map((result, index) => (
                <button
                  key={`${result.symbol}-${result.name}`}
                  type="button"
                  className={`earningsSearchOption${
                    index === highlightedIndex ? " active" : ""
                  }`}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectResult(result);
                  }}
                  role="option"
                  aria-selected={index === highlightedIndex}
                >
                  <span className="earningsSearchSymbol">{result.symbol}</span>
                  <span style={{ minWidth: 0 }}>
                    <span className="earningsSearchName">{result.name}</span>
                    {result.exchange ? (
                      <span className="earningsSearchExchange">
                        {result.exchange}
                      </span>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          <div
            className={`earningsSearchHint${
              searchError ? " error" : cleanValue && !selected ? " warning" : ""
            }`}
          >
            {searchError
              ? searchError
              : searching
                ? "Searching stocks…"
                : selected
                  ? `Selected ${selected.symbol}${
                      selected.name ? ` — ${selected.name}` : ""
                    }`
                  : cleanValue
                    ? "Choose a stock from the list before opening the report."
                    : "Type a ticker or company name to search."}
          </div>
        </div>

        <button type="submit" disabled={!canSubmit}>
          {isCurrentSymbol ? "Refresh report →" : "Open earnings →"}
        </button>
      </div>
    </form>
  );
}
