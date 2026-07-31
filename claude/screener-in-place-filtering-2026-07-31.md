# Screener: in-place filtering, predicate engine, sticky bar — 2026-07-31

Everything below is **merged and live on production**. Five PRs: #192, #193, #194, #195 (and the
Buy/Sell Signals work merged direct).

---

## Why any of this happened

Started as an SEO conversation: how to rank for things people actually type, like
"cheap semiconductor stocks". The blocker turned out not to be content — it was that landing on
`/oversold-stocks-today` from Google was a dead end. You could see oversold stocks and nothing else.
Refining meant navigating to `/stock-screener` and starting over, which on mobile also closed the
sheet you were standing in.

So the day was spent making every condition page a working screener, then building the filter engine
that makes fundamentals filtering a config change rather than a feature.

---

## What shipped

**All 14 condition pages filter in place.** They ship the FULL analyzed universe with their own
condition seeded as an already-ticked checkbox, instead of the server pre-filtering the entry list.
Untick it and the page becomes the Advanced Screener where it stands; add a second condition and it
ANDs properly. No navigation, no refetch, mobile sheet stays open.

**Naming unified.** `/stock-screener` is "Advanced Screener" in the top nav, the sidebar and its own
H1. Was three different names. Top-nav Pickers dropdown reads "Advanced Screener" / "Basic Pickers
Page".

**Field registry + predicate model** (`lib/screenerFields.ts`). 33 filterable fields described once.
One `Predicate[]` replaced two hardcoded arrays.

**Sector and industry filtering.** No new data — `fundamentalsCache` already stored and returned
both; sector simply wasn't reaching the entry.

**"Add a filter" search box.** One input matching field names AND category values. Numeric filters
with min/max rows.

**Applied-filter chips** above the results, removable in one tap.

**Sticky Select Screener bar** with an applied-filter count badge.

---

## The architecture worth understanding before touching anything

### The SEO invariant

This is the thing that must not break. Condition pages ship the whole universe, but
`useState`'s initial value is used **during the server render too** — so the SSR'd HTML contains
only that condition's matches. Crawlers never tick a checkbox, so they only ever see the page's real
content. `seoEntries` (a server-side filtered subset) drives the JSON-LD `ItemList` and the "Live
matches" count for the same reason.

**If you change how `initialFilters` is seeded, re-check the SSR output.** Everything about these
pages ranking depends on it.

### Predicates

```ts
{ kind: "flag",     field: "oversold" }
{ kind: "category", field: "industry", values: ["Semiconductors"] }
{ kind: "number",   field: "peRatio", max: 15 }
```

Predicates AND with each other. Values within one category predicate OR. One predicate per
`(kind, field)` — ticking a second sector extends the existing predicate's `values` rather than
appending another, which is mechanically what makes them OR.

A missing value **never** passes a predicate. Deliberate: a stock with no earnings has no P/E, so it
isn't "cheap", it's unknown. Same for an unwarmed sector.

`PickerFilterContext` still exposes `selectedFilters` and `selectedSectors` as derived views, so
ScreenerNav's checkboxes work unchanged. `PickerResultsGrid` runs one evaluator over `predicates`.

**A numeric filter needs no new code.** `{ kind: "number", field: "peRatio", max: 15 }` already
filters correctly. Adding a field is one entry in `NUMBER_FIELDS`.

### Value extraction

`valueForField` in `PickerResultsGrid.tsx` resolves a registry key to a value. Everything is a plain
`ResultEntry` property except `price` / `changePct` / `volume`, which fall back to end-of-day data on
a price-pool miss. That lives in the grid, not the registry, so `lib/screenerFields.ts` stays free of
component imports.

### Buy/Sell Signals are deliberately separate

They keep `kind: "buySignals"` / `"sellSignals"` so their bespoke scoring survives — "6 of 9 bullish
conditions met", the score pill, `BUY_REASON_DEFS` chips. They opt into in-place filtering via
`presetFilters` instead. Rows meeting zero conditions render with no note, no pill and no chips.

---

## Gotchas paid for in blood today

### `position: sticky` has TWO independent killers

Both must be satisfied. Fixing one and assuming you're done is exactly the mistake made here.

1. **A scroll-container ancestor breaks it.** Per the CSS Overflow spec, a non-visible value on one
   axis forces the other to compute as `auto`. So `overflow-x: hidden` silently makes a scroll
   container. Use **`overflow-x: clip`** — paired with `visible`, neither value is coerced, and
   `clip` never creates a scroll container. (Same rule broke the results table's sticky header in
   July.)
2. **A sticky element only travels within its own parent's box.** Sticking a bar to a wrapper that's
   exactly as tall as the bar gives it nowhere to go. Put the sticky on an ancestor that actually
   spans content.

### `backdrop-filter` reparents `position: fixed` descendants

Like `transform` and `filter`, it makes an element a containing block for fixed children. Adding
blur to `.screenerTriggerWrap` meant the Select Screener overlay's `position: fixed; inset: 0`
started meaning *that bar* rather than the viewport — so the sheet opened anchored to the button.
**Never put backdrop-filter on an ancestor of a fixed overlay.**

### iOS specifics

- Inputs under **16px** force a page zoom on focus. Both screener inputs are exactly 16px at touch
  widths. Don't "fix" this with `maximum-scale=1` — that kills pinch-zoom site-wide.
- `overflow: hidden` on `<body>` does **not** lock scroll on iOS. Pin with `position: fixed` at a
  negative offset and restore on close.
- `overscroll-behavior: contain` on a modal's scroller stops scroll chaining into the page.

### The `<style>` blocks are JS template literals

**A backtick in a CSS comment terminates the string and breaks the build.** Did this twice today.
Before pushing, count backticks inside the template.

### Verify pushes by blob SHA

`create_or_update_file` returns the blob SHA. Compare it to `git hash-object` on the local file. This
caught two real divergences today where the pushed content differed from what had been syntax-checked
— once harmlessly (a comment), once with functional changes that had never been compiled.

---

## Outstanding — the four things

### 1. The pill shows the page, not the filter  *(bug, live, ~30 min)*

`ScreenerNav`'s `currentLabel` is derived from `currentHref` — it looks up which nav item matches the
URL. So on `/oversold-stocks-today` with Overbought ticked, the H1, eyebrow and chip all say
Overbought and the pill still says "Oversold".

Fix: drive it off `predicates` like `ScreenerHeroHeading` already does. None → page name; one →
that filter's label (`fieldLabel`); two or more → "Custom". Self-contained in `ScreenerNav`, no new
props.

### 2. Numeric filters apply with no bounds  *(judgement call)*

Selecting "PE Ratio" in the search box adds `{ kind: "number", field: "peRatio" }` immediately. An
unbounded numeric predicate matches any stock that *has* the value — so it silently excludes
loss-making companies before you've typed anything.

Either make it inert until a bound is entered (needs a "pending field" state in
`ScreenerFilterSearch`), or label the row so it's visible. Currently undecided.

### 3. "Build Screener" nav item  *(check)*

`SiteHeader` still has `Build Screener` → `/pickers#custom-screener`. That anchor may no longer
exist. Verify or repoint.

### 4. URL sync via `replaceState`  *(the one with actual value)*

Not polish. Predicates serialise to query params naturally — this is why the model was built.

- Filtered states become shareable and bookmarkable
- Use `history.replaceState`, **not** `router.push` — a Next navigation unmounts the mobile sheet
- Keep the path stable and use query params, so back/forward don't break
- Self-referencing canonical to the clean path so Google only indexes the preset version
- Then: **preset pages generated from combinations**. `/cheap-semiconductor-stocks` becomes
  `[industry=Semiconductors, peRatio<15]` in a page config. That's the SEO payoff for everything
  built today, and it's currently unrealised.

Also worth adding at that point: when a selection exactly matches another preset, surface
"There's a dedicated page for this → …". Honest internal link, feeds the crawl graph.

---

## Known data gaps

- **Sector/industry coverage fills in over weeks.** Profiles warm 120 symbols per run on a 30-day
  TTL. Unwarmed symbols have no sector and sit outside any sector filter. Self-healing.
- **Industry is thin at this universe size.** ~150 industries over ~553 symbols ≈ 4 each.
  Semiconductors will be fine; the long tail won't. Only generate preset pages for industries with
  enough constituents to be worth landing on.
- **No quality metrics.** No ROE, ROA, debt/equity or current ratio. So "cheap" works today,
  "cheap AND high quality" needs those added to the warm cron first — `ratios-ttm` already has them.
- **`RESULT_SAFETY_CAP` is 900**, universe ~553. Was 500 and silently truncating the lowest-scoring
  symbols, which is exactly where single-condition matches live.
