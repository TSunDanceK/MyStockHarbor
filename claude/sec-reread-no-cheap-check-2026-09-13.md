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
