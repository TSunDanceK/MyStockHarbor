# MyStockHarbor Insight Template (v2, 6 Oct 2026)

One markdown file per post, in `content/insights/{slug}.md`. The page
(`/insights/[slug]`, #563 COWORK #132/#133) draws everything else itself: the
hero, the "Since this was published" strip, the live chart and its slider, the
levels today, the filed earnings figures, the screens, the sector and the
"More on" cards. **The post supplies words and sources only.**

---

## RULES

- **No price fields, ever.** No price, level value, percentage move, market
  cap or chart setting goes in the frontmatter or the text as a figure the
  page should draw. Every price, level and chart is computed by the page from
  stored daily data at render. The writer is never given Tiingo data.
- **Name the level as a kind, not a number**, in `levels`: the page finds
  where it is each day.
- **Sources for every claim.** Each fact in "What happened" comes from a SEC
  filing or a public news report listed in `sources` (full `https://` URL).
  Do not invent or assume news, earnings, guidance, analyst calls, launches,
  lawsuits or takeover rumours. If there is no clear catalyst, say so.
- **Describe, never advise.** Do not use: buy, sell, should, must, recommend,
  "buy zone", "would confirm", "would invalidate", targets. Use "may" and
  "might" for anything about what comes next.
- **Beginner-friendly, not childish.** Plain words; no emoji anywhere,
  including headings.
- **Say each thing once.** The summary appears once on the page; do not repeat
  it in the body.
- Do not add frontmatter fields beyond the list below.

---

## FRONTMATTER (REQUIRED)

```yaml
---
title: "Amazon tests its 200-day average ahead of Q2 earnings"   # under 60 characters, no "buy zone"
date: "YYYY-MM-DD"                                                  # the publish date
symbol: "AMZN"                                                      # the ticker
eventType: "level-test"                                             # one of the list below
timeframe: "d"                                                      # "d" (daily) or "w" (weekly)
levels: ["MA200"]                                                   # the level(s) discussed, kinds only
summary: "Two or three sentences: what the setup is and why it is in focus now."
why: "One or two sentences on why that level or event may matter here."
sources:
  - title: "Amazon 10-Q for the quarter to 30 Jun 2026"
    url: "https://www.sec.gov/..."
    publisher: "SEC EDGAR"
  - title: "Headline of the news report"
    url: "https://..."
    publisher: "Publisher name"
bull: "One line: what may happen if it goes well (may / might)."
bear: "One line: what might happen if it doesn't (may / might)."
---
```

- **eventType**, one of: `earnings` (this week or just reported),
  `level-test` (a key level or the 200-day), `trend-flip`, `52w-high`,
  `52w-low`, `gap` (5% or more), `retail-buzz` (the weekly slot).
- **levels**, kinds only: `MA200` (200-day average), `MA50` (50-day),
  `WMA200` (200-week, weekly posts), `BBMID` (the 20-day average, the
  Bollinger midline). Leave it `[]` when the post is about an event with no
  level; the "Since" strip then shows the move and the S&P comparison only.

---

## BODY (REQUIRED)

```markdown
## What happened

Three to five sentences of what happened, each fact linked inline to its
source, e.g. [Amazon 10-Q](https://www.sec.gov/...). No figures the page
already draws (price, distance to a level, market cap).
```

Only this one section. The summary, the "why", the two one-liners and every
figure come from the frontmatter and the page.

---

## OLD POSTS

The 59 posts written to the previous template keep their frontmatter and text
and render through the same page: their excerpt is the summary, their
"Why it matters" section the "why", their bull / bear scenarios the two
one-liners, and the rest of their text sits behind "The original post, in
full". Their level is derived from `chartIndicators` (lib/insightView.ts).
