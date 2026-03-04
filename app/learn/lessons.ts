// app/learn/lessons.ts

export type Lesson = {
  slug: string;
  title: string;
  category: "Basics" | "Indicators";
  summary: string;
  sections: { heading: string; body: string[] }[];
};

export const LESSONS: Lesson[] = [
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
];

export function getLesson(slug: string) {
  return LESSONS.find((l) => l.slug === slug) ?? null;
}

export function lessonsByCategory(cat: Lesson["category"]) {
  return LESSONS.filter((l) => l.category === cat);
}
