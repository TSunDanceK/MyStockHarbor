import type { Metadata } from "next";
import { fmpFetch } from "@/lib/server/fmpUsage";
import Link from "next/link";
import EarningsSymbolPicker from "./EarningsSymbolPicker";
import { getDailyHistory } from "@/lib/server/historyCache";
import { getLatestEarningsData } from "@/lib/latest-earnings-data";
import {
  computeIndicatorSeed,
  type Point,
} from "@/lib/indicators";
import ShareButton from "@/app/components/ShareButton";
import TickerLogo from "@/app/components/TickerLogo";
import { WatermarkVisibilityProvider, HideWatermarksBar, EarningsScoreWatermark } from "@/app/components/WatermarkVisibility";
import { resolveFactSetForRender } from "@/lib/server/secColdFetch";
import { notFound } from "next/navigation";
import { buildSecEarningsView, type SecEarningsView } from "@/lib/server/secEarningsView";
import {
  HiddenCard, SecSnapshotCard, SecGrowthMarginsCard, SecCashQualityCard,
  SecBalanceSheetCard, SecIncomeStatementCard, SecRecentQuartersCard,
  SecPendingCard, SecNoXbrlCard,
} from "./SecEarningsCards";
import { getRelatedSymbols } from "@/lib/curatedSymbols";
import RelatedStocks from "@/app/components/RelatedStocks";

// No segment config here on purpose -- it cascades from
// app/stock/[symbol]/layout.tsx (`revalidate = 900`), so the overview, /news
// and /earnings share one cache policy and cannot drift apart. This page used
// to carry `dynamic = "force-dynamic"`, which meant every request and every
// crawl paid a full serverless render (~575 in 24h) of what is, between
// reports, the same HTML.

type Props = {
  params: Promise<{ symbol: string }>;
};

type EarningsTone = "good" | "neutral" | "weak";

type EarningsReactionPoint = {
  label: string;
  reactionPct: number | null;
  volumeMultiple: number | null;
  drift5Pct: number | null;
  drift20Pct: number | null;
};

const FMP_BASE = "https://financialmodelingprep.com/stable";

function cleanSymbol(value: string) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "")
    .trim();
}

type FmpEarningsRow = {
  symbol?: string;
  date?: string;
  fiscalLabel?: string;
  fiscalYear?: string;
  periodEndDate?: string;
  epsActual?: number | null;
  epsEstimated?: number | null;
  revenueActual?: number | null;
  revenueEstimated?: number | null;
  lastUpdated?: string;
  time?: string;
};

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}



function formatPercent(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}


function computeEarningsReactionDetail(row: FmpEarningsRow, points: Point[]): { reactionPct: number | null; volumeMultiple: number | null; drift5Pct: number | null; drift20Pct: number | null } {
  const empty = { reactionPct: null, volumeMultiple: null, drift5Pct: null, drift20Pct: null };
  if (!row.date || !points.length) return empty;
  const dates = points.map((p) => p.date);
  let idx = dates.indexOf(row.date);
  if (idx === -1) {
    idx = dates.findIndex((d) => d >= String(row.date));
  }
  if (idx === -1) return empty;
  const time = (row.time || "").toLowerCase();
  let baseIdx: number;
  let reactIdx: number;
  if (time === "bmo") { baseIdx = idx - 1; reactIdx = idx; }
  else if (time === "amc") { baseIdx = idx; reactIdx = idx + 1; }
  else { baseIdx = idx - 1; reactIdx = idx + 1; }

  const base = points[baseIdx]?.close;
  const react = points[reactIdx]?.close;
  const reactionPct = typeof base === "number" && typeof react === "number" && Number.isFinite(base) && Number.isFinite(react) && base !== 0
    ? ((react - base) / Math.abs(base)) * 100
    : null;

  const reactionVolume = points[reactIdx]?.volume;
  let volumeMultiple: number | null = null;
  if (typeof reactionVolume === "number" && Number.isFinite(reactionVolume) && reactionVolume > 0) {
    const lookback = 20;
    const windowStart = Math.max(0, baseIdx - lookback + 1);
    const window = points.slice(windowStart, baseIdx + 1)
      .map((p) => p.volume)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
    if (window.length) {
      const avgVolume = window.reduce((a, b) => a + b, 0) / window.length;
      if (avgVolume > 0) volumeMultiple = reactionVolume / avgVolume;
    }
  }

  let drift5Pct: number | null = null;
  let drift20Pct: number | null = null;
  if (typeof base === "number" && Number.isFinite(base) && base !== 0) {
    const close5 = points[reactIdx + 4]?.close;
    const close20 = points[reactIdx + 19]?.close;
    if (typeof close5 === "number" && Number.isFinite(close5)) drift5Pct = ((close5 - base) / Math.abs(base)) * 100;
    if (typeof close20 === "number" && Number.isFinite(close20)) drift20Pct = ((close20 - base) / Math.abs(base)) * 100;
  }

  return { reactionPct, volumeMultiple, drift5Pct, drift20Pct };
}

function quarterLabel(date?: string | null) {
  if (!date) return "—";
  const dt = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return date;
  const month = dt.getUTCMonth();
  const quarter = Math.floor(month / 3) + 1;
  const year = String(dt.getUTCFullYear()).slice(-2);
  return `Q${quarter} ${year}`;
}


function displayQuarterLabel(row?: FmpEarningsRow | null) {
  if (!row) return "—";
  return row.fiscalLabel || quarterLabel(row.date);
}

function toneLabel(tone: EarningsTone) {
  if (tone === "good") return "Good";
  if (tone === "weak") return "Weak";
  return "Mixed";
}

function toneColor(tone: EarningsTone) {
  if (tone === "good") return "#22c55e";
  if (tone === "weak") return "#ef4444";
  return "#facc15";
}

function toneBg(tone: EarningsTone) {
  if (tone === "good") return "rgba(34,197,94,0.10)";
  if (tone === "weak") return "rgba(239,68,68,0.10)";
  return "rgba(250,204,21,0.10)";
}

/** The five things the score can read. Named so the card can say what it could not. */
const SCORE_COMPONENTS = {
  revenueGrowth: "revenue growth against the same quarter a year earlier",
  epsGrowth: "EPS growth against the same quarter a year earlier",
  profitability: "whether the quarter was profitable",
  marginTrend: "the direction of operating margin",
  cashConversion: "whether reported profit is turning into cash",
} as const;
type ScoreComponent = keyof typeof SCORE_COMPONENTS;

/**
 * THE NARRATIVE IS BUILT FROM WHAT ACTUALLY RAN, not from the tone alone.
 *
 * ── WHAT THE TONE-ONLY VERSION CLAIMED ────────────────────────────────────
 * Measured on the #464 preview, /stock/AZN/earnings: every field of the
 * Quality of Earnings card rendered "—" — operating cash flow, capital
 * expenditure, free cash flow, cash-flow-less-net-income, share-based
 * compensation — and the score directly above it read GOOD, 100/100, with
 * "reported profit is backed by cash."
 *
 * The scorer had not awarded points for the missing chain; the sentence was
 * canned per tone and asserted the claim regardless. That is the same failure
 * shape as a check that supplies its own expected value: the component that
 * could not be measured still spoke.
 *
 * So the clauses are assembled from the components that RAN, and a component
 * that did not run contributes no clause and is listed as unavailable.
 */
function scoreExplanation(tone: EarningsTone, ran: Set<ScoreComponent>) {
  const clauses: string[] = [];
  const up = tone === "good";
  if (ran.has("revenueGrowth") || ran.has("epsGrowth")) {
    clauses.push(up ? "revenue and profit are growing year over year" : "growth is under pressure");
  }
  if (ran.has("marginTrend")) clauses.push(up ? "margins are holding" : "margins are slipping");
  // THE CLAUSE THAT WAS WRONG. It appears only when the cash component ran.
  if (ran.has("cashConversion")) {
    clauses.push(up ? "reported profit is backed by cash" : "cash conversion is weak");
  } else if (ran.has("profitability")) {
    clauses.push(up ? "the quarter was profitable" : "the quarter was loss-making");
  }
  const body = clauses.length
    ? clauses.join(", ").replace(/, ([^,]*)$/, " and $1")
    : "the filing carries few of the figures this score reads";
  if (tone === "good") return `The latest filed quarter reads constructive: ${body}.`;
  if (tone === "weak") return `The latest filed quarter reads weak: ${body}.`;
  return `The latest earnings read is mixed: ${body}. Investors should focus on whether future reports confirm improvement or reveal more pressure.`;
}

/** What the score could NOT read, in the page's own words. */
function scoreGaps(ran: Set<ScoreComponent>): string[] {
  return (Object.keys(SCORE_COMPONENTS) as ScoreComponent[])
    .filter((k) => !ran.has(k))
    .map((k) => SCORE_COMPONENTS[k]);
}

function buildScoreResult(score: number, tone: EarningsTone, ran: Set<ScoreComponent>) {
  return {
    available: true as const,
    score,
    tone,
    label: toneLabel(tone),
    explanation: scoreExplanation(tone, ran),
    // NOT a count. A reader needs to know WHICH input was missing to judge the
    // number; "4 of 5 signals" is the kind of summary that hides the one that
    // mattered.
    unavailable: scoreGaps(ran),
  };
}

// Calls the shared lib/latest-earnings-data.ts function IN-PROCESS instead of
// self-fetching this deployment's own /api/stock-earnings/[symbol] route over
// HTTP. That route is BotID-protected (instrumentation-client.ts), and BotID
// only validates a signed header a real browser attaches client-side -- a
// server-to-server self-fetch never carries one, so it always reads as an
// unverified bot and 403s itself. This function used `cache: "no-store"`, so
// every single request hit that self-block with zero caching cushion; the
// failure was masked because the caller falls back to a locally-computed
// score (scoreEarnings()) whenever this returns null, so the page never
// visibly broke -- it just silently used the wrong (non-canonical) score on
// every load. Same self-block failure mode as
// claude/pickers-firewall-selfblock-2026-07-17.md and
// claude/stock-page-earnings-selfblock-2026-07-21.md.



function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/**
 * The earnings score, rebuilt on filed figures.
 *
 * TWO OF ITS THREE SIGNALS WERE ESTIMATES, AND THEY ARE GONE. The old version
 * weighted EPS surprise at 1.35x and revenue surprise at 3.2x -- together the
 * dominant term -- against FMP's analyst consensus, which left with the FMP
 * licence. Those terms were not simply deleted: a score still described as
 * measuring "estimate performance" while silently running on growth alone is
 * worse than no score, because it keeps the authority of the old one.
 *
 * So it is scored on what the filings actually contain -- growth against the
 * year-ago quarter, profitability, margin direction, and whether reported
 * profit is turning into cash -- and the explanation says so.
 *
 * `available: false` is still the point. It returns 50 because the shape
 * requires a number, but 50 is NOT a reading: it is the neutral seed with
 * nothing added, and the card must not render it as one.
 */
function scoreFromSec(view: SecEarningsView | null) {
  if (!view) {
    return {
      score: 50, available: false as const, tone: "neutral" as EarningsTone,
      label: "Unavailable",
      explanation: "This company's SEC filings have not been read into the site yet, so there is nothing to score.",
      unavailable: Object.values(SCORE_COMPONENTS) as string[],
    };
  }

  let score = 50;
  // WHICH COMPONENTS ACTUALLY RAN, not how many. An absent input contributes no
  // points AND no clause; see scoreExplanation for the sentence that used to
  // claim cash backing from an empty cash-flow chain.
  const ran = new Set<ScoreComponent>();
  const s = view.snapshot;

  if (s.revenueYoY != null) { score += clamp(s.revenueYoY * 0.55, -22, 22); ran.add("revenueGrowth"); }
  if (s.epsYoY != null) { score += clamp(s.epsYoY * 0.30, -20, 20); ran.add("epsGrowth"); }
  if (s.netIncome.val != null) { score += s.netIncome.val > 0 ? 6 : -8; ran.add("profitability"); }

  // MARGIN DIRECTION, over the four most recent quarters that have one. Not a
  // single-quarter reading: one quarter's margin move is as often mix as trend.
  const opMargins = view.margins.filter((m) => m.operating != null).slice(-4).map((m) => m.operating!);
  if (opMargins.length >= 2) {
    score += clamp((opMargins[opMargins.length - 1] - opMargins[0]) * 0.8, -10, 10);
    ran.add("marginTrend");
  }

  // CASH AGAINST PROFIT. Positive accruals mean cash is running ahead of
  // reported profit, which is the quality signal the page's own card shows.
  const acc = view.cashQuality.accruals;
  const ni = view.cashQuality.netIncome.val;
  if (acc != null && ni != null && ni !== 0) {
    score += clamp((acc / Math.abs(ni)) * 8, -10, 10);
    ran.add("cashConversion");
  }

  if (ran.size === 0) {
    return {
      score: 50, available: false as const, tone: "neutral" as EarningsTone,
      label: "Unavailable",
      explanation: "This company's latest filing carries no figures that can be scored yet — there is no prior-year quarter to measure growth from.",
      unavailable: Object.values(SCORE_COMPONENTS) as string[],
    };
  }

  const rounded = Math.round(clamp(score, 0, 100));
  const tone: EarningsTone = rounded >= 66 ? "good" : rounded <= 39 ? "weak" : "neutral";
  return buildScoreResult(rounded, tone, ran);
}


async function fetchFmpJson<T>(path: string): Promise<T | null> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return null;
  const url = `${FMP_BASE}${path}${path.includes("?") ? "&" : "?"}apikey=${apiKey}`;
  try {
    const response = await fmpFetch(url, { next: { revalidate: 60 * 60 * 6 } });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch { return null; }
}


async function getEarningsData(symbol: string) {
  // ── WHAT THIS PAGE READS, AND FROM WHERE ──────────────────────────────────
  //
  // EVERY FINANCIAL NUMBER COMES FROM THE STORED SEC FACT SET. One Redis GET,
  // written by /api/jobs/sec-facts from data.sec.gov's companyfacts. Revenue,
  // EPS, margins, cash flow, the balance sheet and the P&L all come from there.
  //
  // TWO FMP CALLS REMAIN, AND BOTH ARE PRICE-DERIVED, WHICH THIS PASS DOES NOT
  // TOUCH. /earnings supplies the ANNOUNCEMENT date and its before-open /
  // after-close timing, which SEC filings do not carry -- a filing date is not
  // an announcement date, and the price-reaction card needs the session the
  // market actually reacted in. getDailyHistory supplies the bars. Market cap,
  // P/E and the reaction card are still on FMP; the bars have not moved.
  // THIS IS NOT A COMPLETE MIGRATION AND MUST NOT BE DESCRIBED AS ONE.
  const [cold, dailyHistory, earningsJson] = await Promise.all([
    resolveFactSetForRender(symbol),
    getDailyHistory(symbol, { caller: "stock-earnings" }).catch(() => [] as Point[]),
    fetchFmpJson<unknown[]>(`/earnings?symbol=${encodeURIComponent(symbol)}`),
  ]);
  const secView = cold.status === "ready" ? buildSecEarningsView(cold.set) : null;

  // DATES AND TIMING ONLY. epsActual/revenueActual are deliberately not read
  // off these rows any more, even though they are present: two sources for one
  // number is the divergence this repo keeps finding
  // (claude/traps/two-validators-for-one-value.md), and the SEC figure is the
  // one the page states its source as.
  const earningsRows: FmpEarningsRow[] = Array.isArray(earningsJson)
    ? earningsJson
        .map((item) => {
          const row = item as Record<string, unknown>;
          return {
            symbol,
            date: typeof row.date === "string" ? row.date : "",
            epsActual: asNumber(row.epsActual),
            revenueActual: asNumber(row.revenueActual),
            time: typeof row.time === "string" ? row.time.toLowerCase() : undefined,
          } as FmpEarningsRow;
        })
        .filter((row) => Boolean(row.date))
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    : [];

  const completedRows = earningsRows.filter(
    (row) => row.epsActual != null || row.revenueActual != null
  );
  const latest = completedRows[0] ?? null;

  const todayIso = new Date().toISOString().slice(0, 10);
  const startOfTodayUtcMs = new Date(`${todayIso}T00:00:00Z`).getTime();
  const next = earningsRows
    .filter((row) => {
      if (!row.date) return false;
      const dt = new Date(`${row.date}T00:00:00Z`);
      return dt.getTime() >= startOfTodayUtcMs && row.epsActual == null && row.revenueActual == null;
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] ?? null;

  const priceReactionQuarters: EarningsReactionPoint[] = completedRows
    .slice(0, 8)
    .reverse()
    .map((row) => {
      const detail = computeEarningsReactionDetail(row, dailyHistory as Point[]);
      return { label: displayQuarterLabel(row), ...detail };
    });

  const score = scoreFromSec(secView);

  return { earningsRows, completedRows, latest, next, priceReactionQuarters, score, secView, cold };
}


// Nominal width (in "user units") for the chart SVGs below. Choosing a
// realistic pixel-scale number here -- rather than an abstract 0-100 -- and
// then letting the SVG scale uniformly (width: 100%, height: auto, no
// preserveAspectRatio="none") keeps x and y scaled by very nearly the same
// factor. That's what keeps circles round and strokes a consistent thin
// line instead of the squashed-ellipse / stretched-line look you get from
// forcing a near-square viewBox to fill a wide card non-uniformly.
const CHART_VIEW_W = 640;

function ChartFrame({ height, labels, scaleTop, scaleMid, scaleBottom, children }: { height: number; labels: string[]; scaleTop?: string; scaleMid?: string; scaleBottom?: string; children: import("react").ReactNode; }) {
  const hasScale = scaleTop != null || scaleMid != null || scaleBottom != null;
  return (
    <div>
      <div className="chartRow">
        <div className="chartPlot">{children}</div>
        {hasScale && (
          <div className="chartScale">
            {scaleTop != null && <span className="scaleTop">{scaleTop}</span>}
            {scaleMid != null && <span className="scaleMid">{scaleMid}</span>}
            {scaleBottom != null && <span className="scaleBottom">{scaleBottom}</span>}
          </div>
        )}
      </div>
      {/* Mirrors the row above (same flex structure + spacer) so the quarter
          labels line up under the actual bars/dots instead of being centered
          across the full card width while the plot itself is narrower by the
          Y-axis scale column. */}
      <div className="chartRow">
        <div className="chartCategories">
          {labels.map((l, i) => <span key={`${l}-${i}`}>{l}</span>)}
        </div>
        {hasScale && <div className="chartScaleSpacer" aria-hidden="true" />}
      </div>
    </div>
  );
}



type LineSeries = { name: string; color: string; values: (number | null)[] };

function MultiLineChart({ labels, series, height = 168, formatValue = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%` }: { labels: string[]; series: LineSeries[]; height?: number; formatValue?: (v: number) => string; }) {
  const allValues = series.flatMap((s) => s.values).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const maxAbs = allValues.length ? Math.max(...allValues.map((v) => Math.abs(v)), 0.5) : 1;
  const zeroY = height / 2;
  const usable = zeroY - 10;
  const groupW = CHART_VIEW_W / Math.max(labels.length, 1);

  function yFor(v: number) {
    return zeroY - (v / maxAbs) * usable;
  }

  function pathFor(values: (number | null)[]) {
    let d = "";
    let started = false;
    values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) { started = false; return; }
      const x = i * groupW + groupW / 2;
      const y = yFor(v);
      d += `${started ? "L" : "M"}${x},${y} `;
      started = true;
    });
    return d.trim();
  }

  return (
    <ChartFrame
      height={height}
      labels={labels}
      scaleTop={allValues.length ? formatValue(maxAbs) : undefined}
      scaleMid={allValues.length ? formatValue(0) : undefined}
      scaleBottom={allValues.length ? formatValue(-maxAbs) : undefined}
    >
      <svg viewBox={`0 0 ${CHART_VIEW_W} ${height}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Trend chart">
        <line x1="0" y1={zeroY} x2={CHART_VIEW_W} y2={zeroY} stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
        {series.map((s) => (
          <g key={s.name}>
            <path d={pathFor(s.values)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {s.values.map((v, i) => (v != null && Number.isFinite(v) ? <circle key={i} cx={i * groupW + groupW / 2} cy={yFor(v)} r="3.5" fill={s.color} /> : null))}
          </g>
        ))}
      </svg>
    </ChartFrame>
  );
}

function SeriesLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="chartLegend">
      {items.map((item) => (
        <span key={item.label}><i style={{ background: item.color }} /> {item.label}</span>
      ))}
    </div>
  );
}

type SingleBarPoint = { label: string; value: number | null };

function SingleValueBarChart({ data, height = 168, formatValue = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%` }: { data: SingleBarPoint[]; height?: number; formatValue?: (v: number) => string; }) {
  const values = data.map((d) => d.value).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const maxAbs = values.length ? Math.max(...values.map((v) => Math.abs(v)), 0.5) : 1;
  const zeroY = height / 2;
  const usable = zeroY - 10;
  const groupW = CHART_VIEW_W / Math.max(data.length, 1);

  return (
    <ChartFrame
      height={height}
      labels={data.map((d) => d.label)}
      scaleTop={values.length ? formatValue(maxAbs) : undefined}
      scaleMid={values.length ? formatValue(0) : undefined}
      scaleBottom={values.length ? formatValue(-maxAbs) : undefined}
    >
      <svg viewBox={`0 0 ${CHART_VIEW_W} ${height}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Price reaction chart">
        <line x1="0" y1={zeroY} x2={CHART_VIEW_W} y2={zeroY} stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
        {data.map((d, i) => {
          const cx = i * groupW + groupW / 2;
          const barW = Math.min(groupW * 0.42, 38);
          const h = d.value != null ? (Math.abs(d.value) / maxAbs) * usable : 0;
          const up = (d.value ?? 0) >= 0;
          const color = d.value == null ? "rgba(148,163,184,0.35)" : up ? "#22c55e" : "#ef4444";
          return d.value != null ? (
            <rect key={`${d.label}-${i}`} x={cx - barW / 2} y={up ? zeroY - h : zeroY} width={barW} height={Math.max(h, 2)} fill={color} rx="3" />
          ) : null;
        })}
      </svg>
    </ChartFrame>
  );
}

async function fetchQuoteForMeta(symbol: string): Promise<{ price: number | null; date: string | null }> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return { price: null, date: null };
  try {
    const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;
    const res = await fmpFetch(url, { next: { revalidate: 900 }, headers: { accept: "application/json" } });
    if (!res.ok) return { price: null, date: null };
    const json = await res.json();
    const row = Array.isArray(json) ? json[0] : json;
    const price = typeof row?.price === "number" && Number.isFinite(row.price) ? (row.price as number) : null;
    return { price, date: new Date().toISOString().slice(0, 10) };
  } catch { return { price: null, date: null }; }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const clean = cleanSymbol(symbol);
  const [rawHistory, { price, date }] = await Promise.all([getDailyHistory(clean, { caller: "stock-earnings-meta" }).catch(() => []), fetchQuoteForMeta(clean)]);
  const points: Point[] = (rawHistory as Point[]).filter((p) => p.date && Number.isFinite(p.close));
  const seed = computeIndicatorSeed(points, "", price, date);
  const priceStr = seed.lastClose != null ? ` — Price $${seed.lastClose.toFixed(2)}` : "";
  const trendStr = seed.trend ? `, ${seed.trend}` : "";
  const title = `${clean} Earnings, EPS & Revenue${priceStr} | MyStockHarbor`;
  // NO LONGER "EPS surprise, revenue surprise" -- the page stopped showing
  // either when FMP's analyst consensus left on 2026-09-15, and a description
  // promising them in search results is a promise the page cannot keep.
  const description = `Review ${clean} stock earnings as filed with the SEC: GAAP EPS, revenue, margins, cash flow and balance sheet${trendStr}, with year-over-year context and a simple earnings score.`;
  return {
    title, description,
    robots: {
      index: true,
      follow: true,
    },
    alternates: { canonical: `https://www.mystockharbor.com/stock/${clean}/earnings` },
    openGraph: { title: `${clean} Earnings & Earnings Score | MyStockHarbor`, description, url: `https://www.mystockharbor.com/stock/${clean}/earnings`, siteName: "MyStockHarbor", type: "article", images: [{ url: "https://www.mystockharbor.com/og-image-v2.png", width: 1200, height: 630, alt: "MyStockHarbor earnings dashboard" }] },
    twitter: { card: "summary_large_image", title: `${clean} Earnings & Earnings Score | MyStockHarbor`, description, images: ["https://www.mystockharbor.com/og-image-v2.png"] },
  };
}

export default async function StockEarningsPage({ params }: Props) {
  const { symbol } = await params;
  const clean = cleanSymbol(symbol);
  const data = await getEarningsData(clean);

  // THE CIK GATE, AS A 404. A symbol SEC has never heard of gets no page at
  // all: nothing was fetched for it and nothing was queued. This is what bounds
  // an endpoint anyone can hit -- the set of strings that can trigger work is
  // the ~10,400 registrants in the committed ticker file, not any string.
  if (data.cold.status === "no-cik") notFound();

  const nextReport = data.next;
  const score = data.score;
  const secView = data.secView;

  const reactionData: SingleBarPoint[] = data.priceReactionQuarters.map((q) => ({ label: q.label, value: q.reactionPct }));
  const hasAnyReaction = reactionData.some((d) => d.value != null);
  const driftLabels = data.priceReactionQuarters.map((q) => q.label);
  const driftSeries: LineSeries[] = [
    { name: "Day of reaction", color: "#60a5fa", values: data.priceReactionQuarters.map((q) => q.reactionPct) },
    { name: "+5 trading days", color: "#facc15", values: data.priceReactionQuarters.map((q) => q.drift5Pct) },
    { name: "+20 trading days", color: "#22c55e", values: data.priceReactionQuarters.map((q) => q.drift20Pct) },
  ];
  const hasAnyDrift = driftSeries.some((s) => s.values.some((v) => v != null));
  const latestReaction = [...data.priceReactionQuarters].reverse().find((q) => q.reactionPct != null) ?? null;

  // Curated, deterministic set of OTHER stock symbols for the "Explore More
  // Stocks" internal-linking module (see lib/curatedSymbols.ts and
  // app/components/RelatedStocks.tsx).
  const relatedSymbols = getRelatedSymbols(clean);

  const pageJsonLd = {
    "@context": "https://schema.org", "@type": "WebPage",
    name: `${clean} Stock Earnings`,
    url: `https://www.mystockharbor.com/stock/${clean}/earnings`,
    description: `${clean} stock earnings from SEC filings: GAAP EPS, revenue, margins, cash flow and balance sheet.`,
    breadcrumb: { "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://www.mystockharbor.com/" },
      { "@type": "ListItem", position: 2, name: clean, item: `https://www.mystockharbor.com/stock/${clean}` },
      { "@type": "ListItem", position: 3, name: "Earnings", item: `https://www.mystockharbor.com/stock/${clean}/earnings` },
    ]},
  };

  return (
    <WatermarkVisibilityProvider>
      <main className="earningsPage">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(pageJsonLd) }} />

        <style>{`
        .earningsPage { min-height: 100vh; background: radial-gradient(circle at top left, rgba(59,130,246,0.12), transparent 28%), radial-gradient(circle at top right, rgba(34,197,94,0.09), transparent 26%), #06080d; color: #f1f5f9; font-family: system-ui, Arial; }
        .earningsWrap { max-width: 1240px; margin: 0 auto; padding: 24px 18px 52px; }
        .topLinks { display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
        .topLinks a, .earningsSearchRow button, .actionLink { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 10px 14px; border-radius: 12px; border: 1px solid rgba(59,130,246,0.32); background: rgba(59,130,246,0.10); color: #dbeafe; text-decoration: none; font-weight: 900; font-size: 13px; cursor: pointer; }
        .topLinks a.green, .actionLink.green { border-color: rgba(34,197,94,0.32); background: rgba(34,197,94,0.10); color: #dcfce7; }
        .hero { border: 1px solid rgba(255,255,255,0.08); border-radius: 28px; padding: 24px; background: linear-gradient(135deg, rgba(15,23,42,0.96), rgba(6,10,18,0.98)); box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 18px 38px rgba(0,0,0,0.24); display: grid; grid-template-columns: minmax(0, 1fr) 410px; gap: 24px; align-items: stretch; }
        .heroTopBar { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        .eyebrow, .smallLabel { font-size: 12px; font-weight: 950; text-transform: uppercase; letter-spacing: 0.08em; color: #93c5fd; }
        .hero h1 { margin: 12px 0 0; font-size: 46px; line-height: 1.04; letter-spacing: -0.055em; }
        .hero p { margin: 12px 0 0; color: rgba(226,232,240,0.80); line-height: 1.7; font-size: 16px; max-width: 760px; }
        .scoreCard { border: 1px solid ${toneColor(score.tone)}55; border-radius: 22px; padding: 18px; background: linear-gradient(135deg, ${toneBg(score.tone)}, rgba(255,255,255,0.026)); box-shadow: inset 0 1px 0 rgba(255,255,255,0.045); }
        .scoreTop { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
        .scorePill { display: inline-flex; align-items: center; justify-content: center; border: 1px solid ${toneColor(score.tone)}66; background: ${toneBg(score.tone)}; color: ${toneColor(score.tone)}; border-radius: 999px; padding: 8px 11px; font-weight: 950; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
        .scoreNumberRow { margin-top: 14px; display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        .scoreNumber { font-size: 48px; line-height: 1; font-weight: 950; letter-spacing: -0.06em; }
        .scoreWatermark { font-size: 15px; font-weight: 850; letter-spacing: 0.02em; color: rgba(255,255,255,0.24); }
        .scoreBar { position: relative; margin-top: 18px; height: 14px; border-radius: 999px; background: linear-gradient(90deg, #ef4444, #facc15, #22c55e); overflow: hidden; }
        .scoreNeedle { position: absolute; top: -5px; left: calc(${score.score}% - 9px); width: 18px; height: 24px; border-radius: 999px; background: #f8fafc; border: 3px solid ${toneColor(score.tone)}; box-shadow: 0 8px 20px rgba(0,0,0,0.32); }
        .scoreLabels { display: flex; justify-content: space-between; margin-top: 9px; color: rgba(226,232,240,0.70); font-size: 11px; font-weight: 950; text-transform: uppercase; letter-spacing: 0.07em; }
        .contentGrid { margin-top: 22px; display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.85fr); gap: 22px; align-items: start; }
        .card { border: 1px solid rgba(255,255,255,0.08); border-radius: 22px; padding: 18px; background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.022)); box-shadow: inset 0 1px 0 rgba(255,255,255,0.035); overflow: visible; }
        .card h2, .card h3 { margin: 8px 0 0; letter-spacing: -0.035em; line-height: 1.15; }
        .card h2 { font-size: 26px; } .card h3 { font-size: 22px; }
        .card p { color: rgba(226,232,240,0.82); line-height: 1.7; }
        .metricGrid { margin-top: 16px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; overflow: visible; }
        .metricLabelWrap { position: relative; display: inline-flex; align-items: center; gap: 7px; max-width: 100%; overflow: visible; }
        .metricLabel { font-size: 11px; font-weight: 950; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(203,213,225,0.72); }
        .metricHelp { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 17px; height: 17px; border-radius: 999px; border: 1px solid rgba(147,197,253,0.30); background: #1e293b; color: #dbeafe; font-size: 11px; font-weight: 950; line-height: 1; cursor: help; z-index: 20; flex: 0 0 auto; }
        .metricHelpBubble { position: absolute; left: 50%; bottom: calc(100% + 10px); transform: translateX(-50%); width: 260px; max-width: min(260px, 72vw); padding: 11px 12px; border-radius: 13px; border: 1px solid rgba(147,197,253,0.22); background: #020617; color: #e5e7eb; box-shadow: 0 18px 44px rgba(0,0,0,0.55); font-size: 12px; font-weight: 750; letter-spacing: 0; line-height: 1.55; text-transform: none; text-align: left; opacity: 0; visibility: hidden; pointer-events: none; white-space: normal; z-index: 9999; }
        .metricHelpBubble::after { content: ""; position: absolute; left: 50%; top: 100%; transform: translateX(-50%); border-width: 7px; border-style: solid; border-color: #020617 transparent transparent transparent; }
        .metricHelp:hover .metricHelpBubble, .metricHelp:focus .metricHelpBubble, .metricHelp:focus-visible .metricHelpBubble { opacity: 1; visibility: visible; }
        .metricValue { margin-top: 8px; font-size: 24px; font-weight: 950; letter-spacing: -0.035em; }
        .earningsDataNote { margin: 10px 0 0; color: rgba(148,163,184,0.78); font-size: 12px; line-height: 1.45; }
        .metricSub { margin-top: 8px; font-size: 12px; line-height: 1.5; color: rgba(226,232,240,0.66); }
        .trendDots { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 14px; }
        .trendDot { text-align: center; min-width: 52px; }
        .trendDot span { display: inline-flex; width: 18px; height: 18px; border-radius: 999px; box-shadow: 0 0 0 6px rgba(255,255,255,0.04); }
        .trendDot strong { display: block; margin-top: 9px; font-size: 11px; color: rgba(241,245,249,0.86); }
        .chartLegend { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 14px; font-size: 11px; font-weight: 800; color: rgba(226,232,240,0.72); }
        .chartLegend span { display: inline-flex; align-items: center; gap: 6px; }
        .chartLegend i { display: inline-block; width: 9px; height: 9px; border-radius: 3px; }
        .chartRow { display: flex; align-items: stretch; gap: 8px; }
        .chartPlot { flex: 1 1 auto; min-width: 0; }
        .chartScale { position: relative; width: 66px; flex: 0 0 auto; border-left: 1px solid rgba(255,255,255,0.08); }
        .chartScale span { position: absolute; right: 4px; left: 4px; font-size: 11px; font-weight: 800; color: rgba(203,213,225,0.62); white-space: nowrap; text-align: right; overflow: visible; }
        .chartScale .scaleTop { top: 0; }
        .chartScale .scaleMid { top: 50%; transform: translateY(-50%); }
        .chartScale .scaleBottom { bottom: 0; }
        .chartScaleSpacer { width: 66px; flex: 0 0 auto; }
        .chartCategories { display: flex; flex: 1 1 auto; min-width: 0; margin-top: 6px; }
        .chartCategories span { flex: 1 1 0; text-align: center; font-size: 11px; font-weight: 800; color: rgba(203,213,225,0.68); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 1px; }
        .chartBlock { margin-top: 14px; }
        .chartBlock + .chartBlock { margin-top: 26px; }
        .chartBlockTitle { font-size: 13px; font-weight: 900; color: rgba(226,232,240,0.85); margin-bottom: 4px; }
        .yearGrid { margin-top: 14px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
        .yearBadge { display: flex; justify-content: space-between; gap: 10px; align-items: center; border-radius: 13px; padding: 10px 12px; font-size: 13px; font-weight: 950; border: 1px solid rgba(255,255,255,0.10); }
        .historyTable { width: 100%; border-collapse: separate; border-spacing: 0 10px; margin-top: 14px; }
        .historyTable th { text-align: left; color: rgba(203,213,225,0.68); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; padding: 0 10px; }
        .historyTable td { background: rgba(255,255,255,0.035); border-top: 1px solid rgba(255,255,255,0.07); border-bottom: 1px solid rgba(255,255,255,0.07); padding: 12px 10px; font-size: 13px; }
        .historyTable td:first-child { border-left: 1px solid rgba(255,255,255,0.07); border-radius: 12px 0 0 12px; font-weight: 900; }
        .historyTable td:last-child { border-right: 1px solid rgba(255,255,255,0.07); border-radius: 0 12px 12px 0; }
        .sideColumn { position: sticky; top: 18px; display: grid; gap: 16px; }
        .bulletList { margin: 14px 0 0; padding: 0; list-style: none; display: grid; gap: 12px; }
        .bulletList li { display: grid; grid-template-columns: 12px minmax(0, 1fr); gap: 10px; color: rgba(226,232,240,0.84); line-height: 1.65; }
        .bulletList li::before { content: ""; width: 9px; height: 9px; border-radius: 999px; margin-top: 8px; background: #22c55e; box-shadow: 0 0 0 4px rgba(34,197,94,0.10); }
        .estimateGrid { margin-top: 16px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        .estimateGridStacked { grid-template-columns: 1fr; }
        @media (max-width: 980px) { .hero, .contentGrid { grid-template-columns: 1fr; } .sideColumn { position: static; } .metricGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 720px) {
          .earningsPage, .earningsPage * { box-sizing: border-box; }
          .earningsWrap { width: 100%; padding: 14px 10px 38px; overflow-x: hidden; }
          .topLinks { display: grid; grid-template-columns: 1fr; justify-content: stretch; gap: 8px; margin-bottom: 12px; }
          .topLinks a, .actionLink { width: 100%; min-height: 44px; padding: 10px 12px; text-align: center; }
          .hero { padding: 16px; border-radius: 20px; gap: 18px; }
          .hero h1 { margin-top: 10px; font-size: clamp(29px, 9vw, 36px); line-height: 1.08; letter-spacing: -0.045em; }
          .hero p { font-size: 14px; line-height: 1.65; }
          .scoreCard, .card { width: 100%; min-width: 0; border-radius: 18px; padding: 15px; }
          .scoreTop { align-items: flex-start; }
          .scoreNumberRow { margin-top: 18px; }
          .scoreNumber { font-size: 42px; }
          .scoreNeedle { left: calc(${score.score}% - 8px); width: 16px; height: 22px; }
          .contentGrid { gap: 16px; }
          .card h2 { font-size: 23px; } .card h3 { font-size: 20px; }
          .card p, .bulletList li { font-size: 14px; line-height: 1.6; }
          .yearGrid, .earningsSearchRow, .estimateGrid { grid-template-columns: 1fr; }
          .metricGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
          .metricCard { padding: 10px !important; border-radius: 14px !important; }
          .metricValue { font-size: 18px; word-break: break-word; }
          .metricLabel { font-size: 9.5px; }
          .metricSub { font-size: 10.5px; margin-top: 5px; }
          .metricHelp { width: 14px; height: 14px; font-size: 9px; }
          .metricHelpBubble { position: fixed; left: 12px; right: 12px; bottom: auto; top: 92px; transform: none; width: auto; max-width: none; }
          .metricHelpBubble::after { display: none; }
          .trendDots { gap: 12px; justify-content: flex-start; }
          .trendDot { min-width: 48px; }
          .chartScale { width: 58px; }
          .chartScaleSpacer { width: 58px; }
          .chartScale span { font-size: 10px; left: 2px; right: 2px; }
          .chartCategories span { font-size: 9.5px; }
          .historyTable { display: block; width: 100%; border-spacing: 0; margin-top: 12px; }
          .historyTable thead { display: none; }
          .historyTable tbody, .historyTable tr, .historyTable td { display: block; width: 100%; }
          .historyTable tr { margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; background: rgba(255,255,255,0.035); overflow: hidden; }
          .historyTable td { display: flex; align-items: center; justify-content: space-between; gap: 14px; border: none; border-bottom: 1px solid rgba(255,255,255,0.07); border-radius: 0; background: transparent; padding: 11px 12px; font-size: 13px; text-align: right; }
          .historyTable td:first-child, .historyTable td:last-child { border-radius: 0; border-left: none; border-right: none; }
          .historyTable td:last-child { border-bottom: none; }
          .historyTable td::before { content: ""; flex: 0 0 auto; color: rgba(203,213,225,0.70); font-size: 11px; font-weight: 950; letter-spacing: 0.08em; text-transform: uppercase; text-align: left; }
          /* READ FROM THE CELL, NOT FROM ITS POSITION. These used to be seven
             nth-child rules naming the estimate columns that were retired on
             2026-09-15. There are now two tables on this page with different
             column sets, and a positional rule cannot serve both: it would
             silently relabel one of them. Each <td> carries its own
             data-label. */
          .historyTable td::before { content: attr(data-label); }
        }
        @media (max-width: 380px) { .earningsWrap { padding-left: 8px; padding-right: 8px; } .hero, .scoreCard, .card { padding: 13px; } .scoreNumber { font-size: 38px; } }
      `}</style>

        <div className="earningsWrap">
          <section className="hero">
            <div className="heroTopBar">
              <div className="eyebrow">Earnings desk</div>
              <ShareButton
                url={`https://www.mystockharbor.com/stock/${clean}/earnings`}
                title={`${clean} Earnings & Earnings Score | MyStockHarbor`}
                text={`${clean} earnings — GAAP EPS, revenue & earnings score 📊 MyStockHarbor`}
              />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "12px 0 0" }}>
                <TickerLogo symbol={clean} size={34} radius={8} />
                <h1 style={{ margin: 0 }}>{clean} Stock Earnings, EPS & Revenue Breakdown</h1>
              </div>
              <p>Review {clean}&apos;s latest reported quarter as filed with the SEC — GAAP EPS, revenue, margins, cash flow and the balance sheet, with year-over-year context and a simple earnings score.</p>
              <EarningsSymbolPicker currentSymbol={clean} />
            </div>
            <aside className="scoreCard">
              <div className="scoreTop">
                <div className="smallLabel">Earnings score</div>
                <div className="scorePill">{score.label}</div>
              </div>
              {/* No number and no needle when there is nothing to score. The
                  pill already says "Unavailable" and the explanation says why,
                  but a 48px "50/100" over a Weak-Mixed-Strong gradient with the
                  needle at dead centre is the visually dominant half of this
                  card -- it reads as a real neutral reading, and the honest
                  part is the easiest to miss. Verified rendering exactly that
                  way before this change. */}
              {score.available ? (
                <>
                  <div className="scoreNumberRow">
                    <div className="scoreNumber">{score.score}/100</div>
                    <EarningsScoreWatermark />
                  </div>
                  <div className="scoreBar" aria-hidden="true"><div className="scoreNeedle" /></div>
                  <div className="scoreLabels"><span>Weak</span><span>Mixed</span><span>Strong</span></div>
                </>
              ) : null}
              <p style={{ marginTop: 16 }}>{score.explanation}</p>
              {/* WHAT THE SCORE COULD NOT SEE, ON THE SCORE ITSELF.
                  /stock/AZN/earnings rendered GOOD 100/100 above a Quality of
                  Earnings card whose every field was "—". The number is only
                  readable next to its own gaps, so they sit here rather than
                  being inferable from a card further down the page. */}
              {score.available && score.unavailable.length ? (
                <p className="earningsDataNote" style={{ marginTop: 10 }}>
                  Not measured, because {clean}&apos;s filings do not carry it:{" "}
                  {score.unavailable.join("; ")}.
                </p>
              ) : null}
            </aside>
          </section>

          <section className="contentGrid">
            <div style={{ display: "grid", gap: 18 }}>
              {/* EVERY FINANCIAL CARD BELOW READS THE SEC FACT SET. When the
                  symbol has none yet, one honest card says so rather than six
                  cards of dashes. */}
              {nextReport?.date ? (
                <section className="card">
                  <div className="eyebrow">Next report</div>
                  <h3>Next expected earnings date</h3>
                  <p style={{ marginBottom: 0 }}>
                    <strong>{nextReport.date}</strong>{nextReport.time ? ` (${nextReport.time === "bmo" ? "before market open" : nextReport.time === "amc" ? "after market close" : nextReport.time})` : ""}.
                    {" "}This is the announcement date, which is not in SEC filings — it still comes
                    from the earnings calendar, as does the price-reaction card below.
                  </p>
                </section>
              ) : null}

              {/* THREE OUTCOMES, NOT TWO. "no readable XBRL" is a successful
                  fetch of nothing usable -- an IFRS filer, or a company with no
                  filed year yet -- and it must NEVER render as pending, because
                  the cron would re-read it daily and get the same nothing.
                  The 404 case never reaches here; see the guard above. */}
              {data.cold.status === "no-xbrl" ? (
                <SecNoXbrlCard
                  symbol={clean}
                  reason={data.cold.why}
                  taxonomies={data.cold.taxonomies}
                />
              ) :
               !secView ? <SecPendingCard symbol={clean} /> : (
                <>
                  <SecSnapshotCard view={secView} />
                  {/* HIDDEN, NOT REMOVED — the owner's standing rule. These two
                      were the FMP estimate cards: "EPS surprise" and "Revenue
                      surprise", both against FMP's epsEstimated /
                      revenueEstimated, which left the site on 2026-09-15 with
                      the rest of the FMP licence. Analyst consensus is not in
                      SEC filings and no free source covers it.
                      Deleting these loses the record of why the layout has a
                      gap, and the next person re-adds the column and wires it
                      to whatever is nearest. The registry entry is in
                      lib/server/secEarningsView.ts RETIRED_SOURCES. */}
                  <HiddenCard id="eps-estimate" />
                  <HiddenCard id="revenue-estimate" />
                  <SecGrowthMarginsCard view={secView} />
                  <SecCashQualityCard view={secView} />
                  <SecBalanceSheetCard view={secView} />
                  {/* HIDDEN, NOT REMOVED. Revenue by product and by region, from
                      FMP /revenue-product-segmentation and
                      /revenue-geographic-segmentation, retired 2026-09-15.
                      Segment revenue is filed on an XBRL segment axis and
                      companyfacts publishes the DEFAULT CONTEXT ONLY, so the
                      breakdown is not in it — this is not a chain gap that a
                      better tag would close. Source unresolved;
                      hide-list-verdict §6. */}
                  <HiddenCard id="revenue-by-segment" />
                </>
              )}

              <section className="card">
                <div className="eyebrow">Price reaction</div>
                <h2>How has {clean} actually traded around its last reports?</h2>
                <p>This shows the stock&apos;s closing-price move around each report: for reports released before market open, it&apos;s the move from the prior close into the report-day close; for reports released after market close, it&apos;s the move from the report-day close into the next day&apos;s close. When exact timing isn&apos;t available, it spans the day before the report to the day after.</p>
                {latestReaction && (latestReaction.reactionPct != null || latestReaction.volumeMultiple != null) && (
                  <p><strong>Most recent reaction ({latestReaction.label}):</strong> {formatPercent(latestReaction.reactionPct)}{latestReaction.volumeMultiple != null ? ` on ${latestReaction.volumeMultiple.toFixed(1)}x average volume` : ""}.</p>
                )}
                {hasAnyReaction ? (
                  <>
                    <div className="chartBlock">
                      <SingleValueBarChart data={reactionData} />
                    </div>
                    <SeriesLegend items={[{ label: "Rose after report", color: "#22c55e" }, { label: "Fell after report", color: "#ef4444" }]} />
                    <p className="earningsDataNote">This reflects the stock&apos;s actual price move, which can be driven by broader market moves as well as the earnings report itself &mdash; it isn&apos;t a clean read of earnings reaction alone.</p>
                  </>
                ) : (
                  <p>Not enough price history is available yet to chart the reaction around earnings.</p>
                )}
                {hasAnyDrift && (
                  <>
                    <div className="chartBlock">
                      <div className="chartBlockTitle">Did the move hold? Price vs. pre-earnings close, over time</div>
                      <MultiLineChart labels={driftLabels} series={driftSeries} />
                      <SeriesLegend items={[{ label: "Day of reaction", color: "#60a5fa" }, { label: "+5 trading days", color: "#facc15" }, { label: "+20 trading days", color: "#22c55e" }]} />
                    </div>
                    <p className="earningsDataNote">This tracks the stock from just before each report through the following weeks, to show whether the initial reaction stuck, faded, or reversed. The most recent quarters may not have a full 20 trading days of data yet.</p>
                  </>
                )}
              </section>

              {secView ? <SecRecentQuartersCard view={secView} /> : null}
            </div>

            <aside className="sideColumn">
              <section className="card">
                <div className="eyebrow">What it means</div>
                <h3>Investor read</h3>
                <p>{score.explanation}</p>
                {/* The generic bullets describe what the score reads WHEN it
                    can. A component that did not run must not be described
                    here as if it had -- the cash bullet is the one that read
                    as a claim on AZN, where the cash chain is empty. */}
                <ul className="bulletList">
                  <li>Year-over-year growth separates one-quarter noise from a real earnings trend.</li>
                  <li>Margins show whether the company is keeping more of each pound of revenue.</li>
                  {score.available && score.unavailable.includes(SCORE_COMPONENTS.cashConversion) ? (
                    <li>
                      Cash flow against net income would show whether reported profit is turning into
                      cash — {clean}&apos;s filings do not carry a cash-flow statement this page can
                      read, so it is not part of the score above.
                    </li>
                  ) : (
                    <li>Cash flow against net income shows whether reported profit is turning into cash.</li>
                  )}
                </ul>
              </section>

              {/* HIDDEN, NOT REMOVED. This was "Analyst estimates for the next
                  report" and the forward full-year consensus card, both from
                  FMP /analyst-estimates, retired 2026-09-15. Forward consensus
                  is not in SEC filings at all — company guidance appears in 8-K
                  exhibits as prose, not as structured data. */}
              <HiddenCard id="forward-consensus" stacked />

              {secView ? <SecIncomeStatementCard view={secView} /> : null}

              <section className="card">
                <div className="eyebrow">Why it matters</div>
                <h3>Earnings can reset the stock narrative</h3>
                <p>Earnings matter because they test whether the company story is being supported by actual revenue, profit and cash generation.</p>
              </section>

              <section className="card">
                <div className="eyebrow">Learn</div>
                <h3>New to reading earnings?</h3>
                <p>Understand EPS, margins, cash flow and the three financial statements behind every earnings report — in plain English.</p>
                <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                  <Link className="actionLink green" href="/learn/how-to-read-financial-data">How to Read Financial Data &rarr;</Link>
                </div>
              </section>

              <section className="card">
                <div className="eyebrow">Next step</div>
                <h3>Connect earnings with price action</h3>
                <p>Use this page for the earnings read, then compare it with the stock page and latest news.</p>
                <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                  <Link className="actionLink" href={`/stock/${encodeURIComponent(clean)}`}>Open {clean} stock page &rarr;</Link>
                  <Link className="actionLink green" href={`/stock/${encodeURIComponent(clean)}/news`}>Read {clean} news &rarr;</Link>
                  <Link className="actionLink" href="/pickers">Open stock pickers &rarr;</Link>
                </div>
              </section>
            </aside>
          </section>

          <HideWatermarksBar />
        </div>

        {/* -- Explore More Stocks -- server-rendered internal-linking
               module, same pattern as app/stock/[symbol]/page.tsx (see
               lib/curatedSymbols.ts + app/components/RelatedStocks.tsx). -- */}
        <RelatedStocks currentSymbol={clean} symbols={relatedSymbols} />
      </main>
    </WatermarkVisibilityProvider>
  );
}
