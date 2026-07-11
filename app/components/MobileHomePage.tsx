"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const DEFAULT_SYMBOL = "AAPL";

type NavTile = {
  icon: string;
  label: string;
  sublabel: string | ((symbol: string) => string);
  href: string | ((symbol: string) => string);
  accent: string;
};

// Same unified-card treatment as the desktop discovery strip: one dark
// card style for every tile, with a thin colored left border + label as
// the only accent, instead of each tile getting its own full-gradient
// background. Colors reuse the hues already established elsewhere on the
// site (amber = Bottlenecks, green = Pickers, blue = Insights); tiles with
// no existing color anchor share a neutral slate instead of an invented hue.
const NEUTRAL_ACCENT = "#8b95a7";

const TILES: NavTile[] = [
  {
    icon: "📈",
    label: "Chart Dashboard",
    sublabel: "Live charts & full technical breakdown",
    href: "/dashboard",
    accent: NEUTRAL_ACCENT,
  },
  {
    icon: "⛓️",
    label: "Bottlenecks",
    sublabel: "Where the market's choke points hide",
    href: "/bottlenecks",
    accent: "#f5a524",
  },
  {
    icon: "🔎",
    label: "Stock Pickers",
    sublabel: "Today's screened setups & breakouts",
    href: "/pickers",
    accent: "#16c784",
  },
  {
    icon: "💡",
    label: "Insights",
    sublabel: "Fresh chart breakdowns, daily",
    href: "/insights",
    accent: "#2f6bff",
  },
  {
    icon: "🧠",
    label: "News",
    sublabel: "Headlines — uniquely scored & explained",
    href: (symbol: string) => `/stock/${encodeURIComponent(symbol)}/news`,
    accent: NEUTRAL_ACCENT,
  },
  {
    icon: "📊",
    label: "Stock Analysis",
    sublabel: (symbol: string) => `Viewing ${symbol}`,
    href: (symbol: string) => `/stock/${encodeURIComponent(symbol)}`,
    accent: NEUTRAL_ACCENT,
  },
  {
    icon: "📅",
    label: "Earnings",
    sublabel: (symbol: string) => `${symbol} earnings`,
    href: (symbol: string) => `/stock/${encodeURIComponent(symbol)}/earnings`,
    accent: NEUTRAL_ACCENT,
  },
  {
    icon: "🧮",
    label: "Risk Calculator",
    sublabel: "Position sizing & risk tools",
    href: "/utilities",
    accent: NEUTRAL_ACCENT,
  },
  {
    icon: "🏦",
    label: "Platforms",
    sublabel: "Compare brokers & charting tools",
    href: "/platforms",
    accent: NEUTRAL_ACCENT,
  },
  {
    icon: "📘",
    label: "Learn",
    sublabel: "Indicators, patterns & strategy",
    href: "/learn",
    accent: NEUTRAL_ACCENT,
  },
];

export default function MobileHomePage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ symbol: string; name: string; exchange: string }[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);

  // Last viewed symbol from localStorage, falls back to AAPL for fresh visitors
  const [lastSymbol, setLastSymbol] = useState(DEFAULT_SYMBOL);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("msh_last_symbol");
      if (saved && saved.trim()) setLastSymbol(saved.trim().toUpperCase());
    } catch {
      // localStorage unavailable (private browsing edge cases) — keep default
    }
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); return; }

    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/symbols?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        const rows = Array.isArray(data.results) ? data.results : [];
        setResults(rows.slice(0, 6));
      } catch {
        setResults([]);
      }
    }, 250);

    return () => clearTimeout(t);
  }, [query]);

  function goToStock(symbol: string) {
    setQuery("");
    setResults([]);
    setSearchOpen(false);
    router.push(`/stock/${encodeURIComponent(symbol.toUpperCase())}`);
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#06080d",
        color: "#f1f5f9",
        fontFamily: "system-ui, Arial",
        padding: "0 0 40px",
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          padding: "20px 16px 16px",
          background: "linear-gradient(180deg, rgba(37,99,235,0.14), rgba(6,8,13,0))",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <img
          src="/logo.png"
          alt="MyStockHarbor"
          style={{ height: 52, width: "auto", display: "block", marginBottom: 10 }}
        />

        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 950,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
          }}
        >
          Stock Analysis Tools, Stock Pickers &amp; Market Insights
        </h1>

        <p
          style={{
            margin: "5px 0 0",
            fontSize: 13,
            color: "rgba(241,245,249,0.65)",
            fontWeight: 700,
          }}
        >
          Charts · Pickers · Insights · Education
        </p>
      </div>

      {/* ── Quick Stock Search ── */}
      <div style={{ padding: "16px 16px 0", position: "relative" }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 900,
            marginBottom: 6,
            opacity: 0.7,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Quick Stock Search
        </div>
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); }}
          onFocus={() => setSearchOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) goToStock(results[0].symbol);
          }}
          placeholder="🔎  Search any ticker or company…"
          style={{
            width: "100%",
            padding: "13px 14px",
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.18)",
            background: "#0f172a",
            color: "#f1f5f9",
            fontSize: 15,
            fontWeight: 700,
            outline: "none",
            boxSizing: "border-box",
          }}
        />
        {searchOpen && results.length > 0 && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% - 4px)",
              left: 16,
              right: 16,
              zIndex: 50,
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "#0b1220",
              boxShadow: "0 18px 34px rgba(0,0,0,0.45)",
              overflow: "hidden",
            }}
          >
            {results.map((r) => (
              <button
                key={r.symbol}
                type="button"
                onClick={() => goToStock(r.symbol)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "11px 14px",
                  border: "none",
                  borderBottom: "1px solid rgba(255,255,255,0.08)",
                  background: "transparent",
                  color: "#f1f5f9",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 900, fontSize: 14 }}>{r.symbol}</div>
                <div style={{ fontSize: 12, opacity: 0.65 }}>
                  {r.name}{r.exchange ? ` · ${r.exchange}` : ""}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Nav Tiles ── */}
      <div
        style={{
          padding: "20px 16px 0",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
        }}
      >
        {TILES.map((tile) => {
          const resolvedHref = typeof tile.href === "function" ? tile.href(lastSymbol) : tile.href;
          const resolvedSublabel = typeof tile.sublabel === "function" ? tile.sublabel(lastSymbol) : tile.sublabel;

          return (
            <Link
              key={tile.label}
              href={resolvedHref}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: "14px 14px 15px",
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.08)",
                borderLeft: `3px solid ${tile.accent}`,
                background: "rgba(255,255,255,0.03)",
                textDecoration: "none",
                color: "#f1f5f9",
                transition: "transform 120ms ease, filter 120ms ease",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ fontSize: 18, lineHeight: 1 }}>{tile.icon}</span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    color: tile.accent,
                  }}
                >
                  {tile.label}
                </span>
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  opacity: 0.75,
                  fontWeight: 600,
                  lineHeight: 1.4,
                }}
              >
                {resolvedSublabel}
              </div>
            </Link>
          );
        })}
      </div>

      {/* ── Footer links ── */}
      <div
        style={{
          marginTop: 28,
          padding: "0 16px",
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          fontSize: 12,
          color: "rgba(241,245,249,0.45)",
          fontWeight: 700,
        }}
      >
        {[
          { label: "About", href: "/about" },
          { label: "Contact", href: "/contact" },
          { label: "Risk Disclaimer", href: "/risk-disclaimer" },
          { label: "Privacy Policy", href: "/privacy-policy" },
        ].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            style={{ color: "inherit", textDecoration: "none" }}
          >
            {l.label}
          </Link>
        ))}
      </div>
    </main>
  );
}
