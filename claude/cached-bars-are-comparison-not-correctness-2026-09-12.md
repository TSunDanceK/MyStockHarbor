# The cached bars are ground truth for COMPARISON, not for CORRECTNESS

Caveat added to the Stooq/SEC probe 2026-09-12, and it changes how A4 must be
scored. Found through EA.

## What EA showed, and it is not about EA

`historyStaleNewestSymbols` flagged `EA@2026-06-23`. EA was taken private: the
$55B PIF / Silver Lake / Affinity consortium deal closed **2026-08-04**, and
Nasdaq suspended trading before the open on **2026-08-05** (Form 25 filed).

So the delisting is real, and EA should be evicted. **But the dates do not line
up.** Bars stopped 2026-06-23; trading stopped 2026-08-05. EA was an actively
traded S&P 500 mega-cap for the ~six weeks in between.

**FMP silently stopped serving bars for a live mega-cap for six weeks, and
nothing noticed.** That is a fact about the upstream, not about EA, and it
undermines a premise the probe was resting on.

## The consequence for A4

A4 was framed as "diff Stooq against the bars already cached in Redis". That
framing quietly assumes the cached bars are correct and Stooq is the thing under
test. **Both directions are live.** Where the two disagree, the question is which
is right, not how far Stooq deviates.

So report disagreements in **two buckets**, because only one of them says anything
about Stooq:

| Bucket | Shape | What it is about |
|---|---|---|
| **METHODOLOGY** | Split/dividend adjustment: systematic, affects every bar in a series, shows up as a constant ratio before an effective date | **Stooq.** This is the real question A4 exists to answer, because a systematic adjustment difference moves every moving average slightly and small amounts flip proximity and crossover signals. |
| **PRESENCE** | A symbol, or a date range within a symbol, that one source has and the other lacks | **Possibly FMP.** A recent-tail gap in the cached data is a CANDIDATE UPSTREAM DEFECT, not a Stooq defect. |

Scoring a presence gap against Stooq would mark Stooq down for having data FMP
was missing. EA is the worked example: six weeks of bars that Stooq will very
likely have and the cache does not.

## The stale-symbol triage the alarm has never had

`historyStaleNewestSymbols` fires correctly every morning. The response has always
been a manual per-symbol investigation — workable at 700 symbols, impossible at
3,000. And "no new bars" turns out to carry **at least three distinct causes**:

| Symbol | Cause | Signature |
|---|---|---|
| `MMC`, `FI` | **renamed** | FMP over-served the retired ticker ~4 weeks, then went quiet |
| `EA` | **delisted** | bars stopped ~6 weeks BEFORE trading did |
| `WBS` | unknown (~3 weeks as of 2026-09-12) | — |
| `EQR` | one missed session | benign lag |

Note what that does to the automation question. `#404`'s hand-edit rule exists
because eviction-on-no-bars would have wrongly removed MMC and FI. EA shows the
same rule would have been **right about EA for the wrong reason** — it was going
anyway, but not for the reason the bars suggested. Neither case supports
automating eviction on bar silence.

**The bulk file settles all of them in one pass, and that is the triage to build:**

```
symbol has no recent bars in the cache
  ├── Stooq HAS recent bars  ->  the upstream dropped it. Not a delisting.
  │                              Refill from the bulk file; keep the symbol.
  └── Stooq is ALSO silent   ->  the stock really stopped trading.
                                 Eviction candidate; confirm the corporate action.
```

One whole-market file answers it for every flagged symbol at once, with no
per-symbol web research and no per-symbol call. That is a capability the current
pipeline cannot have, because FMP is both the data source and the thing under
suspicion — there is no second opinion to consult. Stooq provides one.

**Build the triage, not the case files.** Per-symbol investigation does not scale
and it does not accumulate: each answer is about one ticker on one day. The
decision rule is reusable and runs for free once the file is parsed.

## What this does not excuse

The triage classifies; it does not decide. A symbol Stooq also lacks still needs
its corporate action confirmed before eviction — Stooq silence and delisting are
correlated, not identical, and Stooq's own coverage of the awkward shapes
(share classes, ADRs, LPs, thin caps) is exactly what A3 is for and is still
unmeasured. Do not wire eviction straight to the right-hand branch.

## The profile dataset was itself decaying, and Step 0 caught it

Worth recording because it is the clearest case of why the freeze was urgent
rather than tidy.

The dump found **651 of the 912 swept symbols carrying a non-empty industry and
sector** — against a `/cache-health` panel reporting Profile coverage as 50/885
with "94% have never been refreshed". The panel was counting refreshes; the values
were largely still there.

But `PROFILE_TTL_SECONDS` is **30 days**, and only ~50 had been refreshed. So
roughly **601 of those 651 were living out an old fetch on a rolling expiry** —
each one due to vanish 30 days after whenever it was last written, with nothing
scheduled to rewrite it and no free source able to reproduce FMP's taxonomy
afterwards.

**Step 0 earned its keep on this dataset alone.** A week later that number would
have been materially smaller, and the difference would have been unrecoverable —
not "harder to get", but gone, because SIC codes do not reproduce an industry
taxonomy and no other free source has FMP's labels.

It is also the sharpest illustration of the caveat this document is about: the
panel was *correct* about the thing it measured and *misleading* about the thing
anyone would act on. A refresh count and a value count are different questions,
and only one of them tells you what you still have.

## Related

- `claude/traps/a-reconstruction-cannot-corroborate-its-source.md` — the same
  shape one level up: a source cannot be the evidence for its own reliability.
- `claude/plays-builders-missing-single-flight-2026-09-12.md` — the other thing
  found by asking what the bound actually was rather than accepting the framing.
