"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { trackTickerInterest } from "@/lib/trackTickerInterest";
import {
  TickerJumpDropdown,
  useDismissOnOutside,
  type SymbolResult,
} from "@/app/components/TickerJumpDropdown";

type StockTickerJumpProps = {
  currentSymbol: string;
};

export default function StockTickerJump({ currentSymbol }: StockTickerJumpProps) {
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
    setSelected({ symbol: currentSymbol, name: "", exchange: "" });
  }, [currentSymbol]);

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

    // Nothing to fetch for a closed dropdown showing the symbol we are
    // already on. `query` is seeded to currentSymbol, so without this guard
    // every page load fired a search for results that were never rendered --
    // and this component mounts TWICE per stock page (a desktop
    // "sidebar-change-stock" instance and a mobile "mobile-change-stock"
    // one, with CSS hiding whichever does not apply), so it was two wasted
    // requests each time, racing the third from StockSymbolPageClient.
    //
    // Gating on `open` is safe because results are only ever rendered while
    // the dropdown is open, and both onFocus and onChange set open = true --
    // so the fetch still happens the instant the field is touched, one
    // debounce interval before any result could be displayed.
    if (!open && exactStillSelected) {
      return;
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
    // `results` is intentionally NOT a dependency even though it's read
    // above: this effect calls setResults, so including it re-triggered the
    // effect on every fetch and left the picker fetching /api/symbols in a
    // loop for as long as the query stayed put.
    //
    // `open` IS a dependency: it gates the fetch above, so opening the
    // dropdown has to be able to trigger the search that mounting no longer
    // does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, selected?.symbol, open]);

  // Tap-outside / Escape. Deliberately leaves `query` and `selected`
  // untouched: dismissing means "I didn't pick anything", not "undo what I
  // typed".
  const dismiss = useCallback(() => setOpen(false), []);
  useDismissOnOutside(wrapRef, open, dismiss);

  function chooseResult(result: SymbolResult) {
    const clean = result.symbol.trim().toUpperCase();
    trackTickerInterest(clean); // deliberate selection -> popular-searches signal
    setSelected({ ...result, symbol: clean });
    setQuery(clean);
    setOpen(false);
    router.push(`/stock/${encodeURIComponent(clean)}`);
  }

  return (
    <div ref={wrapRef}>
      <div style={{ position: "relative", width: "100%" }}>
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
          <div style={{ marginTop: 7, fontSize: 12, color: "rgba(248,113,113,0.92)", fontWeight: 800 }}>
            Select a valid ticker from the dropdown.
          </div>
        ) : null}
      </div>
    </div>
  );
}
