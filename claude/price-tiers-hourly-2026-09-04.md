# Tier 2 to hourly, and why the on-demand quote path did not need building

Reverses a deliberate decision from 1 September, knowingly. The reasoning lives
in `lib/server/priceTiers.ts`'s own header ("30 IS DELIBERATE, AND SO IS THE FACT
THAT IT IS NOT 60 YET"), which is kept intact below the new note rather than
overwritten. The owner's tiering doc states the objection this way:

> *"picker lists render a % change on every row — during a volatile session an
> hour-old change is visibly wrong to anyone checking against another source."*

That objection was never about cost, so no cost finding since answers it. Two
things do.

---

## Why now

**1. The rendering surface throws the freshness away.** With picker routes on a
3600s ISR window, a picker page *cannot display* anything fresher than an hour
whatever the pool policy says. Refreshing the tail every 30 minutes is then spend
on freshness the page discards. That argument did not exist on 1 September.

**2. It never reaches the pages that look like quote pages.** This is the part
worth checking rather than assuming, and it was checked by reading every
`readPricePoolBulk` caller:

| reads the price pool | does not |
|---|---|
| picker rows (`PickerResultPage`) | **the stock detail page** |
| sector panels | **the dashboard** |
| earnings calendar | |
| fundamentals (market cap, P/E) | |
| tier ranking, eviction sweep | |

The stock page and the dashboard both fetch `/api/quote` client-side on every
load. **That route has its own 60-second Redis cache and never consults the
pool**, so their displayed price is ≤60s old at any tier. The 1 September
objection, relocated to a page a reader would spot-check against a broker, does
not land — because that page was never on the pool.

**3. The product position.** No intraday candles, aimed at screening and longer
horizons, with TradingView as the affiliate line for anyone who needs a live
tick. Hourly prices are a position, not a degradation — *provided the age is
stated*, which `ScanFooter` already does.

---

## The change

```
Tier 1   presets + the 100 most-traded    15 min   (interval unchanged)
Tier 2   everything else                  60 min   (was 30)
```

### 200 is derived, not typed

`TIER1_MAX` did not exist before this: tier 1's size was whatever five per-signal
caps happened to sum to after de-duplication. Production logged it at **384, 403
and 475 on three consecutive runs.** A quantity that moves by ninety names
between runs is not a policy, and nothing stated what it should be.

The rule, and it produces the owner's number rather than being fitted to it:

```
PRESET_UNIVERSE.length   100   hand-curated mega-caps — the tickers a
                               first-time visitor is most likely to recognise
TIER1_TRADED_HEAD        100   the head of the dollar-volume ranking, which is
                               "whose stale price would be NOTICED"
                         ---
                         200
```

`tier1CapFor(presetCount)` is pure and exported, so the check **runs** it. Grow
the curated list and the fast tier grows with it, which is right: those names
were added because somebody thought they mattered.

**Deliberately not a share of the universe.** At 3,000 symbols a 28% share would
put 840 names in the 15-minute tier — 3,360 calls/hour for the fast tier alone —
and nothing about a bigger universe makes more names worth watching closely. The
head of the traded list is the same head.

**When the cap binds, the base survives.** `selectTier1` already assembled
base-first (presets → dollar volume → movers → *then* searched and rendered
rows); slicing the assembled union makes that ordering load-bearing. A busy week
cannot evict the curated mega-caps and a quiet one cannot shrink the tier.

### The coupling check was re-derived, not adjusted

`check-price-tiers` carried `const TARGET_FAST = 500` — an assumption about tier
1's size from when it had none. It now reads `tier1CapFor(presetCount)`, counting
`PRESET_UNIVERSE` from source. The fit assertion goes from *"2,200 calls/hour
against 6,720 usable"* to **1,300 against 8,400**, and — the part that matters —
it now passes at 3,000 as well, so the tail no longer has to move as part of the
growth step. That pairing was the reason 30 was held; moving early for the ISR
window discharges it.

### The footer at a four-times spread

`formatPriceWindow` prints the **observed** oldest-to-newest range from the rows
that actually took a pooled price — `Prices 14:05-14:20 UTC` — not the policy. So
widening the split needed no change there, which is the property that made
widening it safe.

At **09:00 UTC with the gate shut**: the window closed at 21:00 UTC, tier 2's
last refreshes span the hour before it, so the footer reads roughly
`Prices 20:00-21:00 UTC · market closed`. A one-hour spread, twelve hours old,
explicitly labelled. Honest at a glance, and the "market closed" half is what
stops a frozen number reading as a broken one.

---

## What this saves: almost nothing, and that is the honest answer

| | effect |
|---|---|
| FMP calls | ~332 symbols × 1 fewer refresh/hour ≈ **330 calls/hour saved** against a budget at **11.4% of cap**. Immaterial. |
| FMP bandwidth | ~0.3 KB a quote — **~100 KB/hour**. Noise. |
| Redis bandwidth | 220 B a symbol; the pool is **<1%** of the bill. Nil. |
| Redis commands | Unlimited on this plan. **Zero value.** |
| Function invocations | warm-price-pool runs the same 288 times; it just writes fewer rows. **Small.** |

**The justification is coherence with the ISR change, not a saving.** Stated
plainly rather than dressed up, because a cost story here would be a fabricated
one.

---

## B6 — the on-demand quote path already exists, and is already bounded

The addendum specified a read-through refresh with a stampede guard and a stated
ceiling. **All three are already in `lib/server/quoteData.ts`.** Question 1 first,
because everything else was conditional on it:

**What `/api/quote` does today.** Read `msh:quote:v1:<SYM>` (60s TTL) → on a hit,
serve it → on a miss, join a per-instance in-flight promise if one exists →
otherwise fetch one quote from FMP, write it back, serve it.

That is exactly the shape asked for, one cache down: it refreshes on stale,
writes back so the next reader benefits, and de-duplicates concurrent requests
for the same symbol.

**The ceiling, item 4.** `fetchQuoteFromFmpUncached` calls
**`tryReserveFmpCallSlot()`** — not `reserveFmpCallSlot`, deliberately: it does
not queue. When the minute is spent it returns an empty quote immediately rather
than waiting 20 seconds. So the bound is not (universe / window) but something
stronger and already enforced:

```
hard ceiling  =  the 200/min guard itself, refused at the call site
worst case    =  a burst degrades to an absent price, never to overspend
```

That holds at 762, 1,500 and 3,000 symbols identically, because it is a rate
limit rather than a function of the universe. The route is additionally behind
BotID **Deep Analysis** and the quote-token gate.

**Item 5, `/dashboard`.** The FMP path from that route is `/api/quote`, which
carries every guard above, so the ceiling does make an extra gate unnecessary
*for FMP spend* — the answer the addendum asked for explicitly. What remains is
Vercel **function invocations** on an ungated force-dynamic route, which is the
known gap already on the traffic-audit list and is unchanged by this PR in either
direction.

**Two limits, stated rather than glossed:**

- The in-flight dedupe is **per lambda instance**, so N warm instances can make N
  concurrent calls for one cold symbol. Bounded by the minute guard, not by the
  dedupe.
- A symbol viewed continuously costs one call per 60s — 60/hour. Trivial for the
  handful of symbols anyone actually watches; the guard is what stops it
  generalising.

**Nothing was built for B6.** Building a second read-through path beside the one
that exists would be two answers to "how fresh is a quote", which is the shape
this codebase keeps paying for.

### And the tier cut does not touch it

Because `/api/quote` never reads the pool, moving 300-odd symbols from the
15-minute tier to the hourly one changes nothing a stock-page or dashboard reader
sees. The freshness change lands only where it was intended: picker rows, which
after the ISR change render hourly anyway.

---

## Not done, deliberately

- **Tier 1's 15-minute interval is unchanged.** Stock detail pages fetch price
  client-side per symbol on demand; that is the cheap freshness and the one that
  matters to a first-time visitor.
- **Tier 1 membership is still attention-based.** Not market cap — the 1 September
  evidence stands: a live picker list showed FSLY at $3.33B directly above MSFT
  at $3.72T. Dollar volume measures what is being *traded*.
- **The tier-1 cut was not softened to avoid B6.** 200 is the owner's number and
  the on-demand path turned out not to need building.
