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
- Reference structure, trend, momentum, and levels
- Mention indicators ONLY if included in chartIndicators
- Keep it concise but insightful

Levels to watch MUST use:

- Support:
- Resistance:
- Moving averages:
- Risk point:

Bull vs bear MUST use:

**Bullish scenario:**  

**Bearish scenario:**  

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
