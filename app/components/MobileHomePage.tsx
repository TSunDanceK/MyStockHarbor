"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type NavTile = {
  icon: string;
  label: string;
  sublabel: string;
  href: string;
  accent: string;
  bg: string;
};

const TILES: NavTile[] = [
  {
    icon: "📈",
    label: "Chart Dashboard",
    sublabel: "Live charts & technical analysis",
    href: "/dashboard",
    accent: "rgba(59,130,246,0.55)",
    bg: "linear-gradient(135deg, rgba(37,99,235,0.22), rgba(59,130,246,0.10))",
  },
  {
    icon: "🔎",
    label: "Stock Pickers",
    sublabel: "Scan for ideas & setups",
    href: "/pickers",
    accent: "rgba(239,68,68,0.50)",
    bg: "linear-gradient(135deg, rgba(239,68,68,0.18), rgba(127,29,29,0.10))",
  },
  {
    icon: "💡",
    label: "Insights",
    sublabel: "Daily chart write-ups & trade ideas",
    href: "/insights",
    accent: "rgba(250,204,21,0.50)",
    bg: "linear-gradient(135deg, rgba(234,179,8,0.18), rgba(202,138,4,0.08))",
  },
  {
    icon: "📊",
    label: "Stock Analysis",
    sublabel: "Deep-dive any ticker",
    href: "/dashboard",
    accent: "rgba(34,197,94,0.50)",
    bg: "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(16,185,129,0.08))",
  },
  {
    icon: "📅",
    label: "Earnings",
    sublabel: "Latest earnings results",
    href: "/dashboard",
    accent: "rgba(251,146,60,0.50)",
    bg: "linear-gradient(135deg, rgba(251,146,60,0.18), rgba(234,88,12,0.08))",
  },
  {
    icon: "🧮",
    label: "Risk Calculator",
    sublabel: "Position sizing & risk tools",
    href: "/utilities",
    accent: "rgba(168,85,247,0.50)",
    bg: "linear-gradient(135deg, rgba(168,85,247,0.18), rgba(139,92,246,0.08))",
  },
  {
    icon: "🏦",
    label: "Platforms",
    sublabel: "Compare brokers & charting tools",
    href: "/platforms",
    accent: "rgba(20,184,166,0.50)",
    bg: "linear-gradient(135deg, rgba(20,184,166,0.18), rgba(13,148,136,0.08))",
  },
  {
    icon: "📘",
    label: "Learn",
    sublabel: "Indicators, patterns & strategy",
    href: "/learn",
    accent: "rgba(99,102,241,0.50)",
    bg: "linear-gradient(135deg, rgba(99,102,241,0.18), rgba(79,70,229,0.08))",
  },
];

export default function MobileHomePage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ symbol: string; name: string; exchange: string }[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);

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

        {/* H1 — matches page metadata title for SEO */}
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
        {TILES.map((tile) => (
          <Link
            key={tile.label}
            href={tile.href}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: "16px 14px",
              borderRadius: 18,
              border: `1px solid ${tile.accent}`,
              background: tile.bg,
              textDecoration: "none",
              color: "#f1f5f9",
              boxShadow: `0 4px 20px ${tile.accent.replace("0.5", "0.12")}`,
              transition: "transform 120ms ease, filter 120ms ease",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <span style={{ fontSize: 28, lineHeight: 1 }}>{tile.icon}</span>
            <div>
              <div style={{ fontWeight: 950, fontSize: 15, lineHeight: 1.15 }}>{tile.label}</div>
              <div
                style={{
                  marginTop: 3,
                  fontSize: 12,
                  opacity: 0.65,
                  fontWeight: 700,
                  lineHeight: 1.4,
                }}
              >
                {tile.sublabel}
              </div>
            </div>
          </Link>
        ))}
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
