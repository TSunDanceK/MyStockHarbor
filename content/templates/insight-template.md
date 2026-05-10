


Uploaded image

MyStockHarbor-main (7).zip
Zip Archive
https://www.mystockharbor.com/insights
On my YouTube panel. on the right, i would like to increase the number of displayed videos to 7 please, 
Keeping only the latest on as playable on site 



insights.txt
Document
like this? 

Thought for 6s
Almost — the structure is right, but you have one important CSS mistake.

You successfully added the new sidebar fields to InsightPostData and fallback text for overallBreakdown, latestNews, latestEarnings, and investorUsefulInfo. You also added the article/aside layout correctly. 

 


But this part is wrong:

@media (min-width: 901px) {
  .insightArticleLayout {
    grid-template-columns: 1fr !important;
  }

  .insightSidebar {
    position: static !important;
  }
}
That makes desktop become one column, which is the opposite of what you want. The uploaded file shows that rule inside the desktop media query. 


REMOVE THIS from inside @media (min-width: 901px):

            .insightArticleLayout {
            grid-template-columns: 1fr !important;
          }

          .insightSidebar {
            position: static !important;
          }
ADD THIS inside @media (max-width: 900px) instead:

          .insightArticleLayout {
            grid-template-columns: 1fr !important;
          }

          .insightSidebar {
            position: static !important;
          }
Also tidy this indentation:

REMOVE THIS:

          .insightArticleLayout {
          margin-top: 18px;
          display: grid;
          grid-template-columns: minmax(0, 1fr) 340px;
          gap: 18px;
          align-items: start;
        }
REPLACE WITH:

        .insightArticleLayout {
          margin-top: 18px;
          display: grid;
          grid-template-columns: minmax(0, 1fr) 340px;
          gap: 18px;
          align-items: start;
        }
After that, yes — desktop will show:

Left: main insight article
Right: quick breakdown, latest news, earnings context, investor info, and next-step links

Mobile will stack cleanly into one column.


07:32:02.142 Running build in Washington, D.C., USA (East) – iad1
07:32:02.142 Build machine configuration: 2 cores, 8 GB
07:32:02.260 Cloning github.com/TSunDanceK/MyStockHarbor (Branch: main, Commit: 55f9d70)
07:32:03.310 Cloning completed: 1.050s
07:32:03.619 Restored build cache from previous deployment (26na9bSBhuiER2RJpX2x2KQMggxS)
07:32:03.834 Running "vercel build"
07:32:04.760 Vercel CLI 53.3.1
07:32:05.053 Installing dependencies...
07:32:08.572 
07:32:08.572 up to date in 3s
07:32:08.573 
07:32:08.573 203 packages are looking for funding
07:32:08.573   run npm fund for details
07:32:08.604 Detected Next.js version: 16.1.6
07:32:08.609 Running "npm run build"
07:32:08.715 
07:32:08.716 > nextjs@0.1.0 build
07:32:08.716 > next build
07:32:08.716 
07:32:09.803 ▲ Next.js 16.1.6 (Turbopack)
07:32:09.804 
07:32:09.855   Creating an optimized production build ...
07:32:25.135 
07:32:25.136 > Build error occurred
07:32:25.140 Error: Turbopack build failed with 1 errors:
07:32:25.140 ./lib/blog.ts:156:1
07:32:25.140 Parsing ecmascript source code failed
07:32:25.140   154 | }
07:32:25.140   155 |
07:32:25.141 > 156 | export function getPostBySlug(slug: string): BlogPostFull {
07:32:25.141       | ^^^^^^
07:32:25.141   157 |   const fullPath = path.join(postsDirectory, ${slug}.md);
07:32:25.141   158 |   const fileContents = fs.readFileSync(fullPath, "utf8");
07:32:25.141   159 |
07:32:25.142 
07:32:25.142 Expected ',', got 'export'
07:32:25.142 
07:32:25.142 Import traces:
07:32:25.142   Server Component:
07:32:25.142     ./lib/blog.ts
07:32:25.143     ./app/insights/page.tsx
07:32:25.143 
07:32:25.144   App Route:
07:32:25.144     ./lib/blog.ts
07:32:25.144     ./app/sitemap.ts
07:32:25.144     ./app/sitemap--route-entry.js
07:32:25.145 
07:32:25.145 
07:32:25.145     at <unknown> (./lib/blog.ts:156:1)
07:32:25.215 Error: Command "npm run build" exited with 1

Thought for 10s
The build error means lib/blog.ts has a syntax break before getPostBySlug. Most likely the getAllPosts() return object was edited without closing the object/map properly.

Replace the full lib/blog.ts file with this clean version.

REMOVE THIS: your entire lib/blog.ts

ADD THIS:

import fs from "fs";
import path from "path";
import matter from "gray-matter";

const postsDirectory = path.join(process.cwd(), "content/insights");

export type InsightChartIndicator =
  | "MA50"
  | "MA200"
  | "EMA20"
  | "VWMA(20)"
  | "Bollinger(20,2)"
  | "RSI(14)"
  | "MACD(12,26,9)"
  | "Stochastic(14,3)"
  | "ATR(14)"
  | "Volume";

export type BlogPost = {
  slug: string;
  title: string;
  date: string;
  excerpt: string;
  symbol?: string | null;
  timeframe: "d" | "w";
  chartBars: number | null;
  chartIndicators: InsightChartIndicator[];
  overallBreakdown: string;
  latestNews: string;
  latestEarnings: string;
  investorUsefulInfo: string;
};

export type InsightSnapshotPoint = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

export type InsightSnapshot = {
  symbol: string;
  companyName?: string;
  snapshotDate?: string;
  snapshotTime?: string;
  price?: number | null;
  trend?: string;
  lastMA50?: number | null;
  lastMA200?: number | null;
  lastWeeklyMA200?: number | null;
  ma50Pct?: number | null;
  ma200Pct?: number | null;
  weeklyMA200Pct?: number | null;
  chartPoints: InsightSnapshotPoint[];
};

export type BlogPostFull = {
  slug: string;
  title: string;
  date: string;
  excerpt: string;
  symbol?: string | null;
  timeframe: "d" | "w";
  chartBars: number | null;
  chartIndicators: InsightChartIndicator[];
  overallBreakdown: string;
  latestNews: string;
  latestEarnings: string;
  investorUsefulInfo: string;
  content: string;
};

function formatFrontmatterDate(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().split("T")[0];
  }

  if (typeof value === "string") {
    return value;
  }

  return "";
}

function normalizeFrontmatterText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeChartBars(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.floor(value);
  if (rounded < 20) return 20;
  if (rounded > 400) return 400;
  return rounded;
}

function normalizeChartIndicators(value: unknown): InsightChartIndicator[] {
  const allowed = new Set<InsightChartIndicator>([
    "MA50",
    "MA200",
    "EMA20",
    "VWMA(20)",
    "Bollinger(20,2)",
    "RSI(14)",
    "MACD(12,26,9)",
    "Stochastic(14,3)",
    "ATR(14)",
    "Volume",
  ]);

  if (!Array.isArray(value)) return [];

  return value
    .map((item) => String(item).trim())
    .filter((item): item is InsightChartIndicator =>
      allowed.has(item as InsightChartIndicator)
    );
}

export function getAllPosts(): BlogPost[] {
  if (!fs.existsSync(postsDirectory)) return [];

  const fileNames = fs
    .readdirSync(postsDirectory)
    .filter((fileName) => fileName.endsWith(".md"));

  const posts = fileNames.map((fileName) => {
    const slug = fileName.replace(/\.md$/, "");
    const fullPath = path.join(postsDirectory, fileName);
    const fileContents = fs.readFileSync(fullPath, "utf8");

    const { data } = matter(fileContents);

    return {
      slug,
      title: String(data.title || ""),
      date: formatFrontmatterDate(data.date),
      excerpt: String(data.excerpt || ""),
      symbol: data.symbol ? String(data.symbol) : null,
      timeframe: (data.timeframe === "w" ? "w" : "d") as "d" | "w",
      chartBars: normalizeChartBars(data.chartBars),
      chartIndicators: normalizeChartIndicators(data.chartIndicators),
      overallBreakdown: normalizeFrontmatterText(data.overallBreakdown),
      latestNews: normalizeFrontmatterText(data.latestNews),
      latestEarnings: normalizeFrontmatterText(data.latestEarnings),
      investorUsefulInfo: normalizeFrontmatterText(data.investorUsefulInfo),
    };
  });

  return posts.sort((a, b) => {
    if (a.date === b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? 1 : -1;
  });
}

export function getPostBySlug(slug: string): BlogPostFull {
  const fullPath = path.join(postsDirectory, `${slug}.md`);
  const fileContents = fs.readFileSync(fullPath, "utf8");

  const { data, content } = matter(fileContents);

  return {
    slug,
    title: String(data.title || ""),
    date: formatFrontmatterDate(data.date),
    excerpt: String(data.excerpt || ""),
    symbol: data.symbol ? String(data.symbol) : null,
    timeframe: (data.timeframe === "w" ? "w" : "d") as "d" | "w",
    chartBars: normalizeChartBars(data.chartBars),
    chartIndicators: normalizeChartIndicators(data.chartIndicators),
    overallBreakdown: normalizeFrontmatterText(data.overallBreakdown),
    latestNews: normalizeFrontmatterText(data.latestNews),
    latestEarnings: normalizeFrontmatterText(data.latestEarnings),
    investorUsefulInfo: normalizeFrontmatterText(data.investorUsefulInfo),
    content,
  };
}
Then rebuild. This should clear the Expected ',', got 'export' error.


OK shall we upgrade the template. to allow these changes. 

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
- - Where relevant, include one contextual internal link to the most relevant live setup page:
  - /oversold-stocks-today
  - /overbought-stocks-today
  - /all-time-high-breakout-stocks
  - /3-month-high-breakout-stocks
  - /best-trend-score-stocks
  - /top-stocks-with-buy-signals
  - /top-stocks-with-sell-signals
  - /bullish-bearish-divergence-stocks
  - /stocks-near-200-day-moving-average
  - /hot-market-names-right-now
  - /stocks-down-20-from-all-time-highs
- If none clearly fits, link to /pickers instead.

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
- - If there is a strong setup match, include one natural internal link to the most relevant live setup page.

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

Yes — upgrade it to this version so every new insight supports the right-hand summary panel.

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
    - /hot-market-names-right-now
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
- Include ticker where possible
- Focus on ONE clear idea: support, resistance, breakout, breakdown, pullback, divergence, trend test, or reversal

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

