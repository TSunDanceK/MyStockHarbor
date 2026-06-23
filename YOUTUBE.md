# MyStockHarbor — YouTube Video Content Workflow (YOUTUBE.md)

This file governs how to generate the written content that lives alongside each YouTube video
at `/insights/videos/[youtubeId]`. Read this before generating any video content file.

---

## What this is

Each YouTube video on MyStockHarbor has a dedicated web page that shows:
- The YouTube embed
- A live stock data strip (price, market cap, MA50/MA200, P/E, trend — auto-fetched from FMP)
- A stats strip of key figures from the video (manual, from frontmatter)
- Written analysis (from the markdown body)
- Investor datasheet image (from frontmatter, when available)

The written content lives in `content/videos/[youtubeId].md`.
The YouTube video ID is the 11-character string in the YouTube URL:
`https://www.youtube.com/watch?v=XXXXXXXXXXX` → file is `content/videos/XXXXXXXXXXX.md`

---

## Repo

- Owner: `TSunDanceK`
- Repo: `MyStockHarbor`
- Default branch: `main`
- Video content files live in: `content/videos/`
- Template: this file (YOUTUBE.md)
- Datasheet images live in: `public/images/datasheets/`

---

## How to trigger this workflow

Say:
> Generate the YouTube video content file for MyStockHarbor
> YouTube ID: [youtubeId]
> Ticker: [TICKER] (optional — if you know it)

Or to process a batch of videos:
> Generate video content files for all MyStockHarbor videos without a content file yet

Claude will:
1. Look up the video via the YouTube API (title, date) if not provided
2. Research the ticker/topic via web search
3. Generate the markdown file
4. Commit directly to `main` (video content files do not need PR review)
5. Report the file path and YouTube video ID

---

## Output file format

Every video content file MUST follow this exact structure:

```
---
ticker: TICKER
datasheetImage: /images/datasheets/[ticker]-[month]-[year].png
statLabel1: [label]
statValue1: [value]
statLabel2: [label]
statValue2: [value]
statLabel3: [label]
statValue3: [value]
statLabel4: [label]
statValue4: [value]
---

[written analysis body]
```

### Frontmatter fields

**ticker** (required)
- The stock ticker the video is primarily about
- Uppercase, no $ prefix: `AVAV` not `$AVAV`
- If the video covers multiple stocks with no single primary, use the most prominent one
- If the video is truly non-ticker (e.g. a pure macro overview), omit the ticker field entirely

**datasheetImage** (optional — add when the datasheet image exists in the repo)
- Path format: `/images/datasheets/[ticker-lowercase]-[month]-[year].png`
- Example: `/images/datasheets/avav-june-2026.png`
- Leave blank or omit if no datasheet has been generated yet
- DO NOT invent a path — only include this if the image actually exists in `public/images/datasheets/`

**statLabel1–4 / statValue1–4** (required — fill all 4 pairs)
- These populate the stats strip shown ABOVE the video embed
- Pick the 4 most investor-relevant figures from the video's research
- Market cap always goes in slot 1 (it's live from FMP, but including it here too ensures
  the strip still looks right if FMP is slow)
- Slots 2–4: pick from revenue, earnings, backlog, guidance, debt, cash, P/E, EPS,
  subscribers, units, ARR, or whatever is most relevant to the story
- Values must be concise: `$8.71B` not `$8,710,000,000`
- Labels must be short: `Q3 revenue` not `Q3 FY2026 quarterly revenue figure`
- Use the figures that were current AT THE TIME OF THE VIDEO — these are frozen stats,
  not live data. They reflect the story the video tells.

Example stats for a defense company video:
```
statLabel1: Market cap
statValue1: $8.71B
statLabel2: Q3 revenue
statValue2: $408M
statLabel3: Backlog
statValue3: $1.1B
statLabel4: FY26 guide
statValue4: $1.85–1.95B
```

Example stats for a SaaS company video:
```
statLabel1: Market cap
statValue1: $24B
statLabel2: ARR
statValue2: $3.2B
statLabel3: YoY growth
statValue3: +24%
statLabel4: NRR
statValue4: 118%
```

---

## Written analysis body

The body is written prose that accompanies the video. It is NOT a transcript.
It is a companion piece — someone reading it should understand the investment thesis
without watching the video, but watching the video first should make it richer.

### Tone and style
- Professional, direct, trader-focused — same voice as the insight posts
- No fluff, no generic phrases
- Write like a trading desk note, not a blog post
- Explain what is happening, why it matters, and what to watch

### Structure (mandatory order)

```
## The thesis

## Key numbers

## The setup

## Risk factors

## What to watch
```

### Section guidance

**## The thesis**
- 2–3 sentences explaining the core investment/trade idea the video makes
- What is the opportunity? What is the central argument?
- This should be extractable as a standalone summary

**## Key numbers**
- 3–5 bullet points of the most important data points from the video
- Revenue, earnings, growth rate, backlog, valuation multiple, key price levels — whatever is most relevant
- These should complement (not duplicate) the frontmatter stats strip
- Use the figures as they were at the time of the video

**## The setup**
- Describe the chart/technical setup the video focuses on
- Include: price structure, key MAs, trend direction, support/resistance levels, any divergence signals
- Keep this tight — 3–5 sentences
- Reference specific price levels where known

**## Risk factors**
- 2–4 bullet points of the main risks the video identifies or that are obvious to the setup
- Be honest — include both technical invalidation and fundamental risks
- Do NOT invent risks not supported by your research

**## What to watch**
- 2–3 sentences on the specific upcoming catalysts, levels, or events that matter
- Earnings dates, key price levels, sector moves, macro events — whatever is most relevant
- Forward-looking but grounded in what was known at the time of the video

---

## Research requirements

Before writing any video content file:
1. Web search the ticker for current price action and recent news
2. Web search the ticker + earnings for the most recent earnings context
3. Verify any specific numbers (revenue, guidance, backlog) before writing them
4. Never invent earnings figures, analyst targets, M&A details, or company announcements
5. If the video title makes a specific claim, verify it before repeating it as fact
6. The stats and content must reflect what was true AT THE TIME OF THE VIDEO DATE
   (use the YouTube video's publish date as the reference date)

---

## File naming

The filename IS the YouTube video ID — do not change it:
- `content/videos/ABC123xyz12.md` where `ABC123xyz12` is the 11-char YouTube video ID

---

## Datasheet images

The datasheet is a separate asset generated as part of the video production process.
When you have a datasheet image ready:
1. Add it to `public/images/datasheets/[ticker-lowercase]-[month]-[year].png`
2. Add the path to the `datasheetImage` field in the markdown frontmatter
3. The page will automatically render it below the written analysis

If no datasheet exists yet, leave `datasheetImage` blank — the page shows a
"coming soon" placeholder automatically.

---

## Publishing

Unlike insight posts, video content files:
- Commit DIRECTLY to `main` (no PR needed — no chart config to validate)
- Take effect immediately on the next Vercel deploy (~1 min)
- Can be updated at any time without disrupting the live page structure

---

## Lessons learned

- **The stats strip figures are frozen in time.** Do not update them to today's numbers
  when editing an existing file. They should reflect what the video showed.
- **Do not invent the datasheetImage path.** Only add it once the file is confirmed
  present in `public/images/datasheets/`. A broken path renders a broken image.
- **The YouTube ID is case-sensitive.** Copy it exactly from the URL — do not retype it.
- **Ticker is uppercase, no $ prefix.** `AVAV` not `$AVAV` or `avav`.
- **Keep stat values concise.** `$1.1B` not `$1,100,000,000`. `+143%` not `up 143 percent`.
