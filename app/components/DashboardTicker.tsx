"use client";

import { getBuySignalCount } from "@/lib/signalCounts";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TickerLogo from "@/app/components/TickerLogo";

// Live "sports ticker"-style scrolling feed for the dashboard, sitting
// between the discovery strip and the stock overview/chart panels. Pulls
// from the same /api/pickers payload the picker pages already use (cached
// server-side every 6 minutes), so this adds no new backend load. Renders
// on both desktop and mobile since DashboardClient places it outside the
// .msh-desktop-only / .msh-mobile-only split.
//
// Item variety and ordering: every category below is derived purely from
// fields already present in the single /api/pickers response this
// component fetches (signalRecords + sections) -- no new endpoints, no
// extra requests. Categories are built independently, combined, then
// shuffled (Fisher-Yates) on each fetch so the feed doesn't read as a
// fixed block-by-category list.

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
  overbought: boolean;
  buyTheDip: boolean;
  breakout: boolean;
  volumeSpike: boolean;
  atrSpike: boolean;
  aboveMA50: boolean;
  belowMA50: boolean;
  aboveMA200: boolean;
  belowMA200: boolean;
  bullishRsiDivergence: boolean;
  bearishRsiDivergence: boolean;
  bullishMacdDivergence: boolean;
  bearishMacdDivergence: boolean;
  weeklyMa200DistancePct?: number;
};

type PickerSectionItem = {
  symbol: string;
  supportResistanceZone?: { kind: "support" | "resistance" };
};

type PickerSection = {
  title: string;
  items: PickerSectionItem[];
};

type PickersPayload = {
  signalRecords: SignalRecordLite[];
  sections?: PickerSection[];
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
  symbol: string;
};

// Four accent colors, reused from the site's existing tile language
// (Pickers/Insights/Earnings) rather than inventing new hues per category.
// Green/red carry polarity (up vs down, bullish vs bearish setup), cyan is
// reserved for anything earnings-related, and blue covers neutral
// technical/pattern context that isn't inherently bullish or bearish.
const COLOR_UP = "#22c55e";
const COLOR_DOWN = "#f87171";
const COLOR_EARNINGS = "#22d3ee";
const COLOR_TECHNICAL = "#2f6bff";


function getSellSignalCount(r: SignalRecordLite) {
  if (!r.belowMA200) return 0;
  let count = 0;
  if (r.overbought) count += 1;
  if (r.belowMA50) count += 1;
  if (r.belowMA200) count += 1;
  if (r.bearishRsiDivergence) count += 1;
  if (r.bearishMacdDivergence) count += 1;
  return count;
}

function findSection(sections: PickerSection[], title: string): PickerSectionItem[] {
  return sections.find((s) => s.title === title)?.items ?? [];
}

function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function buildItems(data: PickersPayload | null): TickerItem[] {
  if (!data) return [];
  const items: TickerItem[] = [];
  const sections = data.sections ?? [];
  const signalRecords = data.signalRecords ?? [];

  const href = (symbol: string) => `/stock/${encodeURIComponent(symbol)}`;

  const movers = (data.tickerFeed?.topMovers ?? [])
    .filter((row) => typeof row.changePct === "number" && Number.isFinite(row.changePct))
    .slice(0, 3);
  movers.forEach((row) => {
    const pct = row.changePct as number;
    const up = pct >= 0;
    items.push({
      id: `mover-${row.symbol}`,
      text: `${row.symbol} ${up ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}% today`,
      href: href(row.symbol),
      color: up ? COLOR_UP : COLOR_DOWN,
      symbol: row.symbol,
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
      href: `${href(item.symbol)}/earnings`,
      color: COLOR_EARNINGS,
      symbol: item.symbol,
    });
  });

  const ma200Close = signalRecords
    .filter((r) => typeof r.weeklyMa200DistancePct === "number" && Number.isFinite(r.weeklyMa200DistancePct))
    .slice()
    .sort((a, b) => Math.abs(a.weeklyMa200DistancePct!) - Math.abs(b.weeklyMa200DistancePct!))
    .slice(0, 2);
  ma200Close.forEach((r) => {
    items.push({
      id: `ma200-${r.symbol}`,
      text: `${r.symbol} getting close to weekly MA200`,
      href: href(r.symbol),
      color: COLOR_TECHNICAL,
      symbol: r.symbol,
    });
  });

  const buySignalLeaders = signalRecords
    .map((r) => ({ symbol: r.symbol, count: getBuySignalCount(r) }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 2);
  buySignalLeaders.forEach((r) => {
    items.push({
      id: `buysignals-${r.symbol}`,
      text: `${r.symbol} currently has ${r.count} buy signal${r.count === 1 ? "" : "s"}`,
      href: href(r.symbol),
      color: COLOR_UP,
      symbol: r.symbol,
    });
  });

  const sellSignalLeaders = signalRecords
    .map((r) => ({ symbol: r.symbol, count: getSellSignalCount(r) }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 2);
  sellSignalLeaders.forEach((r) => {
    items.push({
      id: `sellsignals-${r.symbol}`,
      text: `${r.symbol} currently has ${r.count} sell signal${r.count === 1 ? "" : "s"}`,
      href: href(r.symbol),
      color: COLOR_DOWN,
      symbol: r.symbol,
    });
  });

  const bullishDivergence = signalRecords
    .filter((r) => r.bullishRsiDivergence || r.bullishMacdDivergence)
    .slice(0, 2);
  bullishDivergence.forEach((r) => {
    items.push({
      id: `bulldiv-${r.symbol}`,
      text: `${r.symbol} showing bullish divergence`,
      href: href(r.symbol),
      color: COLOR_UP,
      symbol: r.symbol,
    });
  });

  const bearishDivergence = signalRecords
    .filter((r) => r.bearishRsiDivergence || r.bearishMacdDivergence)
    .slice(0, 2);
  bearishDivergence.forEach((r) => {
    items.push({
      id: `beardiv-${r.symbol}`,
      text: `${r.symbol} showing bearish divergence`,
      href: href(r.symbol),
      color: COLOR_DOWN,
      symbol: r.symbol,
    });
  });

  findSection(sections, "All-Time High Breakout Stocks")
    .slice(0, 2)
    .forEach((item) => {
      items.push({
        id: `athbo-${item.symbol}`,
        text: `${item.symbol} just broke out to a new all-time high`,
        href: href(item.symbol),
        color: COLOR_UP,
        symbol: item.symbol,
      });
    });

  findSection(sections, "3-Month High Breakout Stocks")
    .slice(0, 2)
    .forEach((item) => {
      items.push({
        id: `3mbo-${item.symbol}`,
        text: `${item.symbol} broke out to a fresh 3-month high`,
        href: href(item.symbol),
        color: COLOR_UP,
        symbol: item.symbol,
      });
    });

  findSection(sections, "Macro Support and Resistance Stocks")
    .slice(0, 2)
    .forEach((item) => {
      const isSupport = item.supportResistanceZone?.kind !== "resistance";
      items.push({
        id: `macrosr-${item.symbol}`,
        text: isSupport
          ? `${item.symbol} holding at a key support zone`
          : `${item.symbol} testing a key resistance zone`,
        href: href(item.symbol),
        color: isSupport ? COLOR_UP : COLOR_DOWN,
        symbol: item.symbol,
      });
    });

  findSection(sections, "Stocks Down 20% From All-Time Highs")
    .slice(0, 2)
    .forEach((item) => {
      items.push({
        id: `dip-${item.symbol}`,
        text: `${item.symbol} is 20%+ below its all-time high`,
        href: href(item.symbol),
        color: COLOR_TECHNICAL,
        symbol: item.symbol,
      });
    });

  findSection(sections, "Oversold Stocks Today (Potential Rebound Setups)")
    .slice(0, 2)
    .forEach((item) => {
      items.push({
        id: `oversold-${item.symbol}`,
        text: `${item.symbol} is oversold today`,
        href: href(item.symbol),
        color: COLOR_UP,
        symbol: item.symbol,
      });
    });

  findSection(sections, "Overbought Stocks Today (Potential Pullback Setups)")
    .slice(0, 2)
    .forEach((item) => {
      items.push({
        id: `overbought-${item.symbol}`,
        text: `${item.symbol} is overbought today`,
        href: href(item.symbol),
        color: COLOR_DOWN,
        symbol: item.symbol,
      });
    });

  findSection(sections, "Best Trend Score Stocks")
    .slice(0, 2)
    .forEach((item) => {
      items.push({
        id: `trend-${item.symbol}`,
        text: `${item.symbol} has one of the strongest trend scores today`,
        href: href(item.symbol),
        color: COLOR_TECHNICAL,
        symbol: item.symbol,
      });
    });

  findSection(sections, "Stocks With Positive Last Earnings")
    .slice(0, 2)
    .forEach((item) => {
      items.push({
        id: `posearnings-${item.symbol}`,
        text: `${item.symbol} beat on its last earnings report`,
        href: `${href(item.symbol)}/earnings`,
        color: COLOR_EARNINGS,
        symbol: item.symbol,
      });
    });

  return shuffle(items);
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
          display: "flex",
          alignItems: "center",
        }}
      >
        <div
          className="msh-ticker-track"
          style={{
            display: "flex",
            alignItems: "center",
            height: "100%",
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
              <TickerLogo symbol={item.symbol} size={18} radius={5} />
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
