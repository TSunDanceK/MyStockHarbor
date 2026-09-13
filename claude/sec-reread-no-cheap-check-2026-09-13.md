# There is no cheap way to ask whether a filer's numbers changed

Measured 2026-09-13 against ARM, HSBC and AAPL via `scripts/sec-reread-probe.mjs`
(relay task `sec-reread`). Every conditional request paired with a negative
control, because a server that answers `304` to any validator produces exactly
the result that looks like good news while meaning a corrections failsafe would
never fire.

## Both cheap options are dead

| Endpoint | `Last-Modified` | `ETag` |
|---|---|---|
| `companyfacts` | **ABSENT** | **ABSENT** |
| `submissions` | **ABSENT** | **ABSENT** |

All three symbols. **No validator is offered anywhere**, so a conditional request
is not something that works badly here — it is something that cannot be
expressed. This re-tests build-brief §3.7 rather than trusting it.

### `isXBRL` splits the wrong way

| Filer | 6-Ks seen | XBRL-tagged |
|---|---|---|
| ARM | 23 | **23** |
| HSBC | 25 | **0** |

It **over-triggers on ARM** (gates nothing — every 6-K re-reads anyway) and
**under-triggers on HSBC** (a quarter reported via 6-K is indistinguishable from
a press release). No threshold fixes both, and a filer-specific rule is a
heuristic that fails silently on the filer nobody tested.

## So: a 6-K costs a full re-read, and the drain rate is the only lever

Accepted deliberately. The volume makes it affordable:

```
49 distinct 6-K filers + 75 distinct 8-K filers over 4 days  ≈ 30 events/day
~150 KB wire each (ARM 50,774 · HSBC ~113,000 · AAPL 271,819)
=> 4–5 MB/day, against 10 requests/SECOND and no daily cap
```

Bandwidth and rate limit are both non-issues.

### The sizing measurement moved the answer

Parse time was expected to be binding. Measured on a synthetic
companyfacts-shaped document of AAPL's decoded size:

```
3.80 MB decoded · JSON.parse median 21 ms · ~182 MB/s
heap delta 5.7 MB (≈1.5× decoded) · 24,840 fact rows materialised
```

**A full day's ~30 re-reads is under a second of parse.** What the numbers
actually constrain is **concurrency, not count**: ten documents parsed in
parallel is ~57 MB of live heap on top of whatever else the function holds. So
the drain is one document at a time, the decoded document is never retained
(extract → keep the ~20 KB fact set → discard, per §4), and the per-symbol cost
is dominated by the network round-trip rather than by CPU.

Measured in the agent sandbox, not in a Vercel function — an order of magnitude,
to be re-measured in situ before `SEC_REREAD_DRAIN_PER_RUN` is raised.

## The drain is sized on PEAK inflow, not on the month it was measured in

The four-day window this pipeline was measured over contained **six** 10-K/10-Q
filings across a 700-large-cap universe, because mid-September is the quietest
part of the cycle. Sizing on it would let the queue **grow through earnings
season** and clear it in the weeks after — exactly backwards. A stale page in
February is invisible; a stale page the morning after a result is the product
failing, and that is when the page is busiest.

**The peak is reused, not re-derived.** `earningsPlan.ts` already carries
`EARNINGS_PEAK_DAY_SHARE = 0.0935`, measured from January and February 2026 with
its own provenance, witnesses and a check that re-derives the figure from the
share:

```
0.0935 × ANALYSIS_UNIVERSE_CAP 700     =  66 reporters on the busiest day
+ background 6-K/8-K, measured         =  32/day
                                       =  98/day peak inflow
drain 150/run                          = 1.53× margin
                                       =  52 symbols/day of net drain at peak
```

A symbol filing both a 10-Q and its Item 2.02 8-K enqueues **once** — the queue
is per symbol — so reporters and their earnings 8-Ks do not double-count.

`SEC_REREAD_DRAIN_PER_RUN` is **derived** from those two constants rather than
typed, so a bigger universe or a changed calendar shape moves it instead of
leaving it silently stale. 150 sequential reads is ~60 s inside a 300 s budget
and ~2.5 req/s against SEC's 10/s.

### The background term is not constant, and the overlap is unresolved

32/day was measured in **mid-September**. FPIs file interim results on 6-Ks in
the same season as everyone else, so the background **co-peaks** with the
reporter count rather than sitting flat underneath it.

Whether that co-peak is already inside the 66 depends on whether the calendar
`EARNINGS_PEAK_DAY_SHARE` was measured from carries ADRs. Its recorded
provenance — FMP's calendar, 2026-01 and 2026-02, **7,559 distinct symbols**,
busiest day 710 — shows a population far broader than US common stock, but does
**not** establish that FPI interim results appear in it. Recorded as unresolved
rather than assumed either way.

The sum is therefore an **over-estimate if the populations overlap** and correct
if they do not. That is the safe direction: over-estimating inflow makes the
drain larger than needed, which costs round-trips rather than freshness.
Resolving it means checking the calendar for a known ADR reporter — worth doing
before anyone **lowers** the number, irrelevant to raising it.

### The off-universe cold path does not share this budget

Earnings pages are deliberately not limited to the universe, so a cold request
for an off-universe symbol also produces a fetch. If both drained from one
allowance, a burst of cold requests would compete with the universe's
earnings-season refresh and **the symbols with actual traffic would lose to
symbols nobody asked for** — a priority inversion with no feedback loop, where
the cold side is unbounded and externally influenceable and the refresh is the
product working.

`SEC_REREAD_DRAIN_PER_RUN` (150) is **guaranteed**; cold fetches get their own
smaller `SEC_COLD_FETCH_DRAIN_PER_RUN` (25). A cold burst starves itself and
nothing else. Neither is consumed yet — step 3 builds the drain, step 8 the lazy
path — but the separation is the default now rather than a refactor nobody
remembers.

## Where to look first IF the drain rate ever becomes binding

**Not now, and not a rule.** Recorded because the observation is real and would
otherwise be lost.

The probe's `primaryDocDescription` column splits the two filers the opposite way
to `isXBRL`:

- **HSBC**'s 6-Ks are richly described and obviously not results —
  `TRANSACTION IN OWN SHARES`, `TOTAL VOTING RIGHTS`, `GROUP CFO SUCCESSION`.
- **Every ARM** description is the bare string `6-K`.

**Description discriminates where tagging fails, and vice versa.** A combined
rule is the obvious next idea and it is exactly the kind of idea that looks
right on two filers and is wrong on the third.

**That is two filers, not a rule.** Testing it needs far more than three — a
description taxonomy across a few hundred FPIs, with the results known
independently — and it must not be built on the strength of this table. It is a
place to look, recorded so that looking does not start from scratch.
