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
  accentSoft: string;
  accentBorder: string;
};

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
        ? `${bottleneck.name}${bottleneck.ticker ? ` (${bottleneck.ticker})` : ""} is today's #1 systemic dependency — showing up ${bottleneck.count}× across every stock we've built.`
        : "See which suppliers and customers each stock depends on most.",
      href: "/bottlenecks",
      accent: "#f5a524",
      accentSoft: "rgba(245,165,36,0.12)",
      accentBorder: "rgba(245,165,36,0.35)",
    },
    {
      key: "pickers",
      icon: "🔎",
      label: "Pickers",
      text: `${pickersCount} screened setups — breakouts, divergence, 200-day MA tests & more.`,
      href: "/pickers",
      accent: "#16c784",
      accentSoft: "rgba(22,199,132,0.12)",
      accentBorder: "rgba(22,199,132,0.35)",
    },
    {
      key: "insights",
      icon: "💡",
      label: "Insights",
      text: insight
        ? `Latest: "${insight.title}"${insight.symbol ? ` (${insight.symbol})` : ""}`
        : "Daily chart write-ups and trade ideas.",
      href: insight ? `/insights/${insight.slug}` : "/insights",
      accent: "#2f6bff",
      accentSoft: "rgba(47,107,255,0.12)",
      accentBorder: "rgba(47,107,255,0.35)",
    },
    {
      key: "news",
      icon: "🧠",
      label: "AI News",
      text: news
        ? `Market headlines scored: ${news.scoreLabel}${news.headline ? ` — "${news.headline}"` : ""}`
        : "AI-scored headline briefings for any ticker.",
      href: news ? `/stock/${encodeURIComponent(news.symbol)}/news` : "/stock/SPY/news",
      accent: "#a78bfa",
      accentSoft: "rgba(167,139,250,0.12)",
      accentBorder: "rgba(167,139,250,0.35)",
    },
    {
      key: "earnings",
      icon: "📅",
      label: "Earnings",
      text: `Full beat/miss history & surprise % — right on ${earningsSymbol}'s page.`,
      href: `/stock/${encodeURIComponent(earningsSymbol)}/earnings`,
      accent: "#22d3ee",
      accentSoft: "rgba(34,211,238,0.12)",
      accentBorder: "rgba(34,211,238,0.35)",
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
              minHeight: 106,
              borderRadius: 14,
              border: `1px solid ${tile.accentBorder}`,
              background: `linear-gradient(160deg, ${tile.accentSoft}, rgba(20,27,43,0.65))`,
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
                WebkitLineClamp: 3,
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
