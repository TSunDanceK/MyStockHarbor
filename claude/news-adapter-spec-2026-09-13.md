# News adapter spec — build instructions (2026-09-13)

Built on **measured verdicts**, not assumptions. Probe route:
`app/api/debug/news-sources`. Three runs from `iad1` — two preview, one
production. Delete the probe once this ships.

Context: `claude/news-as-stored-dataset-spec-2026-08-22.md` (the store, unchanged),
`claude/stooq-inaccessible-sec-viable-2026-09-12.md` (the precedent — Stooq was the
first source to refuse this site's IPs; Nasdaq is the second, so source viability is
now measured from inside a function before anything is built on it).

## Verdicts — build only on these

| Source | Verdict | Evidence |
|---|---|---|
| **Google News RSS search** | **PASS — per-symbol primary** | 100 items / 95d (MU), 100 / 149d (PLAB), 100% precision (ASTS) |
| **data.sec.gov submissions** | PASS | 1,001 filings, `sicDescription`; works with or without SEC_USER_AGENT |
| **sec.gov/files/company_tickers.json** | PASS **with UA set** | 10,426 ticker→CIK entries, 798 KB |
| **GlobeNewswire** | PASS | ticker in `<category>`, `dc:subject`, `dc:keyword` |
| **PR Newswire** | PASS | `prn:industry`, `prn:subject`, `media:credit` = "PRNewswire" |
| **MarketWatch** | PASS | `media:credit` = "Sean Rayford/Getty Images" |
| **CNBC** | PASS | 30 items, `metadata:sponsored` flag |
| **Nasdaq rssoutbound** | **BLOCKED — do not use** | 25s timeout, both attempts, every feed, preview **and** production |
| **Business Wire** | dead feed token | dropped |

**Nasdaq is not a fallback, a retry candidate, or a "try again later".** It answered
fine from a residential network and refuses Vercel from both environments. Do not
reintroduce it.

Production and preview returned materially identical results for every other source,
so preview is a fair proxy for future probing.

## What does NOT change

The August stored-dataset design survives intact and must be reused as-is:

- Redis keys `msh:news:v1:<SYM>` and `msh:sector-news:v1:<SLUG>`
- **Lazy population on first visit.** Never a warm cron. Do not add news to `vercel.json`
- 6-hour overlap on incremental fetch, dedup by link/guid, hold ~40, cap and evict
- The earnings pin (7-day backstop, replacement is the primary rule)
- Page renders read Redis and make no upstream call

Only the **adapter behind it** changes. If the plan seems to require touching the
store, the plan is wrong.

## Provider interface — the flick-back requirement

Hard requirement from the owner: if FMP ever return with a reasonable offer, it must
be a switch, not an unpick.

```ts
// lib/server/news/types.ts
export type NewsProviderId = "gnews" | "wire" | "sec" | "fmp";

export interface NewsProvider {
  id: NewsProviderId;
  /** Per-symbol news. sinceIso is the incremental watermark (newest stored − 6h). */
  fetchForSymbol(
    symbol: string,
    companyName: string,
    sinceIso: string | null
  ): Promise<NewsItem[]>;
  /** Market-wide. Feeds the headlines page AND seeds sector pages. */
  fetchMarket(): Promise<NewsItem[]>;
}
```

Selection by env, defaulting to free:

```ts
// NEWS_PROVIDER = "free" (default) | "fmp"
const active = process.env.NEWS_PROVIDER === "fmp" ? [fmpProvider] : freeProviders;
```

The FMP adapter stays in the tree, compiling and tested, populating the same fields.
It is not deleted, commented out, or gutted.

## Item shape — additive only

```ts
type NewsItem = {
  // unchanged — do not remove or rename
  title: string;
  link: string;
  pubDate: string | null;
  source: string | null;
  description: string | null;
  image?: string | null;

  // additions
  guid?: string | null;
  tickers?: string[];
  categories?: string[];
  eventType?: "earnings" | "filing" | "analyst" | "deal" | "macro" | null;
  art?: string | null;
  imageVerdict?: "allow" | "deny" | null;
  provider?: NewsProviderId;
};
```

`tickers` is deliberately left unset by the FMP adapter in step 1 — FMP's symbols
already arrive as `fmpSymbols`, which every consumer and every stored Redis record
reads, and writing the same list under a second name would have changed stored bytes
for no gain. **Resolve it in step 3, not later:** the Google News adapter populates
`tickers`, and one read shim treats `fmpSymbols` as a legacy alias so existing
records keep working. One place, not scattered — two names for one concept is exactly
what this shape exists to prevent.

## 1. Google News adapter — the per-symbol primary

### Query construction, and why it matters

Google News is a **plain text search with no notion of a ticker.** Measured:

```
q=MU                              86% precision  (Missouri Tigers football,
                                                  a Ugandan BBC story,
                                                  a college soccer box score)
q="Micron Technology" stock       97-98% precision, 95-day span   <- USE THIS
```

```
https://news.google.com/rss/search?q=<QUERY>&hl=en-US&gl=US&ceid=US:en
QUERY = `"${cleanName}" stock`
```

The residual 2-3% are not junk — they are the same clickbait headlines each run
("Not Nvidia, Not Palantir. This Might Be September's Most Important AI
Infrastructure Stock"), which are genuinely about the company but withhold the name
from the headline. The scorer only reads titles, so 97% is a floor.

### The normaliser — CORRECTED 2026-09-13

**An earlier version of this section was wrong and is recorded here so the mistake
is not repeated.** It said: strip everything from `" - "` onward, then trailing
corporate suffixes. That rule was generalised from a single example
(`Micron Technology, Inc. - Common Stock`) and it fails on roughly **half** the
universe, because half the directory joins the instrument clause with a plain space:

```
Micron Technology, Inc. - Common Stock     the shape the old rule assumed
Chevron Corporation Common Stock           no dash at all
Boeing Company (The) Common Stock          and a parenthetical in the way
Nike, Inc. Common Stock
GameStop Corporation Common Stock
```

A dash-only cut leaves `Chevron Corporation Common Stock` intact and sends it to
Google News verbatim — precisely the failure the normaliser exists to prevent.
**Testing against 155 real directory names is what caught it; invented fixtures all
carry the assumed shape and would have hidden it.** Source real names for the
fixture, commit them with provenance, and the test runs offline afterwards.

**Reuse `lib/server/companyNames.ts`, do not write a new rule.** Its instrument-suffix
handling has run against this same feed for months and already covers the
space-joined form, the `(The)` parenthetical, ADR share-ratio clauses and the
directory's self-repeating names. The order that works:

1. the dash cut — still needed, it is the only thing that handles `" - Units"` and
   `" - 7.875% Notes due 2028"`
2. the existing `companyNames.ts` instrument rule
3. corporate-suffix stripping

Result: 105 of 155 produce a searchable term, and **all 55 symbols the site actually
publishes on are correct** — MU → `Micron Technology`, BABA → `Alibaba`,
VRT → `Vertiv`, WFC → `Wells Fargo`, QBTS → `D-Wave Quantum`.

### Names that cannot be searched by name

**48 of 155 are funds, notes or preferreds**, not companies — *Keeley Dividend ETF*,
*NextEra … Junior Subordinated Debentures due March 1, 2079*. Their names are product
descriptions. `assessCompanyName` returns `fund-or-note` and **they never reach a
per-symbol query.** (Worth noting beyond news: 31% of the universe not being a
company is a finding for the universe work too.)

**Some real companies normalise to a common word.** MSTR → `Strategy`,
POST → `Post`. Querying `"Strategy" stock` returns articles about strategy.

**Handle this with the classification, not a hand-maintained alias list** — an alias
table rots and nobody remembers to update it. Where `assessCompanyName` flags a name
as generic, switch to the ticker-qualified shape:

```
QUERY = `"${cleanName}" (${symbol}) stock`
```

Measured at 96% for unambiguous names versus 98% — a small cost that only applies
where it buys a lot. It also absorbs recent renames without maintenance: MSTR was
MicroStrategy until recently and headlines still use both, and the ticker anchors
both spellings.

### Date filtering is not optional

CYRX returned 55 items spanning **3,453 days** — one from 2017. Thin-coverage names
backfill with ancient articles.

- Drop anything older than **45 days** at display
- Keep up to **120 days** in the store (the earnings pin may reach back)
- Sort newest-first after filtering, never before

### Fields available

`title`, `link`, `guid`, `pubDate`, `source`. That is all.

- **`source`** is a real element carrying the publisher — use it for `source`.
  Do not parse the ` - Publisher` suffix off the title; `<source>` is authoritative.
  Do strip that suffix from the displayed title.
- **`link`** is a `news.google.com/rss/articles/CBMi...` redirect. **Leave it alone.**
  Do not resolve it to the publisher URL — an extra request per item, fragile, and
  the redirect still delivers the reader to the publisher.
- **`guid`** is stable. Primary dedup key.
- **There is no description.** See §5.

## 2. Wire adapters — GlobeNewswire + PR Newswire

The only leg where longer extracts and the source's own images are defensible,
because releases are issued for republication.

- **GlobeNewswire**: `<category>` carries the ticker, exchange-prefixed (`SWX:RO`,
  `OTC Markets:RHHBY`). Split on `:`, take the symbol, match against the universe.
  Ignore non-US listings rather than trying to map them.
- **PR Newswire**: `prn:industry` and `prn:subject` map to sector and `eventType`
  respectively — better structured than anything else in the set.
- Both carry real `description` text. Use it.

## 3. SEC adapter

- `https://data.sec.gov/submissions/CIK##########.json` — 1,001 filings for MU,
  with `tickers`, `exchanges` and `sicDescription`. Works with or without
  `SEC_USER_AGENT`, but it is now set on Production and must stay set (fair-access
  policy; ≤10 req/sec).
- **`SEC_USER_AGENT` is Production-only.** That is why the two preview runs saw
  `company_tickers.json` 403 while production returns it fine. Set it on Preview too,
  or accept that preview probes will keep reporting a false block on `www.sec.gov`.
- `sicDescription` is a free sector label. Compare against the existing taxonomy
  before trusting either.
- **Still commit the ticker→CIK map as a static file**, but for the real reason:
  it is **798 KB** and changes rarely, so fetching it at runtime is waste, not a
  workaround for a block. Fetch once, commit as `data/cik-map.json`, refresh by hand.
  10,426 entries, shaped as `{index: {cik_str, ticker, title}}` — build the inverse
  map at build time.
- Render filings as items: `form` + `items` codes → a plain-English title
  ("Form 8-K — Item 5.02, officer appointment"). These rows have no snippet by
  nature; the template builders cover it.

## 4. Headlines and sector pages

- **Headlines**: MarketWatch + CNBC + both wires, merged, deduped, sorted. One
  scheduled poll of a small fixed set.
- **Sector**: union of the sector's constituent per-symbol stores, deduped. The
  similarity dedup matters far more here — a market-wide story arrives once per
  constituent. Verify the threshold behaves on that traffic rather than assuming it
  carries over from single-symbol pages.
- Filter CNBC items where `metadata:sponsored` is not `"false"`.

## 5. The missing snippet — use what already exists

Google News returns no description, so per-symbol cards lose their summary text.
**Do not fill this with an AI call per item.** `lib/stock-news-templates.ts` already
provides `buildWhyItMatters`, `buildBeyondHeadline` and `buildWhatItMeans`, and the
page already renders the algorithmic fallback instantly with an optional AI upgrade
on demand. That machinery was built for exactly this case — wire it to the new items
and leave the on-demand AI path as-is.

Wire items keep their real descriptions, so the page will be a mix. That is fine.

## 6. Images — cascade, default deny

Measured signals, live in the feeds:

- PR Newswire `media:credit` = **"PRNewswire"** (self-credited → safe)
- MarketWatch `media:credit` = **"Sean Rayford/Getty Images"** (agency → deny)

```
provider is wire AND media:credit is the wire itself   -> allow, use the image
media:credit names an agency (Getty/Reuters/AP/AFP/…)  -> deny
no image at all (all Google News items)                -> deny
default                                                 -> deny
```

### Library art goes on the LEAD CARDS ONLY

The page renders **5 large cards and 10 compact rows**. Buckets currently hold
**4 images** (6 for semiconductors, software, biotech, banks), because one prompt
produced one kept image. Spread across 15 rows that repeats each image three or four
times on a single page — visibly.

So:

```
lead cards (5)    -> library art, or the generated data card if the bucket is empty
compact rows (10) -> the generated data card, always
```

Four images across five leads barely repeats. And at 56px tall a generated card
showing ticker, price move and sparkline is **legible**, which a shrunk illustration
of a wafer is not — so this is the better product as well as the cheaper one. The
`-sm.webp` 320×180 variants ship anyway and sit unused until buckets grow.

### Selecting the art

```
art = eventType ? pick(`event-${eventType}`) : pick(`sector-${sectorSlug}`)
pick(bucket) = `/news-art/${bucket}-${pad(hash(guid) % count(bucket))}.webp`
```

Counts come from `public/news-art/manifest.json` — never from counting files by hand.
Hash the guid so an article always gets the same image: stable across renders,
cache-friendly, no flicker. Re-hash on collision so no image repeats on one page.

Five sector buckets are empty (staples, realestate, materials, aerospace, insurance).
Any bucket absent from the manifest falls back to the generated card, so this ships
incomplete and fills in later.

**Serve with a plain `<img srcset>`, never `next/image`**, and always set `width`
and `height`. See `claude/image-policy-2026-09-13.md` for why.

## 7. `eventType` derivation

In priority order: SEC form type → `prn:subject` / `dc:subject` on wires → title
keyword match. Keep the keyword list small and in one place.

## 8. Build order

1. Provider interface + `NEWS_PROVIDER` flag, FMP behind it. **No behaviour change.** Ship and verify nothing moved.
2. Company-name normaliser + unit tests against the real universe.
3. Google News adapter, per-symbol, with the date filter. Resolve `tickers`/`fmpSymbols` here.
4. Wire adapters.
5. SEC filings adapter + committed CIK map.
6. Image cascade + art selection.
7. Flip the default to `free`.

Each step ships on its own. Do not combine 1 and 3.

**Surface the active provider on the cache-health page.** At step 7 the failure mode
is that something fails to register and the site silently keeps calling FMP — the one
thing this work exists to stop. A log line nobody reads is not enough; make it
visible. See `claude/silent-failure-traps.md`.

## 9. Do not

- Do not reintroduce Nasdaq.
- Do not add a warm cron for per-symbol news.
- Do not resolve Google redirect links.
- Do not delete or gut the FMP adapter.
- Do not rehost or cache any publisher image.
- Do not put library art on the compact rows.
- Do not build an alias list for ambiguous company names — use the classification.
- Do not remove the image column — **hide it** with a code comment explaining why,
  per the owner's standing convention, so it is not switched back on by accident.
- Do not claim a bandwidth saving figure. Measure it after.
