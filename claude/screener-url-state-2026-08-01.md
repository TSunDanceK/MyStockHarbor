# Screener: URL-backed filter state — 2026-08-01

Follows on from `claude/screener-in-place-filtering-2026-07-31.md`. That document
listed four outstanding items; **all four are now closed**, plus two bugs found
during review and two stale-content fixes.

PRs: #196, #197, #198, and the numeric-draft PR that carries this file.

---

## What shipped

### 1. The Select Screener pill follows the selection (#196)

`currentLabel` was derived from `currentHref`, so on `/oversold-stocks-today`
with Oversold unticked and Overbought ticked, the H1, eyebrow and results chip
all said Overbought while the pill still said "Oversold". Now driven off
`predicates`, and only on `alwaysFilterMode` pages — everywhere else, including
`ScreenerShell` (which renders `ScreenerNav` outside a provider where
`predicates` is the inert empty array), keeps plain page-name behaviour.

| State | Pill |
|---|---|
| Page's own preset, only thing ticked | Page name (unchanged) |
| Exactly one other predicate | `describePredicate` — "Overbought", "Sector: Technology" |
| Two or more | "Custom" |
| None, on a page that seeds a preset | "No filters" |
| None, on `/stock-screener` | "Advanced Screener" |

The resting state deliberately keeps the **nav's** page label rather than the
predicate's, because the two are worded differently in places ("Buy Signals" vs
the def label "Buy Signal", "20% From ATH" vs "20%+ From ATH"). So the pill only
moves once the visitor actually diverges.

### 2. Card tones follow the applied condition (#196)

Found during review of the above. `buildEntries` stamps every entry with the
**page's** tone server-side, so all ~553 entries on `/overbought-stocks-today`
are red. Untick Overbought, tick Oversold, and genuinely oversold stocks came
back wearing red dots — a wrong signal, not a cosmetic one.

Once the selection diverges from the preset (`isPristine`, new on the context),
tone is derived from the applied condition via `TONE_BY_KEY`. Verified all 24
condition pages: every def tone already equals its page tone, so **nothing
changes at rest**.

While pristine, `entry.tone` is deliberately kept rather than recomputed —
section-backed pages carry per-item tones (bullish green vs bearish red on the
Divergence page) that are more specific than any one condition's tone. Applies to
the list dot, chart dot, reason chips and mini chart. A selection with no single
condition behind it goes neutral blue.

**Gotcha:** `displayTone` must be in `columnSets`' dependency array — the symbol
cell renders the dot, so without it the table keeps the tone it was first built
with.

### 3. Filter state lives in the URL (#197)

The big one, and the fix for a bug reported against #196: **filter state leaked
between visits**. It lived in `useState`, and the client router keeps the provider
mounted across a navigation — the back button, or a nav link to the page you're
already on — so the initialiser never re-ran and a selection survived. Landing on
`/overbought-stocks-today` after unticking Overbought elsewhere left you on a page
whose H1 said "Custom Screener".

There is no clean client-side fix; reading from the URL removes the dependency on
remount semantics entirely.

**Format** (`lib/screenerUrl.ts`), readable rather than compact:

```
flag      oversold=1
category  sector=Technology&sector=Healthcare      (repeated, not delimited)
number    peRatio=..15   marketCap=1000000000..    perf1y=5..25
```

Multi-value categories repeat the key because industry names contain commas,
dashes and slashes — letting `URLSearchParams` own the encoding removes the class
of bug. Field keys come from the registry, so a field added to
`lib/screenerFields.ts` is URL-addressable with no change in `screenerUrl.ts`.
Non-filter params (`?symbol=`, utm, gclid) are preserved untouched.

Two details that are not details:

- **`filters=none`.** An empty selection is a real state and must be
  distinguishable from a clean URL, which on a condition page means "this page's
  own preset". Without the sentinel, unticking a page's only condition would look
  identical to never having touched it and be silently undone by the next
  navigation.
- **Unbounded numeric predicates are dropped before the emptiness check**, not
  during the write loop. Written the obvious way, a selection of only unbounded
  numbers serialised to an empty string — which reads as a clean URL and would
  silently reseed the preset. Caught by the round-trip tests, not by inspection.

### 4. Screener menu: tick to filter, tap the word to open the page (#198)

Every condition row was a checkbox and nothing else, so once every picker page
switched to filter mode the **condition pages had no route in from any screener
page** — only the header dropdown linked to them. Those are the pages carrying
the explainers and the chart deep-links built from section detail (macro S/R
zones, ATH reference lines, dominant indicator). This restores ~24 server-rendered
internal links per screener page.

A row can no longer be a `<label>` — a label hands every tap to its control, and
nesting a link inside one is invalid markup. It's a plain `div`; the input carries
its own `aria-label`; `.screenerNavCheck` pads the tick target to 36×34 since the
text is no longer part of it; the link takes the remaining width so the two targets
cover the row with no dead zone.

### 5. A numeric filter does nothing until it has a bound

Outstanding item 2. Picking "PE Ratio" pushed an unbounded number predicate into
the store, and unbounded is **not** inert — `valueSatisfies` still rejects a null,
so it silently dropped every loss-making company. Nothing on screen said so.

The URL work settled the design: an unbounded predicate can't round-trip through
a URL (a bare `peRatio=..` is rejected on parse), so it could never be shared or
bookmarked. A filter that can't be expressed in a URL and doesn't visibly filter
shouldn't be in the store.

So a numeric field with no bound is now **local UI state** (`draftFields` in
`ScreenerFilterSearch`), not a predicate. An unbounded filter cannot exist in the
store, so everything downstream is correct without touching any of it — grid,
match count, chip bar, count badge, tones, pill, URL. It becomes a predicate the
moment a bound is typed and reverts to a draft if every bound is cleared, so the
round trip is symmetric.

### 6. Content fixes

- **`Build Screener` nav item** (outstanding item 3): **verified alive, no work
  needed.** `PickersClient.tsx` explicitly handles `#custom-screener` and scrolls
  the panel into view once results load.
- **`public/llms.txt`**: listed the retired `/custom-screener` (middleware
  redirects it) and was missing 12 live screener pages. Rewritten, grouped to
  match the Select Screener menu, and now documents the query-param format with a
  request to cite the bare canonical.

---

## Invariants — do not break these

**SSR / SEO.** `useState`'s initialiser runs during the server render. A crawler
on the clean path finds no filter params, so the SSR'd HTML carries exactly the
page's own condition — unchanged from before. Every condition page declares a
hardcoded absolute canonical to the bare path in static `metadata`, so query
params cannot affect it: filtered states are shareable but not separately
indexable. **Any change to how `predicates` is seeded means re-checking SSR
output and the canonical.**

**`replaceState`, never `router.push`.** A Next navigation unmounts the mobile
Select Screener sheet mid-interaction, which is the whole thing in-place filtering
exists to avoid. Replace rather than push also keeps the history stack honest —
ticking six boxes shouldn't cost six back presses.

**The URL stays clean while pristine.** Params appear only on deliberate change,
so every condition page's resting state is its bare canonical path.

**Both sync effects are guarded on a canonical query string** (`predicatesQueryString`,
sorted key order) so neither can loop; `lastSyncedRef` distinguishes a real
navigation from the echo of our own write.

---

## Still open

1. **`/api/quote` caching audit** — `no-store`/`force-dynamic`, so live FMP hits
   if called client-side during symbol switches or polling. Carried over; worth
   doing before any traffic surge.
2. **Second bot mitigation** — raw `node` user-agent hitting API routes from AWS.
   Identified, not yet blocked.
3. **Resend domain verification** — DNS records still needed before the feedback
   form sends email.

## Next, and the reason all of the above was worth doing

**Combination-generated preset pages.** `/cheap-semiconductor-stocks` →
`industry=Semiconductors&peRatio=..15`. Now that a combination is expressible as
a URL, a preset page is a thin config entry plus its own canonical and copy —
genuinely indexable content rather than a filtered duplicate of an existing page.
This is the payoff the whole sequence was building toward.

Sketch: a `PRESETS` map from slug to `Predicate[]`, seeding `initialFilters` the
same way a condition page does, with its own title/description/H1 and a canonical
pointing at itself. The filter model, the URL format and the SSR path all already
exist — the work is copy and route config, not mechanism.

---

## Working notes

- **Verify every push.** `git hash-object <file>` locally, compare to the blob SHA
  the API returns. This caught a real divergence: a doc comment improved while
  transcribing meant the pushed file wasn't the one that had been syntax-checked
  (comment-only that time; reconciled and re-verified).
- **Syntax-check before pushing:** `ts.transpileModule` with
  `jsx: ts.JsxEmit.Preserve`. TypeScript at
  `/home/claude/.npm-global/lib/node_modules`.
- **Test pure logic before wiring it in.** The `screenerUrl` round-trip suite (20
  assertions, stubbed registry) found the empty-string bug that inspection missed.
- **Production build status lags.** `readyState` can report BUILDING for minutes
  after the build log says `Build Completed`. Check
  `get_deployment_build_logs` before assuming a hang.
- Next 16.1.6 — native History API sync with `useSearchParams` (14.1+). All picker
  routes are `force-dynamic`, so `useSearchParams` adds no static-render bailout;
  the build log shows every screener route as `ƒ`.
