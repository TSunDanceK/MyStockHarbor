"use client";

import React, { useEffect, useMemo, useState } from "react";

type PickerTone = "green" | "yellow" | "orange" | "red" | "blue";

type PickerItem = {
  symbol: string;
  note?: string;
  tone?: PickerTone;
  timeframe?: "D" | "W" | "M";
  indicator?: "MA200" | "RSI(14)" | "MACD(12,26,9)";
  dashboardHref?: string;
};

type PickerSection = {
  title: string;
  description?: string;
  foundCount?: number;
  shownCount?: number;
  items: PickerItem[];
};

type SignalRecord = {
  symbol: string;
  note?: string;
  tone?: PickerTone;
  oversold: boolean; overbought: boolean; buyTheDip: boolean; breakout: boolean;
  volumeSpike: boolean; atrSpike: boolean; aboveMA50: boolean; belowMA50: boolean;
  aboveMA200: boolean; belowMA200: boolean; dailyMa200Proximity: boolean; weeklyMa200Proximity: boolean;
  bullishRsiDivergence: boolean; bearishRsiDivergence: boolean; bullishMacdDivergence: boolean; bearishMacdDivergence: boolean;
  positiveLastEarnings?: boolean; strongEarningsGrowth?: boolean;
  preferredTimeframe?: "D" | "W" | "M";
  preferredIndicator?: "MA200" | "RSI(14)" | "MACD(12,26,9)";
  dashboardHref?: string;
  isDynamicUniverse?: boolean;
};

type PickersPayload = {
  updatedAt?: string; universeSize?: number; dynamicUniverseCount?: number;
  dynamicUniversePreview?: string[]; dynamicSymbols?: string[];
  estimatedApiCalls?: number; sections?: PickerSection[]; signalRecords?: SignalRecord[];
};

type FilterKey = "oversold"|"overbought"|"buyTheDip"|"breakout"|"volumeSpike"|"atrSpike"|"aboveMA50"|"belowMA50"|"aboveMA200"|"belowMA200"|"dailyMa200Proximity"|"weeklyMa200Proximity"|"bullishRsiDivergence"|"bearishRsiDivergence"|"bullishMacdDivergence"|"bearishMacdDivergence"|"positiveLastEarnings"|"strongEarningsGrowth";
type FilterDef = { key: FilterKey; label: string; tone: PickerTone; };

const FILTER_DEFS: FilterDef[] = [
  { key: "oversold", label: "Oversold", tone: "green" },
  { key: "overbought", label: "Overbought", tone: "red" },
  { key: "buyTheDip", label: "20%+ From ATH", tone: "yellow" },
  { key: "breakout", label: "Breakout", tone: "orange" },
  { key: "volumeSpike", label: "Volume Spike", tone: "orange" },
  { key: "atrSpike", label: "ATR Spike", tone: "orange" },
  { key: "aboveMA50", label: "Above MA50", tone: "yellow" },
  { key: "belowMA50", label: "Below MA50", tone: "yellow" },
  { key: "aboveMA200", label: "Above MA200", tone: "yellow" },
  { key: "belowMA200", label: "Below MA200", tone: "yellow" },
  { key: "dailyMa200Proximity", label: "Near 200-Day MA (Daily)", tone: "yellow" },
  { key: "weeklyMa200Proximity", label: "Near 200-Day MA (Weekly)", tone: "yellow" },
  { key: "bullishRsiDivergence", label: "Bullish RSI Divergence", tone: "green" },
  { key: "bearishRsiDivergence", label: "Bearish RSI Divergence", tone: "red" },
  { key: "bullishMacdDivergence", label: "Bullish MACD Divergence", tone: "green" },
  { key: "bearishMacdDivergence", label: "Bearish MACD Divergence", tone: "red" },
  { key: "positiveLastEarnings", label: "Positive Last Earnings", tone: "green" },
  { key: "strongEarningsGrowth", label: "Strong Earnings Growth", tone: "green" },
];

function toneDot(tone?: string) {
  if (tone === "green") return "#22c55e";
  if (tone === "yellow") return "#eab308";
  if (tone === "orange") return "#fb923c";
  if (tone === "red") return "#ef4444";
  if (tone === "blue") return "#60a5fa";
  return "rgba(255,255,255,0.30)";
}

function toChartHref(href: string, symbol?: string) {
  const cleanedSymbol = String(symbol || "").trim().toUpperCase();
  const fallback = cleanedSymbol ? `/dashboard?symbol=${encodeURIComponent(cleanedSymbol)}` : "/dashboard";
  const raw = href && href.trim() ? href.trim() : "";
  const normalised = raw.startsWith("/?symbol=") ? raw.replace("/?symbol=", "/dashboard?symbol=") : raw.startsWith("/?")
    ? raw.replace("/?" , "/dashboard?") : raw;
  const base = normalised.startsWith("/dashboard") ? normalised : fallback;
  return base.includes("#chart") ? base : `${base}#chart`;
}

function getFilterLabel(key: FilterKey) { return FILTER_DEFS.find((f) => f.key === key)?.label ?? key; }

function matchedSignalsForRecord(record: SignalRecord): FilterKey[] {
  const out: FilterKey[] = [];
  if (record.oversold) out.push("oversold");
  if (record.overbought) out.push("overbought");
  if (record.buyTheDip) out.push("buyTheDip");
  if (record.breakout) out.push("breakout");
  if (record.volumeSpike) out.push("volumeSpike");
  if (record.atrSpike) out.push("atrSpike");
  if (record.aboveMA50) out.push("aboveMA50");
  if (record.belowMA50) out.push("belowMA50");
  if (record.aboveMA200) out.push("aboveMA200");
  if (record.belowMA200) out.push("belowMA200");
  if (record.dailyMa200Proximity) out.push("dailyMa200Proximity");
  if (record.weeklyMa200Proximity) out.push("weeklyMa200Proximity");
  if (record.bullishRsiDivergence) out.push("bullishRsiDivergence");
  if (record.bearishRsiDivergence) out.push("bearishRsiDivergence");
  if (record.bullishMacdDivergence) out.push("bullishMacdDivergence");
  if (record.bearishMacdDivergence) out.push("bearishMacdDivergence");
  if (record.positiveLastEarnings) out.push("positiveLastEarnings");
  if (record.strongEarningsGrowth) out.push("strongEarningsGrowth");
  return out;
}

function chooseCardTone(record: SignalRecord, matchedFilters: FilterKey[]): PickerTone | undefined {
  for (const key of matchedFilters) { const def = FILTER_DEFS.find((f) => f.key === key); if (def?.tone === "green") return "green"; }
  for (const key of matchedFilters) { const def = FILTER_DEFS.find((f) => f.key === key); if (def?.tone === "red") return "red"; }
  for (const key of matchedFilters) { const def = FILTER_DEFS.find((f) => f.key === key); if (def?.tone === "orange") return "orange"; }
  return record.tone;
}

function getBuySignalCount(record: SignalRecord) {
  if (!record.aboveMA200) return 0;
  let count = 0;
  if (record.oversold) count++; if (record.buyTheDip) count++; if (record.breakout) count++;
  if (record.volumeSpike) count++; if (record.atrSpike) count++; if (record.aboveMA50) count++;
  if (record.aboveMA200) count++; if (record.bullishRsiDivergence) count++; if (record.bullishMacdDivergence) count++;
  return count;
}

function getSellSignalCount(record: SignalRecord) {
  let count = 0;
  if (record.overbought) count++; if (record.belowMA50) count++; if (record.belowMA200) count++;
  if (record.bearishRsiDivergence) count++; if (record.bearishMacdDivergence) count++;
  return count;
}

function getHeaderHelp(title: string) {
  if (title.includes("Buy Signals")) return "Stocks showing multiple bullish technical conditions at the same time, ranked by signal count.";
  if (title.includes("Sell Signals")) return "Stocks showing multiple bearish technical conditions, ranked by signal count.";
  if (title.includes("Oversold")) return "Ranked oversold setups favouring stronger oversold readings, better liquidity and cleaner rebound potential.";
  if (title.includes("Best Trend Score")) return "Stocks with strong trend structure: price above MA50/MA200, correct MA alignment, positive MACD momentum.";
  if (title.includes("Positive Last Earnings")) return "Ranked by the most recent earnings report — EPS beats, revenue beats and positive EPS carry more weight.";
  if (title.includes("Strong Earnings Growth")) return "Ranked by year-over-year earnings improvement, recent positive EPS consistency and revenue growth.";
  if (title.includes("Overbought")) return "Ranked overbought setups favouring stronger extension and cleaner pullback-risk profiles.";
  if (title.includes("Divergence")) return "Ranked by timeframe, duration and structure quality. Weekly divergences usually carry more weight than daily ones.";
  if (title.includes("Macro Support") || title.includes("Resistance")) return "Stocks near wider weekly support or resistance zones, ranked by touch count, distance and structure length.";
  if (title.includes("All-Time Highs")) return "Pullback setups from all-time highs, ranked to favour liquid, tradable names over broken charts.";
  if (title.toLowerCase().includes("200-day")) return "Stocks near the 200-day moving average — a key long-term level traders watch for support, resistance and trend direction.";
  if (title.includes("Breakout")) return "Ranked to favour newer, cleaner and more liquid breakouts over older or more stretched moves.";
  return "Stocks matching multiple technical conditions worth reviewing on the chart.";
}

function HelpTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="pickers-help-tip" style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 15, height: 15, borderRadius: "50%", background: "rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.60)", fontSize: 10, fontWeight: 700, cursor: "pointer", marginLeft: 4, flex: "0 0 auto" }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onClick={() => setOpen((v) => !v)}>
      ?
      {open ? <span style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 999, width: 240, maxWidth: "min(240px, 76vw)", padding: "10px 12px", borderRadius: 10, background: "#0f172a", border: "1px solid rgba(255,255,255,0.12)", color: "#cbd5e1", fontSize: 12, lineHeight: 1.5, fontWeight: 500, boxShadow: "0 14px 30px rgba(0,0,0,0.35)", textAlign: "left", pointerEvents: "none" }}>{text}</span> : null}
    </span>
  );
}

function createEmptySignalRecord(symbol: string, item?: PickerItem): SignalRecord {
  const cleanSymbol = String(symbol || "").trim().toUpperCase();
  return {
    symbol: cleanSymbol, note: item?.note, tone: item?.tone,
    oversold: false, overbought: false, buyTheDip: false, breakout: false,
    volumeSpike: false, atrSpike: false, aboveMA50: false, belowMA50: false,
    aboveMA200: false, belowMA200: false, dailyMa200Proximity: false, weeklyMa200Proximity: false,
    bullishRsiDivergence: false, bearishRsiDivergence: false, bullishMacdDivergence: false, bearishMacdDivergence: false,
    positiveLastEarnings: false, strongEarningsGrowth: false,
    preferredTimeframe: item?.timeframe, preferredIndicator: item?.indicator,
    dashboardHref: toChartHref(item?.dashboardHref ?? "", cleanSymbol),
  };
}

type PlayCardDef = { title: string; href: string; tone: "green" | "red" | "blue"; pattern: "ascending" | "descending" | "bullFlag" | "macroSR"; };

const PLAY_CARDS: PlayCardDef[] = [
  { title: "Ascending Triangle Plays", href: "/plays", tone: "green", pattern: "ascending" },
  { title: "Descending Triangle Plays", href: "/plays/descending-triangles", tone: "red", pattern: "descending" },
  { title: "Bull Flag Plays", href: "/plays/bull-flags", tone: "blue", pattern: "bullFlag" },
  { title: "Macro Support / Resistance Plays", href: "/macro-support-resistance-stocks", tone: "blue", pattern: "macroSR" },
];

function playTone(tone: PlayCardDef["tone"]) {
  if (tone === "green") return { dot: "#22c55e", border: "rgba(34,197,94,0.20)", bg: "rgba(8,24,18,0.60)", line: "#22c55e", accent: "#60a5fa", color: "#bbf7d0" };
  if (tone === "red") return { dot: "#ef4444", border: "rgba(239,68,68,0.20)", bg: "rgba(32,12,18,0.60)", line: "#ef4444", accent: "#60a5fa", color: "#fecaca" };
  return { dot: "#60a5fa", border: "rgba(96,165,250,0.20)", bg: "rgba(10,18,36,0.60)", line: "#60a5fa", accent: "#22c55e", color: "#dbeafe" };
}

function PlayDiagram({ pattern, tone }: { pattern: PlayCardDef["pattern"]; tone: PlayCardDef["tone"] }) {
  const c = playTone(tone);
  if (pattern === "descending") return (
    <svg viewBox="0 0 280 100" style={{ width: "100%", display: "block", borderRadius: 10, background: "rgba(2,6,23,0.60)" }} role="img" aria-label="Descending triangle">
      <path d="M20 80 H260" stroke={c.line} strokeWidth="2" strokeDasharray="6 5" strokeLinecap="round" />
      <path d="M22 28 L260 80" stroke={c.accent} strokeWidth="2" strokeLinecap="round" opacity="0.7" />
      <path d="M24 34 L52 80 L82 44 L110 80 L140 56 L168 80 L198 68 L226 80 L256 77" stroke="rgba(226,232,240,0.70)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  if (pattern === "macroSR") return (
    <svg viewBox="0 0 280 100" style={{ width: "100%", display: "block", borderRadius: 10, background: "rgba(2,6,23,0.60)" }} role="img" aria-label="Macro support resistance">
      <path d="M20 24 H260" stroke="#ef4444" strokeWidth="2" strokeDasharray="6 5" strokeLinecap="round" opacity="0.8" />
      <path d="M20 76 H260" stroke="#22c55e" strokeWidth="2" strokeDasharray="6 5" strokeLinecap="round" opacity="0.8" />
      <path d="M24 67 L54 46 L82 70 L112 52 L142 27 L170 56 L198 75 L226 53 L256 36" stroke="rgba(226,232,240,0.70)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  if (pattern === "bullFlag") return (
    <svg viewBox="0 0 280 100" style={{ width: "100%", display: "block", borderRadius: 10, background: "rgba(2,6,23,0.60)" }} role="img" aria-label="Bull flag">
      <path d="M20 82 L44 72 L62 54 L78 24" stroke="#22c55e" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M80 24 L116 38 L152 32 L190 45 L228 38" stroke="rgba(226,232,240,0.70)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M82 22 L238 40" stroke={c.line} strokeWidth="1.5" strokeDasharray="5 5" strokeLinecap="round" opacity="0.6" />
      <path d="M76 50 L232 68" stroke={c.line} strokeWidth="1.5" strokeDasharray="5 5" strokeLinecap="round" opacity="0.6" />
      <path d="M228 38 L256 22" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
  return (
    <svg viewBox="0 0 280 100" style={{ width: "100%", display: "block", borderRadius: 10, background: "rgba(2,6,23,0.60)" }} role="img" aria-label="Ascending triangle">
      <path d="M20 24 H260" stroke={c.line} strokeWidth="2" strokeDasharray="6 5" strokeLinecap="round" />
      <path d="M22 80 L260 24" stroke={c.accent} strokeWidth="2" strokeLinecap="round" opacity="0.7" />
      <path d="M24 68 L54 24 L84 62 L114 24 L144 50 L174 24 L204 42 L234 24 L260 26" stroke="rgba(226,232,240,0.70)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PatternPlaysSection() {
  return (
    <section style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 16, boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em", color: "rgba(226,232,240,0.90)" }}>Chart Pattern Plays</h2>
        <p style={{ margin: 0, fontSize: 12, opacity: 0.55, lineHeight: 1.5 }}>Visual chart-pattern pages — click through to the full play lists.</p>
      </div>
      <div className="pattern-plays-grid">
        {PLAY_CARDS.map((play) => {
          const c = playTone(play.tone);
          return (
            <a key={play.href} href={play.href} style={{ display: "grid", gap: 8, padding: 12, borderRadius: 12, border: `1px solid ${c.border}`, background: c.bg, textDecoration: "none", color: "#f1f5f9", transition: "transform 140ms ease, filter 140ms ease", boxSizing: "border-box" }} className="pattern-play-card">
              <PlayDiagram pattern={play.pattern} tone={play.tone} />
              <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: c.dot, flex: "0 0 auto" }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: c.color, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{play.title}</span>
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}

export default function PickersClient() {
  const SHOW_FORCE_FETCH_BUTTON = false;

  const [sections, setSections] = useState<PickerSection[]>([]);
  const [signalRecords, setSignalRecords] = useState<SignalRecord[]>([]);
  const [selectedFilters, setSelectedFilters] = useState<FilterKey[]>([]);
  const [screenerOpen, setScreenerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [forceRefreshing, setForceRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [universeSize, setUniverseSize] = useState<number | null>(null);
  const [dynamicUniverseCount, setDynamicUniverseCount] = useState<number | null>(null);
  const [dynamicUniversePreview, setDynamicUniversePreview] = useState<string[] | null>(null);
  const [dynamicSymbols, setDynamicSymbols] = useState<string[]>([]);
  const [estimatedApiCalls, setEstimatedApiCalls] = useState<number | null>(null);
  const [earningsFetchBusy, setEarningsFetchBusy] = useState(false);
  const [earningsFetchLockedUntil, setEarningsFetchLockedUntil] = useState(0);
  const [earningsFetchTick, setEarningsFetchTick] = useState(0);
  const [earningsFetchMessage, setEarningsFetchMessage] = useState<string | null>(null);

  const EARNINGS_FETCH_LOCK_MS = 90 * 1000;
  void earningsFetchTick;
  const earningsFetchRemainingSeconds = Math.max(0, Math.ceil((earningsFetchLockedUntil - Date.now()) / 1000));

  async function handleFetchEarnings() {
    if (earningsFetchBusy || Date.now() < earningsFetchLockedUntil) return;
    setEarningsFetchBusy(true); setEarningsFetchMessage(null);
    try {
      const res = await fetch(`/api/jobs/warm-earnings?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Earnings warm-up failed");
      const data = (await res.json()) as { fetchedCount?: number; checked?: number; deferredCount?: number; failedCount?: number };
      const fetched = typeof data?.fetchedCount === "number" ? data.fetchedCount : 0;
      const checked = typeof data?.checked === "number" ? data.checked : 0;
      const deferred = typeof data?.deferredCount === "number" ? data.deferredCount : 0;
      const failed = typeof data?.failedCount === "number" ? data.failedCount : 0;
      setEarningsFetchMessage(`Checked ${checked}, fetched ${fetched}, deferred ${deferred}, failed ${failed}.`);
      const lockUntil = Date.now() + EARNINGS_FETCH_LOCK_MS;
      setEarningsFetchLockedUntil(lockUntil);
      try { window.localStorage.setItem("msh:lastEarningsFetchUntil", String(lockUntil)); } catch { /* ignore */ }
      await loadPickers(true);
    } catch { setEarningsFetchMessage("Earnings warm-up failed. Try again in a moment."); }
    finally { setEarningsFetchBusy(false); }
  }

  async function loadPickers(force = false) {
    const setBusy = force ? setForceRefreshing : setLoading;
    setBusy(true); setErr(null);
    try {
      const url = force ? `/api/pickers?force=1&t=${Date.now()}` : `/api/pickers?t=${Date.now()}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("Pickers API failed");
      const data = (await res.json()) as PickersPayload;
      setSections(Array.isArray(data?.sections) ? data.sections : []);
      setSignalRecords(Array.isArray(data?.signalRecords) ? data.signalRecords : []);
      setUpdatedAt(typeof data?.updatedAt === "string" ? data.updatedAt : null);
      setUniverseSize(typeof data?.universeSize === "number" ? data.universeSize : null);
      setDynamicUniverseCount(typeof data?.dynamicUniverseCount === "number" ? data.dynamicUniverseCount : null);
      setDynamicUniversePreview(Array.isArray(data?.dynamicUniversePreview) ? data.dynamicUniversePreview : null);
      setDynamicSymbols(Array.isArray(data?.dynamicSymbols) ? data.dynamicSymbols.map((x) => String(x).trim().toUpperCase()).filter(Boolean) : []);
      setEstimatedApiCalls(typeof data?.estimatedApiCalls === "number" ? data.estimatedApiCalls : null);
    } catch {
      setErr(force ? "Force refresh failed." : "Failed to load stock ideas.");
      if (!force) { setSections([]); setSignalRecords([]); setUpdatedAt(null); setUniverseSize(null); setDynamicUniverseCount(null); setDynamicUniversePreview(null); setDynamicSymbols([]); setEstimatedApiCalls(null); }
    } finally { setBusy(false); }
  }

  useEffect(() => {
    try { const saved = Number(window.localStorage.getItem("msh:lastEarningsFetchUntil") || "0"); if (Number.isFinite(saved) && saved > Date.now()) setEarningsFetchLockedUntil(saved); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!earningsFetchLockedUntil) return;
    const interval = window.setInterval(() => setEarningsFetchTick((v) => v + 1), 1000);
    return () => window.clearInterval(interval);
  }, [earningsFetchLockedUntil]);

  useEffect(() => {
    if (!earningsFetchLockedUntil) return;
    if (Date.now() < earningsFetchLockedUntil) return;
    setEarningsFetchLockedUntil(0);
    try { window.localStorage.removeItem("msh:lastEarningsFetchUntil"); } catch { /* ignore */ }
  }, [earningsFetchTick, earningsFetchLockedUntil]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setErr(null);
      try {
        const res = await fetch(`/api/pickers?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Pickers API failed");
        const data = (await res.json()) as PickersPayload;
        if (!cancelled) {
          setSections(Array.isArray(data?.sections) ? data.sections : []);
          setSignalRecords(Array.isArray(data?.signalRecords) ? data.signalRecords : []);
          setUpdatedAt(typeof data?.updatedAt === "string" ? data.updatedAt : null);
          setUniverseSize(typeof data?.universeSize === "number" ? data.universeSize : null);
          setDynamicUniverseCount(typeof data?.dynamicUniverseCount === "number" ? data.dynamicUniverseCount : null);
          setDynamicUniversePreview(Array.isArray(data?.dynamicUniversePreview) ? data.dynamicUniversePreview : null);
          setDynamicSymbols(Array.isArray(data?.dynamicSymbols) ? data.dynamicSymbols.map((x) => String(x).trim().toUpperCase()).filter(Boolean) : []);
          setEstimatedApiCalls(typeof data?.estimatedApiCalls === "number" ? data.estimatedApiCalls : null);
        }
      } catch {
        if (!cancelled) { setErr("Failed to load stock ideas."); setSections([]); setSignalRecords([]); setUpdatedAt(null); setUniverseSize(null); setDynamicUniverseCount(null); setDynamicUniversePreview(null); setDynamicSymbols([]); setEstimatedApiCalls(null); }
      } finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const safeSections = useMemo(() => Array.isArray(sections) ? sections : [], [sections]);
  const safeSignalRecords = useMemo(() => Array.isArray(signalRecords) ? signalRecords : [], [signalRecords]);

  const earningsSectionSymbolSets = useMemo(() => {
    const positiveLastEarnings = new Set<string>(); const strongEarningsGrowth = new Set<string>();
    for (const section of safeSections) {
      const title = String(section.title || "").toLowerCase();
      for (const item of Array.isArray(section.items) ? section.items : []) {
        const symbol = String(item.symbol || "").trim().toUpperCase();
        if (!symbol) continue;
        if (title.includes("positive last earnings")) positiveLastEarnings.add(symbol);
        if (title.includes("strong earnings growth")) strongEarningsGrowth.add(symbol);
      }
    }
    return { positiveLastEarnings, strongEarningsGrowth };
  }, [safeSections]);

  const enrichedSignalRecords = useMemo(() => {
    const map = new Map<string, SignalRecord>();
    for (const record of safeSignalRecords) {
      const symbol = String(record.symbol ?? "").trim().toUpperCase();
      if (!symbol) continue;
      map.set(symbol, { ...record, symbol, positiveLastEarnings: record.positiveLastEarnings === true || earningsSectionSymbolSets.positiveLastEarnings.has(symbol), strongEarningsGrowth: record.strongEarningsGrowth === true || earningsSectionSymbolSets.strongEarningsGrowth.has(symbol) });
    }
    for (const section of safeSections) {
      const title = String(section.title || "").toLowerCase();
      const isPLE = title.includes("positive last earnings"), isSEG = title.includes("strong earnings growth");
      if (!isPLE && !isSEG) continue;
      for (const item of Array.isArray(section.items) ? section.items : []) {
        const symbol = String(item.symbol || "").trim().toUpperCase();
        if (!symbol) continue;
        const existing = map.get(symbol) ?? createEmptySignalRecord(symbol, item);
        map.set(symbol, { ...existing, note: existing.note ?? item.note, tone: existing.tone ?? item.tone, dashboardHref: existing.dashboardHref ?? item.dashboardHref, positiveLastEarnings: existing.positiveLastEarnings === true || isPLE, strongEarningsGrowth: existing.strongEarningsGrowth === true || isSEG });
      }
    }
    return Array.from(map.values());
  }, [safeSections, safeSignalRecords, earningsSectionSymbolSets]);

  const signalRecordMap = useMemo(() => {
    const map = new Map<string, SignalRecord>();
    for (const record of enrichedSignalRecords) { const symbol = String(record.symbol ?? "").trim().toUpperCase(); if (!symbol) continue; map.set(symbol, record); }
    return map;
  }, [enrichedSignalRecords]);

  const dynamicSymbolSet = useMemo(() => new Set(dynamicSymbols.map((x) => String(x).trim().toUpperCase()).filter(Boolean)), [dynamicSymbols]);

  const topBuySection = useMemo<PickerSection | null>(() => {
    const items = safeSignalRecords
      .map((r) => ({ symbol: r.symbol, buyCount: getBuySignalCount(r), dashboardHref: toChartHref(r.dashboardHref ?? "", r.symbol) }))
      .filter((i) => i.buyCount > 0)
      .sort((a, b) => b.buyCount !== a.buyCount ? b.buyCount - a.buyCount : a.symbol.localeCompare(b.symbol))
      .slice(0, 4)
      .map((i) => ({ symbol: i.symbol, note: `${i.buyCount} buy signal${i.buyCount === 1 ? "" : "s"}`, tone: "green" as PickerTone, dashboardHref: i.dashboardHref }));
    if (!items.length) return null;
    return { title: "Top Stocks With Buy Signals (Live Scan)", items };
  }, [safeSignalRecords]);

  const topSellSection = useMemo<PickerSection | null>(() => {
    const items = safeSignalRecords
      .map((r) => ({ symbol: r.symbol, sellCount: getSellSignalCount(r), dashboardHref: toChartHref(r.dashboardHref ?? "", r.symbol) }))
      .filter((i) => i.sellCount > 0)
      .sort((a, b) => b.sellCount !== a.sellCount ? b.sellCount - a.sellCount : a.symbol.localeCompare(b.symbol))
      .slice(0, 4)
      .map((i) => ({ symbol: i.symbol, note: `${i.sellCount} sell signal${i.sellCount === 1 ? "" : "s"}`, tone: "red" as PickerTone, dashboardHref: i.dashboardHref }));
    if (!items.length) return null;
    return { title: "Top Stocks With Sell Signals (Bearish Setups)", items };
  }, [safeSignalRecords]);

  const displaySections = useMemo(() => {
    const out: PickerSection[] = [];
    const ma200 = safeSections.find((s) => s.title.toLowerCase().includes("200-day"));
    const buyDip = safeSections.find((s) => s.title.includes("All-Time Highs"));
    const athBreak = safeSections.find((s) => s.title.includes("All-Time High Breakout"));
    const threeMonth = safeSections.find((s) => s.title.includes("3-Month High Breakout"));
    const oversold = safeSections.find((s) => s.title.toLowerCase().includes("oversold"));
    const macroSR = safeSections.find((s) => { const t = s.title.toLowerCase(); return t.includes("macro") && t.includes("support") && t.includes("resistance"); });
    const others = safeSections.filter((s) => s !== ma200 && s !== buyDip && s !== athBreak && s !== threeMonth && s !== oversold && s !== macroSR && !s.title.toLowerCase().includes("hot market names"));
    if (ma200) out.push(ma200);
    if (topBuySection) out.push(topBuySection);
    if (buyDip) out.push(buyDip);
    if (macroSR) out.push(macroSR);
    if (athBreak) out.push(athBreak);
    if (threeMonth) out.push(threeMonth);
    if (topSellSection) out.push(topSellSection);
    if (oversold) out.push(oversold);
    return [...out, ...others];
  }, [safeSections, topBuySection, topSellSection]);

  const customMode = selectedFilters.length > 0;

  const customMatches = useMemo(() => {
    if (!customMode) return [];
    return enrichedSignalRecords
      .filter((record) => selectedFilters.every((filter) => record[filter] === true))
      .map((record) => { const matchedSignals = matchedSignalsForRecord(record).filter((key) => selectedFilters.includes(key)); return { ...record, matchedSignals, displayTone: chooseCardTone(record, matchedSignals) }; })
      .sort((a, b) => { const d = b.matchedSignals.length - a.matchedSignals.length; return d !== 0 ? d : a.symbol.localeCompare(b.symbol); });
  }, [customMode, enrichedSignalRecords, selectedFilters]);

  function toggleFilter(key: FilterKey) { setSelectedFilters((prev) => prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]); }
  function clearFilters() { setSelectedFilters([]); }
  function handleScreenerButton() { setScreenerOpen((prev) => !prev); }

  return (
    <section aria-label="Live stock idea results" style={{ width: "100%", minWidth: 0 }}>
      <style>{`
  @keyframes pickersBar { 0%{transform:translateX(-60%);opacity:0.55;} 50%{transform:translateX(140%);opacity:0.95;} 100%{transform:translateX(320%);opacity:0.55;} }
  .pickers-loading-bar { height:100%;width:35%;border-radius:999px;background:rgba(59,130,246,0.90);animation:pickersBar 1.1s linear infinite; }
  .pickers-shell { width:100%;min-width:0; }
  .pickers-sections-grid { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;align-items:start; }
  .picker-row { display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.06); }
  .picker-row:last-child { border-bottom:none; }
  .picker-row-left { display:flex;align-items:center;gap:8px;min-width:0;flex:1; }
  .picker-row-ticker { font-size:14px;font-weight:700;color:#e2e8f0;letter-spacing:0.01em; }
  .picker-row-note { font-size:11px;color:rgba(148,163,184,0.65);font-weight:400;margin-left:2px; }
  .picker-row-link { font-size:11px;font-weight:600;color:rgba(148,163,184,0.55);text-decoration:none;white-space:nowrap;flex:0 0 auto;transition:color 120ms ease; }
  .picker-row-link:hover { color:#93c5fd !important; }
  /* See all — green button, always visible including mobile */
  .pickers-see-all { display:inline-flex !important;align-items:center;padding:4px 10px;border-radius:7px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);font-size:11px;font-weight:600;color:#4ade80;text-decoration:none;transition:color 120ms ease,background 120ms ease; }
  .pickers-see-all:hover { background:rgba(255,255,255,0.07);color:#86efac !important;filter:none !important;transform:none !important; }
  .pattern-plays-grid { display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px; }
  .pattern-play-card:hover { transform:translateY(-2px);filter:brightness(1.08); }
  .pickers-filter-grid { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px; }
  .pickers-card-grid { display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px; }
  .pickers-section-title { display:flex;align-items:center;gap:6px;flex-wrap:nowrap; }
  .pickers-section-title-text { min-width:0;line-height:1.22;font-size:14px;font-weight:700; }
  .pickers-screener-panel { display:block; }
  .pickers-earnings-fetch-button:hover:not(:disabled) { filter:brightness(1.08);transform:translateY(-1px); }
  @media (max-width: 1100px) {
    .pickers-sections-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .pattern-plays-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .pickers-filter-grid { grid-template-columns:repeat(3,minmax(0,1fr)); }
  }
  @media (max-width: 820px) {
    .pickers-filter-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .pickers-card-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
  }
  @media (max-width: 640px) {
    .pickers-screener-panel { display:none !important; }
    .pickers-sections-grid { grid-template-columns:repeat(2,minmax(0,1fr)) !important;gap:8px; }
    .pattern-plays-grid { grid-template-columns:repeat(2,minmax(0,1fr)) !important;gap:8px; }
    .pickers-section-description { display:none; }
    .pickers-help-tip { width:18px !important;height:18px !important;font-size:10px !important; }
    .pickers-section-title-text { font-size:13px !important; }
    .picker-row-note { display:none; }
    /* Explicitly keep See All visible and full-width on mobile */
    .pickers-see-all { display:inline-flex !important;width:100%;justify-content:center;padding:6px 10px;font-size:12px; }
  }
  @media (max-width: 400px) {
    .pickers-sections-grid { grid-template-columns:minmax(0,1fr) !important; }
    .pattern-plays-grid { grid-template-columns:minmax(0,1fr) !important; }
  }
`}</style>

      {loading ? (
        <div style={{ border: "1px solid rgba(255,255,255,0.10)", borderRadius: 14, padding: 18, background: "#0b1220", boxSizing: "border-box" }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Gathering stocks, please wait…</div>
          <div style={{ marginTop: 6, fontSize: 13, opacity: 0.65 }}>First load can take 10–15 seconds. Cached loads are faster.</div>
          <div style={{ marginTop: 14, width: 360, maxWidth: "100%", height: 6, borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,0.07)" }}>
            <div className="pickers-loading-bar" />
          </div>
        </div>
      ) : null}

      {err ? <div style={{ border: "1px solid rgba(239,68,68,0.18)", borderRadius: 12, padding: 14, background: "rgba(239,68,68,0.06)", color: "#fecaca", fontSize: 14 }}>{err}</div> : null}

      {/* Screener panel — desktop only */}
      {!loading && !err ? (
        <section className="pickers-screener-panel" style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "12px 16px", background: "rgba(255,255,255,0.02)", marginBottom: 14, boxSizing: "border-box" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "#e2e8f0" }}>Custom Screener</span>
              <span style={{ fontSize: 14, color: "rgba(148,163,184,0.75)", fontWeight: 400 }}>Select conditions — only stocks matching all will show.</span>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flex: "0 0 auto" }}>
              <button type="button" onClick={handleScreenerButton} style={{ display: "inline-flex", alignItems: "center", minHeight: 32, padding: "6px 12px", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap", border: "1px solid rgba(34,197,94,0.28)", background: screenerOpen ? "rgba(34,197,94,0.14)" : "rgba(34,197,94,0.06)", color: "#86efac" }}>
                {screenerOpen ? "Hide" : "Open Filters"}
              </button>
              {customMode ? <button type="button" onClick={clearFilters} style={{ display: "inline-flex", alignItems: "center", minHeight: 32, padding: "6px 12px", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap", border: "1px solid rgba(239,68,68,0.28)", background: "rgba(239,68,68,0.06)", color: "#fca5a5" }}>Clear ({selectedFilters.length})</button> : null}
            </div>
          </div>
          <div style={{ marginTop: screenerOpen ? 10 : 0, maxHeight: screenerOpen ? 1200 : 0, opacity: screenerOpen ? 1 : 0, overflow: "hidden", transition: "max-height 0.30s ease, opacity 0.18s ease, margin-top 0.20s ease" }}>
            <div className="pickers-filter-grid">
              {FILTER_DEFS.map((filter) => {
                const active = selectedFilters.includes(filter.key);
                return (
                  <button key={filter.key} type="button" onClick={() => toggleFilter(filter.key)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 10px", borderRadius: 9, border: active ? `1px solid ${toneDot(filter.tone)}` : "1px solid rgba(255,255,255,0.09)", background: active ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.02)", color: "#e2e8f0", textAlign: "left", fontWeight: active ? 700 : 500, fontSize: 12, cursor: "pointer", boxSizing: "border-box" }}>
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: toneDot(filter.tone), flex: "0 0 auto" }} />
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{filter.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      <div className="pickers-shell" style={{ marginTop: loading || err ? 16 : 0, display: "grid", gap: 12, boxSizing: "border-box" }}>
        {!loading && !err && !customMode ? <PatternPlaysSection /> : null}

        {customMode ? (
          <section style={{ border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12, padding: 14, background: "#0b1220", boxSizing: "border-box" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap", marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>Custom Screener Results</h2>
              <div style={{ fontSize: 12, opacity: 0.55 }}>{customMatches.length} {customMatches.length === 1 ? "match" : "matches"}</div>
            </div>
            {customMatches.length ? (
              <div className="pickers-card-grid">
                {customMatches.map((item) => (
                  <a key={item.symbol} href={toChartHref(item.dashboardHref ?? "", item.symbol)} style={{ display: "block", textDecoration: "none", color: "#f1f5f9", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 10, padding: 12, background: "rgba(255,255,255,0.03)", boxSizing: "border-box" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 999, background: toneDot(item.displayTone), flex: "0 0 auto" }} />
                        <span style={{ fontSize: 16, fontWeight: 700 }}>{item.symbol}</span>
                        {item.note ? <span style={{ fontSize: 11, opacity: 0.55 }}>{item.note}</span> : null}
                      </div>
                      <a href={toChartHref(item.dashboardHref ?? "", item.symbol)} onClick={(e) => e.stopPropagation()} style={{ fontSize: 11, fontWeight: 600, color: "rgba(148,163,184,0.55)", textDecoration: "none" }}>Chart ↗</a>
                    </div>
                    <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {item.matchedSignals.map((signal) => {
                        const def = FILTER_DEFS.find((f) => f.key === signal);
                        return <span key={`${item.symbol}-${signal}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 8px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.09)", background: "rgba(255,255,255,0.04)", fontSize: 11, fontWeight: 500 }}><span style={{ width: 6, height: 6, borderRadius: 999, background: toneDot(def?.tone), flex: "0 0 auto" }} />{getFilterLabel(signal)}</span>;
                      })}
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 14, opacity: 0.65, padding: "10px 0" }}>No stocks currently match all selected filters. Try removing one condition.</div>
            )}
          </section>
        ) : (
          <div className="pickers-sections-grid pickers-shell">
            {displaySections.map((sec) => {
              const items = Array.isArray(sec.items)
                ? sec.items.map((it) => {
                    const symbol = String(it.symbol ?? "").trim().toUpperCase();
                    const record = signalRecordMap.get(symbol);
                    const checkCount = record ? matchedSignalsForRecord(record).length : 0;
                    const isDynamic = dynamicSymbolSet.has(symbol);
                    return { ...it, symbol, checkCount, isDynamic };
                  }).slice(0, 4)
                : [];

              return (
                <section key={sec.title} style={{ borderRadius: 12, padding: "12px 14px", background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.08)", boxSizing: "border-box" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "center", marginBottom: 8 }}>
                    <h2 className="pickers-section-title" style={{ margin: 0, display: "flex", alignItems: "center", gap: 5, flexWrap: "nowrap", flex: 1, minWidth: 0 }}>
                      <span className="pickers-section-title-text">{sec.title}</span>
                      <HelpTip text={getHeaderHelp(sec.title)} />
                    </h2>
                    <span style={{ fontSize: 10, opacity: 0.40, flex: "0 0 auto" }}>{typeof sec.foundCount === "number" ? sec.foundCount : items.length}</span>
                  </div>

                  <div>
                    {items.map((it) => (
                      <div key={it.symbol} className="picker-row">
                        <div className="picker-row-left">
                          <span style={{ width: 6, height: 6, borderRadius: 999, background: toneDot(it.tone), flex: "0 0 auto" }} />
                          <a href={toChartHref(it.dashboardHref ?? "", it.symbol)} className="picker-row-ticker" style={{ textDecoration: "none" }}>
                            {it.symbol}
                          </a>
                          {it.note ? <span className="picker-row-note">{it.note}</span> : null}
                        </div>
                        <a href={toChartHref(it.dashboardHref ?? "", it.symbol)} className="picker-row-link">Chart ↗</a>
                      </div>
                    ))}
                  </div>

                  {sec.title.toLowerCase().includes("earnings") ? (
                    <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="pickers-earnings-fetch-button" onClick={handleFetchEarnings} disabled={earningsFetchBusy || earningsFetchRemainingSeconds > 0} style={{ display: "inline-flex", alignItems: "center", minHeight: 28, padding: "4px 10px", borderRadius: 7, border: "1px solid rgba(34,197,94,0.24)", background: "rgba(34,197,94,0.06)", color: "rgba(134,239,172,0.80)", fontSize: 11, fontWeight: 600, cursor: earningsFetchBusy || earningsFetchRemainingSeconds > 0 ? "not-allowed" : "pointer", opacity: earningsFetchBusy || earningsFetchRemainingSeconds > 0 ? 0.65 : 1, whiteSpace: "nowrap" }}>
                        {earningsFetchBusy ? "Fetching…" : earningsFetchRemainingSeconds > 0 ? `Fetch (${earningsFetchRemainingSeconds}s)` : "Fetch Earnings"}
                      </button>
                      {earningsFetchMessage ? <span style={{ fontSize: 11, opacity: 0.55, lineHeight: 1.4 }}>{earningsFetchMessage}</span> : null}
                    </div>
                  ) : null}

                  {(() => {
                    const title = sec.title.toLowerCase();
                    let seoHref = "";
                    if (title.includes("positive last earnings")) seoHref = "/stocks-with-positive-last-earnings";
                    else if (title.includes("strong earnings growth")) seoHref = "/stocks-with-strong-earnings-growth";
                    else if (title.includes("all-time high breakout")) seoHref = "/all-time-high-breakout-stocks";
                    else if (title.includes("3-month high breakout")) seoHref = "/3-month-high-breakout-stocks";
                    else if (title.includes("all-time highs")) seoHref = "/stocks-down-20-from-all-time-highs";
                    else if (title.includes("macro") && title.includes("support") && title.includes("resistance")) seoHref = "/macro-support-resistance-stocks";
                    else if (title.includes("buy signals")) seoHref = "/top-stocks-with-buy-signals";
                    else if (title.includes("sell signals")) seoHref = "/top-stocks-with-sell-signals";
                    else if (title.includes("oversold")) seoHref = "/oversold-stocks-today";
                    else if (title.includes("overbought")) seoHref = "/overbought-stocks-today";
                    else if (title.includes("best trend score")) seoHref = "/best-trend-score-stocks";
                    else if (title.includes("divergence")) seoHref = "/bullish-bearish-divergence-stocks";
                    else if (title.includes("200")) seoHref = "/stocks-near-200-day-moving-average";
                    if (!seoHref) return null;
                    return (
                      <div style={{ marginTop: 8, textAlign: "center" }}>
                        <a href={seoHref} className="pickers-see-all">See all →</a>
                      </div>
                    );
                  })()}
                </section>
              );
            })}
          </div>
        )}

        {!loading && !err && SHOW_FORCE_FETCH_BUTTON ? (
          <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
            <button type="button" onClick={() => { void loadPickers(true); }} disabled={forceRefreshing} style={{ minHeight: 38, padding: "8px 14px", borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: forceRefreshing ? "wait" : "pointer", border: "1px solid rgba(59,130,246,0.24)", background: "rgba(59,130,246,0.06)", color: "#93c5fd", opacity: forceRefreshing ? 0.70 : 1 }}>
              {forceRefreshing ? "Refreshing…" : "Force Refresh"}
            </button>
          </div>
        ) : null}

        {!loading && !err && (updatedAt || universeSize) ? (
          <div style={{ marginTop: 4, fontSize: 10, lineHeight: 1.5, opacity: 0.28, textAlign: "right", userSelect: "none" }}>
            {updatedAt ? <div>{new Date(updatedAt).toLocaleString()}</div> : null}
            {universeSize != null ? <div>Universe: {universeSize}</div> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
