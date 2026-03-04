// app/learn/lessons.ts

export type Lesson = {
  slug: string;
  title: string;
  category: "Basics" | "Indicators";
  summary: string;
  sections: { heading: string; body: string[] }[];
};

export const LESSONS: Lesson[] = [
  // ---------------- BASICS ----------------
  {
    slug: "support-and-resistance",
    title: "Support & Resistance",
    category: "Basics",
    summary: "How to spot key levels and why price reacts around them.",
    sections: [
      {
        heading: "What is support?",
        body: [
          "Support is a price area where buying interest has historically been strong enough to stop or slow a decline.",
          "It’s usually an area (a zone), not a perfect line.",
        ],
      },
      {
        heading: "What is resistance?",
        body: [
          "Resistance is a price area where selling interest has historically been strong enough to stop or slow a rise.",
          "Like support, it’s typically a zone.",
        ],
      },
      {
        heading: "How to draw levels",
        body: [
          "Start with higher timeframes (Daily/Weekly). Mark obvious swing highs/lows.",
          "Then refine with the timeframe you trade (e.g., 1H / 4H).",
          "The more touches + the cleaner the reactions, the more meaningful the zone.",
        ],
      },
      {
        heading: "Common mistakes",
        body: [
          "Drawing too many lines (clutters your thinking).",
          "Ignoring the timeframe context (a 5m level can be irrelevant to a daily trend).",
          "Treating a level as exact to the cent—think zones.",
        ],
      },
    ],
  },
  {
    slug: "timeframes",
    title: "Timeframes",
    category: "Basics",
    summary: "Why timeframe context matters and how to pick yours.",
    sections: [
      {
        heading: "Timeframe controls context",
        body: [
          "Higher timeframes (Daily/Weekly) define the main trend and key levels.",
          "Lower timeframes (1H/15m/5m) are best for entries and fine-tuning risk.",
        ],
      },
      {
        heading: "A simple approach",
        body: [
          "Trend: use Daily (or 4H if you’re more active).",
          "Levels: use Daily/4H.",
          "Entry timing: use 1H/15m.",
        ],
      },
    ],
  },

  // -------------- INDICATORS --------------
  {
    slug: "atr",
    title: "ATR (14)",
    category: "Indicators",
    summary: "A volatility measure — useful for sizing stops and spotting ‘hot’ conditions.",
    sections: [
      {
        heading: "What ATR measures",
        body: [
          "ATR (Average True Range) estimates how much price typically moves per bar.",
          "Higher ATR = more volatility; lower ATR = quieter movement.",
        ],
      },
      {
        heading: "How traders use it",
        body: [
          "Stops: a common idea is to place stops a multiple of ATR away from entry (context matters).",
          "Volatility regime: compare ATR to its recent average to see if conditions are unusually hot or quiet.",
        ],
      },
    ],
  },
  {
    slug: "bollinger-bands",
    title: "Bollinger Bands (20,2)",
    category: "Indicators",
    summary: "Bands that expand/contract with volatility — often used to spot extremes.",
    sections: [
      {
        heading: "What they are",
        body: [
          "Bollinger Bands are built from a middle moving average (often 20) plus/minus a volatility measure (standard deviation).",
          "When volatility rises, bands widen. When volatility falls, bands tighten.",
        ],
      },
      {
        heading: "Common reads",
        body: [
          "Touches of the outer bands can suggest an ‘extended’ move (not an automatic reversal).",
          "‘Squeezes’ (very tight bands) can hint a big move may be coming, but not the direction.",
        ],
      },
    ],
  },
  {
    slug: "ema20",
    title: "EMA (20)",
    category: "Indicators",
    summary: "A faster moving average that reacts quicker to price than a simple MA.",
    sections: [
      {
        heading: "EMA vs SMA",
        body: [
          "EMA weights recent prices more heavily, so it responds faster than an SMA with the same period.",
          "That speed can help in trending markets, but can also whipsaw in choppy markets.",
        ],
      },
      {
        heading: "Common uses",
        body: [
          "Trend guidance: price holding above EMA20 often supports bullish momentum (context matters).",
          "Pullback zones: EMA20 is commonly watched as a ‘dynamic level’ in trends.",
        ],
      },
    ],
  },
  {
    slug: "macd",
    title: "MACD (12,26,9)",
    category: "Indicators",
    summary: "A momentum indicator that shows trend strength and shifts.",
    sections: [
      {
        heading: "What MACD measures",
        body: [
          "MACD compares two EMAs (fast vs slow) to estimate momentum.",
          "The histogram shows the difference between MACD line and signal line.",
        ],
      },
      {
        heading: "How traders read it",
        body: [
          "Histogram rising above zero often suggests bullish momentum building.",
          "Histogram falling below zero often suggests bearish momentum building.",
          "Divergence (price up, MACD down) can hint momentum is weakening.",
        ],
      },
    ],
  },
  {
    slug: "moving-averages",
    title: "Moving Averages (MA50 / MA200)",
    category: "Indicators",
    summary: "What moving averages measure and how traders use them.",
    sections: [
      {
        heading: "What they are",
        body: [
          "A moving average is a smoothed line of price over a set number of periods.",
          "MA50 reacts faster than MA200 because it uses fewer periods.",
        ],
      },
      {
        heading: "Common uses",
        body: [
          "Trend filter: price above MA200 is often treated as long-term bullish bias (not a rule).",
          "Dynamic support/resistance: price often reacts near major averages.",
          "Crossovers: MA50 crossing MA200 is a popular (but lagging) signal.",
        ],
      },
    ],
  },
  {
    slug: "rsi",
    title: "RSI (14)",
    category: "Indicators",
    summary: "Oscillator that helps identify momentum extremes (not a magic buy/sell).",
    sections: [
      {
        heading: "How RSI is used",
        body: [
          "RSI > 70 is often called overbought; RSI < 30 is oversold.",
          "In strong trends, RSI can stay elevated/low for long periods.",
          "Use RSI with trend + levels, not alone.",
        ],
      },
    ],
  },
  {
    slug: "stochastic",
    title: "Stochastic (14,3)",
    category: "Indicators",
    summary: "Oscillator that compares close vs recent range — often used for momentum extremes.",
    sections: [
      {
        heading: "What it measures",
        body: [
          "Stochastic compares the close to the recent high/low range over a lookback window.",
          "It’s often shown as %K (fast) and %D (smoothed).",
        ],
      },
      {
        heading: "Common reads",
        body: [
          "%K above ~80 is often called overbought; below ~20 is oversold.",
          "Like RSI, it can stick in extremes during strong trends — use context.",
        ],
      },
    ],
  },
  {
    slug: "volume",
    title: "Volume",
    category: "Indicators",
    summary: "How much traded can confirm moves and warn on weak breakouts.",
    sections: [
      {
        heading: "Why volume matters",
        body: [
          "Breakouts with higher-than-usual volume are typically more credible.",
          "Low-volume breakouts can fail more often (but not always).",
        ],
      },
      {
        heading: "Simple habit",
        body: [
          "Compare today’s volume to the recent average (like a 20-day average).",
        ],
      },
    ],
  },
  {
    slug: "vwap",
    title: "VWAP",
    category: "Indicators",
    summary: "A volume-weighted average price — often treated like a ‘fair value’ reference intraday.",
    sections: [
      {
        heading: "What VWAP is",
        body: [
          "VWAP is the average price weighted by volume (more volume = more influence).",
          "It’s most common for intraday trading; on daily data it’s more of a rough reference.",
        ],
      },
      {
        heading: "How traders use it",
        body: [
          "Mean reversion: price far above/below VWAP can be seen as extended (context matters).",
          "Bias filter: some traders treat above VWAP as bullish intraday bias, below as bearish.",
        ],
      },
    ],
  },
];

// --- helpers ---

export function getLesson(slug: string) {
  return LESSONS.find((l) => l.slug === slug) ?? null;
}

export function lessonsByCategory(cat: Lesson["category"]) {
  // Keep the Learn page tidy as lessons grow
  return LESSONS.filter((l) => l.category === cat).slice().sort((a, b) => a.title.localeCompare(b.title));
}
