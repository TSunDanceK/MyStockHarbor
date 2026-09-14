# News API survey — replacing the FMP news feed
Date: 2026-09-13. Research only; nothing built or changed.

Companion to
`claude/news-adapter-spec-2026-09-13.md`, which supersedes the recommendation
below wherever the two differ — the spec is built on measured probe verdicts,
this survey on vendor pricing pages.

## Headline finding

News is the **cheapest and least locked-up layer** of the FMP stack. FMP's news is
aggregated third-party content (Motley Fool, Zacks, Benzinga, PR wires) surfaced as
headline + snippet + link. That exact product is sold by a dozen vendors at **$0–$99/month**.
There is no $20K-shaped trap at this layer — but the *licence question* is still real and
differs by vendor, so it gets asked in writing before anything is built.

Two distinct markets, and they should not be confused:

| Model | What you get | Who | Price band |
|---|---|---|---|
| **Aggregator** | Headline, snippet/description, image URL, link out to publisher, ticker tags, sentiment | Marketaux, Tiingo, Alpha Vantage, APITube, TheNewsAPI, NewsData | $0–$99/mo |
| **Originator / wire** | Full article body + images, licensed to be embedded on your own page | Benzinga (direct or via Massive/Polygon), Dow Jones, Zacks | $99/mo → enterprise |

FMP was selling us the first one. We only need the first one.

## Verified pricing (fetched 2026-09-13)

**Marketaux** — closest like-for-like replacement for FMP news.
Free $0 (100 req/day, 3 articles/req) · Basic $29 · Standard $49 · Pro $99 · Pro 50K $199.
5,000+ sources, 80+ markets, ticker entity tagging with per-entity sentiment scores.
Returns `title`, `description`, `snippet`, `url`, `image_url`, `source`, `published_at`,
plus `entities[]` with `symbol`, `sentiment_score`, `match_score`. Snippet only, never full text.
**Licence status: their ToS is silent on commercial use / redistribution. Must be asked in writing.**

**Tiingo** — Free Starter · Power **$30/mo individual, $50/mo commercial**. News included on both.
8,000–12,000 articles/day, 15+ yrs history (3 months queryable on non-institutional tiers),
headline + long-form description, ticker and topic tags.
**Licence catch:** ToS §7.3 — *"Redistribution is only available upon special request and
permission, and comes with additional fees"*, and any redistribution must carry
*"Data sourced by Tiingo"* with a link. Showing news to site visitors plausibly counts as
redistribution. The $50 commercial tier may not by itself cover a public site — ask.

**Alpha Vantage** (`NEWS_SENTIMENT`) — Free 25 req/day (too thin) ·
$49.99 (75 req/min) · $99.99 · $149.99 · $199.99 · $249.99, up to $2,499. 2 months free annually.
Already a candidate elsewhere in the rebuild, so one vendor could cover more than news.

**Finnhub** — free tier is **personal/non-commercial only**; monetised or redistributing use
requires paid. All-In-One around $50/mo; commercial/startup licensing sits on a separate
quote page. Same shape of conversation as FMP, so treat with care.

**EODHD** — news only in the ALL-IN-ONE package **$99.99/mo**, and every personal plan carries
*"For commercial use, choose Startups & Enterprise Data Solution Plan"* → separate quote.
Expensive for news alone and the same commercial-tier pattern that bit us. Deprioritise.

**Stock News API** — Basic $19.99/mo (20k calls, explicitly *non-commercial*) ·
Premium $49.99/mo (50k calls, pitched at websites/apps) · Business custom.
Cheap and honest about the split; the $49.99 tier is the one that would apply.

**Benzinga** (full-text, licensed for display) — 130–160 full articles/day + 600–900 headlines,
Wilshire 5000 + TSX + 1,000 popular tickers, history to 2010, REST/stream/RSS, and explicitly
*"built to be displayed on your platform"* including full body and images. No public price;
available at **$99/mo** as a partner dataset through **Massive** (polygon.io now redirects to
massive.com — Stocks Basic $0 / Starter $29 / Developer $79 / Advanced $199, partner datasets
$99 each), though those listed tiers say *individual use only* — business needs sales.

**General news APIs** (usable but no native ticker tagging — we'd map tickers ourselves):
APITube free / $29 / $99 / $199 · TheNewsAPI free / $19 / $49 / $79 ·
NewsData free 200 credits/day (claims commercial use permitted) then $199 ·
Mediastack from ~$24.99 · **NewsAPI.org — avoid**, free tier is dev-environment only and
production starts at **$449/mo**.

## The free route (zero licence exposure)

- **SEC EDGAR** — 8-K / press-release filings as Atom/RSS per company. US-government work,
  no licence, no cost. Requires a declared User-Agent and ≤10 req/sec fair-access compliance.
  Covers the material corporate events that matter most on a ticker page.
- **PR wires** — GlobeNewswire publishes ATOM/RSS/JS-widget feeds filterable by subject,
  industry and organisation class; Business Wire and PR Newswire have equivalents.
  Press releases are issued *to be republished*, which is the cleanest content we can carry.
- **Publisher RSS direct** — Motley Fool, Zacks, Seeking Alpha, Benzinga all publish RSS.
  Headline + link + short snippet with attribution is the conventional pattern, but it is still
  their copyright; snippet-and-link only, never full text, and no rehosting of images.
- **Yahoo Finance per-ticker RSS** — the classic `feeds.finance.yahoo.com/rss/2.0/headline?s=TICKER`
  endpoint is **disallowed by Yahoo's robots.txt** on automated fetch. Noted and ruled out.

**Superseded by the probe:** this section predates the measured runs. Nasdaq's feed was the
leading candidate and turned out to be blocked from Vercel entirely; Google News RSS — already
present in `lib/stock-news-data.ts` as a fallback — turned out to be the strongest per-symbol
source available. See the adapter spec for what was actually measured.

## Images — the highest-risk part of the whole feed

Article images are a **separate copyright from the article text**, and the risk profile is
nothing like headline-and-snippet. Rule of thumb for MSH: **text may be quoted briefly with a
link; images are not ours to show unless a contract says so.**

Why images are the sharp edge:

- The publisher usually does **not own the photo**. It is licensed from Getty, Reuters, AP,
  AFP or a stock library, for *that publisher's* use. That licence does not pass to us
  through their RSS feed. The publisher cannot sublicense it even if they wanted to.
- Getty and AP run automated reverse-image matching against the open web, and the standard
  first contact is a demand letter with a retroactive licence fee per image. This is the most
  common way a small site gets a legal bill from news content.
- An `image_url` field in an aggregator response is a *pointer*, not a grant.
  Marketaux, Tiingo et al. pass the URL through; their terms say nothing about our right to
  display it. Silence is not permission.

Three technically distinct things, with different exposure:

1. **Rehosting / caching to our own CDN or S3** — makes a copy on our infrastructure.
   Clearest infringement, hardest to argue. **Never do this.**
2. **Hotlinking the publisher's image URL** — no copy is stored by us, which is a materially
   better position, but we are still publicly displaying the work. Also practically poor:
   images break when they rotate URLs, many wires block by referrer, page weight comes from
   20 unrelated domains, and layout shifts hurt Core Web Vitals and SEO — which we are
   actively trying to recover.
3. **Licensed embedding** — Benzinga's newswire product explicitly includes images cleared
   for display on the subscriber's platform. That is a chunk of what the $99/mo buys.

Both signals were later confirmed live in real feeds: PR Newswire self-credits its images
(`media:credit` = "PRNewswire"), MarketWatch credits an agency (`media:credit` =
"Sean Rayford/Getty Images"). The cascade in the adapter spec keys off exactly that field.

Safer image sources, in order:

- **PR wire images** (GlobeNewswire, Business Wire, PR Newswire) — attached to a release that
  is issued for republication and generally cleared by the issuing company for media use.
  Safest third-party images available to us; still worth confirming per wire.
- **Company logos** — trademark rather than copyright territory. Using a logo to identify the
  company a story is about is normal nominative use; the line to stay behind is implying
  endorsement or partnership. Low risk and visually consistent.
- **Our own generated artwork** — the route taken. A library of AI-generated sector and event
  illustrations, generated in Google Flow at zero credit cost, committed to `public/news-art/`
  and selected by hashing the article guid. No licensing exposure, no external image request,
  no layout shift, and it looks like MyStockHarbor rather than like everyone else's stock photos.

## Architecture point that matters more than the vendor choice

Per-symbol news calls are what make news expensive — 700 symbols polled individually blows
through any request quota and hammers Redis. **Poll a firehose, tag locally, serve per symbol:**

1. One scheduled job pulls the general/market news stream (plus wire + EDGAR feeds).
2. Tag each article to tickers in our own code against our universe.
3. Write one merged, date-bucketed news object to cache; ticker pages read a slice of it.

Cost then becomes flat and independent of universe size, which also means scaling 700 → 3,000
symbols costs nothing extra on the news line, and Redis commands stay near-constant.

## Before paying anyone — the FMP lesson

Send the same written question to every shortlisted vendor and keep the reply on file:

> "MyStockHarbor.com is a publicly accessible, ad-supported stock-analysis website with
> roughly N page views/month. I intend to display news headlines, short snippets, source
> attribution and an outbound link to the publisher, on public ticker pages, cached for up to
> X minutes. Does my intended use fall within plan [P] at the listed price, or does it require
> a separate commercial or redistribution licence? **If your response includes an image URL,
> does my plan grant any right to display that image, by hotlink or otherwise?**
> Please confirm in writing."

FMP's personal-plan price was only cheap until they looked at the site. Not repeating that.

*Not legal advice — licensing terms should be confirmed by the vendor in writing.*
