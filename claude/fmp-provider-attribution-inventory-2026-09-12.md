# Every place FMP is named as the data source (inventory, 2026-09-12)

Compiled for the Stooq/SEC migration. **These are attribution sites, not API call
sites** — the call-site inventory is a separate list. Each of these hardcodes
"Financial Modeling Prep" or `financialmodelingprep.com` as the source of data
that is about to come from somewhere else.

**Why this is not cosmetic.** Once bars come from Stooq and fundamentals from SEC
EDGAR, every line below attributes their data to FMP. That is wrong on the page,
and wrong in a licensing-adjacent direction while a vendor is asserting a
commercial-licence breach. All of it must become provider-driven with the
`DATA_PROVIDER` switch.

## The two that matter most, and they are not the footer

| # | Site | What it does |
|---|---|---|
| 1 | `lib/server/quoteData.ts:205` | populated quote path sets `source: "financialmodelingprep.com"` as a **literal on the returned object** |
| 2 | `lib/server/quoteData.ts:47` | the **empty/default** quote object sets the same literal — a quote with no data still claims FMP as its source |

Because `quoteData` stamps the field, `quote?.source` is almost never null — which
makes the `??` fallback at #3 nearly dead code. **The footer is the symptom; these
two are the cause.** Fixing only the footer leaves every quote pre-stamped.

## The footer fallback

| # | Site | What it does |
|---|---|---|
| 3 | `app/components/DashboardClient.tsx:953` | `Source: {quote?.source ?? "financialmodelingprep.com"}` |

## Prose source notes — four of these describe the five columns being hidden

| # | Site | Note |
|---|---|---|
| 4 | `app/api/stock-analyst-rating/[symbol]/route.ts:194` | *"Analyst price targets and ratings consensus from Financial Modeling Prep…"* |
| 5 | `app/api/stock-valuation/[symbol]/route.ts:358` | *"Valuation multiples from Financial Modeling Prep ratios/key metrics TTM…"* |
| 6 | `app/stock/[symbol]/StockSymbolPageClient.tsx:1113` | valuation fallback: *"…provided by Financial Modeling Prep when available."* |
| 7 | `app/stock/[symbol]/StockSymbolPageClient.tsx:1184` | analyst-rating fallback: *"…provided by Financial Modeling Prep when available."* |
| 8 | `lib/latest-earnings-data.ts:692` | *"Structured earnings data from Financial Modeling Prep…"* |

**#4, #5, #6 and #7 describe analyst ratings and valuation multiples — the exact
data behind the five columns going behind the capability flag.** They must hide
*with* those columns, not independently. A hidden column beside a surviving
"provided by Financial Modeling Prep" note renders an explanation for data that
is not there: the same compiles-builds-deploys-and-ships-nothing failure the
capability map exists to prevent, arriving through the attribution string instead
of the field whitelist.

## Ninth line: an undocumented FMP dependency that is not an attribution at all

| # | Site | What it does |
|---|---|---|
| 9 | `app/components/TickerLogo.tsx:36` | `https://images.financialmodelingprep.com/symbol/<SYM>.png` |

Source 2 of 3 in that component's fallback chain (Clearbit → FMP logos →
monogram). **Keyless and quota-free** — the file's own comment says so, and it
adds nothing to the FMP data plan — so it is not a licensing or cost exposure.
But it is a live FMP dependency on **every page that shows a ticker logo**, it is
not in any call-site inventory, and it breaks when FMP goes. The monogram
fallback means it degrades rather than fails, which is also why nobody would
notice it had stopped working.

## Note on what this list is not

`NEXT_PUBLIC_FMP_API_KEY` is **not** a client-side key exposure. It appears once,
in `lib/server/symbolSearch.ts:71`, as the third fallback in `getFmpApiKey()`
inside a server module; Next.js inlines `NEXT_PUBLIC_*` only into client-bundled
code. It is worth deleting anyway — while the fallback exists, one accidental
client import of anything in that chain would inline a live key, and the prefix
is a tell that client-side use was once intended.
