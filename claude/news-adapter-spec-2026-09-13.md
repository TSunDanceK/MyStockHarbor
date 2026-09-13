# News adapter spec — build instructions (2026-09-13)

Built on **measured verdicts**, not assumptions. Probe route:
`app/api/debug/news-sources` on this branch. Two runs from `iad1`, preview.
Delete the probe once this ships.

Context: `claude/news-as-stored-dataset-spec-2026-08-22.md` (the store, unchanged),
`claude/stooq-inaccessible-sec-viable-2026-09-12.md` (the precedent — Stooq was the
first source to refuse this site's IPs; Nasdaq is the second, so source viability is
now measured from inside a function before anything is built on it).

## Verdicts — build only on these

| Source | Verdict | Evidence |
|---|---|---|
| **Google News RSS search** | **PASS — per-symbol primary** | 100 items / 95d (MU), 100 / 149d (PLAB), 100% precision (ASTS) |
| **data.sec.gov submissions** | PASS | 1,001 filings, `sicDescription`, works without SEC_USER_AGENT |
| **GlobeNewswire** | PASS | ticker in `<category>`, `dc:subject`, `dc:keyword` |
| **PR Newswire** | PASS | `prn:industry`, `prn:subject`, `media:credit` = "PRNewswire" |
| **MarketWatch** | PASS | `media:credit` = "Sean Rayford/Getty Images" |
| **CNBC** | PASS | 30 items, `metadata:sponsored` flag |
| **Nasdaq rssoutbound** | **BLOCKED — do not use** | 25s timeout, both attempts, every feed |
| **sec.gov/files/company_tickers.json** | 403 | commit it as a static file instead |
| **Business Wire** | dead feed token | dropped |

**Nasdaq is not a fallback, a retry candidate, or a "try again later".** It answered
fine from a residential network and refuses Vercel entirely. Do not reintroduce it.

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

## 1. Google News adapter — the per-symbol primary

### Query construction, and why it matters

Google News is a **plain text search with no notion of a ticker.** Measured:

```
q=MU                              85% precision  (Missouri Tigers football,
                                                  a Ugandan BBC story,
                                                  a college soccer box score)
q="Micron Technology" stock       98% precision, 95-day span   <- USE THIS
```

```
https://news.google.com/rss/search?q=<QUERY>&hl=en-US&gl=US&ceid=US:en
QUERY = `"${cleanName}" stock`
```

**`cleanName` needs a normaliser.** The universe holds display names like
`Micron Technology, Inc. - Common Stock`, and querying that verbatim would be far
worse than the measured result. Strip, in order: everything from ` - ` onward, then
trailing `, Inc.` / `Inc.` / `Corporation` / `Corp.` / `Company` / `Co.` / `Ltd.` /
`plc` / `Holdings` / `Group` / `N.V.` / `S.A.`, then trim punctuation.
`Micron Technology, Inc. - Common Stock` → `Micron Technology`.

Unit-test the normaliser against a sample of the real universe before trusting it.

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

- `https://data.sec.gov/submissions/CIK##########.json` — works today without
  `SEC_USER_AGENT`, but **set it anyway** (fair-access policy; ≤10 req/sec).
- `sicDescription` is a free sector label. Compare against the existing taxonomy
  before trusting either.
- **Commit the ticker→CIK map as a static file.** `sec.gov/files/company_tickers.json`
  403s from Vercel, and the map changes rarely. Fetch once, commit as
  `data/cik-map.json`, refresh by hand. This removes a runtime dependency rather
  than working around a block.
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

Then select generated art:

```
art = eventType ? pick(`event-${eventType}`) : pick(`sector-${sectorSlug}`)
pick(bucket) = `/news-art/${bucket}-${pad(hash(guid) % count(bucket))}.webp`
```

Hash the guid so an article always gets the same image — stable across renders,
cache-friendly, no flicker. Re-hash on collision so no image repeats on one page.
Fall back to the generated data card where a bucket has no images yet, so this can
ship with three sectors done.

## 7. `eventType` derivation

In priority order: SEC form type → `prn:subject` / `dc:subject` on wires → title
keyword match. Keep the keyword list small and in one place.

## 8. Build order

1. Provider interface + `NEWS_PROVIDER` flag, FMP behind it. **No behaviour change.** Ship and verify nothing moved.
2. Company-name normaliser + unit tests against the real universe.
3. Google News adapter, per-symbol, with the date filter.
4. Wire adapters.
5. SEC filings adapter + committed CIK map.
6. Image cascade + art selection.
7. Flip the default to `free`.

Each step ships on its own. Do not combine 1 and 3.

## 9. Do not

- Do not reintroduce Nasdaq.
- Do not add a warm cron for per-symbol news.
- Do not resolve Google redirect links.
- Do not delete or gut the FMP adapter.
- Do not rehost or cache any publisher image.
- Do not remove the image column — **hide it** with a code comment explaining why,
  per the owner's standing convention, so it is not switched back on by accident.
- Do not claim a bandwidth saving figure. Measure it after.
