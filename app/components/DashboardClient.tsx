"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import PriceChart, { type Overlay, type ChartType, type SupportResistanceZone } from "./PriceChart";
import { detectDivergenceFromHistory } from "../../lib/ta/divergence";
import DiscoveryStrip from "./DiscoveryStrip";
import DashboardTicker from "./DashboardTicker";

type Quote = { symbol: string; price: number | null; date: string | null; time: string | null; source: string; };
type Point = { date: string; open?: number; close: number; high?: number; low?: number; volume?: number; };
type ChartInterval = "d" | "w" | "m";
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
function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null); if (!values.length) return out;
  const k = 2 / (period + 1); let emaPrev: number | null = null, sum = 0;
  for (let i = 0; i < values.length; i++) { const v = values[i]; if (i < period) { sum += v; if (i === period - 1) { emaPrev = sum / period; out[i] = emaPrev; } continue; } emaPrev = emaPrev == null ? v : v * k + emaPrev * (1 - k); out[i] = emaPrev; }
  return out;
}
function rsiWilder(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null); if (values.length < period + 1) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) { const d = values[i] - values[i - 1]; if (d >= 0) gain += d; else loss -= d; }
  let avgGain = gain / period, avgLoss = loss / period;
  out[period] = 100 - 100 / (1 + (avgLoss === 0 ? Infinity : avgGain / avgLoss));
  for (let i = period + 1; i < values.length; i++) { const d = values[i] - values[i - 1]; avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period; avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period; out[i] = 100 - 100 / (1 + (avgLoss === 0 ? Infinity : avgGain / avgLoss)); }
  return out;
}
function macd(values: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(values, fast), emaSlow = ema(values, slow);
  const line: (number | null)[] = values.map((_, i) => { const f = emaFast[i], s = emaSlow[i]; if (typeof f !== "number" || !Number.isFinite(f) || typeof s !== "number" || !Number.isFinite(s)) return null; return f - s; });
  const sig: (number | null)[] = Array(values.length).fill(null), hist: (number | null)[] = Array(values.length).fill(null);
  const valid: { index: number; value: number }[] = [];
  for (let i = 0; i < line.length; i++) { const v = line[i]; if (typeof v === "number" && Number.isFinite(v)) valid.push({ index: i, value: v }); }
  if (valid.length < signal) return { line, signal: sig, hist };
  let seed = 0; for (let i = 0; i < signal; i++) seed += valid[i].value;
  let prev = seed / signal; sig[valid[signal - 1].index] = prev;
  const k = 2 / (signal + 1);
  for (let i = signal; i < valid.length; i++) { prev = valid[i].value * k + prev * (1 - k); sig[valid[i].index] = prev; }
  for (let i = 0; i < line.length; i++) { const l = line[i], s = sig[i]; if (typeof l === "number" && Number.isFinite(l) && typeof s === "number" && Number.isFinite(s)) hist[i] = l - s; }
  return { line, signal: sig, hist };
}
function vwma(values: number[], volumes: (number | undefined)[], window = 20): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) { if (i < window - 1) continue; let pv = 0, v = 0; for (let j = i - window + 1; j <= i; j++) { const p = values[j], vol = volumes[j]; if (typeof p !== "number" || !Number.isFinite(p) || typeof vol !== "number" || !Number.isFinite(vol) || vol <= 0) continue; pv += p * vol; v += vol; } out[i] = v > 0 ? pv / v : null; }
  return out;
}
function stochastic(points: Point[], kPeriod = 14, dPeriod = 3) {
  const k: (number | null)[] = Array(points.length).fill(null);
  for (let i = 0; i < points.length; i++) {
    if (i < kPeriod - 1) continue; let hh = -Infinity, ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) { const h = points[j].high, l = points[j].low; if (typeof h !== "number" || !Number.isFinite(h)) { hh = NaN; break; } if (typeof l !== "number" || !Number.isFinite(l)) { ll = NaN; break; } if (h > hh) hh = h; if (l < ll) ll = l; }
    if (!Number.isFinite(hh) || !Number.isFinite(ll)) continue; const d = hh - ll; if (d <= 0) continue; k[i] = ((points[i].close - ll) / d) * 100;
  }
  const d = movingAverage(k.map(v => typeof v === "number" ? v : 0), dPeriod).map((v, i) => k[i] == null ? null : v);
  return { k, d };
}
function atr(points: Point[], period = 14): (number | null)[] {
  const tr: (number | null)[] = Array(points.length).fill(null);
  for (let i = 0; i < points.length; i++) { const h = points[i].high, l = points[i].low, cp = i > 0 ? points[i - 1].close : null; if (typeof h !== "number" || !Number.isFinite(h) || typeof l !== "number" || !Number.isFinite(l)) continue; const hl = h - l, hc = cp == null ? hl : Math.abs(h - cp), lc = cp == null ? hl : Math.abs(l - cp); tr[i] = Math.max(hl, hc, lc); }
  const out: (number | null)[] = Array(points.length).fill(null); let sum = 0, count = 0, prev: number | null = null;
  for (let i = 0; i < points.length; i++) { const v = tr[i]; if (v == null) { out[i] = prev; continue; } if (prev == null) { sum += v; count++; if (count === period) { prev = sum / period; out[i] = prev; } continue; } prev = (prev * (period - 1) + v) / period; out[i] = prev; }
  return out;
}
function smaNullable(values: (number | null)[], window: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null); if (window <= 0) return out;
  for (let i = window - 1; i < values.length; i++) { let sum = 0, ok = true; for (let j = i - window + 1; j <= i; j++) { const v = values[j]; if (typeof v !== "number" || !Number.isFinite(v)) { ok = false; break; } sum += v; } out[i] = ok ? sum / window : null; }
  return out;
}
function lastNum(arr: (number | null)[]) { return arr.length ? arr[arr.length - 1] : null; }
function avg(values: number[]) { if (!values.length) return 0; return values.reduce((s, v) => s + v, 0) / values.length; }

function aggregateWeeklyPoints(points: Point[]): Point[] {
  const buckets = new Map<string, Point>();
  for (const point of points) {
    const date = new Date(`${point.date}T00:00:00Z`); if (Number.isNaN(date.getTime())) continue;
    const day = date.getUTCDay(); date.setUTCDate(date.getUTCDate() + (day === 0 ? -6 : 1 - day));
    const key = date.toISOString().slice(0, 10);
    const high = typeof point.high === "number" && Number.isFinite(point.high) ? point.high : point.close;
    const low = typeof point.low === "number" && Number.isFinite(point.low) ? point.low : point.close;
    const volume = typeof point.volume === "number" && Number.isFinite(point.volume) ? point.volume : 0;
    const existing = buckets.get(key);
    if (!existing) { buckets.set(key, { date: key, open: typeof point.open === "number" && Number.isFinite(point.open) ? point.open : point.close, close: point.close, high, low, volume }); }
    else { buckets.set(key, { date: key, open: existing.open, close: point.close, high: Math.max(existing.high ?? existing.close, high), low: Math.min(existing.low ?? existing.close, low), volume: (existing.volume ?? 0) + volume }); }
  }
  return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
}

type MacroZoneCandidate = SupportResistanceZone & { touches: number; distancePct: number; score: number; };

function computeMacroSupportResistanceZones(points: Point[], lastClose: number | null): SupportResistanceZone[] {
  if (typeof lastClose !== "number" || !Number.isFinite(lastClose) || lastClose <= 0) return [];
  const weekly = aggregateWeeklyPoints(points).slice(-156); if (weekly.length < 35) return [];
  type Pivot = { idx: number; price: number; kind: "support" | "resistance" };
  const pivots: Pivot[] = []; const lr = 2;
  for (let i = lr; i < weekly.length - lr; i++) {
    const pt = weekly[i];
    const high = typeof pt.high === "number" && Number.isFinite(pt.high) ? pt.high : pt.close;
    const low = typeof pt.low === "number" && Number.isFinite(pt.low) ? pt.low : pt.close;
    let isSH = true, isSL = true;
    for (let o = 1; o <= lr; o++) { const l = weekly[i - o], r = weekly[i + o]; if (high < (l.high ?? l.close) || high < (r.high ?? r.close)) isSH = false; if (low > (l.low ?? l.close) || low > (r.low ?? r.close)) isSL = false; }
    if (isSL && low > 0) pivots.push({ idx: i, price: low, kind: "support" });
    if (isSH && high > 0) pivots.push({ idx: i, price: high, kind: "resistance" });
  }
  if (pivots.length < 2) return [];
  const maxZ = 5.5; const candidates: MacroZoneCandidate[] = [];
  for (const pivot of pivots) {
    const sk = pivots.filter(c => c.kind === pivot.kind);
    const members = sk.filter(c => { const mid = (c.price + pivot.price) / 2; if (mid <= 0) return false; return Math.abs(((c.price - pivot.price) / mid) * 100) <= maxZ; });
    if (members.length < 2) continue;
    const prices = members.map(m => m.price); const lower = Math.min(...prices), upper = Math.max(...prices), level = avg(prices);
    const zwp = level > 0 ? ((upper - lower) / level) * 100 : 999; if (zwp > maxZ) continue;
    const fi = Math.min(...members.map(m => m.idx)), li = Math.max(...members.map(m => m.idx)); const sw = li - fi; if (sw < 8) continue;
    let dp: number;
    if (pivot.kind === "support") { if (lastClose < lower * 0.97) continue; dp = lastClose >= upper ? ((lastClose - upper) / lastClose) * 100 : 0; if (dp > 40) continue; }
    else { if (lastClose > upper * 1.03) continue; dp = lastClose <= lower ? ((lower - lastClose) / lastClose) * 100 : 0; if (dp > 40) continue; }
    candidates.push({ kind: pivot.kind, lower, upper, touches: members.length, distancePct: dp, score: Math.min(members.length / 5, 1) * 40 + Math.max(0, 1 - dp / 40) * 34 + Math.min(sw / 80, 1) * 16 + Math.max(0, 1 - zwp / maxZ) * 10, label: `${pivot.kind === "support" ? "Macro support" : "Macro resistance"} (${members.length} touches)` });
  }
  const bs = candidates.filter(c => c.kind === "support").sort((a, b) => b.score - a.score || a.distancePct - b.distancePct)[0];
  const br = candidates.filter(c => c.kind === "resistance").sort((a, b) => b.score - a.score || a.distancePct - b.distancePct)[0];
  return [bs, br].filter(Boolean) as SupportResistanceZone[];
}

function divStateForIndicator(div: ReturnType<typeof detectDivergenceFromHistory> | null, which: "rsi" | "macd"): DivergenceState {
  if (!div) return "none"; if (which === "rsi" && !div.hasRsi) return "none"; if (which === "macd" && !div.hasMacd) return "none"; return div.kind;
}
function divergenceLabel(state: DivergenceState) { return state === "bullish" ? "Bullish" : state === "bearish" ? "Bearish" : "—"; }
function divergenceTone(state: DivergenceState): OverviewItem["tone"] { return state === "bullish" ? "green" : state === "bearish" ? "red" : "muted"; }
function toneToColor(tone: OverviewItem["tone"], isDark: boolean) {
  if (tone === "green") return isDark ? "#22c55e" : "#16a34a"; if (tone === "yellow") return isDark ? "#eab308" : "#ca8a04";
  if (tone === "orange") return isDark ? "#fb923c" : "#ea580c"; if (tone === "red") return isDark ? "#ef4444" : "#dc2626";
  return isDark ? "rgba(241,245,249,0.45)" : "rgba(11,18,32,0.45)";
}
function toneRank(t: OverviewItem["tone"]) { if (t === "red") return 4; if (t === "orange") return 3; if (t === "yellow") return 2; if (t === "green") return 1; return 0; }
function renderFlagsMeter(opts: { flagged: number; total: number; color: string; isDark: boolean }) {
  const { flagged, total, color, isDark } = opts;
  const st = Math.max(1, Math.min(20, Math.floor(total))), sf = Math.max(0, Math.min(st, Math.floor(flagged)));
  return (<div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}><div style={{ display: "flex", gap: 6 }}>{Array.from({ length: st }).map((_, i) => <span key={i} style={{ width: 14, height: 6, borderRadius: 999, background: i < sf ? color : isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)", border: isDark ? "1px solid rgba(255,255,255,0.14)" : "1px solid rgba(0,0,0,0.10)" }} />)}</div><div style={{ fontSize: 12, opacity: 0.75, fontWeight: 800 }}>{sf}/{st}</div></div>);
}
function compositeToneFromCounts(ob: number, os: number, sp: number) {
  const net = ob - os, intensity = ob + os + sp;
  if (intensity <= 1) return { tone: "yellow" as const, tag: "Calm" }; if (net >= 2) return { tone: intensity >= 5 ? "red" as const : "orange" as const, tag: "Overbought-leaning" };
  if (net === 1) return { tone: "orange" as const, tag: "Slightly overbought" }; if (net <= -2) return { tone: intensity >= 5 ? "green" as const : "yellow" as const, tag: "Oversold-leaning" };
  if (net === -1) return { tone: "yellow" as const, tag: "Slightly oversold" }; return { tone: intensity >= 5 ? "orange" as const : "yellow" as const, tag: "Mixed" };
}
function trendToneFromScore(ts: TrendScore | null): OverviewItem["tone"] {
  if (!ts) return "muted"; const r = ts.total > 0 ? ts.passed / ts.total : 0;
  if (r >= 0.75) return "green"; if (r >= 0.5) return "yellow"; if (r >= 0.25) return "orange"; return "red";
}
function formatPctFromBase(last: number | null, base: number | null) {
  if (typeof last !== "number" || typeof base !== "number" || !Number.isFinite(last) || !Number.isFinite(base) || base === 0) return null;
  return ((last - base) / base) * 100;
}
function buildTrendScore(a: { lastClose: number | null; ma50: number | null; ma200: number | null; macdHist: number | null }): TrendScore {
  const { lastClose, ma50, ma200, macdHist } = a;
  const checks = [{ name: "Price > MA200", ok: typeof lastClose === "number" && typeof ma200 === "number" ? lastClose > ma200 : null }, { name: "Price > MA50", ok: typeof lastClose === "number" && typeof ma50 === "number" ? lastClose > ma50 : null }, { name: "MA50 > MA200", ok: typeof ma50 === "number" && typeof ma200 === "number" ? ma50 > ma200 : null }, { name: "MACD hist > 0", ok: typeof macdHist === "number" ? macdHist > 0 : null }];
  return { total: 4, passed: checks.reduce((acc, c) => acc + (c.ok === true ? 1 : 0), 0), details: checks };
}
function buildStretchScore(a: { lastClose: number | null; rsi14: number | null; stochK: number | null; bollUpper: number | null; bollLower: number | null; ema20: number | null; vwap: number | null; ma50: number | null }): StretchScore {
  const { lastClose, rsi14, stochK, bollUpper, bollLower, ema20, vwap, ma50 } = a;
  const details: StretchScore["details"] = []; let os = 0, ob = 0;
  const checkRange = (val: number | null, lo: number, hi: number, name: string) => { if (typeof val === "number") { if (val <= lo) { os++; details.push({ name, state: "oversold" }); } else if (val >= hi) { ob++; details.push({ name, state: "overbought" }); } else details.push({ name, state: "neutral" }); } else details.push({ name, state: "na" }); };
  checkRange(rsi14, 30, 70, "RSI"); checkRange(stochK, 20, 80, "Stoch");
  if (typeof lastClose === "number" && typeof bollLower === "number" && typeof bollUpper === "number") { if (lastClose < bollLower) { os++; details.push({ name: "Bollinger", state: "oversold" }); } else if (lastClose > bollUpper) { ob++; details.push({ name: "Bollinger", state: "overbought" }); } else details.push({ name: "Bollinger", state: "neutral" }); } else details.push({ name: "Bollinger", state: "na" });
  const checkPct = (val: number | null, ref: number | null, thresh: number, name: string) => { if (typeof lastClose === "number" && typeof val === "number" && typeof ref === "number" && ref > 0) { const p = (lastClose - ref) / ref; if (p <= -thresh) { os++; details.push({ name, state: "oversold" }); } else if (p >= thresh) { ob++; details.push({ name, state: "overbought" }); } else details.push({ name, state: "neutral" }); } else details.push({ name, state: "na" }); };
  checkPct(vwap, vwap, 0.02, "VWMA dist"); checkPct(ema20, ema20, 0.05, "EMA20 dist"); checkPct(ma50, ma50, 0.05, "MA50 dist");
  return { total: 6, flagged: os + ob, oversold: os, overbought: ob, details };
}

const PRESET_TICKERS: { symbol: string; name: string }[] = [
  { symbol: "AAPL", name: "Apple Inc." }, { symbol: "ABBV", name: "AbbVie Inc." }, { symbol: "ABT", name: "Abbott Laboratories" }, { symbol: "ADBE", name: "Adobe Inc." }, { symbol: "AMZN", name: "Amazon.com Inc." }, { symbol: "AVGO", name: "Broadcom Inc." }, { symbol: "BAC", name: "Bank of America" }, { symbol: "BRK.B", name: "Berkshire Hathaway B" }, { symbol: "COST", name: "Costco Wholesale" }, { symbol: "CRM", name: "Salesforce Inc." }, { symbol: "CSCO", name: "Cisco Systems" }, { symbol: "CVX", name: "Chevron Corp." }, { symbol: "DIS", name: "Walt Disney Co." }, { symbol: "GOOGL", name: "Alphabet Inc. Class A" }, { symbol: "HD", name: "Home Depot" }, { symbol: "INTC", name: "Intel Corp." }, { symbol: "JNJ", name: "Johnson & Johnson" }, { symbol: "JPM", name: "JPMorgan Chase" }, { symbol: "KO", name: "Coca-Cola Co." }, { symbol: "LLY", name: "Eli Lilly & Co." }, { symbol: "MA", name: "Mastercard Inc." }, { symbol: "MCD", name: "McDonald's Corp." }, { symbol: "META", name: "Meta Platforms" }, { symbol: "MRK", name: "Merck & Co." }, { symbol: "MSFT", name: "Microsoft Corp." }, { symbol: "NFLX", name: "Netflix Inc." }, { symbol: "NVDA", name: "NVIDIA Corp." }, { symbol: "ORCL", name: "Oracle Corp." }, { symbol: "PEP", name: "PepsiCo Inc." }, { symbol: "PG", name: "Procter & Gamble" }, { symbol: "PYPL", name: "PayPal Holdings" }, { symbol: "QCOM", name: "Qualcomm Inc." }, { symbol: "SBUX", name: "Starbucks Corp." }, { symbol: "T", name: "AT&T Inc." }, { symbol: "TGT", name: "Target Corp." }, { symbol: "TSLA", name: "Tesla Inc." }, { symbol: "TXN", name: "Texas Instruments" }, { symbol: "UNH", name: "UnitedHealth Group" }, { symbol: "V", name: "Visa Inc." }, { symbol: "VZ", name: "Verizon Communications" }, { symbol: "WFC", name: "Wells Fargo" }, { symbol: "WMT", name: "Walmart Inc." }, { symbol: "XOM", name: "Exxon Mobil Corp." },
].sort((a, b) => a.symbol.localeCompare(b.symbol));

const CRYPTO_PRESETS: { symbol: string; name: string }[] = [
  { symbol: "BTCUSD", name: "Bitcoin" },
  { symbol: "ETHUSD", name: "Ethereum" },
  { symbol: "SOLUSD", name: "Solana" },
  { symbol: "TRXUSD", name: "TRON" },
];

const DEFAULT_CRYPTO_SYMBOL = "BTCUSD";

const TIMEFRAMES = [{ label: "D", interval: "d" as ChartInterval, fetchBars: 2600, defaultVisibleBars: 75 }, { label: "W", interval: "w" as ChartInterval, fetchBars: 2600, defaultVisibleBars: 75 }, { label: "M", interval: "m" as ChartInterval, fetchBars: 360, defaultVisibleBars: 75 }];
const PRICE_OVERLAY_OPTIONS: Overlay[] = ["MA50", "MA200", "EMA20", "VWMA(20)", "Bollinger(20,2)", "Support/Resistance"];
const LOWER_OVERLAY_OPTIONS: Overlay[] = ["RSI(14)", "MACD(12,26,9)", "Stochastic(14,3)", "ATR(14)", "Volume"];
const ALL_OVERLAY_OPTIONS: string[] = [...PRICE_OVERLAY_OPTIONS, ...LOWER_OVERLAY_OPTIONS];
function isLowerOverlay(v: Overlay) { return LOWER_OVERLAY_OPTIONS.includes(v); }
function fmtPrice(v: number) { return `$${v.toFixed(v >= 100 ? 0 : 2)}`; }

type ChartFocus = { kind: "ath" | "rangeHigh"; price: number; date: string; label: string };

// Finds the offset (bars back from "now") that puts the bar nearest `iso`
// at the left edge of the visible window (plus a small left margin), so a
// deep-linked reference price/date (e.g. an all-time high) is guaranteed
// visible without the user needing to manually zoom/pan.
function computeFocusWindow(historyAll: Point[], iso: string, leftMargin = 15) {
  if (!iso || !historyAll.length) return null;
  const idx = historyAll.findIndex(p => p.date >= iso);
  const anchor = idx >= 0 ? idx : 0;
  const desiredStart = Math.max(0, anchor - leftMargin);
  const bars = historyAll.length - desiredStart;
  return { visibleBars: Math.min(historyAll.length, Math.max(bars, 30)), windowOffset: 0 };
}

export default function DashboardClient({ defaultSymbol = "SPY" }: { defaultSymbol?: string }) {
  const router = useRouter(), searchParams = useSearchParams();
  const [assetType, setAssetType] = useState<AssetType>("stock");
  const [symbol, setSymbol] = useState(() => { if (typeof window === "undefined") return defaultSymbol; const s = window.localStorage.getItem("msh_last_symbol"); return s && s.trim() ? s.trim().toUpperCase() : defaultSymbol; });
  const [lastStockSymbol, setLastStockSymbol] = useState(() => { if (typeof window === "undefined") return defaultSymbol; const s = window.localStorage.getItem("msh_last_symbol"); return s && s.trim() ? s.trim().toUpperCase() : defaultSymbol; });
  const [symbolName, setSymbolName] = useState("");
  const [activeTimeframe, setActiveTimeframe] = useState("D");
  const [visibleBars, setVisibleBars] = useState(75);
  const [windowOffset, setWindowOffset] = useState(0);
  const [chartInterval, setChartInterval] = useState<ChartInterval>("d");
  const [indicator, setIndicator] = useState<Overlay>("None");
  const [selectedIndicators, setSelectedIndicators] = useState<Overlay[]>([]);
  const [chartType, setChartType] = useState<ChartType>("candles");
  const [indicatorMenuOpen, setIndicatorMenuOpen] = useState(false);
  const indicatorMenuRef = useRef<HTMLDivElement | null>(null);
  const chartSectionRef = useRef<HTMLDivElement | null>(null);
  const [highlightChart, setHighlightChart] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [historyAll, setHistoryAll] = useState<Point[]>([]);
  const [symbolCache, setSymbolCache] = useState<Record<string, CachedSymbolData>>({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState(symbol);
  const [results, setResults] = useState<SymbolResult[]>([]);
  const [open, setOpen] = useState(false);
  const [bench, setBench] = useState<BenchPayload | null>(null);
  const [news, setNews] = useState<NewsPayload | null>(null);
  const [earningsSummary, setEarningsSummary] = useState<StockEarningsSummary | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [externalZone, setExternalZone] = useState<SupportResistanceZone | null>(null);
  const [chartFocus, setChartFocus] = useState<ChartFocus | null>(null);
  // Lifted from PriceChart so this component can hide its own redundant
  // D/W/M, indicator dropdown, Line/Candles, and toolbar controls (and give
  // the chart more vertical room) whenever TradingView mode is active.
  const [showTradingView, setShowTradingView] = useState(false);
  const theme = "dark" as const;
  const selectedTimeframe = useMemo(() => TIMEFRAMES.find(t => t.label === activeTimeframe) ?? TIMEFRAMES[0], [activeTimeframe]);
  const COLORS = useMemo(() => ({ isDark: true, pageBg: "#0a0f1a", pageFg: "#eaf0fa", mutedFg: "#8a97ad", mutedFg2: "#5f6b80", cardBg: "#141b2b", cardFg: "#eaf0fa", cardBg2: "#0f1624", border: "#222c40", borderSoft: "#1a2336", controlBg: "#0f1624", controlBgSolid: "#0f1624", controlBorder: "#222c40", controlFg: "#eaf0fa", blue: "#2f6bff", blueSoft: "#13213f", blueBorder: "#27406f", green: "#16c784", greenSoft: "#0f2a23", greenBorder: "#1c4a3c", amber: "#f5a524", amberSoft: "#2c2310", amberBorder: "#3a2f10", red: "#f04444", yellowBorder: "rgba(234,179,8,0.38)", yellowBg: "rgba(234,179,8,0.10)", yellowText: "#fde68a" }), []);

  useEffect(() => { const r = () => setIsMobile(window.innerWidth <= 768); r(); window.addEventListener("resize", r); return () => window.removeEventListener("resize", r); }, []);
  useEffect(() => { if (symbolName.trim()) return; const list = assetType === "crypto" ? CRYPTO_PRESETS : PRESET_TICKERS; const f = list.find(x => x.symbol.toUpperCase() === symbol.toUpperCase()); if (f?.name) setSymbolName(f.name); }, [symbol, symbolName, assetType]);
  useEffect(() => { setChartInterval(selectedTimeframe.interval); setVisibleBars(selectedTimeframe.defaultVisibleBars); setWindowOffset(0); }, [symbol, selectedTimeframe]);
  useEffect(() => {
    const us = searchParams.get("symbol"); const cleaned = us ? us.trim().toUpperCase() : ""; if (!cleaned) return;
    const tf = (searchParams.get("tf") || "").trim().toUpperCase();
    const indi = (searchParams.get("indicator") || "").trim();
    const indicatorsRaw = (searchParams.get("indicators") || "").trim();
    setSymbol(cleaned); setQuery(cleaned); setResults([]); setOpen(false);
    setActiveTimeframe(tf === "D" || tf === "W" || tf === "M" ? tf : "D");

    // Deep-link support/resistance zone (from the /pickers Macro Support /
    // Resistance category) -- an externally-supplied zone rather than the
    // locally-computed one, merged in below.
    const srLower = Number(searchParams.get("srLower"));
    const srUpper = Number(searchParams.get("srUpper"));
    const srKind = searchParams.get("srKind");
    const hasExternalZone = Number.isFinite(srLower) && Number.isFinite(srUpper) && (srKind === "support" || srKind === "resistance");
    setExternalZone(hasExternalZone ? { kind: srKind as "support" | "resistance", lower: Math.min(srLower, srUpper), upper: Math.max(srLower, srUpper), label: srKind === "support" ? "Macro support" : "Macro resistance" } : null);

    // Deep-link reference line + auto-zoom (ATH breakout / down-20%-from-ATH
    // / 3-month-high breakout picks from /pickers).
    const athPrice = Number(searchParams.get("athPrice"));
    const rangeHighPrice = Number(searchParams.get("rangeHighPrice"));
    if (Number.isFinite(athPrice) && athPrice > 0) {
      const date = (searchParams.get("athDate") || "").trim();
      setChartFocus({ kind: "ath", price: athPrice, date, label: `All-time high ${fmtPrice(athPrice)}` });
    } else if (Number.isFinite(rangeHighPrice) && rangeHighPrice > 0) {
      const date = (searchParams.get("rangeHighDate") || "").trim();
      setChartFocus({ kind: "rangeHigh", price: rangeHighPrice, date, label: `3-month high ${fmtPrice(rangeHighPrice)}` });
    } else {
      setChartFocus(null);
    }

    // Indicator selection: `indicators` (comma-separated) wins for
    // multi-select deep links (e.g. Best Trend Score -> MA50,MA200);
    // otherwise fall back to the single `indicator` param. Any value from
    // the chart's own supported overlay/oscillator lists is accepted, not
    // just the original 3 hardcoded ones.
    const requested = indicatorsRaw
      ? indicatorsRaw.split(",").map(s => s.trim()).filter(Boolean)
      : indi
        ? [indi]
        : [];
    const valid = requested.filter(v => ALL_OVERLAY_OPTIONS.includes(v)) as Overlay[];
    if (hasExternalZone && !valid.includes("Support/Resistance")) valid.push("Support/Resistance");
    if (valid.length) {
      setSelectedIndicators(valid);
      const preferredLower = valid.find(isLowerOverlay);
      setIndicator(preferredLower ?? valid[0]);
    } else {
      setSelectedIndicators([]); setIndicator("None");
    }

    setIndicatorMenuOpen(false);
    if (!Number.isFinite(athPrice) && !Number.isFinite(rangeHighPrice)) setWindowOffset(0);
  }, [searchParams]);
  useEffect(() => {
    if (!chartFocus?.date) return;
    const win = computeFocusWindow(historyAll, chartFocus.date);
    if (!win) return;
    setVisibleBars(win.visibleBars);
    setWindowOffset(win.windowOffset);
  }, [chartFocus, historyAll]);
  useEffect(() => { if (!symbol.trim()) return; if (assetType === "stock") { window.localStorage.setItem("msh_last_symbol", symbol.trim().toUpperCase()); setLastStockSymbol(symbol.trim().toUpperCase()); } }, [symbol, assetType]);
  useEffect(() => { if (!expanded) return; const k = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(false); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [expanded]);
  useEffect(() => { function h(e: MouseEvent) { if (!indicatorMenuRef.current) return; if (!indicatorMenuRef.current.contains(e.target as Node)) setIndicatorMenuOpen(false); } document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  useEffect(() => {
    if (assetType === "crypto") { const p = CRYPTO_PRESETS.find(t => t.symbol === symbol); if (p) setSymbolName(p.name); return; }
    const p = PRESET_TICKERS.find(t => t.symbol === symbol); if (p) { setSymbolName(p.name); return; }
    let c = false;
    async function r() { try { const res = await fetch(`/api/symbols?q=${encodeURIComponent(symbol)}`); if (!res.ok) throw new Error(""); const d = (await res.json()) as { results?: SymbolResult[] }; const rows = Array.isArray(d.results) ? d.results : []; const ex = rows.find(r => (r.symbol ?? "").toUpperCase() === symbol.toUpperCase()); if (!c && ex?.name) setSymbolName(ex.name); } catch { } }
    r(); return () => { c = true; };
  }, [symbol, assetType]);
  useEffect(() => {
    let c = false;
    async function load() {
      const ck = `${symbol}:${activeTimeframe}:${selectedTimeframe.fetchBars}:${selectedTimeframe.interval}`; const hit = symbolCache[ck];
      if (hit) { setErr(null); setQuote(hit.quote); setHistoryAll(hit.history); setLoading(false); return; }
      setLoading(true); setErr(null);
      try {
        const [qR, hR] = await Promise.all([fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`), fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&days=${selectedTimeframe.fetchBars}&interval=${chartInterval}`)]);
        if (!qR.ok) throw new Error("q"); if (!hR.ok) throw new Error("h");
        const q = (await qR.json()) as Quote, h = (await hR.json()) as { points: any[] }; if (c) return;
        const pts: Point[] = (Array.isArray(h.points) ? h.points : []).map((p: any) => ({ date: String(p?.date ?? ""), open: p?.open == null ? undefined : Number(p.open), close: Number(p?.close), high: p?.high == null ? undefined : Number(p.high), low: p?.low == null ? undefined : Number(p.low), volume: p?.volume == null ? undefined : Number(p.volume) })).filter(p => p.date && Number.isFinite(p.close));
        setQuote(q); setHistoryAll(pts); setSymbolCache(prev => ({ ...prev, [ck]: { quote: q, history: pts } }));
      } catch { if (c) return; setErr("Failed to load data (try another ticker)."); setQuote(null); setHistoryAll([]); }
      finally { if (!c) setLoading(false); }
    }
    load(); return () => { c = true; };
  }, [symbol, activeTimeframe, selectedTimeframe, chartInterval, symbolCache]);
  useEffect(() => {
    let c = false; const q = query.trim(); if (!q) { setResults([]); return; }
    const t = setTimeout(async () => { try { const typeParam = assetType === "crypto" ? "&type=crypto" : ""; const r = await fetch(`/api/symbols?q=${encodeURIComponent(q)}${typeParam}`); const d = (await r.json()) as { results: SymbolResult[] }; if (c) return; const rows = Array.isArray(d.results) ? d.results : []; const cu = q.toUpperCase(); setResults([...rows].sort((a, b) => { const aS = a.symbol.toUpperCase(), bS = b.symbol.toUpperCase(); if (aS === cu && bS !== cu) return -1; if (bS === cu && aS !== cu) return 1; if (aS.startsWith(cu) && !bS.startsWith(cu)) return -1; if (bS.startsWith(cu) && !aS.startsWith(cu)) return 1; return aS.localeCompare(bS); })); } catch { if (c) return; setResults([]); } }, 250);
    return () => { c = true; clearTimeout(t); };
  }, [query, assetType]);
  useEffect(() => { let c = false; async function lb() { try { const scope = assetType === "crypto" ? "crypto" : "stock"; const r = await fetch(`/api/benchmarks?scope=${scope}`); if (!r.ok) throw new Error(""); const raw = (await r.json()) as any; if (!c) setBench({ updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(), scope: typeof raw?.scope === "string" ? raw.scope : "Benchmarks", items: Array.isArray(raw?.items) ? raw.items : [] }); } catch { if (!c) setBench({ updatedAt: new Date().toISOString(), scope: "Benchmarks", items: [] }); } } lb(); return () => { c = true; }; }, [assetType]);
  useEffect(() => { const h = typeof window !== "undefined" ? window.location.hash : ""; if (h !== "#chart" || !historyAll.length) return; const t = window.setTimeout(() => { chartSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); setHighlightChart(true); setTimeout(() => setHighlightChart(false), 1200); }, 80); return () => window.clearTimeout(t); }, [historyAll, symbol]);
  useEffect(() => { if (assetType === "crypto") { setNews(null); return; } let c = false; async function ln() { try { const r = await fetch(`/api/internal-news?symbol=${encodeURIComponent(symbol)}`); if (!r.ok) throw new Error(""); if (!c) setNews((await r.json()) as NewsPayload); } catch { if (!c) setNews(null); } } ln(); return () => { c = true; }; }, [symbol, assetType]);
  useEffect(() => { if (assetType === "crypto") { setEarningsSummary(null); return; } let c = false; async function le() { setEarningsSummary(null); try { const r = await fetch(`/api/stock-earnings/${encodeURIComponent(symbol)}`, { cache: "no-store" }); if (!r.ok) throw new Error(""); if (!c) setEarningsSummary((await r.json()) as StockEarningsSummary); } catch { if (!c) setEarningsSummary(null); } } le(); return () => { c = true; }; }, [symbol, assetType]);

  const totalPoints = historyAll.length, win = Math.max(visibleBars, 2), maxOffset = Math.max(totalPoints - win, 0), offset = Math.min(Math.max(windowOffset, 0), maxOffset);
  const { displayStart, displayEnd, displayedHistory } = useMemo(() => { if (!historyAll.length) return { displayStart: 0, displayEnd: 0, displayedHistory: [] as Point[] }; const end = totalPoints - offset, start = Math.max(0, end - win); const slice = historyAll.slice(start, end); if (slice.length >= 2) return { displayStart: start, displayEnd: end, displayedHistory: slice }; return { displayStart: Math.max(totalPoints - 2, 0), displayEnd: totalPoints, displayedHistory: historyAll.slice(-2) }; }, [historyAll, totalPoints, offset, win]);

  const closesAll = useMemo(() => historyAll.map(p => p.close), [historyAll]);
  const ma50Full = useMemo(() => movingAverage(closesAll, 50), [closesAll]);
  const ma200Full = useMemo(() => movingAverage(closesAll, 200), [closesAll]);
  const ema20Full = useMemo(() => ema(closesAll, 20), [closesAll]);
  const bbFull = useMemo(() => bollinger(closesAll, 20, 2), [closesAll]);
  const rsi14Full = useMemo(() => rsiWilder(closesAll, 14), [closesAll]);
  const macdFull = useMemo(() => macd(closesAll, 12, 26, 9), [closesAll]);
  const vwma20Full = useMemo(() => vwma(historyAll.map(p => p.close), historyAll.map(p => p.volume), 20), [historyAll]);
  const stochFull = useMemo(() => stochastic(historyAll, 14, 3), [historyAll]);
  const atr14Full = useMemo(() => atr(historyAll, 14), [historyAll]);
  const ma50 = useMemo(() => ma50Full.slice(displayStart, displayEnd), [ma50Full, displayStart, displayEnd]);
  const ma200 = useMemo(() => ma200Full.slice(displayStart, displayEnd), [ma200Full, displayStart, displayEnd]);
  const ema20Arr = useMemo(() => ema20Full.slice(displayStart, displayEnd), [ema20Full, displayStart, displayEnd]);
  const bollUpper = useMemo(() => bbFull.upper.slice(displayStart, displayEnd), [bbFull, displayStart, displayEnd]);
  const bollMid = useMemo(() => bbFull.mid.slice(displayStart, displayEnd), [bbFull, displayStart, displayEnd]);
  const bollLower = useMemo(() => bbFull.lower.slice(displayStart, displayEnd), [bbFull, displayStart, displayEnd]);
  const rsi14Arr = useMemo(() => rsi14Full.slice(displayStart, displayEnd), [rsi14Full, displayStart, displayEnd]);
  const macdLine = useMemo(() => macdFull.line.slice(displayStart, displayEnd), [macdFull, displayStart, displayEnd]);
  const macdSignal = useMemo(() => macdFull.signal.slice(displayStart, displayEnd), [macdFull, displayStart, displayEnd]);
  const macdHist = useMemo(() => macdFull.hist.slice(displayStart, displayEnd), [macdFull, displayStart, displayEnd]);
  const vwma20Arr = useMemo(() => vwma20Full.slice(displayStart, displayEnd), [vwma20Full, displayStart, displayEnd]);
  const stochK = useMemo(() => stochFull.k.slice(displayStart, displayEnd), [stochFull, displayStart, displayEnd]);
  const stochD = useMemo(() => stochFull.d.slice(displayStart, displayEnd), [stochFull, displayStart, displayEnd]);
  const atr14Arr = useMemo(() => atr14Full.slice(displayStart, displayEnd), [atr14Full, displayStart, displayEnd]);
  const volumeFull = useMemo(() => historyAll.map(p => typeof p.volume === "number" && Number.isFinite(p.volume) ? p.volume : null), [historyAll]);
  const volSma20Full = useMemo(() => smaNullable(volumeFull, 20), [volumeFull]);
  const volumeArr = useMemo(() => volumeFull.slice(displayStart, displayEnd), [volumeFull, displayStart, displayEnd]);
  const volSma20Arr = useMemo(() => volSma20Full.slice(displayStart, displayEnd), [volSma20Full, displayStart, displayEnd]);
  const atrSma20Full = useMemo(() => smaNullable(atr14Full, 20), [atr14Full]);
  const atrSma20Arr = useMemo(() => atrSma20Full.slice(displayStart, displayEnd), [atrSma20Full, displayStart, displayEnd]);

  const lastClose = displayedHistory.length ? displayedHistory[displayedHistory.length - 1].close : null;
  const localSupportResistanceZones = useMemo(() => computeMacroSupportResistanceZones(historyAll, lastClose), [historyAll, lastClose]);
  const supportResistanceZones = useMemo(() => {
    if (!externalZone) return localSupportResistanceZones;
    // Deep-linked zone (the exact zone that qualified this symbol for the
    // Macro Support/Resistance picker category) takes priority -- drop any
    // locally-computed zone of the same kind so they don't visually clash.
    const rest = localSupportResistanceZones.filter(z => z.kind !== externalZone.kind);
    return [externalZone, ...rest];
  }, [localSupportResistanceZones, externalZone]);
  const referenceLines = useMemo(() => (chartFocus ? [{ price: chartFocus.price, label: chartFocus.label }] : []), [chartFocus]);
  const lastMA50 = lastNum(ma50), lastMA200 = lastNum(ma200);
  const ma50Pct = formatPctFromBase(lastClose, typeof lastMA50 === "number" ? lastMA50 : null);
  const ma200Pct = formatPctFromBase(lastClose, typeof lastMA200 === "number" ? lastMA200 : null);
  const ema20Pct = formatPctFromBase(lastClose, lastNum(ema20Arr));
  const vwma20Pct = formatPctFromBase(lastClose, lastNum(vwma20Arr));
  const bbUpperLast = lastNum(bollUpper), bbLowerLast = lastNum(bollLower), rsiLast = lastNum(rsi14Arr), stochLast = lastNum(stochK), macdHistLast = lastNum(macdHist), atrLast = lastNum(atr14Arr), atrSmaLast = lastNum(atrSma20Arr), volumeLast = lastNum(volumeArr), volumeSmaLast = lastNum(volSma20Arr);
  const trendScore = useMemo(() => buildTrendScore({ lastClose, ma50: typeof lastMA50 === "number" ? lastMA50 : null, ma200: typeof lastMA200 === "number" ? lastMA200 : null, macdHist: lastNum(macdHist) }), [lastClose, lastMA50, lastMA200, macdHist]);
  const stretchScore = useMemo(() => buildStretchScore({ lastClose, rsi14: lastNum(rsi14Arr), stochK: lastNum(stochK), bollUpper: lastNum(bollUpper), bollLower: lastNum(bollLower), ema20: lastNum(ema20Arr), vwap: lastNum(vwma20Arr), ma50: typeof lastMA50 === "number" ? lastMA50 : null }), [lastClose, rsi14Arr, stochK, bollUpper, bollLower, ema20Arr, vwma20Arr, lastMA50]);
  const divergence = useMemo(() => { const div = detectDivergenceFromHistory(historyAll, { lookbackBars: 60, leftRight: 2, minPriceSwingPct: 1.2, minRsiSwing: 4, macdStdMult: 0.35 }); return { div, rsi: divStateForIndicator(div, "rsi"), macd: divStateForIndicator(div, "macd") }; }, [historyAll]);
  const overviewMeta = useMemo(() => {
    const ti = compositeToneFromCounts(stretchScore.overbought, stretchScore.oversold, 0), tc = toneToColor(ti.tone, true);
    let trend = "Range / Mixed";
    if (typeof lastClose === "number" && typeof lastMA50 === "number" && typeof lastMA200 === "number") { if (lastClose > lastMA50 && lastMA50 > lastMA200) trend = "Uptrend"; else if (lastClose < lastMA50 && lastMA50 < lastMA200) trend = "Downtrend"; }
    const av = lastNum(atr14Arr), as_ = lastNum(atrSma20Arr); let vol = "Normal";
    if (typeof av === "number" && typeof as_ === "number" && as_ > 0) { const r = av / as_; if (r >= 1.5) vol = "Elevated"; else if (r <= 0.85) vol = "Quiet"; }
    return { toneColor: tc, toneTag: ti.tag, trend, vol };
  }, [stretchScore, lastClose, lastMA50, lastMA200, atr14Arr, atrSma20Arr]);

  const customMode = selectedIndicators.length > 0;
  function chartIndicatorLabel(v: Overlay[]) { return !v.length ? "Overview" : v.join(", "); }
  function chooseSymbol(s: string, name?: string, nextAssetType?: AssetType) { const c = s.trim().toUpperCase(); if (!c) return; if (nextAssetType) setAssetType(nextAssetType); setSymbol(c); setSymbolName(name?.trim() ? name.trim() : ""); setQuery(c); setResults([]); setOpen(false); setActiveTimeframe("D"); setSelectedIndicators([]); setIndicator("None"); setWindowOffset(0); }
  function switchAssetType(next: AssetType) {
    if (next === assetType) return;
    if (next === "crypto") { chooseSymbol(DEFAULT_CRYPTO_SYMBOL, CRYPTO_PRESETS[0]?.name, "crypto"); return; }
    chooseSymbol(lastStockSymbol || defaultSymbol, undefined, "stock");
  }
  function clearIndicatorSelection() { setSelectedIndicators([]); setIndicator("None"); setWindowOffset(0); setIndicatorMenuOpen(false); }
  function getNextFocusedIndicator(v: Overlay[]) { const al = v.find(x => isLowerOverlay(x)); if (al) return al; if (v.length) return v[v.length - 1]; return "None" as Overlay; }
  function toggleIndicatorSelection(next: Overlay) {
    if (next === "None") { clearIndicatorSelection(); return; }
    setSelectedIndicators(prev => { const on = prev.includes(next); let nv: Overlay[]; if (isLowerOverlay(next)) { nv = on ? prev.filter(v => v !== next) : [...prev.filter(v => !isLowerOverlay(v)), next]; } else { nv = on ? prev.filter(v => v !== next) : [...prev, next]; } setIndicator(getNextFocusedIndicator(nv)); return nv; });
    setWindowOffset(0);
  }
  const chartIndicatorName = chartIndicatorLabel(selectedIndicators);

  const chartSummaryText = useMemo(() => {
    if (!customMode) {
      let tt = "mixed structure";
      if (typeof lastClose === "number" && typeof lastMA50 === "number" && typeof lastMA200 === "number") { if (lastClose > lastMA50 && lastMA50 > lastMA200) tt = "stronger bullish structure"; else if (lastClose < lastMA50 && lastMA50 < lastMA200) tt = "weaker bearish structure"; else if (lastClose > lastMA50) tt = "mildly constructive structure"; else if (lastClose < lastMA50) tt = "softer short-term structure"; }
      let st = "limited stretch signals"; if (stretchScore.overbought >= 3) st = "several overbought-style stretch signals"; else if (stretchScore.oversold >= 3) st = "several oversold-style stretch signals"; else if (stretchScore.flagged >= 2) st = "some mixed stretch signals";
      let mt = ""; if (typeof rsiLast === "number") { if (rsiLast >= 70) mt = ` RSI is ${rsiLast.toFixed(1)} and overbought.`; else if (rsiLast <= 30) mt = ` RSI is ${rsiLast.toFixed(1)} and oversold.`; else mt = ` RSI is ${rsiLast.toFixed(1)} and neutral.`; }
      let dt = ""; if (divergence.rsi === "bullish" || divergence.macd === "bullish") dt = " Bullish divergence is present."; else if (divergence.rsi === "bearish" || divergence.macd === "bearish") dt = " Bearish divergence is present.";
      return `${symbol} is showing ${tt} with ${st}.${mt}${dt}`;
    }
    const parts: string[] = [];
    selectedIndicators.forEach(ind => {
      if (ind === "MA50") parts.push(ma50Pct == null ? "MA50 needs more data." : `Price is ${ma50Pct >= 0 ? `${ma50Pct.toFixed(1)}% above` : `${Math.abs(ma50Pct).toFixed(1)}% below`} MA50.`);
      if (ind === "MA200") parts.push(ma200Pct == null ? "MA200 needs more data." : `Price is ${ma200Pct >= 0 ? `${ma200Pct.toFixed(1)}% above` : `${Math.abs(ma200Pct).toFixed(1)}% below`} MA200.`);
      if (ind === "EMA20") parts.push(ema20Pct == null ? "EMA20 needs more data." : `Price is ${ema20Pct >= 0 ? `${ema20Pct.toFixed(1)}% above` : `${Math.abs(ema20Pct).toFixed(1)}% below`} EMA20.`);
      if (ind === "VWMA(20)") parts.push(vwma20Pct == null ? "VWMA(20) needs more data." : `Price is ${vwma20Pct >= 0 ? `${vwma20Pct.toFixed(1)}% above` : `${Math.abs(vwma20Pct).toFixed(1)}% below`} VWMA(20).`);
      if (ind === "Bollinger(20,2)") { if (typeof lastClose === "number" && typeof bbUpperLast === "number" && typeof bbLowerLast === "number") { if (lastClose > bbUpperLast) parts.push("Price is above the upper Bollinger Band."); else if (lastClose < bbLowerLast) parts.push("Price is below the lower Bollinger Band."); else parts.push("Price is trading inside the Bollinger Bands."); } else parts.push("Bollinger Bands need more data."); }
      if (ind === "RSI(14)") { if (typeof rsiLast === "number") { if (rsiLast >= 70) parts.push(`RSI is ${rsiLast.toFixed(1)} and overbought.`); else if (rsiLast <= 30) parts.push(`RSI is ${rsiLast.toFixed(1)} and oversold.`); else parts.push(`RSI is ${rsiLast.toFixed(1)} and neutral.`); } else parts.push("RSI needs more data."); }
      if (ind === "MACD(12,26,9)") { if (typeof macdHistLast === "number") { if (macdHistLast > 0) parts.push("MACD momentum is bullish."); else if (macdHistLast < 0) parts.push("MACD momentum is bearish."); else parts.push("MACD momentum is flat."); } else parts.push("MACD needs more data."); }
      if (ind === "Stochastic(14,3)") { if (typeof stochLast === "number") { if (stochLast >= 80) parts.push(`Stochastic is ${stochLast.toFixed(1)} and overbought.`); else if (stochLast <= 20) parts.push(`Stochastic is ${stochLast.toFixed(1)} and oversold.`); else parts.push(`Stochastic is ${stochLast.toFixed(1)} and neutral.`); } else parts.push("Stochastic needs more data."); }
      if (ind === "ATR(14)") { if (typeof atrLast === "number" && typeof atrSmaLast === "number" && atrSmaLast > 0) parts.push(`ATR is running at ${(atrLast / atrSmaLast).toFixed(2)}× its 20-day average.`); else parts.push("ATR needs more data."); }
      if (ind === "Volume") { if (typeof volumeLast === "number" && typeof volumeSmaLast === "number" && volumeSmaLast > 0) parts.push(`Volume is running at ${(volumeLast / volumeSmaLast).toFixed(2)}× its 20-day average.`); else parts.push("Volume needs more data."); }
    });
    return parts.length ? parts.join(" ") : "Custom indicator view is active.";
  }, [customMode, symbol, selectedIndicators, lastClose, lastMA50, lastMA200, ma50Pct, ma200Pct, ema20Pct, vwma20Pct, bbUpperLast, bbLowerLast, rsiLast, stochLast, macdHistLast, atrLast, atrSmaLast, volumeLast, volumeSmaLast, stretchScore, divergence]);

  const selectedBreakdownRows = useMemo(() => {
    const rows: { label: string; tone: OverviewItem["tone"]; value: string }[] = [];
    selectedIndicators.forEach(ind => {
      if (ind === "MA50") rows.push({ label: "MA50 Distance", tone: typeof ma50Pct === "number" ? Math.abs(ma50Pct) >= 5 ? "red" : Math.abs(ma50Pct) >= 2 ? "orange" : "yellow" : "muted", value: ma50Pct == null ? "—" : `${ma50Pct >= 0 ? "+" : ""}${ma50Pct.toFixed(2)}%` });
      if (ind === "MA200") rows.push({ label: "MA200 Distance", tone: typeof ma200Pct === "number" ? Math.abs(ma200Pct) >= 10 ? "red" : Math.abs(ma200Pct) >= 4 ? "orange" : "yellow" : "muted", value: ma200Pct == null ? "—" : `${ma200Pct >= 0 ? "+" : ""}${ma200Pct.toFixed(2)}%` });
      if (ind === "EMA20") rows.push({ label: "EMA20 Distance", tone: typeof ema20Pct === "number" ? Math.abs(ema20Pct) >= 5 ? "red" : Math.abs(ema20Pct) >= 2 ? "orange" : "yellow" : "muted", value: ema20Pct == null ? "—" : `${ema20Pct >= 0 ? "+" : ""}${ema20Pct.toFixed(2)}%` });
      if (ind === "VWMA(20)") rows.push({ label: "VWMA(20) Distance", tone: typeof vwma20Pct === "number" ? Math.abs(vwma20Pct) >= 5 ? "red" : Math.abs(vwma20Pct) >= 2 ? "orange" : "yellow" : "muted", value: vwma20Pct == null ? "—" : `${vwma20Pct >= 0 ? "+" : ""}${vwma20Pct.toFixed(2)}%` });
      if (ind === "Bollinger(20,2)") { let value = "—"; let tone: OverviewItem["tone"] = "muted"; if (typeof lastClose === "number" && typeof bbUpperLast === "number" && typeof bbLowerLast === "number") { if (lastClose > bbUpperLast) { value = "Above upper band"; tone = "red"; } else if (lastClose < bbLowerLast) { value = "Below lower band"; tone = "green"; } else { value = "Inside bands"; tone = "yellow"; } } rows.push({ label: "Bollinger", tone, value }); }
      if (ind === "RSI(14)") { rows.push({ label: "RSI", tone: typeof rsiLast === "number" ? rsiLast >= 70 ? "red" : rsiLast <= 30 ? "green" : "yellow" : "muted", value: typeof rsiLast === "number" ? rsiLast.toFixed(2) : "—" }); if (divergence.rsi !== "none") rows.push({ label: "RSI Div", tone: divergenceTone(divergence.rsi), value: divergenceLabel(divergence.rsi) }); }
      if (ind === "MACD(12,26,9)") { rows.push({ label: "MACD Hist", tone: typeof macdHistLast === "number" ? macdHistLast > 0 ? "green" : macdHistLast < 0 ? "red" : "yellow" : "muted", value: typeof macdHistLast === "number" ? macdHistLast.toFixed(4) : "—" }); if (divergence.macd !== "none") rows.push({ label: "MACD Div", tone: divergenceTone(divergence.macd), value: divergenceLabel(divergence.macd) }); }
      if (ind === "Stochastic(14,3)") rows.push({ label: "Stoch", tone: typeof stochLast === "number" ? stochLast >= 80 ? "red" : stochLast <= 20 ? "green" : "yellow" : "muted", value: typeof stochLast === "number" ? stochLast.toFixed(2) : "—" });
      if (ind === "ATR(14)") { const r = typeof atrLast === "number" && typeof atrSmaLast === "number" && atrSmaLast > 0 ? atrLast / atrSmaLast : null; rows.push({ label: "ATR Ratio", tone: r == null ? "muted" : r >= 1.5 ? "orange" : "yellow", value: r == null ? "—" : `${r.toFixed(2)}×` }); }
      if (ind === "Volume") { const r = typeof volumeLast === "number" && typeof volumeSmaLast === "number" && volumeSmaLast > 0 ? volumeLast / volumeSmaLast : null; rows.push({ label: "Volume Ratio", tone: r == null ? "muted" : r >= 1.8 ? "orange" : "yellow", value: r == null ? "—" : `${r.toFixed(2)}×` }); }
    });
    return rows;
  }, [selectedIndicators, ma50Pct, ma200Pct, ema20Pct, vwma20Pct, lastClose, bbUpperLast, bbLowerLast, rsiLast, stochLast, macdHistLast, atrLast, atrSmaLast, volumeLast, volumeSmaLast, divergence]);

  const overviewItems = useMemo<OverviewItem[]>(() => {
    const items: OverviewItem[] = []; let order = 0; const push = (it: Omit<OverviewItem, "order">) => items.push({ ...it, order: order++ });
    const vwap = lastNum(vwma20Arr);
    if (typeof lastClose === "number" && typeof vwap === "number" && vwap > 0) { const p = ((lastClose - vwap) / vwap) * 100; push({ key: "vwap", label: "VWMA(20)", tone: p >= 2 || p <= -2 ? (Math.abs(p) >= 5 ? "red" : "orange") : "yellow", valueText: `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`, severity: Math.abs(p) }); } else push({ key: "vwap", label: "VWMA(20)", tone: "muted", valueText: "—", severity: 0 });
    if (typeof macdHistLast === "number") push({ key: "macd", label: "MACD", tone: macdHistLast > 0 ? "green" : macdHistLast < 0 ? "red" : "yellow", valueText: macdHistLast > 0 ? "Bullish" : macdHistLast < 0 ? "Bearish" : "Flat", severity: Math.abs(macdHistLast) }); else push({ key: "macd", label: "MACD", tone: "muted", valueText: "—", severity: 0 });
    if (typeof rsiLast === "number") push({ key: "rsi", label: "RSI", tone: rsiLast >= 70 ? "red" : rsiLast <= 30 ? "green" : "yellow", valueText: rsiLast >= 70 ? "Overbought" : rsiLast <= 30 ? "Oversold" : "Neutral", severity: rsiLast >= 70 ? rsiLast - 70 : rsiLast <= 30 ? 30 - rsiLast : 0 }); else push({ key: "rsi", label: "RSI", tone: "muted", valueText: "—", severity: 0 });
    if (typeof stochLast === "number") push({ key: "stoch", label: "Stoch", tone: stochLast >= 80 ? "red" : stochLast <= 20 ? "green" : "yellow", valueText: stochLast >= 80 ? "Overbought" : stochLast <= 20 ? "Oversold" : "Neutral", severity: stochLast >= 80 ? stochLast - 80 : stochLast <= 20 ? 20 - stochLast : 0 }); else push({ key: "stoch", label: "Stoch", tone: "muted", valueText: "—", severity: 0 });
    if (typeof ma200Pct === "number") push({ key: "ma200", label: "MA200", tone: Math.abs(ma200Pct) >= 5 ? "red" : Math.abs(ma200Pct) >= 2 ? "orange" : "yellow", valueText: `${ma200Pct >= 0 ? "+" : ""}${ma200Pct.toFixed(2)}%`, severity: Math.abs(ma200Pct) }); else push({ key: "ma200", label: "MA200", tone: "muted", valueText: "—", severity: 0 });
    if (typeof volumeLast === "number" && typeof volumeSmaLast === "number" && volumeSmaLast > 0) { const r = volumeLast / volumeSmaLast; push({ key: "vol", label: "Volume", tone: r >= 1.8 ? "orange" : "yellow", valueText: r >= 1.8 ? `Spike ${r.toFixed(2)}×` : `Normal ${r.toFixed(2)}×`, severity: Math.max(0, r - 1) }); } else push({ key: "vol", label: "Volume", tone: "muted", valueText: "—", severity: 0 });
    if (typeof atrLast === "number" && typeof atrSmaLast === "number" && atrSmaLast > 0) { const r = atrLast / atrSmaLast; push({ key: "atr", label: "ATR", tone: r >= 1.5 ? "orange" : "yellow", valueText: r >= 1.5 ? `Spike ${r.toFixed(2)}×` : `Normal ${r.toFixed(2)}×`, severity: Math.max(0, r - 1) }); } else push({ key: "atr", label: "ATR", tone: "muted", valueText: "—", severity: 0 });
    if (assetType === "stock") { if (earningsSummary?.hasStructuredData && earningsSummary.tone) push({ key: "earnings", label: "Earnings", tone: earningsSummary.tone === "green" ? "green" : earningsSummary.tone === "red" ? "red" : "yellow", valueText: earningsSummary.toneLabel ?? "Neutral", severity: earningsSummary.tone === "red" ? 0.35 : earningsSummary.tone === "green" ? 0.25 : 0.1 }); else push({ key: "earnings", label: "Earnings", tone: "muted", valueText: "—", severity: 0 }); }
    if (divergence.rsi !== "none") push({ key: "div_rsi", label: "RSI Div", tone: divergenceTone(divergence.rsi), valueText: divergenceLabel(divergence.rsi), severity: 100 });
    if (divergence.macd !== "none") push({ key: "div_macd", label: "MACD Div", tone: divergenceTone(divergence.macd), valueText: divergenceLabel(divergence.macd), severity: 100 });
    return items.sort((a, b) => { if (b.severity !== a.severity) return b.severity - a.severity; const tr = toneRank(b.tone) - toneRank(a.tone); if (tr !== 0) return tr; return a.order - b.order; });
  }, [lastClose, vwma20Arr, macdHistLast, rsiLast, stochLast, ma200Pct, volumeLast, volumeSmaLast, atrLast, atrSmaLast, divergence, earningsSummary, assetType]);

  function chipToneColor(t: OverviewItem["tone"]) { return toneToColor(t, true); }

  function HelpTip(props: { text: string; isDark: boolean }) {
    const [ot, setOt] = useState(false);
    return (<span style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: "50%", background: "rgba(255,255,255,0.12)", color: "#fff", fontSize: 11, fontWeight: 900, cursor: "pointer", marginLeft: 6, flex: "0 0 auto", zIndex: 6 }} onMouseEnter={() => setOt(true)} onMouseLeave={() => setOt(false)} onClick={() => setOt(v => !v)}>?{ot ? <div style={{ position: "absolute", top: "calc(100% + 10px)", right: 0, width: 260, maxWidth: "min(260px, calc(100vw - 32px))", padding: 12, borderRadius: 12, backgroundColor: "#0f172a", border: "1px solid rgba(255,255,255,0.14)", color: "#f1f5f9", fontSize: 12, lineHeight: 1.5, fontWeight: 600, zIndex: 80, boxShadow: "0 10px 24px rgba(0,0,0,0.28)", pointerEvents: "none", whiteSpace: "normal" }}>{props.text}</div> : null}</span>);
  }
  function TimeframeButton(props: { label: string; active: boolean; onClick: () => void }) {
    return (<button type="button" onClick={props.onClick} style={{ padding: isMobile ? "8px 14px" : "9px 18px", borderRadius: 9, border: `1px solid ${props.active ? COLORS.blue : COLORS.controlBorder}`, background: props.active ? COLORS.blue : COLORS.controlBg, color: props.active ? "#fff" : COLORS.mutedFg, fontWeight: 800, fontSize: 13, cursor: "pointer", minWidth: isMobile ? 44 : 50, letterSpacing: "0.02em" }}>{props.label}</button>);
  }
  function AssetTypeToggle(props: { compact?: boolean }) {
    const opts: { key: AssetType; label: string }[] = [{ key: "stock", label: "Stocks" }, { key: "crypto", label: "Crypto" }];
    return (<div style={{ display: "flex", background: COLORS.controlBg, border: `1px solid ${COLORS.controlBorder}`, borderRadius: 10, padding: 3, gap: 3 }}>
      {opts.map(o => (<button key={o.key} type="button" onClick={() => switchAssetType(o.key)} style={{ border: "none", borderRadius: 7, padding: props.compact ? "7px 12px" : "9px 16px", background: assetType === o.key ? "rgba(47,107,255,0.28)" : "transparent", color: assetType === o.key ? "#dbeafe" : COLORS.mutedFg, fontWeight: 800, fontSize: props.compact ? 12 : 13, cursor: "pointer", boxShadow: assetType === o.key ? "inset 0 0 0 1px rgba(96,165,250,0.36)" : "none" }}>{o.label}</button>))}
    </div>);
  }
  function SectionCard(props: { title?: string; right?: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties; bodyStyle?: React.CSSProperties; allowOverflow?: boolean; }) {
    return (<section style={{ border: `1px solid ${COLORS.border}`, borderRadius: 16, background: COLORS.cardBg, color: COLORS.cardFg, overflow: props.allowOverflow ? "visible" : "hidden", minWidth: 0, ...props.style }}>{props.title || props.right ? <div style={{ padding: "13px 16px", borderBottom: `1px solid ${COLORS.borderSoft}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}><div style={{ fontWeight: 800, fontSize: 14, color: COLORS.mutedFg }}>{props.title}</div>{props.right}</div> : null}<div style={{ padding: 16, ...props.bodyStyle }}>{props.children}</div></section>);
  }
  function BreakdownHelpButton() { return (<div style={{ display: "flex", alignItems: "center", gap: 10 }}><HelpTip text={customMode ? "This breakdown is showing the indicators you currently selected on the chart." : "Breakdown shows the main dashboard indicators including trend, momentum, stretch, volatility and divergence clues."} isDark={true} /><Link href="/learn" style={{ color: "#9cc0ff", textDecoration: "none", fontWeight: 800, fontSize: 12 }}>Learn more →</Link></div>); }
  function ChartToolbar() {
    return (<div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "nowrap" }}>{[{ label: "←", onClick: () => setWindowOffset(o => Math.min(maxOffset, o + Math.max(1, Math.floor(win * 0.2)))), disabled: offset >= maxOffset }, { label: "→", onClick: () => setWindowOffset(o => Math.max(0, o - Math.max(1, Math.floor(win * 0.2)))), disabled: offset <= 0 }, { label: "+", onClick: () => { setVisibleBars(d => Math.max(2, Math.floor(d * 0.8))); setWindowOffset(0); }, disabled: false }, { label: "−", onClick: () => { setVisibleBars(d => Math.min(Math.max(2, totalPoints || d), Math.ceil(d * 1.25))); setWindowOffset(0); }, disabled: false }].map(btn => <button key={btn.label} onClick={btn.onClick} disabled={btn.disabled} style={{ padding: "7px 10px", borderRadius: 9, border: `1px solid ${COLORS.controlBorder}`, background: COLORS.controlBg, color: btn.disabled ? COLORS.mutedFg2 : COLORS.controlFg, cursor: btn.disabled ? "not-allowed" : "pointer", opacity: btn.disabled ? 0.45 : 1, fontWeight: 800, lineHeight: 1, fontSize: 14 }}>{btn.label}</button>)}<div style={{ padding: "7px 10px", borderRadius: 9, border: `1px solid ${COLORS.controlBorder}`, background: COLORS.controlBg, color: COLORS.mutedFg, fontSize: 11, fontWeight: 800, whiteSpace: "nowrap" }}>{Math.min(win, totalPoints)} bars</div><button onClick={() => { setVisibleBars(Math.max(totalPoints, 2)); setWindowOffset(0); }} style={{ padding: "7px 10px", borderRadius: 9, border: `1px solid ${COLORS.controlBorder}`, background: COLORS.controlBg, color: COLORS.controlFg, cursor: "pointer", fontWeight: 800, fontSize: 11 }}>MAX</button><button onClick={() => setExpanded(true)} style={{ padding: "7px 10px", borderRadius: 9, border: `1px solid ${COLORS.controlBorder}`, background: COLORS.controlBg, color: COLORS.controlFg, cursor: "pointer", fontWeight: 800, fontSize: 14 }}>⤢</button></div>);
  }

  function OverviewPanel() {
    const tc = toneToColor(trendToneFromScore(trendScore), true), sc = toneToColor(compositeToneFromCounts(stretchScore.overbought, stretchScore.oversold, 0).tone, true);
    return (<SectionCard title={`${symbol} Overview`} allowOverflow right={assetType === "stock" ? <Link href={`/stock/${encodeURIComponent(symbol)}`} style={{ display: "inline-flex", alignItems: "center", padding: "6px 11px", borderRadius: 9, border: `1px solid ${COLORS.amberBorder}`, background: COLORS.amberSoft, color: COLORS.amber, textDecoration: "none", fontWeight: 700, fontSize: 11 }}>Company Overview →</Link> : null}>
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}><div><div style={{ fontSize: isMobile ? 24 : 28, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.02em" }}>{symbol}</div><div style={{ marginTop: 4, fontSize: 12, color: COLORS.mutedFg, fontWeight: 600 }}>{symbolName || "Name unavailable"}</div></div><div style={{ textAlign: "right" }}><div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: COLORS.mutedFg2 }}>Last price</div><div style={{ fontSize: isMobile ? 22 : 28, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.05 }}>{quote?.price != null ? `$${quote.price.toFixed(2)}` : "—"}</div></div></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {[{ label: "Trend Score", color: tc, score: trendScore.passed, total: trendScore.total, flagged: trendScore.passed, helpText: "Trend score checks price vs MA50/MA200 and MACD histogram direction." }, { label: "Stretch Score", color: sc, score: stretchScore.flagged, total: stretchScore.total, flagged: stretchScore.flagged, helpText: "Stretch score checks RSI, Stoch, Bollinger, VWMA(20), EMA20 and MA50 extension." }].map(s => (
            <div key={s.label} style={{ background: COLORS.cardBg2, border: `1px solid ${COLORS.borderSoft}`, borderRadius: 12, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: COLORS.mutedFg }}><span style={{ color: s.color }}>●</span>{s.label}<HelpTip text={s.helpText} isDark={true} /></div>
              <div style={{ marginTop: 5, fontSize: 20, fontWeight: 800, color: s.color }}>{s.score}/{s.total}</div>
              {renderFlagsMeter({ flagged: s.flagged, total: s.total, color: s.color, isDark: true })}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{[{ label: `Regime: ${overviewMeta.trend}`, hi: false }, { label: `Volatility: ${overviewMeta.vol}`, hi: false }, { label: overviewMeta.toneTag, hi: true }].map(t => <span key={t.label} style={{ fontSize: 11.5, fontWeight: 600, padding: "4px 9px", borderRadius: 7, background: t.hi ? COLORS.amberSoft : COLORS.cardBg2, border: `1px solid ${t.hi ? COLORS.amberBorder : COLORS.borderSoft}`, color: t.hi ? COLORS.amber : COLORS.mutedFg }}>{t.label}</span>)}</div>
        <div style={{ background: customMode ? COLORS.amberSoft : COLORS.cardBg2, border: `1px solid ${customMode ? COLORS.amberBorder : COLORS.borderSoft}`, borderRadius: 12, padding: 12, fontSize: 13, lineHeight: 1.55, color: customMode ? COLORS.amber : COLORS.mutedFg }}><div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: customMode ? COLORS.amber : COLORS.cardFg, marginBottom: 5 }}>{customMode ? "Selected Indicator Summary" : "Chart Summary"}</div>{chartSummaryText}</div>
        <div style={{ paddingTop: 10, borderTop: `1px solid ${COLORS.borderSoft}`, fontSize: 11, color: COLORS.mutedFg2, fontWeight: 600 }}>As of {quote?.date ?? "—"} {quote?.time ?? ""} · Source: {quote?.source ?? "financialmodelingprep.com"}</div>
      </div>
    </SectionCard>);
  }

  function BreakdownPanel() {
    return (<SectionCard title={customMode ? "Selected Indicators" : "Breakdown"} right={<BreakdownHelpButton />} allowOverflow>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {(customMode ? selectedBreakdownRows : overviewItems).map((item: any) => (
          <div key={customMode ? item.label : item.key} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", padding: "8px 10px", border: `1px solid ${COLORS.borderSoft}`, borderRadius: 10, background: COLORS.cardBg2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: chipToneColor(item.tone), flex: "0 0 auto" }} /><span style={{ fontWeight: 700, fontSize: 13 }}>{item.label}</span></div>
            <div style={{ color: COLORS.mutedFg, fontWeight: 700, fontSize: 12, whiteSpace: "nowrap" }}>{customMode ? item.value : item.valueText}</div>
          </div>
        ))}
      </div>
      {customMode ? <button type="button" onClick={clearIndicatorSelection} style={{ marginTop: 12, padding: "8px 12px", borderRadius: 10, border: `1px solid ${COLORS.controlBorder}`, background: COLORS.controlBg, color: COLORS.controlFg, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>← Back to Overview</button> : null}
    </SectionCard>);
  }

  function MobileBreakdownAccordion() {
    const items = customMode ? selectedBreakdownRows : overviewItems;
    const bc = items.filter((i: any) => i.tone === "green").length, rc = items.filter((i: any) => i.tone === "red").length, nc = items.length - bc - rc;
    const sl = customMode ? "Custom indicators" : `Mixed · ${bc} bullish · ${rc} bearish · ${nc} neutral`;
    return (<section style={{ border: `1px solid ${COLORS.border}`, borderRadius: 16, background: COLORS.cardBg, overflow: "hidden" }}>
      <button type="button" onClick={() => setBreakdownOpen(v => !v)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", border: "none", background: "none", color: COLORS.cardFg, cursor: "pointer", textAlign: "left" }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: COLORS.blueSoft, border: `1px solid ${COLORS.blueBorder}`, display: "grid", placeItems: "center", flex: "0 0 auto" }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9cc0ff" strokeWidth="2.2" strokeLinecap="round"><path d="M4 19V5M4 19h16M9 16V9M14 16V6M19 16v-4" /></svg></div>
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 800, fontSize: 14 }}>Indicator Breakdown</div><div style={{ fontSize: 12, color: COLORS.mutedFg, marginTop: 1 }}>{sl}</div></div>
        <div style={{ display: "flex", gap: 3, flex: "0 0 auto" }}>{Array.from({ length: Math.min(bc, 4) }).map((_, i) => <span key={`b${i}`} style={{ width: 6, height: 6, borderRadius: 99, background: COLORS.green }} />)}{Array.from({ length: Math.min(rc, 4) }).map((_, i) => <span key={`r${i}`} style={{ width: 6, height: 6, borderRadius: 99, background: COLORS.red }} />)}{Array.from({ length: Math.min(nc, 4) }).map((_, i) => <span key={`n${i}`} style={{ width: 6, height: 6, borderRadius: 99, background: COLORS.mutedFg2 }} />)}</div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.mutedFg} strokeWidth="2.4" strokeLinecap="round" style={{ flex: "0 0 auto", transform: breakdownOpen ? "rotate(180deg)" : "none", transition: "transform 0.25s ease" }}><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {breakdownOpen ? <div style={{ borderTop: `1px solid ${COLORS.borderSoft}` }}>
        <div style={{ display: "flex", gap: 5, padding: "10px 16px 0" }}>{items.map((item: any) => <span key={customMode ? item.label : item.key} style={{ flex: 1, height: 5, borderRadius: 99, background: chipToneColor(item.tone) }} />)}</div>
        <div style={{ padding: "8px 16px 4px" }}>{items.map((item: any) => <div key={customMode ? item.label : item.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: `1px solid ${COLORS.borderSoft}` }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: chipToneColor(item.tone), flex: "0 0 auto" }} /><span style={{ flex: 1, fontWeight: 700, fontSize: 14 }}>{item.label}</span><span style={{ fontSize: 13, fontWeight: 700, color: chipToneColor(item.tone) }}>{customMode ? item.value : item.valueText}</span></div>)}</div>
        <div style={{ padding: "8px 16px 14px" }}><Link href="/learn" style={{ fontSize: 13, fontWeight: 700, color: "#9cc0ff", textDecoration: "none" }}>Learn what these mean →</Link></div>
        {customMode ? <div style={{ padding: "0 16px 14px" }}><button type="button" onClick={clearIndicatorSelection} style={{ padding: "8px 12px", borderRadius: 10, border: `1px solid ${COLORS.controlBorder}`, background: COLORS.controlBg, color: COLORS.controlFg, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>← Back to Overview</button></div> : null}
      </div> : null}
    </section>);
  }

  function ChartPanel() {
    return (<div id="chart" ref={chartSectionRef} style={{ scrollMarginTop: 24 }}>
      <SectionCard title="" right={null} bodyStyle={{ padding: 0 }} style={{ transition: "box-shadow 0.4s ease", boxShadow: highlightChart ? "0 0 0 2px rgba(47,107,255,0.4), 0 10px 30px rgba(47,107,255,0.2)" : undefined }}>
        {!showTradingView ? (
          <div style={{ padding: "13px 16px", borderBottom: `1px solid ${COLORS.borderSoft}` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: COLORS.mutedFg2 }}>Price · {chartIndicatorName}</div>
              <div style={{ display: "flex", gap: 4 }}>{TIMEFRAMES.map(t => <TimeframeButton key={t.label} label={t.label} active={activeTimeframe === t.label} onClick={() => setActiveTimeframe(t.label)} />)}</div>
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ position: "relative", flex: 1, minWidth: 160 }} ref={indicatorMenuRef}>
                <button type="button" onClick={() => setIndicatorMenuOpen(v => !v)} style={{ width: "100%", padding: "10px 13px", borderRadius: 10, border: `1px solid ${COLORS.controlBorder}`, background: COLORS.controlBg, color: COLORS.controlFg, fontWeight: 700, fontSize: 13, textAlign: "left", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, cursor: "pointer" }}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedIndicators.length ? chartIndicatorName : "Indicator · Overview"}</span><span>▾</span></button>
                {indicatorMenuOpen ? <div style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 40, width: isMobile ? "100%" : 300, maxHeight: 380, borderRadius: 14, border: `1px solid ${COLORS.border}`, background: COLORS.cardBg, boxShadow: "0 18px 34px rgba(0,0,0,0.40)", overflowY: "auto" }}>
                  <button type="button" onClick={clearIndicatorSelection} style={{ width: "100%", padding: "11px 13px", border: "none", borderBottom: `1px solid ${COLORS.border}`, background: COLORS.controlBg, color: COLORS.cardFg, textAlign: "left", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>Clear all · Overview</button>
                  {[{ title: "Price overlays", opts: PRICE_OVERLAY_OPTIONS }, { title: "Lower indicator (1 max)", opts: LOWER_OVERLAY_OPTIONS }].map(group => <div key={group.title}><div style={{ padding: "9px 13px 7px", fontSize: 10, fontWeight: 700, color: COLORS.mutedFg, textTransform: "uppercase", letterSpacing: "0.04em", borderTop: `1px solid ${COLORS.border}` }}>{group.title}</div>{group.opts.map(opt => (
                    <label key={opt} onMouseDown={e => { e.stopPropagation(); e.preventDefault(); toggleIndicatorSelection(opt); }} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 13px", borderTop: `1px solid ${COLORS.borderSoft}`, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                      <input type="checkbox" readOnly checked={selectedIndicators.includes(opt)} /><span>{opt}</span>
                    </label>
                  ))}</div>)}
                </div> : null}
              </div>
              <div style={{ display: "flex", background: COLORS.controlBg, border: `1px solid ${COLORS.controlBorder}`, borderRadius: 10, padding: 3, gap: 3 }}>{(["line", "candles"] as const).map(type => <button key={type} type="button" onClick={() => setChartType(type)} style={{ border: "none", borderRadius: 7, padding: "7px 12px", background: chartType === type ? "rgba(47,107,255,0.28)" : "transparent", color: chartType === type ? "#dbeafe" : COLORS.mutedFg, fontWeight: 700, fontSize: 12, cursor: "pointer", boxShadow: chartType === type ? "inset 0 0 0 1px rgba(96,165,250,0.36)" : "none" }}>{type === "line" ? "Line" : "Candles"}</button>)}</div>
              <ChartToolbar />
            </div>
          </div>
        ) : (
          <div style={{ padding: "13px 16px", borderBottom: `1px solid ${COLORS.borderSoft}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: COLORS.mutedFg2 }}>TradingView · {symbol}</div>
          </div>
        )}
        <div style={{ padding: 16 }}>
          <PriceChart symbol={symbol} data={displayedHistory} ma50={ma50} ma200={ma200} overlay={indicator} selectedIndicators={selectedIndicators} chartType={chartType} supportResistanceZones={supportResistanceZones} referenceLines={referenceLines} bollUpper={bollUpper} bollMid={bollMid} bollLower={bollLower} ema20={ema20Arr} vwma20={vwma20Arr} rsi14={rsi14Arr} macdLine={macdLine} macdSignal={macdSignal} macdHist={macdHist} stochK={stochK} stochD={stochD} atr14={atr14Arr} volume={volumeArr} divergence={divergence.div} height={isMobile ? (showTradingView ? 480 : 320) : (showTradingView ? 620 : 430)} tradingViewActive={showTradingView} onToggleTradingView={setShowTradingView} />
          <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 12, fontWeight: 600, color: COLORS.mutedFg2 }}>
            <div>{displayedHistory.length ? `${displayedHistory[0].date} → ${displayedHistory[displayedHistory.length - 1].date}` : "No chart data"}</div>
            <Link href="/platforms" style={{ fontSize: 12, color: "#9cc0ff", textDecoration: "none", fontWeight: 700 }}>Compare platforms →</Link>
          </div>
        </div>
      </SectionCard>
    </div>);
  }

  function BenchmarksPanel() {
    const items = bench?.items ?? [];
    const BenchCard = ({ it }: { it: BenchItem }) => {
      const pct = typeof it.changePct === "number" ? it.changePct : null;
      const isUp = typeof pct === "number" ? pct >= 0 : null;
      const ac = isUp == null ? COLORS.mutedFg : isUp ? COLORS.green : COLORS.red;
      const pt = pct == null ? null : `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
      const pr = typeof it.close === "number" ? `$${it.close.toFixed(2)}` : "—";
      const cs = (it.symbol || "").split(".")[0]?.toUpperCase() || it.symbol.toUpperCase();
      return (
        <button type="button" onClick={() => chooseSymbol(cs, undefined, assetType)}
          style={{ border: `1px solid ${COLORS.border}`, borderRadius: 13, padding: "13px 14px", background: COLORS.cardBg2, color: COLORS.cardFg, textAlign: "left", cursor: "pointer", ...(isMobile ? { flex: "0 0 148px" } : { width: "100%" }) }}>
          <div style={{ fontWeight: 800, fontSize: isMobile ? 13 : 14 }}>{it.label}</div>
          <div style={{ fontSize: isMobile ? 19 : 20, fontWeight: 800, marginTop: 9, fontVariantNumeric: "tabular-nums" }}>{pr}</div>
          <div style={{ marginTop: 6, display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
            {pt != null ? <span style={{ fontSize: 12, fontWeight: 700, color: ac, whiteSpace: "nowrap" }}>{isUp ? "▲" : "▼"} {pt}</span> : <span style={{ fontSize: 11, opacity: 0.5 }}>—</span>}
            <span style={{ fontSize: 11, opacity: 0.6, whiteSpace: "nowrap" }}>{it.date && it.time ? `${it.date} ${it.time}` : "—"}</span>
          </div>
        </button>
      );
    };
    return (
      <SectionCard title={assetType === "crypto" ? "Crypto Benchmarks" : "Market Benchmarks"} right={assetType === "stock" ? <Link href="/markets/spx" style={{ display: "inline-flex", alignItems: "center", padding: "6px 11px", borderRadius: 9, border: `1px solid ${COLORS.amberBorder}`, background: COLORS.amberSoft, color: COLORS.amber, textDecoration: "none", fontWeight: 700, fontSize: 11 }}>S&P 500 Detail →</Link> : null}>
        <div style={{ fontSize: 11, color: COLORS.mutedFg2, marginBottom: 12, fontWeight: 600 }}>Updated: {bench?.updatedAt ? new Date(bench.updatedAt).toLocaleString() : "—"} · {bench?.scope ?? "Benchmarks"}</div>
        {isMobile ? (
          <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4, WebkitOverflowScrolling: "touch", scrollbarWidth: "none" } as React.CSSProperties}>
            {items.map(it => <BenchCard key={it.key} it={it} />)}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            {items.map(it => <BenchCard key={it.key} it={it} />)}
          </div>
        )}
      </SectionCard>
    );
  }

  function NewsPanel() {
    if (assetType === "crypto") {
      return (<SectionCard title="Latest Headlines">
        <div style={{ padding: 12, borderRadius: 12, border: `1px solid ${COLORS.borderSoft}`, background: COLORS.cardBg2, color: COLORS.mutedFg, fontSize: 13, lineHeight: 1.6 }}>
          Crypto news briefings aren't available yet — this section is stock-only for now.
        </div>
      </SectionCard>);
    }
    return (<SectionCard title={news ? `Latest Headlines · ${news.symbol}` : "Latest Headlines"}>
      {news ? (
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: COLORS.mutedFg2 }}>MyStockHarbor Briefing</div>
              <div style={{ marginTop: 5, fontSize: isMobile ? 18 : 20, fontWeight: 800, lineHeight: 1.1 }}>Latest headlines on {news.symbol}</div>
              <div style={{ marginTop: 6, fontSize: 13, color: COLORS.mutedFg }}>{news.companyName ? `${news.companyName} · ` : ""}{news.newsScoreLabel} tone · {news.trend}</div>
            </div>
            <Link href={news.ctaHref} style={{ textDecoration: "none", padding: "10px 13px", borderRadius: 10, border: `1px solid ${COLORS.amberBorder}`, background: COLORS.amberSoft, color: COLORS.amber, fontWeight: 700, fontSize: 12, whiteSpace: "nowrap" }}>Open full {news.symbol} news page</Link>
          </div>
          {news.isInvalidTicker ? <div style={{ padding: 12, borderRadius: 12, border: "1px solid rgba(240,68,68,0.35)", background: "rgba(127,29,29,0.18)", color: "#fecaca", fontSize: 13, lineHeight: 1.6 }}>This ticker does not have enough usable market data yet.</div> : null}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : news.cards.length >= 3 ? "repeat(3, 1fr)" : "repeat(2, 1fr)", gap: 12 }}>
            {news.cards.map((item, idx) => (
              <div key={`${item.title}-${idx}`} style={{ padding: 13, borderRadius: 13, border: `1px solid ${COLORS.borderSoft}`, background: COLORS.cardBg2, display: "grid", gap: 9, alignContent: "start" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: COLORS.mutedFg2, textTransform: "uppercase" }}>{item.source ?? "Publisher"}</div><div style={{ fontSize: 10, color: COLORS.mutedFg2 }}>{item.pubDate ? new Date(item.pubDate).toLocaleDateString() : "Recent"}</div></div>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  {item.image ? (
                    <img src={item.image} alt="" loading="lazy" style={{ width: 52, height: 52, borderRadius: 8, objectFit: "cover", flexShrink: 0, background: "rgba(255,255,255,0.04)" }} />
                  ) : null}
                  <div style={{ fontWeight: 800, lineHeight: 1.4, fontSize: 14 }}>{item.title}</div>
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.6, color: COLORS.mutedFg }}>{item.summary}</div>
                <div style={{ padding: 9, borderRadius: 10, background: "rgba(255,255,255,0.03)", border: `1px solid ${COLORS.borderSoft}`, fontSize: 12, lineHeight: 1.55 }}><span style={{ fontWeight: 800 }}>Why this matters:</span> {item.whyItMatters}</div>
                {item.link ? <a href={item.link} target="_blank" rel="noopener noreferrer" style={{ justifySelf: "start", color: "#9cc0ff", textDecoration: "none", fontWeight: 700, fontSize: 12 }}>Read full article ↗</a> : null}
              </div>
            ))}
          </div>
          {!news.cards.length ? <div style={{ opacity: 0.7, fontSize: 13 }}>No headline cards available for this ticker yet.</div> : null}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ height: 10, borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,0.06)", border: `1px solid ${COLORS.borderSoft}` }}><div className="msh-news-loading-bar" /></div>
          <div style={{ fontSize: 13, color: COLORS.mutedFg }}>Building your latest headline briefing for this ticker…</div>
        </div>
      )}
    </SectionCard>);
  }

  function InsightsPanel() {
    return (<SectionCard><div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 200 }}><div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: COLORS.green }}>Fresh content</div><div style={{ marginTop: 7, fontSize: isMobile ? 18 : 20, fontWeight: 800, lineHeight: 1.15 }}>Read the latest stock market insights & trade ideas</div><div style={{ marginTop: 6, fontSize: 13, color: COLORS.mutedFg, lineHeight: 1.55 }}>Chart-based market insights, technical analysis write-ups and stock breakdowns from MyStockHarbor.</div></div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", flex: "0 0 auto" }}><Link href="/insights" style={{ display: "inline-flex", alignItems: "center", padding: "12px 18px", borderRadius: 12, border: `1px solid ${COLORS.blueBorder}`, background: COLORS.blueSoft, color: "#eff6ff", textDecoration: "none", fontWeight: 800, fontSize: 14 }}>Open Insights →</Link><Link href="/pickers" style={{ display: "inline-flex", alignItems: "center", padding: "12px 18px", borderRadius: 12, border: `1px solid ${COLORS.greenBorder}`, background: COLORS.greenSoft, color: "#dcfce7", textDecoration: "none", fontWeight: 800, fontSize: 14 }}>Stock Pickers →</Link></div>
    </div></SectionCard>);
  }

  function MobileHero() {
    return (<section style={{ marginBottom: 14, border: `1px solid ${COLORS.border}`, borderRadius: 18, background: COLORS.cardBg, overflow: "hidden" }}>
      <div style={{ padding: "16px 14px 14px", background: "linear-gradient(180deg, rgba(47,107,255,0.14), rgba(10,15,26,0))" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}><Link href="/" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none", flex: "0 0 auto" }}><img src="/logo.png" alt="MyStockHarbor" style={{ height: 48, width: "auto", objectFit: "contain", display: "block" }} /></Link><div style={{ fontSize: 12, fontWeight: 700, color: COLORS.mutedFg, lineHeight: 1.35 }}>Educational stock dashboard and market research tools.</div></div>
        <div style={{ fontWeight: 800, fontSize: 26, lineHeight: 1.05, letterSpacing: "-0.02em" }}>Stock Analysis Tools, Stock Pickers & Market Insights</div>
        <div style={{ marginTop: 7, color: COLORS.mutedFg, fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>Scan the market for ideas, or search any stock to open its full analysis page.</div>
        <div style={{ marginTop: 14 }}><AssetTypeToggle /></div>
        <button type="button" onClick={() => router.push("/pickers")} style={{ width: "100%", marginTop: 14, padding: "14px 16px", borderRadius: 14, border: "1px solid rgba(47,107,255,0.5)", background: "linear-gradient(135deg, rgba(47,107,255,0.28), rgba(22,199,132,0.14))", color: COLORS.controlFg, fontWeight: 800, fontSize: 16, cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", justifyContent: "space-between" }}><span style={{ display: "flex", alignItems: "center", gap: 9 }}><span>🔎</span><span>Scan for Stock Ideas</span></span><span>→</span></button>
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.mutedFg2, marginBottom: 6 }}>{assetType === "crypto" ? "Search Crypto (USD pairs)" : "Search Any Stock"}</div>
          <input value={query} onChange={e => { setQuery(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); const f = results[0]; if (!f?.symbol) return; chooseSymbol(f.symbol, f.name, assetType); } }} placeholder={assetType === "crypto" ? "🔎 Search BTC, ETH, SOL, TRX…" : "🔎 Search ticker or company"} style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `1px solid ${COLORS.controlBorder}`, background: COLORS.controlBg, color: COLORS.controlFg, outline: "none", fontSize: 15, fontWeight: 700 }} />
          {open && results.length > 0 ? <div style={{ position: "relative", marginTop: 7, zIndex: 20, border: `1px solid ${COLORS.border}`, borderRadius: 13, background: COLORS.cardBg, boxShadow: "0 14px 28px rgba(0,0,0,0.4)", overflow: "hidden" }}>{results.slice(0, 8).map(r => <button key={`${r.symbol}-${r.exchange}`} type="button" onClick={() => chooseSymbol(r.symbol, r.name, assetType)} style={{ width: "100%", textAlign: "left", padding: "11px 13px", border: "none", borderBottom: `1px solid ${COLORS.borderSoft}`, background: COLORS.cardBg, color: COLORS.cardFg, cursor: "pointer" }}><div style={{ fontWeight: 800 }}>{r.symbol}</div><div style={{ fontSize: 12, color: COLORS.mutedFg }}>{r.name}{r.exchange ? ` · ${r.exchange}` : ""}</div></button>)}</div> : null}
        </div>
      </div>
    </section>);
  }

  return (
    <main style={{ padding: 0, fontFamily: "system-ui, -apple-system, Arial, sans-serif", background: "#05080f", color: COLORS.pageFg, minHeight: "100vh" }}>
      <style>{`
        .msh-wrap{width:min(1240px,calc(100% - 24px));margin:0 auto;padding:0 0 40px;}
        .msh-hero{display:flex;align-items:center;gap:18px;padding:20px 0 16px;flex-wrap:wrap;}
        .msh-hero-lead{flex:0 0 auto;max-width:260px;}
        .msh-hero-lead h1{margin:0;font-size:18px;font-weight:800;line-height:1.2;}
        .msh-hero-lead p{margin:4px 0 0;font-size:12px;color:#8a97ad;}
        .msh-hero-actions{flex:1;display:flex;gap:10px;align-items:center;}
        .msh-searchbox{flex:1;display:flex;align-items:center;gap:10px;background:#141b2b;border:1px solid #222c40;border-radius:12px;padding:0 13px;height:48px;transition:border-color .15s;position:relative;}
        .msh-searchbox:focus-within{border-color:#2f6bff;}
        .msh-searchbox input{flex:1;background:none;border:none;outline:none;color:#eaf0fa;font-size:15px;font-weight:700;}
        .msh-searchbox input::placeholder{color:#5f6b80;font-weight:500;}
        .msh-searchbox .msh-go{background:#2f6bff;color:#fff;border:none;height:32px;padding:0 16px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;}
        .msh-scanbtn{flex:0 0 auto;display:flex;align-items:center;gap:8px;height:48px;padding:0 18px;border-radius:12px;background:#13213f;border:1px solid #27406f;color:#9cc0ff;font-weight:700;font-size:13.5px;cursor:pointer;white-space:nowrap;transition:background .15s;}
        .msh-scanbtn:hover{background:#16294d;}
        .msh-grid{display:grid;grid-template-columns:360px 1fr;gap:16px;align-items:start;}
        .msh-col{display:flex;flex-direction:column;gap:16px;}
        .msh-lower{display:grid;gap:16px;margin-top:16px;}
        .msh-news-loading-bar{width:36%;height:100%;border-radius:999px;background:linear-gradient(90deg,#2f6bff,#16c784);animation:mshLoad 1.15s ease-in-out infinite;}
        @keyframes mshLoad{0%{transform:translateX(-120%);}100%{transform:translateX(320%);}}
        @media(max-width:960px){.msh-grid{grid-template-columns:1fr;}}
        @media(max-width:768px){.msh-hero{display:none;}.msh-wrap{width:calc(100% - 16px);padding-top:12px;}.msh-desktop-only{display:none!important;}}
        @media(min-width:769px){.msh-mobile-only{display:none!important;}}
      `}</style>


      <div className="msh-wrap">
        <div className="msh-hero">
          <div className="msh-hero-lead"><h1>Analyze any stock</h1><p>Search a ticker for its full breakdown, or scan for fresh ideas.</p></div>
          <AssetTypeToggle compact />
          <div className="msh-hero-actions">
            <div className="msh-searchbox">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8a97ad" strokeWidth="2.4" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
              <input value={query} onChange={e => { setQuery(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); const f = results[0]; if (f?.symbol) chooseSymbol(f.symbol, f.name, assetType); } }} placeholder={assetType === "crypto" ? "Search BTC, ETH, SOL, TRX…" : "Search ANY ticker or company…"} />
              <button className="msh-go" onClick={() => { if (results[0]) chooseSymbol(results[0].symbol, results[0].name, assetType); }}>Go</button>
              {open && results.length > 0 ? <div style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, right: 0, zIndex: 30, border: `1px solid ${COLORS.border}`, borderRadius: 13, background: COLORS.cardBg, boxShadow: "0 14px 28px rgba(0,0,0,0.4)", overflow: "hidden" }}>{results.slice(0, 8).map(r => <button key={`${r.symbol}-${r.exchange}`} type="button" onClick={() => chooseSymbol(r.symbol, r.name, assetType)} style={{ width: "100%", textAlign: "left", padding: "10px 13px", border: "none", borderBottom: `1px solid ${COLORS.borderSoft}`, background: COLORS.cardBg, color: COLORS.cardFg, cursor: "pointer" }}><div style={{ fontWeight: 800, fontSize: 13 }}>{r.symbol}</div><div style={{ fontSize: 12, color: COLORS.mutedFg }}>{r.name}{r.exchange ? ` · ${r.exchange}` : ""}</div></button>)}</div> : null}
            </div>
            <button className="msh-scanbtn" onClick={() => router.push("/pickers")}>🔎 Scan for stock ideas</button>
          </div>
        </div>

        <div className="msh-desktop-only">
          <DiscoveryStrip />
        </div>

        <div className="msh-mobile-only">{isMobile ? MobileHero() : null}</div>

        <DashboardTicker />

        {err ? <div style={{ marginBottom: 14, padding: 12, borderRadius: 12, border: "1px solid rgba(240,68,68,0.35)", background: "rgba(127,29,29,0.24)", fontWeight: 700, fontSize: 13 }}>{err}</div> : null}

        <div className="msh-grid msh-desktop-only">
          <div className="msh-col"><OverviewPanel /><BreakdownPanel /></div>
          <div className="msh-col"><ChartPanel /></div>
        </div>

        <div className="msh-mobile-only" style={{ display: "grid", gap: 14 }}>
          <OverviewPanel />
          <ChartPanel />
          <MobileBreakdownAccordion />
        </div>

        <div className="msh-lower">
          <BenchmarksPanel />
          <NewsPanel />
          <InsightsPanel />
        </div>
      </div>

      {expanded ? (
        <div onClick={() => setExpanded(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "min(1280px, 100%)", maxHeight: "92vh", overflow: "auto", borderRadius: 18, border: `1px solid ${COLORS.border}`, background: COLORS.cardBg, boxShadow: "0 24px 60px rgba(0,0,0,0.45)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 16px", borderBottom: `1px solid ${COLORS.border}` }}>
              <div style={{ fontWeight: 800, fontSize: 14 }}>Expanded Chart ({chartIndicatorName})</div>
              <button type="button" onClick={() => setExpanded(false)} style={{ padding: "7px 10px", borderRadius: 9, border: `1px solid ${COLORS.controlBorder}`, background: COLORS.controlBg, color: COLORS.controlFg, fontWeight: 700, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ padding: 16 }}>
              <PriceChart symbol={symbol} data={displayedHistory} ma50={ma50} ma200={ma200} overlay={indicator} selectedIndicators={selectedIndicators} chartType={chartType} supportResistanceZones={supportResistanceZones} referenceLines={referenceLines} bollUpper={bollUpper} bollMid={bollMid} bollLower={bollLower} ema20={ema20Arr} vwma20={vwma20Arr} rsi14={rsi14Arr} macdLine={macdLine} macdSignal={macdSignal} macdHist={macdHist} stochK={stochK} stochD={stochD} atr14={atr14Arr} volume={volumeArr} divergence={divergence.div} height={isMobile ? (showTradingView ? 460 : 280) : (showTradingView ? 640 : 520)} tradingViewActive={showTradingView} onToggleTradingView={setShowTradingView} />
            </div>
          </div>
        </div>
      ) : null}

      {loading ? <div style={{ position: "fixed", bottom: 20, right: 20, fontSize: 12, color: COLORS.mutedFg, background: COLORS.cardBg, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "8px 12px", fontWeight: 700 }}>Loading chart data…</div> : null}
    </main>
  );
}
