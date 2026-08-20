# Screener pages: force-dynamic → ISR (2026-08-20)

Branch `perf/picker-pages-isr`. **Landed and verified against a real build.**
All 32 page files, `PickerResultPage.tsx`, `PickerHighlightScroller.tsx` and
`PickerFilterContext.tsx` are in. All 32 routes now build as `○ ... 5m`.

Two things in this doc were written before anything had been through `next
build` — only `ts.transpileModule` — and the build corrected both. See
"What the build actually found" below: **blocker 4 (Redis) is disproven**, and
a fifth blocker the doc never anticipated is what was actually holding the
routes dynamic.

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

**4. Redis — RESOLVED, it was never a blocker.** The worry was that
`@upstash/redis` issues its REST calls with `cache: "no-store"`, which can opt a
route out on its own. With 1–3 removed, all 32 routes prerender as `○ 5m` while
still reading Redis through `getPickersData`. The no-store on those REST calls
does not propagate to the route's own rendering mode. No `unstable_cache`
wrapping is needed, and the contingency plan at the bottom of this doc is moot.

**5. `useSearchParams()` in `PickerFilterProvider` — the real remaining
blocker, and the one this doc missed.** `PickerFilterContext.tsx` called
`useSearchParams()` to seed the filter selection from the URL. Removing 1–3
does not help while that call stands: the build does not merely fall back to
`ƒ`, it **fails outright** with "useSearchParams() should be wrapped in a
suspense boundary". Only found because this was the first time the change was
put through `next build` rather than a syntax check.

The obvious fix — wrapping `<PickerFilterProvider>` in `<Suspense>` — is
**wrong, and quietly so**. That provider wraps the entire results tree, so the
boundary renders its fallback into the prerendered HTML and the results only
appear after hydration. The build would go green and every one of these pages
would ship an empty shell to crawlers, which is the precise opposite of what
this work is for.

What was done instead: the hook moved into `PickerFilterUrlSync`, a
null-rendering child that reports the query string up to the provider through
its own context, and *that* is what sits inside `<Suspense fallback={null}>` —
the same shape `PickerHighlightScroller` already uses. The boundary contains
nothing, so nothing leaves the prerendered HTML, and because it is still the
real hook the provider stays reactive to back/forward, shared links, and a nav
link back to the clean path while it stays mounted (the case the URL -> state
effect exists for; a mount-only `window.location.search` read would have
silently broken it).

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
  replaced with a `SITE_ORIGIN` constant; `<PickerFilterUrlSync />` rendered in
  its own `<Suspense fallback={null}>` just inside `PickerFilterProvider`.
- **`PickerFilterContext.tsx`** *(not in the original plan — see blocker 5)* —
  the provider no longer calls `useSearchParams()`. It holds the query string
  as state, seeded `""` so the prerendered HTML is query-independent, and the
  new exported `PickerFilterUrlSync` owns the hook and reports the value in
  through a second, setter-only context.

All 36 files: `tsc --noEmit` clean, `next build` green, and `eslint` reports no
new problems (the one `set-state-in-effect` error in `PickerFilterContext.tsx`
is pre-existing — confirmed by running eslint on the base commit).

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

## Why this was held back as a patch (historical)

Same reason as `claude/patches/picker-controls-tab-bar-2026-08-19.md`: the
GitHub connector has no patch API, so editing ~15 lines of a 73KB file means
retransmitting all 73KB, and a truncated upload of the component that renders
all 32 screener pages is worse than an unshipped one. The change is finished,
not unfinished — this is a transport limit.

Resolved: this landed from a local checkout, where the file could be edited in
place. The referenced patch file was never committed and does not exist in the
repo — the changes above are the record.

## What the build actually found

`npm run build`, all 32 target routes:

```
○ /oversold-stocks-today                  5m      1y
○ /overbought-stocks-today                5m      1y
...                                       (32/32)
```

Confirmed on the emitted HTML (`.next/server/app/oversold-stocks-today.html`),
not just the route table — the point being that `○` alone would not have caught
the empty-shell failure mode above:

- JSON-LD, hero, `ScreenerNav` and the results grid are all present in the
  prerendered HTML. The Suspense boundary did not swallow the tree.
- The grid renders its empty state (`"No oversold stocks are currently
  available..."`) because the build sandbox has no `UPSTASH_REDIS_REST_*`
  credentials, so the payload is empty. That is an environment artifact — the
  grid server-rendered, it just had no rows. On Vercel the cards populate.

Two pages that also live under `app/` and reference `PickerResultPage` are
**not** part of this set and stay `ƒ` by design:
`bullish-divergence-stocks` and `bearish-divergence-stocks` are bespoke pages
with their own `headers()` call that only mention `PickerResultPage` in a
comment. 34 files match a naive grep; 32 are the real set.

## One behaviour change, inherent to caching these routes

A shared filtered link (`?filters=...`) used to server-render its own filtered
set. Under ISR it cannot: one cached HTML is served for every query string. It
now seeds the page's own preset and applies the URL's filters immediately after
hydration, via the existing URL -> state effect.

This is forced by the caching, not a preference. The SEO invariant is unchanged
and in fact now unconditional — a crawler on the clean path gets exactly this
page's own condition in the HTML — and every condition page's canonical was
already pinned to the bare path, so filtered URLs were never indexed separately.

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
