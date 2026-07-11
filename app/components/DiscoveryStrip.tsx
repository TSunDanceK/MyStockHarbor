"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type DiscoveryData = {
  insight: { slug: string; symbol: string | null } | null;
  newsSymbol: string | null;
  earningsSymbol: string;
};

type Tile = {
  key: string;
  icon: string;
  label: string;
  text: string;
  href: string;
  accent: string;
};

// Tile copy is fixed, one-line taglines rather than live-data snippets --
// this keeps the row catchy and consistent every day instead of wrapping
// oddly depending on what a headline or post title happens to be. Links
// still route to genuinely fresh content (today's latest insight, today's
// resolved earnings symbol) via /api/discovery-strip once it resolves;
// until then each tile falls back to its section index.
//
// Accent colors are pulled from hues already established elsewhere on the
// site (amber = company/overview badges, green = Pickers links, blue =
// Insights links). News and Earnings don't have an existing color anchor,
// so they stay neutral slate instead of getting an arbitrary new hue.
const NEUTRAL_ACCENT = "#8b95a7";

const TILE_DEFS: Array<Omit<Tile, "href"> & { defaultHref: string }> = [
  {
    key: "bottlenecks",
    icon: "⛓️",
    label: "Bottlenecks",
    text: "Where the market's choke points hide",
    accent: "#f5a524",
    defaultHref: "/bottlenecks",
  },
  {
    key: "pickers",
    icon: "🔎",
    label: "Pickers",
    text: "Today's screened setups & breakouts",
    accent: "#16c784",
    defaultHref: "/pickers",
  },
  {
    key: "insights",
    icon: "💡",
    label: "Insights",
    text: "Fresh chart breakdowns, daily",
    accent: "#2f6bff",
    defaultHref: "/insights",
  },
  {
    key: "news",
    icon: "🧠",
    label: "News",
    text: "Headlines — uniquely scored & explained",
    accent: NEUTRAL_ACCENT,
    defaultHref: "/stock/SPY/news",
  },
  {
    key: "earnings",
    icon: "📅",
    label: "Earnings",
    text: "Beat, miss & surprise % — decoded",
    accent: NEUTRAL_ACCENT,
    defaultHref: "/stock/AAPL/earnings",
  },
];

function resolveHref(key: string, defaultHref: string, data: DiscoveryData | null): string {
  switch (key) {
    case "insights":
      return data?.insight ? `/insights/${data.insight.slug}` : defaultHref;
    case "news":
      return data?.newsSymbol ? `/stock/${encodeURIComponent(data.newsSymbol)}/news` : defaultHref;
    case "earnings":
      return data?.earningsSymbol
        ? `/stock/${encodeURIComponent(data.earningsSymbol)}/earnings`
        : defaultHref;
    default:
      return defaultHref;
  }
}

export default function DiscoveryStrip() {
  const [data, setData] = useState<DiscoveryData | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/discovery-strip")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const tiles: Tile[] = TILE_DEFS.map(({ defaultHref, ...tile }) => ({
    ...tile,
    href: resolveHref(tile.key, defaultHref, data),
  }));

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
