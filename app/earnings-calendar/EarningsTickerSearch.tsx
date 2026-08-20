"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import TickerLogo from "@/app/components/TickerLogo";

type SymbolResult = { symbol: string; name: string; exchange: string };

type NextEarningsInfo = {
  symbol: string;
  nextEarningsDate: string | null;
};

function formatDate(dateStr: string) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function EarningsTickerSearch() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SymbolResult[]>([]);
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<NextEarningsInfo | null>(null);
  const [loading, setLoading] = useState(false);

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

  async function chooseResult(result: SymbolResult) {
    setQuery(result.symbol);
    setOpen(false);
    setInfo(null);
    setLoading(true);

    try {
      const res = await fetch(`/api/stock-earnings/${encodeURIComponent(result.symbol)}`);
      const data = (await res.json()) as { nextEarningsDate?: string | null };
      setInfo({ symbol: result.symbol, nextEarningsDate: data.nextEarningsDate ?? null });
    } catch {
      setInfo({ symbol: result.symbol, nextEarningsDate: null });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div ref={wrapRef} style={{ position: "relative", maxWidth: 440 }}>
      {/* Icon + input share their own relative box. The results dropdown below
          is positioned off the OUTER wrapper, not this one -- that wrapper's
          height is still just the input's when the dropdown is open (the info
          panel only renders once a result is chosen, which closes it), so
          top: calc(100% + 8px) is unaffected by this extra element. */}
      <div style={{ position: "relative" }}>
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 24 24"
          width={17}
          height={17}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            position: "absolute",
            left: 13,
            top: "50%",
            transform: "translateY(-50%)",
            // Kept brighter than a plain slate grey: the blue-tinted border and
            // navy fill make a mid grey read as washed-out blue in situ.
            color: "rgba(203,213,225,0.78)",
            // Taps in the icon's corner should focus the field, not dead-end
            // on the SVG.
            pointerEvents: "none",
          }}
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="16.2" y1="16.2" x2="21" y2="21" />
        </svg>
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value.toUpperCase());
            setOpen(true);
            setInfo(null);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search a ticker or company for its next earnings date"
          aria-label="Search ticker for next earnings date"
          style={{
            width: "100%",
            // Left padding clears the 17px icon at left: 13.
            padding: "12px 14px 12px 38px",
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
          {results.slice(0, 8).map((result) => (
            <button
              key={`${result.symbol}-${result.exchange}`}
              type="button"
              onClick={() => chooseResult(result)}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "10px 13px",
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
                <div style={{ fontWeight: 800, fontSize: 13 }}>{result.symbol}</div>
                <div style={{ fontSize: 12, color: "rgba(226,232,240,0.66)" }}>
                  {result.name}
                  {result.exchange ? ` · ${result.exchange}` : ""}
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : null}

      {loading ? (
        <div style={{ marginTop: 10, fontSize: 13, opacity: 0.7 }}>Looking up next earnings date…</div>
      ) : info ? (
        <div
          style={{
            marginTop: 10,
            padding: 12,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.03)",
          }}
        >
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            {info.nextEarningsDate ? (
              <>
                <strong>{info.symbol}</strong> next reports on <strong>{formatDate(info.nextEarningsDate)}</strong>.
              </>
            ) : (
              <>
                No confirmed upcoming earnings date for <strong>{info.symbol}</strong> yet.
              </>
            )}
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link
              href={`/stock/${encodeURIComponent(info.symbol)}/earnings`}
              style={{
                padding: "8px 12px",
                borderRadius: 9,
                border: "1px solid rgba(147,197,253,0.28)",
                background: "rgba(147,197,253,0.10)",
                color: "#93c5fd",
                textDecoration: "none",
                fontWeight: 700,
                fontSize: 12.5,
              }}
            >
              View Earnings Page →
            </Link>
            <Link
              href={`/dashboard?symbol=${encodeURIComponent(info.symbol)}`}
              style={{
                padding: "8px 12px",
                borderRadius: 9,
                border: "1px solid rgba(255,255,255,0.14)",
                background: "rgba(255,255,255,0.04)",
                color: "#e2e8f0",
                textDecoration: "none",
                fontWeight: 700,
                fontSize: 12.5,
              }}
            >
              Chart →
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
