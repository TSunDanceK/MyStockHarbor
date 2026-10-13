import type React from "react";
import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import AffiliateLink from "../../components/AffiliateLink";
// THE NASDAQ-100 PAGE (#553 COWORK #217): the twin of /markets/spx, same
// structure, components and styling, on QQQ's Tiingo bars. Charts and levels
// are on QQQ (a licensable security); the Nasdaq-100 index (NDX) appears only
// as text in the weekly file, the same pattern as SPX / SPY.
import SPXChartClient from "../spx/SPXChartClient";
import LevelsGlanceCard from "../spx/LevelsGlanceCard";
import MarketMoodCard from "../spx/MarketMoodCard";
import { buildMarketMoodScore } from "@/lib/market-mood";
import { rsiWilder as sharedRsiWilder, lastNum } from "@/lib/indicators";
import PageShareBar from "@/app/components/PageShareBar";
import { readTiingoHistory } from "@/lib/server/marketData/read";
import { TIINGO_CREDIT, TIINGO_URL } from "@/lib/server/tiingoSurfacePrice";
import TiingoCredit from "@/app/components/TiingoCredit";
import { performanceStrip } from "@/lib/ta/performance";
import { computeMacroSupport } from "@/lib/ta/macroSupport";
import { macdTone } from "@/lib/ta/macdSeries";
import { indexWords, isStale, parseQqqWeekly, weeklyDate, type QqqWeekly, type SectionKey } from "@/lib/qqqWeekly";
import { FAQ, QQQ_DESCRIPTION, QQQ_TITLE, QQQ_URL, WEEKLY_CHART_EXPLAINER, faqJsonLd, trendWords } from "@/lib/qqqPage";
import { dailyReturnBars, monthlyReturnBars, weeklyReturnBars } from "@/lib/closeReturns";
import { TREND_METER_CSS, TrendMeter } from "@/app/components/TrendMeter";
import ReturnsToggleCard from "@/app/components/ReturnsToggleCard";
import PerformanceStrip from "@/app/stock/[symbol]/PerformanceStrip";
import StockPriceChart from "@/app/stock/[symbol]/StockPriceChart";
import ConfluenceCard from "@/app/stock/[symbol]/ConfluenceCard";
import KeyLevelsCard from "@/app/stock/[symbol]/KeyLevelsCard";
import LevelsSignals from "@/app/stock/[symbol]/LevelsSignals";
import { readMarketMood } from "@/lib/server/marketMoodRead";
import { moodView } from "@/lib/marketMood";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: QQQ_TITLE,
  description: QQQ_DESCRIPTION,
  alternates: {
    canonical: QQQ_URL,
  },
  openGraph: {
    title: QQQ_TITLE,
    description: QQQ_DESCRIPTION,
    url: QQQ_URL,
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
    title: QQQ_TITLE,
    description: QQQ_DESCRIPTION,
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

/**
 * QQQ's stored EOD bars, through the Data Cache (one cached entry per symbol,
 * the same reader as the SPX page's SPY: no new Redis read shape). Tiingo only:
 * there is no FMP fallback for this page. `ok` is false ONLY when no bars came
 * back, and the page then says so rather than drawing an empty market.
 */
async function getQqqPoints(): Promise<{ points: Point[]; ok: boolean }> {
  const eod = await readTiingoHistory("QQQ").catch(() => null);
  const points = (eod?.bars ?? [])
    .map(([date, open, high, low, close, volume]) => ({ date, open, close, high, low, volume }))
    .filter((point) => point.date && Number.isFinite(point.close) && point.close > 0);
  if (!points.length) console.error("[qqq] QQQ's stored bars could not be read -- page renders as unavailable");
  return { points, ok: points.length > 0 };
}

function movingAverage(values: number[], window: number): number | null {
  if (values.length < window) return null;
  const slice = values.slice(-window);
  return slice.reduce((total, value) => total + value, 0) / window;
}

/** Wilder's RSI, the shared implementation (lib/indicators.ts); the last value. */
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
    background: "linear-gradient(135deg, rgba(34,197,94,0.22), rgba(59,130,246,0.18))",
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
 * THE WEEKLY FIGURES: content/markets/qqq-weekly.json, read at render time and
 * checked (lib/qqqWeekly.ts, the SPX file's rules). A file that fails the check
 * shows no weekly figures, never wrong ones, and says so in the server log.
 */
function readWeekly(): QqqWeekly | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "content/markets/qqq-weekly.json"), "utf8"));
    const r = parseQqqWeekly(raw);
    if (r.ok) return r.data;
    console.error("[qqq] content/markets/qqq-weekly.json failed its check:", r.problems.join("; "));
  } catch (err) {
    console.error("[qqq] content/markets/qqq-weekly.json could not be read:", err);
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
const eyebrow: React.CSSProperties = { fontSize: "var(--fs-label)", fontWeight: 950, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(147,197,253,0.85)" };
const h2: React.CSSProperties = { margin: "6px 0 0", fontSize: "1.5rem", lineHeight: 1.15, letterSpacing: "-0.03em" };
// FINE PRINT ONLY: credits, "shown on QQQ", "as of" stamps; marked data-fine-print where used.
const small: React.CSSProperties = { margin: "8px 0 0", fontSize: "var(--fs-fine)", lineHeight: 1.5, color: C.muted };
/** A sentence under a visual (a caption the reader is meant to read): reading size. */
const note: React.CSSProperties = { margin: "8px 0 0", fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)", color: C.muted };
const crossLink: React.CSSProperties = { display: "inline-block", marginTop: 14, fontSize: "var(--fs-read)", fontWeight: 800, color: "#93c5fd", textDecoration: "none" };

/** THE WRITE-UP UNDER A VISUAL: 2–4 sentences from the weekly file. Dated when the file is stale. */
function WriteUp({ weekly, k, stale }: { weekly: QqqWeekly | null; k: SectionKey; stale: boolean }) {
  const sec = weekly?.sections[k];
  if (!weekly || !sec) return null;
  return (
    <div className="qqqWriteUp" data-section={k} style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.rule}` }}>
      {sec.heading ? <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 800 }}>{sec.heading}</h3> : null}
      <p style={{ margin: sec.heading ? "6px 0 0" : 0, fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)", opacity: 0.88 }}>{sec.body}</p>
      {stale ? <p data-fine-print style={{ ...small, color: C.amber, fontWeight: 700 }}>From the weekly update of {weeklyDate(weekly.asOf)}.</p> : null}
    </div>
  );
}

/** A hero tile: label, value, a line under it; `dated` lifts the date out when the weekly file is stale. */
function Tile({ label, value, sub, tone, dated, wide }: { label: string; value: React.ReactNode; sub: React.ReactNode; tone?: string; dated?: boolean; wide?: boolean }) {
  return (
    <div className={wide ? "qqqTile qqqTrendTile" : "qqqTile"} style={{ ...card({ padding: 14 }) }}>
      <div style={{ fontSize: "var(--fs-label)", fontWeight: 850, letterSpacing: "0.08em", textTransform: "uppercase", color: C.muted }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: "1.5rem", fontWeight: 900, letterSpacing: "-0.03em", color: tone ?? C.value, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ marginTop: 4, fontSize: "var(--fs-read)", lineHeight: 1.45, color: dated ? C.amber : C.muted, fontWeight: dated ? 750 : 400 }}>{sub}</div>
    </div>
  );
}

/** The render time: the session rule and the weekly file's staleness are judged against it (force-dynamic, per request). */
function renderTime(): number {
  return Date.now();
}

export default async function QQQPage() {
  const { points, ok: chartOk } = await getQqqPoints();
  const weekly = readWeekly();
  const nowMs = renderTime();
  const stale = weekly ? isStale(weekly.asOf, nowMs) : false;

  const closes = points.map((point) => point.close);
  const lastClose = closes.length ? closes[closes.length - 1] : null;
  const ma50 = movingAverage(closes, 50);
  const ma200 = movingAverage(closes, 200);
  const rsi = rsiWilder(closes, 14);
  // buildMarketMoodScore starts at 50 and only moves with real inputs, so a
  // failed read would show a confident "50/100": computed only when bars came back.
  const trend = chartOk ? buildMarketMoodScore({ lastClose, ma50, ma200, rsi }) : null;

  // LIVE: every figure below is QQQ's (Tiingo), the series the page draws.
  const credit = <a href={TIINGO_URL} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>{TIINGO_CREDIT}</a>;
  const liveLabel = "Shown on QQQ, the ETF that tracks the Nasdaq-100";
  const bars = points.filter((p) => Number.isFinite(p.open) && Number.isFinite(p.high) && Number.isFinite(p.low)) as Required<Pick<Point, "date" | "open" | "high" | "low" | "close">>[];
  const strip = performanceStrip(points, null, nowMs, { benchmark: false });
  const macro = lastClose !== null ? computeMacroSupport(points, lastClose) : null;
  // Price zones and Levels to watch read the same zones: one input object, passed to both.
  const zoneInput = { bars, lastPrice: lastClose, nowMs, ma50, ma200, macro: macro ? { lower: macro.lower, upper: macro.upper } : null };
  const ma50s = maSeries(closes, 50), ma200s = maSeries(closes, 200);
  const fromAth = weekly ? (weekly.indexClose / weekly.ath.level - 1) * 100 : null;
  const trendTone = trend ? (trend.score >= 56 ? "#86efac" : trend.score <= 44 ? "#fca5a5" : "#fde68a") : C.value;

  // MARKET MOOD: the site-wide reading the SPX page shows (computed nightly over
  // our whole stock universe), NOT a Nasdaq-100-only one, and labelled so. A
  // members-only reading needs a Nasdaq-100 membership list, which we don't
  // hold from a licensed source; this read adds no Redis command (it is the
  // same Data Cache entry the SPX page reads).
  const mood = moodView(await readMarketMood());
  const faqLd = faqJsonLd();

  return (
    <main style={{ minHeight: "100vh", background: "#06080d", color: "#f1f5f9", fontFamily: "system-ui, Arial" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
      <div className="qqqWrap" style={{ maxWidth: 1080, margin: "0 auto", padding: 24, boxSizing: "border-box" }}>
        <PageShareBar
          url={QQQ_URL}
          title="Nasdaq-100 (QQQ) Analysis | MyStockHarbor"
          text="Nasdaq-100 market analysis on QQQ — trend, moving averages, RSI and what moved the index this week 📊 MyStockHarbor"
        />

        <div style={{ display: "grid", gap: 16 }}>
          {/* 1. HERO: the H1, the week's dated line, three tiles (two weekly, one live) and Market Mood (nightly). */}
          <section className="qqqHero" style={card({ border: "1px solid rgba(59,130,246,0.24)", background: "linear-gradient(135deg, rgba(37,99,235,0.14), rgba(15,23,42,0.92))", padding: 22 })}>
            <div className="qqqHeroGrid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: 18, alignItems: "stretch" }}>
            <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "var(--fs-label)", opacity: 0.72, fontWeight: 900 }}>MARKET ANALYSIS</div>
            <h1 style={{ margin: "10px 0 0", fontSize: "2.375rem", lineHeight: 1.1, letterSpacing: "-0.9px", maxWidth: 820, fontWeight: 500 }}>
              Nasdaq-100 (QQQ) Analysis (2026) – What Tech-Heavy Stocks Are Actually Doing Right Now
            </h1>
            {weekly ? <p className="qqqIntro" style={{ margin: "12px 0 0", fontSize: "1.0625rem", lineHeight: 1.65, opacity: 0.92, maxWidth: 820 }}>{weekly.intro}</p> : null}
            {weekly ? (
              <p className="qqqOneLiner" style={{ margin: "12px 0 0", fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)", opacity: 0.92, maxWidth: 820 }}>
                {stale ? <strong style={{ color: C.amber }}>Last weekly update: {weeklyDate(weekly.asOf)}. </strong> : <span style={{ color: C.muted }}>In one line, {weeklyDate(weekly.asOf)}: </span>}
                {weekly.oneLiner}
              </p>
            ) : null}
            <div className="qqqTiles" style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
              {weekly ? <Tile label="Nasdaq-100 close" value={indexWords(weekly.indexClose)} sub={`Index close, ${weeklyDate(weekly.asOf)}`} dated={stale} /> : null}
              {weekly && fromAth !== null ? (
                <Tile label="From the record high" value={`${fromAth >= 0 ? "+" : "−"}${Math.abs(fromAth).toFixed(1)}%`}
                  sub={`Record close ${indexWords(weekly.ath.level)} on ${weeklyDate(weekly.ath.date)}`} dated={stale} />
              ) : null}
              {/* THE TREND SCORE ON THE DASHBOARD'S METER (#553 COWORK #221): "85/100", the shared
                  10-cell bar (app/components/TrendMeter.tsx) and the trend words in one row;
                  the caption one short line. Spans the row where the tiles run two across. */}
              <Tile label="Trend score" wide tone={trendTone}
                value={trend ? (
                  <span className="qqqTrendRow" data-trend={trend.score}>
                    <span>{trend.score}/100</span>
                    <TrendMeter score={trend.score} />
                    <span className="qqqTrendWords">{trendWords(trend.score)}</span>
                  </span>
                ) : "—"}
                sub={trend ? "From QQQ's moving averages and RSI (14): price trend, not sentiment." : "QQQ's price history couldn't be loaded just now"} />
              </div>
            <a className="qqqCrossLink" href="/markets/spx" style={crossLink}>Compare with the S&amp;P 500 →</a>
            </div>
            {/* MARKET MOOD: the site-wide reading, labelled as such (not Nasdaq-100 only). */}
            <div className="qqqMoodCell" style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
              <MarketMoodCard view={mood} credit={credit} />
              <p className="qqqMoodScope" data-fine-print style={{ ...small, margin: "0 4px" }}>Market-wide reading across the stocks we cover, the same one shown on the S&amp;P 500 page; not limited to Nasdaq-100 members.</p>
            </div>
            </div>
          </section>

          {/* 2. PERFORMANCE (live). */}
          {strip.chips.length ? (
            <section style={card()}>
              <div style={eyebrow}>Performance</div>
              <p data-fine-print style={{ ...small, marginTop: 4 }}>{liveLabel}</p>
              <PerformanceStrip strip={strip} credit={credit} />
              <WriteUp weekly={weekly} k="performance" stale={stale} />
            </section>
          ) : null}

          {/* 3. PRICE CHART with MA50 / MA200 (live). */}
          {points.length ? (
            <section style={card()}>
              <div style={eyebrow}>Price chart</div>
              <h2 style={h2}>QQQ with MA50 and MA200</h2>
              <p data-fine-print style={{ ...small, marginTop: 4 }}>{liveLabel}</p>
              <div style={{ marginTop: 12 }}>
                <StockPriceChart symbol="QQQ" data={points.slice(-240)} ma50={ma50s.slice(-240)} ma200={ma200s.slice(-240)} height={320} credit={credit} />
              </div>
              <WriteUp weekly={weekly} k="chart" stale={stale} />
            </section>
          ) : (
            <section style={card()}><p style={{ margin: 0, fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)", color: C.muted }}>We couldn&apos;t load QQQ&apos;s price history just now. This is a problem on our side, not a market with no data; it should return on a refresh.</p></section>
          )}

          {/* 4. PRICE ZONES + KEY LEVELS (live): the stock page's cards, laid out as on the SPX page. */}
          {bars.length ? (
            <section style={{ display: "grid", gap: 4, minWidth: 0 }}>
            <div className="qqqLevels">
              <div className="qqqZonesCell">
                <ConfluenceCard {...zoneInput} fill credit={credit} />
                <p data-fine-print style={{ ...small, margin: "0 4px" }}>{liveLabel}</p>
              </div>
              <div className="qqqKeysCell">
                <KeyLevelsCard bars={bars} lastPrice={lastClose} nowMs={nowMs} fill credit={credit} />
                <p data-fine-print style={{ ...small, margin: "0 4px" }}>{liveLabel}</p>
              </div>
              {/* LEVELS TO WATCH: the same zones as Price zones (same inputs), so it sits under them. */}
              <div className="qqqGlanceCell">
                <LevelsGlanceCard {...zoneInput} shownOn="Shown on QQQ" credit={credit} />
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
              <p data-fine-print style={{ ...small, marginTop: 4 }}>{liveLabel}</p>
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

          {/* 6. CLOSE-OVER-CLOSE (live): B's card on QQQ's closes. */}
          {points.length ? (
            <section className="qqqChange" style={{ minWidth: 0, padding: "4px 2px" }}>
              <div style={eyebrow}>Price action</div>
              <h2 style={h2}>Daily, weekly or monthly close-over-close change</h2>
              <p data-fine-print style={{ ...small, marginTop: 4 }}>{liveLabel}</p>
              <div style={{ marginTop: 12 }}>
                <ReturnsToggleCard symbol="QQQ" daily={dailyReturnBars(points, 20)} weekly={weeklyReturnBars(points, 12)} monthly={monthlyReturnBars(points, 12)} />
              </div>
              <TiingoCredit />
              <WriteUp weekly={weekly} k="change" stale={stale} />
            </section>
          ) : null}

          {/* 7. THIS WEEK IN 3 POINTS (weekly) BESIDE THE MARKET READ. */}
          {weekly ? (
            <section className="qqqRead" style={{ display: "grid", gridTemplateColumns: "minmax(0, 0.9fr) minmax(0, 1.5fr)", gap: 16, alignItems: "start" }}>
            <div style={card()}>
              <div style={eyebrow}>This week in 3 points</div>
              <div className="qqqPoints" style={{ marginTop: 12, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12 }}>
                {weekly.points.map((pt) => (
                  <div key={pt.label} className="qqqPoint" style={card({ padding: 14 })}>
                    <div style={{ fontSize: "var(--fs-label)", fontWeight: 850, color: C.value }}>{pt.label}</div>
                    <p style={{ margin: "6px 0 0", fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)", opacity: 0.88 }}>{pt.text}</p>
                    {/^breadth$/i.test(pt.label) ? (
                      <div className="qqqBreadth" style={{ marginTop: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--fs-label)", color: C.muted }}>
                          <span>Nasdaq-100 members above their 200-day average</span>
                          <strong style={{ color: C.value }}>{weekly.breadth.pct200 !== null ? `${weekly.breadth.pct200}%` : "—"}</strong>
                        </div>
                        <div aria-hidden="true" style={{ marginTop: 5, height: 8, borderRadius: 4, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                          {weekly.breadth.pct200 !== null ? <div style={{ width: `${weekly.breadth.pct200}%`, height: "100%", background: "#38bdf8" }} /> : null}
                        </div>
                        <div data-fine-print style={{ marginTop: 4, fontSize: "var(--fs-fine)", color: stale ? C.amber : C.muted }}>
                          {weekly.breadth.pct200 !== null ? `${weekly.breadth.source}, ${weeklyDate(weekly.breadth.date)}` : `Not in this week's update (${weeklyDate(weekly.breadth.date)})`}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
            <article className="qqqMarketRead" style={card()}>
              <div style={eyebrow}>Market read</div>
              <h2 style={h2}>What moved the Nasdaq-100 this week</h2>
              <p data-fine-print style={{ ...small, marginTop: 4, color: stale ? C.amber : C.muted, fontWeight: stale ? 700 : 400 }}>Week to {weeklyDate(weekly.asOf)}</p>
              {weekly.marketRead.map((para, i) => <p key={i} style={{ margin: "12px 0 0", fontSize: "var(--fs-read)", lineHeight: 1.7, opacity: 0.9 }}>{para}</p>)}
            </article>
            </section>
          ) : null}

          {/* 8. WHAT TO WATCH (weekly). */}
          {weekly ? (
            <section style={card()}>
              <div style={eyebrow}>What to watch</div>
              <div className="qqqWatch" style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                {([["What would weaken the picture", weekly.watchDown, "#f87171"], ["What would strengthen it", weekly.watchUp, "#4ade80"]] as const).map(([title, items, colour]) => (
                  <div key={title} style={card({ padding: 14 })}>
                    <div style={{ fontSize: "var(--fs-label)", fontWeight: 850, color: colour }}>{title}</div>
                    <ul style={{ margin: "8px 0 0", paddingLeft: 18, display: "grid", gap: 6 }}>
                      {items.map((x) => <li key={x} style={{ fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)", opacity: 0.88 }}>{x}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
              <p style={note}>Index levels mentioned here are the Nasdaq-100&apos;s; the Price zones above are drawn on QQQ.</p>
            </section>
          ) : null}

          {/* 9. WEEKLY CHART SNAPSHOT (live). */}
          {points.length ? (
            <section style={card()}>
              <div style={eyebrow}>Weekly chart</div>
              <h2 style={h2}>Weekly QQQ chart snapshot</h2>
              <p style={{ ...note, marginTop: 4 }}>Each bar is one week, with the 50- and 200-week averages: the larger trend behind the daily moves.</p>
              <div style={{ marginTop: 12 }}>
                <SPXChartClient chartPoints={points} symbol="QQQ" />
              </div>
              {/* THE CHART IS THE ETF, and says so: the weekly copy quotes index levels, far above QQQ's. */}
              <p style={{ margin: "12px 0 0", fontSize: "var(--fs-read)", opacity: 0.7, lineHeight: "var(--lh-read)" }}>
                Chart shows the Invesco QQQ Trust (QQQ). Levels quoted in the text refer to the Nasdaq-100 index.
              </p>
              <TiingoCredit />
              <div className="qqqWeeklyWhy" style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.rule}` }}>
                <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 800 }}>Why the weekly chart matters</h3>
                {WEEKLY_CHART_EXPLAINER.map((para, i) => <p key={i} style={{ margin: "8px 0 0", fontSize: "var(--fs-read)", lineHeight: 1.7, opacity: 0.88 }}>{para}</p>)}
              </div>
            </section>
          ) : null}

          {/* 10. CHARTING TOOLS. */}
          <section style={card({ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" })}>
            <div style={{ fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)", color: C.muted, maxWidth: 520 }}>To study the Nasdaq-100 chart in more detail, some readers use these platforms.</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <AffiliateLink href="/api/go/tradingview" eventLabel="QQQ Page CTA TradingView" style={primaryBtn()}>TradingView →</AffiliateLink>
              <AffiliateLink href="/api/go/etoro" eventLabel="QQQ Page CTA eToro" style={secondaryBtn()}>eToro →</AffiliateLink>
            </div>
          </section>

          {/* 11. FAQ: native <details>, closed; the FAQPage JSON-LD above carries the same words. */}
          <section className="qqqFaq" style={card()}>
            <div style={eyebrow}>FAQ</div>
            <h2 style={h2}>Common questions about the Nasdaq-100 page</h2>
            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              {FAQ.map((f) => (
                <details key={f.q} className="qqqFaqItem" style={{ borderTop: `1px solid ${C.rule}`, paddingTop: 8 }}>
                  <summary style={{ cursor: "pointer", fontSize: "var(--fs-read)", fontWeight: 750 }}>{f.q}</summary>
                  <p style={{ margin: "6px 0 0", fontSize: "var(--fs-read)", lineHeight: "var(--lh-read)", opacity: 0.85 }}>{f.a}</p>
                </details>
              ))}
            </div>
            <a className="qqqCrossLink" href="/markets/spx" style={crossLink}>Compare with the S&amp;P 500 →</a>
          </section>
        </div>
      </div>
      <style>{`
        /* THE LEVELS ROW, as on the SPX page: Price zones takes the left column's spare height, Key levels the right's. */
        .qqqLevels { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: 1fr auto; grid-template-areas: "zones keys" "glance keys"; gap: 16px; align-items: stretch; }
        .qqqZonesCell, .qqqKeysCell { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
        .qqqZonesCell { grid-area: zones; }
        .qqqKeysCell { grid-area: keys; }
        .qqqGlanceCell { grid-area: glance; min-width: 0; }
        @media (min-width: 901px) {
          .qqqZonesCell .czCard { flex: 1 1 auto; display: flex; flex-direction: column; }
          .qqqKeysCell .klCard { flex: 1 1 auto; display: flex; flex-direction: column; }
          .qqqMoodCell .moodCard { flex: 1 1 auto; display: flex; flex-direction: column; }
        }
        /* THE TREND TILE'S ROW (#553 COWORK #221): score, meter and words on one line, wrapping only if the tile is narrow. */
        .qqqTrendRow { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
        .qqqTrendWords { font-size: var(--fs-read); font-weight: 800; letter-spacing: 0; }
        ${TREND_METER_CSS}
        @media (max-width: 900px) {
          .qqqTiles { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
          /* Two tiles a row here: the trend tile takes a row of its own, not half of one beside a hole. */
          .qqqTrendTile { grid-column: 1 / -1; }
          .qqqHeroGrid { grid-template-columns: minmax(0, 1fr) !important; }
          .qqqLevels { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; grid-template-areas: "zones" "keys" "glance"; }
          .qqqPoints, .qqqWatch, .qqqRead { grid-template-columns: minmax(0, 1fr) !important; }
        }
        /* THE NASDAQ-100'S FIVE-DIGIT CLOSE (30,883.15) doesn't fit a half-width tile on a small phone (measured to 430 px at a 20 px root, #553 COWORK #221), as SPX's four digits do: one tile a row there. */
        @media (max-width: 480px) {
          .qqqTiles { grid-template-columns: minmax(0, 1fr) !important; }
        }
        @media (max-width: 640px) {
          .qqqWrap { padding: 16px !important; }
          .qqqHero h1 { font-size: 1.75rem !important; }
        }
      `}</style>
    </main>
  );
}
