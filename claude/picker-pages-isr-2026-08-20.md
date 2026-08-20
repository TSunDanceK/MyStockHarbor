# Screener pages: force-dynamic → ISR (2026-08-20)

Branch `perf/picker-pages-isr`. **Partially pushed.** `PickerHighlightScroller.tsx`
is in. The 32 page files and `PickerResultPage.tsx` are written, verified and
recorded here, but not committed — see "Why this is a patch" below.

## The problem, measured

Vercel runtime logs, 24h: every page request logs `cache=MISS`. Not one `HIT`
or `PRERENDER` on any real page route — only on `robots.txt`. Every visit and
every crawl is a full serverless render.

The Next build output names the cause per route:

```
ƒ /oversold-stocks-today     ← probe: revalidate = 300, STILL dynamic
ƒ /overbought-stocks-today   ← untouched control
○ /pickers                                5m
○ /bottlenecks                            1h
● /bottlenecks/[ticker]                   1d
ƒ /stock/[symbol]            ← probe: revalidate = 900, STILL dynamic
```

## Three blockers, found in this order

**1. `force-dynamic`.** 30 of the 32 screener pages carry it explicitly. It
ships `Cache-Control: no-store`. Necessary to remove, nowhere near sufficient —
a one-page probe with `revalidate = 300` came back `ƒ` anyway.

**2. `searchParams`.** Every screener page threads `searchParams` into
`PickerResultPage`, and awaiting it in a server component opts the route out of
static rendering on its own. It feeds exactly one value: `highlightSymbol`,
handed to `PickerHighlightScroller` — a client component that renders `null` and
scrolls/pulses a card in a `useEffect`. It never needed the server.

**3. `headers()`.** `PickerResultPage` called `getOriginFromHeaders()`, and
`headers()` alone forces dynamic rendering. Fixing 1 and 2 without this changes
nothing. The origin existed solely so `pickersBuilder.fetchMarket()` could HTTP
self-fetch `${origin}/api/market`.

**4. Redis — still unknown.** `@upstash/redis` issues its REST calls with
`cache: "no-store"`, which can opt a route out on its own. Untestable on these
pages until 1–3 are gone. **`/pickers` is not evidence either way** — it is
static because it is a static shell that fetches client-side, not because its
Redis reads are harmless. That was an early wrong call, corrected here.

## What was changed

- **`PickerHighlightScroller.tsx`** — reads `?symbol=` via `useSearchParams()`
  instead of taking a prop. **Must** be rendered inside `<Suspense>`:
  `useSearchParams()` without a boundary bails the whole page out of static
  generation, quietly undoing the point, and the build fails rather than warns.
  *(pushed)*
- **32 page files** — `export const dynamic = "force-dynamic"` →
  `export const revalidate = 300` (matching the underlying pickers cache cycle
  and what `/pickers` already runs at); `searchParams` prop dropped from the
  default export.
- **`PickerResultPage.tsx`** — `headers()`, `getOriginFromHeaders()`, the
  `next/headers` import and the whole `searchParams` thread-through removed;
  scroller rendered unconditionally inside `<Suspense fallback={null}>`; origin
  replaced with a `SITE_ORIGIN` constant.

All 35 files: `ts.transpileModule` clean, 0 diagnostics.

**Gotcha worth keeping:** two of the 32 pages
(`stocks-with-positive-last-earnings`, `stocks-with-strong-earnings-growth`) use
a *multi-line* import of `PickerResultPage`. A scripted "insert after the last
import line" edit lands the directive inside the import statement and breaks the
file. Caught by the syntax check before push. Any future bulk edit across these
32 pages needs the same guard.

## Deferred: the `pickersBuilder` in-process fix

`fetchMarket()` in `lib/server/pickersBuilder.ts` still self-fetches
`${origin}/api/market`. That is the same self-block class already fixed for
`playsBuilder.ts` and `descendingTrianglesBuilder.ts` in PRs #262/#263 —
pickersBuilder was missed. It carries no BotID header and no session cookie, so
the firewall can challenge it on production and the SSO gate refuses it outright
on preview; `fetchJSON` throws on non-ok, and that throw becomes a 500 for the
whole page whenever the pickers cache is *also* cold. It only doesn't bite today
because it runs on cache miss only.

The fix is two lines, identical to playsBuilder's:

```ts
import { readMarketState } from "./marketState";

async function fetchMarket(_origin: string, _forceFresh = false): Promise<MarketPayload> {
  return readMarketState();
}
```

`MarketStateSnapshot` is structurally identical to `MarketPayload` — same six
fields, same row shape. `readMarketState` never throws; a miss degrades to empty
rankings and the universe falls back to `readDynamicUniverse()` +
`PRESET_UNIVERSE`.

Deferred because it is a two-line change to a **119KB** file. Its own PR.

## Why this is a patch

Same reason as `claude/patches/picker-controls-tab-bar-2026-08-19.md`: the
GitHub connector has no patch API, so editing ~15 lines of a 73KB file means
retransmitting all 73KB, and a truncated upload of the component that renders
all 32 screener pages is worse than an unshipped one. The change is finished,
not unfinished — this is a transport limit.

With a local checkout: `git apply claude/patches/picker-result-page-isr-2026-08-20.patch`

## Verification when it lands

Read the build output, not the page. All 32 should flip:

```
○ /oversold-stocks-today                  5m
```

If they stay `ƒ`, blocker 4 (Redis) is real and the next step is wrapping the
Redis-backed reads in `unstable_cache` — the pattern `lib/youtube.ts` uses.

## Safety review (unchanged by any of this)

- **Indexing:** cached HTML is byte-identical HTML — same SSR content, same
  JSON-LD, same links. Only TTFB changes, and crawl rate is the current
  bottleneck (582 discovered-never-crawled).
- **Rate limiting / firewall:** both run in middleware at the edge, which a
  cached response still passes through. View counting is a client beacon to
  `/api/internal/track-view`, unrelated to rendering.
- **Freshness:** the picker payload is cron-warmed into Redis; `revalidate: 300`
  is shorter than the warm cycle.

## Related: `/stock/[symbol]`

Branch `perf/stock-page-isr-probe` adds `revalidate = 900` to the segment
layout. It is currently a **no-op** — the routes stay `ƒ` — and is kept because
the value is correct for when the upstream cause is fixed. 900 is a safety
constraint, not a freshness one: `page.tsx` mints a quote token into the HTML
with an 1800s TTL, so caching longer than that hands visitors expired tokens —
harmless while `QUOTE_TOKEN_ENFORCE` is off, but it would poison the pilot's
logs with false expiries and break live quotes the day it is switched on.
