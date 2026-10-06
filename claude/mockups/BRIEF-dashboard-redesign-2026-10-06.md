# Brief: dashboard redesign (6 Oct 2026)

**Owner decision (6 Oct):** approved Cowork's mock-up `dashboard-concept.html` (a Cowork output). The stock analyser stays fully usable but **moves below the fold**; the page leads with what makes the site different. **Build to a preview only. The owner reviews the preview himself; no merge until he types GO.**

**Builder:** Relay C (assigned by Cowork, #563 COWORK #134), because B's queue is full. The `/dashboard` files are B's, so B hands them off for this PR and makes no dashboard edits meanwhile (#553 COWORK #183). B's news fetch-deadline work (#798) is a dependency: rebase on it.

## Layout (top to bottom)
1. **Hero (left):**
   - the H1 "Stock research from the filings, not the hype.";
   - a lead paragraph;
   - a large ticker search (the existing search, its routing unchanged) with "Try:" chips (NVDA, TSLA, JPM, AMZN, "Scan for ideas →");
   - three points that set the site apart: **As filed**, **Who depends on who** (with the live count of mapped stocks), and **Explained, not advised**.
2. **Market right now (right):**
   - the Market Mood thermometer, reading and 90-session line (the existing component);
   - three mini tiles: S&P 500 close and distance from the record; the Trend score; the best sector YTD. Each links to its page.
3. **The live feed strip** (the existing ticker strip).
4. **"Only on MyStockHarbor today":** a card grid of live data, each card linking to its section.
   - **Bottlenecks:** a mini web of the top 3 hubs, plus a top-3 list with counts (from `getBottleneckHub`).
   - **Follow the money:** the top 3 capex spenders, an arrow, then the top 3 receivers (`buildTopReceivers`), with the fine line.
   - **Pickers:** 5 screens with today's counts (the most populated, or a fixed set), "none today" when zero, and the universe size.
   - **Earnings:** the next 3 week windows, each with a count and its top tickers (A's forward sections), with the ESTIMATED tag and the "from SEC reporting patterns" line.
   - **Sectors YTD:** 8 muted tiles (the same muted scale as B's #180 map).
   - **Insight of the day:** the newest post, with its image and the "since published" result (once C's insight rebuild is in).
   - **News, scored and explained:** the top 3 scored headlines, with their ticker chips.
5. **"{TICKER} at a glance":** the current analyser, kept.
   - A plain-English verdict line at the top, from the existing Chart Summary data.
   - The signal chips, next report (estimated), and a Bottlenecks link when a page exists.
   - The chart with the existing Basic / Interactive / TradingView modes and D/W/M switch, plus tabs for Chart / Key levels / Price zones / Filed earnings / News.
   - **No analyser feature is removed.** The `?symbol=` deep links still land on and scroll to this panel.

## Rules
- **Every number comes from an existing engine or store.** No new data sources, and no extra per-render reads beyond what those components already cost. Post the command count per render, before and after.
- Server-rendered where the parts already are; the cards are cached with their sources' existing windows.
- Tiingo credit on every price-derived card; "Filings from SEC EDGAR" on the filed ones.
- Hedged copy with no buy, sell or should; reading-size tokens; no emoji in headings.
- **Mobile (≤ 560 px):** the hero, then Market right now, then the cards in one column, then the analyser. No sideways scroll.
- **SEO:** keep the title and meta; add a clear H1. The analyser's `?symbol=` pages keep their own titles.

## Checks
- Each card renders an empty state when its source is missing (and the page never fails because of it).
- Measures at 1280, 1024, 768 and 390.
- The `?symbol=TSLA` deep link scrolls to the analyser.
- A mutant per card's empty state.

## Review
Cowork previews it first, then **the owner reviews the preview himself.** Merge only on the owner's GO.
