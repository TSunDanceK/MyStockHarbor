"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type DiscoveryData = {
  bottleneck: { name: string; ticker: string | null; count: number } | null;
  insight: { title: string; slug: string; symbol: string | null; date: string } | null;
  news: { symbol: string; scoreLabel: string; headline: string | null } | null;
  pickers: { count: number };
  earnings: { symbol: string };
};

type Tile = {
  key: string;
  icon: string;
  label: string;
  text: string;
  href: string;
  accent: string;
};

// Accent colors are pulled from hues already established elsewhere on the
// site (amber = company/overview badges, green = Pickers links, blue =
// Insights links) rather than inventing new ones per tile. AI News and
// Earnings don't have an existing color anchor, so they stay neutral slate
// instead of getting an arbitrary new hue — the icon + label already
// differentiate them.
const NEUTRAL_ACCENT = "#8b95a7";

function buildTiles(data: DiscoveryData | null): Tile[] {
  const bottleneck = data?.bottleneck ?? null;
  const insight = data?.insight ?? null;
  const news = data?.news ?? null;
  const pickersCount = data?.pickers?.count ?? 17;
  const earningsSymbol = data?.earnings?.symbol ?? "AAPL";

  return [
    {
      key: "bottlenecks",
      icon: "⛓️",
      label: "Bottlenecks",
      text: bottleneck
        ? `${bottleneck.name}${bottleneck.ticker ? ` (${bottleneck.ticker})` : ""} — today's top dependency, ${bottleneck.count}× across our coverage.`
        : "Every stock's supplier & customer dependencies, mapped.",
      href: "/bottlenecks",
      accent: "#f5a524",
    },
    {
      key: "pickers",
      icon: "🔎",
      label: "Pickers",
      text: `${pickersCount} screened setups — breakouts, divergence, 200-day MA & more.`,
      href: "/pickers",
      accent: "#16c784",
    },
    {
      key: "insights",
      icon: "💡",
      label: "Insights",
      text: insight
        ? `${insight.symbol ? `${insight.symbol}: ` : ""}${insight.title}`
        : "Daily chart write-ups and trade ideas.",
      href: insight ? `/insights/${insight.slug}` : "/insights",
      accent: "#2f6bff",
    },
    {
      key: "news",
      icon: "🧠",
      label: "AI News",
      text: news
        ? `${news.symbol} headlines: ${news.scoreLabel}`
        : "AI-scored headlines for any ticker.",
      href: news ? `/stock/${encodeURIComponent(news.symbol)}/news` : "/stock/SPY/news",
      accent: NEUTRAL_ACCENT,
    },
    {
      key: "earnings",
      icon: "📅",
      label: "Earnings",
      text: `Beat/miss history & surprise % for ${earningsSymbol}.`,
      href: `/stock/${encodeURIComponent(earningsSymbol)}/earnings`,
      accent: NEUTRAL_ACCENT,
    },
  ];
}

export default function DiscoveryStrip() {
  const [data, setData] = useState<DiscoveryData | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/discovery-strip")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const tiles = buildTiles(data);

  return (
    <section style={{ margin: "4px 0 18px" }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          color: "#5f6b80",
          marginBottom: 10,
        }}
      >
        What&apos;s happening across MyStockHarbor
      </div>

      <div
        className="msh-discovery-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 12,
        }}
      >
        {tiles.map((tile) => (
          <Link
            key={tile.key}
            href={tile.href}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: "14px 14px 15px",
              minHeight: 92,
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.08)",
              borderLeft: `3px solid ${tile.accent}`,
              background: "rgba(255,255,255,0.03)",
              textDecoration: "none",
              color: "#eaf0fa",
              transition: "transform 120ms ease, filter 120ms ease",
              opacity: loaded ? 1 : 0.6,
              minWidth: 0,
              boxSizing: "border-box",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ fontSize: 16, lineHeight: 1 }}>{tile.icon}</span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: "0.06em",
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
                lineHeight: 1.5,
                color: "#c7d0de",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {tile.text}
            </div>
          </Link>
        ))}
      </div>

      <style>{`
        .msh-discovery-grid a:hover { filter: brightness(1.12); transform: translateY(-1px); }
      `}</style>
    </section>
  );
}
