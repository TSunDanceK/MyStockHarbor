"use client";

import React, { useEffect, useMemo, useState } from "react";

type PickerTone = "green" | "yellow" | "orange" | "red";

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
  dailyMa200Proximity: boolean;
  weeklyMa200Proximity: boolean;

  bullishRsiDivergence: boolean;
  bearishRsiDivergence: boolean;
  bullishMacdDivergence: boolean;
  bearishMacdDivergence: boolean;
  positiveLastEarnings?: boolean;
  strongEarningsGrowth?: boolean;

  preferredTimeframe?: "D" | "W" | "M";
  preferredIndicator?: "MA200" | "RSI(14)" | "MACD(12,26,9)";
  dashboardHref?: string;
  isDynamicUniverse?: boolean;
};

type PickersPayload = {
  updatedAt?: string;
  universeSize?: number;
  dynamicUniverseCount?: number;
  dynamicUniversePreview?: string[];
  dynamicSymbols?: string[];
  estimatedApiCalls?: number;
  sections?: PickerSection[];
  signalRecords?: SignalRecord[];
};

type FilterKey =
  | "oversold"
  | "overbought"
  | "buyTheDip"
  | "breakout"
  | "volumeSpike"
  | "atrSpike"
  | "aboveMA50"
  | "belowMA50"
  | "aboveMA200"
  | "belowMA200"
  | "dailyMa200Proximity"
  | "weeklyMa200Proximity"
  | "bullishRsiDivergence"
  | "bearishRsiDivergence"
  | "bullishMacdDivergence"
  | "bearishMacdDivergence"
  | "positiveLastEarnings"
  | "strongEarningsGrowth";

type FilterDef = {
  key: FilterKey;
  label: string;
  tone: PickerTone;
};

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
  return "rgba(255,255,255,0.35)";
}

function toChartHref(href: string) {
  if (!href) return "/#chart";
  if (href.includes("#chart")) return href;
  return `${href}#chart`;
}

function getFilterLabel(key: FilterKey) {
  return FILTER_DEFS.find((f) => f.key === key)?.label ?? key;
}

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

function chooseCardTone(
  record: SignalRecord,
  matchedFilters: FilterKey[]
): PickerTone | undefined {
  for (const key of matchedFilters) {
    const def = FILTER_DEFS.find((f) => f.key === key);
    if (def?.tone === "green") return "green";
  }

  for (const key of matchedFilters) {
    const def = FILTER_DEFS.find((f) => f.key === key);
    if (def?.tone === "red") return "red";
  }

  for (const key of matchedFilters) {
    const def = FILTER_DEFS.find((f) => f.key === key);
    if (def?.tone === "orange") return "orange";
  }

  return record.tone;
}

function getBuySignalCount(record: SignalRecord) {
  if (!record.aboveMA200) return 0;

  let count = 0;

  if (record.oversold) count += 1;
  if (record.buyTheDip) count += 1;
  if (record.breakout) count += 1;
  if (record.volumeSpike) count += 1;
  if (record.atrSpike) count += 1;
  if (record.aboveMA50) count += 1;
  if (record.aboveMA200) count += 1;
  if (record.bullishRsiDivergence) count += 1;
  if (record.bullishMacdDivergence) count += 1;

  return count;
}

function getSellSignalCount(record: SignalRecord) {
  let count = 0;

  if (record.overbought) count += 1;
  if (record.belowMA50) count += 1;
  if (record.belowMA200) count += 1;
  if (record.bearishRsiDivergence) count += 1;
  if (record.bearishMacdDivergence) count += 1;

  return count;
}

function getHeaderHelp(title: string) {
  if (title.includes("Buy Signals")) {
    return "These highlight stocks showing multiple bullish technical conditions at the same time. Some may already be strong movers, so always review the chart before entering.";
  }

  if (title.includes("Sell Signals")) {
    return "These highlight stocks showing multiple bearish technical conditions. Traders often review these for pullback risk, weaker trends, or possible short-side weakness.";
  }

  if (title.includes("Oversold")) {
    return "These are ranked oversold setups, not just raw matches. The list leans toward stronger oversold readings, better liquidity, sharper exhaustion moves and cleaner rebound potential.";
  }

  if (title.includes("Best Trend Score")) {
    return "These stocks have the strongest current trend structure based on price relative to MA50 and MA200, moving average alignment, and positive MACD momentum.";
  }

  if (title.includes("Positive Last Earnings")) {
    return "These stocks rank well on the latest completed earnings report, giving preference to EPS beats, revenue beats, positive EPS and recent reports.";
  }

  if (title.includes("Strong Earnings Growth")) {
    return "These stocks rank well on year-over-year earnings improvement, recent positive EPS consistency, revenue growth and earnings beat history.";
  }

  if (title.includes("Overbought")) {
    return "These are ranked overbought setups, not just raw matches. The list leans toward stronger extension, better liquidity and cleaner pullback-risk profiles.";
  }

  if (title.includes("Divergence")) {
    return "Divergence is ranked by timeframe, duration, structure quality, magnitude and context. Weekly divergences usually carry more weight than daily ones.";
  }

  if (title.includes("All-Time Highs")) {
    return "These are pullback setups from all-time highs, ranked to favour liquid, tradable names over weak broken charts. A stock being down more does not automatically make it better.";
  }

if (title.toLowerCase().includes("200-day")) {
  return "These stocks are trading near the 200-day moving average, a key long-term level many traders watch for support, resistance and trend direction.";
}

  if (title.includes("Breakout")) {
    return "Breakouts are ranked to favour newer, cleaner and more liquid breakouts over older or more stretched moves.";
  }

  if (title.includes("Hot Market Names")) {
    return "These names come from the current dynamic universe and are also triggering meaningful technical conditions right now.";
  }

  return "These stocks match multiple technical conditions worth reviewing on the chart.";
}

function HelpTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className="pickers-help-tip"
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 16,
        height: 16,
        borderRadius: "50%",
        background: "rgba(255,255,255,0.15)",
        color: "#fff",
        fontSize: 11,
        fontWeight: 900,
        cursor: "pointer",
        marginLeft: 2,
        flex: "0 0 auto",
      }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen((v) => !v)}
    >
      ?
      {open ? (
        <span
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            zIndex: 999,
            width: 260,
            maxWidth: "min(260px, 78vw)",
            padding: "10px 12px",
            borderRadius: 12,
            background: "#0f172a",
            border: "1px solid rgba(255,255,255,0.14)",
            color: "#e5e7eb",
            fontSize: 12,
            lineHeight: 1.5,
            fontWeight: 700,
            boxShadow: "0 14px 30px rgba(0,0,0,0.35)",
            textAlign: "left",
            pointerEvents: "none",
          }}
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}


function createEmptySignalRecord(symbol: string, item?: PickerItem): SignalRecord {
  const cleanSymbol = String(symbol || "").trim().toUpperCase();

  return {
    symbol: cleanSymbol,
    note: item?.note,
    tone: item?.tone,
    oversold: false,
    overbought: false,
    buyTheDip: false,
    breakout: false,
    volumeSpike: false,
    atrSpike: false,
    aboveMA50: false,
    belowMA50: false,
    aboveMA200: false,
    belowMA200: false,
    dailyMa200Proximity: false,
    weeklyMa200Proximity: false,
    bullishRsiDivergence: false,
    bearishRsiDivergence: false,
    bullishMacdDivergence: false,
    bearishMacdDivergence: false,
    positiveLastEarnings: false,
    strongEarningsGrowth: false,
    preferredTimeframe: item?.timeframe,
    preferredIndicator: item?.indicator,
    dashboardHref:
      item?.dashboardHref ??
      `/?symbol=${encodeURIComponent(cleanSymbol)}#chart`,
  };
}


type PlayCardDef = {
  title: string;
  subtitle: string;
  href: string;
  tone: "green" | "red" | "blue";
  pattern: "ascending" | "descending" | "bullFlag";
};

const PLAY_CARDS: PlayCardDef[] = [
  {
    title: "Ascending Triangle Plays",
    subtitle: "Bullish compression setups with flat resistance and rising lows.",
    href: "/plays",
    tone: "green",
    pattern: "ascending",
  },
  {
    title: "Descending Triangle Plays",
    subtitle: "Bearish compression setups with flat support and lower highs.",
    href: "/plays/descending-triangles",
    tone: "red",
    pattern: "descending",
  },
  {
    title: "Bull Flag Plays",
    subtitle: "Momentum continuation setups after a sharp impulse and tight flag.",
    href: "/plays/bull-flags",
    tone: "blue",
    pattern: "bullFlag",
  },
];

function playTone(tone: PlayCardDef["tone"]) {
  if (tone === "green") {
    return {
      dot: "#22c55e",
      border: "rgba(34,197,94,0.26)",
      bg: "linear-gradient(180deg, rgba(8,24,18,0.92), rgba(8,13,22,0.98))",
      line: "#22c55e",
      accent: "#60a5fa",
      buttonBg: "rgba(34,197,94,0.10)",
      buttonColor: "#dcfce7",
    };
  }

  if (tone === "red") {
    return {
      dot: "#ef4444",
      border: "rgba(239,68,68,0.26)",
      bg: "linear-gradient(180deg, rgba(32,12,18,0.92), rgba(8,13,22,0.98))",
      line: "#ef4444",
      accent: "#60a5fa",
      buttonBg: "rgba(239,68,68,0.10)",
      buttonColor: "#fecaca",
    };
  }

  return {
    dot: "#60a5fa",
    border: "rgba(96,165,250,0.26)",
    bg: "linear-gradient(180deg, rgba(10,18,36,0.94), rgba(8,13,22,0.98))",
    line: "#60a5fa",
    accent: "#22c55e",
    buttonBg: "rgba(59,130,246,0.10)",
    buttonColor: "#dbeafe",
  };
}

function PlayDiagram({ pattern, tone }: { pattern: PlayCardDef["pattern"]; tone: PlayCardDef["tone"] }) {
  const colors = playTone(tone);

  if (pattern === "descending") {
    return (
      <svg viewBox="0 0 320 138" className="playDiagram" role="img" aria-label="Descending triangle diagram">
        <rect x="0" y="0" width="320" height="138" rx="16" fill="rgba(2,6,23,0.72)" />

        <path
          d="M42 108 H282"
          stroke={colors.line}
          strokeWidth="3"
          strokeDasharray="7 7"
          strokeLinecap="round"
        />

        <path
          d="M44 38 L282 108"
          stroke={colors.accent}
          strokeWidth="3"
          strokeLinecap="round"
        />

        <path
          d="M46 44 L74 108 L104 56 L132 108 L162 72 L190 108 L220 88 L250 108 L278 105"
          stroke="rgba(226,232,240,0.80)"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <path
          d="M52 126 V114 M86 126 V115 M120 126 V112 M154 126 V115 M188 126 V112 M222 126 V115 M256 126 V113 M290 126 V116"
          stroke="rgba(59,130,246,0.30)"
          strokeWidth="5"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (pattern === "bullFlag") {
    return (
      <svg viewBox="0 0 320 138" className="playDiagram" role="img" aria-label="Bull flag diagram">
        <rect x="0" y="0" width="320" height="138" rx="16" fill="rgba(2,6,23,0.72)" />

        <path
          d="M34 108 L62 96 L84 73 L104 36"
          stroke="#22c55e"
          strokeWidth="5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <path
          d="M106 36 L144 52 L184 46 L222 61 L262 54"
          stroke="rgba(226,232,240,0.80)"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <path
          d="M108 34 L272 53"
          stroke={colors.line}
          strokeWidth="3"
          strokeDasharray="7 7"
          strokeLinecap="round"
        />

        <path
          d="M102 66 L266 85"
          stroke={colors.line}
          strokeWidth="3"
          strokeDasharray="7 7"
          strokeLinecap="round"
        />

        <path
          d="M262 54 L292 36"
          stroke="#22c55e"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path
          d="M292 36 L276 37 M292 36 L286 51"
          stroke="#22c55e"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <path
          d="M42 126 V112 M76 126 V101 M110 126 V84 M144 126 V103 M178 126 V97 M212 126 V106 M246 126 V100 M280 126 V94"
          stroke="rgba(59,130,246,0.30)"
          strokeWidth="5"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 320 138" className="playDiagram" role="img" aria-label="Ascending triangle diagram">
      <rect x="0" y="0" width="320" height="138" rx="16" fill="rgba(2,6,23,0.72)" />

      <path
        d="M42 36 H282"
        stroke={colors.line}
        strokeWidth="3"
        strokeDasharray="7 7"
        strokeLinecap="round"
      />

      <path
        d="M44 108 L282 36"
        stroke={colors.accent}
        strokeWidth="3"
        strokeLinecap="round"
      />

      <path
        d="M46 94 L76 36 L106 84 L136 36 L166 72 L196 36 L226 58 L256 36 L282 38"
        stroke="rgba(226,232,240,0.80)"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <path
        d="M52 126 V114 M86 126 V105 M120 126 V112 M154 126 V99 M188 126 V108 M222 126 V92 M256 126 V100 M290 126 V84"
        stroke="rgba(59,130,246,0.30)"
        strokeWidth="5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PatternPlaysSection() {
  return (
    <section
      className="pattern-plays-panel"
      style={{
        border: "1px solid rgba(59,130,246,0.18)",
        borderRadius: 18,
        padding: 16,
        background: "linear-gradient(180deg, rgba(8,13,26,0.98), rgba(6,10,18,1))",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "flex-end",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "7px 11px",
              borderRadius: 999,
              border: "1px solid rgba(96,165,250,0.28)",
              background: "rgba(59,130,246,0.10)",
              color: "#dbeafe",
              fontSize: 11,
              fontWeight: 950,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Chart pattern plays
          </div>

          <h2
            style={{
              margin: "12px 0 0",
              fontSize: 25,
              lineHeight: 1.12,
              letterSpacing: "-0.035em",
            }}
          >
            Pattern setups that need the chart
          </h2>

          <p
            style={{
              margin: "8px 0 0",
              maxWidth: 760,
              color: "rgba(226,232,240,0.74)",
              fontSize: 14,
              lineHeight: 1.65,
            }}
          >
            These are visual chart-pattern pages, so the cards below act as quick links
            into the full play pages rather than simple ticker lists.
          </p>
        </div>
      </div>

      <div className="pattern-plays-grid">
        {PLAY_CARDS.map((play) => {
          const colors = playTone(play.tone);

          return (
            <a
              key={play.href}
              href={play.href}
              className="pattern-play-card"
              style={{
                border: `1px solid ${colors.border}`,
                background: colors.bg,
                color: "#f8fafc",
              }}
            >
              <PlayDiagram pattern={play.pattern} tone={play.tone} />

              <div className="pattern-play-copy">
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minWidth: 0,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      background: colors.dot,
                      boxShadow: `0 0 14px ${colors.dot}66`,
                      flex: "0 0 auto",
                    }}
                  />
                  <h3>{play.title}</h3>
                </div>

                <p>{play.subtitle}</p>

                <span
                  className="pattern-play-button"
                  style={{
                    borderColor: colors.border,
                    background: colors.buttonBg,
                    color: colors.buttonColor,
                  }}
                >
                  Open plays →
                </span>
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

  const earningsFetchRemainingSeconds = Math.max(
    0,
    Math.ceil((earningsFetchLockedUntil - Date.now()) / 1000)
  );

  async function handleFetchEarnings() {
    if (earningsFetchBusy || Date.now() < earningsFetchLockedUntil) return;

    setEarningsFetchBusy(true);
    setEarningsFetchMessage(null);

    try {
      const res = await fetch(`/api/jobs/warm-earnings?t=${Date.now()}`, {
        cache: "no-store",
      });

      if (!res.ok) throw new Error("Earnings warm-up failed");

      const data = (await res.json()) as {
        fetchedCount?: number;
        checked?: number;
        deferredCount?: number;
        failedCount?: number;
      };

      const fetched = typeof data?.fetchedCount === "number" ? data.fetchedCount : 0;
      const checked = typeof data?.checked === "number" ? data.checked : 0;
      const deferred = typeof data?.deferredCount === "number" ? data.deferredCount : 0;
      const failed = typeof data?.failedCount === "number" ? data.failedCount : 0;

      setEarningsFetchMessage(
        `Earnings warm-up checked ${checked} symbols, fetched ${fetched}, deferred ${deferred}, failed ${failed}.`
      );

      const lockUntil = Date.now() + EARNINGS_FETCH_LOCK_MS;
      setEarningsFetchLockedUntil(lockUntil);

      try {
        window.localStorage.setItem("msh:lastEarningsFetchUntil", String(lockUntil));
      } catch {
        // Ignore localStorage issues.
      }

      // Refresh the picker payload after earnings warm-up so the earnings cards
      // can immediately use the newly fetched data instead of appearing unchanged.
      await loadPickers(true);
    } catch {
      setEarningsFetchMessage("Earnings warm-up failed. Try again in a moment.");
    } finally {
      setEarningsFetchBusy(false);
    }
  }

  async function loadPickers(force = false) {
    const setBusy = force ? setForceRefreshing : setLoading;

    setBusy(true);
    setErr(null);

    try {
const url = force
  ? `/api/pickers?force=1&t=${Date.now()}`
  : `/api/pickers?t=${Date.now()}`;

const res = await fetch(url, { cache: "no-store" });

      if (!res.ok) throw new Error("Pickers API failed");

      const data = (await res.json()) as PickersPayload;
      const safeSections = Array.isArray(data?.sections) ? data.sections : [];
      const safeSignalRecords = Array.isArray(data?.signalRecords)
        ? data.signalRecords
        : [];

      setSections(safeSections);
      setSignalRecords(safeSignalRecords);
      setUpdatedAt(typeof data?.updatedAt === "string" ? data.updatedAt : null);
      setUniverseSize(typeof data?.universeSize === "number" ? data.universeSize : null);
      setDynamicUniverseCount(
        typeof data?.dynamicUniverseCount === "number"
          ? data.dynamicUniverseCount
          : null
      );
      setDynamicUniversePreview(
        Array.isArray(data?.dynamicUniversePreview)
          ? data.dynamicUniversePreview
          : null
      );
      setDynamicSymbols(
        Array.isArray(data?.dynamicSymbols)
          ? data.dynamicSymbols
              .map((x) => String(x).trim().toUpperCase())
              .filter(Boolean)
          : []
      );
      setEstimatedApiCalls(
        typeof data?.estimatedApiCalls === "number"
          ? data.estimatedApiCalls
          : null
      );
    } catch {
      setErr(force ? "Force refresh failed." : "Failed to load stock ideas.");

      if (!force) {
        setSections([]);
        setSignalRecords([]);
        setUpdatedAt(null);
        setUniverseSize(null);
        setDynamicUniverseCount(null);
        setDynamicUniversePreview(null);
        setDynamicSymbols([]);
        setEstimatedApiCalls(null);
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem("msh:lastEarningsFetchUntil") || "0");
      if (Number.isFinite(saved) && saved > Date.now()) {
        setEarningsFetchLockedUntil(saved);
      }
    } catch {
      // Ignore localStorage issues.
    }
  }, []);

  useEffect(() => {
    if (!earningsFetchLockedUntil) return;

    const interval = window.setInterval(() => {
      setEarningsFetchTick((value) => value + 1);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [earningsFetchLockedUntil]);

  useEffect(() => {
    if (!earningsFetchLockedUntil) return;
    if (Date.now() < earningsFetchLockedUntil) return;

    setEarningsFetchLockedUntil(0);

    try {
      window.localStorage.removeItem("msh:lastEarningsFetchUntil");
    } catch {
      // Ignore localStorage issues.
    }
  }, [earningsFetchTick, earningsFetchLockedUntil]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);

      try {
const res = await fetch(`/api/pickers?t=${Date.now()}`, {
  cache: "no-store",
});
        if (!res.ok) throw new Error("Pickers API failed");

        const data = (await res.json()) as PickersPayload;
        const safeSections = Array.isArray(data?.sections) ? data.sections : [];
        const safeSignalRecords = Array.isArray(data?.signalRecords)
          ? data.signalRecords
          : [];

        if (!cancelled) {
          setSections(safeSections);
          setSignalRecords(safeSignalRecords);
          setUpdatedAt(typeof data?.updatedAt === "string" ? data.updatedAt : null);
          setUniverseSize(typeof data?.universeSize === "number" ? data.universeSize : null);
          setDynamicUniverseCount(
            typeof data?.dynamicUniverseCount === "number"
              ? data.dynamicUniverseCount
              : null
          );
          setDynamicUniversePreview(
            Array.isArray(data?.dynamicUniversePreview)
              ? data.dynamicUniversePreview
              : null
          );
          setDynamicSymbols(
            Array.isArray(data?.dynamicSymbols)
              ? data.dynamicSymbols
                  .map((x) => String(x).trim().toUpperCase())
                  .filter(Boolean)
              : []
          );
          setEstimatedApiCalls(
            typeof data?.estimatedApiCalls === "number"
              ? data.estimatedApiCalls
              : null
          );
        }
      } catch {
        if (!cancelled) {
          setErr("Failed to load stock ideas.");
          setSections([]);
          setSignalRecords([]);
          setUpdatedAt(null);
          setUniverseSize(null);
          setDynamicUniverseCount(null);
          setDynamicUniversePreview(null);
          setDynamicSymbols([]);
          setEstimatedApiCalls(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const safeSections = useMemo(() => {
    return Array.isArray(sections) ? sections : [];
  }, [sections]);

  const safeSignalRecords = useMemo(() => {
    return Array.isArray(signalRecords) ? signalRecords : [];
  }, [signalRecords]);

  const earningsSectionSymbolSets = useMemo(() => {
    const positiveLastEarnings = new Set<string>();
    const strongEarningsGrowth = new Set<string>();

    for (const section of safeSections) {
      const title = String(section.title || "").toLowerCase();
      const isPositiveLastEarnings = title.includes("positive last earnings");
      const isStrongEarningsGrowth = title.includes("strong earnings growth");

      if (!isPositiveLastEarnings && !isStrongEarningsGrowth) continue;

      for (const item of Array.isArray(section.items) ? section.items : []) {
        const symbol = String(item.symbol || "").trim().toUpperCase();
        if (!symbol) continue;

        if (isPositiveLastEarnings) positiveLastEarnings.add(symbol);
        if (isStrongEarningsGrowth) strongEarningsGrowth.add(symbol);
      }
    }

    return { positiveLastEarnings, strongEarningsGrowth };
  }, [safeSections]);

  const enrichedSignalRecords = useMemo(() => {
    const map = new Map<string, SignalRecord>();

    for (const record of safeSignalRecords) {
      const symbol = String(record.symbol ?? "").trim().toUpperCase();
      if (!symbol) continue;

      map.set(symbol, {
        ...record,
        symbol,
        positiveLastEarnings:
          record.positiveLastEarnings === true ||
          earningsSectionSymbolSets.positiveLastEarnings.has(symbol),
        strongEarningsGrowth:
          record.strongEarningsGrowth === true ||
          earningsSectionSymbolSets.strongEarningsGrowth.has(symbol),
      });
    }

    for (const section of safeSections) {
      const title = String(section.title || "").toLowerCase();
      const isPositiveLastEarnings = title.includes("positive last earnings");
      const isStrongEarningsGrowth = title.includes("strong earnings growth");

      if (!isPositiveLastEarnings && !isStrongEarningsGrowth) continue;

      for (const item of Array.isArray(section.items) ? section.items : []) {
        const symbol = String(item.symbol || "").trim().toUpperCase();
        if (!symbol) continue;

        const existing = map.get(symbol) ?? createEmptySignalRecord(symbol, item);

        map.set(symbol, {
          ...existing,
          note: existing.note ?? item.note,
          tone: existing.tone ?? item.tone,
          dashboardHref: existing.dashboardHref ?? item.dashboardHref,
          positiveLastEarnings:
            existing.positiveLastEarnings === true || isPositiveLastEarnings,
          strongEarningsGrowth:
            existing.strongEarningsGrowth === true || isStrongEarningsGrowth,
        });
      }
    }

    return Array.from(map.values());
  }, [safeSections, safeSignalRecords, earningsSectionSymbolSets]);

  const signalRecordMap = useMemo(() => {
    const map = new Map<string, SignalRecord>();

    for (const record of enrichedSignalRecords) {
      const symbol = String(record.symbol ?? "").trim().toUpperCase();
      if (!symbol) continue;
      map.set(symbol, record);
    }

    return map;
  }, [enrichedSignalRecords]);

  const dynamicSymbolSet = useMemo(() => {
    return new Set(
      dynamicSymbols.map((x) => String(x).trim().toUpperCase()).filter(Boolean)
    );
  }, [dynamicSymbols]);

  const topBuySection = useMemo<PickerSection | null>(() => {
    const items = safeSignalRecords
      .map((record) => ({
        symbol: record.symbol,
        buyCount: getBuySignalCount(record),
        dashboardHref: record.dashboardHref?.includes("#chart")
          ? record.dashboardHref
          : `${record.dashboardHref ?? `/?symbol=${encodeURIComponent(record.symbol)}`}#chart`,
      }))
      .filter((item) => item.buyCount > 0)
      .sort((a, b) => {
        if (b.buyCount !== a.buyCount) return b.buyCount - a.buyCount;
        return a.symbol.localeCompare(b.symbol);
      })
      .slice(0, 4)
      .map((item) => ({
        symbol: item.symbol,
        note: `${item.buyCount} buy signal${item.buyCount === 1 ? "" : "s"}`,
        tone: "green" as PickerTone,
        dashboardHref: item.dashboardHref,
      }));

    if (!items.length) return null;

    return {
      title: "Top Stocks With Buy Signals (Live Scan)",
      description:
        "Stocks showing multiple bullish technical conditions right now, ranked by how many buy signals are currently active.",
      items,
    };
  }, [safeSignalRecords]);

  const topSellSection = useMemo<PickerSection | null>(() => {
    const items = safeSignalRecords
      .map((record) => ({
        symbol: record.symbol,
        sellCount: getSellSignalCount(record),
        dashboardHref: record.dashboardHref?.includes("#chart")
          ? record.dashboardHref
          : `${record.dashboardHref ?? `/?symbol=${encodeURIComponent(record.symbol)}`}#chart`,
      }))
      .filter((item) => item.sellCount > 0)
      .sort((a, b) => {
        if (b.sellCount !== a.sellCount) return b.sellCount - a.sellCount;
        return a.symbol.localeCompare(b.symbol);
      })
      .slice(0, 4)
      .map((item) => ({
        symbol: item.symbol,
        note: `${item.sellCount} sell signal${item.sellCount === 1 ? "" : "s"}`,
        tone: "red" as PickerTone,
        dashboardHref: item.dashboardHref,
      }));

    if (!items.length) return null;

    return {
      title: "Top Stocks With Sell Signals (Bearish Setups)",
      description:
        "Stocks showing multiple bearish technical signals right now, ranked by how many sell signals are currently active.",
      items,
    };
  }, [safeSignalRecords]);

  const displaySections = useMemo(() => {
    const out: PickerSection[] = [];

    const ma200Section = safeSections.find((section) =>
      section.title.toLowerCase().includes("200-day")
    );

    const buyTheDipSection = safeSections.find((section) =>
      section.title.includes("All-Time Highs")
    );

    const athBreakoutSection = safeSections.find((section) =>
      section.title.includes("All-Time High Breakout")
    );

    const threeMonthBreakoutSection = safeSections.find((section) =>
      section.title.includes("3-Month High Breakout")
    );

    const oversoldSection = safeSections.find((section) =>
      section.title.toLowerCase().includes("oversold")
    );

    const otherSections = safeSections.filter(
      (section) =>
        section !== ma200Section &&
        section !== buyTheDipSection &&
        section !== athBreakoutSection &&
        section !== threeMonthBreakoutSection &&
        section !== oversoldSection &&
        !section.title.toLowerCase().includes("hot market names")
    );

    if (ma200Section) out.push(ma200Section);
    if (topBuySection) out.push(topBuySection);
    if (buyTheDipSection) out.push(buyTheDipSection);
    if (athBreakoutSection) out.push(athBreakoutSection);
    if (threeMonthBreakoutSection) out.push(threeMonthBreakoutSection);
    if (topSellSection) out.push(topSellSection);
    if (oversoldSection) out.push(oversoldSection);

    return [...out, ...otherSections];
  }, [safeSections, topBuySection, topSellSection]);

  const customMode = selectedFilters.length > 0;

  const customMatches = useMemo(() => {
    if (!customMode) return [];

    return enrichedSignalRecords
      .filter((record) => selectedFilters.every((filter) => record[filter] === true))
      .map((record) => {
        const matchedSignals = matchedSignalsForRecord(record).filter((key) =>
          selectedFilters.includes(key)
        );

        return {
          ...record,
          matchedSignals,
          displayTone: chooseCardTone(record, matchedSignals),
        };
      })
      .sort((a, b) => {
        const aCount = a.matchedSignals.length;
        const bCount = b.matchedSignals.length;
        if (bCount !== aCount) return bCount - aCount;
        return a.symbol.localeCompare(b.symbol);
      });
  }, [customMode, enrichedSignalRecords, selectedFilters]);

  function toggleFilter(key: FilterKey) {
    setSelectedFilters((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]
    );
  }

  function clearFilters() {
    setSelectedFilters([]);
  }

  function handleScreenerButton() {
    setScreenerOpen((prev) => !prev);
  }

  const actionButtonStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    padding: "10px 16px",
    borderRadius: 12,
    fontWeight: 900,
    fontSize: 14,
    cursor: "pointer",
    transition: "all 0.2s ease",
    whiteSpace: "nowrap",
  };

  return (
    <section
      aria-label="Live stock idea results"
      style={{
        width: "100%",
        minWidth: 0,
      }}
    >
  <style>{`
  @keyframes pickersBar {
    0% { transform: translateX(-60%); opacity: 0.55; }
    50% { transform: translateX(140%); opacity: 0.95; }
    100% { transform: translateX(320%); opacity: 0.55; }
  }

  @keyframes pickersPulseCard {
    0%, 100% {
      box-shadow: 0 0 0 1px rgba(255,255,255,0.08) inset,
                  0 10px 30px rgba(59,130,246,0.10);
      filter: brightness(1);
    }
    50% {
      box-shadow: 0 0 0 1px rgba(255,255,255,0.14) inset,
                  0 14px 40px rgba(59,130,246,0.22);
      filter: brightness(1.08);
    }
  }

  @keyframes pickersShimmer {
    0% {
      transform: translateX(-120%);
    }
    70%, 100% {
      transform: translateX(140%);
    }
  }

  .pickers-loading-card {
    position: relative;
    overflow: hidden;
    animation: pickersPulseCard 2.6s ease-in-out infinite;
  }

  .pickers-loading-card::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(
      120deg,
      rgba(255,255,255,0) 0%,
      rgba(255,255,255,0.18) 50%,
      rgba(255,255,255,0) 100%
    );
    transform: translateX(-120%);
    animation: pickersShimmer 3.2s ease-in-out infinite;
    pointer-events: none;
  }

  .pickers-more-link {
    position: relative;
    overflow: hidden;
    isolation: isolate;
    box-shadow: 0 0 0 1px rgba(255,255,255,0.03) inset,
                0 10px 24px rgba(0,0,0,0.18);
  }

  .pickers-more-link::after {
    content: "";
    position: absolute;
    inset: -2px;
    z-index: -1;
    background: linear-gradient(
      120deg,
      rgba(255,255,255,0) 0%,
      rgba(255,255,255,0.34) 46%,
      rgba(255,255,255,0) 72%
    );
    transform: translateX(-130%);
    animation: pickersShimmer 3.8s ease-in-out infinite;
    pointer-events: none;
  }

  .pickers-more-link:hover {
    filter: brightness(1.12);
    transform: translateY(-1px);
  }

  .pickers-shell {
    width: 100%;
    max-width: 1280px;
    min-width: 0;
  }

  .pickers-sections-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    align-items: start;
  }


  .pattern-plays-grid {
    margin-top: 16px;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
  }

  .pattern-play-card {
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 12px;
    padding: 12px;
    border-radius: 18px;
    text-decoration: none;
    min-width: 0;
    box-sizing: border-box;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.035);
    transition: transform 150ms ease, filter 150ms ease, border-color 150ms ease;
  }

  .pattern-play-card:hover {
    transform: translateY(-2px);
    filter: brightness(1.08);
  }

  .playDiagram {
    width: 100%;
    display: block;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(2,6,23,0.64);
  }

  .pattern-play-copy h3 {
    margin: 0;
    font-size: 17px;
    line-height: 1.18;
    letter-spacing: -0.025em;
  }

  .pattern-play-copy p {
    margin: 8px 0 0;
    color: rgba(226,232,240,0.72);
    font-size: 13px;
    line-height: 1.55;
  }

  .pattern-play-button {
    margin-top: 12px;
    min-height: 36px;
    padding: 8px 11px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 11px;
    border: 1px solid;
    font-size: 12px;
    font-weight: 950;
  }

  @media (max-width: 980px) {
    .pattern-plays-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .pattern-play-card {
      grid-template-columns: 170px minmax(0, 1fr);
      grid-template-rows: auto;
      align-items: center;
    }
  }

  @media (max-width: 640px) {
    .pattern-play-card {
      grid-template-columns: minmax(0, 1fr);
    }
  }


  .pickers-filter-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 10px;
  }

  .pickers-card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 12px;
  }

  .pickers-section-results-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .pickers-section-title {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: nowrap;
  }

  .pickers-section-title-text {
    min-width: 0;
    line-height: 1.22;
  }

  .pickers-earnings-fetch-button:hover:not(:disabled) {
    filter: brightness(1.08);
    transform: translateY(-1px);
  }

  @media (max-width: 980px) {
    .pickers-sections-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (max-width: 820px) {
  
  .pattern-plays-grid {
    margin-top: 16px;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
  }

  .pattern-play-card {
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 12px;
    padding: 12px;
    border-radius: 18px;
    text-decoration: none;
    min-width: 0;
    box-sizing: border-box;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.035);
    transition: transform 150ms ease, filter 150ms ease, border-color 150ms ease;
  }

  .pattern-play-card:hover {
    transform: translateY(-2px);
    filter: brightness(1.08);
  }

  .playDiagram {
    width: 100%;
    display: block;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(2,6,23,0.64);
  }

  .pattern-play-copy h3 {
    margin: 0;
    font-size: 17px;
    line-height: 1.18;
    letter-spacing: -0.025em;
  }

  .pattern-play-copy p {
    margin: 8px 0 0;
    color: rgba(226,232,240,0.72);
    font-size: 13px;
    line-height: 1.55;
  }

  .pattern-play-button {
    margin-top: 12px;
    min-height: 36px;
    padding: 8px 11px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 11px;
    border: 1px solid;
    font-size: 12px;
    font-weight: 950;
  }

  @media (max-width: 980px) {
    .pattern-plays-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .pattern-play-card {
      grid-template-columns: 170px minmax(0, 1fr);
      grid-template-rows: auto;
      align-items: center;
    }
  }

  @media (max-width: 640px) {
    .pattern-play-card {
      grid-template-columns: minmax(0, 1fr);
    }
  }


  .pickers-filter-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .pickers-card-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .pickers-desktop-only {
    display: block;
  }

  @media (max-width: 640px) {
    .pickers-filter-grid,
    .pickers-card-grid,
    .pickers-section-results-grid,
    .pickers-sections-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .pickers-desktop-only {
      display: none;
    }

    .pickers-section-description {
      display: none;
    }

    .pickers-item-note {
      display: none !important;
    }

    .pickers-item-note.pickers-item-note-show-mobile {
      display: inline !important;
    }

    .pickers-note-mobile {
      display: none;
    }

    .pickers-note-desktop {
      display: inline;
    }

    .pickers-section-title {
      flex-wrap: nowrap !important;
      align-items: center !important;
      gap: 8px !important;
    }

    .pickers-help-tip {
      width: 22px !important;
      height: 22px !important;
      font-size: 13px !important;
      margin-left: 0 !important;
      flex: 0 0 22px !important;
    }

    .pickers-note-desktop {
      display: none;
    }

    .pickers-note-mobile {
      display: inline;
    }
  }
`}</style>

      {loading ? (
        <div
          className="pickers-shell pickers-loading-card"
          style={{
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 18,
            padding: 18,
            background: "#0b1220",
            boxSizing: "border-box",
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 950, letterSpacing: "-0.2px" }}>
            We are gathering stocks for you, please wait…
          </div>
          <div style={{ marginTop: 8, opacity: 0.75 }}>
            First load can take around 10–15 seconds. Cached loads are usually much
            faster.
          </div>

          <div
            style={{
              marginTop: 14,
              width: 420,
              maxWidth: "100%",
              height: 10,
              borderRadius: 999,
              overflow: "hidden",
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.16)",
            }}
          >
            <div
              style={{
                height: "100%",
                width: "35%",
                borderRadius: 999,
                background: "rgba(59,130,246,0.95)",
                animation: "pickersBar 1.1s linear infinite",
              }}
            />
          </div>
        </div>
      ) : null}

      {err ? (
        <div
          className="pickers-shell"
          style={{
            border: "1px solid rgba(239,68,68,0.18)",
            borderRadius: 16,
            padding: 16,
            background: "rgba(239,68,68,0.08)",
            color: "#fecaca",
            boxSizing: "border-box",
          }}
        >
          {err}
        </div>
      ) : null}

      {!loading && !err ? (
        <section
          className="pickers-shell pickers-desktop-only"
          style={{
            border: "1px solid rgba(34,197,94,0.26)",
            borderRadius: 18,
            padding: 16,
            background: "linear-gradient(180deg, rgba(8,18,12,0.96), rgba(8,12,22,1))",
            marginBottom: 18,
            boxSizing: "border-box",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "flex-start",
              flexWrap: "wrap",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <h3
                style={{
                  margin: 0,
                  fontSize: 24,
                  lineHeight: 1.1,
                  letterSpacing: "-0.03em",
                }}
              >
                Build your own stock setup
              </h3>

              <p
                style={{
                  margin: "8px 0 0 0",
                  fontSize: 14,
                  lineHeight: 1.65,
                  opacity: 0.76,
                  maxWidth: 760,
                }}
              >
                Choose multiple technical conditions and we will only show stocks
                matching all selected filters.
              </p>
            </div>

            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <button
                type="button"
                onClick={handleScreenerButton}
                style={{
                  ...actionButtonStyle,
                  border: "1px solid rgba(34,197,94,0.34)",
                  background:
                    "linear-gradient(180deg, rgba(20,83,45,0.98), rgba(21,128,61,0.88))",
                  color: "#dcfce7",
                  boxShadow: screenerOpen
                    ? "0 0 0 1px rgba(34,197,94,0.16), 0 10px 24px rgba(22,101,52,0.18)"
                    : "none",
                }}
              >
                {screenerOpen ? "Hide Custom Screener" : "Custom Screener"}
              </button>

              {customMode ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  style={{
                    ...actionButtonStyle,
                    border: "1px solid rgba(239,68,68,0.34)",
                    background:
                      "linear-gradient(180deg, rgba(127,29,29,0.98), rgba(185,28,28,0.88))",
                    color: "#fee2e2",
                    boxShadow: "0 10px 24px rgba(127,29,29,0.16)",
                  }}
                >
                  Clear Filters
                </button>
              ) : null}
            </div>
          </div>

          <div
            style={{
              marginTop: screenerOpen ? 16 : 0,
              maxHeight: screenerOpen ? 1200 : 0,
              opacity: screenerOpen ? 1 : 0,
              overflow: "hidden",
              transform: screenerOpen ? "translateY(0)" : "translateY(-8px)",
              transition:
                "max-height 0.38s ease, opacity 0.24s ease, transform 0.28s ease, margin-top 0.28s ease",
            }}
          >
            <div className="pickers-filter-grid">
              {FILTER_DEFS.map((filter) => {
                const active = selectedFilters.includes(filter.key);

                return (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() => toggleFilter(filter.key)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "12px 14px",
                      minWidth: 0,
                      borderRadius: 14,
                      border: active
                        ? `1px solid ${toneDot(filter.tone)}`
                        : "1px solid rgba(255,255,255,0.14)",
                      background: active
                        ? "rgba(255,255,255,0.08)"
                        : "rgba(255,255,255,0.04)",
                      color: "#f1f5f9",
                      textAlign: "left",
                      fontWeight: 850,
                      cursor: "pointer",
                      boxSizing: "border-box",
                    }}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 999,
                        background: toneDot(filter.tone),
                        flex: "0 0 auto",
                      }}
                    />
                    <span style={{ minWidth: 0 }}>{filter.label}</span>
                  </button>
                );
              })}
            </div>

            {customMode ? (
              <div
                style={{
                  marginTop: 16,
                  padding: 14,
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.04)",
                  boxSizing: "border-box",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    opacity: 0.72,
                    fontWeight: 900,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Active Custom Setup
                </div>

                <div
                  style={{
                    marginTop: 10,
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  {selectedFilters.map((filter) => {
                    const def = FILTER_DEFS.find((f) => f.key === filter);

                    return (
                      <span
                        key={filter}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "8px 10px",
                          borderRadius: 999,
                          border: "1px solid rgba(255,255,255,0.14)",
                          background: "rgba(255,255,255,0.06)",
                          fontSize: 12,
                          fontWeight: 900,
                        }}
                      >
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 999,
                            background: toneDot(def?.tone),
                          }}
                        />
                        {getFilterLabel(filter)}
                      </span>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <div
        className="pickers-shell"
        style={{
          marginTop: loading || err ? 20 : 0,
          display: "grid",
          gap: 16,
          boxSizing: "border-box",
        }}
      >
        {!loading && !err && !customMode ? <PatternPlaysSection /> : null}

        {customMode ? (
          <section
            style={{
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 16,
              padding: 16,
              background: "#0b1220",
              boxSizing: "border-box",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "baseline",
                flexWrap: "wrap",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <h2
                  style={{
                    margin: 0,
                    fontSize: 22,
                    fontWeight: 950,
                    letterSpacing: "-0.02em",
                  }}
                >
                  Custom Screener Results
                </h2>
                <p
                  style={{
                    margin: "8px 0 0",
                    fontSize: 14,
                    opacity: 0.72,
                    lineHeight: 1.6,
                  }}
                >
                  Showing only stocks matching all selected filters.
                </p>
              </div>

              <div style={{ fontSize: 12, opacity: 0.7 }}>
                {customMatches.length} {customMatches.length === 1 ? "match" : "matches"}
              </div>
            </div>

            {customMatches.length ? (
              <div
                className="pickers-card-grid"
                style={{
                  marginTop: 14,
                }}
              >
                {customMatches.map((item) => (
                  <a
                    key={item.symbol}
                    href={toChartHref(
                     item.dashboardHref ?? `/?symbol=${encodeURIComponent(item.symbol)}`
                     )}
                    style={{
                      display: "block",
                      minWidth: 0,
                      textDecoration: "none",
                      color: "#f1f5f9",
                      border: "1px solid rgba(255,255,255,0.14)",
                      borderRadius: 16,
                      padding: 14,
                      background: "rgba(255,255,255,0.04)",
                      boxSizing: "border-box",
                    }}
                   title={`View ${item.symbol} chart`}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                        alignItems: "flex-start",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            minWidth: 0,
                          }}
                        >
                          <span
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: 999,
                              background: toneDot(item.displayTone),
                              boxShadow: "0 0 0 3px rgba(255,255,255,0.04)",
                              flex: "0 0 auto",
                            }}
                          />
                          <div
                            style={{
                              fontSize: 20,
                              fontWeight: 950,
                              minWidth: 0,
                            }}
                          >
                            {item.symbol}
                          </div>
                        </div>

                        {item.preferredTimeframe || item.preferredIndicator ? (
                          <div
                            style={{
                              marginTop: 8,
                              display: "flex",
                              gap: 8,
                              flexWrap: "wrap",
                              alignItems: "center",
                            }}
                          >
                            {item.preferredTimeframe ? (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  padding: "5px 8px",
                                  borderRadius: 999,
                                  border: "1px solid rgba(255,255,255,0.12)",
                                  background: "rgba(255,255,255,0.05)",
                                  fontSize: 10,
                                  fontWeight: 900,
                                  letterSpacing: "0.04em",
                                }}
                              >
                                {item.preferredTimeframe}
                              </span>
                            ) : null}

                            {item.preferredIndicator ? (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  padding: "5px 8px",
                                  borderRadius: 999,
                                  border: "1px solid rgba(96,165,250,0.22)",
                                  background: "rgba(59,130,246,0.08)",
                                  color: "#dbeafe",
                                  fontSize: 10,
                                  fontWeight: 900,
                                  letterSpacing: "0.04em",
                                }}
                              >
                                {item.preferredIndicator}
                              </span>
                            ) : null}
                          </div>
                        ) : null}

                        {item.note ? (
                          <div
                            style={{
                              marginTop: 8,
                              fontSize: 13,
                              lineHeight: 1.55,
                              opacity: 0.72,
                              wordBreak: "break-word",
                            }}
                          >
                            {item.note}
                          </div>
                        ) : null}
                      </div>

                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-end",
                          gap: 8,
                          flex: "0 0 auto",
                        }}
                      >
<a
href={toChartHref(
  item.dashboardHref ?? `/?symbol=${encodeURIComponent(item.symbol)}`
)}
  onClick={(e) => e.stopPropagation()}
  style={{
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid rgba(34,197,94,0.35)",
    background: "rgba(34,197,94,0.12)",
    color: "#bbf7d0",
    textDecoration: "none",
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: "nowrap",
  }}
  title={`Open ${item.symbol} chart`}
>
  Open chart ↗
</a>

                        <a
                          href={`/stock/${encodeURIComponent(item.symbol)}`}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "7px 10px",
                            borderRadius: 10,
                            border: "1px solid rgba(59,130,246,0.24)",
                            background: "rgba(59,130,246,0.08)",
                            color: "#dbeafe",
                            textDecoration: "none",
                            fontSize: 11,
                            fontWeight: 900,
                            whiteSpace: "nowrap",
                          }}
                        >
                          Stock page ↗
                        </a>
                      </div>
                    </div>

                    <div
                      style={{
                        marginTop: 12,
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      {item.matchedSignals.map((signal) => {
                        const def = FILTER_DEFS.find((f) => f.key === signal);

                        return (
                          <span
                            key={`${item.symbol}-${signal}`}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 7,
                              padding: "7px 9px",
                              borderRadius: 999,
                              border: "1px solid rgba(255,255,255,0.12)",
                              background: "rgba(255,255,255,0.05)",
                              fontSize: 11,
                              fontWeight: 900,
                              minWidth: 0,
                            }}
                          >
                            <span
                              style={{
                                width: 7,
                                height: 7,
                                borderRadius: 999,
                                background: toneDot(def?.tone),
                                flex: "0 0 auto",
                              }}
                            />
                            <span style={{ minWidth: 0 }}>{getFilterLabel(signal)}</span>
                          </span>
                        );
                      })}
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <div
                style={{
                  marginTop: 14,
                  border: "1px solid rgba(255,255,255,0.10)",
                  borderRadius: 14,
                  padding: 16,
                  background: "rgba(255,255,255,0.04)",
                  lineHeight: 1.6,
                  opacity: 0.82,
                  boxSizing: "border-box",
                }}
              >
                No stocks currently match all selected filters. Try removing one
                condition or using a broader setup.
              </div>
            )}
          </section>
        ) : (
          <div className="pickers-sections-grid pickers-shell">
            {displaySections.map((sec) => {
              const items = Array.isArray(sec.items)
                ? sec.items
                    .map((it) => {
                      const symbol = String(it.symbol ?? "").trim().toUpperCase();
                      const record = signalRecordMap.get(symbol);
                      const checkCount = record ? matchedSignalsForRecord(record).length : 0;
                      const isDynamic = dynamicSymbolSet.has(symbol);

                      return {
                        ...it,
                        symbol,
                        checkCount,
                        isDynamic,
                      };
                    })
                    .slice(0, 4)
                : [];

              return (
                <section
                  key={sec.title}
                  style={{
                    border: "1px solid rgba(255,255,255,0.14)",
                    borderRadius: 16,
                    padding: 16,
                    background: "#0b1220",
                    boxSizing: "border-box",
                    overflow: "visible",
                  }}
                >

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      alignItems: "baseline",
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <h2
                        className="pickers-section-title"
                        style={{
                          margin: 0,
                          fontSize: 22,
                          fontWeight: 950,
                          letterSpacing: "-0.02em",
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "nowrap",
                        }}
                      >
                        <span className="pickers-section-title-text">{sec.title}</span>
                        <HelpTip text={getHeaderHelp(sec.title)} />
                      </h2>

                      {sec.description ? (
                        <p
                          className="pickers-section-description"
                          style={{
                            margin: "8px 0 0",
                            fontSize: 14,
                            opacity: 0.72,
                            lineHeight: 1.6,
                          }}
                        >
                          {sec.description}
                        </p>
                      ) : null}
                    </div>

                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      {typeof sec.foundCount === "number"
                        ? `F${sec.foundCount} / S${items.length}`
                        : items.length
                          ? `${items.length} stocks`
                          : "No matches yet"}
                    </div>
                  </div>
                  

                  <div
                    className="pickers-section-results-grid"
                    style={{
                      marginTop: 14,
                    }}
                  >
                    {items.map((it) => (
                      <div
                        key={it.symbol}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) auto",
                          alignItems: "center",
                          gap: 10,
                          border: "1px solid rgba(255,255,255,0.14)",
                          borderRadius: 16,
                          padding: 12,
                          background: "rgba(255,255,255,0.04)",
                          boxSizing: "border-box",
                        }}
                      >
                        <a
                          href={toChartHref(
                          it.dashboardHref ?? `/?symbol=${encodeURIComponent(it.symbol)}`
                           )}
                          style={{
                            display: "block",
                            minWidth: 0,
                            maxWidth: "100%",
                            color: "#f1f5f9",
                            textDecoration: "none",
                            fontWeight: 900,
                            overflow: "hidden",
                          }}
                          title={it.note ?? "Open in dashboard"}
                        >
                          <span
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              minWidth: 0,
                            }}
                          >
                            <span
                              style={{
                                width: 10,
                                height: 10,
                                borderRadius: 999,
                                background: toneDot(it.tone),
                                boxShadow: "0 0 0 3px rgba(255,255,255,0.04)",
                                flex: "0 0 auto",
                              }}
                            />
                            <span
                              style={{
                                minWidth: 0,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {it.symbol}
                            </span>
                          </span>

                          {it.note ? (
                            <span
                              className={`pickers-item-note${
                                /MA200/i.test(it.note) ? " pickers-item-note-show-mobile" : ""
                              }`}
                              style={{
                                display: "block",
                                marginTop: 5,
                                paddingLeft: 18,
                                fontSize: 11,
                                lineHeight: 1.35,
                                opacity: 0.68,
                                fontWeight: 750,
                                minWidth: 0,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              <span className="pickers-note-desktop">{it.note}</span>
                              <span className="pickers-note-mobile">
                                {/Weekly/i.test(it.note)
                                  ? "Weekly"
                                  : /Daily/i.test(it.note)
                                    ? "Daily"
                                    : it.note}
                              </span>
                            </span>
                          ) : null}
                        </a>

                        <a
                          href={toChartHref(
                          it.dashboardHref ?? `/?symbol=${encodeURIComponent(it.symbol)}`
                          )}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "8px 11px",
                            borderRadius: 10,
background: "rgba(148,163,184,0.06)",
border: "1px solid rgba(148,163,184,0.18)",
color: "#cbd5f5",
                            textDecoration: "none",
                            fontSize: 12,
                            fontWeight: 900,
                            whiteSpace: "nowrap",
                            flex: "0 0 auto",
                          }}
                          title={`Open ${it.symbol} chart`}
                        >
                          Open chart ↗
                        </a>
                      </div>
                    ))}
                  </div>

                  {sec.title.toLowerCase().includes("earnings") ? (
                    <div
                      style={{
                        marginTop: 12,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        type="button"
                        className="pickers-earnings-fetch-button"
                        onClick={handleFetchEarnings}
                        disabled={earningsFetchBusy || earningsFetchRemainingSeconds > 0}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          minHeight: 38,
                          padding: "8px 12px",
                          borderRadius: 10,
                          border: "1px solid rgba(34,197,94,0.30)",
                          background:
                            earningsFetchBusy || earningsFetchRemainingSeconds > 0
                              ? "rgba(34,197,94,0.07)"
                              : "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(16,185,129,0.10))",
                          color: earningsFetchBusy || earningsFetchRemainingSeconds > 0 ? "rgba(220,252,231,0.62)" : "#dcfce7",
                          fontSize: 12,
                          fontWeight: 950,
                          cursor:
                            earningsFetchBusy || earningsFetchRemainingSeconds > 0
                              ? "not-allowed"
                              : "pointer",
                          opacity: earningsFetchBusy || earningsFetchRemainingSeconds > 0 ? 0.76 : 1,
                          transition: "transform 140ms ease, filter 140ms ease, opacity 140ms ease",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {earningsFetchBusy
                          ? "Fetching earnings…"
                          : earningsFetchRemainingSeconds > 0
                            ? `Fetch Earnings (${earningsFetchRemainingSeconds}s)`
                            : "Fetch Earnings"}
                      </button>

                      {earningsFetchMessage ? (
                        <span
                          style={{
                            flex: "1 1 180px",
                            minWidth: 0,
                            color: "rgba(203,213,225,0.68)",
                            fontSize: 11,
                            lineHeight: 1.45,
                            textAlign: "right",
                          }}
                        >
                          {earningsFetchMessage}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
{(() => {
  const title = sec.title.toLowerCase();

  let seoHref = "";
  let seoLabel = "";
  let seoBorder = "1px solid rgba(59,130,246,0.22)";
  let seoBackground = "rgba(59,130,246,0.08)";
  let seoColor = "#dbeafe";

  if (title.includes("positive last earnings")) {
    seoHref = "/stocks-with-positive-last-earnings";
    seoLabel = "See all positive earnings stocks →";
    seoBorder = "1px solid rgba(34,197,94,0.22)";
    seoBackground = "rgba(34,197,94,0.08)";
    seoColor = "#dcfce7";
  } else if (title.includes("strong earnings growth")) {
    seoHref = "/stocks-with-strong-earnings-growth";
    seoLabel = "See all earnings growth stocks →";
    seoBorder = "1px solid rgba(34,197,94,0.22)";
    seoBackground = "rgba(34,197,94,0.08)";
    seoColor = "#dcfce7";
  } else if (title.includes("all-time high breakout")) {
    seoHref = "/all-time-high-breakout-stocks";
    seoLabel = "See all ATH breakout stocks →";
    seoBorder = "1px solid rgba(251,146,60,0.22)";
    seoBackground = "rgba(251,146,60,0.08)";
    seoColor = "#fed7aa";
  } else if (title.includes("3-month high breakout")) {
    seoHref = "/3-month-high-breakout-stocks";
    seoLabel = "See all 3-month high breakout stocks →";
    seoBorder = "1px solid rgba(251,146,60,0.22)";
    seoBackground = "rgba(251,146,60,0.08)";
    seoColor = "#fed7aa";
  } else if (title.includes("all-time highs")) {
    seoHref = "/stocks-down-20-from-all-time-highs";
    seoLabel = "See all stocks down from all-time highs →";
    seoBorder = "1px solid rgba(234,179,8,0.22)";
    seoBackground = "rgba(234,179,8,0.08)";
    seoColor = "#fef3c7";
  } else if (title.includes("buy signals")) {
    seoHref = "/top-stocks-with-buy-signals";
    seoLabel = "See all buy signal stocks →";
    seoBorder = "1px solid rgba(34,197,94,0.22)";
    seoBackground = "rgba(34,197,94,0.08)";
    seoColor = "#dcfce7";
  } else if (title.includes("sell signals")) {
    seoHref = "/top-stocks-with-sell-signals";
    seoLabel = "See all sell signal stocks →";
    seoBorder = "1px solid rgba(239,68,68,0.22)";
    seoBackground = "rgba(239,68,68,0.08)";
    seoColor = "#fecaca";
  } else if (title.includes("oversold")) {
    seoHref = "/oversold-stocks-today";
    seoLabel = "See all oversold stocks today →";
    seoBorder = "1px solid rgba(34,197,94,0.22)";
    seoBackground = "rgba(34,197,94,0.08)";
    seoColor = "#dcfce7";
  } else if (title.includes("overbought")) {
    seoHref = "/overbought-stocks-today";
    seoLabel = "See all overbought stocks today →";
    seoBorder = "1px solid rgba(239,68,68,0.22)";
    seoBackground = "rgba(239,68,68,0.08)";
    seoColor = "#fecaca";
  } else if (title.includes("best trend score")) {
    seoHref = "/best-trend-score-stocks";
    seoLabel = "See all best trend score stocks →";
    seoBorder = "1px solid rgba(34,197,94,0.22)";
    seoBackground = "rgba(34,197,94,0.08)";
    seoColor = "#dcfce7";
  } else if (title.includes("divergence")) {
    seoHref = "/bullish-bearish-divergence-stocks";
    seoLabel = "See all divergence stocks →";
    seoBorder = "1px solid rgba(168,85,247,0.22)";
    seoBackground = "rgba(168,85,247,0.08)";
    seoColor = "#f3e8ff";
  } else if (title.includes("200")) {
    seoHref = "/stocks-near-200-day-moving-average";
    seoLabel = "See all stocks near 200-day MA →";
  }

  if (!seoHref) return null;

  return (
    <div
      style={{
        // Keep this below the Fetch Earnings button. The old negative margin could
        // overlap the button area and make the button feel broken/unresponsive.
        marginTop: 12,
        display: "flex",
        justifyContent: "flex-end",
        position: "relative",
        zIndex: 1,
      }}
    >
      <a
        href={seoHref}
        className="pickers-more-link"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "8px 12px",
          borderRadius: 10,
          border: seoBorder,
          background: seoBackground,
          color: seoColor,
          textDecoration: "none",
          fontSize: 12,
          fontWeight: 900,
          whiteSpace: "nowrap",
        }}
      >
        {seoLabel}
      </a>
    </div>
  );
})()}
                </section>
              );
            })}
          </div>
        )}

        {!loading && !err && SHOW_FORCE_FETCH_BUTTON ? (
          <div
            style={{
              marginTop: 18,
              display: "flex",
              justifyContent: "center",
            }}
          >
            <button
              type="button"
              onClick={() => {
                void loadPickers(true);
              }}
              disabled={forceRefreshing}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                minHeight: 44,
                padding: "10px 16px",
                borderRadius: 12,
                fontWeight: 900,
                fontSize: 14,
                cursor: forceRefreshing ? "wait" : "pointer",
                transition: "all 0.2s ease",
                whiteSpace: "nowrap",
                border: "1px solid rgba(59,130,246,0.28)",
                background: forceRefreshing
                  ? "rgba(59,130,246,0.12)"
                  : "rgba(59,130,246,0.08)",
                color: "#dbeafe",
                opacity: forceRefreshing ? 0.78 : 1,
              }}
            >
              {forceRefreshing ? "Force refreshing…" : "Force Refresh Pickers"}
            </button>
          </div>
        ) : null}

        {!loading &&
        !err &&
        (updatedAt || universeSize || dynamicUniverseCount || estimatedApiCalls) ? (
          <div
            style={{
              marginTop: 6,
              paddingTop: 4,
              fontSize: 10,
              lineHeight: 1.55,
              opacity: 0.34,
              textAlign: "right",
              letterSpacing: "0.01em",
              userSelect: "none",
            }}
          >
            {updatedAt ? (
              <div>{new Date(updatedAt).toLocaleString()}</div>
            ) : null}
            {universeSize != null ? <div>Universe: {universeSize}</div> : null}
            {dynamicUniverseCount != null ? (
              <div>Dynamic: {dynamicUniverseCount}</div>
            ) : null}
            {estimatedApiCalls != null ? (
              <div>Estimated: {estimatedApiCalls}</div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
