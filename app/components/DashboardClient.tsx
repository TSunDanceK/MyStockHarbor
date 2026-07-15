"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import PriceChart, { type Overlay, type ChartType, type SupportResistanceZone } from "./PriceChart";
import TradingViewChartEmbed from "./TradingViewChartEmbed";
import InteractiveChart from "./InteractiveChart";
import { detectDivergenceFromHistory } from "../../lib/ta/divergence";
import DiscoveryStrip from "./DiscoveryStrip";
import DashboardTicker from "./DashboardTicker";

type Quote = { symbol: string; price: number | null; date: string | null; time: string | null; source: string; };
type Point = { date: string; open?: number; close: number; high?: number; low?: number; volume?: number; };
type ChartInterval = "d" | "w" | "m";
type ChartMode = "basic" | "interactive" | "tradingview";
type SymbolResult = { symbol: string; name: string; exchange: string };
type BenchItem = { key: string; label: string; symbol: string; date: string | null; time: string | null; close: number | null; prevClose: number | null; changePct: number | null; };
type BenchPayload = { updatedAt: string; scope: string; items: BenchItem[]; };
type InternalNewsCard = { title: string; source: string | null; pubDate: string | null; summary: string; whyItMatters: string; debugAiUsed: 0 | 1; image?: string | null; link?: string | null; };
type NewsPayload = { symbol: string; companyName: string; isInvalidTicker: boolean; trend: string; newsScoreLabel: string; newsScoreValue: number; cards: InternalNewsCard[]; ctaHref: string; };
type StockEarningsSummary = { hasStructuredData?: boolean; tone?: "green" | "yellow" | "red"; toneLabel?: "Good" | "Neutral" | "Weak" | "Unavailable"; reportDate?: string | null; epsSurprisePercent?: number | null; revenueSurprisePercent?: number | null; };
type CachedSymbolData = { quote: Quote | null; history: Point[]; };
type DivergenceState = "bullish" | "bearish" | "none";
type OverviewItem = { key: string; label: string; tone: "green" | "yellow" | "orange" | "red" | "muted"; valueText: string; severity: number; order: number; };
type TrendScore = { total: number; passed: number; details: { name: string; ok: boolean | null }[]; };
type StretchScore = { total: number; flagged: number; oversold: number; overbought: number; details: { name: string; state: "oversold" | "overbought" | "neutral" | "na" }[]; };
type AssetType = "stock" | "crypto";

function movingAverage(values: number[], window: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null); let sum = 0;
  for (let i = 0; i < values.length; i++) { sum += values[i]; if (i >= window) sum -= values[i - window]; if (i >= window - 1) out[i] = sum / window; }
  return out;
}
function rollingStd(values: number[], window: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  for (let i = window - 1; i < values.length; i++) { let mean = 0; for (let j = i - window + 1; j <= i; j++) mean += values[j]; mean /= window; let variance = 0; for (let j = i - window + 1; j <= i; j++) { const d = values[j] - mean; variance += d * d; } variance /= window; out[i] = Math.sqrt(variance); }
  return out;
}
function bollinger(values: number[], window = 20, k = 2) {
  const mid = movingAverage(values, window), sd = rollingStd(values, window);
  return { upper: mid.map((m, i) => m == null || sd[i] == null ? null : m + k * sd[i]!), mid, lower: mid.map((m, i) => m == null || sd[i] == null ? null : m - k * sd[i]!) };
}
