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

**MANDATORY trigger format — always provide all three:**

> Generate the YouTube video content file for MyStockHarbor
> YouTube ID: [youtubeId]
> Ticker: [TICKER]
> Script: [paste the full video script here]
> Datasheet: [paste the datasheet data here, OR state "no datasheet yet"]

The script and datasheet are NOT optional. They are the source of truth.
Do not proceed without them — ask for them if not provided.

**Why this matters:** Web research cannot know what argument you made in a specific
video, what framing you used, what numbers you chose to highlight, or which datasheet
figures were current at recording time. Only the script and datasheet can provide that.
A content file written from research alone will contradict your video and undermine trust.

---

## Script rules (CRITICAL)

- The written analysis MUST be derived from the script, not from web research
- Every claim, number, framing, and argument must come from or be directly supported by the script
- Do not add claims, statistics, or context that contradict or go beyond what the script says
- Web research is used ONLY to verify specific numbers mentioned in the script are accurate,
  and to fill in any price/technical context the script doesn't explicitly state
- If the script says something that web research cannot verify, flag it — do not silently
  invent alternative numbers
- The written analysis is a companion piece, not a summary. It should feel like the written
  version of the same argument the video makes, in the same voice and with the same emphasis

---

## Datasheet rules (CRITICAL)

The datasheet is generated as part of your video production process alongside the script.
It represents the data as it stood at the time of recording.

**These are the ONLY acceptable sources for stat values:**
1. The datasheet generated for this specific video (primary source)
2. Numbers explicitly stated in the script itself

**Never use:**
- Web research to fill in stat values
- Figures from a different video's datasheet
- Rounded or estimated figures from memory
- Numbers that differ from what the datasheet or script states

**Datasheet image path:**
- Format: `/images/datasheets/[ticker-lowercase]-[month]-[year].png`
- Example: `/images/datasheets/avav-june-2026.png`
- ONLY add this path to the frontmatter once the image file has been confirmed present
  in `public/images/datasheets/` in the repo
- Do NOT invent or guess the path — a broken path renders a broken image on the page
- If the image is not yet uploaded, leave `datasheetImage` blank and add it later

**If no datasheet is available yet:**
- State `datasheetImage:` with no value (blank)
- Populate the stat fields using numbers from the script only
- Add a note in the commit message: "datasheet not yet uploaded — stats from script"

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

**datasheetImage** (conditional — see Datasheet rules above)

**statLabel1–4 / statValue1–4** (required — fill all 4 pairs)
- These populate the stats strip shown ABOVE the video embed
- Values MUST come from the datasheet or the script — not from web research
- Market cap always goes in slot 1
- Slots 2–4: use the figures the video actually focused on — revenue, earnings, backlog,
  guidance, EPS, ARR, growth rate, or whatever the script treats as most relevant
- Values must be concise: `$8.71B` not `$8,710,000,000`
- Labels must be short: `Q3 revenue` not `Q3 FY2026 quarterly revenue figure`
- These are FROZEN — they reflect the story the video tells at the time it was made.
  Never update them to current figures when editing an existing file.

Example stats taken from a datasheet (defense company):
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

Example stats taken from a script (SaaS company):
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

The body is a companion piece to the video — not a transcript, but the written version
of the same argument. Someone reading it should understand the investment thesis without
watching the video. Someone who watched it first should find the written piece enriching,
not contradictory.

### Tone and style
- Same voice as the script — if the video is direct and accessible, the written piece should be too
- Professional and trader-focused — no fluff, no generic filler
- Every sentence should add something; nothing should repeat what the stats strip already shows

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
- 2–3 sentences capturing the core argument the video makes
- Use the video's own framing — if the video leads with "the market is pricing this wrong", the written piece should too
- This must be extractable as a standalone summary

**## Key numbers**
- 3–5 bullet points of the figures the video treated as most important
- Pull directly from the datasheet or the script — do not add numbers the video didn't mention
- These should complement (not duplicate) the frontmatter stats strip

**## The setup**
- Describe the chart or fundamental setup the video focuses on
- Keep it tight — 3–5 sentences
- Reference specific price levels, key MAs, or catalyst dates the script mentions

**## Risk factors**
- 2–4 bullet points of risks the video identifies or explicitly acknowledges
- Include both technical invalidation and fundamental risks where the script covers them
- Do NOT add risks the video didn't mention unless they are critical and obviously missing

**## What to watch**
- 2–3 sentences on the specific catalysts, levels, or events the video names
- Forward-looking but grounded in what the script stated at the time of recording

---

## Research use policy

Web research is PERMITTED only for:
1. Verifying specific numbers the script states (confirm they are accurate)
2. Filling in technical price context the script references but doesn't quantify
   (e.g. "the stock is near its 52-week low" — research confirms the approximate level)
3. Confirming dates (earnings date, investor day, etc.) the script mentions

Web research is NOT permitted for:
- Determining what the video's argument was
- Replacing or supplementing the datasheet figures with different numbers
- Adding claims or context the script didn't make
- Inventing stats when the datasheet or script didn't provide them

**If the script or datasheet doesn't provide enough information to fill a field,
leave it blank or ask — do not fill gaps with research-sourced data.**

---

## File naming

The filename IS the YouTube video ID — do not change it:
- `content/videos/ABC123xyz12.md` where `ABC123xyz12` is the 11-char YouTube video ID

---

## Publishing

Unlike insight posts, video content files:
- Commit DIRECTLY to `main` (no PR needed — no chart config to validate)
- Take effect immediately on the next Vercel deploy (~1 min)
- Can be updated at any time without disrupting the live page structure

Commit message format:
`Add video content: [TICKER] — [short description] ([youtubeId])`
Example: `Add video content: AVAV — The Missile That Thinks (kABs5daCHQo)`

If the datasheet image is not yet uploaded, add: `(datasheet pending)`

---

## Lessons learned

- **Script is the source of truth, always.** A content file built from web research alone
  will contradict the video and confuse viewers who watched it first. Always require the script.

- **Datasheet figures are frozen.** They reflect what was true when the video was made.
  Do not update them to current figures when editing. The live FMP data strip on the page
  handles current numbers — the datasheet stats tell the story the video told.

- **Match the datasheet to the video, not to the date.** If multiple datasheets exist for
  the same ticker (e.g. two AVAV videos six months apart), use the one generated alongside
  the specific script being processed. The filename convention `[ticker]-[month]-[year].png`
  exists precisely to prevent mixing them up.

- **Do not invent the datasheetImage path.** Only add it once the file is confirmed present
  in `public/images/datasheets/`. A broken path renders a broken image on the page.

- **The YouTube ID is case-sensitive.** Copy it exactly from the URL — `kABs5daCHQo` not
  `kabsdachqo`. Do not retype it from memory.

- **Ticker is uppercase, no $ prefix.** `AVAV` not `$AVAV` or `avav`.

- **Keep stat values concise.** `$1.1B` not `$1,100,000,000`. `+143%` not `up 143 percent`.
