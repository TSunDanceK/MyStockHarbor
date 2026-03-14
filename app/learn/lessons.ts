// app/learn/lessons.ts

export type Lesson = {
  slug: string;
  title: string;
  category: "Basics" | "Indicators" | "Divergencies";
  summary: string;
  sections: { heading: string; body: string[] }[];
};

export const LESSONS: Lesson[] = [
  // ---------------- BASICS ----------------
  {
    slug: "support-and-resistance",
    title: "Support & Resistance",
    category: "Basics",
    summary: "How to spot important price levels where markets often react.",
    sections: [
      {
        heading: "What it is",
        body: [
          "Support is a price area where buyers tend to step in and slow or stop a drop.",
          "Resistance is a price area where sellers tend to step in and slow or stop a rise.",
          "These levels form because many traders react to similar price areas.",
        ],
      },
      {
        heading: "How to identify it",
        body: [
          "Look for places where price has bounced or reversed more than once.",
          "Support forms where price repeatedly stops falling.",
          "Resistance forms where price repeatedly stops rising.",
          "The more clean touches, the more meaningful the level can be.",
        ],
      },
      {
        heading: "What it means",
        body: [
          "At support, demand has shown up before — price may bounce or pause again.",
          "At resistance, supply has shown up before — price may reject or stall again.",
          "If a level breaks, price often moves faster because the “wall” is gone.",
        ],
      },
      {
        heading: "Common mistakes",
        body: [
          "Treating levels as exact prices instead of zones (areas).",
          "Drawing too many lines until the chart becomes cluttered.",
          "Ignoring trend context (a level on a tiny timeframe can be meaningless).",
        ],
      },
      {
        heading: "Why it’s useful",
        body: [
          "Helps plan entries near areas where price often reacts.",
          "Helps place stops logically (beyond the zone, not inside it).",
          "Helps set targets (next resistance / next support).",
          "Helps recognize breakouts and false breakouts.",
        ],
      },
    ],
  },
  {
  slug: "how-to-identify-stock-trends",
  title: "How to Identify Stock Trends",
  category: "Basics",
  summary: "Learn how to recognise uptrends, downtrends, and sideways markets using price structure and moving averages.",
  sections: [
    {
      heading: "What it is",
      body: [
        "Trend is the overall direction price is moving over time.",
        "An uptrend usually means higher highs and higher lows.",
        "A downtrend usually means lower highs and lower lows.",
        "A sideways market means price is ranging without a clear direction.",
      ],
    },
    {
      heading: "How to identify it",
      body: [
        "Start with price structure first: higher highs and higher lows usually signal an uptrend.",
        "Use moving averages like MA50 and MA200 to help simplify the chart.",
        "Check whether momentum indicators like RSI or MACD agree with the move.",
        "Use higher timeframes for the bigger picture before focusing on lower timeframes.",
      ],
    },
    {
      heading: "What it means",
      body: [
        "A strong trend gives context to the rest of the chart.",
        "It helps you judge whether pullbacks are normal or whether the move may be weakening.",
        "Trend direction can shape how you interpret indicators, support, and resistance.",
      ],
    },
    {
      heading: "Common mistakes",
      body: [
        "Trying to call reversals too early before the chart structure has changed.",
        "Using indicators before understanding the underlying price trend.",
        "Ignoring the wider market context when judging a stock move.",
      ],
    },
    {
      heading: "Why it’s useful",
      body: [
        "Trend is one of the most important building blocks in chart reading.",
        "It helps traders align with stronger moves instead of fighting them.",
        "It makes signals from indicators and levels much easier to interpret.",
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
        heading: "What it is",
        body: [
          "A timeframe is the “zoom level” of your chart (Daily, 4H, 1H, 15m, etc.).",
          "Higher timeframes show the big picture (trend + major levels).",
          "Lower timeframes show detail (entries + short-term noise).",
        ],
      },
      {
        heading: "How to identify it",
        body: [
          "Start higher (Daily/Weekly) to mark the main trend and key support/resistance.",
          "Then go lower (4H/1H) to refine levels and find better entries.",
          "If signals conflict, the higher timeframe usually matters more.",
        ],
      },
      {
        heading: "What it means",
        body: [
          "A “breakout” on 5m can be irrelevant on the Daily chart.",
          "A strong Daily trend can overpower short-term pullbacks.",
          "Good trading decisions usually match the higher-timeframe direction.",
        ],
      },
      {
        heading: "Common mistakes",
        body: [
          "Using only one timeframe and missing context.",
          "Taking trades on tiny timeframes against the higher-timeframe trend.",
          "Changing timeframes until you find a signal you like (confirmation bias).",
        ],
      },
      {
        heading: "Why it’s useful",
        body: [
          "Helps you trade with context instead of guessing.",
          "Improves level quality (Daily levels are usually stronger than 5m levels).",
          "Helps reduce overtrading by focusing on the right “zoom level.”",
        ],
      },
    ],
  },

  // -------------- INDICATORS --------------
  {
    slug: "atr",
    title: "ATR (14)",
    category: "Indicators",
    summary: "A volatility measure — useful for stops and spotting ‘hot’ conditions.",
    sections: [
      {
        heading: "What it is",
        body: [
          "ATR (Average True Range) estimates how much price typically moves per bar.",
          "Higher ATR = more volatility. Lower ATR = quieter movement.",
          "It does not tell direction — only how “active” price is.",
        ],
      },
      {
        heading: "How to identify it",
        body: [
          "Watch for ATR rising quickly: volatility is increasing.",
          "Compare ATR to its recent average (is it unusually high or low?).",
          "Use the same timeframe as your trade (ATR changes by timeframe).",
        ],
      },
      {
        heading: "What it means",
        body: [
          "High ATR means bigger swings — stops may need more room.",
          "Low ATR means smaller swings — moves may be slower and tighter.",
          "Sudden ATR spikes can happen around news or breakouts.",
        ],
      },
      {
        heading: "Common mistakes",
        body: [
          "Using ATR as a buy/sell signal (it’s not directional).",
          "Keeping the same stop size in all volatility regimes.",
          "Comparing ATR values across different timeframes without context.",
        ],
      },
      {
        heading: "Why it’s useful",
        body: [
          "Helps size stops based on current market volatility.",
          "Helps avoid getting stopped out by normal noise.",
          "Helps spot when conditions are unusually “hot” or unusually “quiet.”",
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
        heading: "What it is",
        body: [
          "Bollinger Bands are a middle moving average (often 20) plus/minus volatility (standard deviation).",
          "When volatility rises, the bands widen.",
          "When volatility falls, the bands tighten.",
        ],
      },
      {
        heading: "How to identify it",
        body: [
          "Price near the upper band can mean “extended” (not guaranteed reversal).",
          "Price near the lower band can mean “extended” to the downside.",
          "A very tight band (a squeeze) suggests volatility is low and may expand soon.",
        ],
      },
      {
        heading: "What it means",
        body: [
          "Touches can happen many times in strong trends (bands aren’t a hard ceiling).",
          "Squeezes can precede a big move — direction still needs confirmation.",
          "Mean-reversion traders look for reversion back toward the middle band.",
        ],
      },
      {
        heading: "Common mistakes",
        body: [
          "Selling every upper-band touch and buying every lower-band touch.",
          "Ignoring trend (bands behave differently in trends vs ranges).",
          "Assuming a squeeze predicts direction (it doesn’t).",
        ],
      },
      {
        heading: "Why it’s useful",
        body: [
          "Helps spot volatility expansion and contraction.",
          "Helps identify stretched conditions (with context).",
          "Helps visualize when price is moving unusually far from its average.",
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
        heading: "What it is",
        body: [
          "EMA (Exponential Moving Average) is a smoothed price line that weights recent prices more.",
          "It reacts faster than a simple moving average (SMA) of the same length.",
          "EMA20 is commonly used as a trend/pullback reference.",
        ],
      },
      {
        heading: "How to identify it",
        body: [
          "In uptrends, price often stays above EMA20 and pulls back toward it.",
          "In downtrends, price often stays below EMA20 and rallies into it.",
          "Repeated “respect” of EMA20 can make it act like dynamic support/resistance.",
        ],
      },
      {
        heading: "What it means",
        body: [
          "Holding above EMA20 often supports bullish momentum (context matters).",
          "Breaking below EMA20 can signal momentum weakening or a deeper pullback.",
          "In choppy markets, EMA20 can whipsaw (many false signals).",
        ],
      },
      {
        heading: "Common mistakes",
        body: [
          "Using EMA20 alone as a buy/sell signal without trend context.",
          "Trading EMA crossovers on low timeframes and getting whipsawed.",
          "Assuming EMA20 is a “guaranteed bounce” level.",
        ],
      },
      {
        heading: "Why it’s useful",
        body: [
          "Helps quickly visualize short-term trend direction.",
          "Helps spot pullbacks inside a trend.",
          "Can help with trailing stops or dynamic support/resistance ideas.",
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
        heading: "What it is",
        body: [
          "MACD compares a fast EMA and slow EMA to estimate momentum.",
          "The histogram shows the gap between the MACD line and the signal line.",
          "It’s commonly used to judge momentum shifts, not exact tops/bottoms.",
        ],
      },
      {
        heading: "How to identify it",
        body: [
          "Histogram above zero = bullish momentum bias.",
          "Histogram below zero = bearish momentum bias.",
          "Watch histogram changes (rising vs falling) to see momentum strengthening or weakening.",
        ],
      },
      {
        heading: "What it means",
        body: [
          "Momentum can weaken before price reverses (useful early warning).",
          "In strong trends, MACD can stay positive/negative for long periods.",
          "Divergence (price up, MACD down) can hint momentum is fading.",
        ],
      },
      {
        heading: "Common mistakes",
        body: [
          "Using MACD as a standalone buy/sell system.",
          "Overreacting to tiny histogram flips around zero.",
          "Ignoring trend context (MACD behaves differently in strong trends).",
        ],
      },
      {
        heading: "Why it’s useful",
        body: [
          "Helps spot momentum shifts earlier than price alone.",
          "Helps confirm trend direction (positive/negative bias).",
          "Helps identify possible weakening via divergence.",
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
        heading: "What it is",
        body: [
          "A moving average is a smoothed line of price over a set number of bars.",
          "MA50 reacts faster than MA200 because it uses fewer bars.",
          "MA200 is often used as a long-term trend filter.",
        ],
      },
      {
        heading: "How to identify it",
        body: [
          "Price above MA200 often suggests long-term bullish bias (not a rule).",
          "Price below MA200 often suggests long-term bearish bias.",
          "MA50 crossing MA200 is a popular signal — but it’s lagging.",
        ],
      },
      {
        heading: "What it means",
        body: [
          "Moving averages can act like dynamic support/resistance zones.",
          "A strong trend often respects MA50/MA200 on pullbacks.",
          "Crossovers happen after much of the move already happened.",
        ],
      },
      {
        heading: "Common mistakes",
        body: [
          "Buying/selling purely because price crossed an average once.",
          "Treating MA lines as exact and ignoring zones.",
          "Using moving averages in choppy ranges (lots of false signals).",
        ],
      },
      {
        heading: "Why it’s useful",
        body: [
          "Helps quickly identify long-term trend direction.",
          "Helps map likely pullback areas in trending markets.",
          "Adds structure and reduces emotional trading decisions.",
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
        heading: "What it is",
        body: [
          "RSI (Relative Strength Index) is a momentum oscillator from 0 to 100.",
          "RSI above ~70 is often called overbought; below ~30 is often oversold.",
          "It measures speed/strength of recent moves — not “value.”",
        ],
      },
      {
        heading: "How to identify it",
        body: [
          "RSI near/above 70 can signal stretched upside momentum.",
          "RSI near/below 30 can signal stretched downside momentum.",
          "In strong trends, RSI can stay high or low for a long time.",
        ],
      },
      {
        heading: "What it means",
        body: [
          "Overbought doesn’t mean “must sell” — it can mean strong trend.",
          "Oversold doesn’t mean “must buy” — it can mean strong downtrend.",
          "RSI divergence can warn momentum is weakening.",
        ],
      },
      {
        heading: "Common mistakes",
        body: [
          "Shorting just because RSI is above 70 in a strong uptrend.",
          "Buying just because RSI is below 30 in a strong downtrend.",
          "Using RSI alone without trend + levels.",
        ],
      },
      {
        heading: "Why it’s useful",
        body: [
          "Helps spot stretched momentum conditions.",
          "Helps confirm trend strength (RSI tends to stay elevated in uptrends).",
          "Helps warn of weakening momentum via divergence.",
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
        heading: "What it is",
        body: [
          "Stochastic compares the close to the recent high/low range over a lookback window.",
          "It’s often shown as %K (fast) and %D (smoothed).",
          "Like RSI, it’s used to spot momentum extremes.",
        ],
      },
      {
        heading: "How to identify it",
        body: [
          "%K above ~80 is often called overbought; below ~20 is oversold.",
          "Crosses of %K and %D can hint momentum shifts (not guaranteed).",
          "In strong trends, it can stay pinned near extremes.",
        ],
      },
      {
        heading: "What it means",
        body: [
          "Overbought/oversold can mean “strong trend” rather than “reversal.”",
          "Momentum shifts matter more when they align with trend + levels.",
          "Divergence between price and Stoch can also occur (similar idea to RSI).",
        ],
      },
      {
        heading: "Common mistakes",
        body: [
          "Buying/selling every overbought/oversold reading.",
          "Ignoring trend (most oscillator losses come from fighting trends).",
          "Over-trading tiny crosses on low timeframes.",
        ],
      },
      {
        heading: "Why it’s useful",
        body: [
          "Helps spot stretched momentum and possible pullbacks.",
          "Helps time entries better in ranges when used with support/resistance.",
          "Provides a second view of momentum similar to RSI.",
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
        heading: "What it is",
        body: [
          "Volume is how much was traded during a bar (day/week/etc.).",
          "Higher volume means more participation.",
          "Lower volume means fewer participants and often weaker conviction.",
        ],
      },
      {
        heading: "How to identify it",
        body: [
          "Compare current volume to a recent average (like 20-bar average).",
          "Breakouts with higher-than-usual volume are typically more credible.",
          "Low-volume breakouts can fail more often (but not always).",
        ],
      },
      {
        heading: "What it means",
        body: [
          "High volume can confirm interest behind a move.",
          "Low volume can mean a move is fragile or easily reversed.",
          "Spikes can happen around news, earnings, or major breakouts.",
        ],
      },
      {
        heading: "Common mistakes",
        body: [
          "Assuming high volume always means bullish (it can be selling too).",
          "Ignoring context (volume meaning changes at levels and breakouts).",
          "Comparing volume across very different symbols without context.",
        ],
      },
      {
        heading: "Why it’s useful",
        body: [
          "Helps confirm breakouts and breakdowns.",
          "Helps spot unusual activity.",
          "Adds context to price moves (strong vs weak participation).",
        ],
      },
    ],
  },
  {
    slug: "vwap",
    title: "VWAP",
    category: "Indicators",
    summary: "A volume-weighted average price — often treated like a ‘fair value’ reference.",
    sections: [
      {
        heading: "What it is",
        body: [
          "VWAP is the average price weighted by volume (more volume = more influence).",
          "It’s most common intraday; on daily data it’s a rough reference.",
          "Many traders treat VWAP like a ‘fair price’ anchor.",
        ],
      },
      {
        heading: "How to identify it",
        body: [
          "Price above VWAP often suggests buyers are in control (context matters).",
          "Price below VWAP often suggests sellers are in control.",
          "Large distance from VWAP can signal ‘stretched’ conditions.",
        ],
      },
      {
        heading: "What it means",
        body: [
          "Mean reversion traders watch for price to return toward VWAP.",
          "Trend traders may prefer being on the same side as VWAP.",
          "VWAP isn’t magic — it’s a reference point, not a guarantee.",
        ],
      },
      {
        heading: "Common mistakes",
        body: [
          "Using VWAP as a guaranteed bounce/reversal line.",
          "Ignoring trend (price can stay far from VWAP in strong trends).",
          "Overfitting rules to VWAP without considering the bigger chart context.",
        ],
      },
      {
        heading: "Why it’s useful",
        body: [
          "A simple “fair price” reference to judge if price is stretched.",
          "Helps frame bias (above vs below) in active markets.",
          "Pairs well with support/resistance and trend context.",
        ],
      },
    ],
  },

  // ------------ DIVERGENCIES ------------
  {
    slug: "rsi-divergence",
    title: "RSI Divergence",
    category: "Divergencies",
    summary: "When price and RSI disagree — often a warning that momentum is weakening.",
    sections: [
      {
        heading: "What it is",
        body: [
          "Divergence is when price makes a new high/low, but RSI does not.",
          "It can be an early warning that the current move is losing strength.",
          "It’s a clue, not a guaranteed reversal signal.",
        ],
      },
      {
        heading: "How to identify it",
        body: [
          "Bearish: price makes a higher high, RSI makes a lower high.",
          "Bullish: price makes a lower low, RSI makes a higher low.",
          "Look for clear swing highs/lows (not tiny wiggles).",
        ],
      },
      {
        heading: "What it means",
        body: [
          "Momentum is not confirming the new price extreme.",
          "The trend may slow, pull back, or reverse (context decides).",
          "Divergence is stronger near major support/resistance levels.",
        ],
      },
      {
        heading: "Common mistakes",
        body: [
          "Treating divergence as an automatic reversal trade.",
          "Using very small swings (noise) and calling it divergence.",
          "Ignoring the bigger trend (divergence can fail in strong trends).",
        ],
      },
      {
        heading: "Why it’s useful",
        body: [
          "Helps spot weakening momentum before price clearly turns.",
          "Helps plan risk (tighten stops when momentum fades).",
          "Pairs well with levels for higher-quality setups.",
        ],
      },
    ],
  },
  {
    slug: "macd-divergence",
    title: "MACD Divergence",
    category: "Divergencies",
    summary: "When price pushes but MACD momentum doesn’t — a useful ‘weakening’ clue.",
    sections: [
      {
        heading: "What it is",
        body: [
          "Divergence is when price makes a new high/low, but MACD does not.",
          "It highlights momentum disagreement with price.",
          "Like RSI divergence, it’s a warning light — not a guarantee.",
        ],
      },
      {
        heading: "How to identify it",
        body: [
          "Bearish: price higher high, MACD lower high.",
          "Bullish: price lower low, MACD higher low.",
          "Use clear swing highs/lows for better signals.",
        ],
      },
      {
        heading: "What it means",
        body: [
          "Momentum is weakening even if price is still pushing.",
          "Often leads to a pullback or a range before a bigger decision.",
          "Best used with trend + a key level (support/resistance).",
        ],
      },
      {
        heading: "Common mistakes",
        body: [
          "Shorting the first bearish divergence in a strong uptrend.",
          "Calling tiny moves divergence (noise).",
          "Ignoring that divergence can lead to a pullback, not a full reversal.",
        ],
      },
      {
        heading: "Why it’s useful",
        body: [
          "Helps spot momentum shifts earlier than price alone.",
          "Helps manage risk (tighten stops / take partial profits).",
          "Pairs well with levels to improve timing and confirmation.",
        ],
      },
    ],
  },
];

// --- helpers ---

export function getLesson(slug: string) {
  const s = decodeURIComponent(String(slug ?? "")).trim().toLowerCase();
  return LESSONS.find((l) => String(l.slug ?? "").trim().toLowerCase() === s) ?? null;
}

export function lessonsByCategory(cat: Lesson["category"]) {
  return LESSONS.filter((l) => l.category === cat);
}

export function getNextLesson(slug: string) {
  const s = decodeURIComponent(String(slug ?? "")).trim().toLowerCase();
  const index = LESSONS.findIndex(
    (l) => String(l.slug ?? "").trim().toLowerCase() === s
  );

  if (index === -1) return null;
  if (index >= LESSONS.length - 1) return null;

  return LESSONS[index + 1];
}
