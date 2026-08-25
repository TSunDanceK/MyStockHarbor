# Trend Helper flip pickers — implementation brief

Prepared 2026-08-25 against `main` @ `6c86cc19`. Hand this whole file to Claude Code.

Four new picker pages listing stocks whose **Trend Helper (Slow)** state has confirmed a
flip within the last 4 bars. Split by direction and by timeframe:

| Page | Timeframe | Direction |
|---|---|---|
| `/stocks-with-bullish-trend-flip` | daily | bullish |
| `/stocks-with-bearish-trend-flip` | daily | bearish |
| `/stocks-with-weekly-bullish-trend-flip` | weekly | bullish |
| `/stocks-with-weekly-bearish-trend-flip` | weekly | bearish |

Four pages rather than two-with-a-toggle because that is the pattern the codebase already
proves — `/stocks-near-200-day-moving-average` and
`/stocks-near-weekly-200-day-moving-average` are two separate configs, and the comment in
the weekly one records that the W/D split is carried by the flag itself. No new UI control
is needed.

---

## Decisions already settled with the owner — do not relitigate

1. **Slow only.** HMA(55), confirm 2. Fast (HMA 21, confirm 1) is deliberately untouched so
   the dashboard chart does not change. Do not "fix" Fast's confirm count in this work.
2. **Confirmed flips only.** No pending/wobbling tier, no grey. The owner's reasoning: you
   wait for confirmation before you engage.
3. **Window is `barsSinceFlip <= 3`** — i.e. bars 0, 1, 2, 3 inclusive, four bars. On weekly
   that reads as "flipped this week or in the last three weeks".
4. **Rank by `barsSinceFlip` ascending.** Most recent flip at the top. This is a real key
   that gets displayed — do not fall back to `reasons.length`, which is the existing defect
   on six other pages.
5. **No max age beyond the 4-bar window, and no fixed item cut.** The list is allowed to be
   short. It needs a real empty state, not a broken-looking one.
6. **The first confirmation in a symbol's history is excluded.** It is HMA warm-up
   finishing, not a trend change.
7. **Weekly evaluates closed weeks only.** No repainting.

---

## Phase 1 — `lib/ta/trendHelper.ts` (shared math)

**Already committed to `main`.** Do not rewrite it or second-guess its math.

It is `tsc --noEmit --strict` clean and has been tested against the two existing production
copies:

- rolling O(n) WMA agrees with the current nested O(n·len) version to `2.03e-10` max
  absolute drift over 15,264 compared values, with identical null semantics across leading
  and interior gaps
- `computeTrendHelper` state output is **exactly identical** — 0 mismatches over 4 series ×
  2 presets, 194 transitions exercised
- HMA(55) first prints at bar 60, matching the existing implementation
- 700 symbols × 2 timeframes: 100ms (vs 329ms for the current math)

### Repoint both chart components at it

**`app/components/PriceChart.tsx`** — delete `wmaNullable`, `hmaSeries`,
`computeTrendHelper` and the local `TrendHelperSeries` type. Import instead:

```ts
import { computeTrendHelper, TREND_HELPER_SLOW, TREND_HELPER_FAST, TREND_HELPER_COLORS } from "@/lib/ta/trendHelper";
```

The two `useMemo` blocks slice `.line` and `.state` to the visible window — that still
works unchanged; keep a local type for the sliced shape:

```ts
type TrendHelperWindow = { line: Array<number | null>; state: number[] };
```

Replace the hardcoded `55, 2` / `21, 1` call arguments with the preset constants, and point
`CHART_COLORS.nctBull` / `nctBear` / `nctNeutral` / `nctMa200` at `TREND_HELPER_COLORS`.

**`app/components/InteractiveChart.tsx`** — delete `wmaSeries`, `hmaSeries`, `smaSeries`
and the inline `calc` loop inside `makeTrendHelper`. Import `computeTrendHelper`,
`smaSeries` and `TREND_HELPER_COLORS`, then rebuild `calc` as:

```ts
calc: (dataList: Array<{ close: number }>) => {
  const closes = dataList.map((d) => d.close);
  const { line, state } = computeTrendHelper(closes, trendLen, confirmBars);
  const ma200 = smaSeries(closes, 200);
  return dataList.map((_d, i) => ({
    trend: line[i] ?? null,
    ma200: ma200[i] ?? null,
    state: state[i],
  }));
},
```

Also replace the module-level `NCT_BULL` / `NCT_BEAR` / `NCT_NEUTRAL` / `NCT_MA200`
constants with `TREND_HELPER_COLORS`.

**Verification gate for Phase 1: the charts must look pixel-identical.** This phase changes
no behaviour. Open `/dashboard`, enable Trend Helper (Smooth) and (Fast) on both Basic and
Interactive, and confirm nothing moved. If anything shifted, the port is wrong.

---

## Phase 2 — flags in `lib/server/pickersBuilder.ts`

**This file is 117KB. It cannot be whole-file uploaded through the GitHub connector — that
is why this work is going to Claude Code rather than the Cowork session.** Use local
targeted edits.

For each symbol in the universe, using the daily close history already loaded for that
symbol:

```ts
import { latestTrendFlip, resampleWeeklyClosed, TREND_HELPER_SLOW } from "@/lib/ta/trendHelper";

const { trendLen, confirmBars } = TREND_HELPER_SLOW;

// Daily — closed bars only. If the price pool can contribute a live intraday
// bar to this series, drop it first; a flip that appears mid-session and
// vanishes by the close makes the page untrustworthy.
const dailyFlip = latestTrendFlip(dailyCloses, trendLen, confirmBars);

// Weekly — resampleWeeklyClosed already drops the unclosed trailing week.
const weekly = resampleWeeklyClosed(dailyBars.map((b) => ({ date: b.date, close: b.close })));
const weeklyFlip = latestTrendFlip(weekly.map((b) => b.close), trendLen, confirmBars);

const qualifies = (f: typeof dailyFlip, dir: 1 | -1) =>
  f !== null && !f.isFirstConfirmation && f.direction === dir && f.barsSinceFlip <= 3;
```

Emit four booleans plus the ranking keys:

| Field | Meaning |
|---|---|
| `trendFlipBullish` | `qualifies(dailyFlip, 1)` |
| `trendFlipBearish` | `qualifies(dailyFlip, -1)` |
| `trendFlipBullishWeekly` | `qualifies(weeklyFlip, 1)` |
| `trendFlipBearishWeekly` | `qualifies(weeklyFlip, -1)` |
| `trendFlipDailyBars` | `dailyFlip?.barsSinceFlip ?? null` — the ranking key |
| `trendFlipWeeklyBars` | `weeklyFlip?.barsSinceFlip ?? null` — the ranking key |
| `trendFlipWeekEnding` | date of the last closed weekly bar, for the weekly pages' label |

### Constraints

- **`isFirstConfirmation` must be checked, not approximated by a bar index.** In testing,
  HMA(55) first printed at bar 60, the first confirmation landed at bar 62, and the flag
  stayed true until bar 279 — because it tracks the first confirmed *state*, which persists
  until the first genuine flip. A bar-index cutoff will let warm-up artefacts through.
- **`/api/pickers` is already ~8MB.** Seven scalar fields per symbol is small, but do not
  ship per-bar arrays. If the row chart needs the coloured line, derive it client-side from
  the `chartPoints` that already ship rather than adding a parallel series.
- Do not add a third copy of the math. Import from `lib/ta/trendHelper.ts`.

---

## Phase 3 — the four pages

Each is a thin `PickerResultConfig`, modelled on
`app/stocks-near-weekly-200-day-moving-average/page.tsx`. Keep `export const revalidate = 300`
(ISR — `force-dynamic` shipped `no-store` and made every crawl pay a full render; see
`claude/picker-pages-isr-2026-08-20.md`).

Per page: `kind: "preset"`, `presetFilters: ["<the matching flag>"]`, `maxItems: 36`,
`tone: "green"` for bullish and `"red"` for bearish, and an `emptyText` that reads as a
real statement rather than a fault — e.g. *"No stocks have confirmed a bullish weekly trend
flip in the last three weeks."*

Weekly pages should surface `trendFlipWeekEnding` in the body copy so nobody has to guess
which week the signal refers to, and should render bar counts as **weeks**, not bars.

### Registration — all of these, or the pages are orphaned

- `app/sitemap.ts`
- `lib/navSections.ts`
- `app/components/ScreenerNav.tsx`
- `app/components/SiteHeader.tsx`
- `app/pickers/page.tsx` and `app/pickers/PickersClient.tsx` (the `title.includes(...)`
  href mapper)
- `public/llms.txt`

Run `scripts/check-doc-citations.mjs` before pushing — it fails on any new dangling
`claude/` citation.

---

## Two open items to raise with the owner, not to decide alone

1. **The display column.** "Flipped 2 days ago" needs somewhere to live in the grid. That
   is the *same* blocked column that six existing picker pages are waiting on to stop
   sorting by `reasons.length`. If that work has landed, use it. If not, these pages ship
   correctly ordered by a key the user cannot see — which is exactly the failure mode the
   owner has been fixing. Flag it rather than inventing a second column mechanism.
2. **Indexing.** GSC currently shows 582 URLs discovered-but-never-crawled and crawl-budget
   starvation. Adding four more thin pages to `sitemap.ts` immediately may be the wrong
   call. Consider shipping them out of the sitemap (or via `lib/noindexPickerPages.ts`)
   until they demonstrably render with content, then flipping them in. Owner's decision.

---

## Definition of done

- `tsc --noEmit` clean, `eslint` clean
- Charts pixel-identical after Phase 1
- All four pages return a plausible list on a preview deploy, ordered most-recent-first
- Weekly pages show the week-ending date
- Empty state reads as a statement, not an error
- Branch → PR → Vercel preview for the owner to check on their phone → squash merge
