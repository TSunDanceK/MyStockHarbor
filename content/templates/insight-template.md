# MyStockHarbor Insight Template (STRICT SINGLE FORMAT)

This template MUST be followed exactly. Output must be a SINGLE markdown file only.

---

RULES:

- Do NOT output explanations
- Do NOT add extra sections
- Do NOT change section order
- Do NOT add extra frontmatter fields
- chartIndicators MUST always be an array
- Use ONLY allowed indicator names EXACTLY
- timeframe MUST be "d" or "w"
- chartBars MUST be between 20 and 400
- Keep structure clean and readable
- Prioritise insight over description
- Include latest relevant news only when it is widely known, clearly stated, or provided by the user
- Include latest earnings context only when it is widely known, clearly stated, or provided by the user
- Do NOT invent or assume specific news events, earnings results, guidance changes, analyst calls, product launches, lawsuits, or takeover rumours
- If no clear news is provided, explicitly state that the move is not news-driven
- If no clear earnings catalyst is provided, explicitly state that earnings are not the main driver
- Sidebar frontmatter fields must be useful, concise, and investor-focused
- WRITING STANDARD (CRITICAL):
  - Where relevant, include one contextual internal link to the most relevant live setup page:
    - /oversold-stocks-today
    - /overbought-stocks-today
    - /all-time-high-breakout-stocks
    - /3-month-high-breakout-stocks
    - /best-trend-score-stocks
    - /top-stocks-with-buy-signals
    - /top-stocks-with-sell-signals
    - /bullish-bearish-divergence-stocks
    - /stocks-near-200-day-moving-average
    - /stocks-down-20-from-all-time-highs
  - If none clearly fits, link to /pickers instead.

Write like a professional trader explaining a setup to another trader.

- Be clear, direct, and confident
- Focus on insight, not description
- Explain what is likely happening behind the price: positioning, sentiment, behaviour, sector pressure, or macro pressure
- Avoid generic phrases like “price is moving lower” without context
- Every section should add value, not repeat information
- Keep sentences tight and purposeful

The output should feel like:

- a trading desk note
- a high-quality market insight
- not a beginner explanation or generic blog post
- not a news article
- not a long company profile

Avoid repeating the same idea across sections; each section must provide new information.

---

FRONTMATTER FORMAT (REQUIRED):

---
title: "TITLE HERE"
date: "YYYY-MM-DD"
excerpt: "SHORT ONE SENTENCE SUMMARY."
symbol: "TICKER"
timeframe: "d"
chartBars: 250
chartIndicators: ["MACD(12,26,9)"]
overallBreakdown: "ONE SENTENCE EXPLAINING THE SETUP IN PLAIN TRADER LANGUAGE."
latestNews: "STATE THE MOST RELEVANT RECENT NEWS OR SAY THIS MOVE IS NOT NEWS-DRIVEN."
latestEarnings: "SUMMARISE THE LATEST EARNINGS CONTEXT OR SAY EARNINGS ARE NOT THE MAIN DRIVER."
investorUsefulInfo: "ONE SENTENCE ON WHAT INVESTORS SHOULD ACTUALLY WATCH NEXT."
---

---

FRONTMATTER RULES:

title:
- MUST be under 60 characters
- SHOULD include ticker near the start
- SHOULD include the full company name when it fits naturally under 60 characters
- SHOULD include "stock" when natural for SEO
- MUST focus on ONE clear setup idea: support, resistance, breakout, breakdown, bounce, pullback, divergence, trend test, MA200/200-MA test, or reversal
- Use trader-search language without sounding clickbait
- If the full company name makes the title too long, use the ticker plus the cleanest searchable setup phrase instead
Good SEO title examples:
- "Coinbase COIN Stock Holds 200-MA Support"
- "GE Vernova GEV Stock Tests Trend Support"
- "Nvidia NVDA Stock Pullback Tests Support"
- "Tesla TSLA Stock Faces Breakout Resistance"
- "Palantir PLTR Stock Reclaims Momentum"


excerpt:
- One short sentence
- Explain the main setup, not just the chart appearance

overallBreakdown:
- One sentence only
- Plain trader language
- Summarise the decision point

latestNews:
- One sentence only
- Include only relevant, reliable, recent news if known
- If no clear catalyst is provided, write: "No clear recent news catalyst is driving the move; the setup appears mainly technical."

latestEarnings:
- One sentence only
- Summarise the latest earnings context if known
- If earnings are not clearly relevant, write: "Earnings are not the main driver of this setup; traders are focused more on price structure and positioning."

investorUsefulInfo:
- One sentence only
- Must tell investors what to monitor next
- Focus on risk, expectations, valuation pressure, trend durability, or confirmation

---

ALLOWED INDICATORS (EXACT SPELLING ONLY):

MA50  
MA200  
EMA20  
VWMA(20)  
Bollinger(20,2)  
RSI(14)  
MACD(12,26,9)  
Stochastic(14,3)  
ATR(14)  
Volume  

---

INDICATOR RULES:

Correct:
chartIndicators: ["MACD(12,26,9)"]

Correct multiple:
chartIndicators: ["RSI(14)", "MACD(12,26,9)", "Volume"]

Incorrect:
chartIndicators: MACD(12,26,9)
MACD(12,26,9): true

Mention indicators ONLY if included in chartIndicators.

---

CONTENT STRUCTURE (MANDATORY ORDER):

## What happened

## Why it matters

## Levels to watch

## What would confirm the idea

## What would weaken the idea

## Bull vs bear scenarios

## Bottom line

---

CONTENT RULES:

- Write clearly and simply
- Keep a trader-focused tone
- No fluff
- No generic filler
- Focus on what traders and investors need to know
- Explain structure, trend, momentum, sentiment, positioning, and risk
- Mention indicators ONLY if included in chartIndicators
- Keep it concise but insightful
- Do not duplicate the sidebar frontmatter word-for-word inside the article
- The article can expand on the sidebar ideas, but each section must add something new

---

CONTEXT REQUIREMENTS (CRITICAL):

- Briefly explain what the company does IF relevant, 1 sentence max
- State whether there is any recent news or catalyst:
  - If YES, include it briefly
  - If NO, explicitly state that the move is not news-driven
- State whether earnings are relevant:
  - If YES, include the latest earnings context briefly
  - If NO, explicitly state that earnings are not the main driver
- Explain whether the move is driven by:
  - technicals
  - positioning
  - macro pressure
  - sector pressure
  - sentiment
  - earnings
  - news/catalyst
- Connect the chart setup to the broader market or sector where relevant
- Do not invent catalysts, numbers, dates, earnings details, guidance changes, analyst views, or company events

---

Levels to watch MUST use this exact format:

- Support:
- Resistance:
- Moving averages:
- Risk point:

---

Bull vs bear MUST use this exact format:

**Bullish scenario:**  

**Bearish scenario:**  

---

SECTION GUIDANCE:

## What happened

- Describe the current setup clearly
- Include structure: trend change, breakdown, range, pullback, support test, resistance test, breakout, or divergence
- Mention any key signals only if they are relevant
- Do not over-explain the chart

## Why it matters

- Explain WHY this setup is important
- Include:
  - brief company context if relevant
  - whether news is driving the move
  - whether earnings are driving the move
  - what traders are likely doing
  - whether this is technical, positioning-led, sector-led, macro-led, or catalyst-led
- This is the most important section for depth
- If there is a strong setup match, include one natural internal link to the most relevant live setup page

## Levels to watch

- Keep clean and precise
- Use only key actionable levels
- Do not overload with too many prices
- Risk point must clearly define what damages or invalidates the setup

## What would confirm the idea

- Explain what price needs to do next
- Focus on confirmation of structure, momentum, demand, or supply absorption
- Confirmation should be practical and observable

## What would weaken the idea

- Define invalidation clearly
- Explain what would show the setup is failing
- Include behaviour, not just price

## Bull vs bear scenarios

- Show both sides clearly
- Reflect real market uncertainty
- Avoid exaggerated outcomes
- Tie each scenario to levels and behaviour

## Bottom line

- Summarise the trade idea in 1–2 strong sentences
- Focus on the decision point
- Do not simply recap every section

---

FINAL OUTPUT TEMPLATE:

---
title: "TITLE HERE"
date: "YYYY-MM-DD"
excerpt: "SHORT SUMMARY HERE."
symbol: "TICKER"
timeframe: "d"
chartBars: 250
chartIndicators: ["MACD(12,26,9)"]
overallBreakdown: "ONE SENTENCE EXPLAINING THE SETUP IN PLAIN TRADER LANGUAGE."
latestNews: "STATE THE MOST RELEVANT RECENT NEWS OR SAY THIS MOVE IS NOT NEWS-DRIVEN."
latestEarnings: "SUMMARISE THE LATEST EARNINGS CONTEXT OR SAY EARNINGS ARE NOT THE MAIN DRIVER."
investorUsefulInfo: "ONE SENTENCE ON WHAT INVESTORS SHOULD ACTUALLY WATCH NEXT."
---

## What happened

Write the setup clearly.

## Why it matters

Explain why this setup is important.

## Levels to watch

- Support:
- Resistance:
- Moving averages:
- Risk point:

## What would confirm the idea

Explain confirmation signals.

## What would weaken the idea

Explain invalidation signals.

## Bull vs bear scenarios

**Bullish scenario:**  

**Bearish scenario:**  

## Bottom line

Summarise the setup clearly.
