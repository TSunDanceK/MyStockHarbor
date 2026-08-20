# /dashboard and / — performance work (2026-08-20)

`/` and `/dashboard` are slow and now stand out against the rest of the site.
Caching stays blocked on both, but that was never the only lever.

**Why this file exists:** the context below was reconstructed and pasted into a
fresh session four separate times on 2026-08-20, because none of it lived in the
repo. Pasting it again fixes one round and nothing else. This file is the
durable copy — read it instead of asking for the background again. Same lesson
as `claude/silent-failure-traps.md` §2: a source that is not in the repo is one
a session cannot open, and it will be guessed at instead.

**Path correction made while writing this:** the working notes referred to
`app/dashboard/DashboardClient.tsx`. The real path is
**`app/components/DashboardClient.tsx`** (1,199 lines); `app/dashboard/` holds
only `page.tsx`. Line numbers quoted below were verified against `c5e16d60`.

---

## The four items, in order

1. **`getBenchmarksData` → Redis.** ✅ **DONE — #292 (`c5e16d60`).**
2. **Apply the PR-B treatment to `DashboardClient`.** Report before implementing.
3. **The seeding discard** — implement Option A-soft.
4. **`HomePageRouter`'s two-branch static import.** Last, smallest, and it
   touches UA-sniffing that a Bing crawler bug already forced a fix on.

Separate PRs. Item 1 changed the most and is already merged.

---

## Item 1 — done, and the part worth remembering

`getBenchmarksData` cached into a module-scope `Map`: per instance, dead on
every cold start, never shared, and `fetchFmpQuote` passed `cache: "no-store"`
so the Next Data Cache could not help either. A miss cost **four live FMP
calls**, on a path both `/` and `/dashboard` render through.

Now memory → Redis → FMP, 24h retention with a 5-minute freshness window.

**The guard is the significant part.** A total FMP failure produces a payload
whose every row is null. The old code cached it, poisoning **one** instance for
5 minutes. Writing that to a **shared** cache would have poisoned **every**
instance for the life of the entry — so adding Redis without `hasRealData()`
would have turned a transient upstream outage into a site-wide one, while
looking like a speedup. Same disease as the IPO bug in #289: **caching a failure
as though it were a success.**

Any future cache added in this repo inherits that question: *what does this
write when the upstream read failed?*

---

## Item 2 — the "PR-B treatment" (#286)

### What PR-B actually found on `/stock/[symbol]`

`seededHistory` only suppressed the loading **spinner**. The fetch ran
unconditionally:

```js
if (!seededHistory) setPriceLoading(true);
const [q, h] = await Promise.all([...]);   // always ran
```

So a `cache=HIT` page shipped complete, correct history in its HTML — and then
refetched the same data and threw the seed away.

### The half that makes this dangerous to "fix" naively

The seed went **300 → 500 bars**, and the sizing is the point:

- the chart renders `history.slice(-240)`
- `ma200` needs **200 prior bars** to be defined across that window
- so **440 bars is the real floor**

At 300, MA200 was undefined across roughly half the visible chart. **That is
why the client asked for 900 bars on every load** — the fetch was not
gratuitous, it was compensating for an undersized seed. Deleting the refetch
without resizing the seed would have silently degraded the chart on every stock
page.

> Generalised: **before deleting a redundant refetch, work out what the refetch
> was compensating for.** A seed that is present is not necessarily a seed that
> is sufficient.

### The resulting shape

One `Promise.all` became two independent effects:

- **history** — SKIPPED when seeded
- **quote** — still fetched, but **non-blocking**

Quote is deliberately *not* skipped: ISR HTML can be up to 900s old, and a stale
price shown as current is a correctness bug, not a perf trade. Skipping it would
also silence the stock page's `QUOTE_TOKEN` pilot sample.

### What to check on `DashboardClient`

Two questions, in this order:

1. Does it seed server-side and refetch anyway?
2. **Is each seed big enough for what actually renders?**

### Findings (audited against `c5e16d60`) — the answer inverts

**1. `DashboardClient` does NOT have PR-B's bug.** Its fetch effect
(`:553`–`:571`) is gated on `symbolCache`, not on a spinner flag, and the seed
is pre-loaded into that cache at `:364`–`:372` under
`` `${defaultSymbol}:D:2600:d` `` — exactly the key `load()` computes on mount
(`:556`). So when `seedMatchesSymbol`, `load()` hits the cache and returns at
`:557` without fetching anything. Nothing is discarded and no request is made.

**2. The seed is undersized relative to its own cache key — harmlessly, today.**
The key claims `fetchBars: 2600` (`TIMEFRAMES[0]`, `:260`), but the seed comes
from `getDailyHistory()`, capped at `MAX_CACHED_HISTORY_DAYS = 1400`
(`historyCache.ts:43`). Because it is stored under a key promising 2600, the
client will never fetch the missing ~1200 bars.

Impact is bounded and is *not* the MA200 problem PR-B had: `ma200Full` is
computed over the **full** history and only then sliced to the window
(`:591` → `:600`), and the default window is 75 bars, so MA200 needs ~274 bars
and 1400 is ample. `visibleBars` is clamped by `Math.min(historyAll.length, …)`
(`:289`, `:313`), so the only real effect is that **maximum zoom-out silently
drops from ~2600 to ~1400 bars for the seeded symbol**. Same *class* as PR-B's
300-vs-440 — a key asserting more data than exists — without the severity.

Fixing it means choosing: key the seed by its true length (correct, but
reintroduces a 2600-bar refetch on mount — PR-B's waste), or lower
`TIMEFRAMES[0].fetchBars` to 1400 (no waste, but reduces max zoom for *every*
symbol, not just the seeded one). Neither is clearly right; not worth doing on
its own.

**3. The finding that matters — the quote is never refreshed, and that blocks
item 3.** On a seed hit, `:557` does `setQuote(hit.quote)` and returns. The
quote is whatever the server minted and is never re-fetched.

Today that is safe, because `/dashboard` is `force-dynamic`
(`app/dashboard/page.tsx:50`) — the seed is minted per request, so a seeded
quote is always current.

**It stops being safe if `/dashboard` ever goes ISR.** Under ISR the seeded
quote would be up to a full revalidate window old and displayed as the live
price — precisely the correctness bug PR-B refused to accept, and why it kept
the quote fetch **non-blocking rather than skipped** while skipping history.

> **Correction (same day).** This section first called the quote refresh a
> *prerequisite* for A-soft, on the reasoning that A-soft opens the ISR door.
> **It does not.** `/dashboard` carries an explicit
> `export const dynamic = "force-dynamic"` (`app/dashboard/page.tsx:50`), and
> that stays until it is deliberately deleted — a separate, third change. So
> the intermediate state (A-soft merged, still force-dynamic) is perfectly
> safe, and nothing was blocking anything.
>
> They were still shipped together, for a better reason: **the quote refresh
> alone has no user-visible effect today**, so it would have been a PR nobody
> could verify. Bundled with A-soft it is at least exercised by the same
> change. Recorded because "X blocks Y" is the kind of claim that hardens into
> a constraint nobody re-checks.

So item 2's real deliverable is the inverse of the brief's expectation: there is
no redundant refetch to delete. What is missing is PR-B's **non-blocking quote
refresh** — worth having before ISR is ever considered, but not a gate on A-soft.

---

## Item 3 — the seeding discard, and Option A-soft

### Observed live

Loading `/dashboard` with no `?symbol=`: the server rendered **SPY**, the
browser showed **CAG**, and all five payloads were discarded and refetched.

Cause is `app/components/DashboardClient.tsx:340` — initial state reads
`localStorage.msh_last_symbol` and falls back to `defaultSymbol` only when
absent. A returning visitor whose stored symbol differs from the server's
therefore discards the entire server render. `seedMatchesSymbol` (~:344–350)
gates every seeded value (`symbolName`, `quote`, `historyAll`) on the two
agreeing.

### Option A-soft — the chosen design

- Server **always** renders `defaultSymbol` (SPY, or `?symbol=` when present).
- Client **stops overriding** from localStorage.
- On mount, read `msh_last_symbol`; if set and different from what rendered,
  show a small dismissible chip — **"Resume CAG →"** — calling the **existing**
  `chooseSymbol()` path. No reload, no new machinery.

Fixes three things at once:

1. the seed always matches, so nothing is discarded;
2. the URL always wins, so the deep-link flash goes;
3. bare `/dashboard` renders identically for everyone — **which keeps the ISR
   door open**, the exact property the cookie-based alternatives give up
   permanently.

**Cost:** one click to resume instead of zero. In exchange an explicit, visible
affordance replaces invisible state — today a returning visitor has no way to
tell why they landed on CAG.

**Decide before building:**
- chip persists vs dismisses per session;
- where it sits, so client-only rendering does not shift layout;
- whether `?symbol=` suppresses it.

### The deep-link flash (independent correctness bug)

`app/components/DashboardClient.tsx:439` — the `?symbol=` effect runs **after**
mount, so initial state at `:340` is localStorage **regardless of the URL**.
`/pickers` → `/dashboard?symbol=NVDA` shows CAG first, then swaps. This is a
correctness bug on its own, separate from the perf story, and Option A-soft
fixes it as a side effect.

---

## Item 4 — `HomePageRouter`, and the Bing crawler bug

**Read the comment block in `app/page.tsx` before touching `HomePageRouter`.**

`HomePageRouter` is a client component that started with `isMobile = null` and
returned `null` until a mount-time `window.innerWidth` check. So the
server-rendered HTML for `/` and every `?symbol=` variant contained **neither
branch's content** — no `h1`, no hero, nothing — until client JS ran.

Bing Site Scan flagged **"H1 tag missing"** across dozens of `/?symbol=...` URLs
on **2026-08-07**. The H1 was never the problem: *the whole page body was
invisible pre-hydration.*

The fix is `getInitialIsMobile()` in `app/page.tsx:52` — UA-sniff via `headers()`
to seed `initialIsMobile` so real content ships server-side. `HomePageRouter`
still runs its `window.innerWidth` listener after mount to self-correct.

**That `headers()` call is also what blocks ISR on `/`.** Any change here trades
against both the crawler fix and the caching story, which is why this item is
last.

---

## State at time of writing

- #291 MERGED (`5a82078e`) — `/learn/[slug]` ISR
- #292 MERGED (`c5e16d60`) — benchmarks Redis cache
- `main` at `c5e16d60`
- IPO column work (Priced/Expected status column, copy rewrite, Revenue and Deal
  Size removal) is **held** pending the live `/api/debug/ipo-calendar` payload —
  the parser's field-name guesses have never been checked against real data, and
  the admission filter may be testing something different from what the copy
  claims. A sandbox session **cannot** fetch that route (`403 CONNECT tunnel
  failed` to the production domain — see root `CLAUDE.md`), so it is owner-side.
