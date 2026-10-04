import type React from "react";
import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import AffiliateLink from "../../components/AffiliateLink";
import SPXChartClient from "./SPXChartClient";
import { getDailyHistory } from "@/lib/server/historyCache";
// RETIRED 2026-10-04 (#563 COWORK #90): the AI "market backdrop" (getSpxMarketAnalysis,
// lib/ai-market.ts) is no longer called here: undated, no inputs, and able to
// contradict the dated weekly copy. The module stays; the old page is kept in
// ./_retired/spx-page-2026-10-04.tsx.txt.
import { buildMarketMoodScore } from "@/lib/market-mood";
import { rsiWilder as sharedRsiWilder, lastNum } from "@/lib/indicators";
import PageShareBar from "@/app/components/PageShareBar";
import { priceProviderFor } from "@/lib/server/marketData/provider";
import { readTiingoHistory } from "@/lib/server/marketData/read";
import { TIINGO_CREDIT, TIINGO_URL } from "@/lib/server/tiingoSurfacePrice";
import { performanceStrip } from "@/lib/ta/performance";
import { computeMacroSupport } from "@/lib/ta/macroSupport";
import { macdTone } from "@/lib/ta/macdSeries";
import { indexWords, isStale, parseSpxWeekly, weeklyDate, type SectionKey, type SpxWeekly } from "@/lib/spxWeekly";
import { FAQ, WEEKLY_CHART_EXPLAINER, faqJsonLd, trendWords } from "@/lib/spxPage";
import { dailyReturnBars, monthlyReturnBars, weeklyReturnBars } from "@/lib/closeReturns";
import ReturnsToggleCard from "@/app/components/ReturnsToggleCard";
import PerformanceStrip from "@/app/stock/[symbol]/PerformanceStrip";
import StockPriceChart from "@/app/stock/[symbol]/StockPriceChart";
import ConfluenceCard from "@/app/stock/[symbol]/ConfluenceCard";
import KeyLevelsCard from "@/app/stock/[symbol]/KeyLevelsCard";
import LevelsSignals from "@/app/stock/[symbol]/LevelsSignals";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "S&P 500 (SPX) Analysis (2026) | Market Outlook | MyStockHarbor",
  description:
    "Learn how to analyse the S&P 500 (SPX), understand market pullbacks, and use charts, moving averages, RSI, and MACD to make calmer investing decisions.",
  alternates: {
    canonical: "https://www.mystockharbor.com/markets/spx",
  },
  openGraph: {
    title: "S&P 500 (SPX) Analysis (2026) | Market Outlook | MyStockHarbor",
    description:
      "Learn how to analyse the S&P 500 (SPX), understand market pullbacks, and use charts, moving averages, RSI, and MACD to make calmer investing decisions.",
    url: "https://www.mystockharbor.com/markets/spx",
    siteName: "MyStockHarbor",
    type: "website",
    images: [
      {
        url: "https://www.mystockharbor.com/og-image-v2.png",
        width: 1200,
        height: 630,
        alt: "MyStockHarbor trading dashboard",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "S&P 500 (SPX) Analysis (2026) | Market Outlook | MyStockHarbor",
    description:
      "Learn how to analyse the S&P 500 (SPX), understand market pullbacks, and use charts, moving averages, RSI, and MACD to make calmer investing decisions.",
    images: ["https://www.mystockharbor.com/og-image-v2.png"],
  },
};

type Point = {
  date: string;
  open?: number;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

// Mirrors the Feed<T> shape in lib/server/feedCache.ts, and for the same
// reason: a bare `catch { return [] }` here made a FAILED read
// indistinguishable from "the S&P 500 has no price history" -- a state that
// never occurs. Everything downstream then treated the failure as data. See
// claude/traps/return-type-cannot-express-failure.md.
type SpxChartRead = {
  points: Point[];
  // True when `points` reflects a real answer from upstream. False ONLY when
  // the read failed, in which case `points` is [] and means nothing.
  ok: boolean;
  /**
   * Which series `points` is. "SPY" on the Tiingo path: Tiingo does not
   * license index levels, so the chart is the SPDR S&P 500 ETF, and the page
   * says so under it (#553 CODE-B #42 §3, #563 COWORK #30/#31).
   */
  series: "^GSPC" | "SPY";
};

/**
 * THE TIINGO PATH (#563 COWORK #30), behind PRICE_PROVIDER_SPX: SPY's stored
 * EOD bars, read through B's adapter (one cached entry, 24 h safety TTL). Null
 * on no data, so the page keeps the FMP ^GSPC path: FMP stays this surface's
 * fallback until the owner flips it. ^GSPC is not requested on this path.
 */
async function getSpyPointsTiingo(): Promise<Point[] | null> {
  const eod = await readTiingoHistory("SPY").catch(() => null);
  const points = (eod?.bars ?? [])
    .map(([date, open, high, low, close, volume]) => ({ date, open, close, high, low, volume }))
    .filter((point) => point.date && Number.isFinite(point.close) && point.close > 0);
  return points.length ? points : null;
}

async function getSpxChartPoints(): Promise<SpxChartRead> {
  if (priceProviderFor("SPX") === "tiingo") {
    const spy = await getSpyPointsTiingo();
    if (spy) return { points: spy, ok: true, series: "SPY" };
  }
  try {
    const points = await getDailyHistory("^GSPC", { caller: "spx-page" });

    const mapped = points
      .map((point) => ({
        date: String(point?.date ?? ""),
        open: point?.open == null ? undefined : Number(point.open),
        close: Number(point?.close),
        high: point?.high == null ? undefined : Number(point.high),
        low: point?.low == null ? undefined : Number(point.low),
        volume: point?.volume == null ? undefined : Number(point.volume),
      }))
      .filter((point) => point.date && Number.isFinite(point.close));

    // A successful read returning nothing is not a real market state -- the
    // S&P 500 has price history every trading day it has ever existed. Same
    // free monitor as warnIfImplausiblyEmpty in feedCache: it catches a parser
    // drifting off FMP's field names, or a silently changed schema, neither of
    // which surfaces as an error.
    if (mapped.length === 0) {
      console.warn(
        "[spx] history read SUCCEEDED but returned an empty series. The S&P 500 " +
          "always has history, so this is a parse or schema problem, not an " +
          "empty market."
      );
    }

    return { points: mapped, ok: true, series: "^GSPC" };
  } catch (err) {
    console.error(
      "[spx] history read failed -- page renders as unavailable, not as a " +
        "market with no data:",
      err
    );
    return { points: [], ok: false, series: "^GSPC" };
  }
}

function movingAverage(values: number[], window: number): number | null {
  if (values.length < window) return null;

  const slice = values.slice(-window);
  const sum = slice.reduce((total, value) => total + value, 0);

  return sum / window;
}

// This page's local rsiWilder was NOT Wilder's RSI. It took a flat mean of the
// last 14 differences and stopped -- no recursive smoothing -- which is a
// different indicator (closer to Cutler's RSI) wearing Wilder's name. On a
// 300-bar test series it returned 98.42 where the seven other rsiWilder copies
// in this repo all returned 74.06, agreeing with each other at every index.
//
// It fed buildMarketMoodScore's +/-5 RSI term, which is enough to cross a
// Fear/Neutral/Greed band boundary on the gauge this page renders.
//
// Now imported from lib/indicators.ts rather than re-fixed locally: an eighth
// copy of an algorithm the other seven already agree on is what allowed one of
// them to be wrong unnoticed. lastNum takes the final value, since this page
// wants a scalar and the shared function returns the full series.
function rsiWilder(values: number[], period = 14): number | null {
  return lastNum(sharedRsiWilder(values, period));
}

function primaryBtn(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "13px 18px",
    borderRadius: 14,
    border: "1px solid rgba(34,197,94,0.45)",
    background:
      "linear-gradient(135deg, rgba(34,197,94,0.22), rgba(59,130,246,0.18))",
    color: "#f8fafc",
    textDecoration: "none",
    fontWeight: 900,
    letterSpacing: "0.2px",
    minHeight: 48,
    boxShadow: "0 10px 24px rgba(0,0,0,0.22)",
    whiteSpace: "nowrap",
  };
}

function secondaryBtn(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "13px 18px",
    borderRadius: 14,
    border: "1px solid rgba(59,130,246,0.35)",
    background: "rgba(59,130,246,0.12)",
    color: "#dbeafe",
    textDecoration: "none",
    fontWeight: 900,
    letterSpacing: "0.2px",
    minHeight: 48,
    whiteSpace: "nowrap",
  };
}

/** A moving average for every bar (null until `window` closes), for the price chart's lines. */
function maSeries(values: number[], window: number): (number | null)[] {
  let sum = 0;
  return values.map((v, i) => {
    sum += v;
    if (i >= window) sum -= values[i - window];
    return i >= window - 1 ? sum / window : null;
  });
}

/**
 * THE WEEKLY FIGURES (#563 COWORK #90): content/markets/spx-weekly.json, read at
 * render time and checked (lib/spxWeekly.ts). A file that fails the check shows
 * no weekly figures, never wrong ones, and says so in the server log.
 */
function readWeekly(): SpxWeekly | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "content/markets/spx-weekly.json"), "utf8"));
    const r = parseSpxWeekly(raw);
    if (r.ok) return r.data;
    console.error("[spx] content/markets/spx-weekly.json failed its check:", r.problems.join("; "));
  } catch (err) {
    console.error("[spx] content/markets/spx-weekly.json could not be read:", err);
  }
  return null;
}

const C = {
  muted: "rgba(203,213,225,0.66)",
  value: "#f1f5f9",
  rule: "rgba(255,255,255,0.10)",
  amber: "#fbbf24",
};

function card(extra?: React.CSSProperties): React.CSSProperties {
  return { borderRadius: 18, border: "1px solid rgba(148,163,184,0.22)", background: "linear-gradient(135deg, rgba(148,163,184,0.06), rgba(255,255,255,0.02))", padding: 18, minWidth: 0, ...extra };
}
const eyebrow: React.CSSProperties = { fontSize: 11, fontWeight: 950, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(147,197,253,0.85)" };
const h2: React.CSSProperties = { margin: "6px 0 0", fontSize: 24, lineHeight: 1.15, letterSpacing: "-0.03em" };
const small: React.CSSProperties = { margin: "8px 0 0", fontSize: 12, lineHeight: 1.5, color: C.muted };

/**
 * THE WRITE-UP UNDER A VISUAL (#563 COWORK #91): 2–4 sentences from the weekly
 * file saying what the visual shows this week. Dated when the file is stale.
 */
function WriteUp({ weekly, k, stale }: { weekly: SpxWeekly | null; k: SectionKey; stale: boolean }) {
  const sec = weekly?.sections[k];
  if (!weekly || !sec) return null;
  return (
    <div className="spxWriteUp" data-section={k} style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.rule}` }}>
      {sec.heading ? <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{sec.heading}</h3> : null}
      <p style={{ margin: sec.heading ? "6px 0 0" : 0, fontSize: 15, lineHeight: 1.65, opacity: 0.88 }}>{sec.body}</p>
      {stale ? <p style={{ ...small, color: C.amber, fontWeight: 700 }}>From the weekly update of {weeklyDate(weekly.asOf)}.</p> : null}
    </div>
  );
}

/** A hero tile: label, value, a line under it; `dated` lifts the date out when the weekly file is stale. */
function Tile({ label, value, sub, tone, dated }: { label: string; value: React.ReactNode; sub: React.ReactNode; tone?: string; dated?: boolean }) {
  return (
    <div className="spxTile" style={{ ...card({ padding: 14 }) }}>
      <div style={{ fontSize: 10.5, fontWeight: 850, letterSpacing: "0.08em", textTransform: "uppercase", color: C.muted }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 24, fontWeight: 900, letterSpacing: "-0.03em", color: tone ?? C.value, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ marginTop: 4, fontSize: 11.5, lineHeight: 1.4, color: dated ? C.amber : C.muted, fontWeight: dated ? 750 : 400 }}>{sub}</div>
    </div>
  );
}

/** The render time: the session rule and the weekly file's staleness are judged against it (force-dynamic, per request). */
function renderTime(): number {
  return Date.now();
}

export default async function SPXPage() {
  const { points, ok: chartOk, series: chartSeries } = await getSpxChartPoints();
  const weekly = readWeekly();
  const nowMs = renderTime();
  const stale = weekly ? isStale(weekly.asOf, nowMs) : false;

  const closes = points.map((point) => point.close);
  const lastClose = closes.length ? closes[closes.length - 1] : null;
  const ma50 = movingAverage(closes, 50);
  const ma200 = movingAverage(closes, 200);
  const rsi = rsiWilder(closes, 14);
  // buildMarketMoodScore starts at 50 and only moves with real inputs, so a failed
  // read would show a confident "50/100". Compute it only when the read answered.
  // RENAMED "Trend score" (owner, #563 COWORK #90): it reads the price trend, not mood.
  const trend = chartOk ? buildMarketMoodScore({ lastClose, ma50, ma200, rsi }) : null;

  // LIVE (#90): every figure below is SPY's (Tiingo), the series the page draws.
  const onSpy = chartSeries === "SPY";
  const credit = onSpy ? <a href={TIINGO_URL} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>{TIINGO_CREDIT}</a> : undefined;
  const liveLabel = onSpy ? "Shown on SPY, the ETF that tracks the S&P 500" : "Shown on the S&P 500 index";
  const bars = points.filter((p) => Number.isFinite(p.open) && Number.isFinite(p.high) && Number.isFinite(p.low)) as Required<Pick<Point, "date" | "open" | "high" | "low" | "close">>[];
  const strip = performanceStrip(points, null, nowMs, { benchmark: false });
  const macro = lastClose !== null ? computeMacroSupport(points, lastClose) : null;
  const ma50s = maSeries(closes, 50), ma200s = maSeries(closes, 200);
  const fromAth = weekly ? (weekly.indexClose / weekly.ath.level - 1) * 100 : null;
  const trendTone = trend ? (trend.score >= 56 ? "#86efac" : trend.score <= 44 ? "#fca5a5" : "#fde68a") : C.value;

  const faqLd = faqJsonLd();

  return (
    <main style={{ minHeight: "100vh", background: "#06080d", color: "#f1f5f9", fontFamily: "system-ui, Arial" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
      <div className="spxWrap" style={{ maxWidth: 1080, margin: "0 auto", padding: 24, boxSizing: "border-box" }}>
        <PageShareBar
          url="https://www.mystockharbor.com/markets/spx"
          title="S&P 500 (SPX) Analysis | MyStockHarbor"
          text="S&P 500 market analysis — trend, moving averages, RSI and what's happening right now 📊 MyStockHarbor"
        />

        <div style={{ display: "grid", gap: 16 }}>
          {/* 1. HERO: the H1, the week's dated line, four tiles (two weekly, one live, one weekly). */}
          <section className="spxHero" style={card({ border: "1px solid rgba(59,130,246,0.24)", background: "linear-gradient(135deg, rgba(37,99,235,0.14), rgba(15,23,42,0.92))", padding: 22 })}>
            <div style={{ fontSize: 12, opacity: 0.72, fontWeight: 900 }}>MARKET ANALYSIS</div>
            <h1 style={{ margin: "10px 0 0", fontSize: 38, lineHeight: 1.1, letterSpacing: "-0.9px", maxWidth: 820, fontWeight: 500 }}>
              S&amp;P 500 (SPX) Analysis (2026) – What the Market Is Actually Doing Right Now
            </h1>
            {/* THE INTRO (#91): 2–3 sentences, the page's main text, visible. */}
            {weekly ? <p className="spxIntro" style={{ margin: "12px 0 0", fontSize: 17, lineHeight: 1.65, opacity: 0.92, maxWidth: 820 }}>{weekly.intro}</p> : null}
            {weekly ? (
              <p className="spxOneLiner" style={{ margin: "12px 0 0", fontSize: 14, lineHeight: 1.6, opacity: 0.92, maxWidth: 820 }}>
                {stale ? <strong style={{ color: C.amber }}>Last weekly update: {weeklyDate(weekly.asOf)}. </strong> : <span style={{ color: C.muted }}>In one line, {weeklyDate(weekly.asOf)}: </span>}
                {weekly.oneLiner}
              </p>
            ) : null}
            <div className="spxTiles" style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
              {weekly ? <Tile label="S&P 500 close" value={indexWords(weekly.indexClose)} sub={`Index close, ${weeklyDate(weekly.asOf)}`} dated={stale} /> : null}
              {weekly && fromAth !== null ? (
                <Tile label="From the record high" value={`${fromAth >= 0 ? "+" : "−"}${Math.abs(fromAth).toFixed(1)}%`}
                  sub={`Record close ${indexWords(weekly.ath.level)} on ${weeklyDate(weekly.ath.date)}`} dated={stale} />
              ) : null}
              <Tile label="Trend score" value={trend ? `${trend.score}/100` : "—"} tone={trendTone}
                sub={trend ? `${trendWords(trend.score)} · a price-trend score from SPY's moving averages and RSI (14), not sentiment` : "SPY's price history couldn't be loaded just now"} />
              {weekly ? (
                <Tile label="Sentiment" value={`${weekly.sentiment.fearGreed} · ${weekly.sentiment.label}`}
                  sub={`${weekly.sentiment.source}, ${weeklyDate(weekly.sentiment.date)}`} dated={stale} />
              ) : null}
            </div>
          </section>

          {/* 2. PERFORMANCE (live). */}
          {strip.chips.length ? (
            <section style={card()}>
              <div style={eyebrow}>Performance</div>
              <p style={{ ...small, marginTop: 4 }}>{liveLabel}</p>
              <PerformanceStrip strip={strip} credit={credit} />
              <WriteUp weekly={weekly} k="performance" stale={stale} />
            </section>
          ) : null}

          {/* 3. PRICE CHART with MA50 / MA200 (live). */}
          {points.length ? (
            <section style={card()}>
              <div style={eyebrow}>Price chart</div>
              <h2 style={h2}>{onSpy ? "SPY" : "S&P 500"} with MA50 and MA200</h2>
              <p style={{ ...small, marginTop: 4 }}>{liveLabel}</p>
              <div style={{ marginTop: 12 }}>
                <StockPriceChart symbol={onSpy ? "SPY" : "SPX"} data={points.slice(-240)} ma50={ma50s.slice(-240)} ma200={ma200s.slice(-240)} height={320} credit={credit ?? null} />
              </div>
              <WriteUp weekly={weekly} k="chart" stale={stale} />
            </section>
          ) : (
            <section style={card()}><p style={{ margin: 0, fontSize: 14, color: C.muted }}>We couldn&apos;t load the S&amp;P 500 price history just now. This is a problem on our side, not a market with no data; it should return on a refresh.</p></section>
          )}

          {/* 4. PRICE ZONES + KEY LEVELS (live): the stock page's cards, replacing hand-typed levels. */}
          {bars.length ? (
            <section style={{ display: "grid", gap: 4, minWidth: 0 }}>
            <div className="spxLevels" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16, alignItems: "start" }}>
              <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
                <ConfluenceCard bars={bars} lastPrice={lastClose} nowMs={nowMs} ma50={ma50} ma200={ma200} macro={macro ? { lower: macro.lower, upper: macro.upper } : null} credit={credit} />
                <p style={{ ...small, margin: "0 4px" }}>{liveLabel}</p>
              </div>
              <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
                <KeyLevelsCard bars={bars} lastPrice={lastClose} nowMs={nowMs} credit={credit} />
                <p style={{ ...small, margin: "0 4px" }}>{liveLabel}</p>
              </div>
            </div>
            {weekly ? <div style={card({ paddingTop: 4 })}><WriteUp weekly={weekly} k="levels" stale={stale} /></div> : null}
            </section>
          ) : null}

          {/* 5. PRICE LEVELS & SIGNALS (live). */}
          {points.length ? (
            <section style={card()}>
              <div style={eyebrow}>Technical indicators</div>
              <h2 style={h2}>Price levels &amp; signals</h2>
              <p style={{ ...small, marginTop: 4 }}>{liveLabel}</p>
              <div style={{ marginTop: 12 }}>
                <LevelsSignals
                  last={lastClose}
                  ma50={ma50}
                  ma200={ma200}
                  zone={macro}
                  zoneMissing="No repeated weekly support zone found"
                  rsi={rsi}
                  macdTone={macdTone(closes)}
                  macdBars={points}
                  asOf={points[points.length - 1].date}
                  credit={credit}
                />
              </div>
              <WriteUp weekly={weekly} k="signals" stale={stale} />
            </section>
          ) : null}

          {/* 6. CLOSE-OVER-CLOSE (live): B's card (#553 COWORK #115) on SPY's closes. */}
          {points.length ? (
            // B's card brings its own frame (as on the stock page); a second card's padding
            // around it left its three tabs too wide at 320 px.
            <section className="spxChange" style={{ minWidth: 0, padding: "4px 2px" }}>
              <div style={eyebrow}>Price action</div>
              <h2 style={h2}>Daily, weekly or monthly close-over-close change</h2>
              <p style={{ ...small, marginTop: 4 }}>{liveLabel}</p>
              <div style={{ marginTop: 12 }}>
                <ReturnsToggleCard symbol={onSpy ? "SPY" : "SPX"} daily={dailyReturnBars(points, 20)} weekly={weeklyReturnBars(points, 12)} monthly={monthlyReturnBars(points, 12)} />
              </div>
              {credit ? <p style={small}>Daily prices: {credit}</p> : null}
              <WriteUp weekly={weekly} k="change" stale={stale} />
            </section>
          ) : null}

          {/* 7. THIS WEEK IN 3 POINTS (weekly, at a glance) BESIDE THE MARKET READ (#91: 250–350 words,
              replacing the old Simple view / market read / closing prose). */}
          {weekly ? (
            <section className="spxRead" style={{ display: "grid", gridTemplateColumns: "minmax(0, 0.9fr) minmax(0, 1.5fr)", gap: 16, alignItems: "start" }}>
            <div style={card()}>
              <div style={eyebrow}>This week in 3 points</div>
              <div className="spxPoints" style={{ marginTop: 12, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12 }}>
                {weekly.points.map((pt) => (
                  <div key={pt.label} className="spxPoint" style={card({ padding: 14 })}>
                    <div style={{ fontSize: 13, fontWeight: 850, color: C.value }}>{pt.label}</div>
                    <p style={{ margin: "6px 0 0", fontSize: 14, lineHeight: 1.55, opacity: 0.88 }}>{pt.text}</p>
                    {/^breadth$/i.test(pt.label) ? (
                      <div className="spxBreadth" style={{ marginTop: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: C.muted }}>
                          <span>Stocks above their 200-day average</span>
                          <strong style={{ color: C.value }}>{weekly.breadth.pct200 !== null ? `${weekly.breadth.pct200}%` : "—"}</strong>
                        </div>
                        <div aria-hidden="true" style={{ marginTop: 5, height: 8, borderRadius: 4, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                          {weekly.breadth.pct200 !== null ? <div style={{ width: `${weekly.breadth.pct200}%`, height: "100%", background: "#38bdf8" }} /> : null}
                        </div>
                        <div style={{ marginTop: 4, fontSize: 11, color: stale ? C.amber : C.muted }}>
                          {weekly.breadth.pct200 !== null ? `${weekly.breadth.source}, ${weeklyDate(weekly.breadth.date)}` : `Not in this week's update (${weeklyDate(weekly.breadth.date)})`}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
            <article className="spxMarketRead" style={card()}>
              <div style={eyebrow}>Market read</div>
              <h2 style={h2}>What moved the S&amp;P 500 this week</h2>
              <p style={{ ...small, marginTop: 4, color: stale ? C.amber : C.muted, fontWeight: stale ? 700 : 400 }}>Week to {weeklyDate(weekly.asOf)}</p>
              {weekly.marketRead.map((para, i) => <p key={i} style={{ margin: "12px 0 0", fontSize: 15.5, lineHeight: 1.7, opacity: 0.9 }}>{para}</p>)}
            </article>
            </section>
          ) : null}

          {/* 8. WHAT TO WATCH (weekly). */}
          {weekly ? (
            <section style={card()}>
              <div style={eyebrow}>What to watch</div>
              <div className="spxWatch" style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                {([["What would weaken the picture", weekly.watchDown, "#f87171"], ["What would strengthen it", weekly.watchUp, "#4ade80"]] as const).map(([title, items, colour]) => (
                  <div key={title} style={card({ padding: 14 })}>
                    <div style={{ fontSize: 13, fontWeight: 850, color: colour }}>{title}</div>
                    <ul style={{ margin: "8px 0 0", paddingLeft: 18, display: "grid", gap: 6 }}>
                      {items.map((x) => <li key={x} style={{ fontSize: 14, lineHeight: 1.5, opacity: 0.88 }}>{x}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
              <p style={small}>Levels mentioned here can be read against the Price zones above.</p>
            </section>
          ) : null}

          {/* 9. WEEKLY CHART SNAPSHOT (live). */}
          <section style={card()}>
            <div style={eyebrow}>Weekly chart</div>
            <h2 style={h2}>Weekly SPX chart snapshot</h2>
            <p style={{ ...small, marginTop: 4 }}>Each bar is one week, with the 50- and 200-week averages: the larger trend behind the daily moves.</p>
            <div style={{ marginTop: 12 }}>
              <SPXChartClient chartPoints={points} symbol={chartSeries === "SPY" ? "SPY" : "SPX"} />
            </div>
            {/* THE CHART IS THE ETF ON THE TIINGO PATH, and says so (#563 COWORK
                #31 §3, wording approved there): the weekly copy quotes index
                levels, a SPY chart runs at about a tenth of them. The credit is
                linked (COWORK #31 §5). */}
            {chartSeries === "SPY" ? (
              <p style={{ margin: "12px 0 0", fontSize: 13, opacity: 0.7, lineHeight: 1.6 }}>
                Chart shows the SPDR S&amp;P 500 ETF (SPY). Levels quoted in the text refer to the S&amp;P 500 index.{" "}
                <a href={TIINGO_URL} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>{TIINGO_CREDIT}</a>
              </p>
            ) : null}
            {/* WHY THE WEEKLY CHART MATTERS (#91): evergreen, visible, ~150–200 words. */}
            <div className="spxWeeklyWhy" style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.rule}` }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Why the weekly chart matters</h3>
              {WEEKLY_CHART_EXPLAINER.map((para, i) => <p key={i} style={{ margin: "8px 0 0", fontSize: 15, lineHeight: 1.7, opacity: 0.88 }}>{para}</p>)}
            </div>
          </section>

          {/* 10. CHARTING TOOLS: moved here from the hero (owner, #90). */}
          <section style={card({ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" })}>
            <div style={{ fontSize: 14, lineHeight: 1.5, color: C.muted, maxWidth: 520 }}>To study the S&amp;P 500 chart in more detail, some readers use these platforms.</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <AffiliateLink href="/api/go/tradingview" eventLabel="SPX Page CTA TradingView" style={primaryBtn()}>TradingView →</AffiliateLink>
              <AffiliateLink href="/api/go/etoro" eventLabel="SPX Page CTA eToro" style={secondaryBtn()}>eToro →</AffiliateLink>
            </div>
          </section>

          {/* 11. FAQ: native <details>, closed; the FAQPage JSON-LD above carries the same words. */}
          <section className="spxFaq" style={card()}>
            <div style={eyebrow}>FAQ</div>
            <h2 style={h2}>Common questions about the S&amp;P 500 page</h2>
            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              {FAQ.map((f) => (
                <details key={f.q} className="spxFaqItem" style={{ borderTop: `1px solid ${C.rule}`, paddingTop: 8 }}>
                  <summary style={{ cursor: "pointer", fontSize: 15, fontWeight: 750 }}>{f.q}</summary>
                  <p style={{ margin: "6px 0 0", fontSize: 14, lineHeight: 1.6, opacity: 0.85 }}>{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        </div>
      </div>
      <style>{`
        @media (max-width: 900px) {
          .spxTiles { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
          .spxLevels, .spxPoints, .spxWatch, .spxRead { grid-template-columns: minmax(0, 1fr) !important; }
        }
        @media (max-width: 640px) {
          .spxWrap { padding: 16px !important; }
          .spxHero h1 { font-size: 28px !important; }
        }
      `}</style>
    </main>
  );
}
