# Tombstone with expiry on stale-bar eviction

Owner's decision, 2026-09-04: **not permanent, not absent.**

## 0. The stale-bar path did land

`claude/eviction-stale-bars` merged as **#417 (`e5bbc2f3`)**, before #418. The
route exists, `evictedByStaleBars` is on the run record, and this is a follow-on
rather than something to fold back in.

## Why a tombstone is needed at all now, and was not before

`evictSymbol`'s own comment says the eviction log *"deliberately does NOT gate
re-admission"*. **That was correct while absence was the only route.** An
absence-evicted symbol is missing from the screener, so discovery never offers it
again — there is nothing to gate.

The stale-bar route broke the assumption. A stale-barred symbol **is** in the
screener response, by construction — that is the entire reason the signal exists,
because FMP's `isActivelyTrading` says it is alive. So discovery re-offers it on
the next build:

```
evict -> re-admit -> still stale -> corroborate over
EVICTION_CORROBORATION_DAYS -> evict again
```

Each round deletes and rebuilds that symbol's history, fundamentals, news and
chart series for nothing.

## 1. The period, derived

```
EVICTION_STALE_BAR_WEEKDAYS   63   the bars whose ABSENCE convicted it
EVICTION_TOMBSTONE_WEEKDAYS   21   Math.round(63 / 3)
```

**The rule: the tombstone lapses once the symbol has had the chance to print a
third of the bars whose absence caused the eviction.** Same unit as the cause,
derived from it, and it moves when the threshold moves — which a typed `21` would
not, and that is how `EARNINGS_BATCH_SIZE` and `PRICE_TARGET_RUNS` both went
wrong.

**Why a third and not a half or a quarter.** The lower bound is not binding: any
fraction of 63 comfortably exceeds the 3-day corroboration window the churn cycle
runs on, so every candidate breaks the tight loop. The binding consideration is
the other side — how long a genuinely resumed ticker stays invisible — where
smaller is better. A third is where *"has it resumed?"* first has a real answer
rather than a one-bar guess: a ticker that came back has ~21 sessions of history
by then, so at re-admission it is unambiguously fresh and there is no second
eviction.

**What it actually prevents.** Without it the cycle is bounded below by
re-admission plus 3 distinct days. 21 trading days is ~29 calendar days, so **one
tombstone absorbs roughly nine eviction rounds.**

**Cost if it is too long:** a resumed ticker waits up to a trading month. Against
a dynamic universe whose entries age out after 14 days (`ENTRY_MAX_AGE_MS`) that
is one rotation, and the symbol returns through ordinary discovery, at score
zero, on its merits.

## 2. Presets are never tombstoned — two locks, not one

Both routes already send a preset to `hand-edit` and never to `evictSymbol`
(#404), so the write is unreachable today. It is guarded anyway, and the reason
is that **the log has changed job**: it was an audit trail and is now a gate. A
gate must not depend on every caller upstream having got its branch right, and
one stray entry would keep a curated mega-cap out of its own universe for a
trading month, silently.

The refusal is `console.error` and returns *before* the `zadd`. Silent would be
worse than the bug — nothing else in the system can report that the hand-edit
rule was bypassed.

## 3. The record says which signal set it

`tombstonedByAbsence` and `tombstonedByStaleBars`, beside the eviction split.
They are genuinely different facts:

- an **absence** tombstone is belt-and-braces — that symbol is gone from the
  screener anyway, so discovery was never going to re-offer it;
- a **stale-bar** tombstone is load-bearing — that symbol *will* be re-offered on
  the next build, which is the churn this exists to stop.

Folded into one count, a rising number reads as neither.

## 4. At expiry: eligible, not admitted

A lapsed tombstone means `addToDynamicUniverse` stops filtering the symbol out.
It still has to earn a place by score like anything else, still enters at zero,
and still has to survive the corroboration window if it goes stale again.

**The second eviction is not cheaper than the first**, and that is structural
rather than incidental: `evictSymbol` deletes `msh:evict:absent:v1:<SYM>` and the
symbol's field in `msh:evict:stale-bar-days:v1`, so a re-admitted symbol restarts
the corroboration window from zero rather than inheriting days already against
it. Asserted by running `staleBarsShouldEvict` at 0, 2 and 3 days.

## The gate is at the door, and applies to both sets

`addToDynamicUniverse` is where an evicted symbol comes back. One `ZMSCORE`
against the eviction log, before anything is written.

**Both the score set and the `seen` set are filtered.** The module keeps those
two in step by construction and `pruneUniverse` reads `seen` to decide what to
expire — filtering one and not the other would leave a member of half a pair.
That was a live bug in the first draft of this change: the gate was computed and
then the writes still used the unfiltered list.

**It fails open.** An unreadable gate admits: the worst case there is the churn
it damps, while fail-closed is a discovery pass that admits nothing at all.

## An assertion that could not fail, found and fixed

The fail-open check was first written as
`<regex on the body> || /FAIL OPEN. An unreadable tombstone/.test(evict)`. **The
second branch can never match** — `evict` is `readCodeOnly` and comments are
stripped — so the assertion rested entirely on the half nobody had checked. It
now lifts `readTombstoned` and **runs** it against a Redis stub that throws.

Eight breakages verified in the failing direction: the period typed, made
effectively permanent, shortened below the churn cycle, absence treated as a
tombstone, the preset guard removed, the `seen` set escaping the gate, the gate
failing closed, and the two signals folded into one count.
