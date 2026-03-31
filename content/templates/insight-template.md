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
- Prioritise insight over description (tell me something useful, not just what is visible)
- If referencing news or catalysts, only include widely known or clearly stated information
- If no clear news is provided, explicitly state that the move is not news-driven
- Do NOT invent or assume specific news events
- WRITING STANDARD (CRITICAL):

Write like a professional trader explaining a setup to another trader.

- Be clear, direct, and confident
- Focus on insight, not description
- Explain what is likely happening behind the price (positioning, sentiment, behaviour)
- Avoid generic phrases like “price is moving lower” without context
- Every section should add value, not repeat information
- Keep sentences tight and purposeful

The output should feel like:
- a trading desk note
- a high-quality market insight
- not a beginner explanation or generic blog post
- Avoid repeating the same idea across sections; each section must provide new information

---

FRONTMATTER FORMAT (REQUIRED):

---
Title MUST be under 60 characters
- Include ticker where possible
- Focus on ONE clear idea (support, resistance, breakout, divergence)
date: "YYYY-MM-DD"
excerpt: "SHORT ONE SENTENCE SUMMARY."
symbol: "TICKER"
timeframe: "d"
chartBars: 250
chartIndicators: ["MACD(12,26,9)"]
---

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

Correct (multiple):
chartIndicators: ["RSI(14)", "MACD(12,26,9)", "Volume"]

Incorrect (WILL BREAK SYSTEM):
chartIndicators: MACD(12,26,9)
MACD(12,26,9): true

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

- Write clearly and simply (trader-focused tone)
- No fluff or generic filler
- Focus on what traders need to know, not just what the chart shows
- Explain structure, trend, momentum, and positioning
- Mention indicators ONLY if included in chartIndicators
- Keep it concise but insightful

### Context Requirements (CRITICAL)

- Briefly explain what the company does IF relevant (1 sentence max)
- State whether there is any recent news or catalyst:
  - If YES → include it briefly
  - If NO → explicitly state that the move is not news-driven
- Explain whether the move is driven by:
  - technicals
  - positioning
  - macro / sector pressure
- Connect the chart setup to the broader market or sector where relevant

---

Levels to watch MUST use:

- Support:
- Resistance:
- Moving averages:
- Risk point:

---

Bull vs bear MUST use:

**Bullish scenario:**  

**Bearish scenario:**  

---

SECTION GUIDANCE (HOW TO WRITE EACH PART):

## What happened
- Describe the current setup clearly
- Include structure (trend change, breakdown, range, etc.)
- Mention any key signals (divergence, rejection, breakout)

## Why it matters
- Explain WHY this setup is important (not just what happened)
- Include:
  - company context (what it does, briefly)
  - whether news is driving the move or not
  - what traders are likely doing
- This is the MOST important section for depth

## Levels to watch
- Keep clean and precise
- Use only key actionable levels

## What would confirm the idea
- Explain what price needs to do next
- Focus on confirmation of structure or momentum shift

## What would weaken the idea
- Define invalidation clearly
- Show what breaks the setup

## Bull vs bear scenarios
- Show both sides clearly
- Reflect real market uncertainty

## Bottom line
- Summarise the trade idea in 1–2 strong sentences
- Focus on decision point (not recap)

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
