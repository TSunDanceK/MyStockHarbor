"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

// Live "sports ticker"-style scrolling feed for the dashboard, sitting
// between the discovery strip and the stock overview/chart panels. Pulls
// from the same /api/pickers payload the picker pages already use (cached
// server-side every 6 minutes), so this adds no new backend load. Renders
// on both desktop and mobile since DashboardClient places it outside the
// .msh-desktop-only / .msh-mobile-only split.

type MarketRow = {
  symbol: string;
  changePct: number | null;
  rangePct: number | null;
  last: number | null;
  volume: number | null;
};

type TickerEarningsGrowthItem = {
  symbol: string;
  epsGrowthPct: number | null;
  revenueGrowthPct: number | null;
  releaseDate: string | null;
  tone: string;
};

type SignalRecordLite = {
  symbol: string;
  oversold: boolean;
  buyTheDip: boolean;
  breakout: boolean;
  volumeSpike: boolean;
  atrSpike: boolean;
  aboveMA50: boolean;
  aboveMA200: boolean;
  bullishRsiDivergence: boolean;
  bullishMacdDivergence: boolean;
  weeklyMa200DistancePct?: number;
};

type PickersPayload = {
  signalRecords: SignalRecordLite[];
  tickerFeed: {
    topMovers: MarketRow[];
    earningsGrowth: TickerEarningsGrowthItem[];
  };
};

type TickerItem = {
  id: string;
  text: string;
  href: string;
  color: string;
};

// Only 3 accent colors in play, reused from the site's existing tile
// language (Pickers/Insights/Earnings) rather than inventing new hues:
// movers get green/red purely for up/down polarity (a near-universal
// finance convention, not really "a 4th category color"), earnings growth
// gets the same cyan as the Earnings discovery tile, and the two
// "technical setup" categories (weekly MA200 proximity + buy signals)
// share one blue so the feed doesn't feel busier than it needs to.
const COLOR_UP = "#22c55e";
const COLOR_DOWN = "#f87171";
const COLOR_EARNINGS = "#22d3ee";
const COLOR_TECHNICAL = "#2f6bff";

function getBuySignalCount(r: SignalRecordLite) {
  if (!r.aboveMA200) return 0;
  let count = 0;
  if (r.oversold) count += 1;
  if (r.buyTheDip) count += 1;
  if (r.breakout) count += 1;
  if (r.volumeSpike) count += 1;
  if (r.atrSpike) count += 1;
  if (r.aboveMA50) count += 1;
  if (r.aboveMA200) count += 1;
  if (r.bullishRsiDivergence) count += 1;
  if (r.bullishMacdDivergence) count += 1;
  return count;
}

function buildItems(data: PickersPayload | null): TickerItem[] {
  if (!data) return [];
  const items: TickerItem[] = [];

  const movers = (data.tickerFeed?.topMovers ?? [])
    .filter((row) => typeof row.changePct === "number" && Number.isFinite(row.changePct))
    .slice(0, 3);
  movers.forEach((row) => {
    const pct = row.changePct as number;
    const up = pct >= 0;
    items.push({
      id: `mover-${row.symbol}`,
      text: `${row.symbol} ${up ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}% today`,
      href: `/stock/${encodeURIComponent(row.symbol)}`,
      color: up ? COLOR_UP : COLOR_DOWN,
    });
  });

  const earningsGrowth = (data.tickerFeed?.earningsGrowth ?? []).slice(0, 3);
  earningsGrowth.forEach((item) => {
    const growthPct = item.epsGrowthPct ?? item.revenueGrowthPct;
    const isRecent =
      !!item.releaseDate &&
      Date.now() - new Date(item.releaseDate).getTime() < 8 * 24 * 60 * 60 * 1000;
    const text = isRecent
      ? `Massive growth from ${item.symbol} earnings this week`
      : `${item.symbol} earnings growth accelerating${
          growthPct != null ? ` — EPS ${growthPct >= 0 ? "+" : ""}${growthPct.toFixed(0)}% YoY` : ""
        }`;
    items.push({
      id: `earnings-${item.symbol}`,
      text,
      href: `/stock/${encodeURIComponent(item.symbol)}/earnings`,
      color: COLOR_EARNINGS,
    });
  });

  const ma200Close = (data.signalRecords ?? [])
    .filter((r) => typeof r.weeklyMa200DistancePct === "number" && Number.isFinite(r.weeklyMa200DistancePct))
    .slice()
    .sort((a, b) => Math.abs(a.weeklyMa200DistancePct!) - Math.abs(b.weeklyMa200DistancePct!))
    .slice(0, 3);
  ma200Close.forEach((r) => {
    items.push({
      id: `ma200-${r.symbol}`,
      text: `${r.symbol} getting close to weekly MA200`,
      href: `/stock/${encodeURIComponent(r.symbol)}`,
      color: COLOR_TECHNICAL,
    });
  });

  const buySignalLeaders = (data.signalRecords ?? [])
    .map((r) => ({ symbol: r.symbol, count: getBuySignalCount(r) }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  buySignalLeaders.forEach((r) => {
    items.push({
      id: `buysignals-${r.symbol}`,
      text: `${r.symbol} currently has ${r.count} buy signal${r.count === 1 ? "" : "s"}`,
      href: `/stock/${encodeURIComponent(r.symbol)}`,
      color: COLOR_TECHNICAL,
    });
  });

  return items;
}

export default function DashboardTicker() {
  const [data, setData] = useState<PickersPayload | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/pickers")
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

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const items = useMemo(() => buildItems(data), [data]);

  if (items.length === 0) return null;

  // Duplicate the item list so the marquee can loop seamlessly by
  // translating exactly -50% (the point at which the duplicate lines up
  // with where the original started). Skip the duplication for
  // reduced-motion users, since the track becomes a manually-scrollable
  // static list for them instead of an animated loop.
  const trackItems = reducedMotion ? items : [...items, ...items];
  const durationSec = Math.max(18, items.length * 4);

  return (
    <div
      className="msh-ticker"
      style={{
        margin: "2px 0 14px",
        display: "flex",
        alignItems: "stretch",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
        overflow: "hidden",
        height: 38,
      }}
    >
      <div
        style={{
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 12px",
          fontSize: 10.5,
          fontWeight: 800,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#5f6b80",
          borderRight: "1px solid rgba(255,255,255,0.08)",
          whiteSpace: "nowrap",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#f87171",
            display: "inline-block",
          }}
        />
        Live feed
      </div>

      <div
        className="msh-ticker-viewport"
        style={{
          flex: "1 1 auto",
          overflow: reducedMotion ? "auto" : "hidden",
          position: "relative",
        }}
      >
        <div
          className="msh-ticker-track"
          style={{
            display: "flex",
            alignItems: "center",
            width: "max-content",
            animation: reducedMotion ? "none" : `mshTickerScroll ${durationSec}s linear infinite`,
          }}
        >
          {trackItems.map((item, idx) => (
            <Link
              key={`${item.id}-${idx}`}
              href={item.href}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                padding: "0 18px",
                fontSize: 12.5,
                fontWeight: 700,
                color: "#c7d0de",
                textDecoration: "none",
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: item.color,
                  flex: "0 0 auto",
                  display: "inline-block",
                }}
              />
              {item.text}
            </Link>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes mshTickerScroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .msh-ticker-track:hover { animation-play-state: paused; }
        .msh-ticker a:hover { filter: brightness(1.2); }
      `}</style>
    </div>
  );
}
