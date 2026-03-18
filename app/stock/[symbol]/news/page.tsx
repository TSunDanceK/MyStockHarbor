import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";

export const runtime = "nodejs";

type Props = {
  params: Promise<{ symbol: string }>;
};

type Quote = {
  symbol: string;
  price: number | null;
  date: string | null;
  time: string | null;
  source: string;
};

type Point = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

type NewsItem = {
  title: string;
  link: string;
  pubDate: string | null;
  source: string | null;
};

function parseRss(xml: string): NewsItem[] {
  const items: NewsItem[] = [];
  const blocks = xml.split("<item>").slice(1);

  for (const block of blocks) {
    const title =
      block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] ??
      block.match(/<title>(.*?)<\/title>/)?.[1] ??
      "";

    const link = block.match(/<link>(.*?)<\/link>/)?.[1] ?? "";
    const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? null;
    const source = block.match(/<source[^>]*>(.*?)<\/source>/)?.[1] ?? null;

    if (title && link) {
      items.push({
        title: decodeHtml(title.replace(/\s+-\s+Google News$/, "").trim()),
        link: link.trim(),
        pubDate,
        source: source ? decodeHtml(source.trim()) : null,
      });
    }
  }

  return items;
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function fetchQuote(symbol: string): Promise<Quote | null> {
  const stooqSymbol = `${symbol.toLowerCase()}.us`;
  const url = `https://stooq.com/q/l/?s=${stooqSymbol}&f=sd2t2l&h&e=csv`;

  try {
    const res = await fetch(url, {
      next: { revalidate: 1800 },
    });
    const text = await res.text();
    const lines = text.trim().split("\n");
    if (lines.length < 2) return null;

    const row = lines[1].split(",");
    const price = Number(row[3] ?? "");

    return {
      symbol,
      price: Number.isFinite(price) ? price : null,
      date: row[1] ?? null,
      time: row[2] ?? null,
      source: "stooq.com",
    };
  } catch {
    return null;
  }
}

async function fetchHistory(symbol: string): Promise<Point[]> {
  const stooqSymbol = `${symbol.toLowerCase()}.us`;
  const url = `https://stooq.com/q/d/l/?s=${stooqSymbol}&i=d`;

  try {
    const res = await fetch(url, {
      next: { revalidate: 1800 },
    });
    const text = await res.text();
    const lines = text.trim().split("\n");
    if (lines.length < 3) return [];

    const points: Point[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const date = String(cols[0] ?? "").replace(/\r/g, "").trim();
      const high = Number(String(cols[2] ?? "").replace(/\r/g, ""));
      const low = Number(String(cols[3] ?? "").replace(/\r/g, ""));
      const close = Number(String(cols[4] ?? "").replace(/\r/g, ""));
      const volume = Number(String(cols[5] ?? "").replace(/\r/g, ""));

      if (!date || !Number.isFinite(close)) continue;

      points.push({
        date,
        close,
        high: Number.isFinite(high) ? high : undefined,
        low: Number.isFinite(low) ? low : undefined,
        volume: Number.isFinite(volume) ? volume : undefined,
      });
    }

    return points.slice(-320);
  } catch {
    return [];
  }
}

async function fetchCompanyName(symbol: string): Promise<string> {
  try {
    const [nasdaqTxt, otherTxt] = await Promise.all([
      fetch("https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt", {
        next: { revalidate: 86400 },
      }).then((r) => r.text()),
      fetch("https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt", {
        next: { revalidate: 86400 },
      }).then((r) => r.text()),
    ]);

    const matches = `${nasdaqTxt}\n${otherTxt}`.split("\n");

    for (const line of matches) {
      const cols = line.split("|");
      if ((cols[0] ?? "").trim().toUpperCase() === symbol.toUpperCase()) {
        return (cols[1] ?? "").trim();
      }
    }

    return "";
  } catch {
    return "";
  }
}

async function fetchNews(symbol: string, companyName: string): Promise<NewsItem[]> {
  const query = encodeURIComponent(
    companyName ? `${companyName} ${symbol} stock` : `${symbol} stock`
  );
  const url = `https://news.google.com/rss/search?q=${query}&hl=en-GB&gl=GB&ceid=GB:en`;

  try {
    const res = await fetch(url, {
      next: { revalidate: 1800 },
    });
    const xml = await res.text();
    return parseRss(xml).slice(0, 6);
  } catch {
    return [];
  }
}

function movingAverage(values: number[], window: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  let sum = 0;

  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    if (i >= window - 1) out[i] = sum / window;
  }

  return out;
}

function rsiWilder(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (values.length < period + 1) return out;

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss += -diff;
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;
  const rs0 = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  out[period] = 100 - 100 / (1 + rs0);

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;

    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    out[i] = 100 - 100 / (1 + rs);
  }

  return out;
}

function lastNum(arr: (number | null)[]) {
  return arr.length ? arr[arr.length - 1] : null;
}

function pctFromBase(last: number | null, base: number | null) {
  if (
    typeof last !== "number" ||
    typeof base !== "number" ||
    !Number.isFinite(last) ||
    !Number.isFinite(base) ||
    base === 0
  ) {
    return null;
  }

  return ((last - base) / base) * 100;
}

function trendLabel(lastClose: number | null, ma50: number | null, ma200: number | null) {
  if (
    typeof lastClose === "number" &&
    typeof ma50 === "number" &&
    typeof ma200 === "number"
  ) {
    if (lastClose > ma50 && ma50 > ma200) return "Uptrend";
    if (lastClose < ma50 && ma50 < ma200) return "Downtrend";
  }

  return "Range / Mixed";
}

function formatMoney(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(2)}` : "—";
}

function formatPercent(value: number | null, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function formatDate(value: string | null) {
  if (!value) return "Recent";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function compactSource(source: string | null) {
  if (!source) return "Publisher";
  return source.replace(/\s+News$/i, "").trim();
}

function buildThemeSummary(titles: string[]) {
  const themeDefs = [
    {
      label: "earnings and outlook",
      words: ["earnings", "revenue", "guidance", "forecast", "profit", "sales", "results"],
    },
    {
      label: "AI and product momentum",
      words: ["ai", "chip", "gpu", "model", "software", "product", "launch", "demand"],
    },
    {
      label: "delivery, production and operations",
      words: ["delivery", "deliveries", "production", "factory", "supply", "manufacturing"],
    },
    {
      label: "analyst views and valuation",
      words: ["analyst", "rating", "price target", "valuation", "upgrade", "downgrade"],
    },
    {
      label: "macro and sector positioning",
      words: ["market", "fed", "rates", "sector", "tariff", "economy", "index"],
    },
  ];

  const scores = themeDefs
    .map((theme) => ({
      label: theme.label,
      score: titles.reduce((acc, title) => {
        const lower = title.toLowerCase();
        return theme.words.some((word) => lower.includes(word)) ? acc + 1 : acc;
      }, 0),
    }))
    .filter((theme) => theme.score > 0)
    .sort((a, b) => b.score - a.score);

  return scores.slice(0, 2).map((theme) => theme.label);
}

function buildNewsBullets(args: {
  symbol: string;
  companyName: string;
  news: NewsItem[];
  trend: string;
  rsi: number | null;
  priceVs50: number | null;
}) {
  const { symbol, companyName, news, trend, rsi, priceVs50 } = args;
  const lead = companyName || symbol;

  if (!news.length) {
    return [
      `${lead} does not have a fresh headline set available on this page right now, so the summary leans more on chart structure than on publisher coverage.`,
      `${symbol} is still worth reviewing through the technical lens because price location, moving averages, and momentum often shape trader behaviour even when headline flow is quiet.`,
      `Use the full stock dashboard for deeper chart work, then revisit this page as fresh developments start appearing again.`,
    ];
  }

  const themes = buildThemeSummary(news.map((item) => item.title));
  const first = news[0];
  const second = news[1];
  const third = news[2];

  const bullets: string[] = [];

  bullets.push(
    themes.length
      ? `Recent ${symbol} coverage is leaning toward ${themes.join(" and ")}, which gives this page a clearer storyline than a simple list of links.`
      : `Recent ${symbol} coverage is spread across several angles, so the bigger value here is turning scattered headlines into one readable summary.`
  );

  bullets.push(
    `One recent development in the flow is ${compactSource(first.source)} highlighting “${first.title}”, with ${second ? `${compactSource(second.source)} also focusing on “${second.title}”.` : `the latest headline appearing on ${formatDate(first.pubDate)}.`}`
  );

  if (trend === "Uptrend") {
    bullets.push(
      `${symbol} is still trading with an underlying bullish structure, so traders may be asking whether the headline flow is supporting an existing trend rather than creating it from scratch.`
    );
  } else if (trend === "Downtrend") {
    bullets.push(
      `${symbol} is coming into this news flow with a weaker chart backdrop, which means even positive headlines may need stronger follow-through before traders treat them as a proper character change.`
    );
  } else if (typeof rsi === "number" && rsi <= 35) {
    bullets.push(
      `${symbol} is entering the recent news cycle from a softer momentum backdrop, so traders may care more about stabilisation and reclaim attempts than about isolated optimism.`
    );
  } else if (typeof priceVs50 === "number" && priceVs50 >= 8) {
    bullets.push(
      `${symbol} is already stretched above its 50-day average, so traders may treat fresh headlines as confirmation of strength while still watching for overheated entry conditions.`
    );
  } else {
    bullets.push(
      `${third ? `A third notable headline, “${third.title}”, adds another angle for traders to monitor next.` : `${symbol} now has enough headline flow to give traders a useful watchlist of follow-up catalysts.`}`
    );
  }

  return bullets;
}

function buildTechnicalSummary(args: {
  symbol: string;
  trend: string;
  price: number | null;
  ma50: number | null;
  ma200: number | null;
  priceVs50: number | null;
  priceVs200: number | null;
  rsi: number | null;
}) {
  const { symbol, trend, price, ma50, ma200, priceVs50, priceVs200, rsi } = args;

  let trendText = `${symbol} currently looks mixed rather than strongly directional.`;
  if (trend === "Uptrend") {
    trendText = `${symbol} is still holding an uptrend-style structure, with price above the shorter and longer trend references.`;
  } else if (trend === "Downtrend") {
    trendText = `${symbol} is still sitting in a weaker chart structure, with trend pressure leaning down rather than up.`;
  }

  let stretchText = `The chart does not look especially stretched in either direction right now.`;
  if (typeof rsi === "number" && rsi >= 70) {
    stretchText = `Momentum is strong and a little stretched, with RSI near overbought territory.`;
  } else if (typeof rsi === "number" && rsi <= 30) {
    stretchText = `Momentum is soft and leaning oversold, which can attract rebound-watch interest but does not guarantee a turn.`;
  } else if (typeof priceVs50 === "number" && Math.abs(priceVs50) >= 10) {
    stretchText = `Price is well away from the 50-day moving average, which suggests a more extended short-term position than a calm reset.`;
  }

  const maTextParts = [];
  if (typeof price === "number") maTextParts.push(`last price ${formatMoney(price)}`);
  if (typeof ma50 === "number") maTextParts.push(`50-day average ${formatMoney(ma50)}`);
  if (typeof ma200 === "number") maTextParts.push(`200-day average ${formatMoney(ma200)}`);

  let referenceText = maTextParts.length
    ? `${maTextParts.join(", ")}.`
    : `Moving-average reference data is limited right now.`;

  if (typeof priceVs50 === "number" || typeof priceVs200 === "number") {
    referenceText += ` Relative to trend references, ${symbol} is ${formatPercent(priceVs50)} vs MA50 and ${formatPercent(priceVs200)} vs MA200.`;
  }

  return { trendText, stretchText, referenceText };
}

function buildWatchList(args: {
  symbol: string;
  trend: string;
  price: number | null;
  ma50: number | null;
  ma200: number | null;
  recentHigh: number | null;
  recentLow: number | null;
  rsi: number | null;
}) {
  const { symbol, trend, ma50, ma200, recentHigh, recentLow, rsi } = args;

  const items: string[] = [];

  if (typeof recentHigh === "number") {
    items.push(
      `${symbol} traders may watch whether price can challenge the recent swing high near ${formatMoney(recentHigh)} instead of fading below it again.`
    );
  }

  if (typeof ma50 === "number") {
    items.push(
      `The 50-day moving average near ${formatMoney(ma50)} is a useful short-term reaction area for pullbacks, reclaims, and trend continuation checks.`
    );
  }

  if (typeof ma200 === "number") {
    items.push(
      `The 200-day moving average near ${formatMoney(ma200)} remains the bigger structure line that often separates longer-term strength from a weaker backdrop.`
    );
  }

  if (typeof recentLow === "number") {
    items.push(
      `A break below the recent swing low near ${formatMoney(recentLow)} would make the chart look more fragile and could weaken the current setup.`
    );
  }

  if (typeof rsi === "number" && rsi >= 70) {
    items.unshift(
      `Because momentum is already fairly hot, traders may focus on orderly consolidation and follow-through quality rather than chasing the first strong green candle.`
    );
  } else if (typeof rsi === "number" && rsi <= 35) {
    items.unshift(
      `Because momentum is still soft, traders may want to see evidence of stabilisation before treating any bounce as a cleaner recovery setup.`
    );
  } else if (trend === "Uptrend") {
    items.unshift(
      `The next question is whether ${symbol} can keep building above support without giving back too much momentum after the latest headlines.`
    );
  } else if (trend === "Downtrend") {
    items.unshift(
      `The next question is whether ${symbol} can reclaim damaged structure or whether rallies keep acting more like short-lived relief than real trend repair.`
    );
  }

  return items.slice(0, 4);
}

function buildRecentUpdateSummary(item: NewsItem, symbol: string) {
  const lower = item.title.toLowerCase();
  let angle = `Recent coverage is drawing attention to ${symbol}.`;

  if (lower.includes("earnings") || lower.includes("revenue") || lower.includes("results")) {
    angle = `This headline looks relevant because traders often use earnings-related coverage to reassess expectations, valuation, and post-report momentum.`;
  } else if (
    lower.includes("analyst") ||
    lower.includes("upgrade") ||
    lower.includes("downgrade") ||
    lower.includes("price target")
  ) {
    angle = `This update matters mainly as a sentiment input, since analyst moves can influence near-term attention even when they do not change the chart by themselves.`;
  } else if (
    lower.includes("ai") ||
    lower.includes("chip") ||
    lower.includes("product") ||
    lower.includes("launch")
  ) {
    angle = `This headline is more about product or theme momentum, which can shape how traders frame the next leg of the story.`;
  } else if (
    lower.includes("delivery") ||
    lower.includes("production") ||
    lower.includes("factory") ||
    lower.includes("supply")
  ) {
    angle = `This update looks tied to operational execution, which often matters because it affects confidence in the business story behind the chart.`;
  } else if (lower.includes("market") || lower.includes("sector") || lower.includes("fed")) {
    angle = `This headline appears to connect ${symbol} with a wider market or sector backdrop rather than with a company-only development.`;
  }

  return angle;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const upper = symbol.toUpperCase();

  return {
    title: `${upper} Stock News, Analysis & Latest Updates | MyStockHarbor`,
    description: `Read ${upper} stock news, chart context, moving-average trend analysis, and a readable summary of the latest developments on MyStockHarbor.`,
    alternates: {
      canonical: `/stock/${upper}/news`,
    },
    openGraph: {
      title: `${upper} Stock News & Analysis | MyStockHarbor`,
      description: `Latest ${upper} stock developments with MyStockHarbor chart context and technical analysis.`,
      url: `/stock/${upper}/news`,
      siteName: "MyStockHarbor",
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title: `${upper} Stock News & Analysis | MyStockHarbor`,
      description: `A readable summary of ${upper} stock news with technical context and chart levels.`,
    },
  };
}

export default async function StockNewsPage({ params }: Props) {
  const { symbol } = await params;
  const upper = symbol.toUpperCase();

  const [quote, history, companyName] = await Promise.all([
    fetchQuote(upper),
    fetchHistory(upper),
    fetchCompanyName(upper),
  ]);

  const news = await fetchNews(upper, companyName);

  const closes = history.map((point) => point.close);
  const ma50 = movingAverage(closes, 50);
  const ma200 = movingAverage(closes, 200);
  const rsi = rsiWilder(closes, 14);

  const lastClose = history.length ? history[history.length - 1].close : null;
  const lastMA50 = lastNum(ma50);
  const lastMA200 = lastNum(ma200);
  const lastRsi = lastNum(rsi);
  const trend = trendLabel(lastClose, lastMA50, lastMA200);
  const priceVs50 = pctFromBase(lastClose, lastMA50);
  const priceVs200 = pctFromBase(lastClose, lastMA200);

  const trailing = history.slice(-20);
  const recentHigh = trailing.length
    ? Math.max(...trailing.map((point) => point.high ?? point.close))
    : null;
  const recentLow = trailing.length
    ? Math.min(...trailing.map((point) => point.low ?? point.close))
    : null;

  const introLead = companyName ? `${companyName} (${upper})` : upper;
  const newsBullets = buildNewsBullets({
    symbol: upper,
    companyName,
    news,
    trend,
    rsi: lastRsi,
    priceVs50,
  });
  const technicalSummary = buildTechnicalSummary({
    symbol: upper,
    trend,
    price: quote?.price ?? lastClose,
    ma50: lastMA50,
    ma200: lastMA200,
    priceVs50,
    priceVs200,
    rsi: lastRsi,
  });
  const watchList = buildWatchList({
    symbol: upper,
    trend,
    price: quote?.price ?? lastClose,
    ma50: lastMA50,
    ma200: lastMA200,
    recentHigh,
    recentLow,
    rsi: lastRsi,
  });

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#06080d",
        color: "#f1f5f9",
        fontFamily: "system-ui, Arial",
      }}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebPage",
            name: `${upper} Stock News, Analysis & Latest Updates`,
            url: `https://mystockharbor.com/stock/${encodeURIComponent(upper)}/news`,
            description: `Server-rendered ${upper} stock news summary with technical context and internal links.`,
            breadcrumb: {
              "@type": "BreadcrumbList",
              itemListElement: [
                {
                  "@type": "ListItem",
                  position: 1,
                  name: "Home",
                  item: "https://mystockharbor.com/",
                },
                {
                  "@type": "ListItem",
                  position: 2,
                  name: `${upper} Stock Analysis`,
                  item: `https://mystockharbor.com/stock/${encodeURIComponent(upper)}`,
                },
                {
                  "@type": "ListItem",
                  position: 3,
                  name: `${upper} Stock News`,
                  item: `https://mystockharbor.com/stock/${encodeURIComponent(upper)}/news`,
                },
              ],
            },
          }),
        }}
      />

      <div className="wrap">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 18,
          }}
        >
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/" style={topLinkStyle("blue")}>
              ← Dashboard
            </Link>
            <Link href={`/stock/${encodeURIComponent(upper)}`} style={topLinkStyle("green")}>
              Full Stock Page
            </Link>
            <Link href="/pickers" style={topLinkStyle("red")}>
              Pickers
            </Link>
            <Link href="/learn" style={topLinkStyle("blue")}>
              Learn
            </Link>
          </div>
        </div>

        <section style={heroCardStyle}>
          <div style={eyebrowStyle}>STOCK NEWS PAGE</div>

          <h1
            style={{
              margin: "14px 0 0 0",
              fontSize: 42,
              lineHeight: 1.04,
              letterSpacing: "-0.05em",
            }}
          >
            {upper} Stock News, Analysis & Latest Updates
          </h1>

          <p
            style={{
              margin: "12px 0 0 0",
              maxWidth: 860,
              fontSize: 16,
              lineHeight: 1.7,
              color: "rgba(241,245,249,0.82)",
            }}
          >
            {introLead} is shown here through a simple MyStockHarbor lens: readable stock-news
            summaries, technical context, and a cleaner view of what traders may be watching next.
            This page summarises recent developments and chart structure without pretending to be a
            live newsroom feed.
          </p>

          <div className="heroGrid" style={{ marginTop: 18 }}>
            <div style={statCardStyle}>
              <div style={miniLabelStyle}>Last price</div>
              <div style={statValueStyle}>{formatMoney(quote?.price ?? lastClose)}</div>
              <div style={statMetaStyle}>Latest available price from {quote?.source ?? "stooq.com"}.</div>
            </div>

            <div style={statCardStyle}>
              <div style={miniLabelStyle}>Trend</div>
              <div style={statValueStyle}>{trend}</div>
              <div style={statMetaStyle}>Based on price, 50-day, and 200-day moving-average structure.</div>
            </div>

            <div style={statCardStyle}>
              <div style={miniLabelStyle}>RSI (14)</div>
              <div style={statValueStyle}>{typeof lastRsi === "number" ? lastRsi.toFixed(1) : "—"}</div>
              <div style={statMetaStyle}>Momentum helps show whether the setup looks calm, hot, or washed out.</div>
            </div>

            <div style={statCardStyle}>
              <div style={miniLabelStyle}>Headline flow</div>
              <div style={statValueStyle}>{news.length}</div>
              <div style={statMetaStyle}>Recent items currently summarised on this page.</div>
            </div>
          </div>
        </section>

        <section style={{ marginTop: 18, display: "grid", gap: 18 }}>
          <div style={sectionCardStyle}>
            <h2 style={sectionHeadingStyle}>What’s happening with {upper}</h2>
            <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
              {newsBullets.map((item) => (
                <div key={item} style={bulletRowStyle}>
                  <div style={bulletDotStyle} />
                  <div style={bulletTextStyle}>{item}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="twoCol" style={{ display: "grid", gap: 18 }}>
            <div style={sectionCardStyle}>
              <h2 style={sectionHeadingStyle}>Current technical picture</h2>
              <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
                <div>
                  <div style={miniLabelStyle}>Trend</div>
                  <p style={bodyCopyStyle}>{technicalSummary.trendText}</p>
                </div>
                <div>
                  <div style={miniLabelStyle}>Stretch / momentum</div>
                  <p style={bodyCopyStyle}>{technicalSummary.stretchText}</p>
                </div>
                <div>
                  <div style={miniLabelStyle}>Reference levels</div>
                  <p style={bodyCopyStyle}>{technicalSummary.referenceText}</p>
                </div>
              </div>
            </div>

            <div style={sectionCardStyle}>
              <h2 style={sectionHeadingStyle}>What traders may be watching next</h2>
              <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
                {watchList.map((item) => (
                  <div key={item} style={bulletRowStyle}>
                    <div style={bulletDotStyle} />
                    <div style={bulletTextStyle}>{item}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={sectionCardStyle}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <h2 style={{ ...sectionHeadingStyle, margin: 0 }}>Recent updates</h2>
              <Link
                href={`/stock/${encodeURIComponent(upper)}`}
                style={{ ...topLinkStyle("blue"), fontWeight: 900 }}
              >
                Open full {upper} chart →
              </Link>
            </div>

            <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
              {news.length ? (
                news.map((item) => (
                  <article key={`${item.link}-${item.title}`} style={newsCardStyle}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <span style={newsMetaPillStyle}>{compactSource(item.source)}</span>
                      <span style={newsDateStyle}>{formatDate(item.pubDate)}</span>
                    </div>

                    <h3 style={newsTitleStyle}>{item.title}</h3>

                    <p style={bodyCopyStyle}>{buildRecentUpdateSummary(item, upper)}</p>

                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={externalLinkStyle}
                    >
                      Read original coverage ↗
                    </a>
                  </article>
                ))
              ) : (
                <div style={newsCardStyle}>
                  <h3 style={{ ...newsTitleStyle, marginTop: 0 }}>No fresh external items available right now</h3>
                  <p style={bodyCopyStyle}>
                    This page can still act as an indexable analysis hub because the technical picture,
                    levels, and internal navigation remain useful even when recent publisher coverage is light.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div style={sectionCardStyle}>
            <h2 style={sectionHeadingStyle}>Explore more on MyStockHarbor</h2>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
              <Link href={`/stock/${encodeURIComponent(upper)}`} style={topLinkStyle("blue")}>
                Open {upper} stock page
              </Link>
              <Link href="/pickers" style={topLinkStyle("red")}>
                Explore stock pickers
              </Link>
              <Link href="/learn" style={topLinkStyle("green")}>
                Read learn guides
              </Link>
              <Link href="/breakout-stocks" style={topLinkStyle("blue")}>
                Breakout stocks
              </Link>
              <Link href="/buy-the-dip-stocks" style={topLinkStyle("green")}>
                Buy the dip stocks
              </Link>
            </div>
          </div>
        </section>
      </div>

      <style>{`
        .wrap {
          max-width: 1180px;
          margin: 0 auto;
          padding: 24px 40px 40px;
        }

        .heroGrid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .twoCol {
          grid-template-columns: minmax(0, 1.18fr) minmax(0, 0.82fr);
        }

        @media (max-width: 980px) {
          .wrap {
            padding: 20px 18px 36px;
          }

          .heroGrid,
          .twoCol {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}

const heroCardStyle: CSSProperties = {
  border: "1px solid rgba(59,130,246,0.24)",
  borderRadius: 22,
  padding: 20,
  background: "linear-gradient(135deg, rgba(10,16,32,0.98), rgba(7,11,22,0.98))",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 14px 34px rgba(0,0,0,0.30)",
};

const sectionCardStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 20,
  padding: 18,
  background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.025))",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
};

const statCardStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 18,
  padding: 16,
  background: "rgba(255,255,255,0.04)",
};

const eyebrowStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 12px",
  borderRadius: 999,
  border: "1px solid rgba(59,130,246,0.32)",
  background: "linear-gradient(135deg, rgba(59,130,246,0.16), rgba(37,99,235,0.08))",
  fontSize: 12,
  fontWeight: 950,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#dbeafe",
};

const miniLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 900,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "rgba(191,219,254,0.88)",
};

const statValueStyle: CSSProperties = {
  marginTop: 8,
  fontSize: 30,
  lineHeight: 1.05,
  fontWeight: 950,
  letterSpacing: "-0.04em",
  color: "#f8fafc",
};

const statMetaStyle: CSSProperties = {
  marginTop: 8,
  fontSize: 13,
  lineHeight: 1.5,
  color: "rgba(241,245,249,0.68)",
};

const sectionHeadingStyle: CSSProperties = {
  margin: 0,
  fontSize: 24,
  lineHeight: 1.15,
  letterSpacing: "-0.03em",
};

const bodyCopyStyle: CSSProperties = {
  margin: "6px 0 0 0",
  fontSize: 15,
  lineHeight: 1.7,
  color: "rgba(241,245,249,0.8)",
};

const bulletRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "10px minmax(0, 1fr)",
  gap: 12,
  alignItems: "start",
};

const bulletDotStyle: CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: 999,
  marginTop: 7,
  background: "linear-gradient(135deg, #60a5fa, #22c55e)",
  boxShadow: "0 0 0 4px rgba(59,130,246,0.10)",
};

const bulletTextStyle: CSSProperties = {
  fontSize: 15,
  lineHeight: 1.7,
  color: "rgba(241,245,249,0.84)",
};

const newsCardStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 16,
  padding: 16,
  background: "rgba(255,255,255,0.03)",
};

const newsMetaPillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "6px 10px",
  borderRadius: 999,
  background: "rgba(59,130,246,0.12)",
  border: "1px solid rgba(59,130,246,0.24)",
  color: "#dbeafe",
  fontSize: 12,
  fontWeight: 800,
};

const newsDateStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "rgba(241,245,249,0.58)",
};

const newsTitleStyle: CSSProperties = {
  margin: "12px 0 0 0",
  fontSize: 19,
  lineHeight: 1.35,
  color: "#f8fafc",
};

const externalLinkStyle: CSSProperties = {
  display: "inline-flex",
  marginTop: 12,
  color: "#93c5fd",
  textDecoration: "none",
  fontSize: 14,
  fontWeight: 800,
};

function topLinkStyle(tone: "blue" | "green" | "red"): CSSProperties {
  const tones = {
    blue: {
      border: "1px solid rgba(59,130,246,0.28)",
      background: "linear-gradient(135deg, rgba(59,130,246,0.16), rgba(37,99,235,0.08))",
      color: "#dbeafe",
    },
    green: {
      border: "1px solid rgba(34,197,94,0.24)",
      background: "linear-gradient(135deg, rgba(34,197,94,0.16), rgba(21,128,61,0.08))",
      color: "#dcfce7",
    },
    red: {
      border: "1px solid rgba(248,113,113,0.24)",
      background: "linear-gradient(135deg, rgba(248,113,113,0.16), rgba(185,28,28,0.08))",
      color: "#fee2e2",
    },
  } as const;

  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    borderRadius: 999,
    textDecoration: "none",
    fontSize: 13,
    fontWeight: 850,
    lineHeight: 1,
    whiteSpace: "nowrap",
    ...tones[tone],
  };
}
