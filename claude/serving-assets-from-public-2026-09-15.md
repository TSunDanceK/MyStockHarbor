# Serving assets from `public/` — three things that bite (2026-09-15)

Written after PR #458 (the logo harvest) put the site's first same-origin image
URLs into production paths. Every logo source before it was external — Clearbit,
FMP's CDN — so none of these paths had ever been exercised. Anyone adding
anything under `public/` should read this first.

## 1. Middleware runs on your static assets unless you exclude them

`middleware.ts`'s matcher excluded `_next/static` but nothing else. The first
thing it does on a production request is `isTrapBlocked` — which `trapBlock.ts`'s
own header calls "the FIRST Redis call every request" — and that runs **before**
the `/api/` early-return.

So a listing page rendering 40 ticker logos would have fired **40 extra edge
invocations and 40 extra Upstash calls per page view**. On a project that has
already had one Upstash suspension and keeps a running command budget, that is
not a rounding error.

Fixed by excluding `logos/` in the matcher. Verified the regex still matches what
it should: `/logos/AAPL.webp` skipped, `/stock/AAPL` and `/logosomething` still
matched — only the folder is excluded, not any path with that prefix.

**Rule: any new folder under `public/` needs a matcher exclusion in the same PR.**

## 2. Next serves `public/` with `max-age=0, must-revalidate`

The default means every page view re-requests every asset. Self-hosting would
have been **slower than the third-party CDN it replaced** for repeat visitors,
which inverts the entire point of the change.

Fixed with `max-age=86400, stale-while-revalidate=2592000` in `next.config.ts`.

Deliberately **not** `immutable`: these files are not content-hashed and the
harvest re-runs quarterly, so a day of freshness lets a re-harvest land within a
day instead of being pinned in caches.

## 3. `useState` in a shared leaf component survives a prop change

`TickerLogo` tracked its fallback position as `useState(0)`. React reuses the
instance when the element keeps its position and key, so an instance that had
walked to index 2 for one symbol **started at 2 for the next** — skipping the
harvested file and silently serving FMP.

It renders a correct-looking logo either way. **A visual check cannot catch
this**, which is what makes it worth writing down.

Most call sites were symbol-keyed and remounted anyway — including
`DashboardTicker`, whose `item.id` is `mover-${symbol}` and friends. The exposed
ones changed symbol *in place*: `DashboardClient`'s quote header and
`CustomScreenerSymbolSearch`'s selected row.

Fixed by scoping the state to the symbol it was earned on, in the component
rather than at the call sites:

```js
const [fallback, setFallback] = useState({ sym, idx: 0 });
const idx = fallback.sym === sym ? fallback.idx : 0;
// onError: setFallback({ sym, idx: idx + 1 })
```

The reset belongs in the component because the next call site added will not be
audited.

### Correction to the in-code comment

The comment claims deriving `idx` also discards a late `onError` from the
previous symbol's request "for free", because that handler writes its own `sym`
which no longer matches. **That reasoning does not hold.** React replaces the
`onError` closure on re-render, so an error dispatched after the symbol changed
runs the *new* closure, capturing the *new* `sym` — which would advance the new
symbol past its harvested file.

The behaviour is almost certainly still fine, for a different reason: assigning a
new `src` aborts the in-flight load, and an aborted image request does not fire
`error`. So the late-error case should not arise at all.

Two consequences worth knowing:

- The unit test covering "stale error after a switch" validates a model that does
  not match React's actual closure behaviour. It passes, but it is not evidence.
- If a browser is ever observed firing `error` for an aborted load, add
  `key={sym}` to the `<img>`. A fresh element per symbol makes the whole class of
  stale-event problems structurally impossible.

## General lesson

All three were invisible until the first same-origin asset URL existed. When a
change moves something from "third party fetches it" to "our origin serves it",
the request path itself is new surface — middleware, caching and client state all
need re-checking even though no page code changed.
