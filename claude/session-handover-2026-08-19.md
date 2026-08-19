# Session handover — 2026-08-19

Mobile screener/earnings work, the plays self-fetch fix, and an unfinished
condition-counts feature. Read this before touching `PickerResultsGrid.tsx`,
`ScreenerNav.tsx` or any of the four builders.

---

## 1. Merged to main today

| PR | SHA | What |
|---|---|---|
| #259 | `01a7a44` | Screener mobile rows: whole row expands, only panel buttons navigate |
| #260 | `fee5f46` | Earnings calendar: full-width rows on a phone instead of a 980px table |
| #261 | `a90f6c2` | Row sparklines, chart in the expanded panel, `ma50` + breakout overlays |
| #262 | `9c5771a` | `marketState.ts` + `bullFlagsBuilder` self-fetch fix |
| #263 | `1f2a00c` | `playsBuilder` + `descendingTrianglesBuilder` self-fetch fix |
| #265 | `dfb1e25` | Restore chart view on mobile (reverts one decision from #261) |

All verified live on production by the owner.

---

## 2. UNFINISHED: `feature/screener-condition-counts`

**Branch exists, is NOT merged, and is NOT user-visible yet.** Two commits on
it, both verified compiling:

- `c1e4056` — `PickerFilterContext`: adds `conditionCounts` / `setConditionCounts`
- `0b5980d` — `PickerResultsGrid`: computes the counts, publishes via context

### The feature

Next to each of the 25 checkable conditions in the screener sheet, show how
many of the **current results** also satisfy it — i.e. what you'd be left with
if you ticked it. The screener's standing problem is that a condition tells you
nothing until you press it; a 0 marks a dead end before it costs a tap.

Counted against `filteredEntries` so the numbers compose: predicates AND, so
(current results) ∩ (this condition) is exactly what ticking produces. A
condition already ticked therefore counts every current result. The
`predicates.length` guard exists for `hideUntilFiltered` pages, where
`filteredEntries` is empty until something is selected — counting against that
would report 0 for all 25 on the one page where the visitor most needs to know
where to start.

### REMAINING WORK — two edits

**(a) `app/components/ScreenerNav.tsx` — the display. Not yet written to the repo.**
Verified locally against `main`, `ts.transpileModule` clean. Six spots:

1. Line ~194: `const { selectedFilters, toggleFilter } = usePickerFilter();`
   → add `, conditionCounts`

2. Replace the `rowClass` block (~line 227) with:
```ts
const count = conditionCounts ? conditionCounts[key] ?? 0 : null;
// A 0 is dimmed but still tappable. Disabling it would be the obvious move
// and the wrong one -- a checkbox that silently refuses to tick is its own
// puzzle, and unticking something else can make this row live again, which
// the visitor can only discover if the row still behaves like a control.
const dead = count === 0 && !checked;
const rowClass = [
  "screenerNavItem screenerNavCheckable",
  checked ? "checked" : "",
  dead ? "dead" : "",
].filter(Boolean).join(" ");
```

3. The linked branch's checkbox `aria-label` (~line 255):
```tsx
aria-label={
  count == null
    ? `Filter this page by ${item.label}`
    : `Filter this page by ${item.label}, ${count} of the current results match`
}
```

4. In the linked branch, between `.screenerNavLabel` and `.screenerNavGo`:
```tsx
{count != null ? (
  <span className="screenerNavCount" aria-hidden="true">{count}</span>
) : null}
```
(`aria-hidden` because the checkbox's own label above already carries it.)

5. In the plain-`<label>` branch, after `.screenerNavLabel`:
```tsx
{count != null ? <span className="screenerNavCount">{count}</span> : null}
```

6. CSS, immediately before the existing `.screenerNavGo` rule:
```css
/* Sits hard right of the label, so the counts form a readable column
   down the sheet rather than trailing each label at a different x. */
.screenerNavCount {
  flex: 0 0 auto; margin-left: auto; padding: 1px 7px; border-radius: 999px;
  font-size: 10.5px; font-weight: 900; font-variant-numeric: tabular-nums;
  background: rgba(148,163,184,0.14); color: rgba(226,232,240,0.82);
}
.screenerNavCheckable.checked .screenerNavCount { background: rgba(34,197,94,0.22); color: #dcfce7; }
/* Zero: readable but visibly spent, and the whole row dims with it. */
.screenerNavCheckable.dead { opacity: 0.45; }
.screenerNavCheckable.dead .screenerNavCount { background: rgba(148,163,184,0.10); }
/* The count has taken the auto margin, so the chevron just follows it. */
.screenerNavCount + .screenerNavGo { margin-left: 6px; }
```

**(b) `app/components/PickerResultsGrid.tsx` — remove a duplicated effect.**
I introduced this. There are now TWO identical copies of:
```ts
useEffect(() => {
  setMatchCount(predicates.length ? filteredEntries.length : null);
  return () => setMatchCount(null);
}, [filteredEntries.length, predicates.length, setMatchCount]);
```
one immediately before the `conditionCounts` block and one immediately after.
Delete the second. Inert (identical deps, idempotent setter, both clear on
unmount) but misleading to read.

### Verification once both land

On `/oversold-stocks-today` with Oversold ticked, the Oversold count must equal
the match count in `ScreenerFilterBar` above. If it doesn't, the flags on
`entries` are the suspect, not the arithmetic — the counts under-report silently
when a flag is missing, which looks like a dead end when it isn't.

---

## 3. Still owed: `pickersBuilder` self-fetch

The last of four. `lib/server/pickersBuilder.ts` still opens with
`fetch(\`${origin}/api/market\`)`. Same two-line fix as the other three:

```ts
import { readMarketState } from "./marketState";

// replaces the file's own fetchJSON + fetchMarket pair
async function fetchMarket(_origin: string, _forceFresh = false): Promise<MarketPayload> {
  return readMarketState();
}
```
`fetchJSON` has no other callers in that file. `origin` stays as an underscored
param so no page or route needs changing.

Lower urgency than the plays ones were: the warm cron cache masks the throw, so
it only bites on a cold rebuild. But it's the file behind every screener page,
and at 117KB it is a poor candidate for a whole-file re-upload through the
GitHub connector — apply it locally.

---

## 4. Corrections to existing docs

**`claude/picker-charts-off-payload-2026-08-06.md` is STALE at the last
paragraph.** It states that `/bullish-divergence-stocks` and
`/bearish-divergence-stocks` render 20 empty charts because the Divergence
section is built without `keepChartPoints`. That was true on 6 Aug and is not
true now: `pickersBuilder` was later changed so every `signalRecords` entry
ships its `chartPoints`, and `PickerResultPage`'s `entriesFromSection` /
`buildEntries` fall back to that lookup. Confirmed live by the owner today —
the divergence pages draw charts, MACD pane and all.

I repeated that stale claim twice today before checking the code. Worth fixing
the note in that file.

---

## 5. Open PRs not from this session

- **#264** — Move sector pill row out of the hero to the foot of the sector news page
- **#246** — SK hynix (SKHY) bottlenecks page
- **#115** — `/feedback` page, blocked on Resend domain verification

---

## 6. Smaller outstanding items

- `toneBorder` in `PickerResultsGrid.tsx` has its green/red branches in a
  different order than before — a transcription slip of mine. Functionally inert
  (each branch tests a distinct tone and returns). Tidy next time the file is open.
- `/stocks-down-from-highs` and `/stocks-down-20-percent` still return the
  `"none"` chart overlay. Everything else routes to a line. Left alone because
  it isn't clear what distinguishes them from `/stocks-down-20-from-all-time-highs`,
  which already gets `ath` — needs an owner decision, not a guess.
- `EARNINGS_BACKFILL_KEY` guards `force=1` on `/api/bull-flags` as well as the
  earnings backfill. The name is misleading now. Renaming means minting a new
  value (it's marked Sensitive, so nobody can read the current one) — bundle it
  with the rotation that the July security audit already recommended.
- Screener rework steps still to do: qualifying-condition chip inline on the
  row (currently chart-view only); earnings calendar sparklines (needs a data
  decision — `EarningsListItem` carries no history).
- Merging `/plays/*` onto the shared picker components. This is where redirects
  would finally matter; nothing shipped today changed a URL.

---

## 7. Two things to know about working on this repo through the connector

**Every edit is a whole-file upload.** There is no patch API. That is fine for a
15KB module and unreasonable for `pickersBuilder.ts` at 117KB or
`PickerResultsGrid.tsx` at 64KB. For the big files, applying the change locally
is faster and safer. Do NOT reconstruct a large file from earlier context to
save a read — that is exactly how the duplicated effect in §2(b) got in.

**Preview and production share one Upstash instance.** From
`claude/picker-charts-off-payload-2026-08-06.md`: the Redis key version is the
only thing separating them, so browsing picker pages on a PR preview writes to
the same `msh:pickers:v9` payload and `msh:picker-charts:v1` hash that
production reads. Bump the key version for any change to payload shape.

Related: previews cannot cold-build pickers, because the market self-fetch is
refused there. After the `marketState` change the plays builders no longer have
that problem; `pickersBuilder` still does until §3 lands.
