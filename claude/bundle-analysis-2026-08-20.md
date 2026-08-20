# Client bundle analysis — 2026-08-20

Next 16.1.6, Turbopack. Analysis only; no application code was changed in the
session that produced this.

---

## How the numbers were produced (read this before trusting them)

`next build --webpack` cannot build this repo (pre-existing params type error in
`app/learn/[slug]/page.tsx`), and `@next/bundle-analyzer` is webpack-only. Vercel
and local both use Turbopack, so everything below comes from Turbopack output.

**`.next/app-build-manifest.json` does not exist in this repo's build output.**
Turbopack writes it only after static export completes, and export cannot
complete in a sandbox without live upstream data — 11 picker pages hit the
60-second-per-page timeout fetching `financialmodelingprep.com` and friends.
Three approaches were tried:

1. Full `next build` — fails during export on the picker pages.
2. `next build --experimental-build-mode=compile` — succeeds and emits every
   client chunk, but compile mode never writes `app-build-manifest.json`.
3. Full build with the data hosts blackholed so fetches fail fast instead of
   hanging — the outbound proxy ignores `NO_PROXY`, so they still hung; and
   blocking the network wholesale instead breaks `next/font/google`, which
   fetches Geist at build time.

So First Load JS was derived from the equivalent source that *is* written during
compile: `.next/server/app/**/page_client-reference-manifest.js` (per-route
client-module → chunk mapping) plus `build-manifest.json`'s `rootMainFiles` for
the root layout and framework chunks. For each route: union the chunks, dedup on
normalised path, sum raw and brotli. 100 routes resolved. **JS only — CSS is
excluded.** Brotli is `zlib.brotliCompressSync` at quality 11.

Raw and brotli are reported separately on purpose: phone parse cost tracks raw,
transfer cost tracks brotli. The ratio here is roughly 4:1.

Caveat worth repeating: these are *derived* numbers, not a route table printed by
Next. The relative ranking and the measured before/after deltas are solid; check
absolutes against Vercel's own build log.

---

## Headline

**This is not a per-route problem.** A shared baseline of **547.8 KB raw /
144.3 KB brotli** loads on all 100 routes. `SiteHeader` adds another 44.5 / 10.4
on 99 of them (only `/_global-error` lacks it). That floor — roughly 592 KB raw /
155 KB brotli — is 82–83% of even the heaviest route. Route-specific code ranges
from just 16 to 42 KB brotli.

There are only 27 distinct bundle shapes across 100 routes.

Baseline composition (raw / brotli KB): 226.4 / 60.4 (react-dom), 120.3 / 28.1,
110.0 / 34.3, 32.5 / 6.1, 30.0 / 6.4, 18.4 / 5.2, 10.0 / 3.5, 0.3 / 0.2.

---

## First Load JS — worst 15

| # | Route | raw KB | brotli KB | route-only (br) |
|---|---|---|---|---|
| 1 | `/` | 721.9 | 186.6 | +42.3 |
| 2 | `/dashboard` | 720.0 | 186.1 | +41.8 |
| 3 | `/risk-reward-ratio` | 690.4 | 183.3 | +39.0 |
| 4 | `/position-sizing-guide` | 689.8 | 183.1 | +38.8 |
| 5 | `/3-month-high-breakout-stocks` *(+31 identical)* | 681.5 | 178.2 | +33.9 |
| 6 | `/stock/[symbol]` | 673.6 | 175.0 | +30.7 |
| 7 | `/plays/descending-triangles` | 660.6 | 171.9 | +27.6 |
| 8 | `/plays` | 660.5 | 171.9 | +27.6 |
| 9 | `/plays/bull-flags` | 660.2 | 171.7 | +27.5 |
| 10 | `/pickers` | 654.6 | 169.4 | +25.1 |
| 11 | `/insights/[slug]` | 652.5 | 167.3 | +23.0 |
| 12 | `/platforms` | 626.5 | 161.5 | +17.2 |
| 13 | `/markets/spx` | 618.8 | 161.9 | +17.7 |
| 14 | `/insights` | 613.7 | 160.2 | +15.9 |
| 15 | `/earnings-calendar` | 613.0 | 160.2 | +15.9 |

---

## Two assumptions that turned out to be wrong

**klinecharts is already lazily loaded.** `next/dynamic` appears zero times in
the repo, and `DashboardClient.tsx` does statically import `InteractiveChart` —
but the split happens anyway, because `InteractiveChart.tsx:721` does
`await import("klinecharts")`. Turbopack code-splits on *any* dynamic `import()`,
not just `next/dynamic`. Verified from the manifests: klinecharts sits alone in
`4d49deb46ba5e53d.js` (194.9 KB raw / 42.6 KB brotli), appears in **0 of 100**
route first-load sets, and `/dashboard`'s 11 chunks do not include it. It is
referenced as an async chunk from the `/`- and `/dashboard`-only chunks, fetched
when the chart-mode toggle flips. The missing `sideEffects` flag on the package
is real but costs nothing here, because nothing imports it eagerly.

**Source KB badly overstates bundle cost.** Comments alone are 35–38% of
`PickerResultsGrid.tsx` and `ScreenerNav.tsx`. Always measure the chunk, not the
file.

---

## Where the weight actually is

| Component | Source | raw / brotli KB | Scope |
|---|---|---|---|
| `SiteHeader` | 58 KB | 44.5 / 10.4 | 99 routes |
| `DashboardClient` + `PriceChart` + `InteractiveChart` | ~211 KB | 103.7 / 24.4 | `/`, `/dashboard` |
| `StockSymbolPageClient` | 97 KB | 70.2 / 16.4 | `/stock/[symbol]` |
| `InsightPostClient` + `PriceChart` | ~106 KB | 60.2 / 12.6 | `/insights/[slug]` |
| `ScreenerNav` | 51 KB | 44.3 / 10.5 | 35 routes |
| `PickerResultsGrid` + `ScanFooter` | ~70 KB | 34.0 / 8.6 | 32 routes |

Internals worth knowing:

- **`SiteHeader`** — 18.3 KB of the source is the `navItems` `useMemo`, a static
  nav tree carrying 69 `isActive` closures; 16.4 KB is the JSX return; ~18 KB is
  `NavDropdown` / `NavSubmenu` / `MobileNavOverlay`.
- **`DashboardClient`** — 77% of it is one 885-line function, plus ~12 KB of TA
  helpers (`rsiWilder`, `macd`, `atr`, `stochastic`, `aggregateWeeklyPoints`,
  `computeMacroSupportResistanceZones`).
- **`PriceChart`** — 79% is one 1164-line function, a hand-rolled SVG renderer.
- **`StockSymbolPageClient`** — mostly prose builders (`buildLongSummary` 6.9 KB,
  `buildTradeContext` 5.1 KB) plus an inline `AnalystTargetChart`.

---

## Third-party vs ours

Effectively all of the weight is ours. `recharts` is not a dependency at all.
`klinecharts` is the only third-party client library, and it is already split out
and never in a first load. Everything else in the shared baseline is react-dom
and the Next client runtime.

**Eagerly bundled but interaction-only:** the `InteractiveChart` and
`TradingViewChartEmbed` wrappers. `chartMode` defaults to `"basic"`
(`DashboardClient.tsx:404`) and `internalShowTradingView` defaults to `false`
(`PriceChart.tsx:341`), so neither renders until a visitor toggles.

---

## TradingView — a runtime cost, not a bundle cost

`TradingViewChartEmbed` is 3.3 KB of source that injects
`https://s3.tradingview.com/tv.js` (~500 KB) as an async script on mount and
constructs a widget. It contributes **zero bundle bytes**. The real cost is one
extra third-party connection, ~500 KB of transfer, and widget construction on the
main thread — incurred only when a visitor toggles to TradingView, on `/`,
`/dashboard`, `/insights/[slug]` and `/stock/[symbol]`. The script is cached by
its element `id` across toggles within a page load, so a second toggle is free.

---

## `PickerResultPage.tsx` is a server component

All ~73 KB of it — including `getPickerData` and `buildEntries` — ships zero
bytes to the browser, so it is excluded from the table above.

Of its nine client children, three are client components *only* because they
consume a context, with no client API of their own. They are convertible if the
context boundary moves:

- `MiniPickerCandleChart` (20.5 KB source, `useWatermarkHidden`)
- `ScreenerHeroHeading` (5.1 KB, `usePickerFilter`)
- `ScanFooter` (2.4 KB, `usePickerFilter`)

Genuinely client, with real state or handlers: `PickerResultsGrid`,
`ScreenerNav`, `PickerFilterContext`, `WatermarkVisibility`, `HowToCollapse`,
`PickerHighlightScroller`.

---

## Recommendations, ranked by KB saved per unit of risk

### 1. Delete two stray `"use client"` directives — **measured**

`app/risk-reward-ratio/RiskRewardRatioContent.tsx` and
`app/position-sizing-guide/PositionSizingGuideContent.tsx` have zero client APIs
and render `LearnShell`, which is *already* a server component importing
`ALL_LESSONS`. Those two directives drag `app/learn/lessons.ts` (69 KB) and
`app/learn/fundamentals-lessons.ts` (38 KB) — the full prose of every lesson —
into the client bundle of two pages that display nothing but a sidebar of links.

Built and measured:

- `/risk-reward-ratio`: 690.4 → 592.3 KB raw (**−98.1**), 183.3 → 154.7 KB brotli (**−28.6**)
- `/position-sizing-guide`: 689.8 → 592.3 KB raw (**−97.5**), 183.1 → 154.7 KB brotli (**−28.4**)

Two deleted lines, nothing to break. Do this one first.

### 2. Split `HomePageRouter`'s two branches — estimated, not built

`app/components/HomePageRouter.tsx` statically imports both `DashboardClient` and
`MobileHomePage` and picks between them at runtime. Mobile visitors download the
103.7 KB raw / 24.4 KB brotli desktop dashboard chunk and never execute it;
desktop visitors likewise eat MobileHomePage's 26.0 / 6.4.

Estimated ~24 KB brotli for mobile visitors on `/`. **Not built.** It touches the
LCP path and the UA-sniffing hydration logic that a Bing crawler bug already
forced a fix on once (see the `initialIsMobile` comment in that file), so it
needs care.

### 3. `next/dynamic` on `InteractiveChart` + `TradingViewChartEmbed` — **measured**

On `/` and `/dashboard`: 721.9 → 704.2 KB raw (**−17.7**), 186.6 → 182.8 KB
brotli (**−3.8**). Near-zero risk, but small — precisely because klinecharts was
already the heavy half. Worth it mainly for the raw parse-cost win on phones.

### 4. Move the three context-only picker children behind a server boundary

~28 KB of source across 32–35 routes, but already cheap once compressed. Expect a
single-digit brotli saving for a fiddly refactor. Not sized.

### 5. The 144 KB brotli / 548 KB raw baseline

The only lever that would move the median page, and it is almost entirely
framework code. Not addressable by lazy-loading.

---

## Open uncertainties

- Items 1 and 3 were measured end-to-end (built in throwaway copies outside the
  repo, then deleted). Item 2 is inferred from chunk membership and was not
  built. Item 4 was not sized.
- First Load figures are derived rather than printed by Next, and exclude CSS.
- Summing per-chunk brotli slightly *understates* what a single concatenated
  response stream would achieve.
- Item 3 saves 3.8 KB brotli while the extracted `InteractiveChart` chunk is
  larger than that, so some of its code stays shared with `PriceChart`. Whether
  that is genuine sharing or a Turbopack chunking artifact was not chased down.

---

## Reproducing this

```
npm ci
./node_modules/.bin/next build --experimental-build-mode=compile
```

Then walk `.next/server/app/**/page_client-reference-manifest.js`, eval each file
to populate `globalThis.__RSC_MANIFEST`, and for every route union
`clientModules[*].chunks` and `entryJSFiles[*]` with `build-manifest.json`'s
`rootMainFiles` and `polyfillFiles`. Normalise each chunk reference to a path
under `.next/` before deduping — the same file appears under more than one ref
format, and counting both inflates every route total.
