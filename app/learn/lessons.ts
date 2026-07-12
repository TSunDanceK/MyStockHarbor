// app/learn/lessons.ts

export type LessonImage = { src: string; caption: string };

export type LessonSection = {
  heading: string;
  body: string[];
  image?: LessonImage;
};

export type Lesson = {
  slug: string;
  title: string;
  category: "Basics" | "Indicators" | "Divergencies";
  summary: string;
  sections: LessonSection[];
};

export const LESSONS: Lesson[] = [
  // ---------------- BASICS ----------------
  {
    slug: "support-and-resistance",
    title: "Support & Resistance",
    category: "Basics",
    summary:
      "A deep dive into the price levels where markets repeatedly react — how to draw them, how they flip roles after a breakout, and how to trade around them.",
    sections: [
      {
        heading: "What it is",
        body: [
          "Support is a price area where buying interest has repeatedly been strong enough to stop or slow a decline. Resistance is the mirror image — an area where selling interest has repeatedly capped a rise.",
          "These areas exist because market memory is real. Traders who bought at a level defend it, traders who missed a move wait to buy the retest, and traders trapped on the wrong side exit at break-even when price returns to their entry. All of that behaviour clusters orders around the same prices.",
          "The most important word here is AREA. Support and resistance are zones a few percent wide, not exact lines. Price routinely overshoots a level by a small amount before reversing — a zone absorbs that noise, a line gets you shaken out.",
        ],
        image: {
          src: "/learn/support-and-resistance/01.png",
          caption:
            "Support and resistance drawn as zones. Note how price respects the area rather than an exact price, and how multiple touches make the zone more meaningful.",
        },
      },
      {
        heading: "How to identify strong levels",
        body: [
          "Start on a higher timeframe (daily or weekly) and mark only the most obvious places where price clearly reversed more than once. If you have to squint to see it, it is not a level worth trading.",
          "Quality beats quantity. A level with three clean, well-separated touches is far more meaningful than five levels with one messy touch each. Recent touches matter more than touches from years ago.",
          "Round numbers ($50, $100, $500), prior all-time highs, large gap origins, and heavily traded consolidation areas all tend to act as natural support/resistance because so many participants anchor decisions to them.",
          "Volume adds conviction: a level where huge volume traded is a level where many positions were opened — and will be defended.",
        ],
      },
      {
        heading: "The role flip: broken resistance becomes support",
        body: [
          "One of the most reliable behaviours in charting is the role flip. When price breaks decisively above resistance, that same area often acts as support on the next pullback — and vice versa when support breaks.",
          "The logic is simple: buyers who missed the breakout want in on the retest, and shorts who sold the old resistance buy back to cut losses at break-even. Both create demand exactly where supply used to be.",
          "This is why 'breakout, retest, continuation' is one of the most traded setups in the market. Rather than chasing the breakout candle, many traders wait for the retest of the flipped level, where the stop can be placed much closer.",
        ],
        image: {
          src: "/learn/support-and-resistance/02.png",
          caption:
            "A resistance zone breaks, is retested from above, and holds as new support — the classic role flip that powers breakout-retest entries.",
        },
      },
      {
        heading: "Worked example: trading a support test",
        body: [
          "Suppose a stock has bounced from the $95–$97 zone three times over several months and is now falling toward it a fourth time in a broader uptrend.",
          "A patient plan looks like this: wait for price to enter the zone AND show a reaction — a strong bounce candle, a hammer, or a bullish divergence on RSI — rather than buying blindly at first touch.",
          "The stop goes below the zone (for example $93), not inside it, so normal overshoot noise cannot take you out. The first target is the middle of the prior range or the prior high, giving a risk-to-reward comfortably above 2:1.",
          "If the zone breaks cleanly instead, there is no trade — and the broken zone becomes an area to watch for a short retest or a much deeper buy level below.",
        ],
      },
      {
        heading: "Common mistakes",
        body: [
          "Treating levels as exact prices instead of zones, then getting stopped out by a few cents of overshoot.",
          "Drawing so many lines that every candle touches one — if everything is a level, nothing is.",
          "Trading a minor intraday level against a major daily/weekly trend.",
          "Buying support in a collapsing downtrend: in strong trends, levels break far more often than they hold.",
          "Placing stops exactly at the level, where every other trader's stop also sits.",
        ],
      },
      {
        heading: "Using it with other tools",
        body: [
          "Support and resistance work best as the WHERE of a trade, with other tools supplying the WHEN. A support zone plus a bullish RSI divergence, or a resistance break plus a volume surge, is far stronger than either signal alone.",
          "Moving averages often act as dynamic support/resistance — when a horizontal zone lines up with the MA200 (see the Moving Averages lesson), the confluence makes the area significantly more important.",
          "Risk management ties it together: zones give you a logical invalidation point, which is what makes correct position sizing possible in the first place.",
        ],
        image: {
          src: "/learn/support-and-resistance/03.png",
          caption:
            "Stop placement done properly: beyond the zone, not inside it, with the target measured to the next level — the structure defines the risk-reward before entry.",
        },
      },
      {
        heading: "Key takeaways",
        body: [
          "Levels are zones, not lines — give them room to breathe.",
          "Fewer, cleaner levels beat many weak ones; clean multiple touches and recency are what make a level strong.",
          "Broken resistance tends to become support (and vice versa) — the retest is often the higher-quality entry.",
          "Always know where the idea is wrong before entering: the far side of the zone is your invalidation.",
        ],
      },
    ],
  },
  {
    slug: "how-to-identify-stock-trends",
    title: "How to Identify Stock Trends",
    category: "Basics",
    summary:
      "How to classify a chart as uptrend, downtrend or range using price structure, moving averages and momentum — and why trend context should filter every other signal you take.",
    sections: [
      {
        heading: "What a trend actually is",
        body: [
          "A trend is a persistent imbalance between buyers and sellers. In an uptrend, dips keep getting bought before they reach the prior low, producing higher highs (HH) and higher lows (HL). In a downtrend, rallies keep getting sold, producing lower highs (LH) and lower lows (LL).",
          "A sideways market (range) is a standoff — price oscillates between a support floor and a resistance ceiling with no lasting winner.",
          "Markets spend a surprising amount of time ranging. Correctly identifying 'no trend' is just as valuable as identifying a trend, because trend-following tools fail badly in ranges.",
        ],
        image: {
          src: "/learn/how-to-identify-stock-trends/01.png",
          caption:
            "An uptrend defined by structure: each swing high exceeds the last (HH) and each pullback bottoms above the prior low (HL).",
        },
      },
      {
        heading: "Step 1 — read the structure",
        body: [
          "Before adding a single indicator, label the last several swing highs and swing lows. Are the highs rising? Are the lows rising? If both, it is an uptrend. If both are falling, a downtrend. If mixed, it is a range or a transition.",
          "The transition points matter most. An uptrend is put on notice when price makes a lower high for the first time, and structurally broken when it takes out the last higher low. That single rule filters out most premature 'the trend is over' calls.",
          "Do this on the higher timeframe first — daily or weekly — because the higher-timeframe structure dominates. A 15-minute downtrend inside a weekly uptrend is usually just a pullback.",
        ],
        image: {
          src: "/learn/how-to-identify-stock-trends/02.png",
          caption:
            "The mirror image: a downtrend of lower highs and lower lows. Counter-trend bounces stall below prior highs — these are the rallies that trap early buyers.",
        },
      },
      {
        heading: "Step 2 — confirm with moving averages",
        body: [
          "Moving averages simplify the picture. In a healthy uptrend, price holds above a rising MA50, and the MA50 sits above a rising MA200. In a downtrend the stack is inverted.",
          "The slope of the MA matters more than position alone. Price chopping back and forth across a flat MA200 is the signature of a range — not a trend in either direction.",
          "Crossovers (like the MA50 crossing above the MA200, the 'golden cross') are slow, confirming signals, not early entries. Their real value is telling you which side of the market to favour, not timing the exact turn.",
        ],
        image: {
          src: "/learn/how-to-identify-stock-trends/03.png",
          caption:
            "Trend confirmation with MA50 and MA200: price above both rising averages, and pullbacks finding support near the faster average.",
        },
      },
      {
        heading: "Step 3 — check momentum agrees",
        body: [
          "Momentum indicators like RSI and MACD tell you about the QUALITY of a trend. In strong uptrends RSI tends to oscillate in a higher band (roughly 40–80) and MACD holds above zero.",
          "Divergence is the early warning: if price makes a new high but RSI or MACD makes a lower high, the trend is still up but its engine is weakening. That is a reason to tighten risk — not an automatic signal to reverse position (see the divergence lessons).",
        ],
      },
      {
        heading: "Worked example: classifying a chart in 60 seconds",
        body: [
          "Open the daily chart. First: are the last three swing highs and lows rising? Yes — structural uptrend.",
          "Second: is price above the MA50, and MA50 above MA200, both rising? Yes — averages agree.",
          "Third: is RSI holding above 40 on pullbacks and MACD above zero? Yes — momentum agrees.",
          "Three yeses means you only look for long setups: pullbacks to support, breakouts, bounces off the MA50. Shorting a chart like this means fighting every timeframe at once — a consistently losing habit.",
        ],
      },
      {
        heading: "Common mistakes",
        body: [
          "Calling reversals early — a big red candle is not a trend change; a break of structure is.",
          "Reading indicators before reading price: indicators are derived from price, never the other way round.",
          "Ignoring the higher timeframe and shorting a weekly uptrend because a 1-hour chart looks weak.",
          "Applying trend-following tools in a range, where they whipsaw relentlessly.",
          "Ignoring the overall market — most stocks follow the index; fighting the market tide lowers any setup's odds.",
        ],
      },
      {
        heading: "Key takeaways",
        body: [
          "Structure first (HH/HL vs LH/LL), moving averages second, momentum third.",
          "The trend is your filter: it decides WHICH setups you are allowed to take, before any indicator decides WHEN.",
          "An uptrend ends structurally only when the last higher low breaks — everything before that is noise or warning.",
        ],
      },
    ],
  },
  {
    slug: "timeframes",
    title: "Timeframes",
    category: "Basics",
    summary:
      "Why the same stock can look bullish and bearish at once, how to combine a higher and a lower timeframe, and how to stop timeframe-hopping into bad trades.",
    sections: [
      {
        heading: "What timeframes are",
        body: [
          "A timeframe is simply how much time each candle represents — a weekly candle compresses five trading days, a 5-minute candle compresses five minutes.",
          "The same stock can be in a weekly uptrend, a daily pullback, and a 15-minute downtrend simultaneously. None of those views is wrong; they are different resolutions of the same data.",
          "Confusion between timeframes is one of the most common beginner errors: taking a signal on one timeframe, then judging (and panicking about) the trade on another.",
        ],
        image: {
          src: "/learn/timeframes/01.png",
          caption:
            "The same move at two resolutions: the daily chart shows a simple pullback within an uptrend, while the intraday view of the same period looks like a full downtrend.",
        },
      },
      {
        heading: "Higher timeframe = context, lower timeframe = timing",
        body: [
          "The cleanest mental model is a two-timeframe system. The higher timeframe (weekly or daily) answers: what is the trend, and where are the major levels? The lower timeframe (daily or 4-hour/1-hour) answers: is price reacting at those levels right now, and where exactly do I enter?",
          "A common pairing for swing traders is weekly for context and daily for execution. For day traders, daily for context and 5–15 minute for execution.",
          "Signals aligned WITH the higher timeframe trend have a structural tailwind. A bullish setup on the daily inside a weekly uptrend is a very different bet from the same daily setup inside a weekly downtrend.",
        ],
        image: {
          src: "/learn/timeframes/02.png",
          caption:
            "Top-down in practice: the higher timeframe defines the uptrend and the support zone; the lower timeframe is only used to time the entry inside that zone.",
        },
      },
      {
        heading: "Noise: why low timeframes lie more often",
        body: [
          "Every pattern — support, breakouts, divergences — appears on every timeframe, but reliability is not equal. A weekly level was built from months of real positioning; a 3-minute level was built from a few moments of order flow.",
          "Lower timeframes contain proportionally more random movement, so they produce more false breakouts, more failed patterns, and more stop-outs from pure noise.",
          "This does not make low timeframes useless — it means signals there need higher-timeframe backing to be worth much.",
        ],
        image: {
          src: "/learn/timeframes/03.png",
          caption:
            "Noise in action: the intraday chart 'breaks support' twice in moves that are invisible on the daily chart — pure noise on the higher timeframe.",
        },
      },
      {
        heading: "Worked example: a top-down analysis",
        body: [
          "Weekly: stock is in an uptrend (HH/HL), pulling back toward the area of its prior breakout and the weekly MA50. Conclusion: look for longs, ideally in that zone.",
          "Daily: price enters the zone and prints a strong bounce candle with above-average volume, RSI turning up from ~40. Conclusion: the zone is being defended; a long entry is now justified.",
          "Execution: enter on the daily signal, stop below the weekly zone, target the prior weekly high. The weekly chose the trade; the daily timed it.",
          "Manage the trade on the timeframe you entered on. Checking a 5-minute chart every hour on a weekly-context swing trade only invites panic exits.",
        ],
      },
      {
        heading: "Common mistakes",
        body: [
          "Timeframe-hopping until some chart agrees with what you already want to do — that is confirmation bias, not analysis.",
          "Taking entries on tiny timeframes directly against the higher-timeframe trend.",
          "Setting a stop based on a 5-minute chart for a trade whose thesis is weekly — the stop is far too tight for the idea.",
          "Judging a swing trade by intraday candles and abandoning a valid setup because of noise.",
        ],
      },
      {
        heading: "Key takeaways",
        body: [
          "Pick two timeframes — one for context, one for timing — and keep their jobs separate.",
          "Analyse top-down (higher first), never bottom-up.",
          "The higher the timeframe, the more meaningful the pattern; the lower the timeframe, the more noise.",
          "Manage each trade on the timeframe that produced it.",
        ],
      },
    ],
  },

  // ---------------- INDICATORS ----------------
  {
    slug: "atr",
    title: "ATR (14)",
    category: "Indicators",
    summary:
      "Average True Range measures how far a stock actually moves — the volatility yardstick behind sensible stop distances, realistic targets and consistent position sizing.",
    sections: [
      {
        heading: "What it is",
        body: [
          "ATR (Average True Range) measures volatility — the average size of a stock's recent moves — with no opinion about direction. A rising ATR means bigger candles and wilder swings; a falling ATR means the stock is quietening down.",
          "The 'true range' of each day is the largest of: today's high minus low, the gap up from yesterday's close to today's high, or the gap down from yesterday's close to today's low. Gaps count as movement, which is why true range is used instead of simple candle size.",
          "ATR(14) averages that true range over the last 14 periods. On a daily chart it answers: how much does this stock typically move in a day?",
        ],
        image: {
          src: "/learn/atr/01.png",
          caption:
            "ATR rises as candles get larger during a volatile sell-off, then compresses as price stabilises — it measures movement, not direction.",
        },
      },
      {
        heading: "How to read it",
        body: [
          "ATR is quoted in price units: an ATR of 4 on a $200 stock means roughly $4 of typical daily movement (about 2%).",
          "Compare ATR to its own history on the same chart, not across different stocks. ATR doubling from 2 to 4 tells you conditions have changed; comparing a $20 stock's ATR to a $2,000 stock's ATR tells you nothing without dividing by price.",
          "Volatility is cyclical: quiet periods (low, flat ATR) tend to precede expansions, and volatility spikes tend to decay back down. Very low ATR after a long consolidation often marks a market coiling before a bigger move.",
        ],
        image: {
          src: "/learn/atr/02.png",
          caption:
            "Volatility compression before expansion: a long quiet base drives ATR to lows, then the breakout arrives with an ATR surge.",
        },
      },
      {
        heading: "The killer application: ATR-based stops",
        body: [
          "A stop loss placed closer than the stock's normal daily wiggle is a donation. If a stock moves $3 on an average day, a $1 stop will be hit by noise even when the idea is right.",
          "A common approach: place stops 1.5–2 ATR beyond the entry (or beyond the level that defines the trade). This scales automatically — volatile stocks get wide stops, quiet stocks tight ones.",
          "ATR then feeds position sizing: risk per share = stop distance (say 2 ATR). Shares = your fixed account risk ÷ that distance. Same money at risk on every trade, regardless of how wild the stock is — this is how volatile positions stop blowing holes in an account.",
        ],
        image: {
          src: "/learn/atr/03.png",
          caption:
            "Two stops on the same entry: the tight arbitrary stop dies on normal noise; the 2-ATR stop survives the shakeout and stays in the winning trade.",
        },
      },
      {
        heading: "Worked example",
        body: [
          "A stock trades at $150 with ATR(14) = $3. You buy a support bounce at $150.",
          "Stop: 2 ATR below entry = $144. Risk per share = $6.",
          "If your account risks $200 per trade, position size = $200 ÷ $6 ≈ 33 shares. A calmer stock with ATR $1 would get a $2 stop and 100 shares — identical dollar risk, different share counts.",
          "Targets can also be framed in ATR: expecting a $9 move (3 ATR) in a couple of days from a stock that moves $3 a day is realistic; expecting it from a stock with ATR $0.80 is fantasy.",
        ],
      },
      {
        heading: "Common mistakes",
        body: [
          "Using ATR as a buy/sell signal — it has no direction; it only sizes the moves.",
          "Comparing raw ATR values across stocks with very different prices (divide by price first).",
          "Keeping the same fixed-dollar stop on every stock regardless of its volatility.",
          "Ignoring that ATR lags: after a sudden news spike, current risk is higher than the trailing average suggests.",
        ],
      },
      {
        heading: "Key takeaways",
        body: [
          "ATR measures how much a stock moves, never which way.",
          "Stops belong beyond normal noise: 1.5–2 ATR is a sensible default.",
          "ATR-based sizing equalises risk across quiet and wild stocks — this is its most valuable use.",
          "Low, flat ATR after consolidation often precedes the next big expansion.",
        ],
      },
    ],
  },
  {
    slug: "bollinger-bands",
    title: "Bollinger Bands (20, 2)",
    category: "Indicators",
    summary:
      "Volatility bands around a 20-period average — how to read the squeeze, why 'walking the band' is strength rather than a sell signal, and when band tags actually mean reversion.",
    sections: [
      {
        heading: "What it is",
        body: [
          "Bollinger Bands wrap a moving average in a volatility envelope: a middle 20-period simple moving average, with an upper and lower band placed 2 standard deviations above and below it.",
          "Because the width is driven by standard deviation, the bands breathe with the market — expanding in volatile phases, contracting in quiet ones. The vast majority of price action stays inside the bands, which is what makes excursions to the bands informative.",
          "The bands adapt automatically. That is their advantage over fixed percentage envelopes: the definition of 'stretched' updates as conditions change.",
        ],
        image: {
          src: "/learn/bollinger-bands/01.png",
          caption:
            "The anatomy: middle 20-SMA, upper and lower bands at ±2 standard deviations, widening as volatility picks up and tightening as it fades.",
        },
      },
      {
        heading: "The squeeze: volatility coiling before a move",
        body: [
          "The most famous Bollinger signal is the squeeze: bands pinching to their narrowest width in months. Volatility is mean-reverting, so unusually quiet markets tend to precede unusually large moves.",
          "The squeeze itself is direction-neutral — it says a move is loading, not which way. Direction comes from the eventual break, ideally confirmed by volume and by which side of the range price resolves.",
          "Beware the head-fake: squeezes often break one way briefly, reverse, and make the real move the other way. Waiting for a close outside the band with expanding volume filters many of these.",
        ],
        image: {
          src: "/learn/bollinger-bands/02.png",
          caption:
            "A squeeze resolving upward: a stretch of tightening bands, then a breakout that rides the expanding upper band.",
        },
      },
      {
        heading: "Walking the band vs. mean reversion",
        body: [
          "The biggest Bollinger misconception: 'touching the upper band = overbought = sell.' In a strong trend, price can close along the upper band for weeks — called walking the band — and every touch is strength, not weakness.",
          "Context decides which mode you are in. In a RANGE (flat middle band, price oscillating), band tags genuinely do tend to revert toward the middle band, and fading them can work. In a TREND (sloped middle band, one-sided closes), band tags are continuation, and fading them is how accounts get hurt.",
          "A useful tell for reversion setups: price closes outside the band, then closes back inside on the next bar — an exhaustion hint far stronger than the tag alone.",
        ],
        image: {
          src: "/learn/bollinger-bands/03.png",
          caption:
            "Two regimes on one chart: in the range, lower-band tags revert to the middle; once the trend starts, price walks the upper band and every 'overbought' touch just continues.",
        },
      },
      {
        heading: "Worked example: a range-bound reversion trade",
        body: [
          "A stock has oscillated between $48 and $54 for two months; the middle band is flat — range mode confirmed.",
          "Price spikes down to $48.20, closing below the lower band, then the next candle closes back inside the bands. RSI is near 30 and the $48 zone is known support.",
          "Entry on the close back inside, stop below $47 (beyond the support zone, roughly 1.5 ATR), first target the middle band (~$51), stretch target the upper band.",
          "The same tag during a fresh breakdown from the range would be no trade at all — trend mode means band tags no longer mean reversion.",
        ],
      },
      {
        heading: "Common mistakes",
        body: [
          "Selling every upper-band touch in an uptrend (fighting a walking band).",
          "Trading the squeeze breakout without volume confirmation and getting caught in the head-fake.",
          "Using bands alone with no support/resistance or trend context.",
          "Assuming a band touch is a signal by itself — bands describe conditions; they don't generate entries.",
        ],
      },
      {
        heading: "Key takeaways",
        body: [
          "Bands measure stretched vs. quiet, adapting to volatility automatically.",
          "Squeeze = energy building; the break direction plus volume supplies the signal.",
          "Flat middle band → fade the bands; sloped middle band → respect the walk.",
          "Close-back-inside after a band violation is the higher-quality reversion trigger.",
        ],
      },
    ],
  },
  {
    slug: "ema20",
    title: "EMA (20)",
    category: "Indicators",
    summary:
      "The fast-reacting 20-period exponential moving average — the swing trader's dynamic support line, and how the pullback-to-EMA20 entry works in a trending stock.",
    sections: [
      {
        heading: "What it is",
        body: [
          "The EMA20 is a 20-period moving average that gives extra weight to the most recent prices, so it turns faster than a simple average of the same length.",
          "Its role is short-term trend: on a daily chart it tracks roughly a month of trading, hugging price closely enough to define the immediate path while smoothing candle-to-candle noise.",
          "It reacts sooner than the MA50/MA200 — that responsiveness is both its strength (early trend reads) and weakness (more false signals in chop).",
        ],
        image: {
          src: "/learn/ema20/01.png",
          caption:
            "EMA20 vs MA50 on the same trend: the EMA hugs price and turns quickly at the reversal, while the slower MA50 lags well behind.",
        },
      },
      {
        heading: "How to read it",
        body: [
          "Slope and position are the whole read. Price above a rising EMA20 = healthy short-term uptrend; price below a falling EMA20 = short-term downtrend; price weaving across a flat EMA20 = no short-term trend, and EMA signals should be ignored.",
          "In strong trends the EMA20 acts as a dynamic support (or resistance) line: momentum stocks often correct to the EMA20 repeatedly and resume, giving the trend a visible 'rail'.",
          "How price behaves at the rail is information. Bouncing off the EMA20 repeatedly = strong trend. Starting to close below it and struggle back = momentum cooling, even before any structure breaks.",
        ],
        image: {
          src: "/learn/ema20/02.png",
          caption:
            "The EMA20 as a rail in a momentum uptrend: repeated pullbacks tag the average and resume — each touch a potential entry with the trend.",
        },
      },
      {
        heading: "The pullback-to-EMA20 setup",
        body: [
          "This is the classic use. Requirements: an established uptrend (structure of HH/HL, price above MA50), a pullback of a few candles into the EMA20, then a resumption signal — a strong bounce candle or a push above the pullback's little high.",
          "Entry on the resumption signal, not on the touch itself. A stop goes below the pullback low (or ~1.5 ATR below the EMA), and the target is the prior high or a measured extension.",
          "The setup works because it buys a strong stock at a discount with a tight, well-defined stop — the essence of trend-following with controlled risk.",
        ],
      },
      {
        heading: "Where it fails: chop",
        body: [
          "In sideways markets the EMA20 is a whipsaw machine: price crosses it constantly, every cross looks like a signal, and none of them follow through.",
          "This is not a flaw to fix with settings — it is the nature of fast averages. The fix is the filter: only trade EMA20 signals when a real trend exists on the higher context (rising MA50, clear structure).",
          "If the EMA20 is flat and price is weaving through it, the correct EMA20 trade is no trade.",
        ],
        image: {
          src: "/learn/ema20/03.png",
          caption:
            "The failure mode: in a range, price crosses the flat EMA20 again and again — every crossover 'signal' whipsaws.",
        },
      },
      {
        heading: "Common mistakes",
        body: [
          "Trading EMA crosses in a range (the whipsaw trap above).",
          "Buying the first touch of the EMA20 with no bounce confirmation.",
          "Using the EMA20 alone to define the whole trend — it only speaks for the short term; pair it with MA50/MA200 for context.",
          "Abandoning a swing position because price closed a few cents under the EMA20 — it is a guide rail, not a tripwire.",
        ],
      },
      {
        heading: "Key takeaways",
        body: [
          "EMA20 = fast, short-term trend line; weight on recent prices makes it responsive.",
          "Best single use: pullback-to-EMA20 entries inside an established uptrend.",
          "Slope flat = signal off; the EMA20 only earns trust when a trend actually exists.",
          "Combine with MA50/MA200 (context) and volume (confirmation) rather than using it solo.",
        ],
      },
    ],
  },
  {
    slug: "macd",
    title: "MACD (12, 26, 9)",
    category: "Indicators",
    summary:
      "Moving Average Convergence Divergence — what the two lines and histogram actually measure, how signal-line and zero-line crosses differ, and where MACD earns (and loses) its keep.",
    sections: [
      {
        heading: "What it is",
        body: [
          "MACD distils trend momentum into three parts. The MACD line is the gap between a fast EMA(12) and a slow EMA(26) — when the fast average pulls away upward, momentum is building; when the gap shrinks, momentum is fading.",
          "The signal line is a 9-period EMA of the MACD line — a smoothed version used as its trigger.",
          "The histogram is the difference between the two: growing bars mean momentum accelerating, shrinking bars mean deceleration — often the earliest clue in the whole indicator.",
        ],
        image: {
          src: "/learn/macd/01.png",
          caption:
            "The three components labeled: MACD line, signal line, and the histogram measuring the gap between them.",
        },
      },
      {
        heading: "The two crosses — and why they differ",
        body: [
          "Signal-line cross: MACD crossing above its signal line is a short-term momentum shift up (and below = down). These fire often — early but noisy.",
          "Zero-line cross: MACD above zero means the 12-EMA is above the 26-EMA — the medium-term trend itself has turned up. These fire rarely — reliable but late.",
          "A practical hierarchy: use the zero line to define regime (above = favour longs, below = favour shorts) and take signal-line crosses only in the direction of that regime.",
        ],
        image: {
          src: "/learn/macd/02.png",
          caption:
            "Crosses taken with the regime: bullish signal-line crosses above the zero line follow through with the trend, while counter-trend crosses mostly whipsaw.",
        },
      },
      {
        heading: "Reading the histogram",
        body: [
          "The histogram peaks BEFORE the crossovers — deceleration precedes reversal. When price is still rising but histogram bars shrink for several sessions, the advance is losing thrust.",
          "That is a management signal, not a reversal signal by itself: tighten stops, take partial profits, stop adding — and only reverse on real confirmation.",
          "Histogram divergence (price makes a new high, histogram peak is lower) is one of the strongest early-warning patterns MACD offers — covered fully in the MACD Divergence lesson.",
        ],
      },
      {
        heading: "Worked example",
        body: [
          "A stock bases for three months after a downtrend. MACD puts in a bullish signal-line cross below zero, then the MACD line climbs through zero as price breaks the base on strong volume.",
          "The zero-line cross confirms a regime change: longs are now favoured. Subsequent pullbacks that produce fresh bullish signal-line crosses above zero become the add/entry points.",
          "Months later price pushes to a new high but the histogram peaks lower and the MACD line rolls into a bearish cross well above zero — profit-taking territory, with an exit or tightened stop long before the trend visibly breaks on price.",
        ],
        image: {
          src: "/learn/macd/03.png",
          caption:
            "Regime change in sequence: bullish cross below zero → zero-line cross confirming the new uptrend → shrinking histogram warning as the move matures.",
        },
      },
      {
        heading: "Common mistakes",
        body: [
          "Taking every signal-line cross in both directions — in chop, MACD whipsaws exactly like the EMAs it is built from.",
          "Ignoring the zero line: a bullish cross deep below zero inside a downtrend is a counter-trend gamble, not a trend signal.",
          "Comparing raw MACD values across different stocks (it is price-scaled; only compare a stock with itself).",
          "Expecting MACD to time exact tops and bottoms — it is a trend/momentum tool and inherently lags turning points.",
        ],
      },
      {
        heading: "Key takeaways",
        body: [
          "MACD = distance between two EMAs; histogram = rate of change of that distance.",
          "Zero line defines the regime; signal-line crosses time entries within it.",
          "Shrinking histogram is the early warning — manage risk on it, don't reverse on it.",
          "MACD shines in trending markets and misfires in ranges; filter with trend context first.",
        ],
      },
    ],
  },
  {
    slug: "moving-averages",
    title: "Moving Averages (MA50 / MA200)",
    category: "Indicators",
    summary:
      "The market's most-watched trend lines — how the MA50 and MA200 define regime, act as dynamic support, and produce the golden/death crosses everyone talks about.",
    sections: [
      {
        heading: "What they are",
        body: [
          "A moving average plots the average closing price over a window, redrawn each bar. The MA50 summarises roughly a quarter of daily trading; the MA200 summarises about a year.",
          "Their power is partly self-fulfilling: because millions of traders, funds and algorithms watch the same two lines, real orders cluster around them. The MA200 in particular is a widely used institutional dividing line between 'healthy' and 'broken' stocks.",
          "Averages smooth the story at the cost of speed — everything they say is slightly late. That trade-off is acceptable because their job is regime, not timing.",
        ],
        image: {
          src: "/learn/moving-averages/01.png",
          caption:
            "A healthy uptrend stack: price above a rising MA50, MA50 above a rising MA200 — with pullbacks repeatedly respecting the averages.",
        },
      },
      {
        heading: "Reading the stack",
        body: [
          "Bullish structure: price > MA50 > MA200, both rising. Bearish: price < MA50 < MA200, both falling. Mixed or flat: transition or range — reduce confidence in all trend signals.",
          "Slope beats position: price slightly under a steeply rising MA200 is usually a dip in an uptrend, while price above a falling MA200 is often just a bounce in a downtrend.",
          "Distance matters too. Price stretched far above the MA50 is extended — averages act like gravity, and reversion to the mean gets likelier the further price strays.",
        ],
      },
      {
        heading: "Golden cross, death cross",
        body: [
          "A golden cross (MA50 crossing above MA200) says the medium-term trend has risen above the long-term trend — historically these have marked the confirmed early-middle of major uptrends. A death cross is the bearish mirror.",
          "Both are LATE by design; the low or high is typically long past when they print. Their value is confirmation and regime definition, not entry timing.",
          "In sideways markets the two averages braid around each other, printing repeated meaningless crosses — the classic environment where cross signals fail.",
        ],
        image: {
          src: "/learn/moving-averages/02.png",
          caption:
            "A golden cross confirming a new uptrend — note how much of the bottom is already in by the time the cross prints. Confirmation, not prediction.",
        },
      },
      {
        heading: "The MA200 buy zone",
        body: [
          "One of the most productive uses of the MA200: strong stocks in confirmed uptrends periodically correct all the way back to a rising MA200 — and that test is where long-term buyers habitually step in.",
          "The setup: established uptrend, first or second touch of a rising MA200, plus a reaction signal (bounce candle, volume, RSI turning up from ~35–40). Stop goes a buffer below the average (it is a zone, not a line); target the prior highs.",
          "The same test below a FALLING MA200 is a different animal entirely — that is resistance in a downtrend, not a buy zone.",
        ],
        image: {
          src: "/learn/moving-averages/03.png",
          caption:
            "The MA200 test: a long uptrend corrects into the rising 200-day average, holds the zone, and resumes — the classic institutional buy area.",
        },
      },
      {
        heading: "Common mistakes",
        body: [
          "Treating an MA touch as an automatic bounce — averages are zones that need a confirming reaction.",
          "Trading golden/death crosses as entries rather than regime confirmation.",
          "Using MA signals in flat markets where the lines braid and whipsaw.",
          "Ignoring slope: buying at a falling MA200 because 'it's the 200' is buying resistance.",
          "Cluttering charts with six averages — MA50 + MA200 (plus optionally EMA20 for timing) covers nearly everything.",
        ],
      },
      {
        heading: "Key takeaways",
        body: [
          "MA50/MA200 define regime: the stack and its slopes classify any chart in seconds.",
          "Crosses confirm big turns late; the rising-MA200 test is the higher-quality entry pattern.",
          "Respect slope and distance: rising = support behaviour, falling = resistance behaviour, stretched = reversion risk.",
        ],
      },
    ],
  },
  {
    slug: "rsi",
    title: "RSI (14)",
    category: "Indicators",
    summary:
      "The Relative Strength Index — what 70/30 really mean, why 'overbought' is not a sell signal in a trend, and how RSI ranges shift between bull and bear markets.",
    sections: [
      {
        heading: "What it is",
        body: [
          "RSI compares the size of recent up-moves against recent down-moves over 14 periods and compresses the answer into a 0–100 scale. Big recent gains push it toward 100; big recent losses push it toward 0.",
          "Above 70 is conventionally called overbought (the advance has been unusually one-sided) and below 30 oversold (the decline has been unusually one-sided).",
          "Crucially, overbought describes the RECENT PAST — it says the move has been strong, not that it must now reverse. Misreading 70 as an automatic sell is the single most common RSI error.",
        ],
        image: {
          src: "/learn/rsi/01.png",
          caption:
            "RSI anatomy: the 0–100 scale with the 70 (overbought) and 30 (oversold) reference zones marked against the price action that drives them.",
        },
      },
      {
        heading: "Why overbought ≠ sell",
        body: [
          "The strongest stocks in the market get overbought and STAY overbought — powerful uptrends can hold RSI above 70 for weeks while price keeps climbing. Shorting them because of RSI alone is fighting the strongest momentum available.",
          "In fact, an RSI push above 70 on a breakout often confirms unusual strength rather than warning of a top.",
          "The reversal information comes from combinations: overbought PLUS a major resistance zone, PLUS fading volume or a bearish divergence — that stack means something. RSI at 71 on its own means very little.",
        ],
        image: {
          src: "/learn/rsi/02.png",
          caption:
            "A strong uptrend holding RSI above 70 for an extended stretch — every 'overbought, sell it' moment resolved higher. Momentum is not a fault.",
        },
      },
      {
        heading: "Range shift: bull vs bear behaviour",
        body: [
          "RSI does not use the same effective range in all markets. In uptrends it tends to oscillate roughly 40–90, with pullbacks bottoming near 40–50: in downtrends it runs roughly 10–60, with rallies topping near 50–60.",
          "This makes the MIDDLE of the scale more useful than the extremes for trend traders: in a confirmed uptrend, RSI pulling back to ~40 flags a dip being bought — often a better long signal than waiting for a 30 print that never comes.",
          "If a stock that has respected the 40 floor starts breaking to 30 and below, the character of the stock has changed — evidence the uptrend itself is in question.",
        ],
      },
      {
        heading: "Worked example: buying the dip with RSI",
        body: [
          "A stock in a daily uptrend (price above rising MA50/MA200) sells off for a week into its prior breakout zone. RSI drops to 38 — the bottom of its bull range — then hooks back up above 40.",
          "That hook, at known support, in an intact trend, is the entry trigger. Stop below the support zone; target the prior high.",
          "Contrast: the same RSI 38 in a stock BELOW a falling MA200 carries no such meaning — in bear ranges RSI 38 is mid-range, and 'oversold' can stay oversold all the way down.",
        ],
        image: {
          src: "/learn/rsi/03.png",
          caption:
            "The bull-range dip-buy: RSI bottoms near 40 at a support test inside an uptrend and hooks higher — the combination, not the number, is the signal.",
        },
      },
      {
        heading: "Common mistakes",
        body: [
          "Selling purely because RSI crossed 70, or buying purely because it crossed 30.",
          "Using oversold as a floor in a crashing stock — in strong downtrends RSI can pin below 30 while price halves.",
          "Ignoring the range shift between bull and bear phases.",
          "Stacking RSI with Stochastic and MACD and calling agreement 'confirmation' — they are all momentum cousins and largely repeat each other.",
        ],
      },
      {
        heading: "Key takeaways",
        body: [
          "RSI measures the one-sidedness of recent price action on a 0–100 scale.",
          "70/30 are context labels, not signals — strong trends live above 70 (or below 30) for long stretches.",
          "In uptrends watch the ~40 zone as the dip-buy area; in downtrends the ~60 zone caps rallies.",
          "RSI earns its keep in combination with trend and support/resistance — and in divergences (see RSI Divergence).",
        ],
      },
    ],
  },
  {
    slug: "stochastic",
    title: "Stochastic (14, 3)",
    category: "Indicators",
    summary:
      "The stochastic oscillator — where price sits inside its recent range, how %K/%D crosses work, and why this tool belongs in ranges rather than trends.",
    sections: [
      {
        heading: "What it is",
        body: [
          "The stochastic oscillator asks one question: where did price close relative to its full high-low range of the last 14 periods? Closing at the very top of that range reads near 100; at the very bottom, near 0.",
          "It has two lines: %K, the fast raw reading, and %D, a 3-period average of %K that acts as the signal line. Readings above 80 are called overbought, below 20 oversold.",
          "Compared with RSI, stochastic is twitchier — it reaches extremes more easily and more often, which makes it faster but noisier.",
        ],
        image: {
          src: "/learn/stochastic/01.png",
          caption:
            "%K and %D with the 80/20 zones: the oscillator maps where each close sits inside the recent high-low range.",
        },
      },
      {
        heading: "The core signal: crosses at extremes",
        body: [
          "The standard trigger is a %K/%D cross INSIDE an extreme zone: a bullish cross below 20 (price stopped closing at the bottom of its range) or a bearish cross above 80.",
          "Crosses in the middle of the scale carry little information — the edge, such as it is, lives at the extremes.",
          "As always, the oscillator is the timing tool, not the reason for the trade. The reason is the level: a bullish cross at a tested support zone in a range is a setup; the same cross in a free-fall is a falling knife.",
        ],
        image: {
          src: "/learn/stochastic/02.png",
          caption:
            "Range trading with stochastic: bullish %K/%D crosses below 20 near range support, bearish crosses above 80 near range resistance.",
        },
      },
      {
        heading: "Where it breaks: trends",
        body: [
          "In a strong uptrend, price keeps closing near the top of its recent range — which is exactly what stochastic calls 'overbought'. The indicator will scream sell for the entire trend while price doubles.",
          "This is not a malfunction; it is the design. A range-position oscillator applied to a trending market reports 'top of range' forever.",
          "Rule of thumb: stochastic is a RANGE tool. In confirmed trends, either ignore it or use only the signals in the trend's direction (bullish crosses in an uptrend as dip-buy timing).",
        ],
        image: {
          src: "/learn/stochastic/03.png",
          caption:
            "The failure mode: a persistent uptrend pins stochastic above 80 — every bearish cross 'sell signal' is punished as the trend continues.",
        },
      },
      {
        heading: "Worked example",
        body: [
          "A stock has ranged between $30 and $36 for three months (flat MA50 confirms no trend). Price fades to $30.40; stochastic drops to 12, then %K crosses above %D.",
          "Entry on the cross with the range floor as the backstop; stop below $29 (beyond the zone); target the middle of the range first, then $35–36.",
          "The mirror setup applies at the top of the range with a bearish cross above 80 — until the day the range breaks, at which point stochastic hands the chart over to trend tools.",
        ],
      },
      {
        heading: "Common mistakes",
        body: [
          "Shorting a strong uptrend because stochastic is above 80 (the classic trap).",
          "Trading mid-scale crosses that carry no edge.",
          "Using stochastic AND RSI as if they were independent confirmation — they measure closely related things.",
          "Ignoring the market regime: this tool needs a range to be useful.",
        ],
      },
      {
        heading: "Key takeaways",
        body: [
          "Stochastic = position of the close within the recent high-low range, 0–100.",
          "Trade %K/%D crosses at extremes, at levels, in ranges.",
          "In trends the oscillator pins at the extreme and its counter-trend signals are toxic.",
          "Faster and noisier than RSI — better timing, worse standalone reliability.",
        ],
      },
    ],
  },
  {
    slug: "volume",
    title: "Volume",
    category: "Indicators",
    summary:
      "The only indicator that isn't derived from price — how volume confirms breakouts, exposes weak moves, and marks climaxes where trends exhaust themselves.",
    sections: [
      {
        heading: "What it is",
        body: [
          "Volume is the number of shares that changed hands in each period. It is raw participation data — not a formula applied to price, but a second, independent stream of information.",
          "Think of price as the direction of the crowd and volume as the size of the crowd. A move made by heavy participation reflects broad agreement; the same move on thin volume reflects the opinion of very few.",
          "Because most breakouts, breakdowns and reversals are only trustworthy when real money participates, volume is the market's built-in lie detector.",
        ],
        image: {
          src: "/learn/volume/01.png",
          caption:
            "Two breakouts of the same level: the first, on weak volume, fails; the second, on a volume surge, holds and runs. Participation is the difference.",
        },
      },
      {
        heading: "Confirming breakouts",
        body: [
          "The single most practical volume rule: a breakout through meaningful resistance should come with clearly above-average volume — ideally 1.5–2× the recent average or more.",
          "A high-volume breakout means conviction: enough buyers absorbed all the supply sitting at the level. A low-volume breakout means the level was never really tested and is prone to snap back (the false breakout).",
          "The follow-through matters too: healthy moves show expanding volume in the trend direction and lighter volume on pullbacks — accumulation behaviour. The reverse pattern (heavy down days, feeble up days) is distribution.",
        ],
      },
      {
        heading: "Climax volume: exhaustion at the extremes",
        body: [
          "Extreme volume spikes — several times normal — often mark the END of moves rather than the middle. After a long decline, a massive-volume flush that reverses intraday is a capitulation: the last panicked holders selling to bargain hunters.",
          "The mirror image tops out euphoric runs: a parabolic final surge on giant volume as the last buyers pile in, leaving no one left to buy.",
          "Climaxes are identified by the combination: extended trend + volume blow-off + failure to keep moving. Volume alone doesn't call the turn; the stall afterwards does.",
        ],
        image: {
          src: "/learn/volume/02.png",
          caption:
            "Capitulation: a long decline ends in a huge-volume flush and sharp recovery — sellers exhausted, the low is in for now.",
        },
      },
      {
        heading: "Healthy pullbacks are quiet",
        body: [
          "In a strong uptrend, the most bullish thing a pullback can do is happen on shrinking volume. It means the dip is profit-taking and patience, not institutions heading for the exit.",
          "That quiet-pullback pattern — expansion up, contraction down — is the volume signature behind most continuation setups, including the pullback-to-EMA20 and MA200-test entries in other lessons.",
          "A pullback on EXPANDING volume is a different story: someone big is selling into it, and the 'dip' deserves suspicion.",
        ],
        image: {
          src: "/learn/volume/03.png",
          caption:
            "The healthy trend signature: volume expands on the advances and dries up on the pullbacks — buyers committed, sellers reluctant.",
        },
      },
      {
        heading: "Common mistakes",
        body: [
          "Trading breakouts without checking volume, then wondering why they keep failing.",
          "Reading a single big-volume bar in isolation — one print can be an index rebalance or options event; patterns of volume matter more than single bars.",
          "Ignoring relative context: 5 million shares is heavy for one stock and dead quiet for another. Always compare to the stock's own average.",
          "Forgetting that low-volume holiday/summer sessions distort everything for days at a time.",
        ],
      },
      {
        heading: "Key takeaways",
        body: [
          "Volume measures participation — the conviction behind price moves.",
          "Breakout + volume surge = trustworthy; breakout on silence = suspect.",
          "Expanding volume with the trend and quiet pullbacks = healthy accumulation.",
          "Extreme climax volume after long moves marks exhaustion more often than continuation.",
        ],
      },
    ],
  },
  {
    slug: "vwap",
    title: "VWAP",
    category: "Indicators",
    summary:
      "The volume-weighted average price — the intraday fair-value line institutions measure themselves against, and how traders use it for bias, entries and mean reversion.",
    sections: [
      {
        heading: "What it is",
        body: [
          "VWAP is the average price paid per share so far today, weighted by volume. A thousand shares traded at $50 move it a thousand times more than one share at $50.",
          "That makes VWAP the day's running 'fair price' — the benchmark institutions use to grade their own executions (buying below VWAP = better than the average participant).",
          "Standard VWAP resets every session and accumulates through the day, which is why it is an INTRADAY tool: on daily/weekly charts its cousin VWMA or anchored VWAP takes over.",
        ],
        image: {
          src: "/learn/vwap/01.png",
          caption:
            "A session around VWAP: price oscillates about the volume-weighted average — above it buyers are in control of the day, below it sellers are.",
        },
      },
      {
        heading: "The bias line",
        body: [
          "The simplest professional use is directional bias: price holding above a rising VWAP = buyers control the session, favour longs; price pinned below a falling VWAP = sellers control, favour shorts or stand aside.",
          "Because so many execution algorithms work orders around VWAP, the line genuinely attracts orders — touches frequently produce reactions, giving it dynamic support/resistance behaviour intraday.",
          "In strong trend days, pullbacks to VWAP that hold are the classic intraday continuation entry: joining the day's dominant side at the day's fair price.",
        ],
        image: {
          src: "/learn/vwap/02.png",
          caption:
            "The VWAP reclaim: a gap-down session base-builds, reclaims VWAP, and holds it on the retest — control of the day flips from sellers to buyers.",
        },
      },
      {
        heading: "Extension and reversion",
        body: [
          "Price stretched far above or below VWAP is extended relative to the day's fair value. Mean-reversion traders fade extreme extensions back toward the line, especially in stocks without fresh news.",
          "Extension is best judged with bands (standard deviations around VWAP) or simply relative to the day's typical range: a stock 3% above VWAP that normally ranges 1.5% is meaningfully stretched.",
          "Caveat: on real-news days, extension can persist all session. Reversion trades want a stalling, rolling-over extension — not a freight train.",
        ],
        image: {
          src: "/learn/vwap/03.png",
          caption:
            "Extension fading back to the line: sharp moves away from VWAP lose momentum and revert toward the session's fair value.",
        },
      },
      {
        heading: "Worked example",
        body: [
          "A stock gaps down 3% at the open on a broker downgrade. For the first hour it trades below VWAP — sellers own the day; longs are premature.",
          "Mid-morning it reclaims VWAP, pulls back, and holds the line from above with rising volume. Control has flipped; the gap-fill long is now backed by the day's structure.",
          "Entry on the successful retest hold, stop just below the reclaim low under VWAP, target the gap fill. The whole trade is defined by one line and the behaviour around it.",
        ],
      },
      {
        heading: "Common mistakes",
        body: [
          "Using session VWAP on daily/weekly charts (wrong tool — see VWMA/anchored variants).",
          "Fading extension on genuine-news days when price should trend away from VWAP.",
          "Treating a single VWAP touch as a signal with no context of trend or level.",
          "Ignoring the open: VWAP needs some session data to stabilise; the first minutes it is nearly meaningless.",
        ],
      },
      {
        heading: "Key takeaways",
        body: [
          "VWAP = today's volume-weighted fair price and the institutional benchmark.",
          "Above rising VWAP = long bias; below falling VWAP = short bias.",
          "Reclaims and retest-holds of VWAP mark intraday control flips.",
          "Extension from VWAP mean-reverts on quiet days and trends on news days — know which day you're in.",
        ],
      },
    ],
  },

  // ---------------- DIVERGENCIES ----------------
  {
    slug: "rsi-divergence",
    title: "RSI Divergence",
    category: "Divergencies",
    summary:
      "When price and RSI disagree — how bullish and bearish divergences form, why they need confirmation, and how to trade them at levels instead of in mid-air.",
    sections: [
      {
        heading: "What it is",
        body: [
          "Divergence is a disagreement between price and momentum. Bullish divergence: price prints a LOWER low but RSI prints a HIGHER low — the decline made a new price extreme with less force behind it.",
          "Bearish divergence is the mirror: price makes a higher high while RSI makes a lower high — the rally is stretching further on fading thrust.",
          "The metaphor that sticks: a ball thrown upward is still rising even as it decelerates. Divergence is the deceleration — it precedes the turn but is not itself the turn.",
        ],
        image: {
          src: "/learn/rsi-divergence/01.png",
          caption:
            "Bullish RSI divergence: price grinds to a lower low while RSI holds a higher low — the second sell-off had less momentum than the first.",
        },
      },
      {
        heading: "How to spot it properly",
        body: [
          "Compare like with like: swing low to swing low (bullish) or swing high to swing high (bearish), connecting the same two moves on price and on RSI.",
          "The best divergences form at extremes — RSI below ~35 for bullish setups, above ~65 for bearish — and at meaningful support/resistance. A divergence in the middle of nowhere on the chart is trivia.",
          "Divergences on higher timeframes (daily, weekly) carry far more weight than intraday ones, and 'double divergences' (three price extremes, momentum weakening at each) are stronger than single ones.",
        ],
        image: {
          src: "/learn/rsi-divergence/02.png",
          caption:
            "Bearish RSI divergence at resistance: a marginal higher high in price, a clearly lower high in RSI — the rally is running on fumes.",
        },
      },
      {
        heading: "Confirmation: the missing half of every divergence trade",
        body: [
          "Divergence alone is early — famously early. In strong downtrends, bullish divergences can print two or three times while price keeps falling ('divergences can stack').",
          "So the trade needs a price trigger: a break of the short-term down trendline, a reclaim of a key level, a strong reversal candle, or a break above the swing high between the two divergent lows.",
          "The sequence is: divergence (the warning) → price confirmation (the trigger) → entry. Skipping step two turns a good tool into knife-catching.",
        ],
        image: {
          src: "/learn/rsi-divergence/03.png",
          caption:
            "Divergence plus trigger: the bullish divergence sets the alert; the entry only fires when price breaks the interim swing high, confirming buyers have actually taken over.",
        },
      },
      {
        heading: "Worked example",
        body: [
          "A stock falls from $80 to $62, bounces to $68, then slides to a marginal new low at $61 — right on top of a major weekly support zone. RSI: first low 24, second low 33. Bullish divergence at support.",
          "The trigger: price breaks back above the $68 interim high. Entry there; stop below $61 (under both the low and the zone); first target the next resistance near $74.",
          "Note everything stacked in the trade's favour: weekly support (location), divergence (momentum), structure break (confirmation). That stack — not the divergence alone — is the edge.",
        ],
      },
      {
        heading: "Common mistakes",
        body: [
          "Buying the divergence immediately with no price confirmation.",
          "Trading divergences against roaring trends with no support/resistance backing.",
          "Comparing mismatched swings (a high on price against a low on RSI, or skipping swings).",
          "Ignoring stacked divergences: one more divergence failing is exactly how strong trends behave.",
          "Using tiny-timeframe divergences to fight a daily trend.",
        ],
      },
      {
        heading: "Key takeaways",
        body: [
          "Divergence = new price extreme on fading momentum; it warns, it does not time.",
          "Quality checklist: at an RSI extreme, at a real level, on a meaningful timeframe.",
          "Always demand price confirmation — a structure break or level reclaim — before entering.",
          "Expect failures in strong trends; the stop, placed beyond the divergent extreme, is non-negotiable.",
        ],
      },
    ],
  },
  {
    slug: "macd-divergence",
    title: "MACD Divergence",
    category: "Divergencies",
    summary:
      "Momentum disagreement read through MACD — histogram vs. line divergences, how they differ from RSI's version, and the confirmation sequence that makes them tradeable.",
    sections: [
      {
        heading: "What it is",
        body: [
          "MACD divergence is the same core idea as RSI divergence — price makes a new extreme, momentum does not — read through MACD's lines and histogram instead of an oscillator scale.",
          "Bullish: price prints a lower low while the MACD line (or its histogram trough) prints a higher low. Bearish: price prints a higher high while MACD peaks lower.",
          "Because MACD is built from trend-following EMAs, its divergences tend to fire on slower, larger swings than RSI's — fewer signals, each covering more meaningful moves.",
        ],
        image: {
          src: "/learn/macd-divergence/01.png",
          caption:
            "Bullish MACD divergence: the second price low undercuts the first, but both the MACD line and histogram bottom out visibly higher.",
        },
      },
      {
        heading: "Histogram vs. line divergence",
        body: [
          "The histogram diverges EARLIEST — it measures acceleration, so its peaks shrink before the MACD line itself rolls over. Early also means noisier.",
          "MACD-line divergence confirms later but more reliably: the smoothed momentum of the whole swing genuinely failed to match the price extreme.",
          "A practical combination: let a histogram divergence put you on alert, and treat a matching MACD-line divergence plus a signal-line cross as the maturing setup.",
        ],
        image: {
          src: "/learn/macd-divergence/02.png",
          caption:
            "Bearish divergence maturing in stages: shrinking histogram peaks first, then a lower MACD-line high against price's higher high.",
        },
      },
      {
        heading: "Trading it: location plus trigger",
        body: [
          "As with all divergences, location is most of the edge: a bullish MACD divergence into a major support zone or a rising MA200 is a setup; the same pattern mid-air in a downtrend is a statistic.",
          "The trigger sequence: divergence identified → MACD bullish signal-line cross → price confirmation (structure break or level reclaim). Conservative traders also wait for the MACD line to be rising toward zero.",
          "Stops go beyond the divergent price extreme. If price takes out that low, the divergence thesis is simply wrong — momentum reset, new lows likely.",
        ],
        image: {
          src: "/learn/macd-divergence/03.png",
          caption:
            "The full sequence at support: divergence at a tested zone, bullish cross, then the price structure break that finally justifies the entry.",
        },
      },
      {
        heading: "Worked example",
        body: [
          "A stock in a three-month decline hits $45, bounces, then makes a final low at $43.50 right at its 200-day moving average. MACD histogram troughs shallower, and the MACD line bottoms higher than at the $45 low.",
          "MACD prints a bullish signal-line cross; two sessions later price breaks the little lower-high trendline of the decline at $47.",
          "Entry ~$47, stop below $43 (beyond the divergent low and the MA200 zone), targets at $52 then the origin of the last breakdown near $56. Divergence supplied the warning; the cross and the structure break supplied the trade.",
        ],
      },
      {
        heading: "Common mistakes",
        body: [
          "Front-running the divergence before any cross or price confirmation.",
          "Reading normal histogram mean-reversion wiggles as divergence — compare swing extremes, not every bar.",
          "Ignoring the zero-line context: a bullish divergence with MACD miles below zero is fighting a powerful downtrend.",
          "Treating RSI and MACD divergence as two independent confirmations — they usually appear together because they measure related things.",
        ],
      },
      {
        heading: "Key takeaways",
        body: [
          "MACD divergence = price extreme unmatched by MACD line/histogram — slower and more selective than RSI's version.",
          "Histogram warns first, MACD line confirms, the signal-line cross triggers.",
          "Location (support/resistance, MA zones) supplies most of the edge; confirmation supplies the timing.",
          "Beyond the divergent extreme lies the stop — a broken divergence is a failed thesis, not a reason to average down.",
        ],
      },
    ],
  },
];

export function lessonsByCategory(cat: Lesson["category"]) {
  return LESSONS.filter((l) => l.category === cat);
}

export function getLesson(slug: string) {
  const s = String(slug || "")
    .trim()
    .toLowerCase();

  return LESSONS.find((l) => l.slug.toLowerCase() === s) ?? null;
}

export function getNextLesson(slug: string) {
  const idx = LESSONS.findIndex(
    (l) => l.slug.toLowerCase() === String(slug || "").trim().toLowerCase()
  );
  if (idx === -1) return null;
  return LESSONS[idx + 1] ?? null;
}
