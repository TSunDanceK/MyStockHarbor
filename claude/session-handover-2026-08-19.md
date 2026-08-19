# Session handover — 2026-08-19

Mobile screener/earnings work, the plays self-fetch fix, and the condition-counts
feature. Read this before touching `PickerResultsGrid.tsx`, `ScreenerNav.tsx` or
any of the four builders.

*Updated later on 2026-08-19: §2 is now closed and shipped. §3 is still owed.*

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
| #268 | `5e1d8fe` | Upcoming IPOs: expandable rows on a phone |
| #269 | `181cb06` | Screener: per-condition match counts in the filter sheet |

All verified live on production by the owner.

---

## 2. DONE: `feature/screener-condition-counts` (PR #269, squashed as `181cb06`)

Shipped and verified on production. Left here because the reasoning is worth
keeping, not because anything is outstanding.

### The feature

Next to each of the 25 checkable conditions in the screener sheet, how many of
the **current results** also satisfy it — i.e. what you'd be left with if you
ticked it. The screener's standing problem was that a condition told you nothing
until you pressed it; a 0 marks a dead end before it costs a tap.

Counted against `filteredEntries` so the numbers compose: predicates AND, so
(current results) ∩ (this condition) is exactly what ticking produces. A
condition already ticked therefore counts every current result. The
`predicates.length` guard exists for `hideUntilFiltered` pages, where
`filteredEntries` is empty until something is selected — counting against that
would report 0 for all 25 on the one page where the visitor most needs to know
where to start.

A zero row is dimmed but still tappable. Disabling it would be the obvious move
and the wrong one: unticking something else can make the row live again, and the
visitor can only discover that if it still behaves like a control.

### What shipped

- `c1e4056` — `PickerFilterContext`: `conditionCounts` / `setConditionCounts`
- `0b5980d` — `PickerResultsGrid`: computes the counts, publishes via context
- `34d253c` — `ScreenerNav`: badge, `dead` state, count in the checkbox
  `aria-label`, CSS (`.screenerNavCount` and friends, immediately before
  `.screenerNavGo`)
- `707db78` — removes the duplicated `setMatchCount` effect `0b5980d` left behind

### Verified on the preview, by the owner

On `/oversold-stocks-today` with Oversold ticked: badge reads **116**, matching
both the page's "116 of 700" and the Go button. Overbought and Best Trend read
**0** and dim. Unticking Oversold widens the base to 700 and every other count
recomputes upward — confirming the numbers are live and composing, not a static
tally. Sell Signals reading 116 alongside Oversold's 116 was checked and is real:
it moved as soon as the base set moved, which a stuck flag would not do.

---

## 3. STILL OWED: `pickersBuilder` self-fetch

The last of four. `lib/server/pickersBuilder.ts` still opens with
`fetch(\`${origin}/api/market\`)`.

Exact location as of `181cb06` — **3421 lines, 117,761 bytes**:

- line 2256 — `async function fetchJSON<T>(url, forceFresh = false)`
- line 2268 — `async function fetchMarket(origin, forceFresh = false)`
- line 2332 — the only call site: `const market = await fetchMarket(origin, forceFreshMarket);`

Replace the `fetchJSON` + `fetchMarket` pair (lines 2256–2270, under the
`/* ---- fetchers ---- */` banner) with:

```ts
import { readMarketState } from "./marketState";

// replaces the file's own fetchJSON + fetchMarket pair
async function fetchMarket(_origin: string, _forceFresh = false): Promise<MarketPayload> {
  return readMarketState();
}
```

`fetchJSON` has no other callers in that file. `origin` stays as an underscored
param so no page or route needs changing.

**This has to be applied locally.** At 117KB it is far past what the GitHub
connector can take — every edit there is a whole-file upload (see §7), and a file
this size cannot be reproduced through it safely or at all. It is a two-minute
job with a local clone and a text editor.

Lower urgency than the plays ones were: the warm cron cache masks the throw, so
it only bites on a cold rebuild. But it's the file behind every screener page,
and until it lands previews still cannot cold-build pickers.

---

## 4. Corrections to existing docs

**`claude/picker-charts-off-payload-2026-08-06.md` is STALE at the last
paragraph.** It states that `/bullish-divergence-stocks` and
`/bearish-divergence-stocks` render 20 empty charts because the Divergence
section is built without `keepChartPoints`. That was true on 6 Aug and is not
true now: `pickersBuilder` was later changed so every `signalRecords` entry ships
its `chartPoints`, and `PickerResultPage`'s `entriesFromSection` / `buildEntries`
fall back to that lookup. Confirmed live by the owner on 19 Aug — the divergence
pages draw charts, MACD pane and all.

The stale claim was repeated twice before the code was checked. **Still to do:**
fix the note in that file itself; this entry is the only record so far.

---

## 5. Open PRs not from this session

- **#246** — SK hynix (SKHY) bottlenecks page
- **#115** — `/feedback` page, blocked on Resend domain verification

---

## 6. Smaller outstanding items

All three of the first items live in `PickerResultsGrid.tsx`, so they are one
sweep whenever that file is next open **locally**:

- `toneBorder` has its green/red branches in a different order than before — a
  transcription slip. Functionally inert (each branch tests a distinct tone and
  returns).
- Line 347's decorative rule on the `// ── cell formatters` comment lost two
  box-drawing characters during the `707db78` upload. Zero functional effect;
  an artifact of the connector having no patch API.
- `/stocks-down-from-highs` and `/stocks-down-20-percent` still return the
  `"none"` chart overlay. Everything else routes to a line. Left alone because
  it isn't clear what distinguishes them from `/stocks-down-20-from-all-time-highs`,
  which already gets `ath` — needs an owner decision, not a guess.

Elsewhere:

- `EARNINGS_BACKFILL_KEY` guards `force=1` on `/api/bull-flags` as well as the
  earnings backfill. The name is misleading now. Renaming means minting a new
  value (it's marked Sensitive, so nobody can read the current one) — bundle it
  with the rotation the July security audit already recommended.
- Screener rework steps still to do: qualifying-condition chip inline on the row
  (currently chart-view only); earnings calendar sparklines (needs a data
  decision — `EarningsListItem` carries no history).
- Merging `/plays/*` onto the shared picker components. This is where redirects
  would finally matter; nothing shipped today changed a URL.
- Rebuild `/about` as a proper E-E-A-T page (named operator, methodology,
  editorial stance). Currently 273 lines. On a finance site under indexing
  recovery this feeds trust signals sitewide, and it needs real facts about the
  operator rather than anything invented.

---

## 7. Two things to know about working on this repo through the connector

**Every edit is a whole-file upload.** There is no patch API. That is fine for a
15KB module and unreasonable for `pickersBuilder.ts` at 117KB. `ScreenerNav.tsx`
(50KB) and `PickerResultsGrid.tsx` (64KB) both went up successfully on 19 Aug,
but only because every push was verified afterwards by comparing the returned
blob SHA against `git hash-object` on the local copy — which is what caught the
two lost box-drawing characters in §6. **Verify the SHA every time; without it a
whole-file upload is an unchecked retype of the file.** For the big files,
applying the change locally is faster and safer. Do NOT reconstruct a large file
from earlier context to save a read — that is how the duplicated effect in the
old §2(b) got in.

**Preview and production share one Upstash instance.** From
`claude/picker-charts-off-payload-2026-08-06.md`: the Redis key version is the
only thing separating them, so browsing picker pages on a PR preview writes to
the same `msh:pickers:v9` payload and `msh:picker-charts:v1` hash that production
reads. Bump the key version for any change to payload shape.

Related: previews cannot cold-build pickers, because the market self-fetch is
refused there. After the `marketState` change the plays builders no longer have
that problem; `pickersBuilder` still does until §3 lands.
